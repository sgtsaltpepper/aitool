import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AuditProgress,
  AuditReport,
  AuditRequestInput,
  AuditRunRecord,
  AuditRunSummary,
  AuditStatus,
  PageSnapshot,
} from "@/lib/types";
import { readableExcerpt } from "@/lib/utils";

const dataDir = join(process.cwd(), ".data");
const databasePath = join(dataDir, "audits.sqlite");
const STALE_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;

mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_runs (
    id TEXT PRIMARY KEY,
    target_url TEXT NOT NULL,
    status TEXT NOT NULL,
    request_json TEXT NOT NULL,
    summary_json TEXT,
    report_json TEXT,
    progress_json TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    heartbeat_at TEXT,
    completed_at TEXT
  );
`);

ensureColumn("progress_json", "TEXT");
ensureColumn("heartbeat_at", "TEXT");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_audit_runs_target_completed
  ON audit_runs (target_url, completed_at DESC);
`);

recoverStaleAuditRuns();

function ensureColumn(name: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(audit_runs)`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === name)) {
    return;
  }

  db.exec(`ALTER TABLE audit_runs ADD COLUMN ${name} ${definition}`);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
}

function normalizeStoredRequest(request: Partial<AuditRequestInput> | null | undefined): AuditRequestInput {
  return {
    mode: request?.mode === "page" ? "page" : "domain",
    targetUrl: request?.targetUrl ?? "",
    locale: request?.locale ?? "",
    country: request?.country ?? "",
    competitorUrls: request?.mode === "page" ? [] : request?.competitorUrls ?? [],
    maxPages: request?.mode === "page" ? 1 : request?.maxPages ?? 150,
  };
}

function createInitialProgress(request: AuditRequestInput): AuditProgress {
  return {
    phase: "queued",
    message: "Audit er lagt i kø.",
    percent: 2,
    pagesDiscovered: 0,
    pagesCrawled: 0,
    pagesTarget: request.mode === "page" ? 1 : request.maxPages,
    competitorsCompleted: 0,
    competitorsTotal: request.mode === "page" ? 0 : request.competitorUrls.length,
    estimatedSecondsRemaining: null,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function compressPageSnapshot(page: PageSnapshot): PageSnapshot {
  return {
    ...page,
    bodyText: readableExcerpt(page.bodyText, 320),
    rendering: {
      ...page.rendering,
      extractedTextPreview: readableExcerpt(page.rendering.extractedTextPreview, 220),
    },
  };
}

function compressReport(report: AuditReport): AuditReport {
  return {
    ...report,
    pages: report.pages.map(compressPageSnapshot),
  };
}

export function createAuditRun(id: string, request: AuditRequestInput): AuditRunRecord {
  const createdAt = new Date().toISOString();
  const progress = createInitialProgress(request);
  db.prepare(
    `
      INSERT INTO audit_runs (
        id,
        target_url,
        status,
        request_json,
        progress_json,
        created_at,
        heartbeat_at
      ) VALUES (?, ?, 'queued', ?, ?, ?, ?)
    `,
  ).run(id, request.targetUrl, JSON.stringify(request), JSON.stringify(progress), createdAt, createdAt);

  return getAuditRun(id)!;
}

export function startAuditRun(id: string): void {
  const startedAt = new Date().toISOString();
  db.prepare(
    `UPDATE audit_runs SET status = 'running', started_at = ?, heartbeat_at = ? WHERE id = ?`,
  ).run(startedAt, startedAt, id);
}

export function updateAuditProgress(id: string, progress: AuditProgress): void {
  db.prepare(`UPDATE audit_runs SET progress_json = ?, heartbeat_at = ? WHERE id = ?`).run(
    JSON.stringify(progress),
    progress.lastUpdatedAt,
    id,
  );
}

export function completeAuditRun(id: string, summary: AuditRunSummary, report: AuditReport): void {
  const completedAt = new Date().toISOString();
  const progress: AuditProgress = {
    phase: "completed",
    message: "Analysen er ferdig.",
    percent: 100,
    pagesDiscovered: report.pages.length,
    pagesCrawled: report.pages.length,
    pagesTarget: report.request.maxPages,
    competitorsCompleted: report.request.competitorUrls.length,
    competitorsTotal: report.request.competitorUrls.length,
    estimatedSecondsRemaining: 0,
    lastUpdatedAt: completedAt,
  };
  const compressed = compressReport(report);

  db.prepare(
    `
      UPDATE audit_runs
      SET
        status = 'completed',
        summary_json = ?,
        report_json = ?,
        progress_json = ?,
        heartbeat_at = ?,
        completed_at = ?
      WHERE id = ?
    `,
  ).run(
    JSON.stringify(summary),
    JSON.stringify(compressed),
    JSON.stringify(progress),
    completedAt,
    completedAt,
    id,
  );
}

export function failAuditRun(id: string, errorMessage: string): void {
  const completedAt = new Date().toISOString();
  const run = getAuditRun(id);
  const fallbackRequest: AuditRequestInput = {
    mode: "domain",
    targetUrl: "",
    locale: "",
    country: "",
    competitorUrls: [],
    maxPages: 150,
  };
  const progress: AuditProgress = {
    ...(run?.progress ?? createInitialProgress(run?.request ?? fallbackRequest)),
    phase: "failed",
    message: errorMessage,
    percent: Math.max(run?.progress.percent ?? 5, 5),
    estimatedSecondsRemaining: null,
    lastUpdatedAt: completedAt,
  };
  db.prepare(
    `
      UPDATE audit_runs
      SET status = 'failed', error_message = ?, progress_json = ?, heartbeat_at = ?, completed_at = ?
      WHERE id = ?
    `,
  ).run(errorMessage, JSON.stringify(progress), completedAt, completedAt, id);
}

export function recoverStaleAuditRuns(now = new Date()): number {
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_TIMEOUT_MS).toISOString();
  const staleRuns = db
    .prepare(
      `
        SELECT id, request_json, progress_json
        FROM audit_runs
        WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)
      `,
    )
    .all(staleBefore) as Array<{
    id: string;
    request_json: string;
    progress_json: string | null;
  }>;

  for (const row of staleRuns) {
    const request = normalizeStoredRequest(JSON.parse(row.request_json) as Partial<AuditRequestInput>);
    const previousProgress = parseJson<AuditProgress>(row.progress_json) ?? createInitialProgress(request);
    const progress: AuditProgress = {
      ...previousProgress,
      phase: "failed",
      message: "Analysen ble avbrutt fordi serveren startet på nytt eller jobben stoppet uten å fullføre.",
      estimatedSecondsRemaining: null,
      lastUpdatedAt: now.toISOString(),
    };

    db.prepare(
      `
        UPDATE audit_runs
        SET status = 'failed', error_message = ?, progress_json = ?, heartbeat_at = ?, completed_at = ?
        WHERE id = ?
      `,
    ).run(progress.message, JSON.stringify(progress), now.toISOString(), now.toISOString(), row.id);
  }

  return staleRuns.length;
}

export function getAuditRun(id: string): AuditRunRecord | null {
  const row = db
    .prepare(
      `
        SELECT
          id,
          target_url,
          status,
          request_json,
          summary_json,
          progress_json,
          error_message,
          created_at,
          started_at,
          heartbeat_at,
          completed_at
        FROM audit_runs
        WHERE id = ?
      `,
    )
    .get(id) as
    | {
        id: string;
        target_url: string;
        status: AuditStatus;
        request_json: string;
        summary_json: string | null;
        progress_json: string | null;
        error_message: string | null;
        created_at: string;
        started_at: string | null;
        heartbeat_at: string | null;
        completed_at: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  const request = normalizeStoredRequest(JSON.parse(row.request_json) as Partial<AuditRequestInput>);
  return {
    id: row.id,
    targetUrl: row.target_url,
    status: row.status,
    request,
    summary: parseJson<AuditRunSummary>(row.summary_json),
    progress: parseJson<AuditProgress>(row.progress_json) ?? createInitialProgress(request),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    heartbeatAt: row.heartbeat_at,
  };
}

export function getAuditReport(id: string): AuditReport | null {
  const row = db.prepare(`SELECT report_json FROM audit_runs WHERE id = ?`).get(id) as
    | { report_json: string | null }
    | undefined;

  if (!row?.report_json) {
    return null;
  }

  return JSON.parse(row.report_json) as AuditReport;
}

export function listAuditRuns(limit = 20): AuditRunRecord[] {
  const rows = db
    .prepare(
      `
        SELECT
          id,
          target_url,
          status,
          request_json,
          summary_json,
          progress_json,
          error_message,
          created_at,
          started_at,
          heartbeat_at,
          completed_at
        FROM audit_runs
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(limit) as Array<{
    id: string;
    target_url: string;
    status: AuditStatus;
    request_json: string;
    summary_json: string | null;
    progress_json: string | null;
    error_message: string | null;
    created_at: string;
    started_at: string | null;
    heartbeat_at: string | null;
    completed_at: string | null;
  }>;

  return rows.map((row) => {
    const request = normalizeStoredRequest(JSON.parse(row.request_json) as Partial<AuditRequestInput>);
    return {
      id: row.id,
      targetUrl: row.target_url,
      status: row.status,
      request,
      summary: parseJson<AuditRunSummary>(row.summary_json),
      progress: parseJson<AuditProgress>(row.progress_json) ?? createInitialProgress(request),
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
      heartbeatAt: row.heartbeat_at,
    };
  });
}

export function findPreviousCompletedRun(targetUrl: string, excludeId: string): AuditReport | null {
  const row = db
    .prepare(
      `
        SELECT report_json
        FROM audit_runs
        WHERE target_url = ? AND status = 'completed' AND id != ?
        ORDER BY completed_at DESC
        LIMIT 1
      `,
    )
    .get(targetUrl, excludeId) as { report_json: string | null } | undefined;

  if (!row?.report_json) {
    return null;
  }

  return JSON.parse(row.report_json) as AuditReport;
}
