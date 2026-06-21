import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  completeAuditRun,
  createAuditChangeEvent,
  createOpportunitySnapshot,
  createAuditRun,
  getAuditReport,
  getAuditRun,
  listAuditChangeEvents,
  listOpportunities,
  listOpportunitySnapshots,
  insertOpportunityItem,
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
      implementationPacks: [],
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

  it("logger endringer og bekrefter dem mot en nyere audit", () => {
    const firstId = `change-base-${randomUUID()}`;
    const secondId = `change-followup-${randomUUID()}`;
    const pageRequest: AuditRequestInput = {
      mode: "page",
      targetUrl: "https://example.no/tjeneste",
      locale: "nb-NO",
      country: "NO",
      competitorUrls: [],
      maxPages: 1,
    };

    createAuditRun(firstId, pageRequest);

    const baseReport: AuditReport = {
      runId: firstId,
      request: pageRequest,
      generatedAt: new Date().toISOString(),
      totalScore: 62,
      summary: "Base",
      indexNowStatus: "unknown",
      categoryScores: [],
      providerScores: [],
      issues: [],
      recommendations: [],
      pages: [
        {
          url: pageRequest.targetUrl,
          path: "/tjeneste",
          discoveredFrom: "seed",
          statusCode: 200,
          contentType: "text/html",
          canonicalUrl: pageRequest.targetUrl,
          robotsMeta: [],
          xRobotsTag: [],
          xIndexNowKey: null,
          title: "Gammel tittel",
          metaDescription: "Gammel beskrivelse.",
          h1: "Gammel H1",
          headings: [],
          firstParagraph: "Gammel åpning",
          bodyText: "Gammel åpning",
          rawHtmlBytes: 1000,
          scriptCount: 0,
          wordCount: 150,
          paragraphCount: 2,
          listCount: 0,
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
          hasContactLink: true,
          datePublished: null,
          dateModified: null,
          snippetDirectives: { noSnippet: false, maxSnippet: null, dataNoSnippet: false },
          robotsEvaluation: { generalAllowed: true, blockedProviders: [], blockedAgents: [] },
          blockedByRobots: false,
          noindex: false,
          rendering: {
            rawTextLength: 1000,
            renderedTextLength: 1000,
            renderDeltaRatio: 1,
            renderingModel: "ssr",
            extractedTextPreview: "preview",
            errors: [],
          },
          answerFirstSignals: {
            conciseOpening: true,
            hasFaq: false,
            hasTable: false,
            hasList: false,
            directAnswerLikelihood: 60,
          },
        },
      ],
      pageSuggestions: [],
      pageReport: {
        intent: { primary: "transactional" },
        searchInsights: null,
        metadataAgent: null,
        current: {
          url: pageRequest.targetUrl,
          title: "Gammel tittel",
          metaTitle: "Gammel tittel",
          metaDescription: "Gammel beskrivelse.",
          h1: "Gammel H1",
          opening: "Gammel åpning",
          schemaTypes: [],
          renderingModel: "ssr",
          answerScore: 60,
        },
        proposed: {
          metaTitle: "Ny tittel",
          metaDescription: "Ny beskrivelse med klar verdi.",
          h1: "Ny H1",
          opening: "Ny åpning",
          structure: [],
          sections: [],
          faq: [],
          cta: "Kontakt oss",
          schemaType: "Service",
          jsonLd: "{}",
        },
        changeSummary: [],
        priorityActions: [],
      },
      implementationPacks: [],
      topicClusters: [],
      competitiveContext: null,
      comparison: { previousRunId: null, totalScoreDelta: null, categoryDeltas: [] },
    };

    completeAuditRun(firstId, {
      mode: "page",
      totalScore: 62,
      categoryScores: [],
      providerScores: [],
      totalPages: 1,
      issueCount: 0,
      targetUrl: pageRequest.targetUrl,
    }, baseReport);

    const appliedAt = new Date("2026-02-01T10:00:00.000Z").toISOString();
    createAuditChangeEvent({
      id: `change-${randomUUID()}`,
      auditRunId: firstId,
      targetUrl: pageRequest.targetUrl,
      mode: "page",
      pageUrl: pageRequest.targetUrl,
      changeType: "page-report",
      changeTitle: "Sideforslag",
      changeSummary: "Ny metadata og åpning publisert",
      baseline: {
        url: pageRequest.targetUrl,
        h1: "Gammel H1",
        opening: "Gammel åpning",
        metaTitle: "Gammel tittel",
        metaDescription: "Gammel beskrivelse.",
        schemaTypes: [],
      },
      expected: {
        url: pageRequest.targetUrl,
        h1: "Ny H1",
        opening: "Ny åpning",
        metaTitle: "Ny tittel",
        metaDescription: "Ny beskrivelse med klar verdi.",
        schemaTypes: ["Service"],
      },
      notes: "Publisert i CMS",
      appliedAt,
    });

    createAuditRun(secondId, pageRequest);
    const followUpReport: AuditReport = {
      ...baseReport,
      runId: secondId,
      generatedAt: new Date("2026-02-03T10:00:00.000Z").toISOString(),
      totalScore: 74,
      pages: [
        {
          ...baseReport.pages[0]!,
          title: "Ny tittel",
          metaDescription: "Ny beskrivelse med klar verdi.",
          h1: "Ny H1",
          firstParagraph: "Ny åpning",
          schema: { types: ["Service"], itemCount: 1, matchesVisibleContent: true, rawItems: [] },
        },
      ],
      pageReport: {
        ...baseReport.pageReport!,
        current: {
          ...baseReport.pageReport!.current,
          metaTitle: "Ny tittel",
          metaDescription: "Ny beskrivelse med klar verdi.",
          h1: "Ny H1",
          opening: "Ny åpning",
          schemaTypes: ["Service"],
        },
      },
    };

    completeAuditRun(secondId, {
      mode: "page",
      totalScore: 74,
      categoryScores: [],
      providerScores: [],
      totalPages: 1,
      issueCount: 0,
      targetUrl: pageRequest.targetUrl,
    }, followUpReport);

    const entries = listAuditChangeEvents(pageRequest.targetUrl, "page");

    expect(entries[0]?.evaluation.status).toBe("confirmed");
    expect(entries[0]?.evaluation.matchedFields).toContain("metaDescription");
    expect(entries[0]?.evaluation.scoreDelta).toBe(12);
  });

  it("viser bare nyeste opportunity-snapshot i feeden, men beholder historikken", () => {
    const domain = `snapshot-test-${randomUUID()}`;
    const firstSnapshot = createOpportunitySnapshot(domain, 1);
    insertOpportunityItem({
      snapshotId: firstSnapshot,
      sortScore: 1200,
      domain,
      targetUrl: `https://${domain}.no`,
      pageUrl: `https://${domain}.no/test`,
      query: null,
      queryCluster: null,
      type: "high-impressions-low-ctr",
      priority: "high",
      title: "Gammelt snapshot",
      evidence: {},
      recommendedAction: "Gammelt tiltak",
      expectedImpact: "Gammel effekt",
      implementationPackId: null,
      status: "open",
    });

    const secondSnapshot = createOpportunitySnapshot(domain, 1);
    insertOpportunityItem({
      snapshotId: secondSnapshot,
      sortScore: 5200,
      domain,
      targetUrl: `https://${domain}.no`,
      pageUrl: `https://${domain}.no/test`,
      query: null,
      queryCluster: null,
      type: "high-impressions-low-ctr",
      priority: "critical",
      title: "Nytt snapshot",
      evidence: {},
      recommendedAction: "Nytt tiltak",
      expectedImpact: "Ny effekt",
      implementationPackId: null,
      status: "open",
    });

    const feed = listOpportunities({ domain, status: "open", limit: 20 });
    const history = listOpportunitySnapshots({ domain, limit: 10 });

    expect(feed.map((item) => item.title)).toContain("Nytt snapshot");
    expect(feed.map((item) => item.title)).not.toContain("Gammelt snapshot");
    expect(history.map((item) => item.id)).toContain(firstSnapshot);
    expect(history.map((item) => item.id)).toContain(secondSnapshot);
  });

  it("sorterer feeden etter sortScore før createdAt", () => {
    const domain = `sortscore-test-${randomUUID()}`;
    const snapshotId = createOpportunitySnapshot(domain, 2);

    insertOpportunityItem({
      snapshotId,
      sortScore: 1800,
      domain,
      targetUrl: `https://${domain}.no`,
      pageUrl: `https://${domain}.no/near-page-one`,
      query: null,
      queryCluster: null,
      type: "near-page-one",
      priority: "critical",
      title: "Kritisk men lavere score",
      evidence: {},
      recommendedAction: "Tiltak A",
      expectedImpact: "Effekt A",
      implementationPackId: null,
      status: "open",
    });

    insertOpportunityItem({
      snapshotId,
      sortScore: 5300,
      domain,
      targetUrl: `https://${domain}.no`,
      pageUrl: `https://${domain}.no/cro`,
      query: null,
      queryCluster: null,
      type: "high-traffic-low-conversion",
      priority: "high",
      title: "Høyere sortScore",
      evidence: {},
      recommendedAction: "Tiltak B",
      expectedImpact: "Effekt B",
      implementationPackId: null,
      status: "open",
    });

    const feed = listOpportunities({ domain, status: "open", limit: 20 });

    expect(feed[0]?.title).toBe("Høyere sortScore");
    expect(feed[1]?.title).toBe("Kritisk men lavere score");
  });
});
