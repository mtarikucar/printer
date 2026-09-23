/**
 * Teklifin LİSTE/RAPOR ÖNBELLEĞİ: `quotes.total_kurus`, `quotes.lead_days`,
 * `quotes.version`.
 *
 * Neden ayrı, küçük bir modül: analiz worker'ı (`quote-analysis.ts`) da, teklif
 * servisi (`quote-service.ts`) de aynı yeniden hesabı yapmak zorunda. Servis
 * worker'ı, worker servisi import etseydi döngü olurdu; hesabın tek sahibi bu
 * dosyadır ve fiyat yine tek giriş noktasından (`computeQuote`) gelir.
 *
 * ÖNBELLEK, KAYNAK DEĞİL: müşteriye gösterilen ve ödemede doğrulanan tutar her
 * zaman `computeQuote`'tan taze hesaplanır. Buradaki kolonlar yalnız liste,
 * admin ekranı ve raporlar içindir.
 *
 * NOT: `import "server-only"` YOK — BullMQ worker süreci bu modülü yükler.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { quoteParts, quotes, type QuotePart } from "@/lib/db/schema";
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import { computeQuote } from "@/lib/config/quote-compute";
import type { ComputedQuote, PricingPartInput } from "@/lib/config/quote-types";

/**
 * Parça satırını fiyat çekirdeğinin girdisine çevirir ve manuel fiyatı
 * DOĞRULAR.
 *
 * Tek dönüşüm noktası: kolonlardan `PartConfig` kuran ikinci bir kopya, bir gün
 * bir alanı unutup müşteriye başka, ödemede başka fiyat gösterirdi.
 *
 * Manuel fiyat tek "dışarıdan gelen para"dır: admin yazar, kolon `integer`
 * olduğu için aralık kontrolü DB'de YOKTUR (CHECK yok) ve yanlış bir satır (0,
 * negatif, ondalık ya da ₺2.000.000 üstü) doğrudan gösterilen VE tahsil edilen
 * tutara dönüşürdü. Kapı `computeQuote`'un ÖNÜNDE, ortak çeviricide durur:
 * `recomputeQuoteCache` bu işlevi doğrudan çağırır ve ikinci bir sarmalayıcıya
 * uğramaz, yani kapı yalnız `toPricingInputs`ta olsaydı önbellekteki toplam
 * ödemede tahsil edilenden sapabilirdi. Geçersiz değer SESSİZCE DÜŞER
 * (anahtarıyla birlikte): parça "manuel fiyat bekliyor" hâline döner, ki bu
 * yanlış bir fiyattan iyidir.
 */
export function toPricingPartInput(part: QuotePart): PricingPartInput {
  const manual = part.manualUnitPriceKurus;
  const manualUsable =
    manual !== null && Number.isSafeInteger(manual) && manual > 0 && manual <= MAX_AMOUNT_KURUS;

  return {
    id: part.id,
    analysisStatus: part.analysisStatus,
    geometry: part.geometry,
    sourceSha256: part.sourceSha256,
    config: {
      technologyKey: part.technologyKey,
      materialKey: part.materialKey,
      colorKey: part.colorKey,
      finishKey: part.finishKey,
      layerUm: part.layerUm,
      infillPct: part.infillPct,
      quantity: part.quantity,
      units: part.units,
      scale: part.scale,
      criticalTolerance: part.criticalTolerance,
    },
    manualUnitPriceKurus: manualUsable ? manual : null,
    manualPriceKey: manualUsable ? part.manualPriceKey : null,
    dfmAckKey: part.dfmAckKey,
  };
}

export interface QuoteCacheResult {
  version: number;
  totalKurus: number | null;
  leadDays: number | null;
  computed: ComputedQuote;
}

/** Çağıranın kendi işlemi (Task 2.4 yeniden hesabı kendi yazımına katabilsin). */
export type QuoteCacheTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Yeniden hesabın gövdesi: teklif satırı `FOR UPDATE` ile KİLİTLİ okunur.
 *
 * Kilit ilk ifadedir, çünkü asıl tehlike okumayla yazma arasındaki boşluktur:
 * A parçaları okur (biri hâlâ `analyzing`, toplam NULL), B okur (hepsi hazır,
 * doğru toplamı yazar), sonra A kendi bayat NULL'ını B'nin üzerine yazardı.
 * Teklif kilitli olduğu için ikinci gelen HER ZAMAN birincinin bıraktığı
 * parçaları görür. Bu kolon ödemede `expectedTotalKurus` ile karşılaştırılıyor:
 * bayat bir toplam, müşteriye sebepsiz 409 demektir.
 */
async function recomputeInTx(
  tx: QuoteCacheTx,
  quoteId: string
): Promise<QuoteCacheResult | null> {
  const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
  if (!quote) return null;

  const parts = await tx
    .select()
    .from(quoteParts)
    .where(and(eq(quoteParts.quoteId, quoteId), isNull(quoteParts.deletedAt)))
    .orderBy(quoteParts.sortOrder);

  const computed = computeQuote(quote.pricingSnapshot, parts.map(toPricingPartInput), {
    leadTier: quote.leadTier,
    addonKeys: quote.addonKeys,
  });

  // Kolon `integer`dır, motorun toplamı ise 2^31'i AŞABİLİR (baskı zarfında iki
  // SLA parçası × 1000 adet yeter). Kıstırma olmadan Postgres 22003 verir ve
  // yeniden hesabın işlemi çöker; en kötü düşüş noktası analiz worker'ıdır —
  // parça `ready` commit edilmiş olur, `failed` yazımı koşuluna takılır, iş
  // "skipped" deyip BAŞARIYLA biter ve o teklife yapılan her sonraki yazım
  // 500 verir. Burası GÖSTERİM önbelleğidir (bkz. dosya başlığı): ödenebilir
  // tavanın (`MAX_AMOUNT_KURUS`, ödeme servisinde uygulanır) üstündeki bir
  // sayının listede durmasının hiçbir anlamı yok, NULL doğru cevaptır.
  const payable =
    computed.totals.allPriced &&
    Number.isSafeInteger(computed.totals.totalKurus) &&
    computed.totals.totalKurus <= MAX_AMOUNT_KURUS;
  const totalKurus = payable ? computed.totals.totalKurus : null;
  const leadDays = payable ? computed.totals.leadDays : null;

  const [updated] = await tx
    .update(quotes)
    .set({
      totalKurus,
      leadDays,
      version: sql`${quotes.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId))
    .returning({ version: quotes.version });

  return { version: updated?.version ?? quote.version, totalKurus, leadDays, computed };
}

/**
 * Teklifi yeniden hesaplar ve önbellek kolonlarını yazar; `version` bir artar.
 *
 * Fiyatlanamayan teklifte (`allPriced` değil) tutar ve iş günü NULL kalır:
 * yarım bir toplam, listede tam bir fiyat gibi okunurdu. Ödenebilir tavanın
 * (`MAX_AMOUNT_KURUS`) üstündeki toplam da NULL yazılır — hem kolon `integer`
 * olduğu için (2^31 üstü toplam işlemi çökertirdi) hem de tahsil edilemeyecek
 * bir sayının gösterim önbelleğinde işi yok.
 *
 * Teklif yoksa null döner — silinmiş/erişilemez bir teklif için analiz
 * tamamlanması worker'ı düşürmemeli.
 *
 * `tx` VERİLİRSE hesap o işlemin içinde yapılır ve commit çağıranındır: aynı
 * teklifi kendi işleminde kilitlemiş bir çağıranın (Task 2.4) burada İKİNCİ bir
 * bağlantı açması kendi kilidine takılırdı. `tx` yoksa modül kendi işlemini
 * açar — worker'ın çağrısı böyle gelir.
 */
export async function recomputeQuoteCache(
  quoteId: string,
  tx?: QuoteCacheTx
): Promise<QuoteCacheResult | null> {
  if (tx) return recomputeInTx(tx, quoteId);
  return db.transaction(async (own) => {
    // Kilit beklemesi sonsuz olmasın: takılan bir işlem işi geri versin, iş
    // yeniden denensin (ev deseni: `order-money-edit.ts`).
    await own.execute(sql`SET LOCAL lock_timeout = '5s'`);
    return recomputeInTx(own, quoteId);
  });
}
