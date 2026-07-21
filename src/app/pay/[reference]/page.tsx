import { notFound } from "next/navigation";
import { findDraftByReference } from "@/lib/services/order-draft";
import { getBankDetails } from "@/lib/config/payment";
import { getPublicUrl } from "@/lib/services/storage";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui";
import { getLocale } from "@/lib/i18n/get-locale";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import {
  WHATSAPP_DISPLAY,
  buildWhatsAppUrl,
} from "@/lib/config/contact";
import { WhatsAppIcon } from "@/components/whatsapp/whatsapp-button";
import { PayCardButton } from "./pay-card-button";
import { PayConsentGate } from "./pay-consent-gate";

export const dynamic = "force-dynamic";

function fmt(kurus: number): string {
  return `₺${(kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-12 space-y-6">{children}</div>
    </main>
  );
}

export default async function PayPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const locale = await getLocale();

  const draft = await findDraftByReference(reference);
  if (!draft) notFound();

  const finalAmountKurus =
    draft.amountKurus - draft.giftCardAmountKurus - draft.havaleDiscountKurus;

  const lines =
    draft.selectedAddons && draft.selectedAddons.length > 0
      ? draft.selectedAddons
      : [{ name: draft.productTitleSnapshot || "Sipariş", priceKurus: finalAmountKurus }];

  // Already paid → send to tracking.
  if (draft.status === "confirmed") {
    return (
      <LocaleProvider locale={locale}>
        <Shell>
          <Card className="p-6 sm:p-8 text-center">
            <h1 className="text-2xl font-serif text-text-primary">
              Bu sipariş zaten ödendi
            </h1>
            <p className="text-text-secondary mt-2">
              Sipariş numaranız:{" "}
              <span className="font-mono text-green-500">{draft.reference}</span>
            </p>
            <a
              href={`/track/${draft.reference}`}
              className="mt-5 inline-block rounded-full bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
            >
              Siparişi takip et
            </a>
          </Card>
        </Shell>
      </LocaleProvider>
    );
  }

  // Expired / failed / cancelled → link is no longer valid.
  const isPayable = draft.status === "pending" || draft.status === "awaiting_review";
  if (!isPayable) {
    return (
      <LocaleProvider locale={locale}>
        <Shell>
          <Card className="p-6 sm:p-8 text-center">
            <h1 className="text-2xl font-serif text-text-primary">
              Bu ödeme bağlantısı artık geçerli değil
            </h1>
            <p className="text-text-secondary mt-2">
              Lütfen bizimle WhatsApp üzerinden iletişime geçin; size yeni bir
              bağlantı gönderelim.
            </p>
            <a
              href={buildWhatsAppUrl(
                `Merhaba, ${draft.reference} numaralı siparişimin ödeme bağlantısı geçersiz görünüyor.`
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#1ebe5d]"
            >
              <WhatsAppIcon className="h-5 w-5" />
              WhatsApp ile iletişime geç
            </a>
          </Card>
        </Shell>
      </LocaleProvider>
    );
  }

  const bank = getBankDetails();

  return (
    <LocaleProvider locale={locale}>
      <Shell>
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-serif text-text-primary">Siparişinizi tamamlayın</h1>
          <p className="text-sm text-text-muted mt-1">
            Sipariş No:{" "}
            <span className="font-mono text-green-500">{draft.reference}</span>
          </p>

          <div className="mt-5 divide-y divide-bg-subtle border-y border-bg-subtle">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-sm text-text-secondary">{l.name}</span>
                <span className="font-mono text-sm text-text-primary">
                  {fmt(l.priceKurus)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-text-secondary">Toplam</span>
            <span className="text-xl font-bold text-text-primary">
              {fmt(finalAmountKurus)}
            </span>
          </div>
        </Card>

        {draft.photoKeys && draft.photoKeys.length > 0 && (
          <Card className="p-6 sm:p-8">
            <h2 className="text-lg font-serif text-text-primary">
              Sipariş fotoğrafları
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              Siparişiniz için ilettiğiniz görseller. Yanlış bir görsel varsa
              ödeme öncesi bizimle iletişime geçin.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {draft.photoKeys.map((key, i) => (
                <a
                  key={i}
                  href={getPublicUrl(key)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-28 w-28 overflow-hidden rounded-xl border border-bg-subtle"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getPublicUrl(key)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </a>
              ))}
            </div>
          </Card>
        )}

        <PayConsentGate reference={draft.reference}>
        {draft.paymentMethod === "card" && draft.status === "pending" ? (
          <Card className="p-6 sm:p-8 space-y-3">
            <h2 className="text-lg font-serif text-text-primary">Kart ile öde</h2>
            <p className="text-sm text-text-secondary">
              Güvenli ödeme sayfasına yönlendirileceksiniz (PayTR).
            </p>
            <PayCardButton reference={draft.reference} />
          </Card>
        ) : (
          <Card className="p-6 sm:p-8 border-l-4 border-amber-500 space-y-4">
            <div>
              <h2 className="text-lg font-serif text-text-primary">
                Havale / EFT ile öde
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                Aşağıdaki hesaba ödeme yapın ve açıklamaya sipariş numaranızı yazın.
              </p>
            </div>
            <div className="rounded-xl bg-bg-elevated p-4 sm:p-5 space-y-2 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wide text-text-muted">
                  Tutar
                </span>
                <span className="font-mono text-2xl font-bold text-green-500">
                  {fmt(finalAmountKurus)}
                </span>
              </div>
              {bank.bankName && (
                <Row label="Banka" value={bank.bankName} />
              )}
              {bank.iban && <Row label="IBAN" value={bank.iban} />}
              {bank.accountHolder && (
                <Row label="Hesap Sahibi" value={bank.accountHolder} />
              )}
              {bank.branch && <Row label="Şube" value={bank.branch} />}
              <Row label="Açıklama / Referans" value={draft.reference} />
            </div>
            <a
              href={buildWhatsAppUrl(
                `Merhaba, ${draft.reference} numaralı siparişimin havale dekontunu iletiyorum.`
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1ebe5d]"
            >
              <WhatsAppIcon className="h-5 w-5" />
              Dekontu WhatsApp&apos;tan gönder
            </a>
            <p className="text-xs text-text-muted">
              Ödemeniz onaylandığında siparişiniz işleme alınır.
            </p>
          </Card>
        )}
        </PayConsentGate>

        <p className="text-center text-xs text-text-muted">
          Soru mu var? WhatsApp: {WHATSAPP_DISPLAY}
        </p>
      </Shell>
    </LocaleProvider>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs uppercase tracking-wide text-text-muted">{label}</span>
      <span className="font-mono text-text-primary break-all text-right">{value}</span>
    </div>
  );
}
