import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  completeAuditRun,
  createAuditRun,
  getAuditReport,
  getAuditRun,
  recoverStaleAuditRuns,
  startAuditRun,
  updateAuditProgress,
} from "@/lib/db";
import type { AuditReport, AuditRequestInput, AuditRunSummary } from "@/lib/types";
import { auditRequestSchema } from "@/lib/validation";

const request: AuditRequestInput = {
  mode: "domain",
  targetUrl: "https://example.no",
  locale: "nb-NO",
  country: "NO",
  competitorUrls: [],
  maxPages: 150,
};

describe("auditRequestSchema", () => {
  it("avviser ikke-http urler og tillater høyere maxPages", () => {
    expect(() =>
      auditRequestSchema.parse({
        ...request,
        targetUrl: "ftp://example.no",
      }),
    ).toThrow();

    const parsed = auditRequestSchema.parse({
      ...request,
      maxPages: 500,
    });

    expect(parsed.maxPages).toBe(500);
  });

  it("støtter page mode med én konkret URL", () => {
    const parsed = auditRequestSchema.parse({
      mode: "page",
      targetUrl: "https://example.no/tryllekunstner",
      locale: "nb-NO",
      country: "NO",
    });

    expect(parsed.mode).toBe("page");
    expect(parsed.maxPages).toBe(1);
    expect(parsed.competitorUrls).toEqual([]);
  });
});

describe("db audit lifecycle", () => {
  it("markerer stale running-jobber som feilet ved recovery", () => {
    const id = `recovery-${randomUUID()}`;
    createAuditRun(id, request);
    startAuditRun(id);
    updateAuditProgress(id, {
      phase: "crawling",
      message: "Crawler...",
      percent: 40,
      pagesDiscovered: 10,
      pagesCrawled: 5,
      pagesTarget: 150,
      competitorsCompleted: 0,
      competitorsTotal: 0,
      estimatedSecondsRemaining: 60,
      lastUpdatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    });

    const recovered = recoverStaleAuditRuns(new Date("2026-01-01T00:20:00.000Z"));
    const run = getAuditRun(id);

    expect(recovered).toBeGreaterThanOrEqual(1);
    expect(run?.status).toBe("failed");
  });

  it("lagrer en slanket rapport uten full bodyText", () => {
    const id = `storage-${randomUUID()}`;
    createAuditRun(id, request);

    const report: AuditReport = {
      runId: id,
      request,
      generatedAt: new Date().toISOString(),
      totalScore: 80,
      summary: "Kort oppsummering",
      indexNowStatus: "unknown",
      categoryScores: [],
      providerScores: [],
      issues: [],
      recommendations: [],
      pages: [
        {
          url: "https://example.no/",
          path: "/",
          discoveredFrom: "seed",
          statusCode: 200,
          contentType: "text/html",
          canonicalUrl: "https://example.no/",
          robotsMeta: [],
          xRobotsTag: [],
          xIndexNowKey: null,
          title: "Tittel",
          metaDescription: "Beskrivelse",
          h1: "Overskrift",
          headings: [],
          firstParagraph: "Kort ingress",
          bodyText: "x".repeat(2000),
          rawHtmlBytes: 2000,
          scriptCount: 0,
          wordCount: 400,
          paragraphCount: 5,
          listCount: 1,
          tableCount: 0,
          faqCount: 0,
          definitionLikeBlocks: 0,
          internalLinks: [],
          externalLinks: [],
          brokenInternalLinks: [],
          inboundLinks: 0,
          clickDepth: 1,
          schema: { types: [], itemCount: 0, matchesVisibleContent: true, rawItems: [] },
          imagesWithoutAlt: 0,
          imageCount: 0,
          hasTranscriptSignals: false,
          author: null,
          publisher: null,
          hasAboutLink: false,
          hasContactLink: false,
          datePublished: null,
          dateModified: null,
          snippetDirectives: { noSnippet: false, maxSnippet: null, dataNoSnippet: false },
          robotsEvaluation: { generalAllowed: true, blockedProviders: [], blockedAgents: [] },
          blockedByRobots: false,
          noindex: false,
          rendering: {
            rawTextLength: 2000,
            renderedTextLength: 2000,
            renderDeltaRatio: 1,
            renderingModel: "ssr",
            extractedTextPreview: "y".repeat(800),
            errors: [],
          },
          answerFirstSignals: {
            conciseOpening: true,
            hasFaq: false,
            hasTable: false,
            hasList: false,
            directAnswerLikelihood: 80,
          },
        },
      ],
      pageSuggestions: [],
      pageReport: null,
      topicClusters: [],
      competitiveContext: null,
      comparison: {
        previousRunId: null,
        totalScoreDelta: null,
        categoryDeltas: [],
      },
    };
    const summary: AuditRunSummary = {
      mode: "domain",
      totalScore: 80,
      categoryScores: [],
      providerScores: [],
      totalPages: 1,
      issueCount: 0,
      targetUrl: request.targetUrl,
    };

    completeAuditRun(id, summary, report);
    const stored = getAuditReport(id);

    expect(stored?.pages[0]?.bodyText.length).toBeLessThan(500);
    expect(stored?.pages[0]?.rendering.extractedTextPreview.length).toBeLessThan(300);
  });
});
