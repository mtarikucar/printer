import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
// Side-effect import: triggers env.ts module-load validation at process start
// so the server fails to boot on missing critical env in production.
import "@/lib/env";

const AUTH_SECRET = process.env.AUTH_SECRET;

/**
 * Edge-safe NextAuth JWT verification. Returns the decoded token if valid AND
 * the role is "admin"; null otherwise. Unlike a cookie-presence check this
 * actually verifies the JWT signature against AUTH_SECRET — without it any
 * forged cookie value passed the previous check.
 */
async function getAdminToken(request: NextRequest) {
  if (!AUTH_SECRET) return null;
  const token = await getToken({
    req: request,
    secret: AUTH_SECRET,
    // Auth.js v5 cookie name varies by environment. Pass both so secure prod
    // cookies and unsecured dev cookies both work.
    cookieName: process.env.NODE_ENV === "production"
      ? "__Secure-authjs.session-token"
      : "authjs.session-token",
    salt: process.env.NODE_ENV === "production"
      ? "__Secure-authjs.session-token"
      : "authjs.session-token",
  });
  if (!token || (token as { role?: string }).role !== "admin") return null;
  return token;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Forward the pathname to RSC layouts (App Router doesn't expose it to server
  // components). The admin layout reads this to skip its auth gate + sidebar DB
  // queries on /admin/login — otherwise an unauthenticated login visit redirects
  // to /admin/login, which re-enters the layout and redirects again (infinite loop).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  // Admin routes: properly verify the NextAuth JWT (signature + role claim).
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const token = await getAdminToken(request);
    if (!token) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  // Admin login: redirect to dashboard if already a valid admin session.
  if (pathname === "/admin/login") {
    const token = await getAdminToken(request);
    if (token) {
      return NextResponse.redirect(new URL("/admin/dashboard", request.url));
    }
  }

  // Manufacturer routes: check session cookie exists and JWT is not expired
  if (
    pathname.startsWith("/manufacturer") &&
    pathname !== "/manufacturer/login" &&
    pathname !== "/manufacturer/register"
  ) {
    const session = request.cookies.get("manufacturer_session");
    if (!session?.value) {
      return NextResponse.redirect(
        new URL("/manufacturer/login", request.url)
      );
    }

    // Quick JWT expiry check (Edge-compatible, no crypto library needed)
    try {
      const parts = session.value.split(".");
      if (parts.length !== 3) throw new Error("bad jwt");
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      b64 += "=".repeat((4 - b64.length % 4) % 4);
      const payload = JSON.parse(atob(b64));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        // Token expired — clear cookie and redirect
        const res = NextResponse.redirect(new URL("/manufacturer/login", request.url));
        res.cookies.delete("manufacturer_session");
        return res;
      }
    } catch {
      // Malformed token — redirect to login
      const res = NextResponse.redirect(new URL("/manufacturer/login", request.url));
      res.cookies.delete("manufacturer_session");
      return res;
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/admin/(.*)", "/manufacturer/((?!login|register).*)"],
};
