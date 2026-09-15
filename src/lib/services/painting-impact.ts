import { and, desc, eq, isNull, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerEarnings, orders } from "@/lib/db/schema";
import { manufacturerBaseKurus } from "@/lib/services/earning-base";

/**
 * "Kendi boyama" bayrağının ELDEKİ siparişlerdeki PARA etkisi — tek kaynak.
 *
 * Bayrağı iki taraf da çevirebiliyor: admin (/api/admin/manufacturers/[id]) ve
 * partnerin kendisi (/api/manufacturer/auth/profile). İkisi de aynı rakamı
 * söylemek zorunda, çünkü ikisi de aynı kapıyı işletiyor: etkilenen sipariş
 * varsa ayrı onay olmadan kayıt YOK (409).
 *
 * Neden `src/lib/services` — bu iki fonksiyon admin rota MODÜLÜNDE duruyordu ve
 * partner ucu oradan import ediyordu; yani bir üreticinin kendi profil isteği
 * `requireAdmin`/next-auth yığınını da yüklüyordu. Yığın çalışma anında
 * ÇAĞRILMIYORDU (401 riski yoktu) ama partner isteğinin admin kimlik doğrulama
 * koduna hiç dokunmaması gereken bir sınır var; ortak hesap artık iki tarafın da
 * altında, kimsenin rotasında değil.
 */

/** En fazla kaç siparişi tek tek listeleriz (sayaç ve toplam yine tamdır). */
const IMPACT_LIST_LIMIT = 25;

const tl = (kurus: number) =>
  `₺${(kurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface PaintingImpactOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  currentBaseKurus: number;
  nextBaseKurus: number;
  /** Negatif = üreticinin payı azalır. */
  deltaKurus: number;
}

export interface PaintingImpact {
  count: number;
  totalDeltaKurus: number;
  orders: PaintingImpactOrder[];
  /** Liste kırpıldı mı (sayı ve toplam kırpılmamıştır). */
  truncated: boolean;
}

/**
 * "Kendi boyar" bayrağı `from` → `to` olarak değişirse, ELDEKİ hangi siparişte
 * üreticinin hakediş tabanı ne kadar değişir.
 *
 * Kapsam kasıtlı olarak dar: yalnız boyama kalemi olan (needsPainting),
 * HENÜZ bir boyacıya devredilmemiş (painterId NULL — devredilmişse taban zaten
 * bayraktan bağımsız), kapanmamış ve hakedişi HENÜZ TAHAKKUK ETMEMİŞ
 * siparişler. Tahakkuk etmiş satır donmuştur (manufacturer_earnings.order_id
 * UNIQUE), bayrak onu artık değiştiremez.
 *
 * Rakam elle hesaplanmaz: kargo ucunun kullandığı `manufacturerBaseKurus`
 * çağrılır, yani ekranda yazan tutar ile ödenecek tutar aynı fonksiyondan
 * gelir.
 */
export async function paintingImpact(
  manufacturerId: string,
  from: boolean,
  to: boolean
): Promise<PaintingImpact> {
  if (from === to) return { count: 0, totalDeltaKurus: 0, orders: [], truncated: false };

  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      amountKurus: orders.amountKurus,
      productionBaseKurus: orders.productionBaseKurus,
      paintingPriceKurus: orders.paintingPriceKurus,
    })
    .from(orders)
    .leftJoin(manufacturerEarnings, eq(manufacturerEarnings.orderId, orders.id))
    .where(
      and(
        eq(orders.manufacturerId, manufacturerId),
        eq(orders.needsPainting, true),
        isNull(orders.painterId),
        // Yola çıkmış / kapanmış sipariş: bayrak artık ödemesini değiştirmez.
        notInArray(orders.status, ["shipped", "delivered", "rejected"]),
        // Anti-join: hakedişi yazılmış sipariş donmuştur.
        isNull(manufacturerEarnings.id)
      )
    )
    .orderBy(desc(orders.createdAt));

  const affected: PaintingImpactOrder[] = [];
  let totalDeltaKurus = 0;
  for (const r of rows) {
    // İade edilmiş sipariş SQL'de değil burada elenir: paymentStatus NULL
    // olabilen bir kolon ve `<> 'refunded'` NULL satırları da düşürürdü.
    if (r.paymentStatus === "refunded") continue;
    const base = {
      amountKurus: r.amountKurus,
      productionBaseKurus: r.productionBaseKurus,
      paintingPriceKurus: r.paintingPriceKurus,
      painterId: null,
    };
    const currentBaseKurus = manufacturerBaseKurus({ ...base, paintsInHouse: from });
    const nextBaseKurus = manufacturerBaseKurus({ ...base, paintsInHouse: to });
    const deltaKurus = nextBaseKurus - currentBaseKurus;
    if (deltaKurus === 0) continue;
    totalDeltaKurus += deltaKurus;
    affected.push({
      orderId: r.id,
      orderNumber: r.orderNumber,
      status: r.status,
      currentBaseKurus,
      nextBaseKurus,
      deltaKurus,
    });
  }

  const count = affected.length;
  return {
    count,
    totalDeltaKurus,
    orders: affected.slice(0, IMPACT_LIST_LIMIT),
    truncated: count > IMPACT_LIST_LIMIT,
  };
}

/** "3 siparişte toplam ₺450,00 azalır" — tek cümlelik para etkisi. */
export function impactSentence(impact: PaintingImpact): string {
  if (impact.count === 0) return "devam eden boyalı sipariş yok";
  const direction = impact.totalDeltaKurus < 0 ? "azalır" : "artar";
  return `devam eden ${impact.count} boyalı siparişte üreticinin hakediş tabanı toplam ${tl(Math.abs(impact.totalDeltaKurus))} ${direction}`;
}
