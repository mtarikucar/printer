/**
 * Smoke test: resolveOrCreateGuestUser + allowExistingAccount.
 *
 *   npx tsx scripts/test-guest-existing-account.ts
 *
 * Verifies the security boundary stays intact after allowing admins to place
 * WhatsApp orders on behalf of customers who already have an account:
 *   - PUBLIC guest checkout (no flag)   → must REFUSE a registered account.
 *   - ADMIN path (allowExistingAccount) → must ATTACH to that same account.
 *
 * Uses a throwaway user row and deletes it afterwards.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users } from "../src/lib/db/schema";
import { resolveOrCreateGuestUser } from "../src/lib/services/guest-user";

const EMAIL = `consent-test-${Date.now()}@example.invalid`;

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${name} — got ${actual}, expected ${expected}`);
  if (!ok) failures++;
}

async function main() {
  // A REGISTERED account (has a password, not a guest) — the protected case.
  const [created] = await db
    .insert(users)
    .values({
      email: EMAIL,
      fullName: "Consent Test",
      passwordHash: "$2a$10$notarealhashnotarealhashnotarealhashnotarealhash",
      isGuest: false,
    })
    .returning();

  try {
    // 1. Public guest checkout must still refuse.
    const pub = await resolveOrCreateGuestUser({
      email: EMAIL,
      name: "Consent Test",
    });
    check("public checkout refuses registered account", pub.ok, false);
    check(
      "public refusal code",
      pub.ok ? "-" : pub.code,
      "email_registered"
    );

    // 2. Admin (WhatsApp on-behalf-of) must attach to the SAME account.
    const adm = await resolveOrCreateGuestUser({
      email: EMAIL,
      name: "Consent Test",
      allowExistingAccount: true,
    });
    check("admin attaches to registered account", adm.ok, true);
    check(
      "admin got the same user row",
      adm.ok ? adm.user.id : "-",
      created.id
    );
  } finally {
    await db.delete(users).where(eq(users.id, created.id));
    console.log("· throwaway user deleted");
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll guest/admin resolution checks passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
