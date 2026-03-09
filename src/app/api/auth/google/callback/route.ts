import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  createSessionToken,
  setSessionCookie,
} from "@/lib/services/customer-auth";

const GOOGLE_CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = () => process.env.GOOGLE_CLIENT_SECRET!;
const AUTH_SECRET = () => process.env.AUTH_SECRET!;
const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL!;

function verifyState(state: string): { redirect: string } | null {
  const [stateB64, sig] = state.split(".");
  if (!stateB64 || !sig) return null;

  const expected = crypto
    .createHmac("sha256", AUTH_SECRET())
    .update(stateB64)
    .digest("hex");

  if (sig !== expected) return null;

  try {
    const data = JSON.parse(Buffer.from(stateB64, "base64url").toString());
    return { redirect: data.redirect || "/account" };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const errorParam = request.nextUrl.searchParams.get("error");

  // User denied consent or Google returned an error
  if (errorParam || !code || !state) {
    return NextResponse.redirect(
      `${APP_URL()}/login?error=google_verify_failed`
    );
  }

  // Verify CSRF state
  const stateData = verifyState(state);
  if (!stateData) {
    return NextResponse.redirect(
      `${APP_URL()}/login?error=google_verify_failed`
    );
  }

  const callbackUrl = `${APP_URL()}/api/auth/google/callback`;

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID(),
        client_secret: GOOGLE_CLIENT_SECRET(),
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.id_token) {
      return NextResponse.redirect(
        `${APP_URL()}/login?error=google_verify_failed`
      );
    }

    // Verify ID token
    const client = new OAuth2Client(GOOGLE_CLIENT_ID());
    const ticket = await client.verifyIdToken({
      idToken: tokenData.id_token,
      audience: GOOGLE_CLIENT_ID(),
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return NextResponse.redirect(
        `${APP_URL()}/login?error=google_verify_failed`
      );
    }

    if (!payload.email_verified) {
      return NextResponse.redirect(
        `${APP_URL()}/login?error=google_email_not_verified`
      );
    }

    const googleId = payload.sub;
    const email = payload.email;
    const fullName = payload.name || email.split("@")[0];

    // Find or create user
    let user = await db.query.users.findFirst({
      where: eq(users.googleId, googleId),
    });

    if (!user) {
      // Check if a user with the same email exists (link accounts)
      user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (user) {
        // Link Google account to existing user
        await db
          .update(users)
          .set({ googleId, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      } else {
        // Create new user
        const [newUser] = await db
          .insert(users)
          .values({
            email,
            fullName,
            googleId,
          })
          .returning();
        user = newUser;
      }
    }

    // Create session
    const token = createSessionToken(user.id, user.email);
    await setSessionCookie(token);

    return NextResponse.redirect(`${APP_URL()}${stateData.redirect}`);
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    return NextResponse.redirect(
      `${APP_URL()}/login?error=google_verify_failed`
    );
  }
}
