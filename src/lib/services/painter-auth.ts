import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { hashPassword, verifyPassword } from "./customer-auth";
import { env, JWT_CLAIMS } from "@/lib/env";

// JWT-cookie auth for the painter realm — mirrors manufacturer-auth.ts with its
// own cookie name, secret and issuer/audience claims so a token from one realm
// is never accepted by another.

const COOKIE_NAME = "painter_session";

export { hashPassword, verifyPassword };

export function createPainterSessionToken(
  painterId: string,
  email: string
): string {
  return jwt.sign({ painterId, email }, env.PAINTER_JWT_SECRET, {
    expiresIn: "7d",
    issuer: JWT_CLAIMS.painter.iss,
    audience: JWT_CLAIMS.painter.aud,
  });
}

export function verifyPainterSessionToken(
  token: string
): { painterId: string; email: string } | null {
  try {
    const payload = jwt.verify(token, env.PAINTER_JWT_SECRET, {
      issuer: JWT_CLAIMS.painter.iss,
      audience: JWT_CLAIMS.painter.aud,
    }) as { painterId: string; email: string };
    return payload;
  } catch {
    return null;
  }
}

export async function setPainterSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });
}

export async function clearPainterSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getPainterSession(): Promise<{
  painterId: string;
  email: string;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyPainterSessionToken(token);
}
