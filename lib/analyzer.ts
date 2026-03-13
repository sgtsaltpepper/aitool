import { CATEGORY_LABELS, CATEGORY_WEIGHTS, PROVIDER_LABELS } from "@/lib/config";
import type {
  AuditReport,
  AuditRequestInput,
  CategoryId,
  CategoryScore,
  CompetitiveContext,
  CompetitiveGap,
  EffortLevel,
  Issue,
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
};

type BuildReportInput = {
  runId: string;
  request: AuditRequestInput;
  targetPages: PageSnapshot[];
  competitorPagesByDomain: Record<string, PageSnapshot[]>;
  previousReport: AuditReport | null;
};

export function buildAuditReport(input: BuildReportInput): AuditReport {
  const targetTopicClusters = buildTopicClusters(input.targetPages);
  const metrics = buildDomainMetrics(input.targetPages, targetTopicClusters);
  const categoryScores = buildCategoryScores(metrics);
  const issues = buildIssues(metrics, categoryScores);
  const recommendations = buildRecommendations(issues, metrics);
  const providerScores = buildProviderScores(metrics);
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
    categoryScores,
    providerScores,
    issues,
    recommendations,
    pages: input.targetPages,
    topicClusters: targetTopicClusters,
    competitiveContext,
    comparison,
  };
}

function buildDomainMetrics(pages: PageSnapshot[], topicClusters: TopicCluster[]): DomainMetrics {
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
    hasIndexNowSignal: eligiblePages.some((page) => page.bodyText.toLowerCase().includes("indexnow")),
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
  const intent = clamp(
    metrics.topicClusters.length * 14 +
      metrics.uniqueIntents.length * 18 -
      metrics.topicClusters.filter((cluster) => cluster.pages.length === 1).length * 5,
  );
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
        ? `${metrics.orphanPages.length} foreldreløse sider eller blokkerte/noindex-ressurser svekker indekserbarheten.`
        : "Robots, noindex og intern oppdagelse ser generelt sunne ut.",
    ],
    [
      "renderingAiAccessibility",
      rendering,
      metrics.renderHeavyPages.length
        ? `${metrics.renderHeavyPages.length} sider er avhengige av tung klientrendering.`
        : "Det meste av innholdet er tilgjengelig uten tung klientrendering.",
    ],
    [
      "answerFirstContent",
      answerFirst,
      metrics.answerFirstAverage >= 70
        ? "Innholdet går raskt til svaret og har flere AI-/snippet-vennlige blokker."
        : "Flere sider mangler korte svar høyere i innholdshierarkiet.",
    ],
    [
      "citationAuthorityEntitySignals",
      citation,
      metrics.authorTransparencyCoverage >= 70
        ? "Forfatter-, publisher- og kontakt-signaler er godt representert."
        : "Entity-, forfatter- eller transparenssignaler mangler på mange sider.",
    ],
    [
      "schemaSemanticSearch",
      schema,
      metrics.schemaMismatchPages.length
        ? `${metrics.schemaMismatchPages.length} sider har schema som ikke samsvarer tydelig med synlig innhold.`
        : "Schema-dekning og semantiske signaler er i god form.",
    ],
    [
      "internalLinking",
      internalLinking,
      metrics.deepPages.length
        ? `${metrics.deepPages.length} sider ligger dypt i klikkstien eller mangler nok interne lenker.`
        : "Internlenker og klikkdybde støtter god crawlability.",
    ],
    [
      "searchIntentTopicClusters",
      intent,
      metrics.topicClusters.length
        ? `${metrics.topicClusters.length} topic clusters ble identifisert med ${metrics.uniqueIntents.length} intents.`
        : "Det var for lite innhold til å bygge tydelige topic clusters.",
    ],
    [
      "zeroClickAiOverviews",
      zeroClick,
      metrics.snippetRestrictedPages.length
        ? "Snippet-kontroller begrenser hvor mye som kan gjenbrukes i søkeresultater og AI-svar."
        : "Innholdet virker relativt klart for snippets og AI-overviews.",
    ],
    [
      "contentFreshness",
      freshness,
      metrics.freshnessCoverage >= 60
        ? "Flere sider har synlige oppdateringssignaler og rimelig ferskhet."
        : "Mangler i datofelt og få oppdateringssignaler svekker ferskhetsscoren.",
    ],
    [
      "technicalOptimization",
      technical,
      technical >= 75
        ? "Titler, metabeskrivelser, canonicals og mediesignaler dekker det meste."
        : "Tekniske metadata og mediesignaler har flere hull som er raske å tette.",
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

  if (!metrics.hasIndexNowSignal) {
    issues.push(
      issue(
        "indexnow-readiness",
        "Ingen tydelig IndexNow-beredskap funnet",
        "Det ble ikke funnet signaler på at nettstedet aktivt pusher URL-endringer til Bing-økosystemet.",
        "low",
        [],
        ["bing"],
      ),
    );
  }

  if (categoryScores.find((score) => score.id === "technicalOptimization")?.score ?? 0 < 70) {
    issues.push(
      issue(
        "technical-metadata",
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
        metrics.hasIndexNowSignal && !metrics.snippetRestrictedPages.length
          ? "Copilot/Bing har en god teknisk basis for raskere oppdagelse og utdrag."
          : "Copilot/Bing-profilen kan styrkes med snippet-kontroll, schema og raskere oppdagelsessignaler.",
      blockers: [
        ...collectBlockerLines(metrics.pages, "bing"),
        ...(!metrics.hasIndexNowSignal ? ["Ingen tydelig IndexNow-beredskap funnet."] : []),
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
    const competitorMetrics = buildDomainMetrics(pages, clusters);
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
  title: string,
  description: string,
  priority: Priority,
  affectedUrls: string[],
  providerImpact: ProviderId[],
): Issue {
  return {
    id,
    category: title,
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
