import type { CategoryId, ProviderId } from "@/lib/types";

export const DEFAULT_LOCALE = "nb-NO";
export const DEFAULT_COUNTRY = "NO";
export const DEFAULT_MAX_PAGES = 150;
export const MAX_COMPETITOR_PAGES = 30;
export const MAX_RENDER_CHECKS = 5;
export const TARGET_CRAWL_CONCURRENCY = 5;
export const COMPETITOR_CRAWL_CONCURRENCY = 3;

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  crawlabilityIndexation: "Kan siden oppdages og indekseres?",
  renderingAiAccessibility: "Er innholdet lett å lese for botene?",
  answerFirstContent: "Kommer siden raskt til svaret?",
  citationAuthorityEntitySignals: "Viser siden tydelig hvem som står bak?",
  schemaSemanticSearch: "Bruker siden strukturerte data godt?",
  internalLinking: "Henger sidene godt sammen internt?",
  searchIntentTopicClusters: "Dekker innholdet søkeintensjon og temaer godt?",
  zeroClickAiOverviews: "Er siden klar for snippets og AI-sammendrag?",
  contentFreshness: "Virker innholdet oppdatert?",
  technicalOptimization: "Er de tekniske grunnsignalene på plass?",
};

export const CATEGORY_WEIGHTS: Record<CategoryId, number> = {
  crawlabilityIndexation: 16,
  renderingAiAccessibility: 14,
  answerFirstContent: 12,
  citationAuthorityEntitySignals: 10,
  schemaSemanticSearch: 10,
  internalLinking: 10,
  searchIntentTopicClusters: 10,
  zeroClickAiOverviews: 8,
  contentFreshness: 5,
  technicalOptimization: 5,
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "ChatGPT / OpenAI Search",
  google: "Google Search / Gemini",
  bing: "Microsoft Copilot / Bing",
  perplexity: "Perplexity",
  citation: "Andre citation-first assistenter",
};

export const PROVIDER_AGENTS: Record<ProviderId, string[]> = {
  openai: ["OAI-SearchBot", "GPTBot"],
  google: ["Googlebot", "GoogleOther"],
  bing: ["bingbot"],
  perplexity: ["PerplexityBot"],
  citation: ["*"],
};
