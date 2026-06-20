import Link from "next/link";

import { getGoogleConnection, listDomainIntegrations } from "@/lib/db";
import { listGscProperties, listGa4Properties } from "@/lib/integrations/google-auth";
import { SyncButton } from "./SyncButton";
import { DomainMappingForm } from "./DomainMappingForm";
import { DomainMappingsTable } from "./DomainMappingsTable";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const connection = getGoogleConnection();
  const domains = listDomainIntegrations();

  let gscProperties: { siteUrl: string; permissionLevel: string }[] = [];
  let ga4Properties: { propertyId: string; displayName: string }[] = [];
  let gscError = "";
  let ga4Error = "";

  if (connection) {
    try {
      gscProperties = await listGscProperties(connection.accessToken, connection.refreshToken, connection.expiresAt);
    } catch (e) {
      gscError = e instanceof Error ? e.message : String(e);
    }
    try {
      ga4Properties = await listGa4Properties(connection.accessToken, connection.refreshToken, connection.expiresAt);
    } catch (e) {
      ga4Error = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <div className="integrations-page">
      <div className="section-header">
        <h1>Google Integrations</h1>
        <p>Connect Google Search Console and GA4 to unlock opportunity tracking and weekly digests.</p>
      </div>

      {connected && (
        <div className="alert alert-success">Google account connected successfully.</div>
      )}
      {error && (
        <div className="alert alert-error">Connection failed: {decodeURIComponent(error)}</div>
      )}

      <section className="panel">
        <h2>Google Account</h2>
        {connection ? (
          <div className="connection-status connected">
            <span className="status-dot connected" />
            <div>
              <strong>Connected</strong>
              <p className="sub">{connection.email}</p>
            </div>
            <div className="button-row">
              <form action="/api/integrations/google/connect" method="GET">
                <button type="submit" className="secondary-button">Reconnect</button>
              </form>
            </div>
          </div>
        ) : (
          <div className="connection-status disconnected">
            <span className="status-dot disconnected" />
            <div>
              <strong>Not connected</strong>
              <p className="sub">Connect your Google account to access Search Console and GA4 data.</p>
            </div>
            <a href="/api/integrations/google/connect" className="primary-button">Connect Google</a>
          </div>
        )}
      </section>

      {connection && (
        <>
          <section className="panel">
            <h2>Domain Mappings</h2>
            <p className="sub">Map each domain to its GSC property and GA4 property for syncing.</p>

            <DomainMappingsTable
              domains={domains}
              gscProperties={gscProperties}
              ga4Properties={ga4Properties}
            />

            {gscError && (
              <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
                <strong>GSC feil:</strong> {gscError}
              </div>
            )}
            {ga4Error && (
              <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
                <strong>GA4 feil:</strong> {ga4Error}
              </div>
            )}

            <DomainMappingForm gscProperties={gscProperties} ga4Properties={ga4Properties} />
          </section>

          <section className="panel">
            <h2>Sync Data</h2>
            <p className="sub">Pull the latest data from Google Search Console and GA4.</p>
            <div className="button-row">
              <SyncButton />
            </div>
          </section>
        </>
      )}

      <div className="nav-links">
        <Link href="/">← Back to home</Link>
        {connection && <><span aria-hidden="true"> · </span><Link href="/opportunities">View opportunities →</Link></>}
      </div>
    </div>
  );
}


