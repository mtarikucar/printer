/**
 * Katalog uçlarının ORTAK kabuğu: ret cevabı, şema hatası, önbellek tazeleme.
 *
 * Bu dosya bir rota DEĞİLDİR (`_` ön eki Next yönlendirmesinin dışında
 * bırakır); on bir rotanın birebir aynı üç satırı kopyalamaması için var.
 * Kopyalansaydı, ilk düzeltmede bazı uçlar tazelenir bazıları tazelenmezdi —
 * ve tazelenmeyen uç, açılış sayfasındaki "₺X'den başlayan" rakamını saatlerce
 * ESKİ katalogla göstermeye devam ederdi.
 */
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { firstIssueMessage } from "@/lib/validators/print-catalog";

/**
 * Katalog değişince NELERİN bayatladığı.
 *
 * `/3d-baski` ve `/3d-baski/malzemeler` fiyat ÇAPALARINI ("₺74'den başlayan")
 * bu katalogdan hesaplıyor ve `revalidate = 3600` ile önbellekleniyor; bu iki
 * satır olmadan yönetici malzeme fiyatını değiştirdiğinde vitrindeki rakam bir
 * saate kadar eski kalırdı. Admin ekranı da aynı sebeple tazelenir: istemci
 * `router.refresh()` çağırıyor ve sunucu bileşeni önbellekten okumamalı.
 */
export function revalidateCatalogSurfaces(): void {
  revalidatePath("/3d-baski");
  revalidatePath("/3d-baski/malzemeler");
  revalidatePath("/admin/baski-katalogu");
}

/** Zod hatası → 400 + TEK Türkçe cümle (alan adıyla). */
export function invalidBody(error: z.ZodError): NextResponse {
  return NextResponse.json(
    { error: firstIssueMessage(error), code: "invalid_body" },
    { status: 400 }
  );
}

/**
 * BEKLENEN ret (404 / 409 / 400) → kendi cümlesiyle cevap.
 *
 * `catch` bloğunda DEĞİL, akışın içinde çağrılır: beklenmeyen arıza için
 * `handleRouteFailure` tek başına kalsın (depo genelindeki "boş gövdeli 500
 * imkânsız" taraması yalnız o şekli tanıyor).
 */
export function catalogRefusal(outcome: { status: number; code: string; error: string }) {
  return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
}

/** `[id]` segmenti gerçekten bir uuid mi (servise gitmeden önce). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCatalogId(raw: string): string | null {
  const value = raw.trim();
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

export const NOT_FOUND_RESPONSE = () =>
  NextResponse.json({ error: "Kayıt bulunamadı.", code: "not_found" }, { status: 404 });
