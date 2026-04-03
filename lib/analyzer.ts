import { CATEGORY_LABELS, CATEGORY_WEIGHTS, PROVIDER_LABELS } from "@/lib/config";
import type {
  AuditReport,
  AuditRequestInput,
  CategoryId,
  CategoryScore,
  CompetitiveContext,
  CompetitiveGap,
  EffortLevel,
  ImplementationPack,
  IndexNowStatus,
  Issue,
  PageAuditReport,
  PageFaqSuggestion,
  PageImprovementSuggestion,
  PageSectionSuggestion,
  PageSnapshot,
  Priority,
  ProviderId,
  ProviderScore,
  Recommendation,
  ReportComparison,
  SearchIntent,
  TopicCluster,
} from "@/lib/types";
import { average, clamp, daysSince, extractTextTokens, hashId, humanPath, percent, safeNumber, slugify, summarizeList, unique } from "@/lib/utils";

type DomainMetrics = {
  pages: PageSnapshot[];
  eligiblePages: PageSnapshot[];
  totalPages: number;
  indexedPages: number;
  blockedPages: number;
  noindexPages: number;
  brokenPages: number;
  orphanPages: PageSnapshot[];
  deepPages: PageSnapshot[];
  answerFirstAverage: number;
  schemaCoverage: number;
  freshnessCoverage: number;
  freshnessAverage: number;
  citationCoverage: number;
  renderHeavyPages: PageSnapshot[];
  snippetRestrictedPages: PageSnapshot[];
  titleCoverage: number;
  descriptionCoverage: number;
  canonicalCoverage: number;
  altCoverage: number;
  transcriptCoverage: number;
  schemaMismatchPages: PageSnapshot[];
  authorTransparencyCoverage: number;
  maxClickDepth: number;
  uniqueIntents: SearchIntent[];
  topicClusters: TopicCluster[];
  hasIndexNowSignal: boolean;
  indexNowStatus: IndexNowStatus;
};

type BuildReportInput = {
  runId: string;
  request: AuditRequestInput;
  targetPages: PageSnapshot[];
  competitorPagesByDomain: Record<string, PageSnapshot[]>;
  previousReport: AuditReport | null;
  indexNowStatus: IndexNowStatus;
};

export function buildAuditReport(input: BuildReportInput): AuditReport {
  if (input.request.mode === "page") {
    return buildSinglePageAuditReport(input);
  }

  const targetTopicClusters = buildTopicClusters(input.targetPages);
  const metrics = buildDomainMetrics(input.targetPages, targetTopicClusters, input.indexNowStatus);
  const categoryScores = buildCategoryScores(metrics);
  const issues = buildIssues(metrics, categoryScores);
  const recommendations = buildRecommendations(issues, metrics);
  const providerScores = buildProviderScores(metrics);
  const pageSuggestions = buildPageSuggestions(input.targetPages);
  const implementationPacks = buildImplementationPacks(
    input.request.mode,
    input.targetPages,
    pageSuggestions,
    categoryScores,
    providerScores,
    input.indexNowStatus,
  );
  const competitiveContext = buildCompetitiveContext(metrics, input.competitorPagesByDomain);
  const totalScore = safeNumber(
    categoryScores.reduce((sum, category) => sum + (category.score * category.weight) / 100, 0),
    1,
  );
  const comparison = buildComparison(input.previousReport, totalScore, categoryScores);

  return {
    runId: input.runId,
    request: input.request,
    generatedAt: new Date().toISOString(),
    totalScore,
    summary: buildSummary(metrics, providerScores, issues),
    indexNowStatus: metrics.indexNowStatus,
    categoryScores,
    providerScores,
    issues,
    recommendations,
    pages: input.targetPages,
    pageSuggestions,
    pageReport: null,
    implementationPacks,
    topicClusters: targetTopicClusters,
    competitiveContext,
    comparison,
  };
}

function buildSinglePageAuditReport(input: BuildReportInput): AuditReport {
  const metrics = buildDomainMetrics(input.targetPages, [], input.indexNowStatus);
  const categoryScores = buildCategoryScores(metrics);
  const issues = buildIssues(metrics, categoryScores);
  const recommendations = buildRecommendations(issues, metrics);
  const providerScores = buildProviderScores(metrics);
  const pageSuggestions = buildPageSuggestions(input.targetPages);
  const implementationPacks = buildImplementationPacks(
    input.request.mode,
    input.targetPages,
    pageSuggestions,
    categoryScores,
    providerScores,
    input.indexNowStatus,
  );
  const totalScore = safeNumber(
    categoryScores.reduce((sum, category) => sum + (category.score * category.weight) / 100, 0),
    1,
  );
  const comparison = buildComparison(input.previousReport, totalScore, categoryScores);
  const pageReport = buildPageReport(input.targetPages[0] ?? null, pageSuggestions[0] ?? null);

  return {
    runId: input.runId,
    request: input.request,
    generatedAt: new Date().toISOString(),
    totalScore,
    summary: buildPageSummary(input.targetPages[0] ?? null, providerScores, issues),
    indexNowStatus: metrics.indexNowStatus,
    categoryScores,
    providerScores,
    issues,
    recommendations,
    pages: input.targetPages,
    pageSuggestions,
    pageReport,
    implementationPacks,
    topicClusters: [],
    competitiveContext: null,
    comparison,
  };
}

function buildDomainMetrics(
  pages: PageSnapshot[],
  topicClusters: TopicCluster[],
  indexNowStatus: IndexNowStatus = "unknown",
): DomainMetrics {
  const eligiblePages = pages.filter(
    (page) =>
      !page.blockedByRobots &&
      !page.noindex &&
      page.contentType?.includes("text/html") &&
      (page.statusCode === null || page.statusCode < 400),
  );
  const brokenPages = pages.filter((page) => page.statusCode !== null && page.statusCode >= 400).length;
  const orphanPages = eligiblePages.filter((page) => page.discoveredFrom !== "seed" && page.inboundLinks === 0);
  const deepPages = eligiblePages.filter((page) => page.clickDepth >= 4);
  const snippetRestrictedPages = eligiblePages.filter(
    (page) =>
      page.snippetDirectives.noSnippet ||
      page.snippetDirectives.dataNoSnippet ||
      page.snippetDirectives.maxSnippet === 0,
  );
  const schemaMismatchPages = eligiblePages.filter(
    (page) => page.schema.itemCount > 0 && !page.schema.matchesVisibleContent,
  );
  const renderHeavyPages = eligiblePages.filter(
    (page) =>
      page.rendering.renderingModel === "csr" ||
      (page.rendering.renderDeltaRatio !== null && page.rendering.renderDeltaRatio > 1.8),
  );
  const uniqueIntents = unique(topicClusters.map((cluster) => cluster.intent));

  return {
    pages,
    eligiblePages,
    totalPages: pages.length,
    indexedPages: eligiblePages.length,
    blockedPages: pages.filter((page) => page.blockedByRobots).length,
    noindexPages: pages.filter((page) => page.noindex).length,
    brokenPages,
    orphanPages,
    deepPages,
    answerFirstAverage: average(eligiblePages.map((page) => page.answerFirstSignals.directAnswerLikelihood)),
    schemaCoverage: percent(eligiblePages.filter((page) => page.schema.itemCount > 0).length, eligiblePages.length),
    freshnessCoverage: percent(
      eligiblePages.filter((page) => page.dateModified || page.datePublished).length,
      eligiblePages.length,
    ),
    freshnessAverage: average(
      eligiblePages
        .map((page) => daysSince(page.dateModified ?? page.datePublished))
        .filter((value): value is number => value !== null)
        .map((value) => 100 - clamp((value / 365) * 100)),
    ),
    citationCoverage: percent(
      eligiblePages.filter((page) => page.author || page.publisher || page.externalLinks.length > 0).length,
      eligiblePages.length,
    ),
    renderHeavyPages,
    snippetRestrictedPages,
    titleCoverage: percent(eligiblePages.filter((page) => page.title.length >= 15).length, eligiblePages.length),
    descriptionCoverage: percent(
      eligiblePages.filter((page) => page.metaDescription.length >= 50).length,
      eligiblePages.length,
    ),
    canonicalCoverage: percent(eligiblePages.filter((page) => Boolean(page.canonicalUrl)).length, eligiblePages.length),
    altCoverage: percent(
      eligiblePages.filter((page) => page.imageCount === 0 || page.imagesWithoutAlt === 0).length,
      eligiblePages.length,
    ),
    transcriptCoverage: percent(
      eligiblePages.filter((page) => page.hasTranscriptSignals || page.imageCount === 0).length,
      eligiblePages.length,
    ),
    schemaMismatchPages,
    authorTransparencyCoverage: percent(
      eligiblePages.filter((page) => page.author || page.publisher || page.hasAboutLink || page.hasContactLink).length,
      eligiblePages.length,
    ),
    maxClickDepth: Math.max(0, ...eligiblePages.map((page) => page.clickDepth)),
    uniqueIntents,
    topicClusters,
    hasIndexNowSignal: indexNowStatus === "verified",
    indexNowStatus,
  };
}

function buildCategoryScores(metrics: DomainMetrics): CategoryScore[] {
  const crawlability = clamp(
    100 -
      metrics.blockedPages * 4 -
      metrics.noindexPages * 3 -
      metrics.brokenPages * 5 -
      safeNumber(percent(metrics.orphanPages.length, Math.max(metrics.indexedPages, 1)) * 0.7),
  );
  const rendering = clamp(
    100 -
      safeNumber(percent(metrics.renderHeavyPages.length, Math.max(metrics.indexedPages, 1)) * 1.1) -
      (metrics.maxClickDepth > 5 ? 8 : 0),
  );
  const answerFirst = clamp(metrics.answerFirstAverage * 0.8 + (metrics.eligiblePages.some((page) => page.answerFirstSignals.hasFaq) ? 12 : 0));
  const citation = clamp(metrics.citationCoverage * 0.55 + metrics.authorTransparencyCoverage * 0.45);
  const schema = clamp(
    metrics.schemaCoverage * 0.75 + (metrics.schemaMismatchPages.length ? 0 : 15) - metrics.schemaMismatchPages.length * 4,
  );
  const internalLinking = clamp(
    100 -
      safeNumber(percent(metrics.orphanPages.length, Math.max(metrics.indexedPages, 1)) * 0.8) -
      safeNumber(percent(metrics.deepPages.length, Math.max(metrics.indexedPages, 1)) * 0.4),
  );
  const expectedClusters = Math.max(3, Math.floor(Math.max(metrics.indexedPages, 1) / 10));
  const clusterCoverage = Math.min(1, metrics.topicClusters.length / expectedClusters);
  const intentCoverage = Math.min(1, metrics.uniqueIntents.length / 4);
  const clusterPenalty = Math.min(20, metrics.topicClusters.filter((cluster) => cluster.pages.length === 1).length * 3);
  const intent = clamp(clusterCoverage * 62 + intentCoverage * 30 - clusterPenalty + 8);
  const zeroClick = clamp(
    metrics.answerFirstAverage * 0.5 +
      metrics.schemaCoverage * 0.2 +
      (metrics.snippetRestrictedPages.length ? -20 : 15) +
      (metrics.eligiblePages.some((page) => page.answerFirstSignals.hasFaq) ? 15 : 0),
  );
  const freshness = clamp(metrics.freshnessCoverage * 0.4 + metrics.freshnessAverage * 0.6);
  const technical = clamp(
    metrics.titleCoverage * 0.25 +
      metrics.descriptionCoverage * 0.2 +
      metrics.canonicalCoverage * 0.2 +
      metrics.altCoverage * 0.2 +
      metrics.transcriptCoverage * 0.15,
  );

  const scores: Array<[CategoryId, number, string]> = [
    [
      "crawlabilityIndexation",
      crawlability,
      metrics.orphanPages.length
        ? `${metrics.orphanPages.length} sider er vanskelige å oppdage eller er delvis utilgjengelige for søk og crawlere.`
        : "Det ser i hovedsak lett ut for søkemotorer og botene å finne og lese sidene.",
    ],
    [
      "renderingAiAccessibility",
      rendering,
      metrics.renderHeavyPages.length
        ? `${metrics.renderHeavyPages.length} sider er mer avhengige av nettleseren enn ønskelig før innholdet blir synlig.`
        : "Det meste av innholdet ser ut til å være tilgjengelig med en gang siden lastes.",
    ],
    [
      "answerFirstContent",
      answerFirst,
      metrics.answerFirstAverage >= 70
        ? "Innholdet kommer raskt til poenget og egner seg godt for raske svar og utdrag."
        : "Flere sider bør bli tydeligere tidligere i teksten og svare raskere på brukerens spørsmål.",
    ],
    [
      "citationAuthorityEntitySignals",
      citation,
      metrics.authorTransparencyCoverage >= 70
        ? "Det er ganske tydelig hvem som står bak innholdet og hvordan siden kan vurderes som troverdig."
        : "Flere sider mangler tydelige signaler om avsender, ansvar og troverdighet.",
    ],
    [
      "schemaSemanticSearch",
      schema,
      metrics.schemaMismatchPages.length
        ? `${metrics.schemaMismatchPages.length} sider sender strukturerte signaler som ikke matcher det brukeren faktisk ser.`
        : "Strukturerte data og semantiske signaler ser jevnt over solide ut.",
    ],
    [
      "internalLinking",
      internalLinking,
      metrics.deepPages.length
        ? `${metrics.deepPages.length} sider ligger for dypt eller har for få interne innganger.`
        : "Internlenkene hjelper brukere og crawlere med å forstå hvilke sider som hører sammen.",
    ],
    [
      "searchIntentTopicClusters",
      intent,
      metrics.topicClusters.length
        ? `${metrics.topicClusters.length} tydelige temagrupper ble identifisert, med ${metrics.uniqueIntents.length} ulike brukerintensjoner.`
        : "Det var for lite eller for spredt innhold til å vise tydelige temagrupper.",
    ],
    [
      "zeroClickAiOverviews",
      zeroClick,
      metrics.snippetRestrictedPages.length
        ? "Noen innstillinger begrenser hvor mye av innholdet som kan vises i utdrag og AI-sammendrag."
        : "Innholdet ser forholdsvis godt egnet ut for utdrag og AI-sammendrag.",
    ],
    [
      "contentFreshness",
      freshness,
      metrics.freshnessCoverage >= 60
        ? "Mange sider viser tydelig at innholdet holdes oppdatert."
        : "Det er vanskelig å se hvor oppdatert innholdet er på flere sider.",
    ],
    [
      "technicalOptimization",
      technical,
      technical >= 75
        ? "De tekniske grunnsignalene er stort sett på plass."
        : "Det er noen tekniske grunnsignaler som bør strammes opp for å løfte kvaliteten.",
    ],
  ];

  return scores.map(([id, score, summary]) => ({
    id,
    label: CATEGORY_LABELS[id],
    weight: CATEGORY_WEIGHTS[id],
    score: safeNumber(score),
    summary,
  }));
}

function buildIssues(metrics: DomainMetrics, categoryScores: CategoryScore[]): Issue[] {
  const issues: Issue[] = [];

  if (metrics.renderHeavyPages.length) {
    issues.push(
      issue(
        "rendering-csr",
        "renderingAiAccessibility",
        "Client-side rendering skjuler innhold for crawlere",
        "Viktige sider får langt mer tekst først etter klientrendering, noe som øker risikoen for svak indeksering og dårlig AI-forståelse.",
        "critical",
        metrics.renderHeavyPages.map((page) => page.url),
        ["openai", "google", "bing", "perplexity", "citation"],
      ),
    );
  }

  if (metrics.schemaMismatchPages.length) {
    issues.push(
      issue(
        "schema-mismatch",
        "schemaSemanticSearch",
        "Schema matcher ikke tydelig synlig innhold",
        "JSON-LD på flere sider ser ut til å beskrive annet innhold enn det brukeren og søkemotoren faktisk ser.",
        "high",
        metrics.schemaMismatchPages.map((page) => page.url),
        ["google", "bing", "perplexity"],
      ),
    );
  }

  if (metrics.orphanPages.length) {
    issues.push(
      issue(
        "orphan-pages",
        "internalLinking",
        "Foreldreløse sider svekker topic-clusters og crawlability",
        "Sider oppdaget via sitemap eller direkte URL mangler interne innganger, noe som gir svakere signaler om viktighet og klyngetilknytning.",
        "high",
        metrics.orphanPages.map((page) => page.url),
        ["google", "bing", "openai", "citation"],
      ),
    );
  }

  if (metrics.snippetRestrictedPages.length) {
    issues.push(
      issue(
        "snippet-controls",
        "zeroClickAiOverviews",
        "Snippet-kontroller begrenser synlighet i SERP og AI-svar",
        "noSnippet, max-snippet=0 eller data-nosnippet er funnet på sider som ellers har godt answer-first-potensial.",
        "medium",
        metrics.snippetRestrictedPages.map((page) => page.url),
        ["google", "bing", "openai", "perplexity", "citation"],
      ),
    );
  }

  if (metrics.answerFirstAverage < 60) {
    issues.push(
      issue(
        "answer-first",
        "answerFirstContent",
        "Sider svarer for sent eller for uklart",
        "Mange sider bruker for lang tid før de gir et direkte svar, noe som svekker både zero-click-resultater og siterbarhet.",
        "high",
        metrics.eligiblePages
          .filter((page) => page.answerFirstSignals.directAnswerLikelihood < 55)
          .slice(0, 8)
          .map((page) => page.url),
        ["openai", "google", "bing", "perplexity", "citation"],
      ),
    );
  }

  if (metrics.authorTransparencyCoverage < 50) {
    issues.push(
      issue(
        "trust-signals",
        "citationAuthorityEntitySignals",
        "Svake forfatter- og transparenssignaler",
        "Innhold uten tydelig forfatter, publisher, om-side eller kontaktside er svakere på entity-forståelse og troverdighet.",
        "medium",
        metrics.eligiblePages
          .filter((page) => !page.author && !page.publisher && !page.hasAboutLink && !page.hasContactLink)
          .slice(0, 8)
          .map((page) => page.url),
        ["openai", "google", "bing", "perplexity", "citation"],
      ),
    );
  }

  if (metrics.freshnessCoverage < 50) {
    issues.push(
      issue(
        "freshness",
        "contentFreshness",
        "Mangler oppdateringsdato eller ferskhetssignaler",
        "Lite bruk av dateModified, article metadata eller synlige publiseringsdatoer gjør det vanskeligere å vurdere innholdets aktualitet.",
        "medium",
        metrics.eligiblePages
          .filter((page) => !page.dateModified && !page.datePublished)
          .slice(0, 8)
          .map((page) => page.url),
        ["google", "bing", "openai", "perplexity"],
      ),
    );
  }

  if (metrics.indexNowStatus !== "verified") {
    issues.push(
      issue(
        "indexnow-readiness",
        "technicalOptimization",
        "Ingen tydelig IndexNow-beredskap funnet",
        metrics.indexNowStatus === "unknown"
          ? "IndexNow kunne ikke verifiseres fordi verktøyet ikke har en konfigurert nøkkel å kontrollere mot."
          : "Det ble ikke funnet tekniske signaler som bekrefter at nettstedet bruker IndexNow.",
        "low",
        [],
        ["bing"],
      ),
    );
  }

  if ((categoryScores.find((score) => score.id === "technicalOptimization")?.score ?? 0) < 70) {
    issues.push(
      issue(
        "technical-metadata",
        "technicalOptimization",
        "Metadata og mediesignaler er ujevnt dekket",
        "Titler, metabeskrivelser, canonicals, alt-tekster eller transcript-signaler mangler på en del sider.",
        "medium",
        metrics.eligiblePages
          .filter(
            (page) =>
              page.title.length < 15 ||
              page.metaDescription.length < 50 ||
              !page.canonicalUrl ||
              page.imagesWithoutAlt > 0,
          )
          .slice(0, 8)
          .map((page) => page.url),
        ["google", "bing", "openai", "citation"],
      ),
    );
  }

  return issues.sort(prioritySort);
}

function buildRecommendations(issues: Issue[], metrics: DomainMetrics): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const issue of issues) {
    if (issue.id === "rendering-csr") {
      recommendations.push(
        recommendation(
          issue.id,
          "Strategiske endringer",
          "Høy",
          "Flytt kritisk innhold fra CSR til SSR eller statisk HTML",
          "Målsider leverer for lite tekst i rå HTML, og det svekker både indeksering og AI-lesbarhet.",
          summarizeList(issue.affectedUrls.map(humanPath), 2) || "Prioriterte sider",
          issue.providerImpact,
          "Render H1, ingress, nøkkelavsnitt, FAQ og schema server-side. Behold interaktivitet som progressive enhancement i stedet for å gjøre hele siden klientavhengig.",
        ),
      );
    }

    if (issue.id === "answer-first") {
      recommendations.push(
        recommendation(
          issue.id,
          "Quick wins",
          "Høy",
          "Legg inn et direkte svar rett under H1",
          "Sider som svarer tidlig blir lettere å sitere og enklere å bruke i zero-click-oppsummeringer.",
          summarizeList(issue.affectedUrls.map(humanPath), 2) || "Toppartikler",
          issue.providerImpact,
          "Skriv 2-3 setninger som svarer på hovedspørsmålet i første avsnitt, etterfulgt av en kort punktliste eller FAQ med konkrete fakta.",
        ),
      );
    }

    if (issue.id === "schema-mismatch") {
      recommendations.push(
        recommendation(
          issue.id,
          "Middels innsats",
          "Høy",
          "Juster schema slik at det matcher synlig innhold",
          "Google, Bing og andre motorer reagerer dårlig på schema som beskriver innhold brukeren ikke ser.",
          summarizeList(issue.affectedUrls.map(humanPath), 2) || "Schema-berørte sider",
          issue.providerImpact,
          "Oppdater JSON-LD slik at headline, description, FAQ-spørsmål, author og dates speiler nøyaktig det som er synlig på siden.",
        ),
      );
    }

    if (issue.id === "orphan-pages") {
      recommendations.push(
        recommendation(
          issue.id,
          "Middels innsats",
          "Middels",
          "Bygg topic clusters med hub-sider og tydelige interne innganger",
          "Foreldreløse sider sender svake signaler om relevans og gjør det vanskeligere å forstå tematisk struktur.",
          summarizeList(issue.affectedUrls.map(humanPath), 2) || "Foreldreløse sider",
          issue.providerImpact,
          "Legg inn lenker fra relaterte hub-sider, brødsmuler og seksjonsnavigasjon. Sørg for at hver viktig URL får minst 2-3 relevante interne innganger.",
        ),
      );
    }

    if (issue.id === "snippet-controls") {
      recommendations.push(
        recommendation(
          issue.id,
          "Quick wins",
          "Middels",
          "Revider noSnippet-, max-snippet- og data-nosnippet-bruk",
          "Disse kontrollene kan hindre gode svarblokker fra å bli vist i SERP og AI-overviews.",
          summarizeList(issue.affectedUrls.map(humanPath), 2) || "Berørte sider",
          issue.providerImpact,
          "Fjern restriktive snippet-kontroller fra seksjoner som bør kunne brukes i utdrag, og behold dem bare rundt sensitiv eller lisensiert tekst.",
        ),
      );
    }

    if (issue.id === "trust-signals") {
      recommendations.push(
        recommendation(
          issue.id,
          "Quick wins",
          "Middels",
          "Synliggjør forfatter, publisher, om-side og kontakt",
          "Tydelig ansvarlig avsender styrker entity-signaler og gjør innholdet tryggere å sitere.",
          summarizeList(issue.affectedUrls.map(humanPath), 2) || "Innholdssider",
          issue.providerImpact,
          "Legg til byline, publisher-info, About/Om-lenke, kontaktside og Organization/Person schema på malnivå for artikler og landingssider.",
        ),
      );
    }

    if (issue.id === "freshness") {
      recommendations.push(
        recommendation(
          issue.id,
          "Quick wins",
          "Middels",
          "Publiser og oppdater datoer tydelig",
          "Ferskhetssignaler gjør det enklere for søk og AI å vurdere om innholdet fortsatt er relevant.",
          summarizeList(issue.affectedUrls.map(humanPath), 2) || "Prioriterte sider",
          issue.providerImpact,
          "Vis `Publisert` og `Sist oppdatert` i innholdsmalen, og speil datoene i Article/BlogPosting schema.",
        ),
      );
    }

    if (issue.id === "indexnow-readiness") {
      recommendations.push(
        recommendation(
          issue.id,
          "Middels innsats",
          "Lav",
          "Legg til IndexNow i publiseringsflyten",
          "Det forkorter ofte tiden fra innholdsoppdatering til gjenoppdagelse i Bing-økosystemet.",
          "Hele nettstedet",
          issue.providerImpact,
          "Send URL-ping ved publisering/oppdatering og dokumenter løsningen sammen med sitemap- og robots-oppsettet.",
        ),
      );
    }

    if (issue.id === "technical-metadata") {
      recommendations.push(
        recommendation(
          issue.id,
          "Quick wins",
          "Middels",
          "Fullfør metadata- og mediemalene",
          "Mangler i title, meta description, canonical og alt-tekst er ofte raske gevinster med bred effekt.",
          summarizeList(issue.affectedUrls.map(humanPath), 2) || "Berørte sider",
          issue.providerImpact,
          "Oppdater malene slik at title, description, canonical, alt-tekst og transcript-signaler alltid fylles når relevant innhold finnes.",
        ),
      );
    }
  }

  return uniqueBy(recommendations, (item) => item.id);
}

function buildProviderScores(metrics: DomainMetrics): ProviderScore[] {
  return [
    providerScore("openai", metrics, {
      blockedPenalty: metrics.pages.filter((page) => page.robotsEvaluation.blockedProviders.includes("openai")).length * 4,
      answerPenalty: Math.max(0, 70 - metrics.answerFirstAverage) * 0.45,
      snippetPenalty: metrics.snippetRestrictedPages.length * 3,
      trustBoost: metrics.authorTransparencyCoverage * 0.08,
      summary:
        metrics.answerFirstAverage >= 65
          ? "ChatGPT/OpenAI Search har gode forutsetninger for å hente og sitere innholdet."
          : "OpenAI-profilen hemmes av svake direkte svar, robots-begrensninger eller svake trust-signaler.",
      blockers: [
        ...collectBlockerLines(metrics.pages, "openai"),
        ...(metrics.answerFirstAverage < 60 ? ["Flere sider gir ikke et tydelig svar tidlig nok."] : []),
      ],
      opportunities: [
        "Prioriter korte svarblokker og FAQ på de viktigste landingssidene.",
        ...(metrics.authorTransparencyCoverage < 70 ? ["Legg til tydelig byline og publisher-signaler."] : []),
      ],
    }),
    providerScore("google", metrics, {
      blockedPenalty:
        metrics.pages.filter((page) => page.robotsEvaluation.blockedProviders.includes("google")).length * 2 +
        metrics.noindexPages * 3,
      answerPenalty: metrics.renderHeavyPages.length * 4,
      snippetPenalty: metrics.schemaMismatchPages.length * 4,
      trustBoost: metrics.schemaCoverage * 0.05,
      summary:
        metrics.schemaMismatchPages.length === 0
          ? "Google/Gemini-signaler er relativt sterke når innhold, interne lenker og schema peker samme vei."
          : "Google/Gemini-profilen svekkes av schema-avvik, renderingsavhengighet eller indekseringshindre.",
      blockers: [
        ...(metrics.schemaMismatchPages.length ? ["Schema og synlig innhold er ikke godt nok synkronisert."] : []),
        ...(metrics.renderHeavyPages.length ? ["Viktige sider er for avhengige av klientrendering."] : []),
      ],
      opportunities: [
        "Sørg for at sentrale fakta og headings finnes i rå HTML.",
        ...(metrics.orphanPages.length ? ["Knyt foreldreløse sider inn i tydelige topic clusters."] : []),
      ],
    }),
    providerScore("bing", metrics, {
      blockedPenalty: metrics.pages.filter((page) => page.robotsEvaluation.blockedProviders.includes("bing")).length * 4,
      answerPenalty: metrics.snippetRestrictedPages.length * 3,
      snippetPenalty: metrics.hasIndexNowSignal ? 0 : 8,
      trustBoost: metrics.schemaCoverage * 0.04,
      summary:
        metrics.indexNowStatus === "verified" && !metrics.snippetRestrictedPages.length
          ? "Copilot/Bing har en god teknisk basis for raskere oppdagelse og utdrag."
          : "Copilot/Bing-profilen kan styrkes med snippet-kontroll, schema og raskere oppdagelsessignaler.",
      blockers: [
        ...collectBlockerLines(metrics.pages, "bing"),
        ...(metrics.indexNowStatus === "not-detected" ? ["IndexNow ble ikke bekreftet teknisk."] : []),
        ...(metrics.indexNowStatus === "unknown" ? ["IndexNow kunne ikke verifiseres uten konfigurert nøkkel."] : []),
        ...(metrics.snippetRestrictedPages.length ? ["data-nosnippet eller andre snippet-kontroller hemmer utdrag."] : []),
      ],
      opportunities: ["Legg inn IndexNow i publiseringsflyten.", "Hold schema og canonical-signaler konsekvente."],
    }),
    providerScore("perplexity", metrics, {
      blockedPenalty: metrics.pages.filter((page) => page.robotsEvaluation.blockedProviders.includes("perplexity")).length * 4,
      answerPenalty: Math.max(0, 65 - metrics.answerFirstAverage) * 0.4,
      snippetPenalty: metrics.citationCoverage < 60 ? 8 : 0,
      trustBoost: metrics.citationCoverage * 0.05,
      summary:
        metrics.citationCoverage >= 60
          ? "Perplexity vil ha et bedre grunnlag når siden tilbyr tydelige svar og sitatvennlige fakta."
          : "Perplexity-profilen hemmes av svake sitatsignaler eller begrenset answer-first-struktur.",
      blockers: [
        ...collectBlockerLines(metrics.pages, "perplexity"),
        ...(metrics.citationCoverage < 60 ? ["For få sider har tydelige forfatter-, publisher- eller referansesignaler."] : []),
      ],
      opportunities: ["Legg til flere faktafelt, tabeller og FAQ-seksjoner.", "Bruk tydelig byline og kildelenker der det er relevant."],
    }),
    providerScore("citation", metrics, {
      blockedPenalty: 0,
      answerPenalty: Math.max(0, 65 - metrics.answerFirstAverage) * 0.35,
      snippetPenalty: metrics.snippetRestrictedPages.length * 2,
      trustBoost: metrics.authorTransparencyCoverage * 0.05,
      summary:
        metrics.answerFirstAverage >= 60
          ? "Citation-first assistenter vil lettere forstå og sitere innholdet."
          : "Generelle AI-assistenter trenger klarere struktur, transparens og mer tekstlig tilgjengelighet.",
      blockers: [
        ...(metrics.renderHeavyPages.length ? ["Innholdet er for avhengig av renderingssteg som ikke alltid kjøres."] : []),
        ...(metrics.authorTransparencyCoverage < 50 ? ["Entity- og ansvarssignaler er for svake."] : []),
      ],
      opportunities: ["Bruk korte definisjonsblokker, sammendrag og eksplisitte faktapunkter."],
    }),
  ];
}

function providerScore(
  provider: ProviderId,
  metrics: DomainMetrics,
  input: {
    blockedPenalty: number;
    answerPenalty: number;
    snippetPenalty: number;
    trustBoost: number;
    summary: string;
    blockers: string[];
    opportunities: string[];
  },
): ProviderScore {
  const score = clamp(100 - input.blockedPenalty - input.answerPenalty - input.snippetPenalty + input.trustBoost);

  return {
    provider,
    label: PROVIDER_LABELS[provider],
    score: safeNumber(score),
    summary: input.summary,
    blockers: unique(input.blockers).slice(0, 4),
    opportunities: unique(input.opportunities).slice(0, 4),
  };
}

function buildCompetitiveContext(
  metrics: DomainMetrics,
  competitorPagesByDomain: Record<string, PageSnapshot[]>,
): CompetitiveContext | null {
  const domains = Object.entries(competitorPagesByDomain);
  if (!domains.length) {
    return null;
  }

  const competitors = domains.map(([domain, pages]) => {
    const clusters = buildTopicClusters(pages);
    const competitorMetrics = buildDomainMetrics(pages, clusters, "unknown");
    return {
      domain,
      pages: competitorMetrics.indexedPages,
      averageFreshness: safeNumber(competitorMetrics.freshnessAverage),
      averageAnswerFirst: safeNumber(competitorMetrics.answerFirstAverage),
      schemaCoverage: safeNumber(competitorMetrics.schemaCoverage),
      clusters: clusters.map((cluster) => cluster.name),
    };
  });

  const targetClusters = new Set(metrics.topicClusters.map((cluster) => cluster.name));
  const allCompetitorClusters = unique(competitors.flatMap((competitor) => competitor.clusters));
  const missingTargetClusters = allCompetitorClusters.filter((cluster) => !targetClusters.has(cluster));
  const averageCompetitorFreshness = average(competitors.map((competitor) => competitor.averageFreshness));
  const averageCompetitorAnswerFirst = average(competitors.map((competitor) => competitor.averageAnswerFirst));
  const averageCompetitorSchema = average(competitors.map((competitor) => competitor.schemaCoverage));
  const gaps: CompetitiveGap[] = [];

  if (averageCompetitorSchema > metrics.schemaCoverage + 10) {
    gaps.push({
      category: "Schema",
      gapType: "schema-gap",
      targetMetric: safeNumber(metrics.schemaCoverage),
      competitorMetric: safeNumber(averageCompetitorSchema),
      insight: "Konkurrentene bruker schema bredere eller mer konsekvent enn måldomenet.",
    });
  }

  if (averageCompetitorFreshness > metrics.freshnessAverage + 10) {
    gaps.push({
      category: "Freshness",
      gapType: "freshness-gap",
      targetMetric: safeNumber(metrics.freshnessAverage),
      competitorMetric: safeNumber(averageCompetitorFreshness),
      insight: "Konkurrentene viser ferskere innhold eller tydeligere oppdateringssignaler.",
    });
  }

  if (averageCompetitorAnswerFirst > metrics.answerFirstAverage + 8) {
    gaps.push({
      category: "Answer First",
      gapType: "answer-first-gap",
      targetMetric: safeNumber(metrics.answerFirstAverage),
      competitorMetric: safeNumber(averageCompetitorAnswerFirst),
      insight: "Konkurrentene svarer raskere og tydeligere i innledningene sine.",
    });
  }

  if (missingTargetClusters.length) {
    gaps.push({
      category: "Topic clusters",
      gapType: "topic-gap",
      targetMetric: metrics.topicClusters.length,
      competitorMetric: allCompetitorClusters.length,
      insight: `Konkurrentene dekker emner som mangler hos måldomenet: ${summarizeList(missingTargetClusters)}.`,
    });
  }

  if (average(competitors.map((competitor) => competitor.pages)) > metrics.indexedPages + 8) {
    gaps.push({
      category: "Content coverage",
      gapType: "coverage-gap",
      targetMetric: metrics.indexedPages,
      competitorMetric: safeNumber(average(competitors.map((competitor) => competitor.pages))),
      insight: "Konkurrentene ser ut til å ha bredere tematisk dekning på indeksérbare sider.",
    });
  }

  return {
    competitors,
    gaps,
  };
}

function buildComparison(
  previousReport: AuditReport | null,
  totalScore: number,
  categoryScores: CategoryScore[],
): ReportComparison {
  if (!previousReport) {
    return {
      previousRunId: null,
      totalScoreDelta: null,
      categoryDeltas: categoryScores.map((category) => ({ id: category.id, delta: 0 })),
    };
  }

  return {
    previousRunId: previousReport.runId,
    totalScoreDelta: safeNumber(totalScore - previousReport.totalScore),
    categoryDeltas: categoryScores.map((category) => ({
      id: category.id,
      delta: safeNumber(
        category.score - (previousReport.categoryScores.find((previous) => previous.id === category.id)?.score ?? 0),
      ),
    })),
  };
}

function buildSummary(metrics: DomainMetrics, providerScores: ProviderScore[], issues: Issue[]): string {
  const strongestProvider = [...providerScores].sort((a, b) => b.score - a.score)[0];
  const topIssue = issues[0];
  const clusterCount = metrics.topicClusters.length;

  return `Nettsiden har ${metrics.indexedPages} indeksérbare sider i analysen, ${clusterCount} topic clusters og en sterkest profil mot ${strongestProvider.label.toLowerCase()}. Største forbedringsområde akkurat nå er ${topIssue ? topIssue.title.toLowerCase() : "å styrke innholdssignalene ytterligere"}.`;
}

function buildPageSummary(page: PageSnapshot | null, providerScores: ProviderScore[], issues: Issue[]): string {
  if (!page) {
    return "Sideanalysen fant ikke lesbart HTML-innhold å jobbe med.";
  }

  const strongestProvider = [...providerScores].sort((a, b) => b.score - a.score)[0];
  const topIssue = issues[0];
  return `Denne sideanalysen ser kun på ${humanPath(page.url)}. Siden har sterkest utgangspunkt mot ${strongestProvider.label.toLowerCase()}, og viktigste forbedringsområde er ${topIssue ? topIssue.title.toLowerCase() : "å spisse innhold og metadata ytterligere"}.`;
}

function buildPageSuggestions(pages: PageSnapshot[]): PageImprovementSuggestion[] {
  return pages
    .filter(
      (page) =>
        !page.blockedByRobots &&
        !page.noindex &&
        page.contentType?.includes("text/html") &&
        (page.statusCode === null || page.statusCode < 400),
    )
    .map((page) => {
      const intent = classifyIntent(page);
      const pageTitle = page.h1 || page.title || humanPath(page.url);
      const keyword = extractKeyword(page);
      const brand = extractBrandName(page);
      // Keep focus for backward-compat with functions not yet updated
      const focus = keyword;
      const structure = proposeStructure(page, intent);
      const metaTitle = proposeMetaTitle(page, keyword, brand);
      const metaDescription = proposeMetaDescription(page, keyword, brand, intent);
      const contentLead = proposeContentLead(page, keyword, brand, intent);
      const contentNotes = proposeContentNotes(page, intent, keyword, brand, metaTitle, metaDescription, contentLead);
      const sections = proposeSections(page, keyword, brand, intent);
      const faq = proposeFaq(keyword, brand, intent);
      const cta = proposeCta(keyword, intent);
      const schema = proposeSchema(page, focus, intent, metaDescription);
      const proposedH1 = proposeH1(page, keyword, brand, intent);
      const rationale = buildSuggestionRationale(page);

      return {
        url: page.url,
        pageTitle,
        intent,
        current: {
          metaTitle: page.title,
          metaDescription: page.metaDescription,
          schemaTypes: page.schema.types,
          opening: page.firstParagraph || readableOpening(page.bodyText),
          h1: page.h1,
        },
        proposed: {
          structure,
          h1: proposedH1,
          contentLead,
          contentNotes,
          sections,
          faq,
          cta,
          metaTitle,
          metaDescription,
          schemaType: schema.schemaType,
          jsonLd: schema.jsonLd,
        },
        rationale,
      };
    })
    .sort((left, right) => {
      const leftNeed = suggestionNeedScore(left);
      const rightNeed = suggestionNeedScore(right);
      return rightNeed - leftNeed;
    })
    .slice(0, 15);
}

export function buildTopicClusters(pages: PageSnapshot[]): TopicCluster[] {
  const eligiblePages = pages.filter(
    (page) =>
      !page.blockedByRobots &&
      !page.noindex &&
      page.contentType?.includes("text/html") &&
      page.wordCount > 80,
  );

  if (!eligiblePages.length) {
    return [];
  }

  const documents = eligiblePages.map((page) => {
    const tokens = extractTextTokens(
      [page.title, page.h1, page.firstParagraph, page.headings.join(" "), page.internalLinks.join(" ")].join(" "),
    );
    return {
      page,
      tokens,
      tokenSet: new Set(tokens),
    };
  });

  const docFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const token of document.tokenSet) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }

  const vectors = documents.map((document) => {
    const tf = new Map<string, number>();
    for (const token of document.tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    const vector = new Map<string, number>();
    for (const [token, count] of tf) {
      const idf = Math.log((1 + documents.length) / (1 + (docFrequency.get(token) ?? 1))) + 1;
      vector.set(token, (count / document.tokens.length) * idf);
    }

    return {
      ...document,
      vector,
    };
  });

  const unassigned = new Set(vectors.map((vector) => vector.page.url));
  const clusters: TopicCluster[] = [];

  for (const seed of vectors) {
    if (!unassigned.has(seed.page.url)) {
      continue;
    }

    const group = [seed];
    unassigned.delete(seed.page.url);

    for (const candidate of vectors) {
      if (!unassigned.has(candidate.page.url)) {
        continue;
      }

      const similarity = cosineSimilarity(seed.vector, candidate.vector);
      if (similarity >= 0.18) {
        group.push(candidate);
        unassigned.delete(candidate.page.url);
      }
    }

    const topTokens = summarizeTopTokens(group.map((item) => item.tokens));
    const name = topTokens.length ? topTokens.join(" / ") : seed.page.h1 || seed.page.title || humanPath(seed.page.url);
    const intent = majorityIntent(group.map((item) => classifyIntent(item.page)));
    const averageSimilarity = average(
      group.flatMap((item, index) =>
        group
          .slice(index + 1)
          .map((other) => cosineSimilarity(item.vector, other.vector))
          .filter((score) => score > 0),
      ),
    );

    clusters.push({
      id: slugify(name) || hashId(seed.page.url),
      name,
      intent,
      score: safeNumber(
        clamp(
          40 +
            group.length * 16 +
            averageSimilarity * 100 * 0.3 +
            (group.some((item) => item.page.answerFirstSignals.hasFaq) ? 8 : 0),
        ),
      ),
      pages: group.map((item) => item.page.url),
      missingCoverage: inferMissingCoverage(intent, group.map((item) => item.page)),
      averageSimilarity: safeNumber(averageSimilarity * 100),
    });
  }

  return clusters.sort((a, b) => b.pages.length - a.pages.length || b.score - a.score);
}

function classifyIntent(page: PageSnapshot): SearchIntent {
  const haystack = `${page.path} ${page.title} ${page.h1} ${page.metaDescription}`.toLowerCase();

  if (/(buy|pricing|price|bestill|kjøp|kontakt salg|demo|book|start now|registrer)/i.test(haystack)) {
    return "transactional";
  }
  if (/(vs|compare|comparison|alternatives|beste|review|top|why us|case study)/i.test(haystack)) {
    return "commercial investigation";
  }
  if (/(login|signin|logg inn|dashboard|account|konto|home)/i.test(haystack)) {
    return "navigational";
  }

  return "informational";
}

/**
 * Extracts the primary topic/service keyword from a page.
 *
 * Priority order:
 * 1. URL path segments (most specific: /tryllekunstner → "Tryllekunstner")
 * 2. RIGHT side of H1 separator ("Denis Stone - Tryllekunstner" → "Tryllekunstner")
 * 3. LEFT side of title separator ("SEO Guide | Firma" → "SEO Guide")
 * 4. Full H1 or title as fallback
 *
 * This is intentionally the opposite of the old pickFocusPhrase, which kept
 * the brand name (left side) and threw away the service keyword (right side).
 */
function extractKeyword(page: PageSnapshot): string {
  // 1. URL path: /tryllekunstner, /magic-shows, /bedriftsarrangement
  const pathSegments = page.path
    .split("/")
    .filter((s) => s.length > 3 && !/^\d+$/.test(s))
    .filter((s) => !/(index|home|page|start|om|about|kontakt|contact|privacy|vilkar|blogg|blog)/.test(s));

  if (pathSegments.length > 0) {
    const last = pathSegments[pathSegments.length - 1]!.replace(/[-_]/g, " ").replace(/\.\w+$/, "");
    if (last.length > 3 && last.length < 55) {
      return last.charAt(0).toUpperCase() + last.slice(1);
    }
  }

  const h1 = (page.h1 || "").trim();
  const title = (page.title || "").trim();

  // 2. RIGHT side of H1 separator (brand – service → service is the keyword)
  const h1Right = h1.match(/\s*[-–|]\s*(.{4,55})$/);
  if (h1Right) {
    const candidate = h1Right[1]!.trim();
    if (candidate.split(" ").length <= 7) return candidate;
  }

  // 3. LEFT side of title separator (service | brand → service is the keyword)
  const titleLeft = title.match(/^(.{4,55?})\s*[-–|:]/);
  if (titleLeft) {
    const candidate = titleLeft[1]!.trim();
    const generic = /(hjem|home|velkommen|welcome|start|nyheter|news)$/i.test(candidate);
    if (!generic && candidate.split(" ").length <= 7) return candidate;
  }

  // 4. Full H1 stripped of separator tails, or title
  return (h1 || title).replace(/\s+[|\-–:].*$/, "").trim() || humanPath(page.url);
}

/**
 * Extracts the brand/person name to use as a secondary qualifier in suggestions.
 * Looks at publisher, author, Organization schema, and domain name.
 */
function extractBrandName(page: PageSnapshot): string {
  if (page.publisher) return page.publisher;
  if (page.author) return page.author;

  // Check Organization/Person schema
  const hasOrgSchema = page.schema.types.some((t) =>
    ["Organization", "LocalBusiness", "Person", "Corporation"].includes(t),
  );

  // If H1 has a separator, the LEFT side is typically the brand/person name
  const h1 = (page.h1 || "").trim();
  const h1Left = h1.match(/^(.{2,40}?)\s*[-–|]/);
  if (h1Left && hasOrgSchema) return h1Left[1]!.trim();

  // Fall back to domain name without TLD
  const hostname = new URL(page.url).hostname.replace(/^www\./, "");
  return hostname.split(".")[0]!.charAt(0).toUpperCase() + hostname.split(".")[0]!.slice(1);
}

/** @deprecated Use extractKeyword instead */
function pickFocusPhrase(page: PageSnapshot): string {
  return extractKeyword(page);
}

function proposeH1(page: PageSnapshot, keyword: string, brand: string, intent: SearchIntent): string {
  // Keep existing H1 if it's already well-formed
  if (page.h1 && page.h1.length >= 10 && page.h1.length <= 70) {
    return page.h1;
  }

  if (intent === "transactional") {
    return `${keyword} – priser, booking og praktisk info`;
  }
  if (intent === "commercial investigation") {
    return `${keyword} – sammenlign, vurder og velg riktig`;
  }

  return `${keyword} – komplett guide med fakta og vanlige spørsmål`;
}

function proposeStructure(page: PageSnapshot, intent: SearchIntent): string[] {
  const structure = [
    "Kort svar rett under H1",
    "Hovedpoeng eller nøkkelfordeler i punktliste",
    "Utdypende forklaring med konkrete eksempler",
  ];

  if (intent === "commercial investigation") {
    structure.push("Sammenligning av alternativer eller kriterier");
  }
  if (intent === "transactional") {
    structure.push("Praktisk neste steg med tydelig CTA");
  }
  if (page.tableCount === 0 && intent !== "navigational") {
    structure.push("Tabell eller faktaboks for raske svar");
  }
  if (!page.answerFirstSignals.hasFaq) {
    structure.push("FAQ med 3-5 spørsmål");
  }
  if (!page.hasContactLink && intent !== "informational") {
    structure.push("Kontakt eller bestillingsinformasjon");
  }

  return unique(structure);
}

function proposeContentLead(page: PageSnapshot, keyword: string, brand: string, intent: SearchIntent): string {
  const kw = keyword.toLowerCase();
  const br = brand;

  if (intent === "transactional") {
    return `${br} tilbyr ${kw} til bedriftsarrangementer, selskapsfester og private tilstelninger. Fyll ut kontaktskjemaet nedenfor for å motta et uforpliktende pristilbud.`;
  }
  if (intent === "commercial investigation") {
    return `${kw} fra ${br} – se hva som er inkludert, hvilke alternativer som finnes og hva som skiller dem fra hverandre.`;
  }

  // Informational: write a direct definitional opener
  const schemaHint = page.schema.types.includes("Person")
    ? `${br} er ${kw}`
    : page.schema.types.some((t) => ["Service", "LocalBusiness"].includes(t))
      ? `${kw} fra ${br} er`
      : `${kw} er`;

  return `${schemaHint} [én setning med hva dette er og hvem det passer for]. [Legg til den viktigste fordelen eller konsekvensen i setning to.] De vanligste spørsmålene er besvart nedenfor.`;
}

function proposeContentNotes(
  page: PageSnapshot,
  intent: SearchIntent,
  keyword: string,
  brand: string,
  proposedTitle: string,
  proposedDescription: string,
  proposedLead: string,
): string[] {
  const notes: string[] = [];
  const kw = keyword.toLowerCase();

  if (page.answerFirstSignals.directAnswerLikelihood < 70) {
    notes.push(`Flytt hovedsvaret øverst. Foreslått åpningssetning: «${proposedLead.split(".")[0]}.»`);
  }
  if (page.title.length < 15 || !page.title.toLowerCase().includes(kw.split(" ")[0]!)) {
    notes.push(`Foreslått metatittel: «${proposedTitle}»`);
  }
  if (page.metaDescription.length < 50 || !page.metaDescription.toLowerCase().includes(kw.split(" ")[0]!)) {
    notes.push(`Foreslått metabeskrivelse: «${proposedDescription}»`);
  }
  if (!page.answerFirstSignals.hasList) {
    notes.push(`Legg til en punktliste med 4–6 nøkkelfakta om ${kw} (f.eks. hva som er inkludert, pris, varighet, geografi).`);
  }
  if (!page.answerFirstSignals.hasFaq) {
    notes.push(`Legg til FAQ med spørsmål som «Hva koster ${kw}?», «Hvordan bestiller jeg ${kw}?» og «Passer ${kw} for mitt arrangement?»`);
  }
  if (page.wordCount < 500 && intent !== "navigational") {
    notes.push(`Siden har ${page.wordCount} ord – utvid med konkrete eksempler, priser og casebeskrivelser.`);
  }
  if (!page.author && !page.publisher) {
    notes.push(`Legg til byline eller «Om ${brand}»-seksjon for å styrke E-E-A-T og troverdighet.`);
  }
  if (!page.dateModified) {
    notes.push("Vis «Sist oppdatert»-dato i innholdsmal og speil den i Article-schema.");
  }

  return unique(notes).slice(0, 5);
}

function proposeSections(
  page: PageSnapshot,
  keyword: string,
  brand: string,
  intent: SearchIntent,
): PageSectionSuggestion[] {
  const kw = keyword.toLowerCase();
  const sections: PageSectionSuggestion[] = [
    {
      title: `Hva er ${kw}?`,
      purpose: "Gi søkemotorer og AI-assistenter et direkte, siterbart svar rett under H1.",
      suggestedContent: `${keyword} er [én setning: definisjon + hvem det passer for]. ${brand} tilbyr [hva] for [hvem] i [geografi]. Inkluder nøkkelord som søkere bruker, f.eks. «${kw} til bedriftsarrangement» eller «bestill ${kw}».`,
    },
    {
      title: `Hva får du med ${kw} fra ${brand}?`,
      purpose: "Dokumenter konkret hva som er inkludert – dette er det AI siterer mest.",
      suggestedContent: `Punktliste med 4–6 konkrete leveranser, f.eks.:\n• [Varighet / lengde på show]\n• [Antall gjester som dekkes]\n• [Type triks / format]\n• [Teknisk utstyr som følger med]\n• [Oppfølging / tilpasning]`,
    },
    {
      title: "Slik bestiller du",
      purpose: "Fjern friksjon – brukeren skal vite nøyaktig hva neste steg er.",
      suggestedContent: `1. Fyll ut kontaktskjema eller ring [telefonnummer]\n2. Oppgi dato, sted og antall gjester\n3. Motta uforpliktende tilbud innen [x virkedager]\n4. Bekreft og signer avtale`,
    },
  ];

  if (intent === "transactional") {
    sections.push({
      title: "Pris og praktisk info",
      purpose: "De fleste forlater siden fordi de ikke finner prisinformasjon – gi dem et prisanslag.",
      suggestedContent: `${keyword} koster fra [prisantydning] kr for [arrangement/varighet]. Prisen avhenger av [faktorer]. Ta kontakt for eksakt pristilbud.`,
    });
  } else {
    sections.push({
      title: `Når passer ${kw}?`,
      purpose: "Hjelp brukeren å kvalifisere seg selv – dette reduserer irrelevante henvendelser.",
      suggestedContent: `${keyword} passer best for:\n• Bedriftsarrangementer og kick-off\n• Selskapsfester og jubileer\n• Private tilstelninger som bursdager\n• [Legg til aktuelle arrangementstyper]`,
    });
  }

  if (!page.answerFirstSignals.hasFaq) {
    sections.push({
      title: "Vanlige spørsmål om " + kw,
      purpose: "FAQ-seksjoner øker sannsynlighet for svar i AI-overviews og featured snippets betraktelig.",
      suggestedContent: `Legg til FAQPage schema og svar på spørsmål som:\n• «Hva koster ${kw}?»\n• «Passer ${kw} for [typisk scenario]?»\n• «Hvordan bestiller jeg ${kw} fra ${brand}?»\n• «Hvor lang tid i forveien bør jeg bestille?»`,
    });
  }

  return sections;
}

function proposeFaq(keyword: string, brand: string, intent: SearchIntent): PageFaqSuggestion[] {
  const kw = keyword.toLowerCase();

  const bookingAnswer =
    intent === "transactional"
      ? `Ta kontakt med ${brand} via kontaktskjema eller telefon. Oppgi ønsket dato, sted og antall gjester, så sender vi et uforpliktende tilbud.`
      : `Ta kontakt med ${brand} for å diskutere behov og tilgjengelighet.`;

  return [
    {
      question: `Hva er ${kw}?`,
      answer: `${keyword} er [én setning med klar definisjon]. ${brand} leverer [hva] for [hvem] – [viktigste fordel eller USP].`,
    },
    {
      question: `Hva koster ${kw}?`,
      answer: `Prisen for ${kw} fra ${brand} starter fra [X] kr og avhenger av [varighet / antall gjester / tilpasning]. Kontakt oss for eksakt pristilbud.`,
    },
    {
      question: `Passer ${kw} for bedriftsarrangementer?`,
      answer: `Ja, ${kw} fra ${brand} er godt egnet for bedriftsarrangementer, kick-off, konferanser og teambuilding. Vi tilpasser programmet etter ditt arrangement og antall gjester.`,
    },
    {
      question: `Hvordan bestiller jeg ${kw}?`,
      answer: bookingAnswer,
    },
  ];
}

function proposeCta(keyword: string, intent: SearchIntent): string {
  const kw = keyword.toLowerCase();
  if (intent === "transactional") {
    return `Be om pris på ${kw} – fyll ut skjemaet og motta tilbud innen [X] virkedager.`;
  }
  if (intent === "commercial investigation") {
    return `Sammenlign alternativer eller ta kontakt for en uforpliktende prat om ${kw}.`;
  }
  return `Har du spørsmål om ${kw}? Ta kontakt – vi svarer raskt.`;
}

function proposeMetaTitle(page: PageSnapshot, keyword: string, brand: string): string {
  const intent = classifyIntent(page);
  const kw = keyword;

  let title: string;
  if (intent === "commercial investigation") {
    title = `${kw} – sammenligning, fordeler og hva du bør vite`;
  } else if (intent === "transactional") {
    title = `${kw} – bestilling, priser og praktisk info`;
  } else {
    // Informational: lead with the keyword, avoid "guide" filler
    title = `${kw} – alt du trenger å vite`;
  }

  const full = `${title} | ${brand}`;
  return trimToLength(full, 60);
}

function proposeMetaDescription(
  page: PageSnapshot,
  keyword: string,
  brand: string,
  intent: SearchIntent,
): string {
  const kw = keyword.toLowerCase();

  let desc: string;
  if (intent === "transactional") {
    desc = `Bestill ${kw} fra ${brand}. Se hva som er inkludert, få et uforpliktende pristilbud og ta kontakt for din neste selskapsfest eller bedriftsarrangement.`;
  } else if (intent === "commercial investigation") {
    desc = `Lær om ${kw} fra ${brand} – hva du får, hva det koster og hvordan det skiller seg fra alternativene. Finn riktig løsning for ditt behov.`;
  } else {
    const freshness = page.dateModified ? " Oppdatert informasjon." : "";
    desc = `${brand} forklarer hva ${kw} er, hvem det passer for og hva du bør vite før du tar neste steg.${freshness} Inkluderer FAQ og praktiske tips.`;
  }

  return trimToLength(desc, 155);
}

function proposeSchema(
  page: PageSnapshot,
  focus: string,
  intent: SearchIntent,
  metaDescription: string,
): { schemaType: string; jsonLd: string } {
  const primaryType = pickPrimarySchemaType(page, intent);
  const graph: Array<Record<string, unknown>> = [
    {
      "@context": "https://schema.org",
      "@type": primaryType,
      "@id": `${page.url}#primary`,
      url: page.url,
      name: focus,
      headline: focus,
      description: metaDescription,
      inLanguage: "nb-NO",
      ...(page.datePublished ? { datePublished: page.datePublished } : {}),
      ...(page.dateModified ? { dateModified: page.dateModified } : {}),
      ...(page.author ? { author: { "@type": "Person", name: page.author } } : {}),
      ...(page.publisher
        ? {
            publisher: {
              "@type": "Organization",
              name: page.publisher,
            },
          }
        : {}),
    },
  ];

  if (page.answerFirstSignals.hasFaq || page.faqCount > 0) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${page.url}#faq`,
      mainEntity: [
        {
          "@type": "Question",
          name: `Hva bør brukeren vite om ${focus.toLowerCase()}?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `Start med et kort svar på hva ${focus.toLowerCase()} er, hvem det passer for og hva neste steg er.`,
          },
        },
        {
          "@type": "Question",
          name: `Hvordan fungerer ${focus.toLowerCase()} i praksis?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: "Forklar prosessen steg for steg med konkrete detaljer, priser eller kriterier der det er relevant.",
          },
        },
      ],
    });
  }

  const jsonLd = graph.length === 1 ? graph[0] : { "@context": "https://schema.org", "@graph": graph };

  return {
    schemaType: graph.length === 1 ? primaryType : `${primaryType} + FAQPage`,
    jsonLd: JSON.stringify(jsonLd, null, 2),
  };
}

function pickPrimarySchemaType(page: PageSnapshot, intent: SearchIntent): string {
  if (intent === "transactional") {
    return "Service";
  }
  if (page.author || page.datePublished || page.wordCount >= 700) {
    return "Article";
  }
  return "WebPage";
}

function buildSuggestionRationale(page: PageSnapshot): string[] {
  const rationale: string[] = [];

  if (page.title.length < 35 || page.title.length > 60) {
    rationale.push("Metatittelen bør bli tydeligere og mer fokusert.");
  }
  if (page.metaDescription.length < 120 || page.metaDescription.length > 160) {
    rationale.push("Metabeskrivelsen kan bli mer presis og mer klikkvennlig.");
  }
  if (!page.schema.types.length) {
    rationale.push("Siden mangler JSON-LD og sender derfor svakere semantiske signaler.");
  } else if (!page.schema.matchesVisibleContent) {
    rationale.push("Eksisterende schema bør skrives om så det matcher synlig innhold.");
  }
  if (page.answerFirstSignals.directAnswerLikelihood < 70) {
    rationale.push("Åpningen bør svare raskere på hovedspørsmålet.");
  }

  if (!rationale.length) {
    rationale.push("Siden er allerede ganske sterk, så forslagene handler mest om å spisse struktur og metadata.");
  }

  return rationale;
}

function buildPageReport(
  page: PageSnapshot | null,
  suggestion: PageImprovementSuggestion | null,
): PageAuditReport | null {
  if (!page || !suggestion) {
    return null;
  }

  const changeSummary = [
    suggestion.current.h1 !== suggestion.proposed.h1 ? "Spiss hovedoverskriften så siden forklarer verdien raskere." : null,
    suggestion.current.metaTitle !== suggestion.proposed.metaTitle ? "Skriv en mer målrettet metatittel med tydelig tema og avsender." : null,
    suggestion.current.metaDescription !== suggestion.proposed.metaDescription
      ? "Skriv en metabeskrivelse som forklarer verdi og neste steg tydeligere."
      : null,
    !suggestion.current.schemaTypes.length
      ? "Legg til JSON-LD slik at siden sender sterkere semantiske signaler."
      : null,
    page.answerFirstSignals.directAnswerLikelihood < 70
      ? "Flytt hovedsvaret høyere opp og gjør åpningen mer konkret."
      : null,
  ].filter((item): item is string => Boolean(item));

  const priorityActions = [
    suggestion.proposed.structure[0],
    suggestion.proposed.sections[0]?.title ? `Bygg ut seksjonen «${suggestion.proposed.sections[0].title}».` : null,
    `Oppdater metadata til «${suggestion.proposed.metaTitle}».`,
    `Legg inn ${suggestion.proposed.schemaType} som JSON-LD.`,
  ].filter((item): item is string => Boolean(item));

  return {
    intent: suggestion.intent,
    current: {
      url: page.url,
      title: page.title,
      metaTitle: suggestion.current.metaTitle,
      metaDescription: suggestion.current.metaDescription,
      h1: suggestion.current.h1,
      opening: suggestion.current.opening,
      schemaTypes: suggestion.current.schemaTypes,
      renderingModel: page.rendering.renderingModel,
      answerScore: page.answerFirstSignals.directAnswerLikelihood,
    },
    proposed: {
      metaTitle: suggestion.proposed.metaTitle,
      metaDescription: suggestion.proposed.metaDescription,
      h1: suggestion.proposed.h1,
      opening: suggestion.proposed.contentLead,
      structure: suggestion.proposed.structure,
      sections: suggestion.proposed.sections,
      faq: suggestion.proposed.faq,
      cta: suggestion.proposed.cta,
      schemaType: suggestion.proposed.schemaType,
      jsonLd: suggestion.proposed.jsonLd,
    },
    changeSummary,
    priorityActions,
  };
}

function buildImplementationPacks(
  mode: AuditRequestInput["mode"],
  pages: PageSnapshot[],
  suggestions: PageImprovementSuggestion[],
  categoryScores: CategoryScore[],
  providerScores: ProviderScore[],
  indexNowStatus: IndexNowStatus,
): ImplementationPack[] {
  const limit = mode === "page" ? 1 : 5;

  return suggestions
    .map((suggestion) => {
      const page = pages.find((candidate) => candidate.url === suggestion.url);
      if (!page) {
        return null;
      }

      const simulatedPage = applySuggestionToSnapshot(page, suggestion);
      const simulatedMetrics = buildDomainMetrics([simulatedPage], mode === "page" ? [] : buildTopicClusters([simulatedPage]), indexNowStatus);
      const afterCategoryScores = buildCategoryScores(simulatedMetrics);
      const afterProviderScores = buildProviderScores(simulatedMetrics);
      const totalScoreBefore = safeNumber(
        categoryScores.reduce((sum, category) => sum + (category.score * category.weight) / 100, 0),
        1,
      );
      const totalScoreAfter = safeNumber(
        afterCategoryScores.reduce((sum, category) => sum + (category.score * category.weight) / 100, 0),
        1,
      );

      const patchBlocks = buildPatchBlocks(suggestion);
      const evidence = unique([
        ...suggestion.rationale,
        ...suggestion.proposed.contentNotes,
      ]).slice(0, 6);

      return {
        id: `impl-${suggestion.url}`,
        url: suggestion.url,
        pageTitle: suggestion.pageTitle,
        mode,
        currentSnapshot: {
          h1: suggestion.current.h1,
          opening: suggestion.current.opening,
          metaTitle: suggestion.current.metaTitle,
          metaDescription: suggestion.current.metaDescription,
          schemaTypes: suggestion.current.schemaTypes,
        },
        proposedSnapshot: {
          h1: suggestion.proposed.h1,
          opening: suggestion.proposed.contentLead,
          structure: suggestion.proposed.structure,
          sections: suggestion.proposed.sections,
          faq: suggestion.proposed.faq,
          cta: suggestion.proposed.cta,
          metaTitle: suggestion.proposed.metaTitle,
          metaDescription: suggestion.proposed.metaDescription,
          schemaType: suggestion.proposed.schemaType,
          jsonLd: suggestion.proposed.jsonLd,
        },
        patchBlocks,
        predictedImpact: {
          totalScoreBefore,
          totalScoreAfter,
          totalScoreDelta: safeNumber(totalScoreAfter - totalScoreBefore),
          categories: categoryScores.map((category) => {
            const after = afterCategoryScores.find((item) => item.id === category.id)?.score ?? category.score;
            return {
              id: category.id,
              before: category.score,
              after,
              delta: safeNumber(after - category.score),
            };
          }),
          providers: providerScores.map((provider) => {
            const after = afterProviderScores.find((item) => item.provider === provider.provider)?.score ?? provider.score;
            return {
              provider: provider.provider,
              before: provider.score,
              after,
              delta: safeNumber(after - provider.score),
            };
          }),
        },
        evidence,
      } satisfies ImplementationPack;
    })
    .filter((item): item is ImplementationPack => Boolean(item))
    .sort((left, right) => right.predictedImpact.totalScoreDelta - left.predictedImpact.totalScoreDelta)
    .slice(0, limit);
}

function applySuggestionToSnapshot(page: PageSnapshot, suggestion: PageImprovementSuggestion): PageSnapshot {
  const improvedWordCount = Math.max(
    page.wordCount,
    extractTextTokens(
      [
        suggestion.proposed.contentLead,
        ...suggestion.proposed.sections.map((section) => section.suggestedContent),
        ...suggestion.proposed.faq.map((faq) => `${faq.question} ${faq.answer}`),
        suggestion.proposed.cta,
      ].join(" "),
    ).length,
  );

  return {
    ...page,
    title: suggestion.proposed.metaTitle,
    metaDescription: suggestion.proposed.metaDescription,
    h1: suggestion.proposed.h1,
    firstParagraph: suggestion.proposed.contentLead,
    bodyText: [
      suggestion.proposed.contentLead,
      ...suggestion.proposed.sections.map((section) => `${section.title}. ${section.suggestedContent}`),
      ...suggestion.proposed.faq.map((faq) => `${faq.question}. ${faq.answer}`),
      suggestion.proposed.cta,
    ].join(" "),
    wordCount: improvedWordCount,
    paragraphCount: Math.max(page.paragraphCount, suggestion.proposed.sections.length + 2),
    listCount: Math.max(page.listCount, 1),
    tableCount: Math.max(page.tableCount, suggestion.proposed.structure.some((item) => item.includes("Tabell")) ? 1 : page.tableCount),
    faqCount: Math.max(page.faqCount, suggestion.proposed.faq.length ? 1 : 0),
    schema: {
      ...page.schema,
      types: unique(
        suggestion.proposed.schemaType
          .split("+")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
      itemCount: suggestion.proposed.schemaType.includes("FAQPage") ? 2 : 1,
      matchesVisibleContent: true,
    },
    dateModified: page.dateModified ?? new Date().toISOString(),
    answerFirstSignals: {
      conciseOpening: true,
      hasFaq: suggestion.proposed.faq.length > 0,
      hasTable: suggestion.proposed.structure.some((item) => item.includes("Tabell")),
      hasList: true,
      directAnswerLikelihood: 92,
    },
  };
}

function buildPatchBlocks(suggestion: PageImprovementSuggestion): ImplementationPack["patchBlocks"] {
  return [
    {
      id: "meta",
      label: "Metadata",
      content: [
        `Metatittel: ${suggestion.proposed.metaTitle}`,
        `Metabeskrivelse: ${suggestion.proposed.metaDescription}`,
      ].join("\n"),
    },
    {
      id: "headline",
      label: "H1 og åpning",
      content: [`H1: ${suggestion.proposed.h1}`, `Ingress: ${suggestion.proposed.contentLead}`].join("\n\n"),
    },
    {
      id: "sections",
      label: "Seksjonsutkast",
      content: suggestion.proposed.sections
        .map(
          (section) =>
            `## ${section.title}\nFormål: ${section.purpose}\n\n${section.suggestedContent}`,
        )
        .join("\n\n"),
    },
    {
      id: "faq",
      label: "FAQ og CTA",
      content: [
        ...suggestion.proposed.faq.map((faq) => `Q: ${faq.question}\nA: ${faq.answer}`),
        `CTA: ${suggestion.proposed.cta}`,
      ].join("\n\n"),
    },
    {
      id: "schema",
      label: "JSON-LD",
      content: suggestion.proposed.jsonLd,
    },
  ];
}

function readableOpening(bodyText: string): string {
  return bodyText.split(/\.\s+/).slice(0, 2).join(". ").trim();
}

function suggestionNeedScore(suggestion: PageImprovementSuggestion): number {
  let score = 0;

  if (suggestion.current.metaTitle.length < 35 || suggestion.current.metaTitle.length > 60) {
    score += 3;
  }
  if (suggestion.current.metaDescription.length < 120 || suggestion.current.metaDescription.length > 160) {
    score += 3;
  }
  if (!suggestion.current.schemaTypes.length) {
    score += 3;
  }
  if (suggestion.rationale.some((item) => item.includes("Åpningen"))) {
    score += 4;
  }

  return score;
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

function majorityIntent(intents: SearchIntent[]): SearchIntent {
  const counts = new Map<SearchIntent, number>();
  for (const intent of intents) {
    counts.set(intent, (counts.get(intent) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "informational";
}

function inferMissingCoverage(intent: SearchIntent, pages: PageSnapshot[]): string[] {
  const missing: string[] = [];
  const hasFaq = pages.some((page) => page.answerFirstSignals.hasFaq);
  const hasTable = pages.some((page) => page.answerFirstSignals.hasTable);
  const hasStrongOpening = average(pages.map((page) => page.answerFirstSignals.directAnswerLikelihood)) >= 60;

  if (!hasStrongOpening) {
    missing.push("Kort svarblokk høyt på siden");
  }
  if (!hasFaq && intent === "informational") {
    missing.push("FAQ eller Q&A-seksjon");
  }
  if (!hasTable && intent === "commercial investigation") {
    missing.push("Sammenligningstabell eller kriterieoversikt");
  }
  if (intent === "transactional") {
    missing.push("Tydelig neste steg / CTA koblet til informasjonsdelen");
  }

  return missing;
}

function summarizeTopTokens(tokenGroups: string[][]): string[] {
  const counts = new Map<string, number>();
  for (const tokens of tokenGroups) {
    for (const token of unique(tokens)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([token]) => token.length > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([token]) => token);
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const value of left.values()) {
    leftMagnitude += value * value;
  }

  for (const value of right.values()) {
    rightMagnitude += value * value;
  }

  for (const [token, value] of left) {
    dotProduct += value * (right.get(token) ?? 0);
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function collectBlockerLines(pages: PageSnapshot[], provider: ProviderId): string[] {
  const blocked = pages.filter((page) => page.robotsEvaluation.blockedProviders.includes(provider));
  if (!blocked.length) {
    return [];
  }

  return [`Robots-regler blokkerer ${PROVIDER_LABELS[provider].toLowerCase()} på ${blocked.length} side(r).`];
}

function issue(
  id: string,
  category: CategoryId,
  title: string,
  description: string,
  priority: Priority,
  affectedUrls: string[],
  providerImpact: ProviderId[],
): Issue {
  return {
    id,
    category,
    title,
    description,
    priority,
    affectedUrls,
    providerImpact,
  };
}

function recommendation(
  id: string,
  effort: EffortLevel,
  impact: "Høy" | "Middels" | "Lav",
  title: string,
  rationale: string,
  target: string,
  providers: ProviderId[],
  action: string,
): Recommendation {
  return {
    id,
    effort,
    impact,
    title,
    rationale,
    target,
    providers,
    action,
  };
}

function uniqueBy<T>(items: T[], selector: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = selector(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function prioritySort(a: Issue, b: Issue): number {
  const order: Record<Priority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return order[a.priority] - order[b.priority];
}
