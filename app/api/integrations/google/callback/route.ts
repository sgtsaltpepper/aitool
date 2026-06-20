import { NextRequest, NextResponse } from "next/server";

import { upsertGoogleConnection } from "@/lib/db";
import { exchangeCodeForTokens, getConnectedEmail } from "@/lib/integrations/google-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(error)}`, request.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/integrations?error=no_code", request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const accessToken = tokens.access_token ?? "";
    const refreshToken = tokens.refresh_token ?? "";
    const expiresAt = tokens.expiry_date ?? Date.now() + 3600000;

    const email = await getConnectedEmail(accessToken, refreshToken, expiresAt);
    const allowedEmail = process.env.GOOGLE_ALLOWED_EMAIL;
    if (allowedEmail && email !== allowedEmail) {
      return NextResponse.redirect(new URL(`/integrations?error=unauthorized_email`, request.url));
    }

    upsertGoogleConnection(email, accessToken, refreshToken, expiresAt);
    return NextResponse.redirect(new URL("/integrations?connected=1", request.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "oauth_error";
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(msg)}`, request.url));
  }
}
