import { notFound, redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getBankDetails } from "@/lib/config/payment";
import { SiteHeader } from "@/components/site-header";
import { BankTransferInstructions } from "@/components/bank-transfer-instructions";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { Card } from "@/components/ui";

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
  const d = getDictionary(locale);
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
          <Card className="p-6 sm:p-8">
            <h1 className="text-2xl font-serif text-text-primary">
              {d["havale.page.title"]}
            </h1>
            <p className="text-text-secondary mt-1">
              {d["havale.page.reference"]}{" "}
              <span className="font-mono text-green-500">{draft.reference}</span>
            </p>
            <p className="text-sm text-text-muted mt-2">
              {d["havale.page.instructions"]}
            </p>
          </Card>

          <BankTransferInstructions
            orderNumber={draft.reference}
            bank={bank}
            finalAmountKurus={finalAmountKurus}
            deadline={draft.bankTransferDeadline?.toISOString() ?? null}
            receiptUploadedAt={draft.bankTransferReceiptUploadedAt?.toISOString() ?? null}
            receiptUrl={receiptUrl}
          />

          {ocrStatus === "scanning" && (
            <Card className="p-4 border-l-4 border-blue-500 text-sm text-blue-900 bg-blue-50">
              {d["havale.page.ocrScanning"]}
            </Card>
          )}

          {ocrStatus === "high" && (
            <Card className="p-4 border-l-4 border-green-500 text-sm text-green-900 bg-green-50">
              {d["havale.page.ocrHigh"]}
            </Card>
          )}

          {(ocrStatus === "medium" || ocrStatus === "low") && (
            <Card className="p-4 border-l-4 border-amber-500 text-sm text-amber-900 bg-amber-50">
              {d["havale.page.ocrMedium"]}
            </Card>
          )}

          <p className="text-center text-xs text-text-muted">
            {d["havale.page.supportContact"]}{" "}
            <a href="mailto:siparis@figurunica.com" className="underline">
              siparis@figurunica.com
            </a>
          </p>
        </div>
      </main>
    </LocaleProvider>
  );
}
