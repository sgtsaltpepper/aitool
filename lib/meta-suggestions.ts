import type {
  PagePerformanceMetrics,
  PageSearchInsights,
  PageSnapshot,
  SearchIntent,
  SearchQueryInsight,
} from "@/lib/types";
import { extractTextTokens, humanPath, unique } from "@/lib/utils";

type QueryStat = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type AudienceProfile = {
  audience: string;
  qualifier: string;
};

type MinimalPage = Pick<
  PageSnapshot,
  "url" | "path" | "title" | "metaDescription" | "h1" | "headings" | "firstParagraph" | "bodyText" | "hasContactLink" | "answerFirstSignals"
>;

export type MetaSuggestionInput = {
  page: MinimalPage | null;
  domain: string;
  intent: SearchIntent;
  keyword: string;
  brand: string;
  queries: QueryStat[];
  metrics: PagePerformanceMetrics | null;
};

const CONTENT_SIGNAL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "priser", pattern: /\bpris|priser|kostnad|tilbud\b/i },
  { label: "booking", pattern: /\bbooking|bestill|reservasjon|book\b/i },
  { label: "meny", pattern: /\bmeny|menu|retter|drikke\b/i },
  { label: "åpningstider", pattern: /\båpningstider|open|hours\b/i },
  { label: "adresse", pattern: /\badresse|vei|kart|parkering|finn\b/i },
  { label: "FAQ", pattern: /\bfaq|spørsmål|vanlige spørsmål\b/i },
  { label: "bilder", pattern: /\bgalleri|bilder|foto\b/i },
  { label: "kundecaser", pattern: /\bcase|referanse|kundehistorie\b/i },
  { label: "anbefalinger", pattern: /\banmeldelse|omtale|testimonial\b/i },
];

const AUDIENCE_PATTERNS: Array<{ pattern: RegExp; profile: AudienceProfile }> = [
  {
    pattern: /\bbedrift|bedriftsarrangement|firmafest|konferanse|kickoff|seminar\b/i,
    profile: { audience: "bedrifter og arrangører", qualifier: "for bedrifter og arrangører" },
  },
  {
    pattern: /\bbryllup|bursdag|julebord|jubileum|konfirmasjon|privat\b/i,
    profile: { audience: "private arrangementer", qualifier: "for private arrangementer" },
  },
  {
    pattern: /\bmeny|middag|lunsj|brunch|restaurant|kafe\b/i,
    profile: { audience: "gjester som planlegger besøk", qualifier: "før besøket" },
  },
  {
    pattern: /\bpris|priser|kostnad|tilbud|book|bestill|booking\b/i,
    profile: { audience: "brukere som vurderer å ta kontakt", qualifier: "med priser og neste steg" },
  },
  {
    pattern: /\bhva er|hvordan|guide|tips|forklaring\b/i,
    profile: { audience: "brukere som vil forstå temaet", qualifier: "forklart enkelt" },
  },
];

function trimToLength(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return truncated.slice(0, lastSpace > 20 ? lastSpace : maxLength).trim();
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function chooseVisibleKeyword(primary: string, alternatives: string[]): string {
  const normalizedPrimary = extractTextTokens(primary).join(" ");

  for (const alternative of alternatives) {
    const cleaned = alternative.replace(/\s+[|\-–:].*$/, "").trim();
    if (!cleaned) {
      continue;
    }
    const normalizedAlternative = extractTextTokens(cleaned).join(" ");
    if (normalizedAlternative && normalizedAlternative === normalizedPrimary) {
      return cleaned;
    }
    if (/[æøå]/i.test(cleaned) && normalizedAlternative.includes(normalizedPrimary)) {
      return cleaned;
    }
  }

  return primary;
}

function summarizeList(items: string[]): string {
  if (!items.length) {
    return "";
  }
  if (items.length === 1) {
    return items[0]!;
  }
  if (items.length === 2) {
    return `${items[0]} og ${items[1]}`;
  }
  return `${items[0]}, ${items[1]} og ${items[2]}`;
}

function cleanHeading(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[|:–-].*$/, "")
    .trim();
}

function extractBrandTokens(brand: string, domain: string): string[] {
  return unique(
    extractTextTokens(`${brand} ${domain}`)
      .map((token) => token.replace(/^www/, ""))
      .filter((token) => token.length > 2),
  );
}

function detectContentHighlights(page: MinimalPage | null): string[] {
  if (!page) {
    return [];
  }

  const source = [page.title, page.h1, page.headings.join(" "), page.firstParagraph].join(" ");
  const highlights = CONTENT_SIGNAL_PATTERNS
    .filter((item) => item.pattern.test(source))
    .map((item) => item.label);

  if (highlights.length) {
    return unique(highlights).slice(0, 3);
  }

  return unique(
    page.headings
      .map(cleanHeading)
      .filter((heading) => heading.length >= 4 && heading.length <= 40)
      .slice(0, 3),
  );
}

function detectAudience(intent: SearchIntent, queries: QueryStat[], highlights: string[]): AudienceProfile | null {
  const haystack = `${queries.map((item) => item.query).join(" ")} ${highlights.join(" ")}`;
  for (const rule of AUDIENCE_PATTERNS) {
    if (rule.pattern.test(haystack)) {
      return rule.profile;
    }
  }

  if (intent === "transactional") {
    return { audience: "brukere som er klare for å ta neste steg", qualifier: "med tydelig neste steg" };
  }
  if (intent === "commercial investigation") {
    return { audience: "brukere som sammenligner alternativer", qualifier: "for brukere som sammenligner" };
  }
  if (intent === "informational") {
    return { audience: "brukere som vil forstå temaet", qualifier: "forklart enkelt" };
  }

  return null;
}

function buildQueryInsights(
  queries: QueryStat[],
  contentTokens: Set<string>,
  brandTokens: string[],
): SearchQueryInsight[] {
  return queries.slice(0, 5).map((item) => {
    const queryTokens = extractTextTokens(item.query).filter((token) => !brandTokens.includes(token));
    const matchedTerms = unique(queryTokens.filter((token) => contentTokens.has(token)));
    const missingTerms = unique(queryTokens.filter((token) => !contentTokens.has(token)));
    const inContent = matchedTerms.length >= Math.max(1, Math.ceil(queryTokens.length / 2));

    return {
      query: item.query,
      impressions: item.impressions,
      clicks: item.clicks,
      ctr: item.ctr,
      position: item.position,
      inContent,
      matchedTerms,
      missingTerms,
    };
  });
}

function pickSupportingModifier(insights: PageSearchInsights, keyword: string): string | null {
  const keywordTokens = new Set(extractTextTokens(keyword));

  for (const query of insights.topQueries) {
    const candidate = query.missingTerms.concat(query.matchedTerms).find((term) => !keywordTokens.has(term) && term.length > 2);
    if (candidate) {
      return candidate;
    }
  }

  return insights.contentHighlights[0] ?? null;
}

function buildContentGapRecommendations(
  input: MetaSuggestionInput,
  insights: PageSearchInsights,
): string[] {
  const recommendations: string[] = [];

  for (const query of insights.topQueries) {
    if (!query.inContent && query.impressions >= 20) {
      recommendations.push(`Legg inn en egen seksjon som svarer tydelig på «${query.query}», siden dette søket får visninger uten å være godt nok dekket i innholdet.`);
    }
    if (query.missingTerms.some((term) => /pris|priser|kostnad/i.test(term))) {
      recommendations.push("Vis prisnivå eller forklar hva som påvirker prisen, slik at siden matcher prisrelaterte søk bedre.");
    }
    if (query.missingTerms.some((term) => /åpningstider|adresse|parkering|kontakt/i.test(term))) {
      recommendations.push("Legg inn praktisk informasjon som åpningstider, adresse eller kontakt tidlig på siden når dette er noe søkerne ser etter.");
    }
  }

  if (input.metrics && input.metrics.impressions >= 300 && input.metrics.ctr < 0.03) {
    recommendations.push("Spiss åpningen med hvem siden er for, hva brukeren får og hvorfor siden er relevant, slik at søkeresultatet blir mer klikkverdig.");
  }
  if (input.metrics && input.metrics.sessions >= 100 && input.metrics.conversionRate < 0.01 && input.intent !== "informational") {
    recommendations.push("Flytt CTA høyere opp og gjør neste steg synlig i innholdet, siden siden får trafikk uten å konvertere godt nok.");
  }
  if (input.page && !input.page.answerFirstSignals.hasFaq && input.queries.some((item) => /\?|hvordan|hva|kan|når/i.test(item.query))) {
    recommendations.push("Legg til en FAQ-seksjon som svarer på spørsmålene brukerne faktisk søker etter.");
  }

  return unique(recommendations).slice(0, 4);
}

export function buildPageSearchInsights(input: MetaSuggestionInput): PageSearchInsights | null {
  const contentText = input.page
    ? [input.page.title, input.page.h1, input.page.headings.join(" "), input.page.firstParagraph, input.page.bodyText.slice(0, 800)].join(" ")
    : `${input.keyword} ${humanPath(`https://${input.domain}/`)}`;
  const contentTokens = new Set(extractTextTokens(contentText));
  const brandTokens = extractBrandTokens(input.brand, input.domain);
  const contentHighlights = detectContentHighlights(input.page);
  const audienceProfile = detectAudience(input.intent, input.queries, contentHighlights);
  const topQueries = buildQueryInsights(input.queries, contentTokens, brandTokens);

  return {
    audience: audienceProfile?.audience ?? null,
    audienceQualifier: audienceProfile?.qualifier ?? null,
    primaryQuery: topQueries[0]?.query ?? null,
    contentHighlights,
    contentGaps: buildContentGapRecommendations(input, {
      audience: audienceProfile?.audience ?? null,
      audienceQualifier: audienceProfile?.qualifier ?? null,
      primaryQuery: topQueries[0]?.query ?? null,
      contentHighlights,
      contentGaps: [],
      topQueries,
      metrics: input.metrics,
    }),
    topQueries,
    metrics: input.metrics,
  };
}

export function buildAudienceAwareTitles(input: MetaSuggestionInput, insights: PageSearchInsights | null): string[] {
  const highlights = insights?.contentHighlights ?? [];
  const modifier = insights ? pickSupportingModifier(insights, input.keyword) : null;
  const qualifier = insights?.audienceQualifier;
  const visibleKeyword = chooseVisibleKeyword(
    input.keyword,
    [input.page?.h1 ?? "", input.page?.title ?? "", insights?.primaryQuery ?? ""],
  );

  const candidates = [
    input.intent === "transactional"
      ? `${visibleKeyword} ${qualifier ?? "med priser og bestilling"} | ${input.brand}`
      : `${visibleKeyword} ${qualifier ?? ""} | ${input.brand}`.replace(/\s+\|/, " |"),
    modifier
      ? `${visibleKeyword} – ${titleCase(modifier)} og relevant info | ${input.brand}`
      : `${input.keyword} – ${highlights[0] ?? "relevant info"} | ${input.brand}`,
    highlights.length
      ? `${input.brand} – ${visibleKeyword} med ${summarizeList(highlights).toLowerCase()}`
      : `${input.brand} – ${visibleKeyword}`,
  ];

  return unique(candidates.map((item) => trimToLength(item, 60))).filter(Boolean).slice(0, 3);
}

export function buildAudienceAwareDescriptions(input: MetaSuggestionInput, insights: PageSearchInsights | null): string[] {
  const audience = insights?.audience;
  const highlights = insights?.contentHighlights ?? [];
  const highlightText = highlights.length ? summarizeList(highlights) : "praktisk informasjon";
  const visibleKeyword = chooseVisibleKeyword(
    input.keyword,
    [input.page?.h1 ?? "", input.page?.title ?? "", insights?.primaryQuery ?? ""],
  );
  const queryIntro = `Leter du etter ${visibleKeyword.toLowerCase()}? `;
  const action = input.intent === "transactional"
    ? (input.page?.hasContactLink ? "Ta neste steg og kontakt oss." : "Se hvordan du går videre.")
    : input.intent === "commercial investigation"
      ? "Finn ut om dette passer for ditt behov."
      : "Få et raskt overblikk før du går videre.";

  const candidates = [
    `${queryIntro}${input.brand} hjelper ${audience ?? "relevante brukere"} med ${visibleKeyword.toLowerCase()}. Se ${highlightText.toLowerCase()} på siden. ${action}`,
    `${visibleKeyword} hos ${input.brand}. Siden dekker ${highlightText.toLowerCase()} og er laget for ${audience ?? "brukere som vil ha et tydelig svar"}. ${action}`,
  ];

  return unique(candidates.map((item) => trimToLength(item, 155))).filter(Boolean).slice(0, 2);
}
