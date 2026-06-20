/**
 * Strategic Render Budget Selector
 *
 * Instead of picking the "most CSR-looking" pages randomly, this module
 * assigns a render priority to each page based on:
 *
 * 1. CSR likelihood (raw HTML has little text, many scripts)
 * 2. Business value of the URL (homepage, blog articles, product pages)
 * 3. Avoiding wasting budget on pages that are obviously static
 *
 * The result is a sorted list of candidates capped at `budget`.
 * This replaces the simple sort-by-score slice in enrichRenderingSnapshots().
 */

import type { PageSnapshot } from "@/lib/types";

type RenderCandidate = {
  page: PageSnapshot;
  priority: number;
  reason: string;
};

/**
 * Select pages to render with Playwright.
 *
 * @param pages   All crawled pages (already have rawTextLength and scriptCount)
 * @param budget  Max number of Playwright renders to perform
 * @returns       Pages sorted by render priority, capped at budget
 */
export function selectRenderCandidates(
  pages: PageSnapshot[],
  budget: number,
): PageSnapshot[] {
  const eligible = pages.filter(
    (p) =>
      !p.blockedByRobots &&
      p.contentType?.includes("text/html") &&
      (p.statusCode === null || p.statusCode < 400),
  );

  const scored: RenderCandidate[] = eligible.map((page) => ({
    page,
    priority: calculateRenderPriority(page),
    reason: describeReason(page),
  }));

  return scored
    .sort((a, b) => b.priority - a.priority)
    .slice(0, budget)
    .map((c) => c.page);
}

function calculateRenderPriority(page: PageSnapshot): number {
  let score = 0;

  // ── CSR Signals (max +70) ─────────────────────────────────────────────
  // Very little raw text → likely rendered by JS
  if (page.rendering.rawTextLength < 200) score += 40;
  else if (page.rendering.rawTextLength < 500) score += 20;
  else if (page.rendering.rawTextLength < 1000) score += 5;

  // Many scripts → likely CSR or hybrid
  if (page.scriptCount > 10) score += 30;
  else if (page.scriptCount > 5) score += 15;
  else if (page.scriptCount > 3) score += 5;

  // ── Business value (max +40) ──────────────────────────────────────────
  const path = page.path;

  // Homepage is the most important page
  if (path === "/" || path === "") score += 40;

  // Blog/article pages are prime citation targets for AI
  else if (/^\/(blog|articles?|posts?|nyheter|innlegg)\/[^/]+$/.test(path)) score += 35;

  // Product/service pages drive conversions
  else if (/^\/(produkt|product|tjeneste|service|solutions?|losning|losninger)/.test(path)) score += 30;

  // Category/listing pages (important for topic clusters)
  else if (/^\/(kategori|category|topics?|tema)/.test(path)) score += 20;

  // Pricing pages (AI often cites these for "how much does X cost" queries)
  else if (/^\/(pris|pricing|price|cost)/.test(path)) score += 25;

  // ── Static page penalties (max −40) ──────────────────────────────────
  // These are almost always SSR and don't benefit from Playwright
  if (/^\/(om|about|kontakt|contact|personvern|privacy|vilkar|terms|404|sitemap)/.test(path)) {
    score -= 40;
  }

  // Already known to be SSR from raw text length → deprioritize
  if (page.rendering.rawTextLength > 2000) score -= 30;

  // No scripts at all → almost certainly SSR
  if (page.scriptCount === 0) score -= 20;

  return score;
}

function describeReason(page: PageSnapshot): string {
  const reasons: string[] = [];
  if (page.rendering.rawTextLength < 500) reasons.push("lite rå tekst");
  if (page.scriptCount > 5) reasons.push(`${page.scriptCount} scripts`);
  if (page.path === "/" || page.path === "") reasons.push("forside");
  if (/^\/(blog|articles?)\/[^/]+$/.test(page.path)) reasons.push("blogg-artikkel");
  return reasons.join(", ") || "standard";
}
