import { randomUUID } from "node:crypto";

import { buildAuditReport } from "@/lib/analyzer";
import { MAX_COMPETITOR_PAGES } from "@/lib/config";
import { crawlDomain } from "@/lib/crawler";
import {
  completeAuditRun,
  createAuditRun,
  failAuditRun,
  findPreviousCompletedRun,
  getAuditRun,
  startAuditRun,
} from "@/lib/db";
import type { AuditReport, AuditRequestInput, AuditRunRecord } from "@/lib/types";
import { normalizeUrl } from "@/lib/utils";

const runningJobs = new Map<string, Promise<void>>();

export function queueAuditRun(request: AuditRequestInput): AuditRunRecord {
  const id = randomUUID();
  const normalizedRequest: AuditRequestInput = {
    ...request,
    targetUrl: normalizeUrl(request.targetUrl),
    competitorUrls: request.competitorUrls.map(normalizeUrl),
  };
  const run = createAuditRun(id, normalizedRequest);
  const job = executeAuditRun(id, normalizedRequest);
  runningJobs.set(id, job);
  void job.finally(() => {
    runningJobs.delete(id);
  });

  return run;
}

export function getRunningJob(id: string): Promise<void> | undefined {
  return runningJobs.get(id);
}

async function executeAuditRun(id: string, request: AuditRequestInput): Promise<void> {
  startAuditRun(id);

  try {
    const targetCrawl = await crawlDomain(request.targetUrl, request.maxPages, true);
    const competitorPagesByDomain: Record<string, Awaited<ReturnType<typeof crawlDomain>>["pages"]> = {};

    for (const competitorUrl of request.competitorUrls) {
      const crawl = await crawlDomain(competitorUrl, MAX_COMPETITOR_PAGES, false);
      competitorPagesByDomain[new URL(competitorUrl).hostname] = crawl.pages;
    }

    const previousReport = findPreviousCompletedRun(request.targetUrl, id);
    const report = buildAuditReport({
      runId: id,
      request,
      targetPages: targetCrawl.pages,
      competitorPagesByDomain,
      previousReport,
    });

    completeAuditRun(id, toSummary(report), report);
  } catch (error) {
    failAuditRun(id, error instanceof Error ? error.message : "Ukjent feil under analyse");
  }
}

function toSummary(report: AuditReport) {
  return {
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
