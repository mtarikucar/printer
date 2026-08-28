import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { orderModelApprovals, orders } from "@/lib/db/schema";
import { getPublicUrl } from "./storage";

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

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    status: order.status,
    turntableUrl: order.modelTurntableUrl,
    glbUrl: order.modelGlbUrl,
    decided: order.status !== "awaiting_customer_approval",
    decision: (latest?.decision as ModelApprovalDecision) ?? null,
  };
}

export interface DecideResult {
  ok: boolean;
  status?: string;
  /** Set when the order was already decided — a second tap is a friendly no-op. */
  alreadyDecided?: boolean;
}

/**
 * Apply the customer's decision.
 *
 * The status update is atomic on `awaiting_customer_approval`, so a double tap,
 * a retried webhook and a duplicate WhatsApp button press all collapse into one
 * transition. `approved` is the only decision that lets production start.
 */
export async function decideModelApproval(args: {
  token: string;
  decision: ModelApprovalDecision;
  note?: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<DecideResult> {
  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, userId: orders.userId, manufacturerId: orders.manufacturerId })
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
    .where(and(eq(orders.id, order.id), eq(orders.status, "awaiting_customer_approval")))
    .returning({ id: orders.id });

  if (updated.length === 0) {
    return { ok: true, alreadyDecided: true, status: order.status };
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
