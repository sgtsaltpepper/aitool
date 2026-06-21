import Link from "next/link";

import { listOpportunities, listDomainIntegrations, listOpportunitySnapshots } from "@/lib/db";
import { SyncButton } from "@/app/integrations/SyncButton";
import { OpportunitiesClient } from "./OpportunitiesClient";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  const { domain = "" } = await searchParams;
  const domains = listDomainIntegrations();
  const opportunities = listOpportunities({ domain: domain || undefined, status: "open", limit: 200 });
  const snapshots = listOpportunitySnapshots({ domain: domain || undefined, limit: domain ? 12 : 40 });

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "1.5rem 1rem" }}>
      <div className="button-row" style={{ marginBottom: "1rem", flexWrap: "wrap" }}>
        <Link href="/integrations" className="secondary-button">
          Domener og integrasjoner
        </Link>
        <Link href="/" className="secondary-button">
          Ny analyse
        </Link>
        {domains.length ? <SyncButton /> : null}
      </div>
      <OpportunitiesClient
        initialOpportunities={opportunities}
        domains={domains}
        initialDomainFilter={domain}
        snapshots={snapshots}
      />
    </div>
  );
}
