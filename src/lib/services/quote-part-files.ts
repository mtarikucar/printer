/**
 * Teklif parçası DOSYALARININ tek sorusu: BU ANAHTARI HÂLÂ GÖSTEREN BİR SATIR
 * VAR MI?
 *
 * `photo-file-retention.ts` ile aynı desen ve aynı sebep: aynı depolama
 * anahtarı birden çok satıra MEŞRU olarak bağlanır — `duplicatePart` kopyaya
 * kaynağın anahtarlarını aynen verir (`quote-service.ts`), `splitByTechnology`
 * satırı başka bir teklife taşır. Yalnız kendi satırına bakan bir silici
 * ötekinin parçasını dosyasız bırakır; bu yüzden silen üç yol da (yeniden
 * analiz, saklama süpürmesi, yetim dizin süpürmesi) aynı soruyu buradan sorar.
 *
 * Sipariş dosyaları bu sorunun DIŞINDADIR: teklif→sipariş devri parçanın
 * dosyasını `models/<orderId>/` altına İKİNCİ bir adla bağlar
 * (`linkOrCopyStoredFile`), yani `quote-parts/…` adını silmek siparişin
 * kopyasını okunur bırakır (`storage.ts`, sabit bağ notu).
 *
 * SAF SERVİS: `import "server-only"` YOK ve girmemeli — hem analiz worker'ı hem
 * bakım worker'ı bu modülü standalone Node altında yükler.
 */
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { quoteParts } from "@/lib/db/schema";

/**
 * Parça dosyalarının depolama öneki.
 *
 * Bu önek altına yazan HER yol parçanın kimliğini klasör adı yapar:
 * `addPart` (kaynak dosya), `copyPartInto` (kütüphane/yeniden teklif kopyası),
 * `setDrawing` (teknik çizim) ve `storeAnalysisOutputs` (kanonik STL, önizleme,
 * küçük resim). Yetim dizin süpürmesi tam olarak bu sözleşmeye dayanır.
 */
export const QUOTE_PART_KEY_PREFIX = "quote-parts";

/** Parçanın diskte yer tutan bütün anahtar kolonları. */
const PART_KEY_COLUMNS = [
  quoteParts.sourceKey,
  quoteParts.canonicalStlKey,
  quoteParts.previewGlbKey,
  quoteParts.thumbnailKey,
  quoteParts.drawingKey,
];

export interface QuotePartKeyScope {
  /**
   * Bu parçanın kendi satırı referans SAYILMAZ.
   *
   * Saklama süpürmesi kendi sildiği parçayı dışarıda tutmak için verir; yeniden
   * analiz vermez, çünkü satır o an ZATEN yeni anahtarları taşıyor (eski anahtar
   * hâlâ görünüyorsa bu gerçek bir referanstır).
   */
  excludePartId?: string;
}

/**
 * Bu anahtarı gösteren (henüz süpürülmemiş) bir parça satırı var mı?
 *
 * Süpürülmüş satır (`files_purged_at`) referans SAYILMAZ: dosyası zaten
 * silinmiş bir parçanın anahtarı, hayatta kalan bir dosyayı sonsuza dek
 * korumamalı.
 */
export async function quotePartKeyReferenced(
  key: string,
  scope: QuotePartKeyScope = {}
): Promise<boolean> {
  const [row] = await db
    .select({ id: quoteParts.id })
    .from(quoteParts)
    .where(
      and(
        scope.excludePartId ? ne(quoteParts.id, scope.excludePartId) : undefined,
        isNull(quoteParts.filesPurgedAt),
        or(...PART_KEY_COLUMNS.map((column) => eq(column, key)))
      )
    )
    .limit(1);
  return row !== undefined;
}

/**
 * `quote-parts/<dirName>/` altındaki bir dosyayı gösteren HERHANGİ bir satır
 * var mı?
 *
 * Yetim dizin süpürmesinin emniyet kemeri: dizin adı hiçbir parçanın kimliği
 * olmasa bile, içindeki bir dosyayı BAŞKA bir satır gösteriyor olabilir
 * (`duplicatePart` anahtarı paylaşır). Burada SÜPÜRÜLMÜŞ satırlar da sayılır —
 * bir dizini silmek geri alınamaz, dolayısıyla ölçü en geniş hâliyle kurulur.
 *
 * `LIKE` değil `position()`: nanoid dosya adları `_` içerebilir ve `LIKE`ta `_`
 * joker olurdu (`photo-file-retention.ts` ile aynı gerekçe).
 */
export async function quotePartKeysExistUnder(dirName: string): Promise<boolean> {
  const prefix = `${QUOTE_PART_KEY_PREFIX}/${dirName}/`;
  const [row] = await db
    .select({ id: quoteParts.id })
    .from(quoteParts)
    .where(
      or(
        ...PART_KEY_COLUMNS.map(
          (column) => sql`position(${prefix} in coalesce(${column}, '')) = 1`
        )
      )
    )
    .limit(1);
  return row !== undefined;
}
