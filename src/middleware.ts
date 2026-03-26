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

  // Manufacturer routes: check session cookie exists
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
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/(.*)", "/manufacturer/((?!login|register).*)"],
};
