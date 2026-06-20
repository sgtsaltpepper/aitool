import { google } from "googleapis";

import { upsertGa4LandingPageRow } from "@/lib/db";
import { getAuthenticatedClient } from "@/lib/integrations/google-auth";

function dateStr(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

export async function syncGa4Data(
  domain: string,
  propertyId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
  days = 90,
): Promise<void> {
  const auth = getAuthenticatedClient(accessToken, refreshToken, expiresAt);
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });
  const startDate = dateStr(days);
  const endDate = dateStr(0);

  const { data } = await analyticsData.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dimensions: [{ name: "landingPage" }, { name: "date" }],
      metrics: [
        { name: "sessions" },
        { name: "conversions" },
        { name: "bounceRate" },
      ],
      dateRanges: [{ startDate, endDate }],
    },
  });

  for (const row of data.rows ?? []) {
    const page = row.dimensionValues?.[0]?.value ?? "";
    const date = row.dimensionValues?.[1]?.value ?? "";
    const sessions = parseInt(row.metricValues?.[0]?.value ?? "0", 10);
    const conversions = parseInt(row.metricValues?.[1]?.value ?? "0", 10);
    const bounceRate = parseFloat(row.metricValues?.[2]?.value ?? "0");
    upsertGa4LandingPageRow({ domain, date, page, sessions, conversions, bounceRate });
  }
}
