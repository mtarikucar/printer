import { notFound, redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getBankDetails } from "@/lib/config/payment";
import { SiteHeader } from "@/components/site-header";
import { BankTransferInstructions } from "@/components/bank-transfer-instructions";
import { getLocale } from "@/lib/i18n/get-locale";
import { LocaleProvider } from "@/lib/i18n/locale-context";

export const dynamic = "force-dynamic";

export default async function HavalePage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const session = await getSessionUser();
  if (!session) {
    redirect(`/login?next=/havale/${reference}`);
  }

  const draft = await db.query.orderDrafts.findFirst({
    where: and(
      eq(orderDrafts.reference, reference),
      eq(orderDrafts.userId, session.userId)
    ),
  });

  if (!draft) notFound();

  // If already promoted, send the customer to the regular tracking page.
  if (draft.status === "confirmed") {
    redirect(`/track/${reference}`);
  }

  if (draft.paymentMethod !== "bank_transfer") {
    redirect(`/track/${reference}`);
  }

  const locale = await getLocale();
  const bank = getBankDetails();
  const finalAmountKurus =
    draft.amountKurus - draft.giftCardAmountKurus - draft.havaleDiscountKurus;

  const receiptUrl = draft.bankTransferReceiptKey
    ? `/api/customer/orders/${draft.reference}/receipt/view`
    : null;

  // OCR status hint
  const ocrStatus = draft.receiptOcrConfidence
    ? draft.receiptOcrConfidence
    : draft.bankTransferReceiptKey
    ? "scanning"
    : null;

  return (
    <LocaleProvider locale={locale}>
      <main className="min-h-screen bg-bg-base">
        <SiteHeader />
        <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
          <div className="card p-6 sm:p-8">
            <h1 className="text-2xl font-serif text-text-primary">
              Havale ile ödeme
            </h1>
            <p className="text-text-secondary mt-1">
              Sipariş referansı:{" "}
              <span className="font-mono text-green-500">{draft.reference}</span>
            </p>
            <p className="text-sm text-text-muted mt-2">
              Aşağıdaki IBAN&apos;a, açıklama alanına sipariş referansınızı yazarak ödemenizi yapın.
              Ardından dekontu yükleyin; sistemimiz otomatik kontrol edip siparişinizi başlatacaktır.
            </p>
          </div>

          <BankTransferInstructions
            orderNumber={draft.reference}
            bank={bank}
            finalAmountKurus={finalAmountKurus}
            deadline={draft.bankTransferDeadline?.toISOString() ?? null}
            receiptUploadedAt={draft.bankTransferReceiptUploadedAt?.toISOString() ?? null}
            receiptUrl={receiptUrl}
          />

          {ocrStatus === "scanning" && (
            <div className="card p-4 border-l-4 border-blue-500 text-sm text-blue-900 bg-blue-50">
              Dekontunuz alındı, otomatik kontrol ediliyor… Yüksek güven oluştuğunda
              siparişiniz otomatik olarak başlatılacak.
            </div>
          )}

          {ocrStatus === "high" && (
            <div className="card p-4 border-l-4 border-green-500 text-sm text-green-900 bg-green-50">
              Dekontunuz doğrulandı, siparişiniz başlatılıyor.
            </div>
          )}

          {(ocrStatus === "medium" || ocrStatus === "low") && (
            <div className="card p-4 border-l-4 border-amber-500 text-sm text-amber-900 bg-amber-50">
              Dekontunuz alındı ancak otomatik doğrulanamadı. Ekibimiz manuel olarak kontrol edip
              siparişinizi en kısa sürede başlatacak.
            </div>
          )}

          <p className="text-center text-xs text-text-muted">
            Sorularınız için{" "}
            <a href="mailto:siparis@figurunica.com" className="underline">
              siparis@figurunica.com
            </a>
          </p>
        </div>
      </main>
    </LocaleProvider>
  );
}
