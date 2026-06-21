import { NextRequest, NextResponse } from "next/server";

import { createBackgroundJob, completeBackgroundJob, failBackgroundJob, getGoogleConnection, listDomainIntegrations } from "@/lib/db";
import { syncGscData } from "@/lib/integrations/gsc";
import { syncGa4Data } from "@/lib/integrations/ga4";
import { generateOpportunities } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { domain?: string; types?: string[] };
  const domain = body.domain;
  const types = body.types ?? ["sync-gsc", "sync-ga4", "generate-opportunities"];

  const connection = getGoogleConnection();
  if (!connection) {
    return NextResponse.json({ error: "No Google connection" }, { status: 400 });
  }

  const integrations = listDomainIntegrations().filter((d) => !domain || d.domain === domain);
  if (integrations.length === 0) {
    return NextResponse.json({ error: "No domain integrations configured" }, { status: 400 });
  }

  const results: { domain: string; type: string; jobId: number }[] = [];

  for (const integration of integrations) {
    for (const type of types) {
      const job = createBackgroundJob(type, { domain: integration.domain });
      results.push({ domain: integration.domain, type, jobId: job.id });

      // Run in background (fire-and-forget)
      void runJob(
        type,
        job.id,
        integration,
        connection,
      );
    }
  }

  return NextResponse.json({ queued: results });
}

async function runJob(
  type: string,
  jobId: number,
  integration: { domain: string; gscProperty: string | null; ga4PropertyId: string | null },
  connection: { accessToken: string; refreshToken: string; expiresAt: number },
): Promise<void> {
  try {
    if (type === "sync-gsc" && integration.gscProperty) {
      await syncGscData(
        integration.domain,
        integration.gscProperty,
        connection.accessToken,
        connection.refreshToken,
        connection.expiresAt,
      );
    } else if (type === "sync-ga4" && integration.ga4PropertyId) {
      await syncGa4Data(
        integration.domain,
        integration.ga4PropertyId,
        connection.accessToken,
        connection.refreshToken,
        connection.expiresAt,
      );
    } else if (type === "generate-opportunities") {
      await generateOpportunities(integration.domain);
    }
    completeBackgroundJob(jobId);
  } catch (err) {
    failBackgroundJob(jobId, err instanceof Error ? err.message : "Unknown error");
  }
}
