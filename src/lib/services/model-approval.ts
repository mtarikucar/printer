import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { orderModelApprovals, orders } from "@/lib/db/schema";
import { getPublicUrl } from "./storage";
import { isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "./manufacturer-assign";
import { autoAssignIfEligible } from "./order-confirm";

/**
 * The customer's approval of the 3D model, before anything is printed.
 *
 * Why this exists as its own table rather than a couple of columns on `orders`:
 * a second generation round overwrites the order's model columns, and with them
 * any proof of what the customer approved the first time. The distance-selling
 * contract makes production conditional on the buyer approving the preview, and
 * the withdrawal-right exclusion rests on that approval — so the evidence has to
 * survive a re-generation.
 *
 * The token is minted separately from `journeyToken` on purpose: the journey
 * token is printed on the card inside the box and cannot be rotated after
 * shipping, so it must not double as an approval capability.
 *
 * NOTE: no `import "server-only"` — the approval SLA sweeper runs in the worker.
 */

export type ModelApprovalDecision = "approved" | "revision" | "cancelled" | "auto_approved";

export interface OpenModelApprovalArgs {
  orderId: string;
  channel?: "email" | "whatsapp";
}

export interface OpenModelApprovalResult {
  token: string;
  approvalUrl: string;
  revision: number;
  turntableUrl: string | null;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
}

/**
 * The customer-facing address of an already-opened approval. The SLA sweeper
 * re-sends the request mail for a token that was minted days ago, and must not
 * call `openModelApproval()` to get the link — that would insert a second
 * "shown to the customer" evidence row for a model shown only once.
 */
export function modelApprovalUrl(token: string): string {
  return `${appUrl()}/onay/${token}`;
}

/**
 * Record that a specific model was shown to the customer, and mint (or reuse)
 * the capability token for /onay/<token>.
 */
export async function openModelApproval(
  args: OpenModelApprovalArgs
): Promise<OpenModelApprovalResult> {
  const [order] = await db
    .select({
      id: orders.id,
      modelApprovalToken: orders.modelApprovalToken,
      modelGlbKey: orders.modelGlbKey,
      modelTurntableKey: orders.modelTurntableKey,
      modelTurntableUrl: orders.modelTurntableUrl,
      modelGenerationRound: orders.modelGenerationRound,
    })
    .from(orders)
    .where(eq(orders.id, args.orderId))
    .limit(1);
  if (!order) throw new Error(`order ${args.orderId} not found`);

  let token = order.modelApprovalToken;
  if (!token) {
    token = nanoid(32);
    await db
      .update(orders)
      .set({ modelApprovalToken: token, updatedAt: new Date() })
      .where(eq(orders.id, args.orderId));
  }

  const [{ maxRev }] = await db
    .select({
      maxRev: sql<number>`coalesce(max(${orderModelApprovals.revision}), 0)::int`,
    })
    .from(orderModelApprovals)
    .where(eq(orderModelApprovals.orderId, args.orderId));
  const revision = (maxRev ?? 0) + 1;

  await db.insert(orderModelApprovals).values({
    orderId: args.orderId,
    revision,
    glbKey: order.modelGlbKey,
    turntableKey: order.modelTurntableKey,
    channel: args.channel ?? "email",
  });

  return {
    token,
    approvalUrl: modelApprovalUrl(token),
    revision,
    turntableUrl:
      order.modelTurntableUrl ??
      (order.modelTurntableKey ? getPublicUrl(order.modelTurntableKey) : null),
  };
}

export interface ApprovalView {
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  turntableUrl: string | null;
  glbUrl: string | null;
  decided: boolean;
  decision: ModelApprovalDecision | null;
  /**
   * True once a revision has already been requested and decided on this order.
   *
   * The distance-selling contract promises ONE FREE revision. Nothing counted
   * them before, so a second request was silently free too — the page and the
   * contract said one thing and the code did another. This does not BLOCK a
   * second request (the contract does not forbid one, it just stops paying for
   * it); it makes the page say so honestly and routes it to a human.
   */
  freeRevisionUsed: boolean;
}

/** Read the approval page's state for a token. Never leaks another order. */
export async function getApprovalByToken(token: string): Promise<ApprovalView | null> {
  if (!token || token.length < 16) return null;
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      status: orders.status,
      modelTurntableUrl: orders.modelTurntableUrl,
      modelGlbUrl: orders.modelGlbUrl,
      customerModelApprovedAt: orders.customerModelApprovedAt,
    })
    .from(orders)
    .where(eq(orders.modelApprovalToken, token))
    .limit(1);
  if (!order) return null;

  const [latest] = await db
    .select({ decision: orderModelApprovals.decision })
    .from(orderModelApprovals)
    .where(eq(orderModelApprovals.orderId, order.id))
    .orderBy(desc(orderModelApprovals.revision))
    .limit(1);

  const [{ revisionCount }] = await db
    .select({
      revisionCount: sql<number>`count(*) filter (where ${orderModelApprovals.decision} = 'revision')::int`,
    })
    .from(orderModelApprovals)
    .where(eq(orderModelApprovals.orderId, order.id));

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    status: order.status,
    turntableUrl: order.modelTurntableUrl,
    glbUrl: order.modelGlbUrl,
    decided: order.status !== "awaiting_customer_approval",
    decision: (latest?.decision as ModelApprovalDecision) ?? null,
    freeRevisionUsed: (revisionCount ?? 0) >= 1,
  };
}

export interface DecideResult {
  ok: boolean;
  status?: string;
  /** Set when the order was already decided — a second tap is a friendly no-op. */
  alreadyDecided?: boolean;
  /**
   * Set when approval or revision was refused because the order was refunded.
   * Nothing changed. It comes with `alreadyDecided`, so callers that only
   * know that flag keep answering with a friendly no-op.
   */
  refunded?: boolean;
  /**
   * Onay siparişi üreticiye yerleştirdi mi? Yalnız BEKLENEN otomatik atama
   * yolunda (SLA süpürmesinin otomatik onayı) doludur; müşteri kendi
   * dokunuşunda atamayı beklemez (bkz. aşağıdaki not).
   */
  autoAssigned?: boolean;
}

/**
 * Apply the customer's decision.
 *
 * The status update is atomic on `awaiting_customer_approval`, so a double tap,
 * a retried webhook and a duplicate WhatsApp button press all collapse into one
 * transition. `approved` is the only decision that lets production start.
 *
 * A refunded order is never approved or sent to revision (refund-end-state);
 * a cancellation is still recorded, because it only closes the order.
 */
export async function decideModelApproval(args: {
  token: string;
  decision: ModelApprovalDecision;
  note?: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<DecideResult> {
  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, paymentStatus: orders.paymentStatus, userId: orders.userId, manufacturerId: orders.manufacturerId })
    .from(orders)
    .where(eq(orders.modelApprovalToken, args.token))
    .limit(1);
  if (!order) return { ok: false };

  const nextStatus =
    args.decision === "approved" || args.decision === "auto_approved"
      ? "approved"
      : args.decision === "revision"
        ? "review"
        : "rejected";

  // A refund keeps the order's status, so a refunded order parked here still
  // shows /onay and still reaches the SLA sweeper. Approving it would reopen
  // the manufacturer queue for money already returned; a revision would queue
  // generation work nobody pays for. Cancelling stays allowed.
  const movesForward = nextStatus !== "rejected";
  if (movesForward && isRefunded(order)) {
    return { ok: true, alreadyDecided: true, refunded: true, status: order.status };
  }

  const updated = await db
    .update(orders)
    .set({
      status: nextStatus,
      // Only a real approval starts the manufacturer clock.
      ...(nextStatus === "approved"
        ? { manufacturerStatus: "unassigned" as const, customerModelApprovedAt: new Date() }
        : {}),
      ...(args.decision === "revision" ? { customerModelRevisionNote: args.note ?? null } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, order.id),
        eq(orders.status, "awaiting_customer_approval"),
        // The race-proof half of the check above: a refund landing between
        // the read and this write still wins. Not applied to a cancellation.
        movesForward ? notRefundedGuard() : undefined
      )
    )
    .returning({ id: orders.id });

  if (updated.length === 0) {
    // Either another decision got here first or a refund did; re-read so the
    // caller learns which, and the current status rather than the stale one.
    const [latest] = await db
      .select({ status: orders.status, paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, order.id))
      .limit(1);
    return {
      ok: true,
      alreadyDecided: true,
      status: latest?.status ?? order.status,
      ...(movesForward && latest && isRefunded(latest) ? { refunded: true } : {}),
    };
  }

  await db
    .update(orderModelApprovals)
    .set({
      decidedAt: new Date(),
      decision: args.decision,
      note: args.note ?? null,
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
    })
    .where(
      and(
        eq(orderModelApprovals.orderId, order.id),
        sql`${orderModelApprovals.decidedAt} is null`
      )
    );

  // Müşterinin onayı, meshy_auto siparişini "onaylı + atanmamış" hâline sokan
  // geçiştir — otomatik atama tam olarak burada devreye girer. Tetikleyici
  // ROTAYA değil bu fonksiyona konuldu: hem /onay sayfası hem onay SLA
  // süpürmesi buradan geçer, iki kopya zamanla ayrışırdı.
  //
  // Bekleme kuralı: SLA'nın otomatik onayı BEKLENİR (worker'da gecikmenin
  // maliyeti yok, karşılığında süpürme kaydı "atandı mı"yı yazabiliyor);
  // müşterinin kendi dokunuşunda beklenmez — aday puanlama sorguları
  // "Onaylıyorum" tıklamasının cevabını geciktirmemeli.
  if (nextStatus === "approved") {
    const reason =
      args.decision === "auto_approved" ? "onay SLA otomatik onayı" : "müşteri onayı";
    if (args.decision === "auto_approved") {
      const placement = await autoAssignIfEligible(order.id, { reason });
      return { ok: true, status: nextStatus, autoAssigned: placement.assigned };
    }
    // Fırlatmaz; .catch yalnız yüzen söz zinciri için.
    void autoAssignIfEligible(order.id, { reason }).catch((err) =>
      console.error(`[ATAMA] müşteri onayı sonrası atama hata verdi: ${order.id}`, err)
    );
  }

  return { ok: true, status: nextStatus };
}

/** Only auto-3D orders get the extra customer gate. */
export function requiresCustomerModelApproval(order: {
  orderType: string | null;
  modelSource: string | null;
  modelGlbKey: string | null;
}): boolean {
  return (
    order.orderType === "custom" &&
    order.modelSource === "meshy_auto" &&
    !!order.modelGlbKey
  );
}
