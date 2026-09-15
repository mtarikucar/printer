/**
 * The 3D approval SLA sweeper.
 *
 * An order sitting in `awaiting_customer_approval` is a PAID order that is
 * printing nothing, and until this worker existed nobody was watching it: the
 * customer got one email and the queue had no clock. Three rules, applied in
 * order, every six hours:
 *
 *   1. AUTO-APPROVE  — verdict exactly `pass` and shown more than
 *      AUTO_APPROVE_PASS_AFTER_H (48) hours ago. `warn` and `fail` are NEVER
 *      auto-approved: those are precisely the meshes a human has to look at,
 *      and silently printing one is how a customer receives a broken figure.
 *   2. REMIND        — at 72h, re-send the approval mail exactly once.
 *   3. ESCALATE      — at 7 days, write an admin-visible warning on the order.
 *
 * The status transition goes through `decideModelApproval()` and never through
 * a bare `orders.status` write: the atomic `WHERE status = 'awaiting_customer_
 * approval'` guard lives in that function, so a customer tapping "Onaylıyorum"
 * in the same second as this sweep produces one transition, not two.
 *
 * Refunded orders are outside the sweep. A refund keeps the order's status, so
 * one can sit in `awaiting_customer_approval` forever; it is not waiting for
 * anyone. It must not be auto-approved (decideModelApproval refuses as well),
 * the customer who got their money back must not be reminded, and it is not
 * paid work stuck at the gate, so it is not escalated either.
 *
 * Resilience: one bad order must not abort the sweep. Every order is handled in
 * its own try/catch; the collected failures are reported once at the end.
 */
import { Worker, Job } from "bullmq";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { db } from "../../db";
import {
  generationAttempts,
  meshReports,
  orderModelApprovals,
  orders,
} from "../../db/schema";
import { getEmailQueue } from "../queues";
import { decideModelApproval, modelApprovalUrl } from "../../services/model-approval";
import { planApprovalSweep, slaThresholds } from "../../config/model-approval-sla";
import { getPublicUrl } from "../../services/storage";
import { emitOrderChanged } from "../../realtime/emit";
import { notRefundedGuard } from "../../services/manufacturer-assign";

/** Marker on `orders.admin_notes`; also what keeps the escalation from repeating. */
const ESCALATION_FLAG = "[ONAY-SLA]";

const AUTO_APPROVE_NOTE =
  "Kapı hükmü 'pass' ve müşteri süresi içinde yanıt vermedi — otomatik onaylandı.";

interface PendingApproval {
  orderId: string;
  orderNumber: string;
  email: string;
  customerName: string;
  locale: string;
  userId: string | null;
  manufacturerId: string | null;
  token: string | null;
  adminNotes: string | null;
  turntableUrl: string | null;
  turntableKey: string | null;
  approvalId: string;
  revision: number;
  shownAt: Date;
  reminderSentAt: Date | null;
}

/** The newest gate verdict per order, across every generation round. */
async function verdictsByOrder(orderIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (orderIds.length === 0) return map;

  const rows = await db
    .select({
      orderId: generationAttempts.orderId,
      verdict: meshReports.verdict,
    })
    .from(meshReports)
    .innerJoin(generationAttempts, eq(generationAttempts.id, meshReports.generationId))
    .where(inArray(generationAttempts.orderId, orderIds))
    .orderBy(desc(meshReports.createdAt));

  for (const row of rows) {
    if (!map.has(row.orderId)) map.set(row.orderId, row.verdict);
  }
  return map;
}

/** The open (undecided) approval row of every order parked at the gate. */
async function pendingApprovals(): Promise<PendingApproval[]> {
  const rows = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      email: orders.email,
      customerName: orders.customerName,
      locale: orders.locale,
      userId: orders.userId,
      manufacturerId: orders.manufacturerId,
      token: orders.modelApprovalToken,
      adminNotes: orders.adminNotes,
      turntableUrl: orders.modelTurntableUrl,
      turntableKey: orders.modelTurntableKey,
      approvalId: orderModelApprovals.id,
      revision: orderModelApprovals.revision,
      shownAt: orderModelApprovals.shownAt,
      reminderSentAt: orderModelApprovals.reminderSentAt,
    })
    .from(orders)
    .innerJoin(orderModelApprovals, eq(orderModelApprovals.orderId, orders.id))
    .where(
      and(
        eq(orders.status, "awaiting_customer_approval"),
        isNull(orderModelApprovals.decidedAt),
        // Refunded orders are out of the sweep (see the header).
        notRefundedGuard()
      )
    )
    .orderBy(desc(orderModelApprovals.revision));

  // A revision round can leave more than one undecided row behind; the clock
  // belongs to the model actually on screen, which is the highest revision.
  const newest = new Map<string, PendingApproval>();
  for (const row of rows) {
    if (!newest.has(row.orderId)) newest.set(row.orderId, row);
  }
  return [...newest.values()];
}

function hoursSince(when: Date, now: number): number {
  return (now - when.getTime()) / 3_600_000;
}

async function processJob(job: Job) {
  const now = Date.now();
  const pending = await pendingApprovals();

  const [{ parked }] = await db
    .select({ parked: sql<number>`count(*)::int` })
    .from(orders)
    // The same set as pendingApprovals(); otherwise every refunded order parked
    // here would be reported as missing its approval row.
    .where(and(eq(orders.status, "awaiting_customer_approval"), notRefundedGuard()));

  if (parked > pending.length) {
    // No open approval row means /onay has nothing to show and no clock runs.
    console.warn(
      `[model-approval-sla] ${parked - pending.length} order(s) parked in ` +
        `awaiting_customer_approval with no open approval row`
    );
  }

  if (pending.length === 0) {
    job.log("no orders awaiting customer model approval");
    return;
  }

  const verdicts = await verdictsByOrder(pending.map((p) => p.orderId));

  const autoApproved: { orderNumber: string; hours: number }[] = [];
  const reminded: string[] = [];
  const escalated: { orderNumber: string; hours: number }[] = [];
  const failures: string[] = [];

  const t = slaThresholds();

  for (const row of pending) {
    const age = hoursSince(row.shownAt, now);
    const verdict = verdicts.get(row.orderId) ?? null;
    const actions = planApprovalSweep(
      {
        verdict,
        ageHours: age,
        hasToken: !!row.token,
        reminderSent: !!row.reminderSentAt,
        alreadyEscalated: (row.adminNotes ?? "").includes(ESCALATION_FLAG),
      },
      t
    );
    if (!row.token) {
      // No capability token means /onay has no address; the escalation note is
      // the only remaining way this order reaches a human.
      console.warn(`[model-approval-sla] ${row.orderNumber}: onay jetonu yok`);
    }

    try {
      // ── 1. Auto-approve ────────────────────────────────────────────────
      if (actions.includes("auto_approve")) {
        const result = await decideModelApproval({
          token: row.token!,
          decision: "auto_approved",
          note: `${AUTO_APPROVE_NOTE} (${Math.floor(age)} saat)`,
        });
        if (!result.ok) {
          failures.push(`${row.orderNumber}: onay jetonu eşleşmedi`);
          continue;
        }
        if (result.alreadyDecided) {
          job.log(
            result.refunded
              ? `${row.orderNumber} refunded meanwhile; not auto-approved`
              : `${row.orderNumber} already decided (${result.status})`
          );
          continue;
        }
        await emitOrderChanged({
          orderId: row.orderId,
          orderNumber: row.orderNumber,
          userId: row.userId,
          manufacturerId: row.manufacturerId,
          status: "approved",
          manufacturerStatus: "unassigned",
        });
        // Otomatik onay siparişi "onaylı + atanmamış" hâline sokar ve üretici
        // ataması `decideModelApproval` içinden BEKLENEREK yapılır (tek
        // tetikleyici orada durur, müşterinin /onay yolu da aynı yerden geçer).
        // Sonucu buraya yazmak, süpürme kaydının "onaylandı ama kimseye
        // gitmedi" durumunu göstermesini sağlar; atanamayan sipariş ayrıca
        // [ATAMA] notu + admin e-postası üretir.
        job.log(
          result.autoAssigned
            ? `${row.orderNumber} auto-approved and auto-assigned`
            : `${row.orderNumber} auto-approved; not auto-assigned (see [ATAMA] note)`
        );
        autoApproved.push({ orderNumber: row.orderNumber, hours: Math.floor(age) });
        continue;
      }

      // ── 2. Remind, once ────────────────────────────────────────────────
      if (actions.includes("remind")) {
        await getEmailQueue().add("model-approval-reminder", {
          type: "model_approval_request",
          to: row.email,
          orderNumber: row.orderNumber,
          customerName: row.customerName,
          approvalUrl: modelApprovalUrl(row.token!),
          turntableUrl:
            row.turntableUrl ??
            (row.turntableKey ? getPublicUrl(row.turntableKey) : undefined),
          locale: row.locale === "en" ? "en" : "tr",
        });
        // Written only after the enqueue succeeds: a lost reminder is retried
        // in six hours, a double reminder is never sent.
        await db
          .update(orderModelApprovals)
          .set({ reminderSentAt: new Date() })
          .where(
            and(
              eq(orderModelApprovals.id, row.approvalId),
              isNull(orderModelApprovals.reminderSentAt)
            )
          );
        reminded.push(row.orderNumber);
      }

      // ── 3. Escalate ────────────────────────────────────────────────────
      if (actions.includes("escalate")) {
        const note =
          `${ESCALATION_FLAG} Müşteri ${Math.floor(age)} saattir 3D modeli onaylamadı ` +
          `(kapı hükmü: ${verdict ?? "yok"}). Sipariş ödendi ama üretime giremiyor.`;
        await db
          .update(orders)
          .set({
            adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                            THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, row.orderId));
        console.warn(`[model-approval-sla] ${row.orderNumber}: ${note}`);
        escalated.push({ orderNumber: row.orderNumber, hours: Math.floor(age) });
      }
    } catch (err) {
      // One order's failure must not cost the rest of the sweep.
      const message = (err as Error).message;
      console.error(`[model-approval-sla] ${row.orderNumber} failed: ${message}`);
      failures.push(`${row.orderNumber}: ${message}`);
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL || "system@figurunica.com";

  if (autoApproved.length > 0) {
    await getEmailQueue()
      .add("admin-model-auto-approved", {
        type: "admin_custom",
        to: adminEmail,
        orderNumber: autoApproved[0].orderNumber,
        customerName: "Admin",
        customSubject: `${autoApproved.length} sipariş 3D modeli otomatik onaylandı`,
        customBody:
          `Aşağıdaki siparişlerde baskı kapısı 'pass' verdi ve müşteri ${t.autoApproveAfterH} saat ` +
          `içinde yanıt vermedi; sipariş otomatik onaylandı ve üretim kuyruğuna düştü:\n\n` +
          autoApproved.map((o) => `- ${o.orderNumber} — ${o.hours} saat`).join("\n"),
        locale: "tr",
      })
      .catch((e) => console.error("[model-approval-sla] admin email failed", e));
  }

  if (escalated.length > 0) {
    await getEmailQueue()
      .add("admin-model-approval-escalation", {
        type: "admin_custom",
        to: adminEmail,
        orderNumber: escalated[0].orderNumber,
        customerName: "Admin",
        customSubject:
          `${escalated.length} sipariş ${Math.round(t.escalateAfterH / 24)} günden uzun ` +
          `süredir müşteri 3D onayı bekliyor`,
        customBody:
          `Aşağıdaki ödenmiş siparişler müşteri 3D onayını bekliyor ve otomatik ` +
          `onaya uygun değil (kapı hükmü 'pass' değil ya da onay bağlantısı yok):\n\n` +
          escalated.map((o) => `- ${o.orderNumber} — ${o.hours} saat`).join("\n") +
          `\n\nSipariş sayfasından müşteriyle iletişime geçin ya da modeli yeniden üretin.`,
        locale: "tr",
      })
      .catch((e) => console.error("[model-approval-sla] admin email failed", e));
  }

  job.log(
    `swept ${pending.length} pending approval(s): ` +
      `${autoApproved.length} auto-approved, ${reminded.length} reminded, ` +
      `${escalated.length} escalated, ${failures.length} failed`
  );

  // Reported only after every order has been handled, so the failure is visible
  // in the queue without having cut the sweep short.
  if (failures.length > 0) {
    throw new Error(`model-approval-sla: ${failures.length} order(s) failed — ${failures.join(" | ")}`);
  }
}

export function startModelApprovalSlaWorker(): Worker {
  const worker = new Worker("model-approval-sla", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    console.info(`model-approval-sla completed: ${job.id}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`model-approval-sla failed: ${job?.id}`, err);
  });

  return worker;
}
