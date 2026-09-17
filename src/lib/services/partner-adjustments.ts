// Worker-safe. Browser consumers must use import type for the DTOs.
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, painters, manufacturerEarnings, painterEarnings, manufacturerActions, painterActions, partnerAdjustments } from "@/lib/db/schema";
import { lockPartnerMoney, type MoneyTx } from "@/lib/services/money-partner-lock";
import { loadPartnerPayables } from "@/lib/services/partner-payables";
import { isPayoutLockBusy } from "@/lib/services/payout-claim";
import {
  isValidAdjustmentNet, remainingOffsetCapacityKurus, type PartnerKind, type AdjustmentKind,
  type AdjustmentSourceKind, type AdjustmentStatus,
} from "@/lib/config/partner-adjustments";

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const reasonSchema = z.string().trim().min(10).max(1000);
const sourceSchema = z.object({
  kind: z.enum(["manufacturer_earning", "painter_earning", "adjustment"]),
  id: z.string().uuid(),
}).strict();
export const adjustmentCreateSchema = z.object({
  partnerKind: z.enum(["manufacturer", "painter"]), partnerId: z.string().uuid(),
  kind: z.enum(["topup", "reprint", "unpaid_offset"]), netKurus: z.number(),
  reason: reasonSchema, idempotencyKey: z.string().uuid(), expectedFingerprint: fingerprintSchema,
  source: sourceSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (!isValidAdjustmentNet(value.kind, value.netKurus)) ctx.addIssue({ code: "custom", path: ["netKurus"], message: "Geçerli, sıfır olmayan tam kuruş tutarı girin; ek ödeme pozitif, indirim negatif olmalıdır." });
  if ((value.kind === "unpaid_offset") !== !!value.source) ctx.addIssue({ code: "custom", path: ["source"], message: "İndirim için bir ödenmemiş kaynak seçin; ek ödemeye indirim kaynağı bağlanamaz." });
  if (value.source && value.source.kind !== "adjustment" && value.source.kind !== `${value.partnerKind}_earning`) ctx.addIssue({ code: "custom", path: ["source"], message: "İndirim kaynağı seçilen partner türüne ait olmalıdır." });
});
export const adjustmentCancelSchema = z.object({
  reason: reasonSchema, idempotencyKey: z.string().uuid(), expectedFingerprint: fingerprintSchema,
}).strict();
export type AdjustmentCreateInput = z.infer<typeof adjustmentCreateSchema>;
export type AdjustmentCancelInput = z.infer<typeof adjustmentCancelSchema>;

export interface AdjustmentSourceView {
  kind: AdjustmentSourceKind; id: string; label: string;
  remainingNetKurus: number; expectedFingerprint: string;
}
export interface AdjustmentRecipientView {
  kind: PartnerKind; id: string; name: string; expectedFingerprint: string;
  sources: AdjustmentSourceView[];
}
export interface AdjustmentHistoryView {
  id: string; partnerKind: PartnerKind; partnerId: string; partnerName: string;
  kind: AdjustmentKind; netKurus: number; status: AdjustmentStatus; reason: string;
  createdAt: string; adminEmail: string; canVoid: boolean; voidBlockedReason?: string;
  expectedFingerprint: string; payoutId?: string;
  voidedAt?: string; voidedBy?: string; voidReason?: string;
}
export interface OrderAdjustmentsView {
  recipients: AdjustmentRecipientView[]; adjustments: AdjustmentHistoryView[];
}

export class PartnerAdjustmentError extends Error {
  constructor(message: string, public status = 409, public code = "adjustment_conflict") { super(message); }
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

type Adjustment = typeof partnerAdjustments.$inferSelect;
type Source = {
  kind: AdjustmentSourceKind; id: string; partnerKind: PartnerKind; partnerId: string;
  netKurus: number; status: string; payoutId: string | null; snapshot: Record<string, unknown>;
};
const partnerOf = (row: Adjustment): { kind: PartnerKind; id: string } => row.manufacturerId
  ? { kind: "manufacturer", id: row.manufacturerId } : { kind: "painter", id: row.painterId! };
const payoutOf = (row: Adjustment) => row.manufacturerPayoutId ?? row.painterPayoutId;
const jsonSnapshot = (value: unknown) => canonical(value) as Record<string, unknown>;

/** One read model supplies the form and is rebuilt under the gate for writes. */
async function contextFor(tx: MoneyTx, orderId: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new PartnerAdjustmentError("Sipariş bulunamadı.", 404, "order_not_found");
  const [mEarnings, pEarnings, adjustments, mActions, pActions] = await Promise.all([
    tx.select().from(manufacturerEarnings).where(eq(manufacturerEarnings.orderId, orderId)),
    tx.select().from(painterEarnings).where(eq(painterEarnings.orderId, orderId)),
    tx.select().from(partnerAdjustments).where(eq(partnerAdjustments.orderId, orderId)),
    tx.select({ id: manufacturerActions.manufacturerId }).from(manufacturerActions).where(eq(manufacturerActions.orderId, orderId)),
    tx.select({ id: painterActions.painterId }).from(painterActions).where(eq(painterActions.orderId, orderId)),
  ]);
  const mIds = [...new Set([order.manufacturerId, ...mEarnings.map(e => e.manufacturerId), ...mActions.map(a => a.id), ...adjustments.map(a => a.manufacturerId)].filter((id): id is string => !!id))].sort();
  const pIds = [...new Set([order.painterId, ...pEarnings.map(e => e.painterId), ...pActions.map(a => a.id), ...adjustments.map(a => a.painterId)].filter((id): id is string => !!id))].sort();
  const [ms, ps] = await Promise.all([
    mIds.length ? tx.select({ id: manufacturers.id, name: manufacturers.companyName }).from(manufacturers).where(inArray(manufacturers.id, mIds)) : [],
    pIds.length ? tx.select({ id: painters.id, name: painters.companyName }).from(painters).where(inArray(painters.id, pIds)) : [],
  ]);
  const recipients = [...ms.map(p => ({ ...p, kind: "manufacturer" as const })), ...ps.map(p => ({ ...p, kind: "painter" as const }))]
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
    .map(p => ({ ...p, expectedFingerprint: fingerprint({ orderId, updatedAt: order.updatedAt, partnerKind: p.kind, partnerId: p.id, currentManufacturer: order.manufacturerId, currentPainter: order.painterId }) }));
  const sources: Source[] = [
    ...mEarnings.map(e => ({ kind: "manufacturer_earning" as const, id: e.id, partnerKind: "manufacturer" as const, partnerId: e.manufacturerId, netKurus: e.netKurus, status: e.status, payoutId: e.payoutId, snapshot: jsonSnapshot(e) })),
    ...pEarnings.map(e => ({ kind: "painter_earning" as const, id: e.id, partnerKind: "painter" as const, partnerId: e.painterId, netKurus: e.netKurus, status: e.status, payoutId: e.payoutId, snapshot: jsonSnapshot(e) })),
    ...adjustments.filter(a => a.kind !== "unpaid_offset").map(a => ({ kind: "adjustment" as const, id: a.id, partnerKind: partnerOf(a).kind, partnerId: partnerOf(a).id, netKurus: a.netKurus, status: a.status, payoutId: payoutOf(a), snapshot: jsonSnapshot(a) })),
  ];
  const payables = await Promise.all(recipients.map(p => loadPartnerPayables(tx, p.kind, p.id)));
  return { order, adjustments, recipients, sources, payables };
}
type Context = Awaited<ReturnType<typeof contextFor>>;

function sourceView(ctx: Context, source: Source) {
  const offsets = ctx.adjustments.filter(a => a.sourceKind === source.kind && a.sourceId === source.id && a.status !== "voided").sort((a, b) => a.id.localeCompare(b.id));
  const payable = ctx.payables.find(p => p.kind === source.partnerKind && p.partnerId === source.partnerId)!;
  const group = payable.groups.find(g => g.sourceKind === source.kind && g.sourceId === source.id);
  const blocked = payable.blockedGroups.find(g => g.sourceKind === source.kind && g.sourceId === source.id);
  // Claim and form eligibility use the SAME indivisible group reader, including
  // corrupt cross-order offsets and refunded originals. No second SQL policy.
  const assessment = { eligible: !!group };
  const expectedFingerprint = fingerprint({ source: source.snapshot, kind: source.kind, paymentStatus: ctx.order.paymentStatus, group: group ?? blocked ?? null, offsets: offsets.map(a => ({ id: a.id, netKurus: a.netKurus, status: a.status, payoutId: payoutOf(a) })) });
  const remainingNetKurus = remainingOffsetCapacityKurus(source.netKurus, offsets.map(a => a.netKurus));
  return { assessment, expectedFingerprint, remainingNetKurus };
}
function voidBlock(ctx: Context, row: Adjustment): string | undefined {
  if (row.status !== "pending") return "Yalnız bekleyen düzeltme iptal edilebilir; ödenmiş ve iptal edilmiş kayıtların geçmişi korunur.";
  if (payoutOf(row)) return "Önce bu düzeltmenin bulunduğu bekleyen ödeme partisini iptal edin.";
  if (row.sourceId) {
    const source = ctx.sources.find(s => s.kind === row.sourceKind && s.id === row.sourceId);
    if (source?.payoutId && source.status === "pending") return "Önce indirim kaynağının bulunduğu bekleyen ödeme partisini iptal edin.";
  }
  if (ctx.adjustments.some(a => a.sourceKind === "adjustment" && a.sourceId === row.id && a.status !== "voided")) return "Önce bu ek ödemeye bağlı indirimleri iptal edin.";
  return undefined;
}
function historyFingerprint(ctx: Context, row: Adjustment) {
  return fingerprint({ row, blocked: voidBlock(ctx, row), dependents: ctx.adjustments.filter(a => a.sourceKind === "adjustment" && a.sourceId === row.id).map(a => ({ id: a.id, status: a.status })).sort((a, b) => a.id.localeCompare(b.id)) });
}
function toView(ctx: Context): OrderAdjustmentsView {
  return {
    recipients: ctx.recipients.map(p => ({ ...p, sources: ctx.sources.filter(s => s.partnerKind === p.kind && s.partnerId === p.id).flatMap(s => {
      const view = sourceView(ctx, s);
      return view.assessment.eligible && view.remainingNetKurus > 0 ? [{ kind: s.kind, id: s.id, label: s.kind === "adjustment" ? "Bekleyen ek ödeme" : "Asıl hak ediş", remainingNetKurus: view.remainingNetKurus, expectedFingerprint: view.expectedFingerprint }] : [];
    }) })),
    adjustments: [...ctx.adjustments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).map(a => {
      const partner = partnerOf(a);
      const blocked = voidBlock(ctx, a);
      return { id: a.id, partnerKind: partner.kind, partnerId: partner.id, partnerName: ctx.recipients.find(p => p.kind === partner.kind && p.id === partner.id)?.name ?? "Partner kaydı okunamadı", kind: a.kind, netKurus: a.netKurus, status: a.status, reason: a.reason, createdAt: a.createdAt.toISOString(), adminEmail: a.adminEmail, canVoid: !blocked, voidBlockedReason: blocked, expectedFingerprint: historyFingerprint(ctx, a), ...(payoutOf(a) ? { payoutId: payoutOf(a)! } : {}), ...(a.voidedAt ? { voidedAt: a.voidedAt.toISOString(), voidedBy: a.voidedBy!, voidReason: a.voidReason! } : {}) };
    }),
  };
}
export async function loadOrderAdjustments(orderId: string): Promise<OrderAdjustmentsView> {
  return db.transaction(async tx => toView(await contextFor(tx, orderId)), { isolationLevel: "repeatable read", accessMode: "read only" });
}
function actor(email: string) {
  if (!email.trim()) throw new PartnerAdjustmentError("İşlemi yapan admin belirlenemedi.", 401, "admin_required");
  return email.trim();
}
function replay(row: Adjustment, hash: string) {
  if (row.requestHash !== hash) throw new PartnerAdjustmentError("Bu işlem anahtarı farklı bir düzeltme için kullanılmış. İşlemi yeniden kontrol edin.", 409, "idempotency_conflict");
  return { ok: true as const, adjustmentId: row.id, replayed: true };
}
export async function createPartnerAdjustment(args: { orderId: string; input: AdjustmentCreateInput; adminEmail: string }) {
  const parsed = adjustmentCreateSchema.safeParse(args.input);
  if (!parsed.success) throw new PartnerAdjustmentError("Geçerli net tutarı, kaynağı ve en az 10 karakterlik gerekçeyi girin.", 400, "invalid_adjustment");
  const input = parsed.data;
  const adminEmail = actor(args.adminEmail);
  const hash = fingerprint({ orderId: args.orderId, input, adminEmail });
  return db.transaction(async tx => {
    await lockPartnerMoney(tx, input.partnerKind, input.partnerId);
    const [existing] = await tx.select().from(partnerAdjustments).where(eq(partnerAdjustments.idempotencyKey, input.idempotencyKey));
    if (existing) return replay(existing, hash);
    const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, args.orderId)).for("update");
    if (!order) throw new PartnerAdjustmentError("Sipariş bulunamadı.", 404, "order_not_found");
    const ctx = await contextFor(tx, args.orderId);
    const recipient = ctx.recipients.find(p => p.kind === input.partnerKind && p.id === input.partnerId);
    if (!recipient) throw new PartnerAdjustmentError("Seçilen partner bu siparişin mevcut veya geçmiş partneri değil.", 409, "foreign_recipient");
    let sourceSnapshot: Record<string, unknown> | null = null;
    if (input.source) {
      const source = ctx.sources.find(s => s.kind === input.source!.kind && s.id === input.source!.id && s.partnerKind === input.partnerKind && s.partnerId === input.partnerId);
      if (!source) throw new PartnerAdjustmentError("İndirim kaynağı bulunamadı veya bu sipariş ve partnere ait değil.", 409, "invalid_source");
      const view = sourceView(ctx, source);
      if (source.payoutId) throw new PartnerAdjustmentError("Önce kaynak hak edişin bulunduğu ödeme partisini iptal edin; ödenmiş bir kayıttan indirim yapılamaz.", 409, "source_batched");
      if (!view.assessment.eligible) throw new PartnerAdjustmentError("Kaynak ödenmiş, geri alınmış, iade edilmiş veya mevcut indirimleri karşılayamıyor. Bu kaynaktan yeni indirim yapılamaz.", 409, "source_unavailable");
      if (view.expectedFingerprint !== input.expectedFingerprint) throw new PartnerAdjustmentError("Kaynak tutarı veya bağlı indirimler değişti. Güncel bilgileri yükleyin.", 409, "stale_adjustment");
      if (-input.netKurus > view.remainingNetKurus) throw new PartnerAdjustmentError("İndirim, seçilen kaynağın kalan ödenmemiş net tutarını aşamaz.", 409, "offset_exceeds_source");
      sourceSnapshot = { ...source.snapshot, sourceKind: source.kind, remainingNetKurus: view.remainingNetKurus, expectedFingerprint: view.expectedFingerprint };
    } else if (recipient.expectedFingerprint !== input.expectedFingerprint) {
      throw new PartnerAdjustmentError("Sipariş veya alıcı bilgileri değişti. Güncel bilgileri yükleyin.", 409, "stale_adjustment");
    }
    const [created] = await tx.insert(partnerAdjustments).values({
      orderId: args.orderId, manufacturerId: input.partnerKind === "manufacturer" ? input.partnerId : null,
      painterId: input.partnerKind === "painter" ? input.partnerId : null,
      kind: input.kind, netKurus: input.netKurus, sourceKind: input.source?.kind ?? null, sourceId: input.source?.id ?? null,
      sourceSnapshot, idempotencyKey: input.idempotencyKey, requestHash: hash, adminEmail, reason: input.reason,
    }).onConflictDoNothing({ target: partnerAdjustments.idempotencyKey }).returning();
    if (created) return { ok: true as const, adjustmentId: created.id, replayed: false };
    const [raced] = await tx.select().from(partnerAdjustments).where(eq(partnerAdjustments.idempotencyKey, input.idempotencyKey));
    if (raced) return replay(raced, hash);
    throw new PartnerAdjustmentError("Düzeltme başka bir işlemle çakıştı. Tekrar deneyin.", 409, "adjustment_busy");
  }).catch(error => {
    if (isPayoutLockBusy(error)) throw new PartnerAdjustmentError("Bu partner için başka bir para işlemi sürüyor. Güncel bilgileri yükleyip tekrar deneyin.", 409, "adjustment_busy");
    throw error;
  });
}

export async function voidPartnerAdjustment(args: { orderId: string; adjustmentId: string; input: AdjustmentCancelInput; adminEmail: string }) {
  const parsed = adjustmentCancelSchema.safeParse(args.input);
  if (!parsed.success) throw new PartnerAdjustmentError("İptal için güncel kayıt bilgisi ve en az 10 karakterlik gerekçe gereklidir.", 400, "invalid_adjustment");
  const input = parsed.data;
  const adminEmail = actor(args.adminEmail);
  const hash = fingerprint({ orderId: args.orderId, adjustmentId: args.adjustmentId, input, adminEmail });
  // Discover only the immutable owner before taking any row lock. Never take
  // a second partner gate after locking the order or adjustment.
  const [discovered] = await db.select().from(partnerAdjustments).where(and(eq(partnerAdjustments.id, args.adjustmentId), eq(partnerAdjustments.orderId, args.orderId)));
  if (!discovered) throw new PartnerAdjustmentError("Düzeltme kaydı bulunamadı.", 404, "adjustment_not_found");
  const owner = partnerOf(discovered);
  try {
    return await db.transaction(async tx => {
      await lockPartnerMoney(tx, owner.kind, owner.id);
      const [reused] = await tx.select().from(partnerAdjustments).where(eq(partnerAdjustments.voidOperationKey, input.idempotencyKey));
      if (reused) {
        if (reused.id !== args.adjustmentId || reused.voidRequestHash !== hash) throw new PartnerAdjustmentError("Bu iptal anahtarı farklı bir işlem için kullanılmış.", 409, "idempotency_conflict");
        return { ok: true as const, adjustmentId: reused.id, replayed: true };
      }
      await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, args.orderId)).for("update");
      const [row] = await tx.select().from(partnerAdjustments).where(and(eq(partnerAdjustments.id, args.adjustmentId), eq(partnerAdjustments.orderId, args.orderId))).for("update");
      if (!row || partnerOf(row).kind !== owner.kind || partnerOf(row).id !== owner.id) throw new PartnerAdjustmentError("Düzeltme kaydı değişti. Güncel bilgileri yükleyin.", 409, "stale_adjustment");
      const ctx = await contextFor(tx, args.orderId);
      const blocked = voidBlock(ctx, row);
      if (blocked) throw new PartnerAdjustmentError(blocked, 409, "adjustment_not_voidable");
      if (historyFingerprint(ctx, row) !== input.expectedFingerprint) throw new PartnerAdjustmentError("Düzeltme veya bağlı kayıtlar değişti. Güncel bilgileri yükleyin.", 409, "stale_adjustment");
      const [updated] = await tx.update(partnerAdjustments).set({
        status: "voided", voidedAt: new Date(), voidedBy: adminEmail, voidReason: input.reason,
        voidOperationKey: input.idempotencyKey, voidRequestHash: hash,
      }).where(and(eq(partnerAdjustments.id, row.id), eq(partnerAdjustments.status, "pending"), isNull(partnerAdjustments.manufacturerPayoutId), isNull(partnerAdjustments.painterPayoutId))).returning({ id: partnerAdjustments.id });
      if (!updated) throw new PartnerAdjustmentError("Düzeltme başka bir işleme girdi; iptal edilmedi.", 409, "adjustment_busy");
      return { ok: true as const, adjustmentId: updated.id, replayed: false };
    });
  } catch (error) {
    if (isPayoutLockBusy(error)) throw new PartnerAdjustmentError("Bu partner için başka bir para işlemi sürüyor. Güncel bilgileri yükleyip tekrar deneyin.", 409, "adjustment_busy");
    let cause: unknown = error;
    for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
      if ("code" in cause && cause.code === "23505") throw new PartnerAdjustmentError("Bu iptal anahtarı başka bir işlemde kullanıldı.", 409, "idempotency_conflict");
      cause = "cause" in cause ? cause.cause : null;
    }
    throw error;
  }
}
