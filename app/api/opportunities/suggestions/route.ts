import { NextRequest, NextResponse } from "next/server";
import { generateAidarSuggestions } from "@/lib/aidar";
import { generatePerformanceInsights } from "@/lib/performance-insights";
import { findCanonicalPageUrl, findLatestPageContext, getGa4MetricsForPage, getGscMetricsForPage, getTopQueriesForPage } from "@/lib/db";
import {
  buildPageSearchInsights,
} from "@/lib/meta-suggestions";
import type { PagePerformanceMetrics, SearchIntent } from "@/lib/types";
import { unique } from "@/lib/utils";

export const dynamic = "force-dynamic";

type PageIntent =
  | "contact" | "about" | "menu" | "booking" | "event"
  | "location" | "home" | "gallery" | "news" | "generic";

const INTENT_PATTERNS: [RegExp, PageIntent][] = [
  [/kontakt|contact/i, "contact"],
  [/om-oss|about|om-/i, "about"],
  [/meny|menu|mat|food|drikke|drink/i, "menu"],
  [/reservasjon|bestill|booking|book|reserver/i, "booking"],
  [/arrangement|event|fest|julebord|bryllup|selskap/i, "event"],
  [/kart|finn-oss|veibeskrivelse|adresse|location/i, "location"],
  [/galleri|bilder|foto|gallery/i, "gallery"],
  [/nyheter|blogg|news|aktuelt/i, "news"],
];

function detectIntent(path: string): PageIntent {
  if (path === "/" || path === "") return "home";
  for (const [pattern, intent] of INTENT_PATTERNS) {
    if (pattern.test(path)) return intent;
  }
  return "generic";
}

function slugToWords(path: string): string[] {
  return path
    .replace(/^\/|\/$/g, "")
    .split(/[-_/]/)
    .filter((w) => w.length > 2);
}

function titleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function detectSearchIntent(path: string, queryText: string): SearchIntent {
  const normalizedPath = path.toLowerCase();
  const textContext = `${path} ${queryText}`.toLowerCase();

  const transactionalPaths = ["/meny", "/booking", "/bestill", "/kontakt", "/handlekurv", "/kasse", "/checkout", "/reserver", "/tilbud", "/shop"];
  const transactionalKeywords = ["kjøp", "bestill", "book", "reserver", "meny", "kontakt oss", "add to cart", "prisliste", "booking", "reservasjon", "kontakt"];

  if (transactionalPaths.some((candidate) => normalizedPath.includes(candidate)) || transactionalKeywords.some((keyword) => textContext.includes(keyword))) {
    return "transactional";
  }

  const commercialPaths = ["/priser", "/pakker", "/selskapslokale", "/tjenester", "/produkter", "/løsninger", "/referanser", "/casestudies"];
  const commercialKeywords = ["beste", "test", "pris", "sammenlign", "erfaringer", "anmeldelser", "vs", "vs.", "hvilken bør jeg velge", "alternativ"];

  if (commercialPaths.some((candidate) => normalizedPath.includes(candidate)) || commercialKeywords.some((keyword) => textContext.includes(keyword))) {
    return "commercial investigation";
  }

  const navigationalPaths = ["/logg-inn", "/login", "/minside", "/dashboard", "/konto", "/hjem", "/home"];
  const navigationalKeywords = ["logg inn", "min side", "logg ut", "brukerstøtte"];

  if (navigationalPaths.some((candidate) => normalizedPath.includes(candidate)) || navigationalKeywords.some((keyword) => textContext.includes(keyword))) {
    return "navigational";
  }

  return "informational";
}

function extractKeyword(path: string, pageTitle?: string, h1?: string): string {
  const visibleCandidates = [h1, pageTitle]
    .filter(Boolean)
    .map((value) => value!.replace(/\s+[|\-–:].*$/, "").trim())
    .filter(Boolean);
  const pathSegments = path
    .split("/")
    .filter((segment) => segment.length > 3)
    .filter((segment) => !/(kontakt|contact|about|om-oss|meny|menu|book|booking)/i.test(segment));
  const candidate = pathSegments[pathSegments.length - 1]?.replace(/[-_]/g, " ");
  if (candidate) {
    const slugKeyword = titleCase(candidate);
    const normalizedSlug = slugKeyword
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2)
      .join(" ");
    const visibleMatch = visibleCandidates.find((value) => {
      const normalizedVisible = value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2)
        .join(" ");
      return normalizedVisible === normalizedSlug || normalizedVisible.includes(normalizedSlug);
    });
    return visibleMatch || slugKeyword;
  }
  return titleCase(h1 || pageTitle || "Denne siden");
}

/**
 * A query is "on-brand" if it contains at least one word that matches the
 * brand name OR a word from the URL slug. This filters out queries where
 * users searched for competitors but happened to land on this page.
 */
function isOnBrand(
  query: string,
  brandWords: string[],
  slugWords: string[],
): boolean {
  const qWords = query.toLowerCase().split(/\s+/);
  const relevantWords = [...brandWords, ...slugWords].map((w) => w.toLowerCase());
  return qWords.some((qw) =>
    relevantWords.some((rw) => rw.length > 2 && (qw.includes(rw) || rw.includes(qw)))
  );
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function resolvePageIdentifiers(pageUrl: string, targetUrl: string | null): {
  absolutePageUrl: string | null;
  path: string;
  hostname: string | null;
  absoluteCandidates: string[];
  pathCandidates: string[];
} {
  const parse = (value: string): URL | null => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  };

  const parsedPageUrl = parse(pageUrl);
  const parsedTargetUrl = targetUrl ? parse(targetUrl) : null;
  const resolved = parsedPageUrl ?? (parsedTargetUrl ? parse(pageUrl.startsWith("/") ? new URL(pageUrl, parsedTargetUrl).toString() : pageUrl) : null);
  const path = resolved?.pathname ?? pageUrl;

  return {
    absolutePageUrl: resolved?.toString() ?? null,
    path,
    hostname: resolved?.hostname.replace(/^www\./, "") ?? parsedTargetUrl?.hostname.replace(/^www\./, "") ?? null,
    absoluteCandidates: uniqueValues([resolved?.toString(), parsedPageUrl?.toString(), parsedTargetUrl ? new URL(path, parsedTargetUrl).toString() : null]),
    pathCandidates: uniqueValues([path, pageUrl]),
  };
}

function mergeCandidateUrls(
  identifiers: ReturnType<typeof resolvePageIdentifiers>,
  inferredAbsolutePageUrl: string | null,
): ReturnType<typeof resolvePageIdentifiers> {
  if (!inferredAbsolutePageUrl) {
    return identifiers;
  }

  const parsed = (() => {
    try {
      return new URL(inferredAbsolutePageUrl);
    } catch {
      return null;
    }
  })();

  if (!parsed) {
    return identifiers;
  }

  return {
    absolutePageUrl: identifiers.absolutePageUrl ?? parsed.toString(),
    path: identifiers.path || parsed.pathname,
    hostname: identifiers.hostname ?? parsed.hostname.replace(/^www\./, ""),
    absoluteCandidates: uniqueValues([parsed.toString(), ...identifiers.absoluteCandidates]),
    pathCandidates: uniqueValues([parsed.pathname, ...identifiers.pathCandidates]),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pageUrl = searchParams.get("pageUrl");
  const domain = searchParams.get("domain");
  const targetUrl = searchParams.get("targetUrl");

  if (!pageUrl || !domain) {
    return NextResponse.json({ error: "pageUrl and domain required" }, { status: 400 });
  }

  const initialIdentifiers = resolvePageIdentifiers(pageUrl, targetUrl);
  const inferredAbsolutePageUrl =
    !initialIdentifiers.absoluteCandidates.length && initialIdentifiers.path
      ? findCanonicalPageUrl(domain, initialIdentifiers.path)
      : null;
  const identifiers = mergeCandidateUrls(initialIdentifiers, inferredAbsolutePageUrl);
  const path = identifiers.path;
  const hostname = identifiers.hostname ?? domain;

  // Brand words = words from the hostname (e.g. "sjoholmencafe" → ["sjoholmen", "cafe"] via splitting on the TLD)
  const brandRaw = hostname.split(".")[0]; // e.g. "sjoholmencafe"
  // Also try the domain name as provided (which might be a display name like "Sjøholmen")
  const domainDisplayWords = domain.toLowerCase().split(/[\s-_]+/).filter((w) => w.length > 2);
  // Split hostname on common Norwegian cafe/restaurant words to get brand tokens
  const brandWords = [
    brandRaw,
    ...brandRaw.split(/(?=cafe|kafe|restaurant|bar|bistro|terrasse|selskapslokale|events?)/).filter((w) => w.length > 2),
    ...domainDisplayWords,
  ];

  const slugWords = slugToWords(path);
  const brand = titleCase(brandRaw.replace(/(cafe|kafe|restaurant|bar|bistro|no)$/i, "").trim() || brandRaw);
  const intent = detectIntent(path);

  const gscPageKey = identifiers.absoluteCandidates.find((candidate) => getTopQueriesForPage(domain, candidate, 28, 1).length > 0)
    ?? identifiers.absoluteCandidates[0]
    ?? pageUrl;
  const pageContextKey = identifiers.absoluteCandidates.find((candidate) => {
    const context = findLatestPageContext(candidate);
    return context.page || context.suggestion;
  }) ?? identifiers.absoluteCandidates[0] ?? pageUrl;

  // Get all queries for this page, then filter to on-brand only
  const rawQueries = getTopQueriesForPage(domain, gscPageKey, 28, 30);
  const brandedQueries = rawQueries.filter((q) =>
    isOnBrand(q.query, brandWords, slugWords)
  );

  const topQueries = (brandedQueries.length ? brandedQueries : rawQueries).slice(0, 5);

  // Use display name from domain param as brand (it's set by user e.g. "Sjøholmen")
  const displayBrand = titleCase(domain.split(/[\s-_]+/)[0]);
  const { page, suggestion } = findLatestPageContext(pageContextKey);
  const searchIntent = detectSearchIntent(path, topQueries.map((item) => item.query).join(" "));
  const keyword = extractKeyword(path, page?.title ?? suggestion?.current.metaTitle, page?.h1 ?? suggestion?.current.h1);
  const gscMetrics = identifiers.absoluteCandidates
    .map((candidate) => getGscMetricsForPage(domain, candidate, 28))
    .find((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    ?? null;
  const ga4Metrics = identifiers.pathCandidates
    .map((candidate) => getGa4MetricsForPage(domain, candidate, 28))
    .find((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    ?? null;
  const metrics: PagePerformanceMetrics | null = gscMetrics || ga4Metrics
    ? {
        impressions: gscMetrics?.impressions ?? 0,
        clicks: gscMetrics?.clicks ?? 0,
        ctr: gscMetrics?.ctr ?? 0,
        position: gscMetrics?.position ?? 0,
        sessions: ga4Metrics?.sessions ?? 0,
        conversions: ga4Metrics?.conversions ?? 0,
        conversionRate: ga4Metrics?.sessions ? ga4Metrics.conversions / ga4Metrics.sessions : 0,
        bounceRate: ga4Metrics?.bounceRate ?? 0,
      }
    : null;
  const searchInsights = buildPageSearchInsights({
    page,
    domain,
    intent: searchIntent,
    keyword,
    brand: displayBrand,
    queries: topQueries,
    metrics,
  });

  const aidar = await generateAidarSuggestions(
    {
      page,
      domain,
      intent: searchIntent,
      keyword,
      brand: displayBrand,
      queries: topQueries,
      metrics,
      searchInsights,
    },
  );

  return NextResponse.json({
    pageUrl: identifiers.absolutePageUrl ?? pageUrl,
    slugLabel: path === "/" ? "forsiden" : path.replace(/^\/|\/$/g, ""),
    intent,
    brandWords: brandWords.slice(0, 5),
    slugWords,
    topQueries: rawQueries.slice(0, 5),
    brandedQueries: brandedQueries.slice(0, 5),
    audience: searchInsights?.audience ?? null,
    performanceConclusions: searchInsights?.performanceConclusions ?? generatePerformanceInsights(metrics),
    contentHighlights: searchInsights?.contentHighlights ?? [],
    contentGaps: unique([...(searchInsights?.contentGaps ?? []), ...aidar.contentRecommendations]).slice(0, 5),
    agent: {
      name: aidar.agentName,
      mode: aidar.mode,
      model: aidar.model,
      notes: aidar.notes,
    },
    suggestions: {
      titles: aidar.titles.slice(0, 3),
      metaDescriptions: aidar.metaDescriptions.slice(0, 2),
      titleOptions: aidar.titleOptions.slice(0, 3),
      metaDescriptionOptions: aidar.metaDescriptionOptions.slice(0, 2),
    },
  });
}
