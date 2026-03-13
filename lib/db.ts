import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AuditReport, AuditRequestInput, AuditRunRecord, AuditRunSummary, AuditStatus } from "@/lib/types";

const dataDir = join(process.cwd(), ".data");
const databasePath = join(dataDir, "audits.sqlite");

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
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );
`);

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
}

export function createAuditRun(id: string, request: AuditRequestInput): AuditRunRecord {
  const createdAt = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO audit_runs (
        id,
        target_url,
        status,
        request_json,
        created_at
      ) VALUES (?, ?, 'queued', ?, ?)
    `,
  ).run(id, request.targetUrl, JSON.stringify(request), createdAt);

  return getAuditRun(id)!;
}

export function startAuditRun(id: string): void {
  db.prepare(`UPDATE audit_runs SET status = 'running', started_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id,
  );
}

export function completeAuditRun(id: string, summary: AuditRunSummary, report: AuditReport): void {
  db.prepare(
    `
      UPDATE audit_runs
      SET
        status = 'completed',
        summary_json = ?,
        report_json = ?,
        completed_at = ?
      WHERE id = ?
    `,
  ).run(JSON.stringify(summary), JSON.stringify(report), new Date().toISOString(), id);
}

export function failAuditRun(id: string, errorMessage: string): void {
  db.prepare(
    `
      UPDATE audit_runs
      SET status = 'failed', error_message = ?, completed_at = ?
      WHERE id = ?
    `,
  ).run(errorMessage, new Date().toISOString(), id);
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
          error_message,
          created_at,
          started_at,
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
        error_message: string | null;
        created_at: string;
        started_at: string | null;
        completed_at: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    targetUrl: row.target_url,
    status: row.status,
    request: JSON.parse(row.request_json) as AuditRequestInput,
    summary: parseJson<AuditRunSummary>(row.summary_json),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
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
          error_message,
          created_at,
          started_at,
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
    error_message: string | null;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    targetUrl: row.target_url,
    status: row.status,
    request: JSON.parse(row.request_json) as AuditRequestInput,
    summary: parseJson<AuditRunSummary>(row.summary_json),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
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
