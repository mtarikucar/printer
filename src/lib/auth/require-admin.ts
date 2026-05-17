import { NextResponse } from "next/server";
import { auth } from "./config";

/**
 * Single source of truth for "is this request an admin?". Use in every
 * `/api/admin/**` route handler.
 *
 * Returns either:
 *  - an object with `session` if the caller is an authenticated admin, or
 *  - a `response` (401) to short-circuit the handler.
 *
 * Pattern:
 * ```ts
 * const a = await requireAdmin();
 * if ("response" in a) return a.response;
 * // ...use a.session.user.email — role is guaranteed === "admin"
 * ```
 */
export interface AdminSession {
  user: { email: string; role: "admin" };
}

export async function requireAdmin(): Promise<
  { session: AdminSession } | { response: NextResponse }
> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user?.email || role !== "admin") {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return {
    session: {
      user: { email: session.user.email, role: "admin" as const },
    },
  };
}
