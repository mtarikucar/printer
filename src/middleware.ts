import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin routes: check for NextAuth session cookie
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const sessionToken =
      request.cookies.get("authjs.session-token") ??
      request.cookies.get("__Secure-authjs.session-token");
    if (!sessionToken?.value) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  // Admin login: redirect to dashboard if already logged in
  if (pathname === "/admin/login") {
    const sessionToken =
      request.cookies.get("authjs.session-token") ??
      request.cookies.get("__Secure-authjs.session-token");
    if (sessionToken?.value) {
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
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/(.*)", "/manufacturer/((?!login|register).*)"],
};
