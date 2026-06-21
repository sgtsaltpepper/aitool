import {
  createOpportunitySnapshot,
  getGa4PageData,
  getGscPageData,
  getGscPageQueryData,
  insertOpportunityItem,
} from "@/lib/db";
import type { Opportunity, OpportunityPriority } from "@/lib/types";
import { extractTextTokens, unique } from "@/lib/utils";

type Draft = Omit<Opportunity, "id" | "createdAt">;

const GENERIC_VENUE_TOKENS = new Set([
  "oslo",
  "night",
  "club",
  "nightclub",
  "utested",
  "uteliv",
  "bar",
  "lounge",
  "restaurant",
  "premier",
  "experience",
  "experiences",
  "clubbing",
]);

const KEEP_SEPARATE_PATH_TOKENS = new Set([
  "booking",
  "book",
  "kontakt",
  "contact",
  "meny",
  "menu",
  "apningstider",
  "opening",
  "hours",
  "bordbooking",
  "gjesteliste",
  "guestlist",
  "events",
  "event",
  "arrangement",
  "lost",
  "found",
]);

const NORWEGIAN_LANGUAGE_PATTERNS = [
  /\båpningstider\b/i,
  /\bapningstider\b/i,
  /\bbestill\b/i,
  /\bbord\b/i,
  /\bmeny\b/i,
  /\bkontakt\b/i,
  /\buteliv\b/i,
  /\butested(?:er)?\b/i,
  /\bgjesteliste\b/i,
  /\bbryllup\b/i,
  /\bjulebord\b/i,
  /\bselskapslokale\b/i,
  /\bhva\b/i,
  /\bhvordan\b/i,
  /[æøå]/i,
];

const ENGLISH_LANGUAGE_PATTERNS = [
  /\bbooking\b/i,
  /\bbook\b/i,
  /\bmenu\b/i,
  /\bcontact\b/i,
  /\bopening(?:-|\s)?hours\b/i,
  /\bnightclub\b/i,
  /\bnight club\b/i,
  /\bexperience\b/i,
  /\bevents\b/i,
  /\bguestlist\b/i,
  /\blost\b/i,
  /\bfound\b/i,
  /\bwedding\b/i,
  /\bparty\b/i,
  /\bprivate\b/i,
];

function priority(p: number): OpportunityPriority {
  if (p >= 4) return "critical";
  if (p >= 3) return "high";
  if (p >= 2) return "medium";
  return "low";
}

function calculateSortScore(
  type: Opportunity["type"],
  trafficWeightInput: number,
  createdAt: Date,
): number {
  let baseScore = 500;

  switch (type) {
    case "high-traffic-low-conversion":
      baseScore = 5000;
      break;
    case "indexing-blocker":
      baseScore = 4500;
      break;
    case "high-impressions-low-ctr":
      baseScore = 3000;
      break;
    case "traffic-down":
      baseScore = 2600;
      break;
    case "query-gap":
      baseScore = 1800;
      break;
    case "near-page-one":
      baseScore = 1500;
      break;
    default:
      baseScore = 500;
      break;
  }

  const trafficWeight = Math.min(trafficWeightInput * 0.1, 2000);
  const ageInHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  const freshnessWeight = Math.max(100 - ageInHours, 0) * 0.1;

  return baseScore + trafficWeight + freshnessWeight;
}

function pathname(url: string): string {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname; } catch { return url; }
}

function domainTokens(domain: string): string[] {
  return unique(
    domain
      .toLowerCase()
      .split(/[.\s_-]+/)
      .flatMap((token) => extractTextTokens(token))
      .flatMap((token) => token.split(/(?=nightclub|night|club|restaurant|bar|lounge|hotel|cafe|kafe)/))
      .filter((token) => token.length > 1),
  );
}

function isGenericVenueToken(token: string): boolean {
  return GENERIC_VENUE_TOKENS.has(token) || token.startsWith("oslo");
}

export function isBrandLikeQuery(query: string, domain: string): boolean {
  const brandTokens = new Set(domainTokens(domain));
  const tokens = extractTextTokens(query);
  if (!tokens.length) {
    return false;
  }

  const nonBrandTokens = tokens.filter((token) => !brandTokens.has(token));
  return nonBrandTokens.every((token) => isGenericVenueToken(token));
}

function pathTokens(page: string): string[] {
  return unique(
    pathname(page)
      .split(/[\/_-]+/)
      .flatMap((token) => extractTextTokens(token)),
  );
}

function detectTextLanguage(text: string): "no" | "en" | "unknown" {
  let noScore = 0;
  let enScore = 0;

  for (const pattern of NORWEGIAN_LANGUAGE_PATTERNS) {
    if (pattern.test(text)) {
      noScore += 1;
    }
  }
  for (const pattern of ENGLISH_LANGUAGE_PATTERNS) {
    if (pattern.test(text)) {
      enScore += 1;
    }
  }

  if (noScore === 0 && enScore === 0) {
    return "unknown";
  }
  if (noScore > enScore) {
    return "no";
  }
  if (enScore > noScore) {
    return "en";
  }
  return "unknown";
}

export function urlLanguageMatchesQuery(query: string, page: string): boolean | null {
  const queryLanguage = detectTextLanguage(query);
  const urlLanguage = detectTextLanguage(pathname(page).replace(/[\/_-]+/g, " "));

  if (queryLanguage === "unknown" || urlLanguage === "unknown") {
    return null;
  }

  return queryLanguage === urlLanguage;
}

function isHomepage(page: string): boolean {
  const path = pathname(page);
  return path === "/" || path === "";
}

export function shouldConsiderHomepageRedirect(args: {
  domain: string;
  page: string;
  query: string;
  pageClicks: number;
  pageImpressions: number;
}): boolean {
  if (isHomepage(args.page)) {
    return false;
  }

  if (!isBrandLikeQuery(args.query, args.domain)) {
    return false;
  }

  if (args.pageClicks > 25 || args.pageImpressions > 2000) {
    return false;
  }

  const tokens = pathTokens(args.page);
  if (!tokens.length) {
    return false;
  }

  if (tokens.some((token) => KEEP_SEPARATE_PATH_TOKENS.has(token))) {
    return false;
  }

  const brandTokens = new Set(domainTokens(args.domain));
  const meaningfulTokens = tokens.filter((token) => !brandTokens.has(token) && !isGenericVenueToken(token));
  return meaningfulTokens.length === 0;
}

export async function generateOpportunities(domain: string): Promise<number> {
  const pageData = getGscPageData(domain, 28);
  const pageQueryData = getGscPageQueryData(domain, 28);
  const ga4Data = getGa4PageData(domain, 28);

  const drafts: Draft[] = [];

  // Aggregate page data across dates
  const pageAgg = new Map<string, { clicks: number; impressions: number; ctrSum: number; posSum: number; count: number }>();
  for (const row of pageData) {
    const e = pageAgg.get(row.page) ?? { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, count: 0 };
    e.clicks += row.clicks;
    e.impressions += row.impressions;
    e.ctrSum += row.ctr;
    e.posSum += row.position;
    e.count++;
    pageAgg.set(row.page, e);
  }

  const queryAgg = new Map<string, { clicks: number; impressions: number; posSum: number; count: number; page: string }>();
  for (const row of pageQueryData) {
    const key = `${row.page}|||${row.query}`;
    const e = queryAgg.get(key) ?? { clicks: 0, impressions: 0, posSum: 0, count: 0, page: row.page };
    e.clicks += row.clicks;
    e.impressions += row.impressions;
    e.posSum += row.position;
    e.count++;
    queryAgg.set(key, e);
  }

  const ga4Agg = new Map<string, { sessions: number; conversions: number; bounceRate: number; count: number }>();
  for (const row of ga4Data) {
    const e = ga4Agg.get(row.page) ?? { sessions: 0, conversions: 0, bounceRate: 0, count: 0 };
    e.sessions += row.sessions;
    e.conversions += row.conversions;
    e.bounceRate += row.bounceRate;
    e.count++;
    ga4Agg.set(row.page, e);
  }

  const snapshotId = 0;
  const generatedAt = new Date();

  // ─── Regel 1: Høye visninger, lav CTR ────────────────────────────────────────
  for (const [page, agg] of pageAgg) {
    const avgCtr = agg.ctrSum / agg.count;
    const avgPos = agg.posSum / agg.count;
    if (agg.impressions >= 500 && avgCtr < 0.03 && avgPos <= 10) {
      const score = agg.impressions >= 5000 ? 4 : agg.impressions >= 2000 ? 3 : 2;
      const extraClicks = Math.round(agg.impressions * 0.02);
      drafts.push({
        snapshotId,
        sortScore: calculateSortScore("high-impressions-low-ctr", agg.impressions, generatedAt),
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: page,
        query: null,
        queryCluster: null,
        type: "high-impressions-low-ctr",
        priority: priority(score),
        title: `Høye visninger, lav CTR på ${pathname(page)}`,
        evidence: { impressions: agg.impressions, avgCtr, avgPos },
        recommendedAction: `Siden vises ${agg.impressions.toLocaleString("nb-NO")} ganger/mnd men kun ${(avgCtr * 100).toFixed(1)}% klikker. Skriv om title tag og meta description: bruk det sterkeste søkeordet tidlig i tittelen, legg til et konkret løfte eller nøkkeltall, og avslutt meta med en tydelig CTA som «Bestill bord» eller «Se menyen».`,
        expectedImpact: `En CTR på 5% (fra ${(avgCtr * 100).toFixed(1)}%) vil gi omtrent ${extraClicks} ekstra klikk per måned fra samme visningsnivå.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  // ─── Regel 2: Nær side 1 (pos 11–20) ────────────────────────────────────────
  for (const [page, agg] of pageAgg) {
    const avgPos = agg.posSum / agg.count;
    if (avgPos >= 11 && avgPos <= 20 && agg.impressions >= 100) {
      const posLabel = avgPos.toFixed(1);
      drafts.push({
        snapshotId,
        sortScore: calculateSortScore("near-page-one", agg.impressions, generatedAt),
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: page,
        query: null,
        queryCluster: null,
        type: "near-page-one",
        priority: priority(avgPos <= 15 ? 3 : 2),
        title: `Rangerer på plass ${posLabel} — ett push til topp 10`,
        evidence: { avgPos, impressions: agg.impressions, clicks: agg.clicks },
        recommendedAction: `Siden er på side 2 (snittposisjon ${posLabel}). Legg til 2–3 interne lenker fra dine sterkeste sider, utvid innholdet med FAQ eller relaterte søkeord, og bygg én eller to eksterne lenker fra relevante nettsteder.`,
        expectedImpact: `En flytt fra posisjon ${Math.round(avgPos)} til topp 10 øker typisk CTR med 3–5x og kan gi ${Math.round(agg.impressions * 0.04)} ekstra klikk/mnd.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  // ─── Regel 3: Trafikknedgang (siste 14 dager vs forrige 14) ──────────────────
  const recent14 = new Map<string, number>();
  const prev14 = new Map<string, number>();
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const cutoff28 = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
  for (const row of pageData) {
    if (row.date >= cutoff) {
      recent14.set(row.page, (recent14.get(row.page) ?? 0) + row.clicks);
    } else if (row.date >= cutoff28) {
      prev14.set(row.page, (prev14.get(row.page) ?? 0) + row.clicks);
    }
  }
  for (const [page, recentClicks] of recent14) {
    const prevClicks = prev14.get(page) ?? 0;
    if (prevClicks >= 50 && recentClicks < prevClicks * 0.7) {
      const dropPct = Math.round((1 - recentClicks / prevClicks) * 100);
      const lost = prevClicks - recentClicks;
      drafts.push({
        snapshotId,
        sortScore: calculateSortScore("traffic-down", prevClicks, generatedAt),
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: page,
        query: null,
        queryCluster: null,
        type: "traffic-down",
        priority: priority(dropPct >= 50 ? 4 : 3),
        title: `Trafikk ned ${dropPct}% siste 14 dager`,
        evidence: { recentClicks, prevClicks, dropPct },
        recommendedAction: `Trafikken har falt fra ${prevClicks} til ${recentClicks} klikk siste 14 dager (−${dropPct}%). Sjekk GSC for manuelle tiltak og indekseringsadvarsler, se om siden nylig er endret eller om det er en algoritmeoppdatering i perioden. Revider innholdet og sørg for at title og meta fremdeles er relevante.`,
        expectedImpact: `Å gjenvinne tapte klikk vil gi tilbake omtrent ${lost} klikk per 2 uker.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  // ─── Regel 4: Høy trafikk, lav konvertering (GA4) ────────────────────────────
  for (const [page, ga4] of ga4Agg) {
    const convRate = ga4.sessions > 0 ? ga4.conversions / ga4.sessions : 0;
    if (ga4.sessions >= 200 && convRate < 0.01) {
      const potentialConv = Math.round(ga4.sessions * 0.02);
      drafts.push({
        snapshotId,
        sortScore: calculateSortScore("high-traffic-low-conversion", ga4.sessions, generatedAt),
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: page,
        query: null,
        queryCluster: null,
        type: "high-traffic-low-conversion",
        priority: priority(ga4.sessions >= 1000 ? 4 : 3),
        title: `${ga4.sessions.toLocaleString("nb-NO")} besøk, men kun ${(convRate * 100).toFixed(2)}% konverterer`,
        evidence: { sessions: ga4.sessions, conversions: ga4.conversions, convRate },
        recommendedAction: `Siden har ${ga4.sessions.toLocaleString("nb-NO")} besøk men svært lav konverteringsrate. Flytt den primære CTA-en høyere opp på siden, legg til tillitssignaler (anmeldelser, bilder, kontaktinfo), og sørg for at sideinnholdet matcher søkeintensjonen til trafikken.`,
        expectedImpact: `En konverteringsrate på 2% ved nåværende trafikknivå vil gi ${potentialConv} konverteringer — mot ${ga4.conversions} i dag.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  // ─── Regel 5: Søkegap — søk med visninger men null klikk ─────────────────────
  const queryOnlyAgg = new Map<string, { impressions: number; position: number; page: string }>();
  for (const [key, agg] of queryAgg) {
    const [page, query] = key.split("|||");
    if (agg.clicks === 0 && agg.impressions >= 50) {
      queryOnlyAgg.set(query, {
        impressions: (queryOnlyAgg.get(query)?.impressions ?? 0) + agg.impressions,
        position: agg.posSum / agg.count,
        page,
      });
    }
  }
  for (const [query, data] of queryOnlyAgg) {
    if (data.impressions >= 100) {
      const potentialClicks = Math.round(data.impressions * 0.05);
      const pageMetrics = pageAgg.get(data.page);
      const redirectCandidate = shouldConsiderHomepageRedirect({
        domain,
        page: data.page,
        query,
        pageClicks: pageMetrics?.clicks ?? 0,
        pageImpressions: pageMetrics?.impressions ?? 0,
      });
      const languageMatch = urlLanguageMatchesQuery(query, data.page);
      drafts.push({
        snapshotId,
        sortScore: calculateSortScore("query-gap", data.impressions, generatedAt),
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: data.page,
        query,
        queryCluster: null,
        type: "query-gap",
        priority: priority(data.impressions >= 500 ? 3 : 2),
        title: redirectCandidate
          ? `«${query}» treffer trolig feil side`
          : `«${query}» — ${data.impressions.toLocaleString("nb-NO")} visninger, null klikk`,
        evidence: { query, impressions: data.impressions, position: data.position, redirectCandidate, urlLanguageMatch: languageMatch },
        recommendedAction: redirectCandidate
          ? `Søket «${query}» er merkevarepreget, men trafikken lander på ${pathname(data.page)} i stedet for en sterk hovedside. Vurder om denne URL-en er redundant. Hvis siden ikke har en tydelig egen funksjon, bør du teste om en 301-redirect til forsiden eller en sterkere hovedside vil samle autoritet og gi et klarere klikkmål. Hvis siden skal leve videre, må den få en tydeligere rolle enn i dag.`
          : `Søket «${query}» vises ${data.impressions.toLocaleString("nb-NO")} ganger men ingen klikker. Enten mangler det en side som treffer denne intensjonen, eller så matcher ikke title/meta-teksten det søkerne forventer. Vurder å lage en dedikert side eller å optimere den eksisterende sidens tittel slik at den speiler «${query}» tydelig.${languageMatch === false ? " Sjekk også om URL-språket samsvarer med søkespråket: en norsk søkefrase mot en engelsk slug, eller omvendt, kan svekke relevanssignalet." : ""}`,
        expectedImpact: `5% CTR på ${data.impressions.toLocaleString("nb-NO")} visninger = ${potentialClicks} ekstra klikk per måned.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  const topDrafts = [...drafts]
    .sort((left, right) => right.sortScore - left.sortScore)
    .slice(0, 100);
  const snapshotIdFinal = createOpportunitySnapshot(domain, topDrafts.length);
  for (const draft of topDrafts) {
    insertOpportunityItem({ ...draft, snapshotId: snapshotIdFinal });
  }

  return topDrafts.length;
}
