import { google } from "googleapis";

import {
  getGscUrlInspectionCache,
  upsertGscPageQueryRow,
  upsertGscPageRow,
  upsertGscQueryRow,
  upsertGscUrlInspectionCache,
} from "@/lib/db";
import { getAuthenticatedClient } from "@/lib/integrations/google-auth";

function dateStr(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

export async function syncGscData(
  domain: string,
  siteUrl: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
  days = 90,
): Promise<void> {
  const auth = getAuthenticatedClient(accessToken, refreshToken, expiresAt);
  const webmasters = google.webmasters({ version: "v3", auth });
  const startDate = dateStr(days);
  const endDate = dateStr(0);

  const dimensions: Array<"page" | "query"> = ["page", "query"];
  for (const dimension of dimensions) {
    let startRow = 0;
    const rowLimit = 5000;
    while (true) {
      const { data } = await webmasters.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: [dimension],
          rowLimit,
          startRow,
        },
      });
      const rows = data.rows ?? [];
      for (const row of rows) {
        const key = row.keys?.[0] ?? "";
        if (dimension === "page") {
          upsertGscPageRow({
            domain,
            date: endDate,
            page: key,
            clicks: row.clicks ?? 0,
            impressions: row.impressions ?? 0,
            ctr: row.ctr ?? 0,
            position: row.position ?? 0,
          });
        } else {
          upsertGscQueryRow({
            domain,
            date: endDate,
            query: key,
            clicks: row.clicks ?? 0,
            impressions: row.impressions ?? 0,
            ctr: row.ctr ?? 0,
            position: row.position ?? 0,
          });
        }
      }
      if (rows.length < rowLimit) break;
      startRow += rowLimit;
    }
  }

  // Page + Query combined
  let startRow = 0;
  const rowLimit = 5000;
  while (true) {
    const { data } = await webmasters.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["page", "query"],
        rowLimit,
        startRow,
      },
    });
    const rows = data.rows ?? [];
    for (const row of rows) {
      upsertGscPageQueryRow({
        domain,
        date: endDate,
        page: row.keys?.[0] ?? "",
        query: row.keys?.[1] ?? "",
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        ctr: row.ctr ?? 0,
        position: row.position ?? 0,
      });
    }
    if (rows.length < rowLimit) break;
    startRow += rowLimit;
  }
}

export async function inspectUrl(
  domain: string,
  url: string,
  siteUrl: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): Promise<unknown> {
  const cached = getGscUrlInspectionCache(domain, url);
  if (cached) return cached;

  const auth = getAuthenticatedClient(accessToken, refreshToken, expiresAt);
  const webmasters = google.webmasters({ version: "v3", auth });
  // URL inspection API via searchconsole v1
  const searchConsole = google.searchconsole({ version: "v1", auth });
  const { data } = await searchConsole.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl: url,
      siteUrl,
    },
  });
  upsertGscUrlInspectionCache(domain, url, data);
  return data;
}
