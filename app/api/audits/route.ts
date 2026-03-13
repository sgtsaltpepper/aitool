import { NextResponse } from "next/server";

import { queueAuditRun } from "@/lib/jobs";
import { auditRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const rateLimitStore = new Map<string, number[]>();

function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim();
  }

  const realIp = request.headers.get("x-real-ip");
  return realIp?.trim() || "local";
}

function isRateLimited(key: string, now = Date.now()): boolean {
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const history = (rateLimitStore.get(key) ?? []).filter((timestamp) => timestamp >= windowStart);
  if (history.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitStore.set(key, history);
    return true;
  }

  history.push(now);
  rateLimitStore.set(key, history);
  return false;
}

export async function POST(request: Request) {
  try {
    const clientKey = getClientKey(request);
    if (isRateLimited(clientKey)) {
      return NextResponse.json(
        {
          error: "For mange nye analyser på kort tid. Vent litt og prøv igjen.",
        },
        { status: 429 },
      );
    }

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
