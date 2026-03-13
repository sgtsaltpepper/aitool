import { NextResponse } from "next/server";

import { getAuditRun } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = getAuditRun(id);

  if (!run) {
    return NextResponse.json({ error: "Fant ikke kjøringen" }, { status: 404 });
  }

  return NextResponse.json(run);
}
