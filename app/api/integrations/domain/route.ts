import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { upsertDomainIntegration, deleteDomainIntegration } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({
  domain: z.string().min(1),
  gscProperty: z.string().nullable().optional(),
  ga4PropertyId: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json() as unknown;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { domain, gscProperty = null, ga4PropertyId = null } = parsed.data;
  upsertDomainIntegration(domain, gscProperty ?? null, ga4PropertyId ?? null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json() as unknown;
  const parsed = z.object({ id: z.number() }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  deleteDomainIntegration(parsed.data.id);
  return NextResponse.json({ ok: true });
}
