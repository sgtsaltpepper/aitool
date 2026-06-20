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
  BackgroundJob,
  DomainIntegration,
  Ga4LandingPageRow,
  GoogleConnection,
  GscPageQueryRow,
  GscPageRow,
  GscQueryRow,
  Opportunity,
  OpportunityPriority,
  OpportunitySnapshot,
  OpportunityType,
  PageImprovementSuggestion,
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

db.exec(`
  CREATE TABLE IF NOT EXISTS google_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS domain_integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    gsc_property TEXT,
    ga4_property_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gsc_page_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    date TEXT NOT NULL,
    page TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    ctr REAL NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    UNIQUE(domain, date, page)
  );

  CREATE TABLE IF NOT EXISTS gsc_query_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    date TEXT NOT NULL,
    query TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    ctr REAL NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    UNIQUE(domain, date, query)
  );

  CREATE TABLE IF NOT EXISTS gsc_page_query_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    date TEXT NOT NULL,
    page TEXT NOT NULL,
    query TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    ctr REAL NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    UNIQUE(domain, date, page, query)
  );

  CREATE TABLE IF NOT EXISTS ga4_landing_page_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    date TEXT NOT NULL,
    page TEXT NOT NULL,
    sessions INTEGER NOT NULL DEFAULT 0,
    conversions INTEGER NOT NULL DEFAULT 0,
    bounce_rate REAL NOT NULL DEFAULT 0,
    UNIQUE(domain, date, page)
  );

  CREATE TABLE IF NOT EXISTS gsc_url_inspection_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    url TEXT NOT NULL,
    inspection_json TEXT NOT NULL,
    inspected_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(domain, url)
  );

  CREATE TABLE IF NOT EXISTS background_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    progress_json TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    heartbeat_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS opportunity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    opportunity_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS opportunity_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    target_url TEXT NOT NULL,
    page_url TEXT NOT NULL,
    query TEXT,
    query_cluster TEXT,
    type TEXT NOT NULL,
    priority TEXT NOT NULL,
    title TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    recommended_action TEXT NOT NULL,
    expected_impact TEXT NOT NULL,
    implementation_pack_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (snapshot_id) REFERENCES opportunity_snapshots(id)
  );

  CREATE TABLE IF NOT EXISTS email_digest_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    week_start TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    content_json TEXT,
    sent_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(domain, week_start)
  );
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

export function updateHeartbeat(id: string): void {
  db.prepare(`UPDATE audit_runs SET heartbeat_at = ? WHERE id = ? AND status = 'running'`).run(
    new Date().toISOString(),
    id,
  );
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

export function listQueuedRuns(): Array<{ id: string; request: AuditRequestInput }> {
  const rows = db
    .prepare(`SELECT id, request_json FROM audit_runs WHERE status = 'queued' ORDER BY created_at ASC`)
    .all() as Array<{ id: string; request_json: string }>;

  return rows.map((row) => ({
    id: row.id,
    request: normalizeStoredRequest(JSON.parse(row.request_json) as Partial<AuditRequestInput>),
  }));
}

export type ScoreHistoryEntry = {
  auditRunId: string;
  recordedAt: string;
  totalScore: number | null;
  categories: Record<string, number | null>;
  providers: Record<string, number | null>;
};

export function getScoreHistory(targetUrl: string, days = 90): ScoreHistoryEntry[] {
  const rows = db
    .prepare(
      `
        SELECT *
        FROM score_history
        WHERE target_url = ?
          AND recorded_at >= datetime('now', ? || ' days')
        ORDER BY recorded_at ASC
      `,
    )
    .all(targetUrl, `-${days}`) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    auditRunId: row.audit_run_id as string,
    recordedAt: row.recorded_at as string,
    totalScore: row.total_score as number | null,
    categories: {
      crawlabilityIndexation: row.score_crawlability as number | null,
      renderingAiAccessibility: row.score_rendering as number | null,
      answerFirstContent: row.score_answer_first as number | null,
      citationAuthorityEntitySignals: row.score_citation as number | null,
      schemaSemanticSearch: row.score_schema as number | null,
      internalLinking: row.score_internal_linking as number | null,
      searchIntentTopicClusters: row.score_topic_clusters as number | null,
      zeroClickAiOverviews: row.score_zero_click as number | null,
      contentFreshness: row.score_freshness as number | null,
      technicalOptimization: row.score_technical as number | null,
    },
    providers: {
      openai: row.score_openai as number | null,
      google: row.score_google as number | null,
      bing: row.score_bing as number | null,
      perplexity: row.score_perplexity as number | null,
      citation: row.score_citation_provider as number | null,
    },
  }));
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

// ─── Google Connection helpers ────────────────────────────────────────────────

export function getGoogleConnection(): GoogleConnection | null {
  const row = db
    .prepare(`SELECT id, email, access_token, refresh_token, expires_at, created_at, updated_at FROM google_connections LIMIT 1`)
    .get() as {
    id: number; email: string; access_token: string; refresh_token: string;
    expires_at: number; created_at: string; updated_at: string;
  } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertGoogleConnection(
  email: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): void {
  const now = new Date().toISOString();
  db.exec(`DELETE FROM google_connections`);
  db.prepare(
    `INSERT INTO google_connections (email, access_token, refresh_token, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(email, accessToken, refreshToken, expiresAt, now, now);
}

export function deleteGoogleConnection(): void {
  db.exec(`DELETE FROM google_connections`);
}

// ─── Domain integration helpers ───────────────────────────────────────────────

export function listDomainIntegrations(): DomainIntegration[] {
  const rows = db
    .prepare(`SELECT id, domain, gsc_property, ga4_property_id, created_at, updated_at FROM domain_integrations ORDER BY domain`)
    .all() as Array<{
    id: number; domain: string; gsc_property: string | null;
    ga4_property_id: string | null; created_at: string; updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    gscProperty: r.gsc_property,
    ga4PropertyId: r.ga4_property_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function upsertDomainIntegration(
  domain: string,
  gscProperty: string | null,
  ga4PropertyId: string | null,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO domain_integrations (domain, gsc_property, ga4_property_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET
       gsc_property = excluded.gsc_property,
       ga4_property_id = excluded.ga4_property_id,
       updated_at = excluded.updated_at`,
  ).run(domain, gscProperty, ga4PropertyId, now, now);
}

export function deleteDomainIntegration(id: number): void {
  db.prepare(`DELETE FROM domain_integrations WHERE id = ?`).run(id);
}

// ─── GSC / GA4 upserts ────────────────────────────────────────────────────────

export function upsertGscPageRow(row: GscPageRow): void {
  db.prepare(
    `INSERT INTO gsc_page_daily (domain, date, page, clicks, impressions, ctr, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain, date, page) DO UPDATE SET
       clicks=excluded.clicks, impressions=excluded.impressions,
       ctr=excluded.ctr, position=excluded.position`,
  ).run(row.domain, row.date, row.page, row.clicks, row.impressions, row.ctr, row.position);
}

export function upsertGscQueryRow(row: GscQueryRow): void {
  db.prepare(
    `INSERT INTO gsc_query_daily (domain, date, query, clicks, impressions, ctr, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain, date, query) DO UPDATE SET
       clicks=excluded.clicks, impressions=excluded.impressions,
       ctr=excluded.ctr, position=excluded.position`,
  ).run(row.domain, row.date, row.query, row.clicks, row.impressions, row.ctr, row.position);
}

export function upsertGscPageQueryRow(row: GscPageQueryRow): void {
  db.prepare(
    `INSERT INTO gsc_page_query_daily (domain, date, page, query, clicks, impressions, ctr, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain, date, page, query) DO UPDATE SET
       clicks=excluded.clicks, impressions=excluded.impressions,
       ctr=excluded.ctr, position=excluded.position`,
  ).run(row.domain, row.date, row.page, row.query, row.clicks, row.impressions, row.ctr, row.position);
}

export function upsertGa4LandingPageRow(row: Ga4LandingPageRow): void {
  db.prepare(
    `INSERT INTO ga4_landing_page_daily (domain, date, page, sessions, conversions, bounce_rate)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain, date, page) DO UPDATE SET
       sessions=excluded.sessions, conversions=excluded.conversions,
       bounce_rate=excluded.bounce_rate`,
  ).run(row.domain, row.date, row.page, row.sessions, row.conversions, row.bounceRate);
}

export function getGscUrlInspectionCache(domain: string, url: string): unknown | null {
  const row = db
    .prepare(`SELECT inspection_json FROM gsc_url_inspection_cache WHERE domain=? AND url=?`)
    .get(domain, url) as { inspection_json: string } | undefined;
  return row ? JSON.parse(row.inspection_json) : null;
}

export function upsertGscUrlInspectionCache(domain: string, url: string, data: unknown): void {
  db.prepare(
    `INSERT INTO gsc_url_inspection_cache (domain, url, inspection_json, inspected_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(domain, url) DO UPDATE SET
       inspection_json=excluded.inspection_json,
       inspected_at=excluded.inspected_at`,
  ).run(domain, url, JSON.stringify(data));
}

// ─── Background jobs ──────────────────────────────────────────────────────────

export function createBackgroundJob(type: string, payload: Record<string, unknown> = {}): BackgroundJob {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO background_jobs (type, payload_json, status, created_at) VALUES (?, ?, 'queued', ?)`,
  ).run(type, JSON.stringify(payload), now);
  return getBackgroundJob(Number(result.lastInsertRowid))!;
}

export function getBackgroundJob(id: number): BackgroundJob | null {
  const row = db
    .prepare(`SELECT id,type,payload_json,status,progress_json,error_message,created_at,started_at,heartbeat_at,completed_at FROM background_jobs WHERE id=?`)
    .get(id) as {
    id: number; type: string; payload_json: string; status: string;
    progress_json: string | null; error_message: string | null;
    created_at: string; started_at: string | null;
    heartbeat_at: string | null; completed_at: string | null;
  } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status as BackgroundJob["status"],
    progress: row.progress_json ? JSON.parse(row.progress_json) as Record<string, unknown> : null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    completedAt: row.completed_at,
  };
}

export function completeBackgroundJob(id: number): void {
  db.prepare(`UPDATE background_jobs SET status='completed', completed_at=datetime('now') WHERE id=?`).run(id);
}

export function failBackgroundJob(id: number, errorMessage: string): void {
  db.prepare(`UPDATE background_jobs SET status='failed', error_message=?, completed_at=datetime('now') WHERE id=?`).run(errorMessage, id);
}

export function getLastSyncTimestamps(domain: string): { lastGscSync: string | null; lastGa4Sync: string | null; lastOpportunityRun: string | null } {
  const gsc = db
    .prepare(`SELECT completed_at FROM background_jobs WHERE type='sync-gsc' AND payload_json LIKE ? AND status='completed' ORDER BY completed_at DESC LIMIT 1`)
    .get(`%"domain":"${domain}"%`) as { completed_at: string } | undefined;
  const ga4 = db
    .prepare(`SELECT completed_at FROM background_jobs WHERE type='sync-ga4' AND payload_json LIKE ? AND status='completed' ORDER BY completed_at DESC LIMIT 1`)
    .get(`%"domain":"${domain}"%`) as { completed_at: string } | undefined;
  const opp = db
    .prepare(`SELECT generated_at FROM opportunity_snapshots WHERE domain=? ORDER BY generated_at DESC LIMIT 1`)
    .get(domain) as { generated_at: string } | undefined;
  return {
    lastGscSync: gsc?.completed_at ?? null,
    lastGa4Sync: ga4?.completed_at ?? null,
    lastOpportunityRun: opp?.generated_at ?? null,
  };
}

// ─── Opportunity helpers ──────────────────────────────────────────────────────

export function createOpportunitySnapshot(domain: string, count: number): number {
  const result = db.prepare(
    `INSERT INTO opportunity_snapshots (domain, generated_at, opportunity_count) VALUES (?, datetime('now'), ?)`,
  ).run(domain, count);
  return Number(result.lastInsertRowid);
}

export function insertOpportunityItem(item: Omit<Opportunity, "id" | "createdAt">): void {
  db.prepare(
    `INSERT INTO opportunity_items
     (snapshot_id, domain, target_url, page_url, query, query_cluster, type, priority, title,
      evidence_json, recommended_action, expected_impact, implementation_pack_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.snapshotId, item.domain, item.targetUrl, item.pageUrl, item.query ?? null,
    item.queryCluster ?? null, item.type, item.priority, item.title,
    JSON.stringify(item.evidence), item.recommendedAction, item.expectedImpact,
    item.implementationPackId ?? null, item.status,
  );
}

type OpportunityRow = {
  id: number; snapshot_id: number; domain: string; target_url: string; page_url: string;
  query: string | null; query_cluster: string | null; type: string; priority: string;
  title: string; evidence_json: string; recommended_action: string; expected_impact: string;
  implementation_pack_id: number | null; status: string; created_at: string;
};

function rowToOpportunity(r: OpportunityRow): Opportunity {
  return {
    id: r.id,
    snapshotId: r.snapshot_id,
    domain: r.domain,
    targetUrl: r.target_url,
    pageUrl: r.page_url,
    query: r.query,
    queryCluster: r.query_cluster,
    type: r.type as Opportunity["type"],
    priority: r.priority as Opportunity["priority"],
    title: r.title,
    evidence: JSON.parse(r.evidence_json) as Record<string, unknown>,
    recommendedAction: r.recommended_action,
    expectedImpact: r.expected_impact,
    implementationPackId: r.implementation_pack_id,
    status: r.status as Opportunity["status"],
    createdAt: r.created_at,
  };
}

export function listOpportunities(opts: {
  domain?: string;
  status?: string;
  type?: string;
  priority?: string;
  limit?: number;
} = {}): Opportunity[] {
  const conditions: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [];
  if (opts.domain) { conditions.push("domain=?"); params.push(opts.domain); }
  if (opts.status) { conditions.push("status=?"); params.push(opts.status); }
  if (opts.type) { conditions.push("type=?"); params.push(opts.type); }
  if (opts.priority) { conditions.push("priority=?"); params.push(opts.priority); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 200;
  const rows = db
    .prepare(`SELECT * FROM opportunity_items ${where} ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT ?`)
    .all(...params, limit) as unknown as OpportunityRow[];
  return rows.map(rowToOpportunity);
}

export function getOpportunity(id: number): Opportunity | null {
  const row = db.prepare(`SELECT * FROM opportunity_items WHERE id=?`).get(id) as OpportunityRow | undefined;
  return row ? rowToOpportunity(row) : null;
}

export function updateOpportunityStatus(id: number, status: Opportunity["status"]): void {
  db.prepare(`UPDATE opportunity_items SET status=? WHERE id=?`).run(status, id);
}

export function countOpenOpportunities(): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM opportunity_items WHERE status='open'`).get() as { n: number };
  return row.n;
}

// ─── GSC page data for opportunity engine ─────────────────────────────────────

export function getGscPageData(domain: string, days = 28): GscPageRow[] {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return db
    .prepare(`SELECT domain,date,page,clicks,impressions,ctr,position FROM gsc_page_daily WHERE domain=? AND date>=? ORDER BY date DESC`)
    .all(domain, since) as unknown as GscPageRow[];
}

export function getGscPageQueryData(domain: string, days = 28): GscPageQueryRow[] {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return db
    .prepare(`SELECT domain,date,page,query,clicks,impressions,ctr,position FROM gsc_page_query_daily WHERE domain=? AND date>=? ORDER BY date DESC`)
    .all(domain, since) as unknown as GscPageQueryRow[];
}

export function getTopQueriesForPage(
  domain: string,
  page: string,
  days = 28,
  limit = 10,
): { query: string; clicks: number; impressions: number; ctr: number; position: number }[] {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT query,
              SUM(clicks) as clicks,
              SUM(impressions) as impressions,
              AVG(ctr) as ctr,
              AVG(position) as position
       FROM gsc_page_query_daily
       WHERE domain=? AND page=? AND date>=?
       GROUP BY query
       ORDER BY impressions DESC
       LIMIT ?`,
    )
    .all(domain, page, since, limit) as { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
}

export function getGscMetricsForPage(
  domain: string,
  page: string,
  days = 28,
): { clicks: number; impressions: number; ctr: number; position: number } | null {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT
         SUM(clicks) as clicks,
         SUM(impressions) as impressions,
         AVG(ctr) as ctr,
         AVG(position) as position
       FROM gsc_page_daily
       WHERE domain=? AND page=? AND date>=?`,
    )
    .get(domain, page, since) as
    | { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null }
    | undefined;

  if (!row || row.impressions === null) {
    return null;
  }

  return {
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  };
}

export function getGa4PageData(domain: string, days = 28): Ga4LandingPageRow[] {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return db
    .prepare(`SELECT domain,date,page,sessions,conversions,bounce_rate FROM ga4_landing_page_daily WHERE domain=? AND date>=? ORDER BY date DESC`)
    .all(domain, since) as unknown as Ga4LandingPageRow[];
}

export function getGa4MetricsForPage(
  domain: string,
  page: string,
  days = 28,
): { sessions: number; conversions: number; bounceRate: number } | null {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT
         SUM(sessions) as sessions,
         SUM(conversions) as conversions,
         AVG(bounce_rate) as bounceRate
       FROM ga4_landing_page_daily
       WHERE domain=? AND page=? AND date>=?`,
    )
    .get(domain, page, since) as
    | { sessions: number | null; conversions: number | null; bounceRate: number | null }
    | undefined;

  if (!row || row.sessions === null) {
    return null;
  }

  return {
    sessions: row.sessions ?? 0,
    conversions: row.conversions ?? 0,
    bounceRate: row.bounceRate ?? 0,
  };
}

export function findLatestPageContext(
  pageUrl: string,
): { page: PageSnapshot | null; suggestion: PageImprovementSuggestion | null } {
  const rows = db
    .prepare(
      `SELECT report_json
       FROM audit_runs
       WHERE status='completed' AND report_json LIKE ?
       ORDER BY completed_at DESC
       LIMIT 10`,
    )
    .all(`%${pageUrl}%`) as Array<{ report_json: string | null }>;

  for (const row of rows) {
    if (!row.report_json) {
      continue;
    }

    const report = JSON.parse(row.report_json) as {
      pages?: PageSnapshot[];
      pageSuggestions?: PageImprovementSuggestion[];
    };
    const page = report.pages?.find((candidate) => candidate.url === pageUrl) ?? null;
    const suggestion = report.pageSuggestions?.find((candidate) => candidate.url === pageUrl) ?? null;
    if (page || suggestion) {
      return { page, suggestion };
    }
  }

  return { page: null, suggestion: null };
}

// ─── Email digest helpers ─────────────────────────────────────────────────────

export function upsertEmailDigestRun(domain: string, weekStart: string): number {
  const existing = db
    .prepare(`SELECT id FROM email_digest_runs WHERE domain=? AND week_start=?`)
    .get(domain, weekStart) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db.prepare(
    `INSERT INTO email_digest_runs (domain, week_start, status) VALUES (?, ?, 'pending')`,
  ).run(domain, weekStart);
  return Number(result.lastInsertRowid);
}

export function completeEmailDigestRun(id: number, contentJson: unknown): void {
  db.prepare(
    `UPDATE email_digest_runs SET status='sent', content_json=?, sent_at=datetime('now') WHERE id=?`,
  ).run(JSON.stringify(contentJson), id);
}

export function failEmailDigestRun(id: number, errorMessage: string): void {
  db.prepare(`UPDATE email_digest_runs SET status='failed', error_message=? WHERE id=?`).run(errorMessage, id);
}
