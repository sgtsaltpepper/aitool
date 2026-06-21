import { NextResponse } from "next/server";

import { recoverQueuedJobs } from "@/lib/jobs";

export const runtime = "nodejs";

/**
 * GET /api/queue/worker
 *
 * Trigger-endpoint for cron jobs or manual recovery.
 * Finds all 'queued' audit_runs in the DB that have no in-process runner
 * and starts executing them.
 *
 * Protect with a shared secret in production:
 *   curl -H "Authorization: Bearer <WORKER_SECRET>" /api/queue/worker
 */
export async function GET(request: Request) {
  const secret = process.env.WORKER_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const recovered = recoverQueuedJobs();

  return NextResponse.json({
    ok: true,
    jobsRecovered: recovered,
    message:
      recovered === 0
        ? "Ingen ventende jobber å gjenopprette."
        : `Startet ${recovered} jobb(er) på nytt.`,
  });
}
