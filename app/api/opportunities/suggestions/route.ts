import { NextRequest, NextResponse } from "next/server";
import { findLatestPageContext, getGa4MetricsForPage, getGscMetricsForPage, getTopQueriesForPage } from "@/lib/db";
import {
  buildAudienceAwareDescriptions,
  buildAudienceAwareTitles,
  buildPageSearchInsights,
} from "@/lib/meta-suggestions";
import type { PagePerformanceMetrics, SearchIntent } from "@/lib/types";

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
  const haystack = `${path} ${queryText}`.toLowerCase();
  if (/(pris|priser|bestill|booking|book|reservasjon|kontakt)/i.test(haystack)) {
    return "transactional";
  }
  if (/(vs|beste|alternativ|sammenlign|review|hva bør du velge)/i.test(haystack)) {
    return "commercial investigation";
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pageUrl = searchParams.get("pageUrl");
  const domain = searchParams.get("domain");

  if (!pageUrl || !domain) {
    return NextResponse.json({ error: "pageUrl and domain required" }, { status: 400 });
  }

  const path = (() => { try { return new URL(pageUrl).pathname; } catch { return pageUrl; } })();
  const hostname = (() => { try { return new URL(pageUrl).hostname.replace(/^www\./, ""); } catch { return domain; } })();

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

  // Get all queries for this page, then filter to on-brand only
  const rawQueries = getTopQueriesForPage(domain, pageUrl, 28, 30);
  const brandedQueries = rawQueries.filter((q) =>
    isOnBrand(q.query, brandWords, slugWords)
  );

  const topQueries = brandedQueries.slice(0, 5);

  // Use display name from domain param as brand (it's set by user e.g. "Sjøholmen")
  const displayBrand = titleCase(domain.split(/[\s-_]+/)[0]);
  const { page, suggestion } = findLatestPageContext(pageUrl);
  const searchIntent = detectSearchIntent(path, topQueries.map((item) => item.query).join(" "));
  const keyword = extractKeyword(path, page?.title ?? suggestion?.current.metaTitle, page?.h1 ?? suggestion?.current.h1);
  const gscMetrics = getGscMetricsForPage(domain, pageUrl, 28);
  const ga4Metrics = getGa4MetricsForPage(domain, pageUrl, 28);
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

  const titles = buildAudienceAwareTitles(
    {
      page,
      domain,
      intent: searchIntent,
      keyword,
      brand: displayBrand,
      queries: topQueries,
      metrics,
    },
    searchInsights,
  );
  const metaDescriptions = buildAudienceAwareDescriptions(
    {
      page,
      domain,
      intent: searchIntent,
      keyword,
      brand: displayBrand,
      queries: topQueries,
      metrics,
    },
    searchInsights,
  );

  return NextResponse.json({
    pageUrl,
    intent,
    brandWords: brandWords.slice(0, 5),
    slugWords,
    topQueries: rawQueries.slice(0, 5),      // show all top queries for reference
    brandedQueries: topQueries,               // only on-brand ones used for suggestions
    audience: searchInsights?.audience ?? null,
    contentHighlights: searchInsights?.contentHighlights ?? [],
    contentGaps: searchInsights?.contentGaps ?? [],
    suggestions: {
      titles: titles.slice(0, 3),
      metaDescriptions: metaDescriptions.slice(0, 2),
    },
  });
}
