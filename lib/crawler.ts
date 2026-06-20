import { load } from "cheerio";
import { chromium } from "playwright";

import {
  COMPETITOR_CRAWL_CONCURRENCY,
  MAX_RENDER_CHECKS,
  PROVIDER_AGENTS,
  TARGET_CRAWL_CONCURRENCY,
} from "@/lib/config";
import { selectRenderCandidates } from "@/lib/crawler/render-strategy";
import { scoreAnswerQuality } from "@/lib/engines/answer-quality";
import type { IndexNowStatus, PageSnapshot, ProviderId, RobotsEvaluation } from "@/lib/types";
import { extractTextTokens, formatDate, normalizeUrl, sameHost, stripShortcodes, unique } from "@/lib/utils";

type CrawlQueueItem = {
  url: string;
  discoveredFrom: "seed" | "sitemap" | "internal";
  clickDepth: number;
};

type RobotsGroup = {
  agents: string[];
  rules: Array<{
    type: "allow" | "disallow";
    value: string;
  }>;
};

type ParsedRobots = {
  groups: RobotsGroup[];
  sitemaps: string[];
  raw: string | null;
};

export type CrawlResult = {
  pages: PageSnapshot[];
  robotsTxt: string | null;
  sitemapUrls: string[];
  blockedDiscoveredUrls: string[];
  crawlNotes: string[];
  indexNowStatus: IndexNowStatus;
};

export type CrawlProgressEvent = {
  phase: "discovering" | "crawling" | "rendering";
  message: string;
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesTarget: number;
};

export async function crawlDomain(
  targetUrl: string,
  maxPages: number,
  includeRenderChecks = true,
  onProgress?: (event: CrawlProgressEvent) => void,
): Promise<CrawlResult> {
  const seedUrl = normalizeUrl(targetUrl);
  const crawlNotes: string[] = [];
  onProgress?.({
    phase: "discovering",
    message: "Leser robots.txt og sitemap...",
    pagesDiscovered: 0,
    pagesCrawled: 0,
    pagesTarget: maxPages,
  });

  const robots = await fetchRobots(seedUrl);
  const sitemapUrls = await collectSitemapUrls(seedUrl, robots);
  const queue: CrawlQueueItem[] = [{ url: seedUrl, discoveredFrom: "seed", clickDepth: 0 }];
  const seen = new Set<string>([seedUrl]);
  const pageMap = new Map<string, PageSnapshot>();
  const discoveredButBlocked = new Set<string>();

  for (const sitemapUrl of sitemapUrls) {
    if (!sameHost(seedUrl, sitemapUrl)) {
      continue;
    }

    const normalized = normalizeUrl(sitemapUrl);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    queue.push({ url: normalized, discoveredFrom: "sitemap", clickDepth: 1 });
  }

  onProgress?.({
    phase: "crawling",
    message: "Crawler sider og henter metadata...",
    pagesDiscovered: seen.size,
    pagesCrawled: 0,
    pagesTarget: maxPages,
  });

  const concurrency = includeRenderChecks ? TARGET_CRAWL_CONCURRENCY : COMPETITOR_CRAWL_CONCURRENCY;
  const indexNowHeaderValues = new Set<string>();

  const worker = async () => {
    while (pageMap.size < maxPages) {
      const item = queue.shift();
      if (!item) {
        return;
      }

      const path = new URL(item.url).pathname;
      const robotsEvaluation = evaluateRobots(robots, path);

      if (!robotsEvaluation.generalAllowed) {
        discoveredButBlocked.add(item.url);
        pageMap.set(item.url, createBlockedSnapshot(item.url, item.discoveredFrom, item.clickDepth, robotsEvaluation));
        emitProgress(onProgress, seen.size, pageMap.size, maxPages);
        continue;
      }

      const response = await fetchPage(item.url);
      if (!response) {
        crawlNotes.push(`Klarte ikke å hente ${item.url}`);
        emitProgress(onProgress, seen.size, pageMap.size, maxPages);
        continue;
      }

      const indexNowHeader = response.headers.get("x-indexnow-key");
      if (indexNowHeader) {
        indexNowHeaderValues.add(indexNowHeader);
      }

      const snapshot = await extractPageSnapshot({
        url: item.url,
        discoveredFrom: item.discoveredFrom,
        clickDepth: item.clickDepth,
        html: response.html,
        statusCode: response.statusCode,
        contentType: response.contentType,
        headers: response.headers,
        robotsEvaluation,
      });

      pageMap.set(item.url, snapshot);

      if (snapshot.contentType?.includes("text/html")) {
        for (const link of snapshot.internalLinks) {
          if (!sameHost(seedUrl, link) || !isHtmlLikeUrl(link)) {
            continue;
          }

          const normalized = normalizeUrl(link);
          if (seen.has(normalized)) {
            continue;
          }

          seen.add(normalized);
          queue.push({
            url: normalized,
            discoveredFrom: "internal",
            clickDepth: item.clickDepth + 1,
          });
        }
      }

      emitProgress(onProgress, seen.size, pageMap.size, maxPages);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const pages = [...pageMap.values()];
  annotateLinkGraph(pages);

  if (includeRenderChecks) {
    onProgress?.({
      phase: "rendering",
      message: "Sammenligner rå HTML med rendret innhold...",
      pagesDiscovered: seen.size,
      pagesCrawled: pages.length,
      pagesTarget: maxPages,
    });
    await enrichRenderingSnapshots(pages);
  }

  return {
    pages,
    robotsTxt: robots.raw,
    sitemapUrls,
    blockedDiscoveredUrls: [...discoveredButBlocked],
    crawlNotes,
    indexNowStatus: await detectIndexNowStatus(seedUrl, indexNowHeaderValues),
  };
}

export async function crawlSinglePage(
  targetUrl: string,
  includeRenderChecks = true,
  onProgress?: (event: CrawlProgressEvent) => void,
): Promise<CrawlResult> {
  const seedUrl = normalizeUrl(targetUrl);
  const crawlNotes: string[] = [];

  onProgress?.({
    phase: "discovering",
    message: "Leser robots.txt og forbereder sideanalyse...",
    pagesDiscovered: 1,
    pagesCrawled: 0,
    pagesTarget: 1,
  });

  const robots = await fetchRobots(seedUrl);
  const robotsEvaluation = evaluateRobots(robots, new URL(seedUrl).pathname);

  if (!robotsEvaluation.generalAllowed) {
    const blockedPage = createBlockedSnapshot(seedUrl, "seed", 0, robotsEvaluation);
    return {
      pages: [blockedPage],
      robotsTxt: robots.raw,
      sitemapUrls: [],
      blockedDiscoveredUrls: [seedUrl],
      crawlNotes,
      indexNowStatus: await detectIndexNowStatus(seedUrl, new Set<string>()),
    };
  }

  onProgress?.({
    phase: "crawling",
    message: "Henter siden og analyserer metadata...",
    pagesDiscovered: 1,
    pagesCrawled: 0,
    pagesTarget: 1,
  });

  const response = await fetchPage(seedUrl);
  if (!response) {
    throw new Error("Klarte ikke å hente siden som skulle analyseres.");
  }

  const snapshot = await extractPageSnapshot({
    url: seedUrl,
    discoveredFrom: "seed",
    clickDepth: 0,
    html: response.html,
    statusCode: response.statusCode,
    contentType: response.contentType,
    headers: response.headers,
    robotsEvaluation,
  });

  const pages = [snapshot];
  annotateLinkGraph(pages);

  if (includeRenderChecks) {
    onProgress?.({
      phase: "rendering",
      message: "Sammenligner rå HTML med rendret innhold...",
      pagesDiscovered: 1,
      pagesCrawled: 1,
      pagesTarget: 1,
    });
    await enrichRenderingSnapshots(pages);
  }

  return {
    pages,
    robotsTxt: robots.raw,
    sitemapUrls: [],
    blockedDiscoveredUrls: [],
    crawlNotes,
    indexNowStatus: await detectIndexNowStatus(
      seedUrl,
      snapshot.xIndexNowKey ? new Set<string>([snapshot.xIndexNowKey]) : new Set<string>(),
    ),
  };
}

function emitProgress(
  onProgress: ((event: CrawlProgressEvent) => void) | undefined,
  pagesDiscovered: number,
  pagesCrawled: number,
  pagesTarget: number,
): void {
  onProgress?.({
    phase: "crawling",
    message: "Crawler sider og henter metadata...",
    pagesDiscovered,
    pagesCrawled,
    pagesTarget,
  });
}

async function detectIndexNowStatus(seedUrl: string, headerValues: Set<string>): Promise<IndexNowStatus> {
  if (headerValues.size > 0) {
    return "verified";
  }

  const configuredKey = process.env.INDEXNOW_KEY?.trim();
  if (!configuredKey) {
    return "unknown";
  }

  const candidateUrls = [
    new URL(`/${configuredKey}.txt`, seedUrl).toString(),
    new URL(`/.well-known/indexnow/${configuredKey}.txt`, seedUrl).toString(),
  ];

  for (const candidateUrl of candidateUrls) {
    try {
      const response = await fetch(candidateUrl, {
        headers: { "user-agent": "AI-SEO-Audit/0.1" },
        cache: "no-store",
      });
      if (!response.ok) {
        continue;
      }

      const body = (await response.text()).trim();
      if (body === configuredKey) {
        return "verified";
      }
    } catch {
      // Ignore failures and continue.
    }
  }

  return "not-detected";
}

function createBlockedSnapshot(
  url: string,
  discoveredFrom: "seed" | "sitemap" | "internal",
  clickDepth: number,
  robotsEvaluation: RobotsEvaluation,
): PageSnapshot {
  return {
    url,
    path: new URL(url).pathname,
    discoveredFrom,
    statusCode: null,
    contentType: null,
    canonicalUrl: null,
    robotsMeta: [],
    xRobotsTag: [],
    xIndexNowKey: null,
    title: "",
    metaDescription: "",
    h1: "",
    headings: [],
    firstParagraph: "",
    bodyText: "",
    rawHtmlBytes: 0,
    scriptCount: 0,
    wordCount: 0,
    paragraphCount: 0,
    listCount: 0,
    tableCount: 0,
    faqCount: 0,
    definitionLikeBlocks: 0,
    internalLinks: [],
    externalLinks: [],
    brokenInternalLinks: [],
    inboundLinks: 0,
    clickDepth,
    schema: {
      types: [],
      itemCount: 0,
      matchesVisibleContent: true,
      rawItems: [],
    },
    imagesWithoutAlt: 0,
    imageCount: 0,
    hasTranscriptSignals: false,
    author: null,
    publisher: null,
    hasAboutLink: false,
    hasContactLink: false,
    datePublished: null,
    dateModified: null,
    snippetDirectives: {
      noSnippet: false,
      maxSnippet: null,
      dataNoSnippet: false,
    },
    robotsEvaluation,
    blockedByRobots: true,
    noindex: false,
    rendering: {
      rawTextLength: 0,
      renderedTextLength: null,
      renderDeltaRatio: null,
      renderingModel: "unknown",
      extractedTextPreview: "",
      errors: [],
    },
    answerFirstSignals: {
      conciseOpening: false,
      hasFaq: false,
      hasTable: false,
      hasList: false,
      directAnswerLikelihood: 0,
    },
  };
}

async function fetchRobots(targetUrl: string): Promise<ParsedRobots> {
  const robotsUrl = new URL("/robots.txt", targetUrl).toString();

  try {
    const response = await fetch(robotsUrl, {
      headers: { "user-agent": "AI-SEO-Audit/0.1" },
      cache: "no-store",
    });

    if (!response.ok) {
      return { groups: [], sitemaps: [], raw: null };
    }

    const raw = await response.text();
    const groups: RobotsGroup[] = [];
    const sitemaps: string[] = [];
    let currentAgents: string[] = [];
    let currentRules: RobotsGroup["rules"] = [];

    const flush = () => {
      if (currentAgents.length) {
        groups.push({ agents: currentAgents, rules: currentRules });
      }
      currentAgents = [];
      currentRules = [];
    };

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const [directiveRaw, ...valueParts] = trimmed.split(":");
      const directive = directiveRaw.toLowerCase();
      const value = valueParts.join(":").trim();

      if (directive === "user-agent") {
        if (currentRules.length) {
          flush();
        }
        currentAgents.push(value.toLowerCase());
        continue;
      }

      if (directive === "allow" || directive === "disallow") {
        currentRules.push({ type: directive, value });
        continue;
      }

      if (directive === "sitemap") {
        try {
          sitemaps.push(new URL(value, targetUrl).toString());
        } catch {
          // Ignore malformed sitemap directives.
        }
      }
    }

    flush();
    return { groups, sitemaps: unique(sitemaps), raw };
  } catch {
    return { groups: [], sitemaps: [], raw: null };
  }
}

function getApplicableRules(robots: ParsedRobots, userAgent: string): RobotsGroup["rules"] {
  const normalized = userAgent.toLowerCase();
  const directMatches = robots.groups.filter((group) =>
    group.agents.some((agent) => normalized.includes(agent) || agent.includes(normalized)),
  );

  if (directMatches.length) {
    return directMatches.flatMap((group) => group.rules);
  }

  return robots.groups.filter((group) => group.agents.includes("*")).flatMap((group) => group.rules);
}

function pathMatches(ruleValue: string, path: string): boolean {
  if (!ruleValue) {
    return false;
  }

  const escaped = ruleValue
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$/g, "$");

  const regex = new RegExp(`^${escaped}`);
  return regex.test(path);
}

function isAllowedByRules(rules: RobotsGroup["rules"], path: string): boolean {
  let winner: { type: "allow" | "disallow"; length: number } | null = null;

  for (const rule of rules) {
    if (!pathMatches(rule.value, path)) {
      continue;
    }

    if (!winner || rule.value.length >= winner.length) {
      winner = { type: rule.type, length: rule.value.length };
    }
  }

  return winner ? winner.type === "allow" : true;
}

function evaluateRobots(robots: ParsedRobots, path: string): RobotsEvaluation {
  const blockedProviders: ProviderId[] = [];
  const blockedAgents: string[] = [];
  const generalAllowed = isAllowedByRules(getApplicableRules(robots, "*"), path);

  for (const [provider, agents] of Object.entries(PROVIDER_AGENTS) as Array<[ProviderId, string[]]>) {
    const isBlocked = agents.some((agent) => !isAllowedByRules(getApplicableRules(robots, agent), path));
    if (isBlocked) {
      blockedProviders.push(provider);
      blockedAgents.push(...agents);
    }
  }

  return {
    generalAllowed,
    blockedProviders: unique(blockedProviders),
    blockedAgents: unique(blockedAgents),
  };
}

async function collectSitemapUrls(targetUrl: string, robots: ParsedRobots): Promise<string[]> {
  const visited = new Set<string>();
  const collected = new Set<string>();
  const queue = [...robots.sitemaps];

  if (!queue.length) {
    queue.push(new URL("/sitemap.xml", targetUrl).toString());
  }

  while (queue.length) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) {
      continue;
    }
    visited.add(sitemapUrl);

    try {
      const response = await fetch(sitemapUrl, {
        headers: { "user-agent": "AI-SEO-Audit/0.1" },
        cache: "no-store",
      });

      if (!response.ok) {
        continue;
      }

      const xml = await response.text();
      const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/gsi)].map((match) => decodeXmlEntities(match[1].trim()));
      const isIndex = /<sitemapindex[\s>]/i.test(xml);

      for (const loc of locs) {
        if (isIndex && /\.(xml|xml\.gz)$/i.test(loc)) {
          queue.push(loc);
          continue;
        }

        try {
          collected.add(normalizeUrl(new URL(loc, targetUrl).toString()));
        } catch {
          // Ignore invalid sitemap URLs.
        }
      }
    } catch {
      // Ignore sitemap fetch failures.
    }
  }

  return [...collected];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchPage(url: string): Promise<{
  html: string;
  statusCode: number;
  contentType: string | null;
  headers: Headers;
} | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "AI-SEO-Audit/0.1" },
      redirect: "follow",
      cache: "no-store",
    });

    return {
      html: await response.text(),
      statusCode: response.status,
      contentType: response.headers.get("content-type"),
      headers: response.headers,
    };
  } catch {
    return null;
  }
}

async function extractPageSnapshot(input: {
  url: string;
  discoveredFrom: "seed" | "sitemap" | "internal";
  clickDepth: number;
  html: string;
  statusCode: number;
  contentType: string | null;
  headers: Headers;
  robotsEvaluation: RobotsEvaluation;
}): Promise<PageSnapshot> {
  const $ = load(input.html);
  const title = $("title").first().text().trim();
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const h1 = $("h1").first().text().trim();
  const headings = unique(
    $("h1, h2, h3")
      .toArray()
      .map((node) => $(node).text().trim())
      .filter(Boolean),
  );
  const paragraphs = $("p")
    .toArray()
    .map((node) => stripShortcodes($(node).text().replace(/\s+/g, " ").trim()))
    .filter(Boolean);
  const firstParagraph = paragraphs[0] ?? "";
  const listCount = $("ul, ol").length;
  const tableCount = $("table").length;
  const faqCount = $('[itemtype*="FAQPage"], [itemtype*="Question"]').length;
  const definitionLikeBlocks = $("dl").length + $("p, li").toArray().filter((node) => $(node).text().includes(":")).length;
  const canonicalHref = $('link[rel="canonical"]').attr("href");
  const canonicalUrl = canonicalHref ? new URL(canonicalHref, input.url).toString() : null;
  const robotsMeta = $('meta[name="robots"], meta[name="googlebot"], meta[name="bingbot"]')
    .toArray()
    .flatMap((node) => ($(node).attr("content") ?? "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const xRobotsTag = (input.headers.get("x-robots-tag") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const noindex = [...robotsMeta, ...xRobotsTag].some((value) => value.includes("noindex"));
  const links = $("a[href]")
    .toArray()
    .map((node) => $(node).attr("href") ?? "")
    .filter((href) => href && !href.startsWith("#") && !href.startsWith("mailto:") && !href.startsWith("tel:"));
  const resolvedLinks = links
    .map((href) => {
      try {
        return new URL(href, input.url).toString();
      } catch {
        return null;
      }
    })
    .filter((href): href is string => Boolean(href));
  const internalLinks = resolvedLinks.filter((href) => sameHost(input.url, href));
  const externalLinks = resolvedLinks.filter((href) => !sameHost(input.url, href));
  const scriptCount = $("script").length;
  const bodyClone = load(input.html);
  bodyClone("script, style, noscript, template").remove();
  const bodyText = stripShortcodes(bodyClone("body").text().replace(/\s+/g, " ").trim());
  const bodyTokens = extractTextTokens(bodyText);
  const images = $("img").toArray();
  const imagesWithoutAlt = images.filter((node) => !($(node).attr("alt") ?? "").trim()).length;
  const transcriptSignals =
    bodyText.toLowerCase().includes("transcript") ||
    bodyText.toLowerCase().includes("utskrift") ||
    $("track[kind='captions'], track[kind='subtitles']").length > 0;
  const schema = extractSchemaSummary($, bodyText, title, h1);
  const author =
    $('meta[name="author"]').attr("content")?.trim() ??
    $('[rel="author"]').first().text().trim() ??
    extractSchemaString(schema.rawItems, ["author.name", "author"]);
  const publisher =
    $('meta[property="og:site_name"]').attr("content")?.trim() ??
    extractSchemaString(schema.rawItems, ["publisher.name", "publisher"]);
  const hasAboutLink = $("a[href]")
    .toArray()
    .some((node) => {
      const text = ($(node).text() + ($(node).attr("href") ?? "")).toLowerCase();
      return text.includes("about") || text.includes("om");
    });
  const hasContactLink = $("a[href]")
    .toArray()
    .some((node) => {
      const text = ($(node).text() + ($(node).attr("href") ?? "")).toLowerCase();
      return text.includes("contact") || text.includes("kontakt");
    });
  const datePublished =
    formatDate($('meta[property="article:published_time"]').attr("content") ?? null) ??
    formatDate($("time[datetime]").first().attr("datetime") ?? null) ??
    extractSchemaString(schema.rawItems, ["datePublished"]);
  const dateModified =
    formatDate($('meta[property="article:modified_time"]').attr("content") ?? null) ??
    formatDate($("time[datetime]").last().attr("datetime") ?? null) ??
    extractSchemaString(schema.rawItems, ["dateModified"]);
  const dataNoSnippet = $("[data-nosnippet]").length > 0;
  const maxSnippetEntry = [...robotsMeta, ...xRobotsTag].find((value) => value.startsWith("max-snippet"));
  const maxSnippet = maxSnippetEntry ? Number(maxSnippetEntry.split(":")[1]) : null;

  return {
    url: input.url,
    path: new URL(input.url).pathname,
    discoveredFrom: input.discoveredFrom,
    statusCode: input.statusCode,
    contentType: input.contentType,
    canonicalUrl,
    robotsMeta,
    xRobotsTag,
    xIndexNowKey: input.headers.get("x-indexnow-key"),
    title,
    metaDescription,
    h1,
    headings,
    firstParagraph,
    bodyText,
    rawHtmlBytes: Buffer.byteLength(input.html, "utf8"),
    scriptCount,
    wordCount: bodyTokens.length,
    paragraphCount: paragraphs.length,
    listCount,
    tableCount,
    faqCount: Math.max(faqCount, schema.types.includes("FAQPage") ? 1 : 0),
    definitionLikeBlocks,
    internalLinks: unique(internalLinks.map((href) => normalizeUrl(href))),
    externalLinks: unique(externalLinks.map((href) => normalizeUrl(href))),
    brokenInternalLinks: [],
    inboundLinks: 0,
    clickDepth: input.clickDepth,
    schema,
    imagesWithoutAlt,
    imageCount: images.length,
    hasTranscriptSignals: transcriptSignals,
    author: author || null,
    publisher: publisher || null,
    hasAboutLink,
    hasContactLink,
    datePublished: formatDate(datePublished ?? null),
    dateModified: formatDate(dateModified ?? null),
    snippetDirectives: {
      noSnippet: [...robotsMeta, ...xRobotsTag].some((value) => value.includes("nosnippet")),
      maxSnippet: Number.isFinite(maxSnippet) ? maxSnippet : null,
      dataNoSnippet,
    },
    robotsEvaluation: input.robotsEvaluation,
    blockedByRobots: false,
    noindex,
    rendering: {
      rawTextLength: bodyText.length,
      renderedTextLength: null,
      renderDeltaRatio: null,
      renderingModel: estimateRenderingModel(bodyText.length, scriptCount),
      extractedTextPreview: bodyText.slice(0, 300),
      errors: [],
    },
    answerFirstSignals: {
      conciseOpening: firstParagraph.length >= 60 && firstParagraph.length <= 350,
      hasFaq: Math.max(faqCount, schema.types.includes("FAQPage") ? 1 : 0) > 0,
      hasTable: tableCount > 0,
      hasList: listCount > 0,
      directAnswerLikelihood: scoreAnswerQuality(firstParagraph, h1, headings, bodyText).score,
    },
  };
}

function extractSchemaSummary(
  $: ReturnType<typeof load>,
  bodyText: string,
  title: string,
  h1: string,
): PageSnapshot["schema"] {
  const rawItems: unknown[] = [];
  const scripts = $('script[type="application/ld+json"]')
    .toArray()
    .map((node) => $(node).html() ?? "");

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script);
      if (Array.isArray(parsed)) {
        rawItems.push(...parsed);
      } else {
        rawItems.push(parsed);
      }
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  const types = unique(
    rawItems.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const type = (item as { "@type"?: string | string[] })["@type"];
      if (Array.isArray(type)) {
        return type.map(String);
      }

      return type ? [String(type)] : [];
    }),
  );

  const visible = `${title} ${h1} ${bodyText}`.toLowerCase();
  const schemaMentions = rawItems.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const source = item as Record<string, unknown>;
    return [source.name, source.headline, source.description].filter((value): value is string => typeof value === "string");
  });

  const matchesVisibleContent =
    !schemaMentions.length ||
    schemaMentions.some((value) => {
      const normalized = value.toLowerCase().trim();
      return normalized.length > 10 && visible.includes(normalized.slice(0, Math.min(normalized.length, 80)));
    });

  return {
    types,
    itemCount: rawItems.length,
    matchesVisibleContent,
    rawItems,
  };
}

function extractSchemaString(rawItems: unknown[], paths: string[]): string | null {
  for (const item of rawItems) {
    if (!item || typeof item !== "object") {
      continue;
    }

    for (const path of paths) {
      const parts = path.split(".");
      let cursor: unknown = item;

      for (const part of parts) {
        if (!cursor || typeof cursor !== "object") {
          cursor = null;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[part];
      }

      if (typeof cursor === "string" && cursor.trim()) {
        return cursor.trim();
      }
    }
  }

  return null;
}


function annotateLinkGraph(pages: PageSnapshot[]): void {
  const pageUrls = new Set(pages.map((page) => page.url));
  const inboundCounts = new Map<string, number>();

  for (const page of pages) {
    for (const link of page.internalLinks) {
      if (!pageUrls.has(link)) {
        continue;
      }
      inboundCounts.set(link, (inboundCounts.get(link) ?? 0) + 1);
    }
  }

  for (const page of pages) {
    page.inboundLinks = inboundCounts.get(page.url) ?? 0;
    page.brokenInternalLinks = page.internalLinks.filter((link) => {
      const linkedPage = pages.find((candidate) => candidate.url === link);
      return Boolean(linkedPage && linkedPage.statusCode && linkedPage.statusCode >= 400);
    });
  }
}

function estimateRenderingModel(rawTextLength: number, scriptCount: number): PageSnapshot["rendering"]["renderingModel"] {
  if (rawTextLength > 1500) {
    return "ssr";
  }

  if (rawTextLength > 400 || scriptCount <= 5) {
    return "hybrid";
  }

  if (scriptCount > 5 && rawTextLength < 300) {
    return "csr";
  }

  return "unknown";
}

async function enrichRenderingSnapshots(pages: PageSnapshot[]): Promise<void> {
  const candidates = selectRenderCandidates(pages, MAX_RENDER_CHECKS);

  if (!candidates.length) {
    return;
  }

  const browser = await chromium.launch({ headless: true });

  try {
    for (const page of candidates) {
      const context = await browser.newContext({ userAgent: "AI-SEO-Audit/0.1" });
      const tab = await context.newPage();

      try {
        await tab.goto(page.url, {
          waitUntil: "networkidle",
          timeout: 20_000,
        });
        const renderedText = await tab.locator("body").innerText().catch(() => "");
        const cleanRenderedText = renderedText.replace(/\s+/g, " ").trim();
        page.rendering.renderedTextLength = cleanRenderedText.length;
        page.rendering.renderDeltaRatio =
          page.rendering.rawTextLength > 0
            ? cleanRenderedText.length / page.rendering.rawTextLength
            : cleanRenderedText.length > 0
              ? 10
              : 1;
        page.rendering.extractedTextPreview = cleanRenderedText.slice(0, 300);

        if (cleanRenderedText.length > page.rendering.rawTextLength * 2.2 && page.rendering.rawTextLength < 400) {
          page.rendering.renderingModel = "csr";
        } else if (cleanRenderedText.length > page.rendering.rawTextLength * 1.2) {
          page.rendering.renderingModel = "hybrid";
        } else {
          page.rendering.renderingModel = "ssr";
        }
      } catch (error) {
        page.rendering.errors.push(error instanceof Error ? error.message : "Ukjent Playwright-feil");
      } finally {
        await context.close();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playwright kunne ikke starte";
    for (const page of candidates) {
      page.rendering.errors.push(message);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function isHtmlLikeUrl(url: string): boolean {
  const pathname = new URL(url).pathname.toLowerCase();
  return !/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|xml|json|mp4|mov|avi|docx?|xlsx?|pptx?)$/i.test(pathname);
}
