import { describe, expect, it } from "vitest";

import { buildAuditReport } from "@/lib/analyzer";
import type { AuditRequestInput, PageSnapshot } from "@/lib/types";

const request: AuditRequestInput = {
  targetUrl: "https://example.no",
  locale: "nb-NO",
  country: "NO",
  competitorUrls: [],
  maxPages: 20,
};

function createPage(overrides: Partial<PageSnapshot>): PageSnapshot {
  return {
    url: "https://example.no/",
    path: "/",
    discoveredFrom: "seed",
    statusCode: 200,
    contentType: "text/html",
    canonicalUrl: "https://example.no/",
    robotsMeta: [],
    xRobotsTag: [],
    title: "Eksempelside for AI SEO audit",
    metaDescription: "Beskrivelse som er lang nok til å telle som komplett metadata.",
    h1: "Hva er AI SEO audit?",
    headings: ["Hva er AI SEO audit?", "Hvorfor er det viktig?"],
    firstParagraph:
      "AI SEO audit er en analyse som måler hvor lett innholdet ditt kan forstås, siteres og indekseres av både søkemotorer og AI-assistenter.",
    bodyText:
      "AI SEO audit er en analyse som måler hvor lett innholdet ditt kan forstås, siteres og indekseres av både søkemotorer og AI-assistenter. Her finner du en kort forklaring, punktlister, FAQ og tabeller som gjør innholdet enklere å bruke i zero-click-resultater.",
    rawHtmlBytes: 3_000,
    scriptCount: 2,
    wordCount: 180,
    paragraphCount: 4,
    listCount: 1,
    tableCount: 1,
    faqCount: 1,
    definitionLikeBlocks: 2,
    internalLinks: ["https://example.no/guide"],
    externalLinks: ["https://developers.google.com/search/docs/appearance/ai-features"],
    brokenInternalLinks: [],
    inboundLinks: 2,
    clickDepth: 1,
    schema: {
      types: ["Article", "FAQPage"],
      itemCount: 2,
      matchesVisibleContent: true,
      rawItems: [],
    },
    imagesWithoutAlt: 0,
    imageCount: 1,
    hasTranscriptSignals: true,
    author: "Ola Nordmann",
    publisher: "Eksempel AS",
    hasAboutLink: true,
    hasContactLink: true,
    datePublished: "2026-01-10T00:00:00.000Z",
    dateModified: "2026-03-01T00:00:00.000Z",
    snippetDirectives: {
      noSnippet: false,
      maxSnippet: null,
      dataNoSnippet: false,
    },
    robotsEvaluation: {
      generalAllowed: true,
      blockedProviders: [],
      blockedAgents: [],
    },
    blockedByRobots: false,
    noindex: false,
    rendering: {
      rawTextLength: 1_500,
      renderedTextLength: 1_600,
      renderDeltaRatio: 1.07,
      renderingModel: "ssr",
      extractedTextPreview:
        "AI SEO audit er en analyse som måler hvor lett innholdet ditt kan forstås, siteres og indekseres ...",
      errors: [],
    },
    answerFirstSignals: {
      conciseOpening: true,
      hasFaq: true,
      hasTable: true,
      hasList: true,
      directAnswerLikelihood: 90,
    },
    ...overrides,
  };
}

describe("buildAuditReport", () => {
  it("scorer SSR/answer-first bedre enn CSR med tom initial HTML", () => {
    const strongPage = createPage({});
    const weakPage = createPage({
      url: "https://example.no/csr",
      path: "/csr",
      title: "CSR side",
      h1: "CSR side",
      firstParagraph: "",
      bodyText: "Kort tekst.",
      rawHtmlBytes: 500,
      scriptCount: 18,
      wordCount: 20,
      listCount: 0,
      tableCount: 0,
      faqCount: 0,
      schema: { types: [], itemCount: 0, matchesVisibleContent: true, rawItems: [] },
      author: null,
      publisher: null,
      hasAboutLink: false,
      hasContactLink: false,
      datePublished: null,
      dateModified: null,
      rendering: {
        rawTextLength: 30,
        renderedTextLength: 900,
        renderDeltaRatio: 30,
        renderingModel: "csr",
        extractedTextPreview: "Rendret i klienten",
        errors: [],
      },
      answerFirstSignals: {
        conciseOpening: false,
        hasFaq: false,
        hasTable: false,
        hasList: false,
        directAnswerLikelihood: 15,
      },
    });

    const strongReport = buildAuditReport({
      runId: "strong",
      request,
      targetPages: [strongPage],
      competitorPagesByDomain: {},
      previousReport: null,
    });
    const weakReport = buildAuditReport({
      runId: "weak",
      request,
      targetPages: [weakPage],
      competitorPagesByDomain: {},
      previousReport: null,
    });

    expect(strongReport.totalScore).toBeGreaterThan(weakReport.totalScore);
    expect(
      strongReport.categoryScores.find((item) => item.id === "renderingAiAccessibility")?.score,
    ).toBeGreaterThan(
      weakReport.categoryScores.find((item) => item.id === "renderingAiAccessibility")?.score ?? 0,
    );
  });

  it("gir provider-spesifikke varsler når OpenAI/Bing blokkeres", () => {
    const blockedPage = createPage({
      robotsEvaluation: {
        generalAllowed: true,
        blockedProviders: ["openai", "bing"],
        blockedAgents: ["OAI-SearchBot", "bingbot"],
      },
    });

    const report = buildAuditReport({
      runId: "blocked",
      request,
      targetPages: [blockedPage],
      competitorPagesByDomain: {},
      previousReport: null,
    });

    expect(report.providerScores.find((item) => item.provider === "openai")?.blockers.join(" ")).toContain(
      "Robots-regler blokkerer",
    );
    expect(report.providerScores.find((item) => item.provider === "bing")?.blockers.join(" ")).toContain(
      "Robots-regler blokkerer",
    );
  });

  it("flagger schema-avvik som risiko for Google/Gemini", () => {
    const mismatchPage = createPage({
      schema: {
        types: ["Article"],
        itemCount: 1,
        matchesVisibleContent: false,
        rawItems: [],
      },
    });

    const report = buildAuditReport({
      runId: "schema",
      request,
      targetPages: [mismatchPage],
      competitorPagesByDomain: {},
      previousReport: null,
    });

    expect(report.issues.some((issue) => issue.id === "schema-mismatch")).toBe(true);
    expect(report.providerScores.find((item) => item.provider === "google")?.blockers.join(" ")).toContain(
      "Schema og synlig innhold",
    );
  });

  it("finner konkurransegap når konkurrenter dekker mer og svarer raskere", () => {
    const targetPage = createPage({
      answerFirstSignals: {
        conciseOpening: false,
        hasFaq: false,
        hasTable: false,
        hasList: false,
        directAnswerLikelihood: 30,
      },
      schema: { types: [], itemCount: 0, matchesVisibleContent: true, rawItems: [] },
      dateModified: "2024-01-01T00:00:00.000Z",
      datePublished: "2024-01-01T00:00:00.000Z",
    });
    const competitorPage = createPage({
      url: "https://konkurrent.no/guide",
      path: "/guide",
      answerFirstSignals: {
        conciseOpening: true,
        hasFaq: true,
        hasTable: true,
        hasList: true,
        directAnswerLikelihood: 95,
      },
      schema: { types: ["Article", "FAQPage"], itemCount: 2, matchesVisibleContent: true, rawItems: [] },
      dateModified: "2026-03-10T00:00:00.000Z",
      datePublished: "2026-03-10T00:00:00.000Z",
    });

    const report = buildAuditReport({
      runId: "competition",
      request: { ...request, competitorUrls: ["https://konkurrent.no"] },
      targetPages: [targetPage],
      competitorPagesByDomain: {
        "konkurrent.no": [competitorPage, createPage({ url: "https://konkurrent.no/faq", path: "/faq" })],
      },
      previousReport: null,
    });

    expect(report.competitiveContext?.gaps.length).toBeGreaterThan(0);
    expect(report.competitiveContext?.gaps.some((gap) => gap.gapType === "answer-first-gap")).toBe(true);
  });
});
