import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getOpportunity, updateOpportunityStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opp = getOpportunity(parseInt(id, 10));
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(opp);
}

const patchSchema = z.object({
  status: z.enum(["open", "dismissed", "done"]),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as unknown;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const opp = getOpportunity(parseInt(id, 10));
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  updateOpportunityStatus(parseInt(id, 10), parsed.data.status);
  return NextResponse.json({ ok: true });
}
