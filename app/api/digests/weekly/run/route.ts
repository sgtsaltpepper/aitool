import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sendWeeklyDigest } from "@/lib/digests";

export const dynamic = "force-dynamic";

const schema = z.object({
  domain: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const body = await request.json() as unknown;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "domain required" }, { status: 400 });
  }
  try {
    await sendWeeklyDigest(parsed.data.domain);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
