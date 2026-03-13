import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/AutoRefresh";
import { ScorePill, StatusPill } from "@/components/Badges";
import { CATEGORY_LABELS, PROVIDER_LABELS } from "@/lib/config";
import { getAuditReport, getAuditRun, listAuditRuns } from "@/lib/db";
import type { Issue, Recommendation } from "@/lib/types";
import { humanPath, summarizeList } from "@/lib/utils";

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
  const history = listAuditRuns(20).filter((entry) => entry.targetUrl === run.targetUrl);

  return (
    <>
      <AutoRefresh enabled={run.status === "queued" || run.status === "running"} />

      <div className="report-header">
        <div>
          <p className="muted">Analyse av {run.targetUrl}</p>
          <h1>Rapport</h1>
          <p>
            Status, prioriterte funn og anbefalinger for AI-boter, klassisk søk og strukturell
            forståelse av nettstedet.
          </p>
        </div>
        <div className="button-row">
          {run.summary ? <ScorePill score={run.summary.totalScore} /> : null}
          <StatusPill status={run.status} />
          <Link href="/" className="secondary-button">
            Ny analyse
          </Link>
        </div>
      </div>

      {run.status !== "completed" || !report ? (
        <section className="empty-state">
          <h3>{run.status === "failed" ? "Analysen feilet" : "Analysen kjører"}</h3>
          <p>
            {run.status === "failed"
              ? run.errorMessage ?? "Noe gikk galt under kjøringen."
              : "Siden oppdateres automatisk mens crawleren og analysemodulen jobber."}
          </p>
        </section>
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
                  <span className="muted">Totalscore</span>
                  <strong>{report.totalScore}</strong>
                  {report.comparison.totalScoreDelta !== null ? (
                    <span className={report.comparison.totalScoreDelta >= 0 ? "delta-positive" : "delta-negative"}>
                      {report.comparison.totalScoreDelta >= 0 ? "+" : ""}
                      {report.comparison.totalScoreDelta} siden forrige kjøring
                    </span>
                  ) : (
                    <span className="muted">Første kjøring for dette domenet</span>
                  )}
                </div>
              </div>
              <div className="card">
                <h3>Core categories</h3>
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
              <p>Samme datasett, men ulike vurderinger for hvordan plattformene tolker og bruker innholdet ditt.</p>
            </div>
            <div className="provider-grid">
              {report.providerScores.map((provider) => (
                <article className="provider-card" key={provider.provider}>
                  <div className="button-row">
                    <h3>{provider.label}</h3>
                    <ScorePill score={provider.score} />
                  </div>
                  <p>{provider.summary}</p>
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
                      <li key={opportunity}>{opportunity}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Anbefalinger</h2>
              <p>Klare grep for innhold, struktur og publiseringsmaler.</p>
            </div>
            <div className="recommendations-grid">
              {report.recommendations.map((recommendation) => (
                <RecommendationCard key={recommendation.id} recommendation={recommendation} />
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Issues</h2>
              <p>Funnene nedenfor er de viktigste årsakene til at score og providerprofiler er der de er i dag.</p>
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
              <p>Eksempler på hvordan enkeltsider påvirker answer-first, rendering, freshness og tillitssignaler.</p>
            </div>
            <div className="pages-grid">
              {report.pages.slice(0, 12).map((page) => (
                <article className="page-card" key={page.url}>
                  <div className="button-row">
                    <h3>{page.h1 || page.title || humanPath(page.url)}</h3>
                    <span className="tag">{page.rendering.renderingModel.toUpperCase()}</span>
                  </div>
                  <p>{page.firstParagraph || "Ingen tydelig ingress funnet."}</p>
                  <div className="tag-row">
                    <span className="tag">Svarscore {page.answerFirstSignals.directAnswerLikelihood}</span>
                    <span className="tag">Words {page.wordCount}</span>
                    <span className="tag">Schema {page.schema.types.join(", ") || "Ingen"}</span>
                    {page.noindex ? <span className="tag">noindex</span> : null}
                    {page.blockedByRobots ? <span className="tag">robots-blokkert</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="report-grid">
            <div className="section-header">
              <h2>Topic clusters</h2>
              <p>Rule-basert clustering fra titler, H1/H2, introtekst og ankertekst.</p>
            </div>
            <div className="cluster-grid">
              {report.topicClusters.map((cluster) => (
                <article className="cluster-card" key={cluster.id}>
                  <div className="button-row">
                    <h3>{cluster.name}</h3>
                    <span className="tag">{cluster.intent}</span>
                    <ScorePill score={cluster.score} />
                  </div>
                  <p>
                    {cluster.pages.length} sider i klyngen. Gjennomsnittlig likhet {cluster.averageSimilarity}.
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
                          {competitor.pages} sider, freshness {competitor.averageFreshness}, answer-first{" "}
                          {competitor.averageAnswerFirst}, schema {competitor.schemaCoverage}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card">
                  <h3>Gap-analyse</h3>
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
      )}
    </>
  );
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
        <span className="tag">{issue.priority}</span>
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
