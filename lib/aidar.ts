import type { PageIntent, PagePerformanceMetrics, PageSearchInsights, SearchIntent } from "@/lib/types";
import { generatePerformanceInsights } from "@/lib/performance-insights";
import { extractTextTokens, unique } from "@/lib/utils";
import {
  buildPolicyDescriptions,
  buildPolicyRecommendations,
  buildPolicyTitles,
  buildPromptPolicyLines,
  GENERIC_DESCRIPTION_PATTERNS as POLICY_GENERIC_DESCRIPTION_PATTERNS,
  GENERIC_TITLE_PATTERNS as POLICY_GENERIC_TITLE_PATTERNS,
  inferBusinessContext as inferPolicyBusinessContext,
} from "@/lib/aidar-policy";

type QueryStat = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type MinimalPageContext = {
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  headings: string[];
  firstParagraph: string;
  bodyText: string;
  hasContactLink: boolean;
};

export type AidarInput = {
  domain: string;
  brand: string;
  keyword: string;
  intent: SearchIntent | PageIntent;
  page: MinimalPageContext | null;
  queries: QueryStat[];
  searchInsights: PageSearchInsights | null;
  metrics: PagePerformanceMetrics | null;
};

type BusinessContext = {
  industry: string;
  tone: string;
  isNightlife: boolean;
  isRestaurant: boolean;
  isBrandQuery: boolean;
  nightlifeQueryMode: "brand-action" | "generic-discovery" | "default";
  isHomePage: boolean;
};

export type AidarSuggestions = {
  agentName: "Aidar";
  mode: "openai" | "fallback";
  model: string | null;
  titles: string[];
  metaDescriptions: string[];
  titleOptions: { text: string; score: number; reasons: string[] }[];
  metaDescriptionOptions: { text: string; score: number; reasons: string[] }[];
  contentRecommendations: string[];
  notes: string[];
};

type AidarPayload = {
  titles?: string[];
  metaDescriptions?: string[];
  meta_title?: string;
  meta_description?: string;
  justification?: string;
  contentRecommendations?: string[];
  notes?: string[];
};

type NormalizedAidarPayload = {
  titles: string[];
  metaDescriptions: string[];
  contentRecommendations: string[];
  notes: string[];
};

type SuggestionKind = "title" | "description";

const BAD_ENDINGS = new Set([
  "det",
  "du",
  "og",
  "for",
  "med",
  "til",
  "på",
  "i",
  "om",
  "den",
  "det",
  "et",
  "en",
  "som",
]);

const GENERIC_TOPICS = new Set([
  "denne siden",
  "siden",
  "denne",
  "page",
  "home",
  "hjem",
]);

const FORBIDDEN_META_PHRASES = [
  /på godt norsk/gi,
  /få et raskt overblikk/gi,
  /går videre/gi,
  /relevante brukere/gi,
  /relevante kunder/gi,
  /forklart enkelt/gi,
  /denne siden/gi,
];

const SELF_REFERENTIAL_PATTERNS = [
  /\bdenne siden\b/gi,
  /\bher forklarer\b/gi,
  /\bforklarer\b/gi,
  /\bpå denne siden\b/gi,
];

const GENERIC_LOW_SIGNAL_PATTERNS = [
  /\bguide\b/gi,
  /\bvurdering\b/gi,
  /\bdet du bør vite\b/gi,
  /\bdette bør du vite\b/gi,
  /\bsamlet høyt på siden\b/gi,
  /\bsynlig før brukeren må lete\b/gi,
  /\bslik at .* finner det de trenger\b/gi,
];

const LOW_SIGNAL_TOKENS = new Set([
  "for",
  "deg",
  "som",
  "vil",
  "forsta",
  "forstå",
  "temaet",
  "dette",
  "det",
  "bør",
  "vite",
  "viktig",
  "velger",
  "valg",
  "oversikt",
  "guide",
  "info",
  "informasjon",
  "passer",
  "riktig",
  "side",
]);

function foldNorwegian(value: string): string {
  return value
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimToLength(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return truncated.slice(0, lastSpace > 20 ? lastSpace : maxLength).trim();
}

function trimToSentenceOrPhrase(value: string, maxLength: number): string {
  const normalized = cleanText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const withinLimit = normalized.slice(0, maxLength);
  const sentenceBoundary = Math.max(
    withinLimit.lastIndexOf(". "),
    withinLimit.lastIndexOf("! "),
    withinLimit.lastIndexOf("? "),
  );
  if (sentenceBoundary >= 40) {
    return withinLimit.slice(0, sentenceBoundary + 1).trim();
  }

  const clauseBoundary = Math.max(
    withinLimit.lastIndexOf(", "),
    withinLimit.lastIndexOf("; "),
    withinLimit.lastIndexOf(": "),
  );
  if (clauseBoundary >= 55) {
    return withinLimit.slice(0, clauseBoundary).trim();
  }

  const words = normalized.split(/\s+/);
  let best = "";
  for (const word of words) {
    const candidate = best ? `${best} ${word}` : word;
    if (candidate.length > maxLength) {
      break;
    }
    best = candidate;
  }

  return best.trim();
}

function shortenCommonPhrases(value: string, kind: "title" | "description"): string {
  let shortened = cleanText(value);
  const replacements: Array<[RegExp, string]> = [
    [/\bdet du bør vite\b/gi, "guide"],
    [/\bdette bør du vite\b/gi, "guide"],
    [/\bdette bør du vurdere\b/gi, "vurdering"],
    [/\bbooking og praktisk info\b/gi, "booking"],
    [/\binnhold og praktisk info\b/gi, "innhold"],
    [/\bdeg som vil forstå temaet\b/gi, "deg som vil forstå"],
    [/\bdeg som sammenligner alternativer\b/gi, "deg som sammenligner"],
    [/\bdeg som vil finne riktig side raskt\b/gi, "deg som vil finne riktig side"],
    [/\bbedrifter og arrangører\b/gi, "bedrifter"],
    [/\bbrukere som\b/gi, "deg som"],
    [/\bSe hva du bør vurdere, og hva som skiller alternativene\.\b/gi, "Se hva som påvirker valget."],
    [/\bSe når det passer, hva som skiller alternativene og hva du bør se etter\.\b/gi, "Se hva som er viktig å vite."],
    [/\bSe [^.!?]+ og kom raskt videre til riktig informasjon eller kontaktpunkt\.\b/gi, "Finn riktig informasjon raskt."],
    [/\bBe om tilbud eller send en forespørsel\.\b/gi, "Be om tilbud."],
    [/\bSe priser, innhold og neste steg\.\b/gi, "Se priser og neste steg."],
  ];

  for (const [pattern, replacement] of replacements) {
    shortened = shortened.replace(pattern, replacement);
  }

  if (kind === "description") {
    shortened = shortened
      .replace(/\bHer ser du\b/gi, "Se")
      .replace(/\bVurderer du\b/gi, "Vurder")
      .replace(/\bLær mer om\b/gi, "Få oversikt over");
  }

  return cleanText(shortened.replace(/\s+([,.!?;:])/g, "$1"));
}

function rewriteForLimit(value: string, maxLength: number, kind: "title" | "description"): string {
  let candidate = cleanText(value);
  if (candidate.length <= maxLength) {
    return candidate;
  }

  candidate = shortenCommonPhrases(candidate, kind);
  if (candidate.length <= maxLength) {
    return candidate;
  }

  if (kind === "description") {
    const sentences = candidate.match(/[^.!?]+[.!?]/g)?.map((item) => cleanText(item)) ?? [];
    const firstSentence = sentences.find((sentence) => sentence.length <= maxLength);
    if (firstSentence) {
      return firstSentence;
    }

    const withoutTail = candidate
      .replace(/, og [^,.!?]+$/i, "")
      .replace(/ og [^,.!?]+$/i, "")
      .replace(/, [^,.!?]+$/i, "");
    if (withoutTail.length < candidate.length && withoutTail.length <= maxLength) {
      return withoutTail;
    }
  }

  if (kind === "title") {
    const separatorParts = candidate.split(/\s+[|]\s+/);
    if (separatorParts.length > 1) {
      const noBrand = separatorParts[0]?.trim() ?? candidate;
      if (noBrand.length <= maxLength) {
        return noBrand;
      }
      candidate = noBrand;
    }

    const dashParts = candidate.split(/\s+[–-]\s+/);
    if (dashParts.length > 1) {
      const firstPart = dashParts[0]?.trim() ?? candidate;
      if (firstPart.length <= maxLength) {
        return firstPart;
      }
    }
  }

  return candidate;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanHeading(value: string): string {
  return cleanText(value.replace(/\s+[|\-–:].*$/, ""));
}

function primaryIntent(intent: SearchIntent | PageIntent): SearchIntent {
  return typeof intent === "string" ? intent : intent.primary;
}

function secondaryIntent(intent: SearchIntent | PageIntent): SearchIntent | null {
  return typeof intent === "string" ? null : intent.secondary ?? null;
}

function intentIncludes(intent: SearchIntent | PageIntent, candidate: SearchIntent): boolean {
  return primaryIntent(intent) === candidate || secondaryIntent(intent) === candidate;
}

function normalizedUnique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const cleaned = cleanText(item);
    const key = canonicalRecommendationKey(cleaned);
    if (!cleaned || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function canonicalRecommendationKey(value: string): string {
  return foldNorwegian(
    value
      .replace(/«[^»]+»/g, "«term»")
      .replace(/"[^"]+"/g, "\"term\""),
  );
}

function canonicalSuggestionKey(value: string): string {
  return foldNorwegian(value)
    .replace(/\b(det du boer vite|dette boer du vite|laer mer om)\b/g, "generic")
    .replace(/\b(hva som er viktig aa vite foer du velger|det viktigste du boer vite foer du tar et valg)\b/g, "generic")
    .replace(/\b(hva som paavirker valget|hva som skiller alternativene)\b/g, "generic")
    .replace(/\b[a-z0-9]+\s*\|\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function suggestionTokens(value: string): string[] {
  return extractTextTokens(value)
    .filter((token) => token.length > 2)
    .filter((token) => !LOW_SIGNAL_TOKENS.has(token));
}

function areSuggestionsTooSimilar(a: string, b: string): boolean {
  const keyA = canonicalSuggestionKey(a);
  const keyB = canonicalSuggestionKey(b);
  if (keyA === keyB) {
    return true;
  }

  const tokensA = suggestionTokens(a);
  const tokensB = suggestionTokens(b);
  if (!tokensA.length || !tokensB.length) {
    return false;
  }

  const setB = new Set(tokensB);
  const overlap = tokensA.filter((token) => setB.has(token)).length;
  const ratio = overlap / Math.max(Math.min(tokensA.length, tokensB.length), 1);
  return ratio >= 0.75;
}

function buildPreferredWordMap(input: AidarInput): Map<string, string> {
  const source = [
    input.keyword,
    input.page?.title ?? "",
    input.page?.h1 ?? "",
    ...(input.page?.headings ?? []),
    input.page?.firstParagraph ?? "",
    input.page?.bodyText.slice(0, 1000) ?? "",
  ].join(" ");

  const map = new Map<string, string>();
  for (const rawToken of source.match(/[\p{L}\p{N}-]+/gu) ?? []) {
    const token = rawToken.trim();
    if (token.length < 2) {
      continue;
    }
    const folded = foldNorwegian(token);
    if (!folded) {
      continue;
    }
    const current = map.get(folded);
    const shouldPrefer =
      !current ||
      (/[æøå]/i.test(token) && !/[æøå]/i.test(current)) ||
      (/^[A-ZÆØÅ]/.test(token) && !/^[A-ZÆØÅ]/.test(current));
    if (shouldPrefer) {
      map.set(folded, token);
    }
  }

  return map;
}

function repairNorwegianForms(value: string, preferredWords: Map<string, string>): string {
  return value.replace(/[\p{L}\p{N}-]+/gu, (token) => {
    const preferred = preferredWords.get(foldNorwegian(token));
    if (!preferred) {
      return token;
    }
    if (token.toLowerCase() === token) {
      return preferred.toLowerCase();
    }
    if (/^[A-ZÆØÅ]/.test(token)) {
      return preferred.charAt(0).toUpperCase() + preferred.slice(1).toLowerCase();
    }
    return preferred;
  });
}

function cleanTerminalPhrase(value: string): string {
  let cleaned = cleanText(value).replace(/[–-]\s*$/, "").replace(/[?]{2,}/g, "?");
  let parts = cleaned.split(/\s+/);
  while (parts.length > 2) {
    const last = parts[parts.length - 1]?.toLowerCase();
    if (!last || !BAD_ENDINGS.has(last)) {
      break;
    }
    parts = parts.slice(0, -1);
  }
  cleaned = parts.join(" ");
  return cleaned.replace(/\s+[|:-]$/, "").trim();
}

function ensureNaturalEnding(value: string, maxLength: number, kind: "title" | "description"): string {
  let cleaned = cleanTerminalPhrase(value);
  let previous = "";

  while (cleaned && cleaned !== previous) {
    previous = cleaned;
    const words = cleaned.split(/\s+/);
    const last = words[words.length - 1]?.toLowerCase() ?? "";
    if (!BAD_ENDINGS.has(last) && !/[,:;–-]$/.test(cleaned)) {
      break;
    }
    words.pop();
    cleaned = words.join(" ").trim();
  }

  if (kind === "description" && cleaned && !/[.!?]$/.test(cleaned)) {
    const withPeriod = `${cleaned}.`;
    if (withPeriod.length <= maxLength) {
      return withPeriod;
    }
  }

  return cleaned;
}

function stripForbiddenMetaPhrases(value: string): string {
  let cleaned = value;
  for (const pattern of FORBIDDEN_META_PHRASES) {
    cleaned = cleaned.replace(pattern, " ");
  }
  return cleanText(cleaned.replace(/\s+([,.!?;:])/g, "$1"));
}

function stripSelfReferentialLanguage(value: string): string {
  let cleaned = value;
  for (const pattern of SELF_REFERENTIAL_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  return cleanText(cleaned.replace(/\s+([,.!?;:])/g, "$1"));
}

function fixKnownNorwegianMisspellings(value: string): string {
  return value
    .replace(/\bol\b/gi, (match) => (match === match.toUpperCase() ? "ØL" : "øl"))
    .replace(/\bbor\b/gi, (match) => (match === match.toUpperCase() ? "BØR" : "bør"));
}

function polishNorwegianText(value: string): string {
  return cleanText(
    fixKnownNorwegianMisspellings(
      stripForbiddenMetaPhrases(
        stripSelfReferentialLanguage(value),
      ),
    ),
  );
}

function finalPolish(value: string, maxLength: number, preferredWords: Map<string, string>): string {
  const kind = maxLength <= 60 ? "title" : "description";
  const repaired = repairNorwegianForms(polishNorwegianText(value), preferredWords);
  const rewritten = rewriteForLimit(repaired, maxLength, kind);
  return ensureNaturalEnding(trimToSentenceOrPhrase(rewritten, maxLength), maxLength, kind);
}

function chooseVisibleKeyword(primary: string, alternatives: string[]): string {
  const normalizedPrimary = foldNorwegian(extractTextTokens(primary).join(" "));

  for (const alternative of alternatives) {
    const cleaned = cleanHeading(alternative);
    if (!cleaned) {
      continue;
    }
    const normalizedAlternative = foldNorwegian(extractTextTokens(cleaned).join(" "));
    if (normalizedAlternative === normalizedPrimary) {
      return cleaned;
    }
    if (/[æøå]/i.test(cleaned) && normalizedAlternative.includes(normalizedPrimary)) {
      return cleaned;
    }
    const primaryTerms = normalizedPrimary.split(/\s+/).filter(Boolean);
    const altTerms = new Set(normalizedAlternative.split(/\s+/).filter(Boolean));
    const overlap = primaryTerms.filter((term) => altTerms.has(term)).length;
    if (primaryTerms.length > 0 && overlap / primaryTerms.length >= 0.6) {
      return cleaned;
    }
  }

  return primary;
}

function extractTopicFromQueries(queries: QueryStat[]): string | null {
  const candidates = queries
    .map((item) => cleanHeading(item.query))
    .filter((item) => item.length >= 4)
    .filter((item) => !GENERIC_TOPICS.has(item.toLowerCase()));
  return candidates[0] ?? null;
}

function pickTopic(input: AidarInput): string {
  const fromVisible = chooseVisibleKeyword(
    input.keyword,
    [
      input.page?.h1 ?? "",
      input.page?.title ?? "",
      ...(input.page?.headings ?? []),
      input.searchInsights?.primaryQuery ?? "",
      extractTopicFromQueries(input.queries) ?? "",
    ],
  );
  const cleaned = cleanHeading(fromVisible);
  if (cleaned && !GENERIC_TOPICS.has(cleaned.toLowerCase())) {
    return cleaned;
  }

  const headingCandidate = (input.page?.headings ?? [])
    .map(cleanHeading)
    .find((item) => item.length >= 4 && !GENERIC_TOPICS.has(item.toLowerCase()));
  if (headingCandidate) {
    return headingCandidate;
  }

  return extractTopicFromQueries(input.queries) ?? (cleanHeading(input.keyword) || input.brand);
}

function inferBusinessContext(input: AidarInput): BusinessContext {
  const source = [
    input.domain,
    input.brand,
    input.keyword,
    input.page?.url ?? "",
    input.page?.title ?? "",
    input.page?.h1 ?? "",
    ...(input.page?.headings ?? []),
    input.page?.firstParagraph ?? "",
    input.page?.bodyText.slice(0, 600) ?? "",
    ...(input.queries.map((item) => item.query) ?? []),
  ].join(" ").toLowerCase();

  const isNightlife = /\bnight\s?club|nightclub|uteliv|utested|diskotek|gjesteliste|vip|bordbooking|flaskeservice|club\b/i.test(source);
  const isRestaurant = /\brestaurant|restauran|meny|middag|lunsj|vinliste|bordreservasjon|booking\b/i.test(source) && !isNightlife;
  const industry = isNightlife ? "nattklubb" : isRestaurant ? "restaurant" : "servering og opplevelser";
  const tone = isNightlife ? "eksklusiv, inviterende, festfokusert" : isRestaurant ? "inspirerende, appetittvekkende, inviterende" : "tydelig, menneskelig, konverteringsfokusert";

  const brandTokens = new Set(extractTextTokens(`${input.brand} ${input.domain}`));
  const queryTokens = extractTextTokens(input.searchInsights?.primaryQuery ?? input.keyword);
  const nonBrandTokens = queryTokens.filter((token) => !brandTokens.has(token));
  const brandLikeServiceTokens = new Set(["oslo", "nightclub", "night", "club"]);
  const remainingNonBrandTokens = nonBrandTokens.filter((token) => !brandLikeServiceTokens.has(token));
  const isBrandQuery = queryTokens.length > 0 && remainingNonBrandTokens.length === 0;
  const isHomePage = (input.page?.url ? new URL(input.page.url).pathname === "/" : false) || (input.page?.h1?.toLowerCase().includes(input.brand.toLowerCase()) ?? false);
  const nightlifeQueryMode =
    isNightlife && isBrandQuery
      ? "brand-action"
      : isNightlife && /\b(nattklubb|nightclub|rooftop|rooftop bar|bar oslo|utested|uteliv)\b/i.test(input.searchInsights?.primaryQuery ?? input.keyword)
        ? "generic-discovery"
        : "default";

  return {
    industry,
    tone,
    isNightlife,
    isRestaurant,
    isBrandQuery,
    nightlifeQueryMode,
    isHomePage,
  };
}

function shortAudience(intent: SearchIntent | PageIntent, searchInsights: PageSearchInsights | null): string | null {
  const audience = searchInsights?.audience?.toLowerCase() ?? "";
  if (audience.includes("bedrift")) return "bedrifter";
  if (audience.includes("arrangør")) return "arrangører";
  if (audience.includes("private")) return "private arrangementer";
  if (audience.includes("sammenligner")) return "deg som sammenligner alternativer";
  if (audience.includes("forstå")) return "deg som vil forstå temaet";
  if (intentIncludes(intent, "transactional")) return "bedrifter og arrangører";
  if (intentIncludes(intent, "commercial investigation")) return "deg som sammenligner alternativer";
  if (intentIncludes(intent, "informational")) return "deg som vil forstå temaet";
  if (intentIncludes(intent, "navigational")) return "deg som vil finne riktig side raskt";
  return null;
}

function inferAngle(input: AidarInput): string | null {
  const headings = input.page?.headings.map(cleanHeading).filter(Boolean) ?? [];
  const highlights = input.searchInsights?.contentHighlights ?? [];
  const candidates = [...headings, ...highlights]
    .filter((item) => item.length > 3)
    .filter((item) => !new RegExp(input.keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(item));

  return candidates[0] ?? null;
}

function overlapsTopic(candidate: string, topic: string, brand: string): boolean {
  const candidateTokens = new Set(extractTextTokens(candidate));
  const topicTokens = extractTextTokens(topic);
  const brandTokens = new Set(extractTextTokens(brand));
  const meaningfulTopicTokens = topicTokens.filter((token) => !brandTokens.has(token));

  if (!meaningfulTopicTokens.length) {
    return false;
  }

  const overlap = meaningfulTopicTokens.filter((token) => candidateTokens.has(token)).length;
  return overlap / meaningfulTopicTokens.length >= 0.6;
}

function summarizeTopics(input: AidarInput): string[] {
  const topics = normalizedUnique([
    ...(input.searchInsights?.contentHighlights ?? []),
    ...(input.page?.headings.map(cleanHeading) ?? []),
  ])
    .map((item) => item.replace(/[?.!]$/, ""))
    .filter((item) => item.length >= 4 && item.length <= 60);

  return topics.slice(0, 3);
}

function extractQueryDetail(input: AidarInput, visibleTopic: string): string | null {
  const candidates = input.queries
    .map((item) => cleanHeading(item.query))
    .filter((item) => item.length >= 4 && item.length <= 60)
    .filter((item) => !overlapsTopic(item, visibleTopic, input.brand));

  return candidates[0] ?? null;
}

function buildDetailCandidates(input: AidarInput, visibleTopic: string): string[] {
  return normalizedUnique([
    inferAngle(input) ?? "",
    ...summarizeTopics(input),
    extractQueryDetail(input, visibleTopic) ?? "",
  ])
    .filter((item) => item.length >= 4)
    .filter((item) => !overlapsTopic(item, visibleTopic, input.brand))
    .slice(0, 4);
}

function buildDetailPair(details: string[]): string {
  if (details.length >= 2) {
    return `${details[0]} og ${details[1]}`.toLowerCase();
  }
  return (details[0] ?? "").toLowerCase();
}

function nightlifeHomeConcept(input: AidarInput): string {
  const source = [input.page?.title ?? "", input.page?.h1 ?? "", ...(input.page?.headings ?? [])].join(" ");
  if (/\brooftop\b/i.test(source) && /\bnight\s?club|nightclub\b/i.test(source)) {
    return "Rooftop & Nightclub";
  }
  if (/\brooftop\b/i.test(source)) {
    return "Rooftop";
  }
  if (/\bnight\s?club|nightclub\b/i.test(source)) {
    return "Nightclub";
  }
  return "Nattklubb";
}

function nightlifeCity(input: AidarInput): string {
  const source = [input.domain, input.keyword, input.page?.title ?? "", input.page?.h1 ?? ""].join(" ");
  if (/\boslo\b/i.test(source)) {
    return "Oslo";
  }
  return "Oslo";
}

function nightlifeValueHook(input: AidarInput): string {
  const haystack = [
    ...(input.page?.headings ?? []),
    ...(input.searchInsights?.contentHighlights ?? []),
    input.page?.firstParagraph ?? "",
    input.page?.bodyText.slice(0, 500) ?? "",
  ].join(" ");

  if (/\btakterrasse|rooftop\b/i.test(haystack)) return "Oslos råeste takterrasse";
  if (/\bgjesteliste|guestlist\b/i.test(haystack)) return "Bestill bord og sikre gjesteliste";
  if (/\bdj|live|konsept|club concept\b/i.test(haystack)) return "DJ-konsepter, utsikt og sen kveld";
  if (/\båpningstider\b/i.test(haystack)) return "Bestill bord og se åpningstider";
  return "Bestill bord og se åpningstider";
}

function extractCommercialSignal(input: AidarInput): string | null {
  const haystack = [
    ...(input.page?.headings ?? []),
    ...(input.searchInsights?.contentHighlights ?? []),
    input.page?.firstParagraph ?? "",
    input.page?.bodyText.slice(0, 500) ?? "",
  ].join(" ");

  if (/\bpris|priser|kostnad|tilbud\b/i.test(haystack)) return "priser";
  if (/\bbooking|bestill|reservasjon|forespørsel\b/i.test(haystack)) return "booking";
  if (/\båpningstider|opening hours|open\b/i.test(haystack)) return "åpningstider";
  if (/\bgjesteliste|guest list|guestlist\b/i.test(haystack)) return "gjesteliste";
  if (/\bmeny|drink|cocktail|flaske|bottle service\b/i.test(haystack)) return "meny";
  if (/\banmeldelse|omtale|referanse|case\b/i.test(haystack)) return "referanser";
  if (/\bmeny|drikke|pakke|innhold|kapasitet\b/i.test(haystack)) return "innhold og praktisk info";
  return null;
}

function criticalVenueSignals(input: AidarInput): string[] {
  const haystack = [
    input.page?.title ?? "",
    input.page?.h1 ?? "",
    ...(input.page?.headings ?? []),
    input.page?.firstParagraph ?? "",
    input.page?.bodyText.slice(0, 1200) ?? "",
  ].join(" ");

  const missing: string[] = [];
  if (!/\båpningstider|opening hours|open\b/i.test(haystack)) missing.push("åpningstider");
  if (!/\baldersgrense|20 års grense|18 års grense|id\b/i.test(haystack)) missing.push("aldersgrense");
  if (!/\bkleskode|dresscode\b/i.test(haystack)) missing.push("kleskode");
  if (!/\bmeny|drink|cocktail|flaske|bottle service\b/i.test(haystack)) missing.push("meny");
  return missing;
}

function candidateTopicTerms(topic: string): string[] {
  return unique(
    extractTextTokens(topic)
      .filter((token) => token.length > 2)
      .slice(0, 6),
  );
}

function candidateBrandTerms(input: AidarInput): string[] {
  return unique(
    extractTextTokens(`${input.brand} ${input.domain}`)
      .filter((token) => token.length > 2)
      .slice(0, 4),
  );
}

function scoreSuggestion(
  value: string,
  kind: SuggestionKind,
  input: AidarInput,
  topic: string,
): number {
  return evaluateSuggestion(value, kind, input, topic).score;
}

function evaluateSuggestion(
  value: string,
  kind: SuggestionKind,
  input: AidarInput,
  topic: string,
): { score: number; reasons: string[] } {
  const cleaned = cleanText(value);
  if (!cleaned) {
    return { score: -999, reasons: ["Tom tekst"] };
  }

  let score = 0;
  const reasons: string[] = [];
  const folded = foldNorwegian(cleaned);
  const topicTerms = candidateTopicTerms(topic);
  const brandTerms = candidateBrandTerms(input);
  const contentSignals = summarizeTopics(input)
    .flatMap((item) => extractTextTokens(item).filter((token) => token.length > 2))
    .slice(0, 8);

  for (const token of topicTerms) {
    if (folded.includes(foldNorwegian(token))) {
      score += 8;
      reasons.push(`Treffer temaet «${token}»`);
    }
  }

  for (const token of contentSignals) {
    if (folded.includes(foldNorwegian(token))) {
      score += kind === "description" ? 5 : 2;
      reasons.push(`Bruker konkret innholdssignal: ${token}`);
    }
  }

  if (brandTerms.some((token) => folded.includes(foldNorwegian(token)))) {
    score += kind === "title" ? 4 : 2;
    reasons.push("Har med avsender/brand");
  }

  if (/[æøå]/i.test(cleaned)) {
    score += 3;
    reasons.push("Bevarer norske særbokstaver");
  }

  if (kind === "title") {
    if (cleaned.length >= 42 && cleaned.length <= 58) {
      score += 10;
      reasons.push("God tittellengde");
    } else if (cleaned.length >= 30 && cleaned.length <= 60) {
      score += 6;
      reasons.push("Innenfor tittellengde");
    } else if (cleaned.length < 24) score -= 10;
    else if (cleaned.length > 60) score -= 30;

    if (/[|]/.test(cleaned)) score += 2;
    if (/[–-]/.test(cleaned)) score += 2;
    if (/[?]$/.test(cleaned) && primaryIntent(input.intent) === "informational") score += 4;
    if (/[?]$/.test(cleaned) && primaryIntent(input.intent) !== "informational") score -= 2;
  } else {
    if (cleaned.length >= 120 && cleaned.length <= 155) {
      score += 12;
      reasons.push("God lengde for metabeskrivelse");
    } else if (cleaned.length >= 90 && cleaned.length <= 155) {
      score += 7;
      reasons.push("Innenfor god lengde");
    } else if (cleaned.length < 75) score -= 8;
    else if (cleaned.length > 155) score -= 30;

    if (/[.!?]$/.test(cleaned)) score += 6;
    if (/\b(se|finn|be om|vurder|sammenlign|bestill|kontakt)\b/i.test(cleaned)) {
      score += 5;
      reasons.push("Har tydelig neste steg");
    }
    if (/\b(høyt på siden|uten scrolling|synlig før|slik at brukeren|slik at gjestene|plasser|flytt)\b/i.test(cleaned)) {
      score -= 24;
      reasons.push("Lyder som redaksjonell instruks i stedet for ferdig metabeskrivelse");
    }
  }

  if (FORBIDDEN_META_PHRASES.some((pattern) => pattern.test(cleaned))) score -= 40;
  if (SELF_REFERENTIAL_PATTERNS.some((pattern) => pattern.test(cleaned))) score -= 40;
  if (GENERIC_LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(cleaned))) score -= 6;
  if (kind === "title" && POLICY_GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(cleaned))) score -= 18;
  if (kind === "description" && POLICY_GENERIC_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(cleaned))) score -= 18;
  if (/\bol\b|\bbor\b/i.test(cleaned)) score -= 50;
  if (/[–-]\s*$|[,:;]\s*$/.test(cleaned)) score -= 40;
  if (new RegExp(`\\b(${Array.from(BAD_ENDINGS).join("|")})$`, "i").test(cleaned)) score -= 16;

  switch (primaryIntent(input.intent)) {
    case "transactional":
      if (/\b(tilbud|booking|bestill|pris|kontakt|forespørsel)\b/i.test(cleaned)) score += 8;
      if (/\b(forklaring|guide|hva er)\b/i.test(cleaned)) score -= 5;
      break;
    case "commercial investigation":
      if (/\b(sammenlign|vurder|pris|priser|inkludert|passer)\b/i.test(cleaned)) score += 8;
      if (/\b(bestill|kontakt nå)\b/i.test(cleaned)) score -= 3;
      break;
    case "navigational":
      if (/\b(finn|kontakt|adresse|åpningstider)\b/i.test(cleaned)) score += 8;
      break;
    case "informational":
    default:
      if (/\b(hva|hvordan|når|forskjell|beregne)\b/i.test(cleaned)) score += 6;
      if (/\b(bestill|tilbud)\b/i.test(cleaned)) score -= 4;
      break;
  }

  return { score, reasons: unique(reasons).slice(0, 3) };
}

function rankSuggestions(
  items: string[],
  kind: SuggestionKind,
  input: AidarInput,
  topic: string,
): string[] {
  return rankSuggestionDetails(items, kind, input, topic).map(({ text }) => text);
}

function rankSuggestionDetails(
  items: string[],
  kind: SuggestionKind,
  input: AidarInput,
  topic: string,
): Array<{ text: string; score: number; reasons: string[] }> {
  const ranked = items
    .map((item) => {
      const evaluation = evaluateSuggestion(item, kind, input, topic);
      return { text: item, score: evaluation.score, reasons: evaluation.reasons };
    })
    .filter(({ text, score }) => Boolean(text) && score > -20)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

  const result: Array<{ text: string; score: number; reasons: string[] }> = [];
  for (const candidate of ranked) {
    if (result.some((existing) => areSuggestionsTooSimilar(existing.text, candidate.text))) {
      continue;
    }
    result.push(candidate);
  }

  return result;
}

function buildInformationalDescriptions(topic: string, input: AidarInput): string[] {
  const business = inferBusinessContext(input);
  const details = buildDetailCandidates(input, topic);
  const primaryDetail = buildDetailPair(details);
  const queryDetail = extractQueryDetail(input, topic);
  const fallback = queryDetail?.toLowerCase() ?? topic.toLowerCase();

  if (business.isNightlife && business.nightlifeQueryMode === "brand-action") {
    return [
      trimToLength(
        `${topic} hos ${input.brand}. Se åpningstider, booking${details.length ? `, ${details[0].toLowerCase()}` : ""} og praktisk info før kvelden i Oslo.`,
        155,
      ),
      trimToLength(
        `${input.brand} i Oslo med fokus på bordbooking, gjesteliste og det du trenger før besøk${details[1] ? `, som ${details[1].toLowerCase()}` : ""}.`,
        155,
      ),
    ];
  }

  if (business.isNightlife && business.nightlifeQueryMode === "generic-discovery") {
    return [
      trimToLength(`${topic} i ${nightlifeCity(input)} med atmosfære, bildegalleri, DJ-konsepter og anmeldelser som hjelper deg å velge riktig sted for kvelden.`, 155),
      trimToLength(`Utforsk ${topic.toLowerCase()} med bilder, stemning, musikkprofil og hva som gjør stedet verdt et besøk før du velger utested.`, 155),
    ];
  }

  return [
    trimToLength(
      primaryDetail
        ? `${topic} med fokus på ${primaryDetail}. Se konkrete svar og innhold som gjør det lettere å forstå ${fallback}.`
        : `${topic} med konkrete svar, forklaringer og eksempler som gjør innholdet lettere å forstå.`,
      155,
    ),
    trimToLength(
      details[0]
        ? `Utforsk ${topic.toLowerCase()} med ${details[0].toLowerCase()}${details[1] ? `, ${details[1].toLowerCase()}` : ""} og tydelige forklaringer uten unødvendig fyll.`
        : `Les om ${topic.toLowerCase()} med tydelige forklaringer og konkrete punkter fra siden.`,
      155,
    ),
  ];
}

function buildCommercialDescriptions(topic: string, input: AidarInput): string[] {
  const business = inferBusinessContext(input);
  const audience = shortAudience(input.intent, input.searchInsights);
  const topics = summarizeTopics(input);
  const signal = extractCommercialSignal(input);
  const detailText = topics.length ? topics.slice(0, 2).join(" og ").toLowerCase() : "forskjeller, innhold og vurderingspunkter";
  const qualifier = signal ? `${signal}, ${detailText}` : detailText;

  if (business.isNightlife && business.nightlifeQueryMode === "brand-action") {
    return [
      trimToLength(`${topic} hos ${input.brand}. Se åpningstider, booking, meny og praktisk info før du velger kveldens sted i Oslo.`, 155),
      trimToLength(`${input.brand} i Oslo med bordbooking, gjesteliste og info om hva du kan forvente før besøk.`, 155),
    ];
  }

  if (business.isNightlife && business.nightlifeQueryMode === "generic-discovery") {
    return [
      trimToLength(`${topic} i ${nightlifeCity(input)} med bildegalleri, DJ-konsepter, anmeldelser og stemning som gjør det lettere å sammenligne steder.`, 155),
      trimToLength(`Sammenlign ${topic.toLowerCase()} med fokus på atmosfære, musikkprofil, anmeldelser og hva slags kveld stedet passer best for.`, 155),
    ];
  }

  return [
    trimToLength(`${topic} for ${audience ?? "deg som vurderer ulike alternativer"}. Se ${qualifier} og vurder hva som passer best for behovet ditt.`, 155),
    trimToLength(`Sammenlign ${topic.toLowerCase()} med fokus på ${qualifier}. Få det viktigste du trenger før du velger eller tar kontakt.`, 155),
  ];
}

function buildTransactionalDescriptions(topic: string, input: AidarInput): string[] {
  const business = inferBusinessContext(input);
  const audience = shortAudience(input.intent, input.searchInsights);
  const topics = summarizeTopics(input);
  const detailText = topics.length ? topics.slice(0, 2).join(" og ").toLowerCase() : "praktisk informasjon";
  const cta = input.page?.hasContactLink ? "Be om tilbud eller send en forespørsel." : "Se priser, innhold og neste steg.";

  if (business.isNightlife && business.nightlifeQueryMode === "brand-action") {
    return [
      trimToLength(`${topic} hos ${input.brand}. Se åpningstider, bordbooking, meny og praktisk info før du planlegger kvelden i Oslo.`, 155),
      trimToLength(`${input.brand} i Oslo med booking, gjesteliste og informasjon om kveldens opplevelse før du drar ut.`, 155),
    ];
  }

  return [
    trimToLength(`${topic} for ${audience ?? "bedrifter og arrangører"}. Se ${detailText}, vurder om tilbudet passer, og ${cta.toLowerCase()}`, 155),
    trimToLength(`Vurderer du ${topic.toLowerCase()}? Her ser du ${detailText}, hva som er inkludert og hvordan du kan be om tilbud.`, 155),
  ];
}

function buildNavigationalDescriptions(topic: string, input: AidarInput): string[] {
  const business = inferBusinessContext(input);
  const brand = input.brand;
  const topics = summarizeTopics(input);
  const detailText = topics.length ? topics.slice(0, 2).join(" og ").toLowerCase() : "kontaktinfo og praktisk informasjon";

  if (business.isNightlife && business.nightlifeQueryMode === "brand-action") {
    return [
      trimToLength(`Finn ${topic.toLowerCase()} hos ${brand}. Se åpningstider, bordbooking, gjesteliste og praktisk info før besøket.`, 155),
      trimToLength(`${topic} i Oslo hos ${brand}. Gå direkte til booking, meny og informasjonen gjestene leter etter før kvelden starter.`, 155),
    ];
  }

  return [
    trimToLength(`Finn ${topic.toLowerCase()} hos ${brand}. Se ${detailText} og kom raskt videre til riktig informasjon eller kontaktpunkt.`, 155),
    trimToLength(`${topic} hos ${brand}. Gå direkte til siden for ${detailText} og det viktigste du trenger med en gang.`, 155),
  ];
}

function buildDescriptionsByIntent(topic: string, input: AidarInput): string[] {
  const policyDescriptions = buildPolicyDescriptions(input, topic);
  if (policyDescriptions?.length) {
    return policyDescriptions;
  }

  const descriptionIntent = secondaryIntent(input.intent) ?? primaryIntent(input.intent);

  switch (descriptionIntent) {
    case "transactional":
      return buildTransactionalDescriptions(topic, input);
    case "commercial investigation":
      return buildCommercialDescriptions(topic, input);
    case "navigational":
      return buildNavigationalDescriptions(topic, input);
    case "informational":
    default:
      return buildInformationalDescriptions(topic, input);
  }
}

function buildTitlesByIntent(input: AidarInput, visibleTopic: string, audience: string | null, angle: string | null): string[] {
  const policyTitles = buildPolicyTitles(input, visibleTopic);
  if (policyTitles?.length) {
    return policyTitles;
  }

  const business = inferPolicyBusinessContext(input);
  const topics = summarizeTopics(input);
  const detailCandidates = buildDetailCandidates(input, visibleTopic);
  const transactionalModifier = topics.find((item) => /firmafest|event|booking|arrangement/i.test(item)) ?? angle;
  const commercialSignal = extractCommercialSignal(input);

  if (business.isNightlife && business.isHomePage) {
    const concept = nightlifeHomeConcept(input);
    const city = nightlifeCity(input);
    const hook = nightlifeValueHook(input);
    return [
      `${input.brand} ${concept} ${city} | ${hook}`,
      `${input.brand} | ${concept} i ${city} – ${hook}`,
      `${input.brand} ${city} | ${concept} – ${hook}`,
    ];
  }

  if (business.isNightlife && business.nightlifeQueryMode === "brand-action") {
    return [
      `${input.brand} Oslo – åpningstider og bordbooking`,
      `${input.brand} Nightclub Oslo – gjesteliste og booking`,
      `${input.brand} Oslo – meny og praktisk info`,
    ];
  }

  if (business.isNightlife && business.nightlifeQueryMode === "generic-discovery") {
    return [
      `${visibleTopic} i Oslo – atmosfære og DJ-konsepter | ${input.brand}`,
      `${visibleTopic} Oslo – bildegalleri og anmeldelser | ${input.brand}`,
      `${visibleTopic} i Oslo | Rooftop, stemning og musikk`,
    ];
  }

  switch (primaryIntent(input.intent)) {
    case "transactional":
      return [
        transactionalModifier
          ? `${visibleTopic} – ${transactionalModifier} | ${input.brand}`
          : `${visibleTopic} til ${audience ?? "event og arrangement"} | ${input.brand}`,
        `${visibleTopic} – booking og praktisk info | ${input.brand}`,
        audience ? `${input.brand} | ${visibleTopic} for ${audience}` : `${input.brand} | ${visibleTopic}`,
      ];
    case "commercial investigation":
      return [
        commercialSignal
          ? `${visibleTopic} – ${commercialSignal} og vurdering | ${input.brand}`
          : `${visibleTopic} – sammenlign alternativer | ${input.brand}`,
        angle
          ? `${visibleTopic} – ${angle} | ${input.brand}`
          : `${visibleTopic} – dette bør du vurdere | ${input.brand}`,
        `${input.brand} | ${visibleTopic}`,
      ];
    case "navigational":
      return [
        `${visibleTopic} | ${input.brand}`,
        angle ? `${visibleTopic} – ${angle} | ${input.brand}` : `${input.brand} – ${visibleTopic}`,
        `${input.brand} | ${visibleTopic} og kontakt`,
      ];
    case "informational":
    default:
      return [
        /[?]$/.test(visibleTopic)
          ? `${visibleTopic} | ${input.brand}`
          : detailCandidates[0]
            ? `${visibleTopic} – ${detailCandidates[0]} | ${input.brand}`
            : `${visibleTopic} | ${input.brand}`,
        detailCandidates[1]
          ? `${visibleTopic} – ${detailCandidates[1]} | ${input.brand}`
          : angle
            ? `${visibleTopic} – ${angle} | ${input.brand}`
            : `${input.brand} | ${visibleTopic}`,
        detailCandidates.length >= 2
          ? `${visibleTopic}: ${detailCandidates.slice(0, 2).join(" og ")} | ${input.brand}`
          : `${input.brand} | ${visibleTopic}`,
      ];
  }
}

function buildContentRecommendations(input: AidarInput): string[] {
  const business = inferPolicyBusinessContext(input);
  const policyRecommendations = buildPolicyRecommendations(input);
  const recommendations = [
    ...(input.searchInsights?.contentGaps ?? []),
    ...policyRecommendations,
    input.metrics && input.metrics.ctr < 0.03 && input.metrics.impressions >= 200
      ? "Gjør innledningen mer konkret: si hvem siden er for, hva brukeren lærer eller får, og hvorfor dette er relevant."
      : null,
    primaryIntent(input.intent) === "informational" && !input.page?.bodyText.toLowerCase().includes("forskjell")
      && !business.isBrandQuery
      ? "Legg inn et kort avsnitt som svarer direkte på forskjellen eller hovedpoenget brukeren søker etter."
      : null,
    primaryIntent(input.intent) === "commercial investigation"
      && !business.isBrandQuery
      ? "Legg inn en tydelig seksjon om forskjeller, prisnivå, hva som er inkludert og hvem løsningen passer for."
      : null,
    primaryIntent(input.intent) === "commercial investigation" && !(input.page?.bodyText.match(/\bpris|priser|kostnad|tilbud\b/i))
      && !business.isBrandQuery
      ? "Vis prisnivå, priseksempler eller hva som påvirker prisen, slik at siden hjelper brukeren å vurdere alternativene."
      : null,
    intentIncludes(input.intent, "transactional")
      && !business.isBrandQuery
      ? "Plasser CTA, kontaktpunkt eller forespørselsskjema høyere på siden, og gjør neste steg tydelig uten scrolling."
      : null,
    intentIncludes(input.intent, "transactional") && !(input.page?.bodyText.match(/\binkludert|pris|booking|bestill|forespørsel\b/i))
      && !business.isBrandQuery
      ? "Legg inn en konkret seksjon om hva som er inkludert, hvordan booking fungerer og hva brukeren bør oppgi ved forespørsel."
      : null,
    primaryIntent(input.intent) === "navigational"
      && !business.isBrandQuery
      ? "Gjør kontaktinfo, adresse, åpningstider eller lenken til riktig underside synlig høyt på siden."
      : null,
  ].filter((item): item is string => Boolean(item));

  return recommendations.filter((item, index, arr) => {
    const key = canonicalRecommendationKey(item);
    return arr.findIndex((candidate) => canonicalRecommendationKey(candidate) === key) === index;
  }).slice(0, 4);
}

function formatMetricsForPrompt(metrics: PagePerformanceMetrics | null): string {
  if (!metrics) {
    return "Ingen tilgjengelige ytelsesdata.";
  }

  const signals: string[] = [];
  if (metrics.impressions >= 1000) signals.push("høy trafikk");
  else if (metrics.impressions >= 200) signals.push("moderat trafikk");
  else signals.push("lav trafikk");

  signals.push(`${(metrics.ctr * 100).toFixed(1)}% CTR`);

  if (metrics.sessions > 0) {
    signals.push(`${metrics.sessions} sessioner`);
  }

  if (metrics.conversions === 0 && metrics.sessions >= 50) {
    signals.push("0 konverteringer");
  } else if (metrics.conversions > 0) {
    signals.push(`${metrics.conversions} konverteringer`);
    signals.push(`${(metrics.conversionRate * 100).toFixed(1)}% konverteringsrate`);
  }

  if (metrics.position > 0) {
    signals.push(`posisjon ${metrics.position.toFixed(1)}`);
  }

  return signals.join(", ");
}

export function generateFallbackAidarSuggestions(input: AidarInput): AidarSuggestions {
  const preferredWords = buildPreferredWordMap(input);
  const visibleTopic = pickTopic(input);
  const audience = shortAudience(input.intent, input.searchInsights);
  const angle = inferAngle(input);
  const topics = summarizeTopics(input);
  const rankedTitles = rankSuggestionDetails(
    unique(buildTitlesByIntent(input, visibleTopic, audience, angle))
    .map((item) => finalPolish(item, 60, preferredWords))
    .filter(Boolean)
    .slice(0, 6),
    "title",
    input,
    visibleTopic,
  );

  const rankedMetaDescriptions = rankSuggestionDetails(
    buildDescriptionsByIntent(visibleTopic, input)
    .map((item) => finalPolish(item, 155, preferredWords))
    .filter(Boolean)
    .slice(0, 4),
    "description",
    input,
    visibleTopic,
  );

  const titles = rankedTitles.slice(0, 1).map(({ text }) => text);
  const metaDescriptions = rankedMetaDescriptions.slice(0, 1).map(({ text }) => text);

  const contentRecommendations = buildContentRecommendations(input);
  const titleOptions = rankedTitles.slice(0, 1);
  const metaDescriptionOptions = rankedMetaDescriptions.slice(0, 1);

  const notes = unique([
    "Fallback-modusen velger ett beste forslag til tittel og ett beste forslag til metabeskrivelse.",
    "Aidar bruker synlig sideinnhold før søkefraser når han velger ordlyd.",
    topics.length ? `Aidar fant innholdssignaler som ${topics.join(", ")}.` : "Aidar fant få tydelige innholdssignaler på siden.",
  ]);

  return {
    agentName: "Aidar",
    mode: "fallback",
    model: null,
    titles,
    metaDescriptions,
    titleOptions,
    metaDescriptionOptions,
    contentRecommendations,
    notes,
  };
}

function buildPrompt(input: AidarInput) {
  const visibleTopic = pickTopic(input);
  const business = inferPolicyBusinessContext(input);
  const policyLines = buildPromptPolicyLines(input);
  const metricsSummary = formatMetricsForPrompt(input.metrics);
  const performanceInsights = generatePerformanceInsights(input.metrics);
  const primary = primaryIntent(input.intent);
  const secondary = secondaryIntent(input.intent);

  return {
    system: [
      "Du er Aidar, en AI-drevet SEO-ekspert og høyytelses-copywriter integrert i Aitool.",
      "Din oppgave er å generere ett perfekt forslag til Meta Title og ett perfekt forslag til Meta Description basert på de strukturerte dataene du får tildelt.",
      ...policyLines,
      "Du må skrive perfekt og idiomatisk bokmål.",
      "Ikke gjenta rare søkefraser ordrett hvis de høres unaturlige ut.",
      "Rett åpenbare feilformer uten å endre meningen, inkludert æ, ø og å.",
      "Du må aldri skrive former som 'ol' hvis innholdet tydelig viser 'øl', eller 'bor' hvis korrekt form er 'bør'.",
      "Bruk aldri ASCII-erstatninger som ae, oe eller aa når korrekt norsk form er æ, ø eller å.",
      "Ikke lever halvferdige fraser eller titler som stopper midt i en tanke.",
      "Du må aldri bruke selvrefererende emner som 'denne siden', 'her' eller 'side' som hovedtema i title eller meta description.",
      "Du må aldri skrive selvrefererende formuleringer som 'på godt norsk', 'vi forklarer', 'her forklarer vi', 'forklart enkelt' eller lignende kvalitetskommentarer om egen tekst.",
      "Metabeskrivelser må være ferdige snippet-tekster, aldri instruksjoner om at noe bør være synlig høyt på siden, samles ett sted eller hjelpe brukeren å finne ting raskt.",
      "Skriv for potensielle kunder eller brukere, ikke om teksten, siden eller skrivekvaliteten.",
      "Aldri finn på innhold som ikke finnes på siden.",
      "Unngå klisjeer som 'relevant info', 'neste steg', 'få et raskt overblikk' hvis det ikke blir konkret.",
      "Unngå oppstyltede fraser som 'forklart enkelt' hvis en mer presis formulering finnes.",
      "Hvis primær-intensjonen er TRANSACTIONAL eller COMMERCIAL, skal teksten være handlingsorientert, fristende og kommersiell.",
      "Hvis primær-intensjonen er INFORMATIONAL, skal teksten love svar på det brukeren lurer på, uten å bli tørr eller lærebokaktig.",
      "Når siden har både primær og sekundær intensjon, skal Meta Title domineres av primær-intensjonen og Meta Description kunne lene seg mot sekundær-intensjonen for å gjøre CTA-en skarpere.",
      "Hvis metrics viser høy trafikk men lav eller null konvertering, må meta-beskrivelsen kvalifisere og styre mot en tydelig CTA, ikke bare flere klikk.",
      "Hvis du får performance-alarmer med prefikser som ALARM_ eller MULIGHET_, skal de behandles som deterministiske diagnoser fra systemet og brukes aktivt i vurderingen.",
      "Meta Title: 50-60 tegn, aldri over 60. Bruk formatet [Hovedfokus/Søkeord] – [Brand] når det passer naturlig.",
      "Meta Description: 120-155 tegn, aldri over 155. Struktur: [verdiproposisjon] + [naturlig CTA].",
      "Skriv i aktiv form og gjerne direkte til brukeren med ord som 'du', 'se', 'opplev' når det passer.",
      "ALDRI bruk meta-språk som beskriver teksten selv, som 'med konkrete svar', 'med tydelige forklaringer' eller 'med konkrete punkter fra siden'.",
      "ALDRI start med 'Les om', 'Her finner du' eller 'Denne siden viser'. Gå rett på verdien.",
      "Hver setning skal være grammatisk komplett på feilfri, naturlig norsk.",
      "Svar kun som ren JSON med feltene meta_title, meta_description og justification.",
    ].join(" "),
    user: JSON.stringify({
      brand: input.brand,
      businessContext: business,
      intent: {
        primary,
        secondary,
      },
      currentPage: input.page
        ? {
            title: input.page.title,
            metaDescription: input.page.metaDescription,
            h1: input.page.h1,
            headings: input.page.headings.slice(0, 6),
            excerpt: input.page.bodyText.slice(0, 1200),
          }
        : null,
      visibleTopic,
      topQueries: input.queries,
      contentHighlights: input.searchInsights?.contentHighlights ?? [],
      metrics: {
        raw: input.metrics,
        summary: metricsSummary,
        conclusions: performanceInsights,
      },
    }),
  };
}

function normalizePayload(payload: AidarPayload): NormalizedAidarPayload {
  const rawTitles = [
    ...(payload.titles ?? []),
    ...(payload.meta_title ? [payload.meta_title] : []),
  ];
  const rawDescriptions = [
    ...(payload.metaDescriptions ?? []),
    ...(payload.meta_description ? [payload.meta_description] : []),
  ];
  const rawNotes = [
    ...(payload.notes ?? []),
    ...(payload.justification ? [payload.justification] : []),
  ];

  return {
    titles: unique(rawTitles.map((item) => ensureNaturalEnding(trimToSentenceOrPhrase(rewriteForLimit(polishNorwegianText(item), 60, "title"), 60), 60, "title")).filter(Boolean)).slice(0, 6),
    metaDescriptions: unique(rawDescriptions.map((item) => ensureNaturalEnding(trimToSentenceOrPhrase(rewriteForLimit(polishNorwegianText(item), 155, "description"), 155), 155, "description")).filter(Boolean)).slice(0, 4),
    contentRecommendations: unique((payload.contentRecommendations ?? []).map((item) => polishNorwegianText(item)).filter(Boolean)).slice(0, 4),
    notes: unique(rawNotes.map((item) => polishNorwegianText(item)).filter(Boolean)).slice(0, 4),
  };
}

async function callOpenAi(input: AidarInput): Promise<AidarSuggestions | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const prompt = buildPrompt(input);
  const model = process.env.OPENAI_METADATA_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Aidar API-feil: ${response.status}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Aidar API returnerte tomt svar.");
  }

  const parsed = normalizePayload(JSON.parse(content) as AidarPayload);
  if (!parsed.titles.length || !parsed.metaDescriptions.length) {
    throw new Error("Aidar API returnerte ufullstendige metadata.");
  }

  const visibleTopic = pickTopic(input);

  return {
    agentName: "Aidar",
    mode: "openai",
    model,
    titles: rankSuggestions(parsed.titles, "title", input, visibleTopic).slice(0, 3),
    metaDescriptions: rankSuggestions(parsed.metaDescriptions, "description", input, visibleTopic).slice(0, 2),
    titleOptions: rankSuggestionDetails(parsed.titles, "title", input, visibleTopic).slice(0, 3),
    metaDescriptionOptions: rankSuggestionDetails(parsed.metaDescriptions, "description", input, visibleTopic).slice(0, 2),
    contentRecommendations: parsed.contentRecommendations ?? [],
    notes: parsed.notes ?? [],
  };
}

export async function generateAidarSuggestions(input: AidarInput): Promise<AidarSuggestions> {
  try {
    const aiResult = await callOpenAi(input);
    if (aiResult) {
      return aiResult;
    }
  } catch {
    // Fall back to deterministic local suggestions below.
  }

  return generateFallbackAidarSuggestions(input);
}
