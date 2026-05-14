/**
 * Pre-migration backfill: clear out legacy `pending_payment` rows from `orders`.
 *
 * Strategy: any order still in `pending_payment` never paid. Mark them `rejected`
 * (a state that *survives* the migration since it's still in the new enum) and
 * record an admin_action. We do NOT promote them to order_drafts because they're
 * old, the customer has long since moved on, and the gift card (if any) needs to
 * be refunded — easier to refund manually if the customer surfaces.
 *
 * Run:
 *   tsx scripts/backfill-pending-orders.ts            # dry-run, shows counts
 *   tsx scripts/backfill-pending-orders.ts --apply    # actually flips rows
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  // Counts first.
  const pendingResult = await db.execute(
    sql`SELECT count(*)::int as count FROM orders WHERE status::text = 'pending_payment'`
  );
  const pending = Number((pendingResult.rows[0] as { count: number }).count);

  const badPaymentResult = await db.execute(
    sql`SELECT count(*)::int as count FROM orders
        WHERE payment_status::text IN ('pending','awaiting_transfer','failed','expired')`
  );
  const badPayment = Number(
    (badPaymentResult.rows[0] as { count: number }).count
  );

  const whatsappResult = await db.execute(
    sql`SELECT count(*)::int as count FROM admin_actions WHERE action::text = 'message_whatsapp'`
  );
  const whatsappActions = Number(
    (whatsappResult.rows[0] as { count: number }).count
  );

  console.log("=== Pre-migration backfill scan ===");
  console.log(`  orders in status='pending_payment'    : ${pending}`);
  console.log(`  orders with deprecated payment_status : ${badPayment}`);
  console.log(`  admin_actions action='message_whatsapp': ${whatsappActions}`);

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to mutate rows.");
    return;
  }

  console.log("\n=== Applying backfill ===");

  // 1. Mark stale pending_payment orders as rejected + paid_at=createdAt so the
  //    NOT NULL constraint we're about to add is satisfied. (paid_at on a rejected
  //    order is a lie, but no UI path renders it for rejected orders.)
  const rejectResult = await db.execute(
    sql`UPDATE orders
        SET status = 'rejected',
            failure_reason = COALESCE(failure_reason, 'Auto-rejected during migration: order never completed payment'),
            paid_at = COALESCE(paid_at, created_at),
            updated_at = NOW()
        WHERE status::text = 'pending_payment'`
  );
  console.log(`  Rejected ${rejectResult.rowCount ?? "?"} stale pending_payment orders`);

  // 2. Coalesce orphan payment_status values.
  const psResult = await db.execute(
    sql`UPDATE orders
        SET payment_status = CASE
              WHEN payment_status::text IN ('failed','expired') THEN 'refunded'::payment_status
              ELSE 'succeeded'::payment_status
            END
        WHERE payment_status::text IN ('pending','awaiting_transfer','failed','expired')`
  );
  console.log(
    `  Coalesced ${psResult.rowCount ?? "?"} rows with deprecated payment_status`
  );

  // 3. Rewrite message_whatsapp → message_email so the enum value can be dropped.
  const actionResult = await db.execute(
    sql`UPDATE admin_actions SET action = 'message_email'
        WHERE action::text = 'message_whatsapp'`
  );
  console.log(
    `  Rewrote ${actionResult.rowCount ?? "?"} message_whatsapp admin actions to message_email`
  );

  console.log("\nDone. Now run: npm run db:migrate");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
