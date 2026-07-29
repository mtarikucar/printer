/**
 * Admin revoke / reassign of a manufacturer assignment.
 *
 * Runs against whatever DATABASE_URL points at and cleans up after itself, so
 * point it at a scratch database:
 *   docker run -d --name pg_revoke -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:16
 *   DATABASE_URL=postgres://postgres:x@localhost:55432/postgres npx drizzle-kit migrate
 *   DATABASE_URL=... npx tsx scripts/test-revoke-manufacturer.ts
 */
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  users,
  orders,
  manufacturers,
  manufacturerActions,
  manufacturerEarnings,
} from "../src/lib/db/schema";
import {
  revokeManufacturerAssignment,
  REVOCABLE_MFG_STATUSES,
} from "../src/lib/services/manufacturer-revoke";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

const TAG = `revoke-test-${Date.now()}`;
const createdOrderIds: string[] = [];
let userId = "";
let mfgA = "";
let mfgB = "";

async function seedOrder(overrides: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(orders)
    .values({
      orderNumber: `${TAG}-${createdOrderIds.length + 1}`,
      userId,
      email: `${TAG}@example.test`,
      customerName: "Test Müşteri",
      shippingAddress: {
        adres: "a",
        mahalle: "m",
        ilce: "i",
        il: "Ankara",
        postaKodu: "06000",
        telefon: "+905000000000",
      },
      paymentMethod: "card",
      amountKurus: 139900,
      status: "approved",
      manufacturerId: mfgA,
      manufacturerStatus: "assigned",
      assignedToManufacturerAt: new Date(),
      ...overrides,
    })
    .returning();
  createdOrderIds.push(row.id);
  return row;
}

async function main() {
  const [u] = await db
    .insert(users)
    .values({ email: `${TAG}@example.test`, fullName: "Test" })
    .returning();
  userId = u.id;

  // Insert one at a time: drizzle's multi-row overload does not accept an
  // array literal here without widening every column.
  const [a] = await db
    .insert(manufacturers)
    .values({
      companyName: `${TAG}-A`,
      email: `${TAG}-a@example.test`,
      passwordHash: "x",
      contactPerson: "Test A",
      phone: "+905000000001",
      status: "active",
    })
    .returning();
  const [b] = await db
    .insert(manufacturers)
    .values({
      companyName: `${TAG}-B`,
      email: `${TAG}-b@example.test`,
      passwordHash: "x",
      contactPerson: "Test B",
      phone: "+905000000002",
      status: "active",
    })
    .returning();
  mfgA = a.id;
  mfgB = b.id;

  // ── 1. happy path from "assigned" ───────────────────────────────
  const o1 = await seedOrder();
  const r1 = await revokeManufacturerAssignment({
    orderId: o1.id,
    adminEmail: "admin@test",
    reason: "yanıt vermedi",
  });
  ok("assigned → ok", r1.code === "ok", r1);
  const [after1] = await db.select().from(orders).where(eq(orders.id, o1.id));
  ok("manufacturerId cleared", after1.manufacturerId === null);
  ok("status → unassigned", after1.manufacturerStatus === "unassigned");
  ok("assignedToManufacturerAt cleared", after1.assignedToManufacturerAt === null);
  ok("manufacturerAcceptedAt cleared", after1.manufacturerAcceptedAt === null);
  ok("manufacturerPrintedAt cleared", after1.manufacturerPrintedAt === null);
  ok(
    "previous manufacturer blocklisted",
    (after1.declinedManufacturerIds ?? []).includes(mfgA),
    after1.declinedManufacturerIds
  );
  ok("qcRound bumped", after1.qcRound === o1.qcRound + 1, after1.qcRound);
  ok("adminNotes records the revoke", (after1.adminNotes ?? "").includes("[GERİ ALMA]"));
  ok("order status untouched (approved)", after1.status === "approved");

  const acts = await db
    .select()
    .from(manufacturerActions)
    .where(eq(manufacturerActions.orderId, o1.id));
  ok("exactly one manufacturerActions row", acts.length === 1, acts.length);
  ok('action = "admin_revoked"', acts[0]?.action === "admin_revoked", acts[0]?.action);
  ok("action attributed to the OLD manufacturer", acts[0]?.manufacturerId === mfgA);
  ok("reason stored", (acts[0]?.notes ?? "").includes("yanıt vermedi"));

  // ── 2. money invariant ──────────────────────────────────────────
  const earnings = await db
    .select()
    .from(manufacturerEarnings)
    .where(eq(manufacturerEarnings.orderId, o1.id));
  ok("no earning row exists for a revoked order", earnings.length === 0);

  // ── 3. re-revoking the same order is refused ────────────────────
  const r1b = await revokeManufacturerAssignment({
    orderId: o1.id,
    adminEmail: "admin@test",
    reason: "tekrar",
  });
  ok("second revoke → not_assigned", r1b.code === "not_assigned", r1b);

  // ── 4. blocklist:false leaves the list untouched ────────────────
  const o2 = await seedOrder();
  await revokeManufacturerAssignment({
    orderId: o2.id,
    adminEmail: "admin@test",
    reason: "blocklist kapalı",
    blocklist: false,
  });
  const [after2] = await db.select().from(orders).where(eq(orders.id, o2.id));
  ok(
    "blocklist:false → declinedManufacturerIds not grown",
    !(after2.declinedManufacturerIds ?? []).includes(mfgA),
    after2.declinedManufacturerIds
  );

  // ── 5. every revocable status is accepted ───────────────────────
  for (const st of REVOCABLE_MFG_STATUSES) {
    const o = await seedOrder({ manufacturerStatus: st });
    const r = await revokeManufacturerAssignment({
      orderId: o.id,
      adminEmail: "admin@test",
      reason: `durum ${st}`,
    });
    ok(`${st} → revocable`, r.code === "ok", r);
  }

  // ── 6. states past the money boundary are refused ───────────────
  for (const st of ["qc_approved", "shipped"] as const) {
    const o = await seedOrder({ manufacturerStatus: st });
    const r = await revokeManufacturerAssignment({
      orderId: o.id,
      adminEmail: "admin@test",
      reason: "olmamalı",
    });
    ok(`${st} → refused`, r.code === "wrong_status", r);
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
    ok(`${st} → order untouched`, row.manufacturerId === mfgA && row.manufacturerStatus === st);
  }

  // ── 7. painter hand-off blocks the revoke ───────────────────────
  const o4 = await seedOrder({ painterStatus: "assigned" });
  const r4 = await revokeManufacturerAssignment({
    orderId: o4.id,
    adminEmail: "admin@test",
    reason: "boyacıda",
  });
  ok("painter hand-off → refused", r4.code === "handed_to_painter", r4);

  // ── 8. shipped orders are refused even in a revocable status ────
  const o5 = await seedOrder({ manufacturerStatus: "printed", shippedAt: new Date() });
  const r5 = await revokeManufacturerAssignment({
    orderId: o5.id,
    adminEmail: "admin@test",
    reason: "kargolandı",
  });
  ok("shippedAt set → refused", r5.code === "already_shipped", r5);

  // ── 9. marketplace seller order winds status back to "paid" ─────
  const o6 = await seedOrder({
    orderType: "marketplace",
    sellerManufacturerId: mfgA,
    status: "printing",
    manufacturerStatus: "printing",
  });
  const r6 = await revokeManufacturerAssignment({
    orderId: o6.id,
    adminEmail: "admin@test",
    reason: "mağaza siparişi",
  });
  ok("marketplace printing → ok", r6.code === "ok", r6);
  const [after6] = await db.select().from(orders).where(eq(orders.id, o6.id));
  ok('marketplace order rewound to "paid"', after6.status === "paid", after6.status);

  // custom order in "printing" rewinds to "approved" instead
  const o7 = await seedOrder({ status: "printing", manufacturerStatus: "printing" });
  await revokeManufacturerAssignment({
    orderId: o7.id,
    adminEmail: "admin@test",
    reason: "custom",
  });
  const [after7] = await db.select().from(orders).where(eq(orders.id, o7.id));
  ok('custom order rewound to "approved"', after7.status === "approved", after7.status);

  // ── 10. concurrent revokes: exactly one wins ────────────────────
  const o8 = await seedOrder();
  const [ra, rb] = await Promise.all([
    revokeManufacturerAssignment({ orderId: o8.id, adminEmail: "a", reason: "yarış 1" }),
    revokeManufacturerAssignment({ orderId: o8.id, adminEmail: "b", reason: "yarış 2" }),
  ]);
  const winners = [ra, rb].filter((r) => r.code === "ok").length;
  ok("concurrent revokes → exactly one succeeds", winners === 1, { ra, rb });
  const raceActs = await db
    .select()
    .from(manufacturerActions)
    .where(eq(manufacturerActions.orderId, o8.id));
  ok("race leaves exactly one audit row", raceActs.length === 1, raceActs.length);

  // ── 11. unassigned order is refused ─────────────────────────────
  const o9 = await seedOrder({ manufacturerId: null, manufacturerStatus: "unassigned" });
  const r9 = await revokeManufacturerAssignment({
    orderId: o9.id,
    adminEmail: "admin@test",
    reason: "atama yok",
  });
  ok("unassigned → not_assigned", r9.code === "not_assigned", r9);

  console.log(`\n${pass}/${pass + fail} passed`);
}

async function cleanup() {
  if (createdOrderIds.length > 0) {
    await db
      .delete(manufacturerActions)
      .where(inArray(manufacturerActions.orderId, createdOrderIds));
    await db.delete(orders).where(inArray(orders.id, createdOrderIds));
  }
  if (mfgA) await db.delete(manufacturers).where(inArray(manufacturers.id, [mfgA, mfgB]));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed", e));
    process.exit(fail > 0 ? 1 : 0);
  });
