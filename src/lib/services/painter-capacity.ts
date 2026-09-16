/**
 * BOYACI KAPASİTESİ — platformdaki TEK ölçü.
 *
 * NEDEN BU DOSYA VAR (ölçülen kusur): boyacının yükü İKİ ayrı biçimde
 * sayılıyordu ve hiçbiri her yerde kullanılmıyordu.
 *  - Ham iş sayısı, iade DÜŞÜLMEDEN: üç yazma ucu (admin ataması, üreticinin
 *    devri, yönetici boyacı değişimi) ve iki admin ekranı.
 *  - Ağırlıklı birim, iade DÜŞÜLEREK: sıralayıcı ve otomatik yerleştirici.
 * Sonuç iki yönde birden ölçüldü: (1) tek işi İADE EDİLMİŞ bir boyacı üç
 * ekranda "uygun" görünüp üç ucun hepsinden 409/400 "kapasitesi dolu" yiyordu;
 * (2) aynanın öbür yüzü — tek bir PARTİ işi tutan boyacı ekranlarda ağırlıklı
 * birimle kapatılıyor, uçlar ise iş sayısına baktığı için onu KABUL ediyordu.
 * Üstelik /admin/painters ile sipariş kartı aynı boyacı için farklı yük
 * gösteriyordu.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KARAR 1 — "AKTİF BOYAMA İŞİ" NEDİR: tek cümle, her yerde aynı.
 *
 *   painter_id = <boyacı>
 *   AND painter_status IN (ACTIVE_PAINTER_ORDER_STATUSES)
 *   AND payment_status <> 'refunded'
 *
 * Durum kümesi `painter-qc.ts`ten IMPORT edilir, burada YENİDEN YAZILMAZ:
 * kümenin ikinci bir kopyası ilkinden sessizce ayrışırdı (boyanmış ama
 * kargolanmamış iş "tezgâhta değil" sayılırsa boyacıya sınırsız iş yazılır).
 *
 * İADE NEDEN DÜŞÜLÜR: fazın bağlayıcı kararı — iade edilmiş bir sipariş kimseyi
 * yerleştirmez, kimseyi cezalandırmaz ve KİMSENİN KAPASİTESİNİ TÜKETMEZ. İade
 * boyacıyı zaten koparıyor (refundOrder painterId'yi null'lar), ama o adım
 * düşerse iade edilmiş tek işi olan boyacı "dolu" sayılır ve sıradaki işi
 * alamaz: partner, var olmayan bir iş yüzünden para kaybeder.
 * `payment_status` NOT NULL (schema.ts:633, default 'succeeded'), bu yüzden
 * `ne(...)` üç değerli mantığa düşmez — NULL satır yoktur, hiçbir sipariş
 * karşılaştırmadan sessizce elenmez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KARAR 2 — İKİ SAYI, TEK KAPI: `loadUnits` KAPIDIR, `activeJobs` GÖSTERİMDİR.
 *
 * İki ölçü de hayatta kalıyor, çünkü ikisi de ayrı bir soruya cevap veriyor:
 *  - `loadUnits` (AĞIRLIKLI, `painterLoadUnits`: 1 + floor(adet/20)) "tezgâhta
 *    ne kadar YER kaplıyor" sorusunun cevabıdır. Sahibin kapasite kararı tam
 *    olarak budur: 60 parçalık bir iş, tek parçalık bir işle aynı yeri
 *    kaplamasın.
 *  - `activeJobs` (ham iş sayısı) "kaç ayrı KUTU var" sorusunun cevabıdır:
 *    operatör için okunabilir bir sayıdır, kapasite gerçeği değildir.
 *
 * KAPI NEDEN AĞIRLIKLI OLAN: kapasite "aynı anda kaç KUTU" değil, "aynı anda ne
 * kadar İŞ" demek. Kapı iş sayısı olsaydı, `maxConcurrentOrders = 5` olan bir
 * boyacıya 60'ar parçalık beş iş — 300 figür — yazılabilirdi ve her biri tek
 * iş sayılırdı; ağırlıklı birim tam olarak bunu engellemek için tanımlandı.
 *
 * İKİNCİ ve BAĞLAYICI GEREKÇE — EKRANLAR, UCUN UYGULAMADIĞI BİR ÖLÇÜYLE
 * KİMSEYİ KAPATAMAZ: bugün "uygun değil" diyen okuma yüzeyleri (saf sıralayıcı
 * `painter-assignment.ts` · `scorePainters`, sipariş kartındaki aday listesi,
 * üretici seçicisi) satırı AĞIRLIKLI birimle kapatıyor. Kapıyı iş sayısına
 * çevirmek, ekranların uçların uygulamadığı bir ölçüyle boyacı kapatması
 * demekti: partner "kapasiten dolu" diye iş alamazken uç o işi kabul ederdi.
 * Bu, partnere KENDİ işi hakkında yanlış bir şey söylemektir ve fazın bağlayıcı
 * kararlarından biri bunu yasaklıyor. Yön tektir: ekran neyi kapatıyorsa uç
 * onu reddetmeli, uç neyi kabul ediyorsa ekran onu seçtirebilmeli. Bunun tek
 * güvencesi, ikisinin de AYNI fonksiyonu çağırmasıdır — `painterHasRoom`.
 *
 * `activeJobs` bu yüzden hiçbir yerde kapı değildir: yalnız ekranda yazılır
 * (bkz. `painterLoadLabel`). Bir yüzey `activeJobs`a bakarak satır kapatırsa
 * kusur aynen geri gelir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ADET NEREDEN OKUNUR: sepet siparişinde `orders.quantity` 1 kalıp gerçek adet
 * `order_items` satırlarında durabiliyor. Kalem toplamı varsa O kullanılır,
 * yoksa `orders.quantity`. Sıralayıcının yaptığı okumanın aynısıdır; tek fark,
 * artık tek bir yerde yapılıyor olması.
 *
 * `server-only` YOK ve EKLENMEYECEK: otomatik yerleştirici
 * (`painter-auto-assign.ts`) bu modülü import ediyor ve o zincir BullMQ
 * worker'ından (`workers/start.ts`) da yürüyor; `server-only` import eden bir
 * modül standalone Node worker'ını crash-loop'a sokar (2026-06-13'te yaşandı).
 *
 * DİKKAT — İSTEMCİ BİLEŞENİ BU MODÜLÜ IMPORT EDEMEZ: `@/lib/db` üzerinden `pg`yi
 * paketine sürükler. İstemci yüzeyleri hazır `hasRoom`/`loadUnits` değerlerini
 * PROP ya da JSON olarak almalı (api/manufacturer/painters zaten böyle yapıyor).
 */
import { and, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders, painters } from "@/lib/db/schema";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";
import { ACTIVE_PAINTER_ORDER_STATUSES } from "@/lib/services/painter-qc";
import { painterLoadUnits } from "@/lib/config/painter-scoring";

/** Bir boyacının kapasite gerçeği — okuyan ve yazan her yüzeyin gördüğü tek satır. */
export interface PainterCapacity {
  painterId: string;
  /**
   * GÖSTERİM: tezgâhtaki ayrı iş (kutu) sayısı. KAPI DEĞİLDİR — hiçbir yüzey
   * bu sayıya bakarak boyacı kapatmamalı (bkz. dosya başlığı, KARAR 2).
   */
  activeJobs: number;
  /** KAPI: ağırlıklı yük (`painterLoadUnits` toplamı). */
  loadUnits: number;
  /** Boyacının beyan ettiği eşzamanlı kapasite (`painters.maxConcurrentOrders`). */
  maxConcurrentOrders: number;
  /** "Bu boyacıya bir iş daha yazılabilir mi" sorusunun TEK cevabı. */
  hasRoom: boolean;
}

/**
 * Kapasite reddinin TEK Türkçe cümlesi.
 *
 * Tek kaynak, çünkü üç uç üç ayrı dize taşıyordu (biri noktasız) ve aynı kuralın
 * üç farklı sesle konuşması, operatörün "bu aynı kural mı?" diye tahmin etmesine
 * yol açıyordu.
 */
export const PAINTER_CAPACITY_FULL_ERROR = "Seçilen boyacının kapasitesi dolu.";

/** Boyacı satırı bulunamadığında kapının cevabı. */
export const PAINTER_NOT_FOUND_ERROR = "Seçilen boyacı bulunamadı.";

/**
 * SAF KAPI. Sıralayıcı bunu ELİNDEKİ satır üzerinde çağırır (yeniden sorgu
 * açmaz): `PainterScoringRow` zaten `loadUnits` ve `maxConcurrentOrders`
 * taşıyor, yani yapısal olarak uyar.
 *
 * `max <= 0` → YER YOK: kapasitesini sıfır beyan etmiş boyacı iş almaz.
 * Karşılaştırma `<` (ağırlıklı birim sınırın ALTINDA kalmalı) — saf
 * sıralayıcının bugünkü `loadUnits >= max` kuralıyla birebir aynı eşik, ki
 * ekran ile uç aynı sınırda dönsün.
 */
export function painterHasRoom(row: {
  loadUnits: number;
  maxConcurrentOrders: number;
}): boolean {
  return row.loadUnits < row.maxConcurrentOrders;
}

/**
 * Tezgâhında hiç iş olmayan boyacının kapasite satırı.
 *
 * Yükleyici, var olan her boyacı için satır döndürür; bu yardımcı, id listesi
 * başka bir kaynaktan gelen çağıranların `?? emptyPainterCapacity(...)` ile
 * EKSİK satırı "bilinmiyor" yerine "boş tezgâh" saymasını sağlar. `hasRoom`
 * burada da elle YAZILMAZ, aynı saf kapıdan geçer.
 */
export function emptyPainterCapacity(
  painterId: string,
  maxConcurrentOrders: number
): PainterCapacity {
  return {
    painterId,
    activeJobs: 0,
    loadUnits: 0,
    maxConcurrentOrders,
    hasRoom: painterHasRoom({ loadUnits: 0, maxConcurrentOrders }),
  };
}

/**
 * Ekranların yazdığı TEK yük etiketi: "2/5 birim · 1 iş".
 *
 * Tek kaynak, çünkü /admin/painters ile sipariş kartı aynı boyacı için farklı
 * yük gösteriyordu. Birim ÖNCE gelir: kapı odur; iş sayısı bilgi olarak arkada
 * durur.
 */
export function painterLoadLabel(
  cap: Pick<PainterCapacity, "activeJobs" | "loadUnits" | "maxConcurrentOrders">
): string {
  return `${cap.loadUnits}/${cap.maxConcurrentOrders} birim · ${cap.activeJobs} iş`;
}

/** Yükleyicinin SQL'den çektiği ham tezgâh satırı (saf katlama için dışa açık). */
export interface PainterBenchRow {
  orderId: string;
  painterId: string;
  /** `orders.quantity`; kalem toplamı varsa çağıran onu geçer. */
  units: number | null;
}

/**
 * SAF KATLAMA: tezgâh satırları → boyacı başına (iş sayısı, ağırlıklı birim).
 *
 * İade filtresi BU FONKSİYONDA DEĞİL SQL'dedir ve bu bilinçli: fonksiyon yalnız
 * kendisine VERİLEN satırları katlar, yani hiçbir çağıran burada "iadeyi de
 * sayayım" diyemez. Testin doğrudan çalıştırabildiği yarı da budur.
 */
export function foldPainterBench(
  rows: readonly PainterBenchRow[]
): Map<string, { activeJobs: number; loadUnits: number }> {
  const out = new Map<string, { activeJobs: number; loadUnits: number }>();
  for (const row of rows) {
    if (!row.painterId) continue;
    const acc = out.get(row.painterId) ?? { activeJobs: 0, loadUnits: 0 };
    acc.activeJobs += 1;
    // Ağırlık kuralı BURADA YENİDEN YAZILMAZ: tek kaynak painterLoadUnits.
    acc.loadUnits += painterLoadUnits(row.units);
    out.set(row.painterId, acc);
  }
  return out;
}

/**
 * Verilen boyacıların kapasitesi. Ekranlar, sıralayıcı ve uçlar bunu çağırır.
 *
 * Var olan her boyacı için satır döner (tezgâhı boş olanlar dâhil): eksik satır
 * "bilinmiyor" diye okunur ve çağıranı tahmine iter.
 *
 * Üç küçük sorgu, N+1 yok. Tezgâh satırları devam eden işlerdir, tüm sipariş
 * geçmişi değil — sayıları küçüktür.
 */
export async function loadPainterCapacities(
  painterIds: Iterable<string>
): Promise<Map<string, PainterCapacity>> {
  const ids = [...new Set(painterIds)].filter((id) => !!id);
  const out = new Map<string, PainterCapacity>();
  if (ids.length === 0) return out;

  // Kapasite sınırı DB'den okunur, çağıranın elindeki kopyadan değil: iki
  // yüzeyin farklı tazelikte `maxConcurrentOrders` taşıması, aynı boyacı için
  // farklı cevap üretirdi.
  const painterRows = await db
    .select({ id: painters.id, maxConcurrentOrders: painters.maxConcurrentOrders })
    .from(painters)
    .where(inArray(painters.id, ids));
  if (painterRows.length === 0) return out;

  const foundIds = painterRows.map((p) => p.id);

  // TEZGÂH: aktif boyama işinin TEK tanımı (dosya başlığı, KARAR 1).
  // `isNotNull(painterId)` gerekmez: NULL hiçbir zaman `inArray` listesine
  // eşleşmez, yani filtre zaten kapsıyor.
  const bench = await db
    .select({
      orderId: orders.id,
      painterId: orders.painterId,
      quantity: orders.quantity,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.painterId, foundIds),
        inArray(orders.painterStatus, [...ACTIVE_PAINTER_ORDER_STATUSES]),
        ne(orders.paymentStatus, REFUNDED_PAYMENT_STATUS)
      )
    );

  // ADET: sepet siparişinde gerçek adet kalemlerde durur, `orders.quantity` 1
  // kalır. Kalem toplamı varsa o kazanır.
  const itemUnits = new Map<string, number>();
  if (bench.length > 0) {
    const sums = await db
      .select({
        orderId: orderItems.orderId,
        units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      })
      .from(orderItems)
      .where(
        inArray(
          orderItems.orderId,
          bench.map((b) => b.orderId)
        )
      )
      .groupBy(orderItems.orderId);
    for (const s of sums) {
      if (s.orderId && s.units > 0) itemUnits.set(s.orderId, s.units);
    }
  }

  const folded = foldPainterBench(
    bench
      .filter((b): b is typeof b & { painterId: string } => !!b.painterId)
      .map((b) => ({
        orderId: b.orderId,
        painterId: b.painterId,
        units: itemUnits.get(b.orderId) ?? b.quantity,
      }))
  );

  for (const p of painterRows) {
    const f = folded.get(p.id);
    if (!f) {
      out.set(p.id, emptyPainterCapacity(p.id, p.maxConcurrentOrders));
      continue;
    }
    out.set(p.id, {
      painterId: p.id,
      activeJobs: f.activeJobs,
      loadUnits: f.loadUnits,
      maxConcurrentOrders: p.maxConcurrentOrders,
      hasRoom: painterHasRoom({
        loadUnits: f.loadUnits,
        maxConcurrentOrders: p.maxConcurrentOrders,
      }),
    });
  }
  return out;
}

/** Tek boyacının kapasitesi; boyacı satırı yoksa null. */
export async function loadPainterCapacity(
  painterId: string
): Promise<PainterCapacity | null> {
  const map = await loadPainterCapacities([painterId]);
  return map.get(painterId) ?? null;
}

/**
 * Yazma uçlarının kapısı: cevabı ve Türkçe gerekçesi bir arada.
 *
 * YALNIZ KAPASİTEYİ yanıtlar. "Aktif değil" / "iş almıyor" / "bu işi reddetti"
 * kapıları çağıranda kalır: her birinin kendi Türkçe cümlesi ve kendi HTTP
 * kodu var, buraya toplanırlarsa mesajlar birbirine karışır.
 */
export type PainterCapacityGate =
  | { ok: true; capacity: PainterCapacity }
  | { ok: false; error: string; capacity: PainterCapacity | null };

export async function painterCapacityGate(
  painterId: string
): Promise<PainterCapacityGate> {
  const capacity = await loadPainterCapacity(painterId);
  if (!capacity) return { ok: false, error: PAINTER_NOT_FOUND_ERROR, capacity: null };
  if (!capacity.hasRoom) {
    return { ok: false, error: PAINTER_CAPACITY_FULL_ERROR, capacity };
  }
  return { ok: true, capacity };
}
