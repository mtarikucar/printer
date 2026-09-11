/**
 * Hakediş tabanlarının TEK türetim noktası.
 *
 * Üreticinin tabanı bu değişiklikten önce beş ayrı yerde elle hesaplanıyordu
 * (send-to-painter, assign-painter, revoke-after-painter, manufacturer ship ve
 * üreticinin sipariş detay ekranı). Ekran kendi hesabını siparişin durumundan
 * değil üreticinin `paintsInHouse` profil bayrağından yaptığı için, işi
 * boyacıya devreden "kendim boyarım" üreticisi kartında hâlâ TÜM tutarın
 * payını görüyordu; aynı boyama payı boyacının panelinde de vaat ediliyordu.
 * Kopyaları tek fonksiyona indirmek o sınıf hatayı kapatır.
 *
 * Saf modül — DB yok, `server-only` yok (order-draft.ts üzerinden BullMQ
 * worker'ları da bu zinciri import eder).
 */

export interface EarningBaseOrder {
  /** Siparişin brüt tutarı (indirim öncesi). */
  amountKurus: number;
  /**
   * Kalem kırılımından yazılan üretim tabanı. NULL = kırılımı olmayan ESKİ
   * sipariş; bu durumda değişiklik öncesi kural birebir uygulanır.
   */
  productionBaseKurus: number | null;
  /** Boyacının hakediş tabanı (kalem kırılımının boyama toplamı). */
  paintingPriceKurus: number;
}

/**
 * Üreticinin hakediş tabanı.
 *
 * `painterId` + `paintsInHouse`, boyama işini FİİLEN kimin yaptığını söyler:
 * bir boyacıya devredilmişse boyama payı üreticinin değildir; üretici kendi
 * atölyesinde boyayıp kargoluyorsa payın tamamı onundur.
 */
export function manufacturerBaseKurus(
  order: EarningBaseOrder & {
    /** Sipariş bir boyacıya devredilmişse o boyacının id'si. */
    painterId: string | null;
    /** Üretici "kendim boyarım" işaretli mi. */
    paintsInHouse: boolean;
  }
): number {
  const handedOff = order.painterId !== null;
  const paintsItself = !handedOff && order.paintsInHouse;

  if (order.productionBaseKurus !== null) {
    // Kalem kırılımı var: taban açıkça yazılmış. Üretici kendi boyuyorsa
    // boyama kalemi de ona yazılır (o işi yapan o).
    return paintsItself
      ? order.productionBaseKurus + order.paintingPriceKurus
      : order.productionBaseKurus;
  }

  // Kırılımsız (eski) sipariş — değişiklik öncesi kural birebir korunur.
  if (order.paintingPriceKurus > 0 && !paintsItself) {
    return Math.max(0, order.amountKurus - order.paintingPriceKurus);
  }
  return order.amountKurus;
}

/**
 * Boyacının hakediş tabanı. Kırılımlı ya da kırılımsız, her iki modelde de
 * `paintingPriceKurus`'tur — kırılımlı siparişte bu kolon zaten boyama
 * kalemlerinin toplamıdır.
 */
export function painterBaseKurus(order: EarningBaseOrder): number {
  return Math.max(0, order.paintingPriceKurus);
}

/**
 * Bir siparişin boyacı hattına girip girmeyeceği. `needsPainting` kolonu bu
 * ifadeden yazılır — böylece manuel / WhatsApp / ürün siparişleri de boyacıya
 * yönlendirilebilir (önceden yalnızca web checkout'taki figür siparişleri
 * bayrağı alıyor, diğerleri kalıcı olarak boyacı hattının dışında kalıyordu).
 */
export function orderNeedsPainting(paintingPriceKurus: number): boolean {
  return paintingPriceKurus > 0;
}

export type CarvePaintingResult =
  | {
      ok: true;
      /** Ayrılmadan önceki üretim tabanı (kırılımsız eski siparişte tutarın kendisi). */
      productionBefore: number;
      productionAfter: number;
      paintingAfter: number;
    }
  | { ok: false; reason: "invalid_amount" | "exceeds_production" };

/**
 * Boyama kalemi olmadan satılmış bir siparişte boyacı payını ÜRETİM payından
 * ayırır. Müşterinin ödediği toplam değişmez; iki tabanın toplamı ayırmadan
 * önceki toplama eşit kalır (kalem invariant'ı).
 *
 * Admin route'u (/api/admin/orders/[id]/add-painting) ve admin ekranındaki
 * canlı önizleme AYNI fonksiyonu çağırır: ekranda görülen bölüşüm sunucunun
 * yazacağıyla birebir aynı olmalı.
 */
export function carvePaintingShare(
  order: EarningBaseOrder,
  paintingKurus: number
): CarvePaintingResult {
  if (!Number.isInteger(paintingKurus) || paintingKurus <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  const productionBefore = order.productionBaseKurus ?? order.amountKurus;
  // Üretim payı sıfıra inemez: üretici hâlâ basıyor, bedelsiz iş olmaz.
  if (paintingKurus >= productionBefore) return { ok: false, reason: "exceeds_production" };
  return {
    ok: true,
    productionBefore,
    productionAfter: productionBefore - paintingKurus,
    paintingAfter: order.paintingPriceKurus + paintingKurus,
  };
}

/**
 * Siparişin ÜRETİM kalemi toplamı — boyamayı kimin yaptığından bağımsız.
 *
 * Kırılımlı siparişte kayıtlı `productionBaseKurus`; kırılımsız (eski)
 * siparişte eski kural: tutar − boyama. Tanım gereği, boyama işi başkasına
 * aitken `manufacturerBaseKurus`'un döndürdüğü tabanın AYNISIDIR (bkz.
 * scripts/test-order-money.ts'teki eşitlik testi) — para dökümü ekranı
 * "üretim payı" satırını buradan okur, böylece kendi kopyasını türetmez.
 */
export function effectiveProductionBaseKurus(order: EarningBaseOrder): number {
  if (order.productionBaseKurus !== null) return order.productionBaseKurus;
  return Math.max(0, order.amountKurus - order.paintingPriceKurus);
}

export interface OrderMoneySplit {
  /** Üretim kalemi toplamı (kırılımsız siparişte eski kuralla türetilmiş). */
  productionBaseKurus: number;
  /** Boyama kalemi toplamı (`paintingPriceKurus`). */
  paintingBaseKurus: number;
  /** Üreticinin hakediş tabanı — `manufacturerBaseKurus` ile birebir. */
  manufacturerBaseKurus: number;
  /**
   * Boyacının hakediş tabanı. Üretici işi kendi atölyesinde boyuyorsa 0: o
   * pay zaten üreticinin tabanında. Aynı boyama payını iki partnere birden
   * vaat etmek, kalem modelinin kapatmak için var olduğu hata sınıfıdır.
   */
  painterBaseKurus: number;
  /** Üretici boyamayı kendisi yapıyor (devredilmemiş + "kendim boyarım"). */
  paintsItself: boolean;
  /** `productionBaseKurus` NULL — kalem modelinden önceki sipariş. */
  legacySplit: boolean;
  /** Üretim + boyama === sipariş tutarı (kalem invariant'ı). */
  splitMatches: boolean;
}

/**
 * Bir siparişin iki hakediş tabanına bölünüşü — admin para dökümü, partner
 * ekranları ve testler aynı fonksiyonu çağırır. Yalnızca bu dosyadaki
 * türetimleri birleştirir; yeni bir para kuralı İÇERMEZ. Komisyon burada
 * yoktur: taban × oran hesabı `computeEarning`'in (services/finance.ts) işidir.
 */
export function orderMoneySplit(
  order: EarningBaseOrder & { painterId: string | null; paintsInHouse: boolean }
): OrderMoneySplit {
  const paintsItself = order.painterId === null && order.paintsInHouse;
  const productionBaseKurus = effectiveProductionBaseKurus(order);
  return {
    productionBaseKurus,
    paintingBaseKurus: order.paintingPriceKurus,
    manufacturerBaseKurus: manufacturerBaseKurus(order),
    painterBaseKurus: paintsItself ? 0 : painterBaseKurus(order),
    paintsItself,
    legacySplit: order.productionBaseKurus === null,
    splitMatches: productionBaseKurus + order.paintingPriceKurus === order.amountKurus,
  };
}
