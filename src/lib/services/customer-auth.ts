import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { env, JWT_CLAIMS } from "@/lib/env";

const COOKIE_NAME = "customer_session";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createSessionToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, env.CUSTOMER_JWT_SECRET, {
    expiresIn: "7d",
    issuer: JWT_CLAIMS.customer.iss,
    audience: JWT_CLAIMS.customer.aud,
  });
}

export function verifySessionToken(
  token: string
): { userId: string; email: string } | null {
  try {
    const payload = jwt.verify(token, env.CUSTOMER_JWT_SECRET, {
      issuer: JWT_CLAIMS.customer.iss,
      audience: JWT_CLAIMS.customer.aud,
    }) as { userId: string; email: string };
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSessionUser(): Promise<{
  userId: string;
  email: string;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

const ANONYMOUS_COOKIE = "anonymous_session";

export async function getOrCreateAnonymousId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(ANONYMOUS_COOKIE)?.value;
  if (existing) return existing;

  const id = randomUUID();
  cookieStore.set(ANONYMOUS_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });
  return id;
}
