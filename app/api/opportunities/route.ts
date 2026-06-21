import { NextRequest, NextResponse } from "next/server";

import { listOpportunities } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const opportunities = listOpportunities({
    domain: params.get("domain") ?? undefined,
    status: params.get("status") ?? undefined,
    type: params.get("type") ?? undefined,
    priority: params.get("priority") ?? undefined,
    limit: params.has("limit") ? parseInt(params.get("limit")!, 10) : 200,
  });
  return NextResponse.json({ opportunities });
}
