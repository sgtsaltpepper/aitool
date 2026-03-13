import Link from "next/link";

import { AuditForm } from "@/components/AuditForm";
import { ScorePill, StatusPill } from "@/components/Badges";
import { DEFAULT_COUNTRY, DEFAULT_LOCALE, DEFAULT_MAX_PAGES } from "@/lib/config";
import { listAuditRuns } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function PageAuditHomePage() {
  const runs = listAuditRuns(20).filter((run) => run.request.mode === "page");

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Sideanalyse for én URL</h1>
          <p>
            Lim inn en konkret side-URL og få en før/etter-gjennomgang av innhold, struktur,
            metatittel, metabeskrivelse, FAQ, CTA og JSON-LD for akkurat denne siden.
          </p>
          <div className="hero-metrics">
            <span className="metric-chip">Kun én URL</span>
            <span className="metric-chip">Før / etter</span>
            <span className="metric-chip">Metadata og schema</span>
            <span className="metric-chip">Seksjon-for-seksjon</span>
          </div>
        </div>
        <section className="panel">
          <h2>Start en ny sideanalyse</h2>
          <p>
            Denne visningen crawler ikke hele domenet. Den analyserer bare URL-en du oppgir og
            foreslår konkrete forbedringer for akkurat denne siden.
          </p>
          <div className="button-row">
            <Link href="/" className="secondary-button">
              Til domeneanalyse
            </Link>
          </div>
          <AuditForm
            defaultLocale={DEFAULT_LOCALE}
            defaultCountry={DEFAULT_COUNTRY}
            defaultMaxPages={DEFAULT_MAX_PAGES}
            mode="page"
          />
        </section>
      </section>

      <section className="history-panel">
        <div className="section-header">
          <h2>Historikk for sideanalyser</h2>
          <p>Se tidligere kjøringer for enkeltsider og gå tilbake til rapportene.</p>
        </div>

        {runs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Score</th>
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
                    <td>{run.summary ? <ScorePill score={run.summary.totalScore} /> : "Venter"}</td>
                    <td>{new Date(run.createdAt).toLocaleString("nb-NO")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>Ingen sideanalyser ennå</h3>
            <p>Start en analyse av én konkret URL for å få første rapport.</p>
          </div>
        )}
      </section>
    </>
  );
}
