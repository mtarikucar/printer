import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";

// The admin realm uses NextAuth with a single-credentials provider. Only users
// authenticated via this provider get `role: "admin"` stamped on their JWT.
// Every admin-side check must verify `role === "admin"` — not just session
// presence — so that if more providers are added later, customer logins can't
// accidentally inherit admin powers.

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  secret: env.AUTH_SECRET,
  // Behind a TLS-terminating proxy (Traefik) the app receives HTTP internally,
  // so NextAuth's per-request secure-cookie auto-detection flips cookie names
  // between requests (authjs.* ↔ __Secure-/__Host-*). That mismatch breaks the
  // CSRF double-submit check on the credentials POST (MissingCSRF) and means a
  // session set as `authjs.session-token` is never read by middleware.ts, which
  // hardcodes `__Secure-authjs.session-token`. Force secure cookies in prod so
  // SET and READ are always consistent (browser↔proxy is always HTTPS).
  useSecureCookies: process.env.NODE_ENV === "production",
  providers: [
    Credentials({
      name: "Admin Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

        if (!adminEmail || !adminPasswordHash || !credentials?.email || !credentials?.password) {
          return null;
        }

        const emailStr = String(credentials.email);
        const emailMatch =
          emailStr.length === adminEmail.length &&
          crypto.timingSafeEqual(
            Buffer.from(emailStr),
            Buffer.from(adminEmail)
          );

        if (!emailMatch) return null;

        const passwordMatch = await bcrypt.compare(
          String(credentials.password),
          adminPasswordHash
        );

        if (passwordMatch) {
          // The role is set here in `authorize`; the JWT callback below copies
          // it onto the token. Future providers (e.g. customer Google login) MUST
          // NOT return `role: "admin"`.
          return { id: "admin", email: adminEmail, name: "Admin", role: "admin" };
        }
        return null;
      },
    }),
  ],
  pages: {
    signIn: "/admin/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      // `user` is populated only on first sign-in. Copy role onto the token so
      // it survives subsequent requests.
      if (user && (user as { role?: string }).role === "admin") {
        token.role = "admin";
      }
      return token;
    },
    async session({ session, token }) {
      if (token.role === "admin") {
        (session.user as { role?: string }).role = "admin";
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const role = (auth?.user as { role?: string } | undefined)?.role;
      const isAdmin = role === "admin";
      const isAdminRoute = nextUrl.pathname.startsWith("/admin");
      const isLoginPage = nextUrl.pathname === "/admin/login";

      if (isAdminRoute && !isLoginPage && !isAdmin) {
        return Response.redirect(new URL("/admin/login", nextUrl));
      }

      if (isLoginPage && isAdmin) {
        return Response.redirect(new URL("/admin/dashboard", nextUrl));
      }

      return true;
    },
  },
});
