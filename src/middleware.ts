import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
// Side-effect import: triggers env.ts module-load validation at process start
// so the server fails to boot on missing critical env in production.
import "@/lib/env";
import {
  ATTR_COOKIE,
  SESSION_MAX_AGE,
  TOUCH_MAX_AGE,
  VISITOR_ID_MAX_AGE,
  buildTouch,
  hasAttributionParams,
  parseUtmParams,
} from "@/lib/analytics/attribution";

const AUTH_SECRET = process.env.AUTH_SECRET;

/**
 * Capture marketing attribution + visitor/session identity on every request
 * into first-party, SameSite=Lax cookies. This is what lets a paid order be
 * traced back to the campaign that drove it, fully server-side and independent
 * of any third-party pixel or consent (these are necessary-tier measurement
 * cookies carrying no PII). `fig_ft` is write-once (first touch); `fig_lt` is
 * refreshed on each new touch (last touch).
 */
function applyAttribution(request: NextRequest, res: NextResponse): void {
  const isProd = process.env.NODE_ENV === "production";
  const base = { httpOnly: false, sameSite: "lax" as const, secure: isProd, path: "/" };

  // Stable visitor id (write-once, long-lived).
  if (!request.cookies.get(ATTR_COOKIE.visitorId)?.value) {
    res.cookies.set(ATTR_COOKIE.visitorId, crypto.randomUUID(), {
      ...base,
      maxAge: VISITOR_ID_MAX_AGE,
    });
  }
  // Session id: reuse if present, else mint. Always re-set to slide the window.
  const sid = request.cookies.get(ATTR_COOKIE.sessionId)?.value || crypto.randomUUID();
  res.cookies.set(ATTR_COOKIE.sessionId, sid, { ...base, maxAge: SESSION_MAX_AGE });

  // Attribution touch: only when the URL actually carries utm/click params.
  const params = parseUtmParams(request.nextUrl.searchParams);
  if (hasAttributionParams(params)) {
    const touch = buildTouch(params, {
      landingPage: request.nextUrl.pathname + request.nextUrl.search,
      referrer: request.headers.get("referer") ?? undefined,
    });
    if (touch) {
      const value = JSON.stringify(touch);
      if (!request.cookies.get(ATTR_COOKIE.firstTouch)?.value) {
        res.cookies.set(ATTR_COOKIE.firstTouch, value, { ...base, maxAge: TOUCH_MAX_AGE });
      }
      res.cookies.set(ATTR_COOKIE.lastTouch, value, { ...base, maxAge: TOUCH_MAX_AGE });
    }
  }
}

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

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  applyAttribution(request, res);
  return res;
}

export const config = {
  // Run on everything except Next internals, static assets and API routes. The
  // broad matcher is what lets us capture UTM/attribution on any landing page;
  // the admin/manufacturer auth gates above are still keyed on the pathname.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|map)$|api/).*)",
  ],
};
