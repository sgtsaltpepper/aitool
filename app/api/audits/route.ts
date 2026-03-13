import { NextResponse } from "next/server";

import { queueAuditRun } from "@/lib/jobs";
import { auditRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = auditRequestSchema.parse(body);
    const run = queueAuditRun(parsed);

    return NextResponse.json(
      {
        id: run.id,
        status: run.status,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Ugyldig forespørsel",
      },
      { status: 400 },
    );
  }
}
