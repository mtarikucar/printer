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
