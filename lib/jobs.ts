import { randomUUID } from "node:crypto";

import { buildAuditReport } from "@/lib/analyzer";
import { MAX_COMPETITOR_PAGES } from "@/lib/config";
import { crawlDomain, crawlSinglePage } from "@/lib/crawler";
import {
  completeAuditRun,
  createAuditRun,
  failAuditRun,
  findPreviousCompletedRun,
  getAuditRun,
  listQueuedRuns,
  startAuditRun,
  updateAuditProgress,
  updateHeartbeat,
} from "@/lib/db";
import type { AuditPhase, AuditProgress, AuditReport, AuditRequestInput, AuditRunRecord } from "@/lib/types";
import { normalizeUrl } from "@/lib/utils";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const runningJobs = new Map<string, Promise<void>>();

// On module load: re-start any jobs that were queued but never picked up
// (e.g., server restarted between creating the DB record and starting execution).
// We defer with setImmediate so the module finishes initializing first.
setImmediate(() => {
  recoverQueuedJobs();
});

export function queueAuditRun(request: AuditRequestInput): AuditRunRecord {
  const id = randomUUID();
  const normalizedRequest: AuditRequestInput = {
    ...request,
    targetUrl: normalizeUrl(request.targetUrl),
    competitorUrls: request.mode === "page" ? [] : request.competitorUrls.map(normalizeUrl),
    maxPages: request.mode === "page" ? 1 : request.maxPages,
  };
  const run = createAuditRun(id, normalizedRequest);
  scheduleJob(id, normalizedRequest);
  return run;
}

/**
 * Re-execute any jobs that are still in 'queued' state in the DB.
 * Called on server startup and from the /api/queue/worker endpoint.
 * Returns the number of jobs recovered.
 */
export function recoverQueuedJobs(): number {
  const queued = listQueuedRuns();
  let count = 0;
  for (const { id, request } of queued) {
    if (!runningJobs.has(id)) {
      scheduleJob(id, request);
      count++;
    }
  }
  return count;
}

function scheduleJob(id: string, request: AuditRequestInput): void {
  const job = executeAuditRun(id, request);
  runningJobs.set(id, job);
  void job.finally(() => {
    runningJobs.delete(id);
  });
}

export function getRunningJob(id: string): Promise<void> | undefined {
  return runningJobs.get(id);
}

async function executeAuditRun(id: string, request: AuditRequestInput): Promise<void> {
  startAuditRun(id);
  const startedAt = Date.now();

  // Keep the DB heartbeat alive every 2 minutes so stale-job detection doesn't
  // mark a legitimately long crawl as failed.
  const heartbeatTimer = setInterval(() => {
    updateHeartbeat(id);
  }, HEARTBEAT_INTERVAL_MS);
  const updateProgress = (partial: Partial<AuditProgress> & Pick<AuditProgress, "phase" | "message">) => {
    const run = getAuditRun(id);
    if (!run) {
      return;
    }

    const pagesTarget = partial.pagesTarget ?? run.progress.pagesTarget ?? request.maxPages;
    const pagesCrawled = partial.pagesCrawled ?? run.progress.pagesCrawled ?? 0;
    const percent = partial.percent ?? inferPercent(partial.phase, pagesCrawled, pagesTarget);
    const estimatedSecondsRemaining =
      partial.estimatedSecondsRemaining !== undefined
        ? partial.estimatedSecondsRemaining
        : estimateRemainingSeconds(startedAt, percent);

    updateAuditProgress(id, {
      ...run.progress,
      ...partial,
      pagesTarget,
      percent,
      estimatedSecondsRemaining,
      lastUpdatedAt: new Date().toISOString(),
    });
  };

  updateProgress({
    phase: "discovering",
    message: "Forbereder analysen...",
    percent: 4,
    pagesTarget: request.mode === "page" ? 1 : request.maxPages,
  });

  try {
    const targetCrawl = await (request.mode === "page"
      ? crawlSinglePage(request.targetUrl, true, (event) => {
          updateProgress({
            phase: event.phase,
            message: event.message,
            pagesDiscovered: event.pagesDiscovered,
            pagesCrawled: event.pagesCrawled,
            pagesTarget: event.pagesTarget,
          });
        })
      : crawlDomain(request.targetUrl, request.maxPages, true, (event) => {
          updateProgress({
            phase: event.phase,
            message: event.message,
            pagesDiscovered: event.pagesDiscovered,
            pagesCrawled: event.pagesCrawled,
            pagesTarget: event.pagesTarget,
          });
        }));
    const competitorPagesByDomain: Record<string, Awaited<ReturnType<typeof crawlDomain>>["pages"]> = {};

    if (request.mode === "domain" && request.competitorUrls.length) {
      updateProgress({
        phase: "benchmarking",
        message: "Crawler konkurrenter for sammenligning...",
        pagesDiscovered: targetCrawl.pages.length,
        pagesCrawled: targetCrawl.pages.length,
        competitorsCompleted: 0,
        competitorsTotal: request.competitorUrls.length,
        percent: 74,
      });
    }

    if (request.mode === "domain") {
      for (const competitorUrl of request.competitorUrls) {
        const crawl = await crawlDomain(competitorUrl, MAX_COMPETITOR_PAGES, false);
        competitorPagesByDomain[new URL(competitorUrl).hostname] = crawl.pages;
        const run = getAuditRun(id);
        updateProgress({
          phase: "benchmarking",
          message: "Crawler konkurrenter for sammenligning...",
          pagesDiscovered: targetCrawl.pages.length,
          pagesCrawled: targetCrawl.pages.length,
          competitorsCompleted: (run?.progress.competitorsCompleted ?? 0) + 1,
          competitorsTotal: request.competitorUrls.length,
        });
      }
    }

    updateProgress({
      phase: "analyzing",
      message: "Beregner scorer, issues og anbefalinger...",
      pagesDiscovered: targetCrawl.pages.length,
      pagesCrawled: targetCrawl.pages.length,
      competitorsCompleted: request.competitorUrls.length,
      competitorsTotal: request.competitorUrls.length,
      percent: 90,
    });

    const previousReport = findPreviousCompletedRun(request.targetUrl, id);
    const report = buildAuditReport({
      runId: id,
      request,
      targetPages: targetCrawl.pages,
      competitorPagesByDomain,
      previousReport,
      indexNowStatus: targetCrawl.indexNowStatus,
    });

    updateProgress({
      phase: "finalizing",
      message: "Lagrer rapport og historikk...",
      pagesDiscovered: report.pages.length,
      pagesCrawled: report.pages.length,
      competitorsCompleted: request.competitorUrls.length,
      competitorsTotal: request.competitorUrls.length,
      percent: 97,
      estimatedSecondsRemaining: 1,
    });

    completeAuditRun(id, toSummary(report), report);
  } catch (error) {
    failAuditRun(id, error instanceof Error ? error.message : "Ukjent feil under analyse");
  } finally {
    clearInterval(heartbeatTimer);
  }
}

function inferPercent(phase: AuditPhase, pagesCrawled: number, pagesTarget: number): number {
  const crawlRatio = pagesTarget > 0 ? Math.min(1, pagesCrawled / pagesTarget) : 0;

  switch (phase) {
    case "queued":
      return 2;
    case "discovering":
      return 8;
    case "crawling":
      return 10 + Math.round(crawlRatio * 58);
    case "rendering":
      return 72;
    case "benchmarking":
      return 78;
    case "analyzing":
      return 90;
    case "finalizing":
      return 97;
    case "completed":
      return 100;
    case "failed":
      return Math.max(5, Math.round(crawlRatio * 100));
    default:
      return 5;
  }
}

function estimateRemainingSeconds(startedAt: number, percent: number): number | null {
  if (percent <= 3) {
    return null;
  }

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const projectedTotal = elapsedSeconds / (percent / 100);
  const remaining = Math.max(0, projectedTotal - elapsedSeconds);
  return Number.isFinite(remaining) ? Math.round(remaining) : null;
}

function toSummary(report: AuditReport) {
  return {
    mode: report.request.mode,
    totalScore: report.totalScore,
    categoryScores: report.categoryScores,
    providerScores: report.providerScores,
    totalPages: report.pages.length,
    issueCount: report.issues.length,
    targetUrl: report.request.targetUrl,
  };
}

export function getAuditRunOrThrow(id: string): AuditRunRecord {
  const run = getAuditRun(id);
  if (!run) {
    throw new Error("Fant ikke audit-kjøring");
  }

  return run;
}
