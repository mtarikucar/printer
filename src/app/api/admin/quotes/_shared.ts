/**
 * `/api/admin/quotes/**` uçlarının ortak kabuğu.
 *
 * Bu dosya bir ROTA DEĞİLDİR (`_` ön eki App Router'ın dışında bırakır); beş
 * karar ucunun aynı dört satırı (kimlik doğrulama, kimlik ayrıştırma, beklenen
 * ret cevabı, gövde okuma) kopyalamaması için var. Kopyalansaydı ilk
 * düzeltmede bazı uçlar kapıyı yeniden yorumlardı.
 *
 * Beklenen retler `catch` bloğunda DEĞİL akışın içinde cevaba çevrilir: depo
 * genelindeki "boş gövdeli 500 imkânsız" taraması (`test-order-status-policy`)
 * rotanın `catch`inde yalnız `handleRouteFailure` görmek ister.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, type AdminSession } from "@/lib/auth/require-admin";
import type { AdminQuoteOutcome } from "@/lib/services/quote-admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function adminQuoteNotFound(): NextResponse {
  return NextResponse.json({ error: "Teklif bulunamadı.", code: "not_found" }, { status: 404 });
}

/**
 * Admin oturumu + `[id]` segmenti.
 *
 * Kimlik uuid değilse servise HİÇ gidilmez: `quotes.id` bir uuid kolonudur ve
 * `T-000123` gibi bir değer sorguyu `22P02` ile düşürürdü (gövdesiz 500).
 */
export async function adminQuoteContext(
  ctx: { params: Promise<{ id: string }> }
): Promise<{ session: AdminSession; quoteId: string } | { response: NextResponse }> {
  const a = await requireAdmin();
  if ("response" in a) return { response: a.response };
  const { id } = await ctx.params;
  const quoteId = id.trim();
  if (!UUID_RE.test(quoteId)) return { response: adminQuoteNotFound() };
  return { session: a.session, quoteId: quoteId.toLowerCase() };
}

/** Servis sonucunu cevaba çevirir (beklenen ret → kendi cümlesi). */
export function outcomeResponse(outcome: AdminQuoteOutcome): NextResponse {
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
  }
  return NextResponse.json({
    success: true,
    quoted: outcome.quoted,
    blockers: outcome.blockers,
  });
}

/** Gövdeyi JSON olarak okur; bozuk gövde boş nesne sayılır (şema reddeder). */
export async function adminJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  const raw = await request.json().catch(() => ({}));
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
}
