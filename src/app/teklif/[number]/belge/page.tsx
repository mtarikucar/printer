import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBankDetails } from "@/lib/config/payment";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { quoteApiEnabled, resolveQuoteAccess } from "@/lib/services/quote-access";
import { loadPresentedQuote } from "@/lib/services/quote-service";
import { QuoteDocumentPrintButton } from "./print-button";
import { QuoteDocument } from "./quote-document";
import "./belge.css";

/**
 * Teklif belgesi — `/teklif/T-000123/belge`.
 *
 * Erişim çalışma alanından DAHA DAR: sahip (giriş yapmış ya da anonim) ve
 * paylaşım bağlantısını GİRİŞ YAPARAK açan ziyaretçi. Oturumsuz paylaşım
 * ziyaretçisi çalışma alanına geri gönderilir — belge fiyat kapısının
 * arkasındaki tek çıktıdır ve fiyatsız bir "proforma" kimseye bir şey
 * anlatmaz; çalışma alanında ise kapıyı açan modal vardır.
 *
 * Fiyat kapısı ayrıca aşağıda tekrar UYGULANMAZ: `loadPresentedQuote` fiyat
 * alanlarını zaten ayıklar ve belge onları bulamazsa sütunları hiç çizmez.
 *
 * `noindex` kök düzenden gelir (`isNoindexPath("/teklif")`).
 */
export const dynamic = "force-dynamic";

export default async function QuoteDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ number }, query] = await Promise.all([params, searchParams]);

  if (!(await quoteApiEnabled())) notFound();

  const shareToken = typeof query.t === "string" ? query.t : null;
  const access = await resolveQuoteAccess(decodeURIComponent(number), { shareToken });
  if (!access) notFound();

  const { viewer } = access;
  // Admin de belgeyi görür: teklifi zaten fiyatlarıyla açabiliyor ve manuel
  // fiyatlama sırasında müşterinin eline geçecek çıktıyı okuması gerekir.
  const allowed = viewer.isOwner || viewer.isAdmin || (viewer.isShare && viewer.canSeePrices);
  if (!allowed) {
    redirect(
      `/teklif/${encodeURIComponent(decodeURIComponent(number))}${
        shareToken ? `?t=${encodeURIComponent(shareToken)}` : ""
      }`
    );
  }

  const quote = await loadPresentedQuote(access);
  const d = getDictionary(await getLocale());

  return (
    <div className="quote-doc-page">
      <div className="quote-doc-bar no-print">
        <Link
          href={`/teklif/${encodeURIComponent(quote.number)}${
            shareToken ? `?t=${encodeURIComponent(shareToken)}` : ""
          }`}
          className="btn-secondary !px-4 !py-2 text-xs"
        >
          {d["instantQuote.checkout.backToQuote"]}
        </Link>
        <QuoteDocumentPrintButton />
      </div>

      <QuoteDocument quote={quote} bank={getBankDetails()} />
    </div>
  );
}
