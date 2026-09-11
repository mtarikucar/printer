import { z } from "zod";
import { PROVINCES } from "@/lib/data/turkey-address";

/**
 * Etki alanı (kapsama) doğrulaması — SAF modül.
 *
 * DB yok, `server-only` yok: admin harita editörü bir istemci bileşenidir ve
 * aynı normalizasyonu kaydetmeden önce çalıştırır; API route'u da aynısını
 * sunucuda tekrar uygular. İki taraf tek kaynaktan beslenmezse istemcide
 * geçerli görünen bir seçim sunucuda sessizce başka bir listeye dönüşür.
 */

const PROVINCE_SET = new Set<string>(PROVINCES);

/** Bilinen bir il adı mı? Partner profili il'i serbest metin olarak kabul ediyor. */
export function isKnownProvince(il: string | null | undefined): il is string {
  return !!il && PROVINCE_SET.has(il);
}

/**
 * Gelen listeyi güvenli hâle getirir: bilinmeyen adlar elenir, tekrarlar
 * temizlenir, Türkçe alfabetik sıraya girer. Sıra sabit olmalı — aksi hâlde
 * aynı seçim her kayıtta farklı dizilir ve "değişti mi?" karşılaştırması
 * (kirli durum uyarısı) yanlış pozitif verir.
 */
export function normalizeCoverage(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const il = raw.trim();
    if (PROVINCE_SET.has(il)) seen.add(il);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "tr"));
}

/**
 * Admin PATCH gövdesi. İki alan da OPSİYONEL, en az biri zorunlu: listedeki göz
 * düğmesi yalnız görünürlüğü değiştirir ve o partnerin tüm kapsama dizisini
 * geri göndermek zorunda kalmamalı (başka sekmedeki kaydedilmemiş bir düzenleme
 * sessizce ezilirdi).
 */
export const coverageBodySchema = z
  .object({
    coverageProvinces: z.array(z.string()).max(81).optional(),
    mapVisible: z.boolean().optional(),
  })
  .refine((b) => b.coverageProvinces !== undefined || b.mapVisible !== undefined, {
    message: "coverageProvinces veya mapVisible gerekli",
  });

export type CoverageBody = z.infer<typeof coverageBodySchema>;

/** Boyacı rotası yalnız görünürlük değiştirir — kapsama kolonu boyacıda yok. */
export const painterMapBodySchema = z.object({ mapVisible: z.boolean() });
