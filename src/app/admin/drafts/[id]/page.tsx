export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts, workshopParticipants, orderItems, adminDraftActions } from "@/lib/db/schema";
import { DraftReviewClient } from "./client";
import { draftPermissions } from "@/app/api/admin/drafts/[id]/_policy";
import { z } from "zod";
import { draftCommercialFingerprint } from "@/lib/services/draft-commercial-consent";

function historyAmount(value: unknown) {
  return typeof value === "number" ? `₺${(value / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}
function historyLines(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((line) => line && typeof line === "object" && typeof line.name === "string"
    ? [`${line.name}: ${historyAmount(line.priceKurus)}`] : []);
}

export default async function AdminDraftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const draft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.id, id),
  });
  if (!draft) notFound();

  const [workshop, items, history] = await Promise.all([
    db.query.workshopParticipants.findFirst({ where: eq(workshopParticipants.draftId, id), columns: { id: true } }),
    db.select().from(orderItems).where(eq(orderItems.draftId, id)),
    db.select().from(adminDraftActions).where(eq(adminDraftActions.draftId, id)).orderBy(desc(adminDraftActions.createdAt)).limit(100)
      .catch((error) => { console.error("[admin-draft] history read failed", id, error); return null; }),
  ]);
  const permissions = draftPermissions(draft, !!workshop);
  if (items.length && !permissions.edit) permissions.edit = "Sepet satırları manuel kalem listesiyle değiştirilemez.";
  const finalAmountKurus =
    draft.amountKurus - draft.giftCardAmountKurus - draft.havaleDiscountKurus;

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <DraftReviewClient
        management={{ id, updatedAt: draft.updatedAt.toISOString(),
          deadline: draft.bankTransferDeadline?.toISOString() ?? null,
          payUrl: `${(process.env.NEXT_PUBLIC_APP_URL || "https://figurunica.com").replace(/\/$/, "")}/pay/${encodeURIComponent(draft.reference)}`,
          permissions, lines: items.length ? items.map((item) => ({ name: `${item.productTitleSnapshot} × ${item.quantity}`, priceKurus: item.lineTotalKurus })) : draft.selectedAddons ?? [],
        }}
        draft={{
          id: draft.id,
          commercialFingerprint: draftCommercialFingerprint(draft),
          reference: draft.reference,
          status: draft.status,
          paymentMethod: draft.paymentMethod,
          customerName: draft.customerName,
          email: draft.email,
          phone: draft.phone,
          amountKurus: draft.amountKurus,
          giftCardAmountKurus: draft.giftCardAmountKurus,
          havaleDiscountKurus: draft.havaleDiscountKurus,
          finalAmountKurus,
          bankTransferDeadline: draft.bankTransferDeadline?.toISOString() ?? null,
          bankTransferReceiptUploadedAt:
            draft.bankTransferReceiptUploadedAt?.toISOString() ?? null,
          hasReceipt: !!draft.bankTransferReceiptKey,
          receiptOcrConfidence: draft.receiptOcrConfidence,
          receiptOcrParsed: draft.receiptOcrParsed,
          receiptOcrText: draft.receiptOcrText,
          receiptOcrFailureReason: draft.receiptOcrFailureReason,
          paytrFailureReason: draft.paytrFailureReason,
          paytrMerchantOid: draft.paytrMerchantOid,
          paytrTestMode: draft.paytrTestMode,
          paytrPaymentType: draft.paytrPaymentType,
          promotedOrderId: draft.promotedOrderId,
          createdAt: draft.createdAt.toISOString(),
        }}
      />
      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold text-gray-900">Taslak işlem geçmişi</h2>
        {history === null ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">İşlem geçmişi okunamadı. Bu, kayıt olmadığı anlamına gelmez; sayfayı tekrar yükleyin.</p>
          : history.length === 0 ? <p className="text-sm text-gray-500">Henüz kayıtlı taslak işlemi yok.</p>
          : <ol className="divide-y divide-gray-100">{history.map((entry) => <li key={entry.id} className="space-y-1 py-3 text-sm">
            <p className="font-medium">{{ edit: "Kalemler düzenlendi", extend: "Süre uzatıldı", cancel: "İptal edildi", resend: "Ödeme bağlantısı kuyruğa alındı" }[entry.action] ?? "Taslak işlemi"}</p>
            <p className="text-xs text-gray-500">{entry.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · {entry.adminEmail}</p>
            <p>{entry.reason}</p>
            {entry.action === "edit" && <>
              <p>Önce: {typeof entry.before.amountKurus === "number" ? `₺${(entry.before.amountKurus / 100).toLocaleString("tr-TR")}` : "—"} → Sonra: {typeof entry.after.amountKurus === "number" ? `₺${(entry.after.amountKurus / 100).toLocaleString("tr-TR")}` : "—"}</p>
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer text-indigo-700">Kalem değişiklikleri</summary>
                <p className="mt-1">Önce: {historyLines(entry.before.selectedAddons).join(" · ") || "—"}</p>
                <p>Sonra: {historyLines(entry.after.selectedAddons).join(" · ") || "—"}</p>
                <p>Üretim: {historyAmount(entry.before.productionBaseKurus)} → {historyAmount(entry.after.productionBaseKurus)}; Boyama: {historyAmount(entry.before.paintingPriceKurus)} → {historyAmount(entry.after.paintingPriceKurus)}</p>
              </details>
              <p className="text-xs text-gray-500">Müşterinin güncel fiyat için yeniden ön bilgilendirme onayı vermesi gerekir.</p>
            </>}
            {entry.action === "extend" && <p>Yeni son tarih: {typeof entry.after.deadline === "string" ? new Date(entry.after.deadline).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—"}</p>}
          </li>)}</ol>}
        {history?.length === 100 && <p className="mt-3 text-xs text-gray-500">Son 100 işlem gösteriliyor.</p>}
      </section>
    </div>
  );
}
