import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { hashPassword, verifyPassword } from "./customer-auth";

const JWT_SECRET = () => process.env.AUTH_SECRET!;
const COOKIE_NAME = "manufacturer_session";

export { hashPassword, verifyPassword };

export function createManufacturerSessionToken(
  manufacturerId: string,
  email: string
): string {
  return jwt.sign({ manufacturerId, email }, JWT_SECRET(), { expiresIn: "7d" });
}

export function verifyManufacturerSessionToken(
  token: string
): { manufacturerId: string; email: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET()) as {
      manufacturerId: string;
      email: string;
    };
    return payload;
  } catch {
    return null;
  }
}

export async function setManufacturerSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });
}

export async function clearManufacturerSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getManufacturerSession(): Promise<{
  manufacturerId: string;
  email: string;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyManufacturerSessionToken(token);
}
