import { NextResponse } from "next/server";

import { getGoogleConnection, listDomainIntegrations } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const connection = getGoogleConnection();
  const domains = listDomainIntegrations();
  return NextResponse.json({
    connected: !!connection,
    email: connection?.email ?? null,
    domains,
  });
}
