import { NextRequest, NextResponse } from "next/server";

import { getLastSyncTimestamps } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain") ?? "";
  if (!domain) {
    return NextResponse.json({ error: "domain required" }, { status: 400 });
  }
  const status = getLastSyncTimestamps(domain);
  return NextResponse.json(status);
}
