import { load } from "cheerio";
import { chromium } from "playwright";

import { MAX_RENDER_CHECKS, PROVIDER_AGENTS } from "@/lib/config";
import type { PageSnapshot, ProviderId, RobotsEvaluation } from "@/lib/types";
import { extractTextTokens, formatDate, normalizeUrl, sameHost, unique } from "@/lib/utils";

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
};

export async function crawlDomain(
  targetUrl: string,
  maxPages: number,
  includeRenderChecks = true,
): Promise<CrawlResult> {
  const seedUrl = normalizeUrl(targetUrl);
  const host = new URL(seedUrl).hostname;
  const crawlNotes: string[] = [];

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
    if (!seen.has(normalized)) {
      seen.add(normalized);
      queue.push({ url: normalized, discoveredFrom: "sitemap", clickDepth: 1 });
    }
  }

  while (queue.length && pageMap.size < maxPages) {
    const item = queue.shift()!;
    const path = new URL(item.url).pathname;
    const robotsEvaluation = evaluateRobots(robots, path);

    if (!robotsEvaluation.generalAllowed) {
      discoveredButBlocked.add(item.url);
      pageMap.set(item.url, createBlockedSnapshot(item.url, item.discoveredFrom, item.clickDepth, robotsEvaluation));
      continue;
    }

    const response = await fetchPage(item.url);
    if (!response) {
      crawlNotes.push(`Klarte ikke å hente ${item.url}`);
      continue;
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

    if (!snapshot.contentType?.includes("text/html")) {
      continue;
    }

    for (const link of snapshot.internalLinks) {
      if (!sameHost(seedUrl, link)) {
        continue;
      }

      if (!isHtmlLikeUrl(link)) {
        continue;
      }

      const normalized = normalizeUrl(link);
      if (!new URL(normalized).hostname.endsWith(host) || seen.has(normalized)) {
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

  const pages = [...pageMap.values()];
  annotateLinkGraph(pages);

  if (includeRenderChecks) {
    await enrichRenderingSnapshots(pages);
  }

  return {
    pages,
    robotsTxt: robots.raw,
    sitemapUrls,
    blockedDiscoveredUrls: [...discoveredButBlocked],
    crawlNotes,
  };
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
        groups.push({
          agents: currentAgents,
          rules: currentRules,
        });
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
        currentRules.push({
          type: directive,
          value,
        });
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

    return {
      groups,
      sitemaps: unique(sitemaps),
      raw,
    };
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

    const length = rule.value.length;
    if (!winner || length >= winner.length) {
      winner = { type: rule.type, length };
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
    .map((node) => $(node).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const firstParagraph = paragraphs[0] ?? "";
  const listCount = $("ul, ol").length;
  const tableCount = $("table").length;
  const faqCount = $('[itemtype*="FAQPage"], [itemtype*="Question"]').length;
  const definitionLikeBlocks = $("dl").length + $("p, li").toArray().filter((node) => $(node).text().includes(":")).length;
  const canonicalUrl = $('link[rel="canonical"]').attr("href")
    ? new URL($('link[rel="canonical"]').attr("href")!, input.url).toString()
    : null;
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
  const scripts = $("script").length;
  const bodyClone = load(input.html);
  bodyClone("script, style, noscript, template").remove();
  const bodyText = bodyClone("body").text().replace(/\s+/g, " ").trim();
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
    title,
    metaDescription,
    h1,
    headings,
    firstParagraph,
    bodyText,
    rawHtmlBytes: Buffer.byteLength(input.html, "utf8"),
    scriptCount: scripts,
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
      renderingModel: estimateRenderingModel(bodyText.length, scripts),
      extractedTextPreview: bodyText.slice(0, 300),
      errors: [],
    },
    answerFirstSignals: {
      conciseOpening: firstParagraph.length >= 60 && firstParagraph.length <= 260,
      hasFaq: Math.max(faqCount, schema.types.includes("FAQPage") ? 1 : 0) > 0,
      hasTable: tableCount > 0,
      hasList: listCount > 0,
      directAnswerLikelihood: scoreDirectAnswerLikelihood(firstParagraph, h1, headings, bodyText),
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

function scoreDirectAnswerLikelihood(
  firstParagraph: string,
  h1: string,
  headings: string[],
  bodyText: string,
): number {
  let score = 0;
  if (firstParagraph.length >= 60 && firstParagraph.length <= 260) {
    score += 45;
  }
  if (/^(hva|hvordan|why|what|how|når|when|hvem|who)/i.test(h1) || headings.some((heading) => heading.endsWith("?"))) {
    score += 20;
  }
  if (/(er|means|is|refererer til|defineres som)/i.test(firstParagraph)) {
    score += 20;
  }
  if (bodyText.includes(":") || bodyText.includes("1.") || bodyText.includes("2.")) {
    score += 15;
  }

  return Math.min(100, score);
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
  const candidates = pages
    .filter((page) => !page.blockedByRobots && page.contentType?.includes("text/html"))
    .sort((a, b) => {
      const scoreA = a.rendering.rawTextLength + a.scriptCount * -100;
      const scoreB = b.rendering.rawTextLength + b.scriptCount * -100;
      return scoreA - scoreB;
    })
    .slice(0, MAX_RENDER_CHECKS);

  if (!candidates.length) {
    return;
  }

  const browser = await chromium.launch({ headless: true });

  try {
    for (const page of candidates) {
      const context = await browser.newContext({
        userAgent: "AI-SEO-Audit/0.1",
      });
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
