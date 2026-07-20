import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * Resolve the customer behind a guest checkout: attach to an existing GUEST
 * user with the same email, or create a fresh `isGuest=true` (no-password) row.
 *
 * Security (review C1): we REFUSE to attach to an existing user that has a real
 * password OR is no longer flagged as a guest — otherwise someone who knows a
 * victim's email could mutate their order history and trigger the post-purchase
 * "claim your account" email (which contains a working password-reset link).
 * Returning that case as `{ ok: false, code: "email_registered" }` lets callers
 * surface the right 409 in their own locale.
 *
 * Race handling (review C2): two simultaneous guest checkouts with the same
 * email both miss the initial lookup and both attempt the insert. The
 * `onConflictDoNothing` makes the loser get an empty array back; we re-select
 * and re-validate (the row we now see might be a real registration that
 * completed in between).
 *
 * Extracted from POST /api/orders so the admin "create order on behalf of a
 * customer" path (WhatsApp orders) can reuse the exact same logic.
 */
export type ResolveGuestResult =
  | { ok: true; user: typeof users.$inferSelect }
  | { ok: false; code: "email_registered" };

export async function resolveOrCreateGuestUser(input: {
  email: string;
  name: string;
  phone?: string | null;
  marketingConsent?: boolean;
  /**
   * Admin "create order on behalf of a customer" (WhatsApp orders). The caller
   * is an authenticated admin, so attaching the order to an EXISTING registered
   * account is legitimate and expected — the customer already has an account and
   * the admin is taking the order for them over WhatsApp.
   *
   * Public guest checkout must NEVER set this: there, refusing is exactly what
   * stops a stranger who knows an email from attaching orders to someone else's
   * account (and triggering its "claim your account" reset link).
   */
  allowExistingAccount?: boolean;
}): Promise<ResolveGuestResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing && (existing.passwordHash || !existing.isGuest)) {
    if (input.allowExistingAccount) {
      return { ok: true, user: existing };
    }
    return { ok: false, code: "email_registered" };
  }
  if (existing) {
    return { ok: true, user: existing };
  }

  const inserted = await db
    .insert(users)
    .values({
      email,
      fullName: input.name,
      phone: input.phone ?? null,
      passwordHash: null,
      isGuest: true,
      marketingConsent: input.marketingConsent ?? false,
      marketingConsentAt: input.marketingConsent ? new Date() : null,
    })
    .onConflictDoNothing({ target: users.email })
    .returning();

  if (inserted[0]) {
    return { ok: true, user: inserted[0] };
  }

  // Concurrent insert won the race — re-fetch and re-validate.
  const raced = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (!raced) {
    return { ok: false, code: "email_registered" };
  }
  if ((raced.passwordHash || !raced.isGuest) && !input.allowExistingAccount) {
    return { ok: false, code: "email_registered" };
  }
  return { ok: true, user: raced };
}
