/** Shared by the draft screen and its endpoint; no database/client-unsafe imports. */
import { z } from "zod";
import { COST_LINE_KINDS, parseTryToKurus, splitCostLines } from "@/lib/config/cost-lines";
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";

// Same bounds and cost-line vocabulary as admin/orders/create. Parse strings
// with the existing Turkish money parser rather than rounding a browser float.
export const DRAFT_INPUT_ERROR = "Taslak işlem bilgileri geçersiz. Kalem açıklamalarını, fiyatları, miktarları, gerekçeyi ve son tarihi kontrol edin.";

export const draftLineSchema = z.object({
  description: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(999),
  unitPrice: z.string().refine((v) => {
    const n = parseTryToKurus(v);
    return Number.isSafeInteger(n) && n > 0 && n <= 100_000_000;
  }, "Kalem fiyatı geçersiz."),
  kind: z.enum(COST_LINE_KINDS),
});
const common = {
  reason: z.string().trim().min(3, "En az 3 karakter gerekçe yazın.").max(1000),
  expectedUpdatedAt: z.string().datetime(),
};
export const draftActionSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("edit"), lines: z.array(draftLineSchema).min(1).max(20) }),
  z.object({ ...common, action: z.literal("extend"), deadline: z.string().datetime() }),
  z.object({ ...common, action: z.literal("cancel") }),
  z.object({ ...common, action: z.literal("resend") }),
]);
export type DraftAction = z.infer<typeof draftActionSchema>;
export type DraftLine = z.infer<typeof draftLineSchema>;
export interface DraftPolicyInput {
  status: string; promotedOrderId: string | null; paymentMethod: string;
  paytrMerchantOid: string | null; bankTransferReceiptKey: string | null;
  orderType: string; productId: string | null; parentReference: string | null;
  giftCardAmountKurus: number; upsellAmountKurus: number; havaleDiscountKurus?: number;
  attributionChannel: string | null;
  amountKurus: number;
  selectedAddons: { name: string; priceKurus: number; kind?: string }[] | null;
}
export function draftPermissions(draft: DraftPolicyInput, workshop = false) {
  const closed = draft.status !== "pending" || draft.promotedOrderId
    ? "Yalnız henüz ödenmemiş, bekleyen taslaklarda işlem yapılabilir." : null;
  const paymentEvidence = draft.bankTransferReceiptKey
    ? "Dekont yüklenmiş. Önce ödemeyi inceleyin; taslak fiyatı veya durumu değiştirilemez." : null;
  const active = closed ?? paymentEvidence;
  // The public card-token endpoint reads before it writes and does not lock
  // this row. Even a NULL merchant_oid cannot prove no token is being minted.
  // A lock here alone CANNOT safely enable card price edits/cancellation.
  const card = draft.paymentMethod !== "bank_transfer" || draft.paytrMerchantOid
    ? "Kart ödemeli taslakta fiyat değişikliği ve iptal bu ekrandan yapılamaz; açık ödeme bağlantısı eski tutarı kullanabilir. Ödeme durumunu PayTR sorgusundan kontrol edin." : null;
  const workshopReason = workshop ? "Atölye katılımını seans ekranından yönetin." : null;
  const reserved = draft.giftCardAmountKurus > 0
    ? "Hediye kartı bakiyesi ayrılmış; bu ekrandan fiyat veya iptal işlemi yapılamaz." : null;
  const manual = draft.orderType === "marketplace" && !draft.productId && !draft.parentReference
    && draft.attributionChannel === "whatsapp" && draft.upsellAmountKurus === 0
    && !!draft.selectedAddons?.length
    && draft.selectedAddons.every((l) => l.kind === "production" || l.kind === "painting")
    && draft.selectedAddons.reduce((sum, l) => sum + l.priceKurus, 0) === draft.amountKurus;
  const editable = active ?? card ?? workshopReason ?? reserved ?? (draft.havaleDiscountKurus ? "İndirimli taslakta kalem düzenleme desteklenmiyor." : null) ?? (!manual
    ? "Kalem düzenleme, manuel oluşturulmuş havale taslaklarında kullanılabilir. Katalog/sepet taslaklarının fiyat kuralları korunur." : null);
  return {
    edit: editable,
    extend: active ?? card ?? workshopReason,
    cancel: active ?? card ?? workshopReason ?? reserved,
    resend: active,
  };
}
export function draftLinesUpdate(draft: { finish: string }, lines: DraftLine[]) {
  const selectedAddons = lines.map((line) => ({
    name: line.quantity > 1 ? `${line.description} × ${line.quantity}` : line.description,
    priceKurus: parseTryToKurus(line.unitPrice) * line.quantity,
    kind: line.kind,
  }));
  const { productionKurus, paintingKurus } = splitCostLines(selectedAddons.map((line) => ({ kind: line.kind, amountKurus: line.priceKurus })));
  const amountKurus = productionKurus + paintingKurus;
  if (!Number.isSafeInteger(amountKurus) || amountKurus <= 0 || amountKurus > MAX_AMOUNT_KURUS) {
    throw new Error("Toplam tutar 0 ile ₺2.000.000 arasında olmalıdır.");
  }
  if (["hand_painted", "luxe_display"].includes(draft.finish) && paintingKurus <= 0) {
    throw new Error("El boyaması yüzey için boyama kalemi gerekir.");
  }
  return { selectedAddons, amountKurus, productionBaseKurus: productionKurus, paintingPriceKurus: paintingKurus, needsPainting: paintingKurus > 0,
    productTitleSnapshot: selectedAddons.length === 1 ? selectedAddons[0].name : `Özel sipariş (${selectedAddons.length} kalem)` };
}
