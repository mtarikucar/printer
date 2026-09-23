import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { quoteApiEnabled, resolveQuoteAccess } from "@/lib/services/quote-access";
import { loadPresentedQuote } from "@/lib/services/quote-service";
import { QuoteWorkspaceClient } from "./workspace-client";

/**
 * Teklif çalışma alanı — sunucu tarafı kabuğu.
 *
 * Sayfanın TEK işi erişimi çözmek ve teklifi sunucuda serileştirmektir:
 *   - `resolveQuoteAccess` numarayı (ya da uuid'yi) satıra çevirir, hakkı
 *     oturum / anonim çerez / `?t=` paylaşım token'ı verir. Hak yoksa
 *     `notFound()` — "var ama senin değil" bilgisi bile sızmaz.
 *   - `loadPresentedQuote` fiyat kapısını uygular; ÇIKTISI OLDUĞU GİBİ
 *     istemciye geçer. Burada bir alan seçilip kopyalansaydı, fiyat kapısı
 *     ikinci bir yerde daha uygulanmış olurdu (bir gün biri unutur).
 *
 * `noindex` kök düzenden gelir (`isNoindexPath("/teklif")`, 3.1).
 */
export const dynamic = "force-dynamic";

export default async function QuoteWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ number }, query] = await Promise.all([params, searchParams]);

  // Bayrak kapalıyken sayfa YOK gibi davranır (admin oturumu iç test için
  // geçer) — uçlarla aynı kapı (`quoteApiEnabled`).
  if (!(await quoteApiEnabled())) notFound();

  const shareToken = typeof query.t === "string" ? query.t : null;
  // Next dinamik parçayı ZATEN çözer; ikinci bir çözüm `T-000123%` gibi bir
  // adreste `URIError` fırlatır ve ziyaretçi 404 yerine 500 görür. Erişim
  // çözümü uuid ya da `T-` numarası olmayan her şeyi sorgusuz reddeder.
  const access = await resolveQuoteAccess(number, { shareToken });
  if (!access) notFound();

  const quote = await loadPresentedQuote(access);

  return (
    <>
      <SiteHeader />
      <QuoteWorkspaceClient initialQuote={quote} shareToken={shareToken} />
    </>
  );
}
