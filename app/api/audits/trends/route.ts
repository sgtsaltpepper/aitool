import { NextResponse } from "next/server";

import { getScoreHistory } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/audits/trends?domain=example.com&days=90
 *
 * Returns historical score data for a given domain.
 * Used by the TrendChart component.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get("days") ?? "90", 10)));

  if (!domain) {
    return NextResponse.json({ error: "Mangler domain-parameter." }, { status: 400 });
  }

  // Accept both bare domain and full URL
  let targetUrl: string;
  try {
    targetUrl = domain.startsWith("http") ? new URL(domain).origin : `https://${domain}`;
  } catch {
    return NextResponse.json({ error: "Ugyldig domain." }, { status: 400 });
  }

  const history = getScoreHistory(targetUrl, days);

  return NextResponse.json({
    domain: new URL(targetUrl).hostname,
    days,
    dataPoints: history.length,
    history,
  });
}
