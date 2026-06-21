import type { PageIntent, PagePerformanceMetrics, PageSearchInsights, SearchIntent } from "@/lib/types";
import { extractTextTokens } from "@/lib/utils";

export type PolicyQueryStat = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type PolicyPageContext = {
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  headings: string[];
  firstParagraph: string;
  bodyText: string;
  hasContactLink: boolean;
};

export type AidarPolicyInput = {
  domain: string;
  brand: string;
  keyword: string;
  intent: SearchIntent | PageIntent;
  page: PolicyPageContext | null;
  queries: PolicyQueryStat[];
  searchInsights: PageSearchInsights | null;
  metrics: PagePerformanceMetrics | null;
};

function primaryIntent(intent: SearchIntent | PageIntent): SearchIntent {
  return typeof intent === "string" ? intent : intent.primary;
}

function secondaryIntent(intent: SearchIntent | PageIntent): SearchIntent | null {
  return typeof intent === "string" ? null : intent.secondary ?? null;
}

export type BusinessContext = {
  industry: string;
  tone: string;
  isNightlife: boolean;
  isRestaurant: boolean;
  isBrandQuery: boolean;
  nightlifeQueryMode: "brand-action" | "generic-discovery" | "default";
  isHomePage: boolean;
};

export const GENERIC_TITLE_PATTERNS = [
  /\bdet du bør vite\b/gi,
  /\bdette bør du vite\b/gi,
  /\bfor deg som vil forstå temaet\b/gi,
  /\bdeg som vil forstå temaet\b/gi,
];

export const GENERIC_DESCRIPTION_PATTERNS = [
  /\bLær mer om\b/gi,
  /\bhva som er viktig å vite før du velger\b/gi,
  /\bdet viktigste du bør vite før du tar et valg\b/gi,
  /\bhva som påvirker valget\b/gi,
  /\bhva som skiller alternativene\b/gi,
  /\bfør du tar et valg\b/gi,
  /\bforstå temaet\b/gi,
  /\bsamlet høyt på siden\b/gi,
  /\bslik at .* finner det de trenger\b/gi,
  /\bsynlig før brukeren må lete videre\b/gi,
];

function normalizedUnique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const cleaned = item.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

export function inferBusinessContext(input: AidarPolicyInput): BusinessContext {
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
    ...input.queries.map((item) => item.query),
  ].join(" ").toLowerCase();

  const isNightlife = /\bnight\s?club|nightclub|uteliv|utested|diskotek|gjesteliste|vip|bordbooking|flaskeservice|club|rooftop\b/i.test(source);
  const isRestaurant = /\brestaurant|restauran|meny|middag|lunsj|vinliste|bordreservasjon|booking\b/i.test(source) && !isNightlife;
  const industry = isNightlife ? "nattklubb" : isRestaurant ? "restaurant" : "servering og opplevelser";
  const tone = isNightlife ? "eksklusiv, inviterende, festfokusert" : isRestaurant ? "inspirerende, appetittvekkende, inviterende" : "tydelig, menneskelig, konverteringsfokusert";

  const brandTokens = new Set(extractTextTokens(`${input.brand} ${input.domain}`));
  const queryTokens = extractTextTokens(input.searchInsights?.primaryQuery ?? input.keyword);
  const nonBrandTokens = queryTokens.filter((token) => !brandTokens.has(token));
  const brandLikeServiceTokens = new Set(["oslo", "nightclub", "night", "club", "rooftop", "bar"]);
  const remainingNonBrandTokens = nonBrandTokens.filter((token) => !brandLikeServiceTokens.has(token));
  const isBrandQuery = queryTokens.length > 0 && remainingNonBrandTokens.length === 0;
  const isHomePage = (() => {
    try {
      return input.page?.url ? new URL(input.page.url).pathname === "/" : false;
    } catch {
      return false;
    }
  })();
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

function intentProfileText(intent: SearchIntent | PageIntent): string {
  if (typeof intent === "string") {
    return intent;
  }

  return intent.secondary ? `${intent.primary} (sekundær: ${intent.secondary})` : intent.primary;
}

function nightlifeCity(input: AidarPolicyInput): string {
  const source = [input.domain, input.keyword, input.page?.title ?? "", input.page?.h1 ?? ""].join(" ");
  return /\boslo\b/i.test(source) ? "Oslo" : "Oslo";
}

function nightlifeHomeConcept(input: AidarPolicyInput): string {
  const source = [input.page?.title ?? "", input.page?.h1 ?? "", ...(input.page?.headings ?? [])].join(" ");
  if (/\brooftop\b/i.test(source) && /\bnight\s?club|nightclub\b/i.test(source)) return "Rooftop & Nightclub";
  if (/\brooftop\b/i.test(source)) return "Rooftop";
  if (/\bnight\s?club|nightclub\b/i.test(source)) return "Nightclub";
  return "Nattklubb";
}

function nightlifeValueHook(input: AidarPolicyInput): string {
  const haystack = [
    ...(input.page?.headings ?? []),
    ...(input.searchInsights?.contentHighlights ?? []),
    input.page?.firstParagraph ?? "",
    input.page?.bodyText.slice(0, 500) ?? "",
  ].join(" ");

  if (/\btakterrasse|rooftop\b/i.test(haystack)) return "Oslos råeste takterrasse";
  if (/\bgjesteliste|guestlist\b/i.test(haystack)) return "Bestill bord og sikre gjesteliste";
  if (/\bdj|live|konsept|club concept\b/i.test(haystack)) return "DJ-konsepter, utsikt og sen kveld";
  if (/\båpningstider|opening hours\b/i.test(haystack)) return "Bestill bord og se åpningstider";
  return "Bestill bord og se åpningstider";
}

function criticalVenueSignals(input: AidarPolicyInput): string[] {
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
  if (!/\bmeny|menu|drink|cocktail|flaske|bottle service\b/i.test(haystack)) missing.push("meny");
  return missing;
}

function detailSignal(input: AidarPolicyInput, patterns: RegExp[]): string | null {
  const haystack = [
    ...(input.page?.headings ?? []),
    ...(input.searchInsights?.contentHighlights ?? []),
    input.page?.firstParagraph ?? "",
    input.page?.bodyText.slice(0, 500) ?? "",
  ].join(" ");

  return patterns.some((pattern) => pattern.test(haystack)) ? haystack : null;
}

function firstContentHighlights(input: AidarPolicyInput): string[] {
  return normalizedUnique([
    ...(input.searchInsights?.contentHighlights ?? []),
    ...(input.page?.headings ?? []),
  ])
    .map((item) => item.replace(/\s+[|\-–:].*$/, "").trim())
    .filter((item) => item.length >= 4 && item.length <= 60)
    .slice(0, 3);
}

export function buildPolicyTitles(input: AidarPolicyInput, visibleTopic: string): string[] | null {
  const business = inferBusinessContext(input);
  const highlights = firstContentHighlights(input);

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

  if (business.isRestaurant && business.isHomePage) {
    const city = nightlifeCity(input);
    const concept = /\brooftop\b/i.test([input.page?.title ?? "", input.page?.h1 ?? ""].join(" ")) ? "Rooftop Restaurant" : "Restaurant";
    const hook = /\bmeny|menu\b/i.test([...(input.page?.headings ?? []), input.page?.firstParagraph ?? ""].join(" "))
      ? "Se meny og bestill bord"
      : "Bestill bord";
    return [
      `${input.brand} ${concept} ${city} | ${hook}`,
      `${input.brand} | ${concept} i ${city} – ${hook}`,
      `${input.brand} ${city} | ${concept} – ${hook}`,
    ];
  }

  if (business.isBrandQuery && business.isRestaurant) {
    return [
      `${input.brand} – bestill bord og se meny`,
      `${input.brand} – åpningstider og bordreservasjon`,
      `${input.brand} | meny, åpningstider og booking`,
    ];
  }

  if (business.isBrandQuery) {
    return [
      `${input.brand} – åpningstider og kontakt`,
      `${input.brand} | adresse, åpningstider og booking`,
      `${input.brand} – se meny og praktisk info`,
    ];
  }

  if ((business.isNightlife || business.isRestaurant) && highlights.length >= 2) {
    return [
      `${visibleTopic} – ${highlights[0]} og ${highlights[1]} | ${input.brand}`,
      `${visibleTopic} i ${nightlifeCity(input)} | ${highlights[0]}`,
      `${visibleTopic} – ${highlights[0]} | ${input.brand}`,
    ];
  }

  return null;
}

export function buildPolicyDescriptions(input: AidarPolicyInput, topic: string): string[] | null {
  const business = inferBusinessContext(input);

  if (business.isNightlife && business.nightlifeQueryMode === "brand-action") {
    return [
      `${topic} hos ${input.brand}. Se åpningstider, bordbooking, meny og praktisk info før du planlegger kvelden i Oslo.`,
      `${input.brand} i Oslo med booking, gjesteliste, adresse og informasjon om kveldens opplevelse før du drar ut.`,
    ];
  }

  if (business.isNightlife && business.nightlifeQueryMode === "generic-discovery") {
    return [
      `${topic} i ${nightlifeCity(input)} med atmosfære, bildegalleri, DJ-konsepter og anmeldelser som hjelper deg å velge riktig sted for kvelden.`,
      `Sammenlign ${topic.toLowerCase()} med fokus på stemning, musikkprofil, bilder og omtaler før du velger utested i ${nightlifeCity(input)}.`,
    ];
  }

  if (business.isRestaurant && business.isBrandQuery) {
    return [
      `Se meny, åpningstider og bordreservasjon hos ${input.brand} før du planlegger besøket.`,
      `Se meny, bestill bord og finn praktisk informasjon hos ${input.brand} før du planlegger besøket.`,
    ];
  }

  if (business.isBrandQuery) {
    return [
      `Finn åpningstider, adresse, kontakt og praktisk informasjon om ${input.brand} på ett sted.`,
      `Finn åpningstider, kontakt og det viktigste om ${input.brand} raskt på én side.`,
    ];
  }

  return null;
}

export function buildPolicyRecommendations(input: AidarPolicyInput): string[] {
  const business = inferBusinessContext(input);
  const missingVenueSignals = business.isNightlife || business.isRestaurant ? criticalVenueSignals(input) : [];
  const recommendations: string[] = [];

  if (business.isBrandQuery && missingVenueSignals.includes("åpningstider")) {
    recommendations.push("Legg inn åpningstider tydelig høyt på siden, siden merkevaresøk ofte handler om å planlegge besøk raskt.");
  }
  if (business.isBrandQuery && missingVenueSignals.includes("meny")) {
    recommendations.push("Vis meny, drikkemeny eller hva som tilbys på stedet, siden dette er kritisk informasjon for merkevaresøk.");
  }
  if (business.isBrandQuery && missingVenueSignals.includes("aldersgrense")) {
    recommendations.push("Gjør aldersgrensen synlig på siden, slik at gjestene finner viktig besøksinfo uten å måtte lete.");
  }
  if (business.isBrandQuery && missingVenueSignals.includes("kleskode")) {
    recommendations.push("Legg inn kleskode eller dørpolicy hvis dette gjelder, siden gjester ofte leter etter slik praktisk info før besøk.");
  }
  if (business.isNightlife && business.nightlifeQueryMode === "brand-action") {
    recommendations.push("Flytt booking, adresse, åpningstider og meny høyere opp på siden, slik at handlingsorienterte merkevaresøk får svar uten scrolling.");
  }
  if (business.isNightlife && business.nightlifeQueryMode === "generic-discovery" && !(input.page?.bodyText.match(/\bbilde|galleri|gallery|foto\b/i))) {
    recommendations.push("Vis frem atmosfæren med et tydelig bildegalleri eller store stemningsbilder, siden generiske utelivssøk handler om oppdagelse og førsteinntrykk.");
  }
  if (business.isNightlife && business.nightlifeQueryMode === "generic-discovery" && !(input.page?.bodyText.match(/\bdj|musikk|konsept|lineup\b/i))) {
    recommendations.push("Legg inn en seksjon om DJ-konsepter, musikkprofil eller hva slags kvelder stedet er kjent for.");
  }
  if (business.isNightlife && business.nightlifeQueryMode === "generic-discovery" && !(input.page?.bodyText.match(/\banmeld|omtale|review|testimonial\b/i))) {
    recommendations.push("Vis anmeldelser, omtaler eller sosiale bevis som gjør det lettere å sammenligne stedet med andre alternativer.");
  }

  return normalizedUnique(recommendations).slice(0, 4);
}

export function buildPromptPolicyLines(input: AidarPolicyInput): string[] {
  const business = inferBusinessContext(input);
  const secondary = secondaryIntent(input.intent);

  return [
    `Du analyserer GSC- og GA-data for domenet ${input.domain}. Bransje: ${business.industry}. Tone: ${business.tone}.`,
    `Intent-profil: ${intentProfileText(input.intent)}.`,
    secondary
      ? `Når siden har både primær og sekundær intent, skal Meta Title først og fremst speile ${primaryIntent(input.intent)}, mens Meta Description kan lene seg mot ${secondary} hvis det gjør CTA-en tydeligere.`
      : `Bruk ${primaryIntent(input.intent)} som styrende intent for både Meta Title og Meta Description.`,
    "ALDRI bruk generiske fraser som 'det du bør vite', 'guide', 'lær mer om', 'hva som er viktig å vite', 'før du tar et valg' eller 'forstå temaet'.",
    "Metabeskrivelsen skal være en ferdig snippet-tekst som kan publiseres direkte, ikke en instruks om hvor innhold bør plasseres på siden eller hvordan teksten bør fungere.",
    "Unngå formuleringer som 'samlet høyt på siden', 'synlig før brukeren må lete', 'slik at gjestene finner det de trenger' og andre redaksjonelle instrukser.",
    "Bruk synlig sideinnhold som fasit for ordvalg. Bruk GSC/GA4 bare som signal om intensjon og behov.",
    "Hvis søkeordet er merkevarepreget, skal du fokusere på konvertering, åpningstider, meny/drikke, adresse og praktisk besøksinformasjon.",
    "Hvis toppsøket er merkevare som '[Brand]', '[Brand] Oslo' eller '[Brand] Rooftop', er intensjonen handling. Tiltaket skal være booking, adresse, åpningstider og menyer ekstremt synlig høyt på siden.",
    "Hvis søket er generisk som 'nattklubb oslo' eller 'rooftop bar oslo', er intensjonen oppdagelse og sammenligning. Vis frem atmosfære, bildegalleri, DJ-konsepter og anmeldelser.",
    "Bruk bransjespesifikke KPI-er og CTA-er når de passer innholdet, som Rooftop, Nattklubb, Oslo, Selskapslokale, Bestill bord, Se meny, Aldersgrense og Åpningstider.",
    "Foreslå bare innholdsendringer når siden faktisk mangler kritisk informasjon som brukeren leter etter.",
    "Hvis sidetypen er forside, bruk title-strukturen [Merkevare] | [Hovedkonsept] i [By] – [Unikt verdiargument / CTA].",
  ];
}
