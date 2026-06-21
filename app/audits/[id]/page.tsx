import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/AutoRefresh";
import { AuditChangeTracker } from "@/components/AuditChangeTracker";
import { ScorePill, StatusPill } from "@/components/Badges";
import { SyncButton } from "@/app/integrations/SyncButton";
import { CATEGORY_LABELS, PROVIDER_LABELS } from "@/lib/config";
import { getAuditReport, getAuditRun, getGoogleConnection, listAuditChangeEvents, listAuditRuns, listDomainIntegrations } from "@/lib/db";
import type { AuditChangeSnapshot, AuditChangeTemplate, AuditReport, ImplementationPack, Issue, PageIntent, Recommendation, SearchIntent } from "@/lib/types";
import { humanPath, readableExcerpt, summarizeList } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function AuditReportPage({ params }: { params: Promise<{ id: string }> }) {
  return <AuditReportPageInner params={params} />;
}

async function AuditReportPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getAuditRun(id);

  if (!run) {
    notFound();
  }

  const report = run.status === "completed" ? getAuditReport(id) : null;
  const changeTemplates = report ? buildAuditChangeTemplates(report) : [];
  const changeEntries = listAuditChangeEvents(run.targetUrl, run.request.mode);
  const history = listAuditRuns(20).filter(
    (entry) => entry.targetUrl === run.targetUrl && entry.request.mode === run.request.mode,
  );
  const googleConnection = getGoogleConnection();
  const domain = (() => { try { return new URL(run.targetUrl).hostname; } catch { return run.targetUrl; } })();
  const domainIntegration = listDomainIntegrations().find((d) => d.domain === domain) ?? null;

  return (
    <>
      {/* Google integration status */}
      {googleConnection && domainIntegration && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "12px 16px", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ color: "#16a34a" }}>✓</span>
          <span style={{ fontSize: "14px", color: "#166534" }}>
            GSC & GA4 connected for <strong>{domain}</strong>.{" "}
            <Link href="/opportunities" style={{ color: "#15803d" }}>View opportunities →</Link>
          </span>
        </div>
      )}
      {!googleConnection && (
        <div style={{ background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px 16px", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>
            Connect Google Search Console to unlock opportunity tracking.{" "}
            <Link href="/integrations" style={{ color: "#2563eb" }}>Set up integrations →</Link>
          </span>
        </div>
      )}
      <AutoRefresh enabled={run.status === "queued" || run.status === "running"} />

      <div className="report-header">
        <div>
          <p className="muted">
            {run.request.mode === "page" ? "Sideanalyse av" : "Analyse av"} {run.targetUrl}
          </p>
          <h1>Rapport</h1>
          <p>
            {run.request.mode === "page"
              ? "Før/etter-anbefalinger for akkurat denne siden, med forslag til innhold, struktur, metadata og JSON-LD."
              : "Status, prioriterte funn og anbefalinger for AI-boter, klassisk søk og strukturell forståelse av nettstedet."}
          </p>
        </div>
        <div className="button-row">
          {run.summary ? <ScorePill score={run.summary.totalScore} /> : null}
          <StatusPill status={run.status} />
          <Link href="/integrations" className="secondary-button">
            Domener og integrasjoner
          </Link>
          {domainIntegration ? (
            <Link href={`/opportunities${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`} className="secondary-button">
              Opportunities
            </Link>
          ) : null}
          {googleConnection && domainIntegration ? <SyncButton /> : null}
          {report ? (
            <a href={`/api/audits/${run.id}/suggestions`} className="secondary-button" download>
              Eksporter forslag (.md)
            </a>
          ) : null}
          <Link href="/" className="secondary-button">
            {run.request.mode === "page" ? "Ny domeneanalyse" : "Ny analyse"}
          </Link>
          {run.request.mode === "page" ? (
            <Link href="/page-audit" className="secondary-button">
              Ny sideanalyse
            </Link>
          ) : null}
        </div>
      </div>

      {run.status !== "completed" || !report ? (
        <section className="empty-state">
          <h3>{run.status === "failed" ? "Analysen feilet" : "Analysen kjører"}</h3>
          <p>{run.status === "failed" ? run.errorMessage ?? "Noe gikk galt under kjøringen." : run.progress.message}</p>
          {run.status !== "failed" ? (
            <div className="progress-panel">
              <div className="progress-meta">
                <strong>{run.progress.percent}%</strong>
                <span>{phaseLabel(run.progress.phase)}</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${run.progress.percent}%` }} />
              </div>
              <div className="progress-stats">
                <span>
                  Sider crawlet: {run.progress.pagesCrawled} / {run.progress.pagesTarget}
                </span>
                <span>Oppdaget: {run.progress.pagesDiscovered}</span>
                {run.progress.competitorsTotal > 0 ? (
                  <span>
                    Konkurrenter: {run.progress.competitorsCompleted} / {run.progress.competitorsTotal}
                  </span>
                ) : null}
                <span>
                  Estimat igjen:{" "}
                  {run.progress.estimatedSecondsRemaining !== null
                    ? formatEta(run.progress.estimatedSecondsRemaining)
                    : "beregnes..."}
                </span>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        run.request.mode === "page" && report?.pageReport ? (
        <>
          <section className="report-grid">
            <div className="section-header">
              <h2>Nå-situasjonen</h2>
              <p>{report.summary}</p>
            </div>
            <div className="overview-grid">
              <div className="card">
                <div className="score-lg">
                  <span className="muted">Samlet vurdering</span>
                  <strong>{report.totalScore}</strong>
                  <span className="muted">
                    {report.comparison.totalScoreDelta !== null
                      ? `${report.comparison.totalScoreDelta >= 0 ? "+" : ""}${report.comparison.totalScoreDelta} siden sist`
                      : "Første sideanalyse for denne URL-en"}
                  </span>
                </div>
              </div>
              <div className="card">
                <h3>Dagens side</h3>
                <ul className="list">
                  <li>
                    <strong>H1</strong>
                    <p>{report.pageReport.current.h1 || "Ingen tydelig H1 funnet"}</p>
                  </li>
                  <li>
                    <strong>Åpning</strong>
                    <p>{report.pageReport.current.opening || "Ingen tydelig ingress eller lesbar åpning funnet."}</p>
                  </li>
                  <li>
                    <strong>Metadata</strong>
                    <p>
                      {report.pageReport.current.metaTitle || "Ingen tittel"}.{" "}
                      {report.pageReport.current.metaDescription || "Ingen metabeskrivelse."}
                    </p>
                  </li>
                </ul>
              </div>
              <div className="card">
                <h3>Det viktigste å ta tak i</h3>
                <ul className="list">
                  {report.pageReport.changeSummary.map((item) => (
                    <li key={item}>
                      <p>{item}</p>
                    </li>
                  ))}
                </ul>
              </div>
              {report.pageReport.searchInsights?.performanceConclusions?.length ? (
                <div className="card">
                  <h3>Det systemet reagerte på</h3>
                  <ul className="list">
                    {report.pageReport.searchInsights.performanceConclusions?.map((item) => (
                      <li key={item}>
                        <p>{item}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Implementation Pack</h2>
              <p>Dette er den konkrete leveransen du kan bruke til å oppdatere siden med én gang.</p>
            </div>
            <div className="recommendations-grid">
              {report.implementationPacks.map((pack) => (
                <ImplementationPackCard key={pack.id} pack={pack} />
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Anbefalt ny sidestruktur</h2>
              <p>Slik kan siden bygges opp for å svare raskere, bli mer overbevisende og lettere å bruke i søk og AI-svar.</p>
            </div>
            <div className="recommendations-grid">
              <article className="recommendation">
                <h3>Foreslått oppsett</h3>
                <ul className="list">
                  {report.pageReport.proposed.structure.map((item, index) => (
                    <li key={item}>
                      <strong>Steg {index + 1}</strong>
                      <p>{item}</p>
                    </li>
                  ))}
                </ul>
              </article>
              <article className="recommendation">
                <h3>Anbefalte seksjoner</h3>
                <ul className="list">
                  {report.pageReport.proposed.sections.map((section) => (
                    <li key={section.title}>
                      <strong>{section.title}</strong>
                      <p>{section.purpose}</p>
                      <p>{section.suggestedContent}</p>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Bedre innhold for denne siden</h2>
              <p>Konkrete forslag til overskrift, åpning, FAQ og neste steg.</p>
            </div>
            <div className="recommendations-grid">
              <article className="recommendation">
                <ul className="list">
                  <li>
                    <strong>Foreslått H1</strong>
                    <p>{report.pageReport.proposed.h1}</p>
                  </li>
                  <li>
                    <strong>Foreslått åpning</strong>
                    <p>{report.pageReport.proposed.opening}</p>
                  </li>
                  <li>
                    <strong>Foreslått CTA</strong>
                    <p>{report.pageReport.proposed.cta}</p>
                  </li>
                </ul>
              </article>
              <article className="recommendation">
                <h3>FAQ-forslag</h3>
                <ul className="list">
                  {report.pageReport.proposed.faq.map((faq) => (
                    <li key={faq.question}>
                      <strong>{faq.question}</strong>
                      <p>{faq.answer}</p>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Bedre metadata</h2>
              <p>Før/etter for metatittel og metabeskrivelse, basert på sideinnhold og signaler fra GSC/GA4 når de finnes.</p>
            </div>
            <div className="recommendations-grid">
              <article className="recommendation">
                <ul className="list">
                  <li>
                    <strong>Nåværende metatittel</strong>
                    <p>{report.pageReport.current.metaTitle || "Ingen metatittel funnet."}</p>
                  </li>
                  <li>
                    <strong>Foreslått metatittel</strong>
                    <p>{report.pageReport.proposed.metaTitle}</p>
                  </li>
                </ul>
              </article>
              <article className="recommendation">
                <ul className="list">
                  <li>
                    <strong>Nåværende metabeskrivelse</strong>
                    <p>{report.pageReport.current.metaDescription || "Ingen metabeskrivelse funnet."}</p>
                  </li>
                  <li>
                    <strong>Foreslått metabeskrivelse</strong>
                    <p>{report.pageReport.proposed.metaDescription}</p>
                  </li>
                </ul>
              </article>
            </div>
            {report.pageReport.metadataAgent ? (
              <p className="muted" style={{ marginTop: "0.75rem" }}>
                Metadata generert av <strong>{report.pageReport.metadataAgent.name}</strong>
                {report.pageReport.metadataAgent.mode === "openai"
                  ? report.pageReport.metadataAgent.model
                    ? ` via ${report.pageReport.metadataAgent.model}`
                    : " via AI"
                  : " med lokal fallback"}
              </p>
            ) : null}
            {report.pageReport.searchInsights ? (
              <article className="recommendation">
                <h3>Søkeinnsikt bak forslaget</h3>
                <ul className="list">
                  {report.pageReport.searchInsights.audience ? (
                    <li>
                      <strong>Publikum</strong>
                      <p>{report.pageReport.searchInsights.audience}</p>
                    </li>
                  ) : null}
                  {report.pageReport.searchInsights.contentHighlights.length ? (
                    <li>
                      <strong>Innhold som er gjenkjent på siden</strong>
                      <p>{report.pageReport.searchInsights.contentHighlights.join(", ")}</p>
                    </li>
                  ) : null}
                  {report.pageReport.searchInsights.topQueries.length ? (
                    <li>
                      <strong>Topp søk</strong>
                      <p>{report.pageReport.searchInsights.topQueries.map((item) => item.query).join(", ")}</p>
                    </li>
                  ) : null}
                  {report.pageReport.searchInsights.contentGaps.length ? (
                    <li>
                      <strong>Anbefalte innholdsendringer</strong>
                      <p>{report.pageReport.searchInsights.contentGaps.join(" ")}</p>
                    </li>
                  ) : null}
                </ul>
              </article>
            ) : null}
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Foreslått JSON-LD</h2>
              <p>Schema-utkastet er tilpasset akkurat denne siden og bør speile synlig innhold.</p>
            </div>
            <article className="recommendation">
              <ul className="list">
                <li>
                  <strong>Schema-type</strong>
                  <p>{report.pageReport.proposed.schemaType}</p>
                </li>
                <li>
                  <strong>Nåværende schema</strong>
                  <p>
                    {report.pageReport.current.schemaTypes.length
                      ? report.pageReport.current.schemaTypes.join(", ")
                      : "Ingen schema funnet."}
                  </p>
                </li>
              </ul>
              <pre>{report.pageReport.proposed.jsonLd}</pre>
            </article>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Hva du bør endre først</h2>
              <p>Disse punktene gir mest effekt tidlig.</p>
            </div>
            <div className="issues-grid">
              {report.pageReport.priorityActions.map((action) => (
                <article className="issue-card" key={action}>
                  <p>{action}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Providerprofiler</h2>
              <p>Her ser du hvordan ulike plattformer sannsynligvis vil oppfatte og bruke akkurat denne siden.</p>
            </div>
            <div className="provider-grid">
              {report.providerScores.map((provider) => (
                <article className="provider-card" key={provider.provider}>
                  <div className="button-row">
                    <h3>{provider.label}</h3>
                    <ScorePill score={provider.score} />
                  </div>
                  <p>{provider.summary}</p>
                  <ul className="list">
                    <li>
                      <strong>Hva dette betyr</strong>
                      <p>{providerExplanation(provider.score)}</p>
                    </li>
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="history-panel">
            <AuditChangeTracker
              auditRunId={run.id}
              targetUrl={run.targetUrl}
              mode={run.request.mode}
              templates={changeTemplates}
              entries={changeEntries}
            />
          </section>

          <section className="history-panel">
            <div className="section-header">
              <h2>Historikk</h2>
              <p>Tidligere sideanalyser for samme URL.</p>
            </div>
            {history.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Dato</th>
                      <th>Status</th>
                      <th>Type</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <Link href={`/audits/${entry.id}`}>{new Date(entry.createdAt).toLocaleString("nb-NO")}</Link>
                        </td>
                        <td>
                          <StatusPill status={entry.status} />
                        </td>
                        <td>{entry.request.mode === "page" ? "Sideanalyse" : "Domeneanalyse"}</td>
                        <td>{entry.summary ? <ScorePill score={entry.summary.totalScore} /> : "Venter"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <h3>Ingen historikk å vise</h3>
                <p>Denne kjøringen er første registrerte sideanalyse for URL-en.</p>
              </div>
            )}
          </section>
        </>
        ) : (
        <>
          <section className="report-grid">
            <div className="section-header">
              <h2>Oversikt</h2>
              <p>{report.summary}</p>
            </div>
            <div className="overview-grid">
              <div className="card">
                <div className="score-lg">
                  <span className="muted">Samlet vurdering</span>
                  <strong>{report.totalScore}</strong>
                  {report.comparison.totalScoreDelta !== null ? (
                    <span className={report.comparison.totalScoreDelta >= 0 ? "delta-positive" : "delta-negative"}>
                      {report.comparison.totalScoreDelta >= 0 ? "+" : ""}
                      {report.comparison.totalScoreDelta} siden sist
                    </span>
                  ) : (
                    <span className="muted">Første kjøring for dette domenet</span>
                  )}
                </div>
              </div>
              <div className="card">
                <h3>Hva rapporten bygger på</h3>
                <ul className="list">
                  {report.categoryScores.map((category) => (
                    <li key={category.id}>
                      <strong>
                        {category.label}: {category.score}
                      </strong>
                      <p>{category.summary}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card">
                <h3>Prioritert fokus nå</h3>
                <ul className="list">
                  {report.issues.slice(0, 3).map((issue) => (
                    <li key={issue.id}>
                      <strong>{issue.title}</strong>
                      <p>{issue.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Providerprofiler</h2>
              <p>Her ser du hvordan ulike plattformer sannsynligvis vil oppfatte og bruke innholdet ditt.</p>
            </div>
            <div className="provider-grid">
              {report.providerScores.map((provider) => (
                <article className="provider-card" key={provider.provider}>
                  <div className="button-row">
                    <h3>{provider.label}</h3>
                    <ScorePill score={provider.score} />
                  </div>
                  <p>{provider.summary}</p>
                  <ul className="list">
                    <li>
                      <strong>Hva dette betyr</strong>
                      <p>{providerExplanation(provider.score)}</p>
                    </li>
                  </ul>
                  {provider.blockers.length ? (
                    <>
                      <div className="tag-row">
                        {provider.blockers.map((blocker) => (
                          <span className="tag" key={blocker}>
                            {blocker}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : null}
                  <ul className="list">
                    {provider.opportunities.map((opportunity) => (
                      <li key={opportunity}>
                        <strong>Neste steg</strong>
                        <p>{opportunity}</p>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Anbefalinger</h2>
              <p>Dette er de mest nyttige tiltakene for å forbedre innhold, struktur og synlighet.</p>
            </div>
            <div className="recommendations-grid">
              {report.recommendations.map((recommendation) => (
                <RecommendationCard key={recommendation.id} recommendation={recommendation} />
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Implementation Packs</h2>
              <p>Her får du ferdige endringspakker for sidene med størst sannsynlig gevinst.</p>
            </div>
            <div className="recommendations-grid">
              {report.implementationPacks.map((pack) => (
                <ImplementationPackCard key={pack.id} pack={pack} />
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Det som holder siden tilbake</h2>
              <p>Dette er de viktigste grunnene til at siden ikke scorer høyere akkurat nå.</p>
            </div>
            <div className="issues-grid">
              {report.issues.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Sider</h2>
              <p>Konkrete sideeksempler som viser hva som fungerer bra, og hva som bør forbedres.</p>
            </div>
            <div className="pages-grid">
              {report.pages.slice(0, 12).map((page) => (
                <article className="page-card" key={page.url}>
                  <div className="button-row">
                    <h3>{page.h1 || page.title || humanPath(page.url)}</h3>
                    <span className="tag">{renderingLabel(page.rendering.renderingModel)}</span>
                  </div>
                  <p>{readableExcerpt(page.firstParagraph || page.bodyText) || "Ingen tydelig ingress eller lesbar introduksjon funnet."}</p>
                  <ul className="list">
                    <li>
                      <strong>Hva dette betyr</strong>
                      <p>{explainPage(page)}</p>
                    </li>
                    <li>
                      <strong>Signalene vi fant</strong>
                      <p>
                        {answerScoreLabel(page.answerFirstSignals.directAnswerLikelihood)}. {page.wordCount} ord.{" "}
                        {page.schema.types.length
                          ? `Schema: ${page.schema.types.join(", ")}.`
                          : "Ingen schema funnet."}
                      </p>
                    </li>
                  </ul>
                  <div className="tag-row">
                    <span className="tag">Svarscore {page.answerFirstSignals.directAnswerLikelihood}/100</span>
                    <span className="tag">{wordLabel(page.wordCount)}</span>
                    <span className="tag">{page.schema.types.length ? `Schema ${page.schema.types.join(", ")}` : "Schema mangler"}</span>
                    {page.noindex ? <span className="tag">Noindex</span> : null}
                    {page.blockedByRobots ? <span className="tag">Blokkert i robots</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Forslag til forbedret side</h2>
              <p>
                Her foreslår verktøyet en bedre struktur, skarpere metadata og et mer passende schema
                for sider som har mest å hente.
              </p>
            </div>
            <div className="recommendations-grid">
              {report.pageSuggestions.map((suggestion) => (
                <PageSuggestionCard key={suggestion.url} suggestion={suggestion} />
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Temagrupper</h2>
              <p>Her grupperer vi sidene etter tema og ser om innholdet dekker ulike brukerbehov godt nok.</p>
            </div>
            <div className="cluster-grid">
              {report.topicClusters.map((cluster) => (
                <article className="cluster-card" key={cluster.id}>
                  <div className="button-row">
                    <h3>{cluster.name}</h3>
                    <span className="tag">{intentLabel(cluster.intent)}</span>
                    <ScorePill score={cluster.score} />
                  </div>
                  <p>
                    {cluster.pages.length} sider i denne temagruppen. Innholdslikhet {cluster.averageSimilarity}/100.
                  </p>
                  {cluster.missingCoverage.length ? (
                    <div className="tag-row">
                      {cluster.missingCoverage.map((item) => (
                        <span className="tag" key={item}>
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Konkurrenter</h2>
              <p>Sammenligning mot domenene du la inn i analysen.</p>
            </div>
            {report.competitiveContext ? (
              <div className="overview-grid">
                <div className="card">
                  <h3>Domener</h3>
                  <ul className="list">
                    {report.competitiveContext.competitors.map((competitor) => (
                      <li key={competitor.domain}>
                        <strong>{competitor.domain}</strong>
                        <p>
                          {competitor.pages} sider analysert. Oppdaterthetsnivå {competitor.averageFreshness}/100,
                          tydelighet i åpningen {competitor.averageAnswerFirst}/100, strukturerte data {competitor.schemaCoverage}/100.
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card">
                  <h3>Hvor du ligger bak</h3>
                  <ul className="list">
                    {report.competitiveContext.gaps.map((gap) => (
                      <li key={`${gap.category}-${gap.gapType}`}>
                        <strong>{gap.category}</strong>
                        <p>{gap.insight}</p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card">
                  <h3>Hva du bør gjøre først</h3>
                  <p>
                    Prioriter gaps med størst effekt på coverage, answer-first og schema. Når disse tettes,
                    blir både klassisk søk og AI-siterbarhet mer konkurransedyktig.
                  </p>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <h3>Ingen konkurrenter i denne kjøringen</h3>
                <p>Legg inn konkurrentdomener når du starter audit for å få gap-analyse og cluster-overlapp.</p>
              </div>
            )}
          </section>

          <section className="history-panel">
            <AuditChangeTracker
              auditRunId={run.id}
              targetUrl={run.targetUrl}
              mode={run.request.mode}
              templates={changeTemplates}
              entries={changeEntries}
            />
          </section>

          <section className="history-panel">
            <div className="section-header">
              <h2>Historikk</h2>
              <p>Tidligere kjøringer for samme domene.</p>
            </div>
            {history.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Dato</th>
                      <th>Status</th>
                      <th>Type</th>
                      <th>Score</th>
                      <th>Kategorier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <Link href={`/audits/${entry.id}`}>{new Date(entry.createdAt).toLocaleString("nb-NO")}</Link>
                        </td>
                        <td>
                          <StatusPill status={entry.status} />
                        </td>
                        <td>{entry.request.mode === "page" ? "Sideanalyse" : "Domeneanalyse"}</td>
                        <td>{entry.summary ? <ScorePill score={entry.summary.totalScore} /> : "Venter"}</td>
                        <td>
                          {entry.summary
                            ? summarizeList(
                                entry.summary.categoryScores
                                  .slice(0, 3)
                                  .map((score) => `${CATEGORY_LABELS[score.id]} ${score.score}`),
                              )
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <h3>Ingen historikk å vise</h3>
                <p>Denne kjøringen er første registrerte analyse for domenet.</p>
              </div>
            )}
          </section>
        </>
        )
      )}
    </>
  );
}

function buildChangeSnapshot(input: {
  url: string;
  h1: string;
  opening: string;
  metaTitle: string;
  metaDescription: string;
  schemaTypes: string[];
}): AuditChangeSnapshot {
  return {
    url: input.url,
    h1: input.h1,
    opening: input.opening,
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    schemaTypes: input.schemaTypes,
  };
}

function buildAuditChangeTemplates(report: AuditReport): AuditChangeTemplate[] {
  const templates: AuditChangeTemplate[] = [];

  if (report.pageReport) {
    templates.push({
      key: `${report.runId}:page-report`,
      sourceAuditRunId: report.runId,
      pageUrl: report.pageReport.current.url,
      changeType: "page-report",
      label: "Sideforslag fra rapporten",
      summary: "Logger H1, åpning, metadata og schema fra sideforslaget som en faktisk publisert endring.",
      baseline: buildChangeSnapshot({
        url: report.pageReport.current.url,
        h1: report.pageReport.current.h1,
        opening: report.pageReport.current.opening,
        metaTitle: report.pageReport.current.metaTitle,
        metaDescription: report.pageReport.current.metaDescription,
        schemaTypes: report.pageReport.current.schemaTypes,
      }),
      expected: buildChangeSnapshot({
        url: report.pageReport.current.url,
        h1: report.pageReport.proposed.h1,
        opening: report.pageReport.proposed.opening,
        metaTitle: report.pageReport.proposed.metaTitle,
        metaDescription: report.pageReport.proposed.metaDescription,
        schemaTypes: [report.pageReport.proposed.schemaType],
      }),
    });
  }

  report.implementationPacks.forEach((pack, index) => {
    templates.push({
      key: `${report.runId}:pack:${index}`,
      sourceAuditRunId: report.runId,
      pageUrl: pack.url,
      changeType: "implementation-pack",
      label: `Implementation Pack: ${pack.pageTitle}`,
      summary: `Logger implementation pack for ${humanPath(pack.url)} og følger om feltene faktisk blir synlige i senere audits.`,
      baseline: buildChangeSnapshot({
        url: pack.url,
        h1: pack.currentSnapshot.h1,
        opening: pack.currentSnapshot.opening,
        metaTitle: pack.currentSnapshot.metaTitle,
        metaDescription: pack.currentSnapshot.metaDescription,
        schemaTypes: pack.currentSnapshot.schemaTypes,
      }),
      expected: buildChangeSnapshot({
        url: pack.url,
        h1: pack.proposedSnapshot.h1,
        opening: pack.proposedSnapshot.opening,
        metaTitle: pack.proposedSnapshot.metaTitle,
        metaDescription: pack.proposedSnapshot.metaDescription,
        schemaTypes: [pack.proposedSnapshot.schemaType],
      }),
    });
  });

  return templates;
}

function phaseLabel(phase: string) {
  switch (phase) {
    case "queued":
      return "I kø";
    case "discovering":
      return "Oppdager nettstedet";
    case "crawling":
      return "Crawler sider";
    case "rendering":
      return "Sjekker SSR og rendering";
    case "benchmarking":
      return "Sammenligner konkurrenter";
    case "analyzing":
      return "Beregner rapport";
    case "finalizing":
      return "Lagrer resultatet";
    case "completed":
      return "Ferdig";
    case "failed":
      return "Feilet";
    default:
      return phase;
  }
}

function formatEta(seconds: number) {
  if (seconds < 60) {
    return `${seconds} sek`;
  }

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes >= 10 || rest === 0) {
    return `${minutes} min`;
  }

  return `${minutes} min ${rest} sek`;
}

function providerExplanation(score: number) {
  if (score >= 80) {
    return "Dette ser sterkt ut. Plattformen vil trolig ha gode forutsetninger for å finne, forstå og bruke innholdet ditt.";
  }
  if (score >= 60) {
    return "Dette ser ganske bra ut, men det finnes noen tydelige forbedringsmuligheter som kan gi bedre synlighet.";
  }
  return "Her er det flere forhold som kan gjøre innholdet vanskeligere å finne, forstå eller sitere.";
}

function renderingLabel(model: string) {
  switch (model) {
    case "ssr":
      return "Server-rendret";
    case "hybrid":
      return "Hybrid rendering";
    case "csr":
      return "Klient-rendret";
    default:
      return "Ukjent rendering";
  }
}

function singleIntentLabel(intent: SearchIntent) {
  switch (intent) {
    case "informational":
      return "Informasjonssøk";
    case "commercial investigation":
      return "Vurdering før kjøp";
    case "transactional":
      return "Klar for handling";
    case "navigational":
      return "Navigasjon";
    default:
      return intent;
  }
}

function intentLabel(intent: SearchIntent | PageIntent) {
  if (typeof intent === "string") {
    return singleIntentLabel(intent);
  }

  if (intent.secondary) {
    return `${singleIntentLabel(intent.primary)} + ${singleIntentLabel(intent.secondary)}`;
  }

  return singleIntentLabel(intent.primary);
}

function answerScoreLabel(score: number) {
  if (score >= 80) {
    return "Siden gir et tydelig svar tidlig";
  }
  if (score >= 60) {
    return "Siden gir et delvis tydelig svar";
  }
  if (score >= 40) {
    return "Siden kan bli tydeligere i åpningen";
  }
  return "Siden svarer for sent eller uklart";
}

function wordLabel(words: number) {
  if (words >= 1600) {
    return "Lang side";
  }
  if (words >= 700) {
    return "Middels lang side";
  }
  return "Kort side";
}

function explainPage(page: AuditReport["pages"][number]) {
  const parts: string[] = [];

  if (page.rendering.renderingModel === "ssr") {
    parts.push("Innholdet ser ut til å være tilgjengelig direkte i HTML, noe som vanligvis er bra for crawlere og AI-boter.");
  } else if (page.rendering.renderingModel === "csr") {
    parts.push("Siden ser ut til å være sterkt avhengig av klientrendering, noe som kan gjøre innholdet vanskeligere å hente og forstå.");
  } else {
    parts.push("Siden bruker en blanding av server- og klientrendering.");
  }

  if (page.answerFirstSignals.directAnswerLikelihood >= 70) {
    parts.push("Den åpner relativt klart og er lettere å bruke i snippets og AI-svar.");
  } else if (page.answerFirstSignals.directAnswerLikelihood < 50) {
    parts.push("Den bør komme raskere til poenget med et kort svar rett under overskriften.");
  }

  if (!page.schema.types.length) {
    parts.push("Det mangler strukturerte data, så siden sender svakere semantiske signaler til søk og AI.");
  }

  if (page.noindex) {
    parts.push("Siden er merket med noindex og vil derfor normalt ikke bygges opp som synlig søkeinnhold.");
  }

  if (page.blockedByRobots) {
    parts.push("Siden er blokkert i robots.txt, så deler av analysen og synligheten blir begrenset.");
  }

  return parts.join(" ");
}

function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  return (
    <article className="recommendation">
      <div className="button-row">
        <h3>{recommendation.title}</h3>
        <span className="tag">{recommendation.effort}</span>
        <span className="tag">{recommendation.impact} effekt</span>
      </div>
      <p>{recommendation.rationale}</p>
      <ul className="list">
        <li>
          <strong>Målområde</strong>
          <p>{recommendation.target}</p>
        </li>
        <li>
          <strong>Påvirker</strong>
          <p>{recommendation.providers.map((provider) => PROVIDER_LABELS[provider]).join(", ")}</p>
        </li>
        <li>
          <strong>Forslag</strong>
          <p>{recommendation.action}</p>
        </li>
      </ul>
    </article>
  );
}

function IssueCard({ issue }: { issue: Issue }) {
  return (
    <article className="issue-card">
      <div className="button-row">
        <h3>{issue.title}</h3>
        <span className="tag">{priorityLabel(issue.priority)}</span>
      </div>
      <p>{issue.description}</p>
      <ul className="list">
        <li>
          <strong>Plattformer</strong>
          <p>{issue.providerImpact.map((provider) => PROVIDER_LABELS[provider]).join(", ")}</p>
        </li>
        {issue.affectedUrls.length ? (
          <li>
            <strong>Eksempler</strong>
            <p>{summarizeList(issue.affectedUrls.map(humanPath), 4)}</p>
          </li>
        ) : null}
      </ul>
    </article>
  );
}

function PageSuggestionCard({ suggestion }: { suggestion: AuditReport["pageSuggestions"][number] }) {
  return (
    <article className="recommendation">
      <div className="button-row">
        <h3>{suggestion.pageTitle}</h3>
        <span className="tag">{intentLabel(suggestion.intent)}</span>
      </div>
      <p>{suggestion.proposed.contentLead}</p>
      <ul className="list">
        {suggestion.metadataAgent ? (
          <li>
            <strong>Metadata-agent</strong>
            <p>
              {suggestion.metadataAgent.name}
              {suggestion.metadataAgent.mode === "openai"
                ? suggestion.metadataAgent.model
                  ? ` via ${suggestion.metadataAgent.model}`
                  : " via AI"
                : " med lokal fallback"}
            </p>
          </li>
        ) : null}
        {suggestion.searchInsights?.audience ? (
          <li>
            <strong>Målgruppe i søket</strong>
            <p>{suggestion.searchInsights.audience}</p>
          </li>
        ) : null}
        <li>
          <strong>Foreslått struktur</strong>
          <p>{suggestion.proposed.structure.join(" -> ")}</p>
        </li>
        <li>
          <strong>Bedre metatittel</strong>
          <p>{suggestion.proposed.metaTitle}</p>
        </li>
        <li>
          <strong>Bedre metabeskrivelse</strong>
          <p>{suggestion.proposed.metaDescription}</p>
        </li>
        <li>
          <strong>Foreslått schema</strong>
          <p>{suggestion.proposed.schemaType}</p>
        </li>
        <li>
          <strong>Hvorfor dette bør endres</strong>
          <p>{suggestion.rationale.join(" ")}</p>
        </li>
      </ul>
      {suggestion.proposed.contentNotes.length ? (
        <div className="tag-row">
          {suggestion.proposed.contentNotes.map((note) => (
            <span className="tag" key={note}>
              {note}
            </span>
          ))}
        </div>
      ) : null}
      <details>
        <summary>Vis forslag til JSON-LD</summary>
        <pre>{suggestion.proposed.jsonLd}</pre>
      </details>
    </article>
  );
}

function ImplementationPackCard({ pack }: { pack: ImplementationPack }) {
  const topCategoryChanges = pack.predictedImpact.categories
    .filter((item) => item.delta > 0)
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 4);
  const topProviderChanges = pack.predictedImpact.providers
    .filter((item) => item.delta > 0)
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 3);

  return (
    <article className="recommendation">
      <div className="button-row">
        <h3>{pack.pageTitle}</h3>
        <span className="tag">{pack.mode === "page" ? "Sideanalyse" : "Domeneanalyse"}</span>
        <span className="tag">
          Forventet +{pack.predictedImpact.totalScoreDelta} score
        </span>
      </div>
      <p>{humanPath(pack.url)}</p>
      <ul className="list">
        <li>
          <strong>Before / after</strong>
          <p>
            H1: {pack.currentSnapshot.h1 || "Ingen tydelig H1"} {"->"} {pack.proposedSnapshot.h1}
          </p>
          <p>
            Metatittel: {pack.currentSnapshot.metaTitle || "Ingen"} {"->"} {pack.proposedSnapshot.metaTitle}
          </p>
          <p>
            Metabeskrivelse: {pack.currentSnapshot.metaDescription || "Ingen"} {"->"} {pack.proposedSnapshot.metaDescription}
          </p>
        </li>
        <li>
          <strong>Predicted impact</strong>
          <p>
            Total score {pack.predictedImpact.totalScoreBefore} {"->"} {pack.predictedImpact.totalScoreAfter}
          </p>
          <p>
            {topCategoryChanges.length
              ? topCategoryChanges
                  .map((item) => `${CATEGORY_LABELS[item.id]} +${item.delta}`)
                  .join(", ")
              : "Ingen tydelige kategoriløft beregnet."}
          </p>
          <p>
            {topProviderChanges.length
              ? topProviderChanges
                  .map((item) => `${PROVIDER_LABELS[item.provider]} +${item.delta}`)
                  .join(", ")
              : "Ingen tydelige provider-løft beregnet."}
          </p>
        </li>
        <li>
          <strong>Hvorfor denne pakken finnes</strong>
          <p>{pack.evidence.join(" ")}</p>
        </li>
      </ul>
      <details>
        <summary>Vis implementation blocks</summary>
        {pack.patchBlocks.map((block) => (
          <div key={block.id}>
            <p>
              <strong>{block.label}</strong>
            </p>
            <pre>{block.content}</pre>
          </div>
        ))}
      </details>
    </article>
  );
}

function priorityLabel(priority: Issue["priority"]) {
  switch (priority) {
    case "critical":
      return "Kritisk";
    case "high":
      return "Høy";
    case "medium":
      return "Middels";
    case "low":
      return "Lav";
    default:
      return priority;
  }
}
