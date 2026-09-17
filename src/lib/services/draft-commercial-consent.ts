// Worker-safe: promotion is also called by OCR. No server-only import.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminDraftActions, orderDrafts } from "@/lib/db/schema";
import { CONTENT_CONSENT_VERSION } from "@/lib/config/content-consent";
import { PRELIMINARY_INFO_VERSION, DISTANCE_CONTRACT_VERSION } from "@/lib/config/distance-contract";

type Draft = typeof orderDrafts.$inferSelect;
type DraftTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type FingerprintDraft = Pick<Draft, "id" | "reference" | "updatedAt"> & Partial<Draft>;

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** Server-issued snapshot token; do not send DB objects or compute it in the browser. */
export function draftCommercialFingerprint(draft: FingerprintDraft): string {
  return createHash("sha256").update(JSON.stringify(canonical({
    id: draft.id, reference: draft.reference, updatedAt: draft.updatedAt, status: draft.status,
    amountKurus: draft.amountKurus, productionBaseKurus: draft.productionBaseKurus,
    paintingPriceKurus: draft.paintingPriceKurus, needsPainting: draft.needsPainting,
    giftCardAmountKurus: draft.giftCardAmountKurus, havaleDiscountKurus: draft.havaleDiscountKurus,
    upsells: draft.upsells, upsellAmountKurus: draft.upsellAmountKurus,
    paymentMethod: draft.paymentMethod, deadline: draft.bankTransferDeadline,
    productTitleSnapshot: draft.productTitleSnapshot, quantity: draft.quantity,
    productId: draft.productId, parentReference: draft.parentReference, sellerManufacturerId: draft.sellerManufacturerId,
    selectedOptions: draft.selectedOptions, selectedAddons: draft.selectedAddons,
    figurineSize: draft.figurineSize, material: draft.material, finish: draft.finish, style: draft.style,
    shippingAddress: draft.shippingAddress,
  }))).digest("hex");
}

export class DraftConsentRequiredError extends Error {
  constructor() { super("Taslağın fiyatı veya kalemleri değiştirildi. Müşteri ödeme bağlantısındaki güncel ön bilgilendirmeyi yeniden onaylamadan havale onaylanamaz."); }
}
export class DraftPaymentEvidenceChangedError extends Error {
  constructor() { super("Taslağın tutarı veya ödeme bilgileri bu ekran açıldıktan sonra değişti. Sayfayı yenileyin; güncel tahsil edilecek tutarı havale kaydıyla karşılaştırıp yeniden onaylayın. Sipariş oluşturulmadı."); }
}
/** Caller MUST hold the draft row lock; both editing and consent use it too. */
export async function assertEditedDraftConsent(tx: DraftTx, draft: Draft, manualPaymentEvidence?: { fingerprint?: string }): Promise<void> {
  const [edit] = await tx.select({ id: adminDraftActions.id }).from(adminDraftActions)
    .where(and(eq(adminDraftActions.draftId, draft.id), eq(adminDraftActions.action, "edit"))).limit(1);
  // Customer consent and the admin's bank evidence are independent. A fresh
  // customer consent must never validate an admin tab showing the old price.
  // Missing evidence is compatible only with never-edited legacy callers.
  if (manualPaymentEvidence && (
    (edit && !manualPaymentEvidence.fingerprint) ||
    (manualPaymentEvidence.fingerprint !== undefined && manualPaymentEvidence.fingerprint !== draftCommercialFingerprint(draft))
  )) throw new DraftPaymentEvidenceChangedError();
  // Existing, never-edited drafts keep their original promotion behavior.
  if (edit && (!draft.preliminaryInfoAcceptedAt || !draft.preliminaryInfoVersion || !draft.distanceContractVersion)) {
    throw new DraftConsentRequiredError();
  }
}

export class DraftConsentInputError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function recordDraftCommercialConsent(args: {
  reference: string; fingerprint: string; ip: string; userAgent: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    const [draft] = await tx.select().from(orderDrafts).where(eq(orderDrafts.reference, args.reference)).for("update");
    if (!draft) throw new DraftConsentInputError("Sipariş bulunamadı.", 404);
    if (!["pending", "awaiting_review"].includes(draft.status) || draft.promotedOrderId) {
      throw new DraftConsentInputError("Bu sipariş için artık onay alınamaz.", 409);
    }
    if (draftCommercialFingerprint(draft) !== args.fingerprint) {
      throw new DraftConsentInputError("Sipariş bilgileri değişti. Sayfayı yenileyip güncel tutar ve kalemleri okuyarak yeniden onaylayın.", 409);
    }
    const now = new Date();
    // One write: no half-recorded consent. Preserve already-recorded stamps on
    // duplicate requests for this same snapshot. Consent does not change the
    // commercial updatedAt token; an edit does and clears commercial stamps.
    await tx.update(orderDrafts).set({
      contentConsentAt: draft.contentConsentAt ?? now,
      contentConsentVersion: draft.contentConsentAt ? draft.contentConsentVersion : CONTENT_CONSENT_VERSION,
      preliminaryInfoAcceptedAt: draft.preliminaryInfoAcceptedAt ?? now,
      preliminaryInfoVersion: draft.preliminaryInfoAcceptedAt ? draft.preliminaryInfoVersion : PRELIMINARY_INFO_VERSION,
      distanceContractVersion: draft.preliminaryInfoAcceptedAt ? draft.distanceContractVersion : DISTANCE_CONTRACT_VERSION,
      consentIp: draft.preliminaryInfoAcceptedAt ? draft.consentIp : args.ip,
      consentUserAgent: draft.preliminaryInfoAcceptedAt ? draft.consentUserAgent : args.userAgent?.slice(0, 500) ?? null,
    }).where(eq(orderDrafts.id, draft.id));
  });
}
