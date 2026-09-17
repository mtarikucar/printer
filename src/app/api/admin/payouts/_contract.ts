import { z } from "zod";
import type { PartnerPayoutFailure, PartnerPayoutMismatch } from "@/lib/services/partner-payables";

const kind = z.enum(["manufacturer", "painter"], { error: "Partner türünü seçin." });
const expectedFingerprint = z.string({ error: "Güncel parti onayı gereklidir." }).regex(/^[a-f0-9]{64}$/, "Parti bilgilerini yenileyip tekrar onaylayın.");
export const payoutMarkPaidSchema = z.object({
  kind, expectedFingerprint,
  settlementKind: z.enum(["transfer", "netting"], { error: "Banka ödemesi veya mahsup türünü onaylayın." }),
  reference: z.string({ error: "Referans metin olmalıdır." }).trim().max(120, "Referans en fazla 120 karakter olabilir.").optional().transform(value => value || null),
}).strict().superRefine((value, ctx) => {
  if (value.settlementKind === "netting" && value.reference !== null) ctx.addIssue({ code: "custom", path: ["reference"], message: "Mahsup banka transferi değildir; banka referansı girilemez." });
});
export const payoutVoidSchema = z.object({
  kind, expectedFingerprint,
  reason: z.string({ error: "İptal gerekçesini girin." }).trim().min(10, "İptal gerekçesi en az 10 karakter olmalıdır.").max(1000, "Gerekçe en fazla 1000 karakter olabilir."),
  idempotencyKey: z.string({ error: "İptal işlem anahtarı gereklidir." }).uuid("İptal işlem anahtarı geçersiz."),
}).strict();
const FAILURE_COPY: Record<PartnerPayoutFailure["reason"], string> = {
  not_found: "Ödeme partisi bulunamadı.",
  busy: "Bu partner için başka bir para işlemi sürüyor. Sayfayı yenileyip tekrar deneyin.",
  confirmation_required: "Güncel parti bilgilerini yükleyip işlemi yeniden onaylayın.",
  stale_confirmation: "Parti içeriği değişti. Güncel tutarı ve kayıtları yükleyip tekrar onaylayın.",
  blocked_groups: "Partide ödenebilirliği doğrulanamayan bağlı kayıtlar var. İşlem yapılmadı; kaynak hak edişleri kontrol edin.",
  voided: "Bu ödeme partisi iptal edilmiş; tamamlanamaz.",
  already_paid: "Tamamlanmış ödeme veya mahsup iptal edilemez; geçmişi korunur.",
  payload_conflict: "Bu işlem daha önce farklı bilgilerle yapılmış. Güncel kaydı kontrol edin.",
  invalid_request: "Partinin banka ödemesi veya mahsup türü ile gönderilen bilgiler uyuşmuyor. Sayfayı yenileyin.",
};
export function payoutFailure(result: PartnerPayoutFailure | PartnerPayoutMismatch) {
  const error = result.reason === "mismatch"
    ? `Partinin kayıtlı tutarı (${result.statedKurus} kuruş) ile bağlı kayıtların toplamı (${result.heldKurus} kuruş) uyuşmuyor. Transfer yapmayın; partiyi ve kaynaklarını kontrol edin.`
    : FAILURE_COPY[result.reason];
  return { body: { error, code: result.reason }, status: result.reason === "not_found" ? 404 : 409 };
}
