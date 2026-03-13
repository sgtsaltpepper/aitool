export type ProviderId =
  | "openai"
  | "google"
  | "bing"
  | "perplexity"
  | "citation";

export type AuditStatus = "queued" | "running" | "completed" | "failed";

export type CategoryId =
  | "crawlabilityIndexation"
  | "renderingAiAccessibility"
  | "answerFirstContent"
  | "citationAuthorityEntitySignals"
  | "schemaSemanticSearch"
  | "internalLinking"
  | "searchIntentTopicClusters"
  | "zeroClickAiOverviews"
  | "contentFreshness"
  | "technicalOptimization";

export type Priority = "critical" | "high" | "medium" | "low";
export type EffortLevel = "Quick wins" | "Middels innsats" | "Strategiske endringer";
export type RecommendationImpact = "Høy" | "Middels" | "Lav";
export type SearchIntent =
  | "informational"
  | "commercial investigation"
  | "transactional"
  | "navigational";

export type AuditRequestInput = {
  targetUrl: string;
  locale: string;
  country: string;
  competitorUrls: string[];
  maxPages: number;
};

export type AuditRunSummary = {
  totalScore: number;
  categoryScores: CategoryScore[];
  providerScores: ProviderScore[];
  totalPages: number;
  issueCount: number;
  targetUrl: string;
};

export type AuditRunRecord = {
  id: string;
  targetUrl: string;
  status: AuditStatus;
  request: AuditRequestInput;
  summary: AuditRunSummary | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
};

export type RobotsEvaluation = {
  generalAllowed: boolean;
  blockedProviders: ProviderId[];
  blockedAgents: string[];
};

export type SchemaSummary = {
  types: string[];
  itemCount: number;
  matchesVisibleContent: boolean;
  rawItems: unknown[];
};

export type RenderingSnapshot = {
  rawTextLength: number;
  renderedTextLength: number | null;
  renderDeltaRatio: number | null;
  renderingModel: "ssr" | "hybrid" | "csr" | "unknown";
  extractedTextPreview: string;
  errors: string[];
};

export type PageSnapshot = {
  url: string;
  path: string;
  discoveredFrom: "seed" | "sitemap" | "internal";
  statusCode: number | null;
  contentType: string | null;
  canonicalUrl: string | null;
  robotsMeta: string[];
  xRobotsTag: string[];
  title: string;
  metaDescription: string;
  h1: string;
  headings: string[];
  firstParagraph: string;
  bodyText: string;
  rawHtmlBytes: number;
  scriptCount: number;
  wordCount: number;
  paragraphCount: number;
  listCount: number;
  tableCount: number;
  faqCount: number;
  definitionLikeBlocks: number;
  internalLinks: string[];
  externalLinks: string[];
  brokenInternalLinks: string[];
  inboundLinks: number;
  clickDepth: number;
  schema: SchemaSummary;
  imagesWithoutAlt: number;
  imageCount: number;
  hasTranscriptSignals: boolean;
  author: string | null;
  publisher: string | null;
  hasAboutLink: boolean;
  hasContactLink: boolean;
  datePublished: string | null;
  dateModified: string | null;
  snippetDirectives: {
    noSnippet: boolean;
    maxSnippet: number | null;
    dataNoSnippet: boolean;
  };
  robotsEvaluation: RobotsEvaluation;
  blockedByRobots: boolean;
  noindex: boolean;
  rendering: RenderingSnapshot;
  answerFirstSignals: {
    conciseOpening: boolean;
    hasFaq: boolean;
    hasTable: boolean;
    hasList: boolean;
    directAnswerLikelihood: number;
  };
};

export type CategoryScore = {
  id: CategoryId;
  label: string;
  weight: number;
  score: number;
  summary: string;
};

export type Issue = {
  id: string;
  category: string;
  title: string;
  description: string;
  priority: Priority;
  affectedUrls: string[];
  providerImpact: ProviderId[];
};

export type Recommendation = {
  id: string;
  effort: EffortLevel;
  impact: RecommendationImpact;
  title: string;
  rationale: string;
  target: string;
  providers: ProviderId[];
  action: string;
};

export type TopicCluster = {
  id: string;
  name: string;
  intent: SearchIntent;
  score: number;
  pages: string[];
  missingCoverage: string[];
  averageSimilarity: number;
};

export type ProviderScore = {
  provider: ProviderId;
  label: string;
  score: number;
  summary: string;
  blockers: string[];
  opportunities: string[];
};

export type CompetitiveGap = {
  category: string;
  gapType:
    | "schema-gap"
    | "freshness-gap"
    | "topic-gap"
    | "answer-first-gap"
    | "coverage-gap";
  targetMetric: number;
  competitorMetric: number;
  insight: string;
};

export type CompetitiveContext = {
  competitors: {
    domain: string;
    pages: number;
    averageFreshness: number;
    averageAnswerFirst: number;
    schemaCoverage: number;
    clusters: string[];
  }[];
  gaps: CompetitiveGap[];
};

export type ReportComparison = {
  previousRunId: string | null;
  totalScoreDelta: number | null;
  categoryDeltas: Array<{
    id: CategoryId;
    delta: number;
  }>;
};

export type AuditReport = {
  runId: string;
  request: AuditRequestInput;
  generatedAt: string;
  totalScore: number;
  summary: string;
  categoryScores: CategoryScore[];
  providerScores: ProviderScore[];
  issues: Issue[];
  recommendations: Recommendation[];
  pages: PageSnapshot[];
  topicClusters: TopicCluster[];
  competitiveContext: CompetitiveContext | null;
  comparison: ReportComparison;
};
