import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const GOOGLE_CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID!;
const AUTH_SECRET = () => process.env.AUTH_SECRET!;

function signState(data: string): string {
  return crypto
    .createHmac("sha256", AUTH_SECRET())
    .update(data)
    .digest("hex");
}

export async function GET(request: NextRequest) {
  let redirect = request.nextUrl.searchParams.get("redirect") || "/account";
  // Prevent open redirect: only allow relative paths
  if (!redirect.startsWith("/") || redirect.startsWith("//")) {
    redirect = "/account";
  }

  const stateData = JSON.stringify({ redirect, ts: Date.now() });
  const stateB64 = Buffer.from(stateData).toString("base64url");
  const sig = signState(stateB64);
  const state = `${stateB64}.${sig}`;

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID(),
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
