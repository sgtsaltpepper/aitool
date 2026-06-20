import Link from "next/link";

import { AuditForm } from "@/components/AuditForm";
import { ScorePill, StatusPill } from "@/components/Badges";
import { DEFAULT_COUNTRY, DEFAULT_LOCALE, DEFAULT_MAX_PAGES } from "@/lib/config";
import { listAuditRuns, getGoogleConnection, countOpenOpportunities } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const runs = listAuditRuns(12);
  const googleConnection = getGoogleConnection();
  const openOpportunities = countOpenOpportunities();

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Audit for AI-boter, SEO og innholdsstruktur</h1>
          <p>
            Analyser offentlige nettsteder for ChatGPT, Gemini, Copilot, Perplexity og klassisk søk.
            Verktøyet måler answer-first-innhold, rendering, schema, internlenking, topic clusters,
            freshness og trust-signaler i én samlet rapport.
          </p>
          <div className="hero-metrics">
            <span className="metric-chip">SSR vs CSR</span>
            <span className="metric-chip">Topic clusters</span>
            <span className="metric-chip">Schema og entity-signaler</span>
            <span className="metric-chip">Providerprofiler</span>
          </div>
        </div>
        <section className="panel">
          <h2>Start en ny analyse</h2>
          <p>
            Lim inn måldomenet, velg marked og legg eventuelt til konkurrenter. Første versjon er laget
            for manuelle kjøringer og historikk i samme lokale verktøy.
          </p>
          <div className="button-row">
            <Link href="/page-audit" className="secondary-button">
              Gå til sideanalyse
            </Link>
          </div>
      <div className="hero-links" style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <Link href="/integrations" className="secondary-button">
          {googleConnection ? `✓ Google Connected (${googleConnection.email})` : "Connect Google"}
        </Link>
        {openOpportunities > 0 && (
          <Link href="/opportunities" className="secondary-button">
            {openOpportunities} open opportunities
          </Link>
        )}
      </div>
          <AuditForm
            defaultLocale={DEFAULT_LOCALE}
            defaultCountry={DEFAULT_COUNTRY}
            defaultMaxPages={DEFAULT_MAX_PAGES}
            mode="domain"
          />
        </section>
      </section>

      <section className="history-panel">
        <div className="section-header">
          <h2>Historikk</h2>
          <p>Se tidligere kjøringer, scoreutvikling og gå tilbake til rapportene.</p>
        </div>

        {runs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Domene</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Score</th>
                  <th>Sider</th>
                  <th>Opprettet</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/audits/${run.id}`}>{run.targetUrl}</Link>
                    </td>
                    <td>
                      <StatusPill status={run.status} />
                    </td>
                    <td>{run.request.mode === "page" ? "Sideanalyse" : "Domeneanalyse"}</td>
                    <td>{run.summary ? <ScorePill score={run.summary.totalScore} /> : "Venter"}</td>
                    <td>{run.summary?.totalPages ?? "-"}</td>
                    <td>{new Date(run.createdAt).toLocaleString("nb-NO")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>Ingen analyser ennå</h3>
            <p>Start den første audit-kjøringen for å få historikk og sammenligninger over tid.</p>
          </div>
        )}
      </section>
    </>
  );
}
