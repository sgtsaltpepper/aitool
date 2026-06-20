export type ProviderId =
  | "openai"
  | "google"
  | "bing"
  | "perplexity"
  | "citation";

export type AuditStatus = "queued" | "running" | "completed" | "failed";
export type AuditPhase =
  | "queued"
  | "discovering"
  | "crawling"
  | "rendering"
  | "analyzing"
  | "benchmarking"
  | "finalizing"
  | "completed"
  | "failed";

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

export type IndexNowStatus = "verified" | "not-detected" | "unknown";

export type Priority = "critical" | "high" | "medium" | "low";
export type EffortLevel = "Quick wins" | "Middels innsats" | "Strategiske endringer";
export type RecommendationImpact = "Høy" | "Middels" | "Lav";
export type SearchIntent =
  | "informational"
  | "commercial investigation"
  | "transactional"
  | "navigational";

export type AuditMode = "domain" | "page";

export type AuditRequestInput = {
  mode: AuditMode;
  targetUrl: string;
  locale: string;
  country: string;
  competitorUrls: string[];
  maxPages: number;
};

export type AuditRunSummary = {
  mode: AuditMode;
  totalScore: number;
  categoryScores: CategoryScore[];
  providerScores: ProviderScore[];
  totalPages: number;
  issueCount: number;
  targetUrl: string;
};

export type AuditProgress = {
  phase: AuditPhase;
  message: string;
  percent: number;
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesTarget: number;
  competitorsCompleted: number;
  competitorsTotal: number;
  estimatedSecondsRemaining: number | null;
  lastUpdatedAt: string;
};

export type AuditRunRecord = {
  id: string;
  targetUrl: string;
  status: AuditStatus;
  request: AuditRequestInput;
  summary: AuditRunSummary | null;
  progress: AuditProgress;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  heartbeatAt: string | null;
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
  xIndexNowKey: string | null;
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
  category: CategoryId;
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

export type PageSectionSuggestion = {
  title: string;
  purpose: string;
  suggestedContent: string;
};

export type PageFaqSuggestion = {
  question: string;
  answer: string;
};

export type SearchQueryInsight = {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  inContent: boolean;
  matchedTerms: string[];
  missingTerms: string[];
};

export type PagePerformanceMetrics = {
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  sessions: number;
  conversions: number;
  conversionRate: number;
  bounceRate: number;
};

export type PageSearchInsights = {
  audience: string | null;
  audienceQualifier: string | null;
  primaryQuery: string | null;
  contentHighlights: string[];
  contentGaps: string[];
  topQueries: SearchQueryInsight[];
  metrics: PagePerformanceMetrics | null;
};

export type PageImprovementSuggestion = {
  url: string;
  pageTitle: string;
  intent: SearchIntent;
  searchInsights: PageSearchInsights | null;
  current: {
    metaTitle: string;
    metaDescription: string;
    schemaTypes: string[];
    opening: string;
    h1: string;
  };
  proposed: {
    structure: string[];
    h1: string;
    contentLead: string;
    contentNotes: string[];
    sections: PageSectionSuggestion[];
    faq: PageFaqSuggestion[];
    cta: string;
    metaTitle: string;
    metaDescription: string;
    schemaType: string;
    jsonLd: string;
  };
  rationale: string[];
};

export type PageAuditReport = {
  intent: SearchIntent;
  searchInsights: PageSearchInsights | null;
  current: {
    url: string;
    title: string;
    metaTitle: string;
    metaDescription: string;
    h1: string;
    opening: string;
    schemaTypes: string[];
    renderingModel: RenderingSnapshot["renderingModel"];
    answerScore: number;
  };
  proposed: {
    metaTitle: string;
    metaDescription: string;
    h1: string;
    opening: string;
    structure: string[];
    sections: PageSectionSuggestion[];
    faq: PageFaqSuggestion[];
    cta: string;
    schemaType: string;
    jsonLd: string;
  };
  changeSummary: string[];
  priorityActions: string[];
};

export type PredictedCategoryImpact = {
  id: CategoryId;
  before: number;
  after: number;
  delta: number;
};

export type PredictedProviderImpact = {
  provider: ProviderId;
  before: number;
  after: number;
  delta: number;
};

export type PredictedImpact = {
  totalScoreBefore: number;
  totalScoreAfter: number;
  totalScoreDelta: number;
  categories: PredictedCategoryImpact[];
  providers: PredictedProviderImpact[];
};

export type ImplementationPack = {
  id: string;
  url: string;
  pageTitle: string;
  mode: AuditMode;
  currentSnapshot: {
    h1: string;
    opening: string;
    metaTitle: string;
    metaDescription: string;
    schemaTypes: string[];
  };
  proposedSnapshot: {
    h1: string;
    opening: string;
    structure: string[];
    sections: PageSectionSuggestion[];
    faq: PageFaqSuggestion[];
    cta: string;
    metaTitle: string;
    metaDescription: string;
    schemaType: string;
    jsonLd: string;
  };
  patchBlocks: Array<{
    id: string;
    label: string;
    content: string;
  }>;
  predictedImpact: PredictedImpact;
  evidence: string[];
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
  indexNowStatus: IndexNowStatus;
  categoryScores: CategoryScore[];
  providerScores: ProviderScore[];
  issues: Issue[];
  recommendations: Recommendation[];
  pages: PageSnapshot[];
  pageSuggestions: PageImprovementSuggestion[];
  pageReport: PageAuditReport | null;
  implementationPacks: ImplementationPack[];
  topicClusters: TopicCluster[];
  competitiveContext: CompetitiveContext | null;
  comparison: ReportComparison;
};

export interface GoogleConnection {
  id: number;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  createdAt: string;
  updatedAt: string;
}

export interface DomainIntegration {
  id: number;
  domain: string;
  gscProperty: string | null;
  ga4PropertyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GooglePropertyOption {
  siteUrl: string;
  permissionLevel: string;
}

export interface GoogleSyncStatus {
  lastGscSync: string | null;
  lastGa4Sync: string | null;
  lastOpportunityRun: string | null;
}

export type OpportunityType =
  | 'high-impressions-low-ctr'
  | 'near-page-one'
  | 'traffic-down'
  | 'indexing-blocker'
  | 'high-traffic-low-conversion'
  | 'query-gap';

export type OpportunityPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Opportunity {
  id: number;
  snapshotId: number;
  domain: string;
  targetUrl: string;
  pageUrl: string;
  query: string | null;
  queryCluster: string | null;
  type: OpportunityType;
  priority: OpportunityPriority;
  title: string;
  evidence: Record<string, unknown>;
  recommendedAction: string;
  expectedImpact: string;
  implementationPackId: number | null;
  status: 'open' | 'dismissed' | 'done';
  createdAt: string;
}

export interface OpportunitySnapshot {
  id: number;
  domain: string;
  generatedAt: string;
  opportunityCount: number;
}

export interface GscPageRow {
  domain: string;
  date: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryRow {
  domain: string;
  date: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscPageQueryRow {
  domain: string;
  date: string;
  page: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Ga4LandingPageRow {
  domain: string;
  date: string;
  page: string;
  sessions: number;
  conversions: number;
  bounceRate: number;
}

export interface BackgroundJob {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
}
