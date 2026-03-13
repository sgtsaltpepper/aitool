import { NextResponse } from "next/server";

import { getAuditReport } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const report = getAuditReport(id);

  if (!report) {
    return NextResponse.json({ error: "Fant ikke rapporten" }, { status: 404 });
  }

  return NextResponse.json(report);
}
