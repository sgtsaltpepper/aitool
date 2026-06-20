import { google } from "googleapis";

import type { GooglePropertyOption } from "@/lib/types";

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export function getAuthUrl(): string {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });
}

export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export function getAuthenticatedClient(accessToken: string, refreshToken: string, expiresAt: number) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiresAt,
  });
  return oauth2Client;
}

export async function getConnectedEmail(
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): Promise<string> {
  const auth = getAuthenticatedClient(accessToken, refreshToken, expiresAt);
  const oauth2 = google.oauth2({ version: "v2", auth });
  const { data } = await oauth2.userinfo.get();
  return data.email ?? "";
}

export async function listGscProperties(
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): Promise<GooglePropertyOption[]> {
  const auth = getAuthenticatedClient(accessToken, refreshToken, expiresAt);
  const webmasters = google.webmasters({ version: "v3", auth });
  const { data } = await webmasters.sites.list();
  return (data.siteEntry ?? []).map((site) => ({
    siteUrl: site.siteUrl ?? "",
    permissionLevel: site.permissionLevel ?? "unknown",
  }));
}

export async function listGa4Properties(
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): Promise<{ propertyId: string; displayName: string }[]> {
  const auth = getAuthenticatedClient(accessToken, refreshToken, expiresAt);
  const analyticsAdmin = google.analyticsadmin({ version: "v1beta", auth });
  const { data } = await analyticsAdmin.accountSummaries.list();
  const results: { propertyId: string; displayName: string }[] = [];
  for (const account of data.accountSummaries ?? []) {
    for (const prop of account.propertySummaries ?? []) {
      results.push({
        propertyId: prop.property?.replace("properties/", "") ?? "",
        displayName: `${prop.displayName ?? ""} (${account.displayName ?? ""})`,
      });
    }
  }
  return results;
}
