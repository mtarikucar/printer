/**
 * ÜRETİCİ KAPASİTESİ — platformdaki TEK ölçü.
 *
 * Bu dosya, `painter-capacity.ts`in (Faz 4) ÜRETİCİ ikizidir ve onun kararlarını
 * birebir taşır. Ayrı bir sözlük İCAT ETMEZ: aynı alan adları (`activeJobs`,
 * `loadUnits`, `hasRoom`), aynı kapı mantığı, aynı etiket biçimi. İki partner
 * rolünün kapasitesi iki ayrı dille anlatılsaydı, bir sonraki okuyucu hangisinin
 * kapı olduğunu her dosyada yeniden çıkarmak zorunda kalırdı.
 *
 * NEDEN BU DOSYA VAR (ölçülen kusur): üreticinin yükü HAM İŞ SAYISIYDI ve üç
 * ayrı yerde, ÜÇ FARKLI tanımla sayılıyordu.
 *  - `manufacturer-assignment.ts` (sıralayıcı) ve `/admin/workshops/[venueId]`:
 *    count(*), tezgâh tanımı doğru, ama iade DÜŞÜLMÜYOR.
 *  - `/api/admin/manufacturers`: count(*), tezgâh tanımı doğru, iade yok.
 *  - `/admin/manufacturers` (sayfanın kendi sorgusu): `status NOT IN
 *    ('delivered','rejected')` — tezgâh tanımı BAMBAŞKA. Üreticiye hiç
 *    atanmamış, boyacıya devredilmiş ya da iade edilmiş siparişleri de sayıyor,
 *    yani admin listesindeki "aktif sipariş" sayısı ile atama kapısının gördüğü
 *    sayı aynı atölye için farklı çıkıyordu.
 *
 * VE HEPSİNİN ORTAK KUSURU: 300 adetlik bir TOPLU sipariş TEK slot işgal
 * ediyordu. `maxConcurrentOrders = 5` olan bir atölyeye 300'er adetlik beş iş
 * yazılabiliyordu — 1.500 figür — ve her biri "bir iş" sayılıyordu.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KARAR 1 — "AKTİF ÜRETİM İŞİ" NEDİR: tek cümle, her yerde aynı.
 *
 *   manufacturer_id = <atölye>
 *   AND manufacturer_status IN (ACTIVE_MFG_STATUSES)
 *   AND (painter_status IS NULL OR painter_status = 'unassigned')
 *   AND payment_status <> 'refunded'
 *
 * İlk iki koşul `manufacturer-assignment.ts`ten IMPORT edilir
 * (`ACTIVE_MFG_STATUSES` + `orderStillOnManufacturerBench`), burada YENİDEN
 * YAZILMAZ: kümenin ikinci bir kopyası ilkinden sessizce ayrışırdı. Baskısı
 * bitmiş ama kargolanmamış iş (printed, qc_*) tezgâhtadır; boyacıya devredilmiş
 * iş ise DEĞİLDİR — boyalı siparişte `manufacturerStatus` sonsuza dek
 * 'qc_approved' kalır, o satırlar sayılsaydı atölye kalıcı olarak kilitlenirdi.
 *
 * İADE NEDEN DÜŞÜLÜR: fazın bağlayıcı kararı — iade edilmiş bir sipariş kimseyi
 * yerleştirmez, kimseyi cezalandırmaz ve KİMSENİN KAPASİTESİNİ TÜKETMEZ. Bugün
 * hiçbir üretici sayımı iadeyi düşmüyor: iade siparişin durumunu KORUR
 * (refund-end-state kararı), yani iade edilmiş bir iş atölyenin tezgâhında
 * duruyormuş gibi görünür ve partner, var olmayan bir iş yüzünden sıradaki işi
 * alamaz. `payment_status` NOT NULL (schema.ts, default 'succeeded'), bu yüzden
 * `ne(...)` üç değerli mantığa düşmez — hiçbir sipariş karşılaştırmadan sessizce
 * elenmez.
 *
 * İADE FİLTRESİ NEDEN `notRefundedGuard()` ÇAĞRILARAK YAZILMADI: o yardımcı
 * `manufacturer-assign.ts`te duruyor ve o dosya atama KAPISIDIR — kapı bu
 * modülü import ediyor (kapasite kapısı için). Buradan oraya bir import daha
 * atmak import DÖNGÜSÜ kurardı (assign → capacity → assign). İki taraf da AYNI
 * sabiti (`REFUNDED_PAYMENT_STATUS`) okur ve ürettikleri SQL birebir aynıdır;
 * `scripts/test-manufacturer-capacity.ts` her koşuda iki dosyanın da düz
 * "refunded" dizesi yazmadığını, ikisinin de o sabitten okuduğunu doğrular.
 * (`painter-capacity.ts` de tam olarak böyle yapar; bu, o dosyanın kararının
 * aynen sürdürülmesidir.)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KARAR 2 — İKİ SAYI, TEK KAPI: `loadUnits` KAPIDIR, `activeJobs` GÖSTERİMDİR.
 *
 *  - `loadUnits` (AĞIRLIKLI: 1 + floor(adet/20)) "tezgâhta ne kadar YER
 *    kaplıyor" sorusunun cevabıdır. Sahibin kapasite kararı (capacity-unit = C)
 *    tam olarak budur: 300 parçalık bir iş, tek parçalık bir işle aynı yeri
 *    kaplamasın.
 *  - `activeJobs` (ham iş sayısı) "kaç ayrı KUTU var" sorusunun cevabıdır:
 *    operatör için okunabilir bir sayıdır, kapasite gerçeği değildir.
 *
 * KAPI NEDEN AĞIRLIKLI OLAN: kapasite "aynı anda kaç KUTU" değil, "aynı anda ne
 * kadar İŞ" demek. Kapı iş sayısı olsaydı, `maxConcurrentOrders = 5` olan bir
 * atölyeye 300'er adetlik beş toplu iş yazılabilirdi.
 *
 * İKİNCİ ve BAĞLAYICI GEREKÇE — EKRANLAR, UCUN UYGULAMADIĞI BİR ÖLÇÜYLE KİMSEYİ
 * KAPATAMAZ: "uygun değil" diyen her okuma yüzeyi ile atamayı reddeden uç AYNI
 * fonksiyondan geçmek zorundadır (`manufacturerHasRoom`). Faz 4'ün ölçülen
 * kusuru buydu: ekran birini kapatırken uç onu kabul ediyor, ekran birini
 * gösterirken uç 409 veriyordu. Yön tektir: ekran neyi kapatıyorsa uç onu
 * reddetmeli, uç neyi kabul ediyorsa ekran onu seçtirebilmeli.
 *
 * `activeJobs` bu yüzden hiçbir yerde kapı değildir: yalnız ekranda yazılır
 * (bkz. `manufacturerLoadLabel`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AĞIRLIK KURALI NEREDEN GELİYOR: `painterLoadUnits` (config/painter-scoring).
 *
 * Kural KOPYALANMADI, IMPORT EDİLDİ. Sahibin kararı (capacity-unit = C) "bu,
 * Faz 4'te boyacı için yazılan kuralın AYNISIDIR" diyor; iki partner rolü için
 * iki ayrı `+1 / 20 adet` uygulaması yazmak, tam da bu fazın yasakladığı ikinci
 * kopya olurdu — biri 20, öteki 25 olduğu gün kimse fark etmezdi.
 *
 * Fonksiyonun adında "painter" geçmesi bir kusurdur ama KOPYADAN İYİDİR: adı
 * partner-nötr hâle getirmek `config/painter-scoring.ts`i düzenlemeyi gerektirir
 * ve o dosya bu düzelticinin mülkiyetinde değildir (bkz. crossOwnerRequest:
 * `painterLoadUnits` → `partnerLoadUnits`). Ad değiştiğinde burada tek satır
 * değişir; kural yine tek yerde kalır.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ADET NEREDEN OKUNUR: sepet siparişinde `orders.quantity` 1 kalıp gerçek adet
 * `order_items` satırlarında durabiliyor. Kalem toplamı varsa O kullanılır,
 * yoksa `orders.quantity`. (`painter-capacity.ts` ile birebir aynı okuma.)
 *
 * `server-only` YOK ve EKLENMEYECEK: atama kapısı (`manufacturer-assign.ts`) bu
 * modülü import ediyor ve o zincir BullMQ worker'ından (`workers/start.ts`) da
 * yürüyor; `server-only` import eden bir modül standalone Node worker'ını
 * crash-loop'a sokar (2026-06-13'te yaşandı).
 *
 * DİKKAT — İSTEMCİ BİLEŞENİ BU MODÜLÜ IMPORT EDEMEZ: `@/lib/db` üzerinden `pg`yi
 * paketine sürükler. İstemci yüzeyleri hazır `hasRoom`/`loadUnits`/`loadLabel`
 * değerlerini PROP ya da JSON olarak almalı.
 */
import { and, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, orderItems, orders } from "@/lib/db/schema";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";
import {
  ACTIVE_MFG_STATUSES,
  orderStillOnManufacturerBench,
} from "@/lib/services/manufacturer-assignment";
import { painterLoadUnits } from "@/lib/config/painter-scoring";

/** Bir atölyenin kapasite gerçeği — okuyan ve yazan her yüzeyin gördüğü tek satır. */
export interface ManufacturerCapacity {
  manufacturerId: string;
  /**
   * GÖSTERİM: tezgâhtaki ayrı iş (kutu) sayısı. KAPI DEĞİLDİR — hiçbir yüzey
   * bu sayıya bakarak atölye kapatmamalı (bkz. dosya başlığı, KARAR 2).
   */
  activeJobs: number;
  /** KAPI: ağırlıklı yük (`painterLoadUnits` toplamı). */
  loadUnits: number;
  /** Atölyenin beyan ettiği eşzamanlı kapasite (`manufacturers.maxConcurrentOrders`). */
  maxConcurrentOrders: number;
  /** "Bu atölyeye bir iş daha yazılabilir mi" sorusunun TEK cevabı. */
  hasRoom: boolean;
}

/**
 * Kapasite reddinin TEK Türkçe cümlesi.
 *
 * Tek kaynak, çünkü aynı kuralın birden çok sesle konuşması operatörü "bu aynı
 * kural mı?" diye tahmine iter. Atama kapısının `ASSIGN_FAILURE_MESSAGES`
 * tablosu da bu sabiti okur, kendi cümlesini yazmaz.
 */
export const MANUFACTURER_CAPACITY_FULL_ERROR =
  "Seçilen üreticinin kapasitesi dolu.";

/** Üretici satırı bulunamadığında kapının cevabı. */
export const MANUFACTURER_NOT_FOUND_ERROR = "Seçilen üretici bulunamadı.";

/**
 * SAF KAPI. Sıralayıcı bunu ELİNDEKİ satır üzerinde çağırabilir (yeniden sorgu
 * açmadan): aday satırı zaten `loadUnits` ve `maxConcurrentOrders` taşır.
 *
 * `max <= 0` → YER YOK: kapasitesini sıfır beyan etmiş atölye iş almaz.
 * Karşılaştırma `<` (ağırlıklı birim sınırın ALTINDA kalmalı) — sıralayıcının
 * bugünkü `currentLoad >= max` eşiğiyle birebir aynı sınır, ki ekran ile uç
 * aynı yerde dönsün. Değişen tek şey ÖLÇÜ: iş sayısı değil, ağırlıklı birim.
 */
export function manufacturerHasRoom(row: {
  loadUnits: number;
  maxConcurrentOrders: number;
}): boolean {
  return row.loadUnits < row.maxConcurrentOrders;
}

/**
 * Tezgâhında hiç iş olmayan atölyenin kapasite satırı.
 *
 * Yükleyici, var olan her atölye için satır döndürür; bu yardımcı, id listesi
 * başka bir kaynaktan gelen çağıranların `?? emptyManufacturerCapacity(...)` ile
 * EKSİK satırı "bilinmiyor" yerine "boş tezgâh" saymasını sağlar. `hasRoom`
 * burada da elle YAZILMAZ, aynı saf kapıdan geçer.
 */
export function emptyManufacturerCapacity(
  manufacturerId: string,
  maxConcurrentOrders: number
): ManufacturerCapacity {
  return {
    manufacturerId,
    activeJobs: 0,
    loadUnits: 0,
    maxConcurrentOrders,
    hasRoom: manufacturerHasRoom({ loadUnits: 0, maxConcurrentOrders }),
  };
}

/**
 * Ekranların yazdığı TEK yük etiketi: "2/5 birim · 1 iş".
 *
 * Tek kaynak, çünkü /admin/manufacturers, sipariş kartı ve atölye seansı
 * seçicisi aynı atölye için farklı yük gösteriyordu. Birim ÖNCE gelir: kapı
 * odur; iş sayısı bilgi olarak arkada durur. (Boyacı tarafındaki etiketin
 * biçimiyle birebir aynı — operatör iki panelde aynı cümleyi okur.)
 */
export function manufacturerLoadLabel(
  cap: Pick<
    ManufacturerCapacity,
    "activeJobs" | "loadUnits" | "maxConcurrentOrders"
  >
): string {
  return `${cap.loadUnits}/${cap.maxConcurrentOrders} birim · ${cap.activeJobs} iş`;
}

/** Yükleyicinin SQL'den çektiği ham tezgâh satırı (saf katlama için dışa açık). */
export interface ManufacturerBenchRow {
  orderId: string;
  manufacturerId: string;
  /** `orders.quantity`; kalem toplamı varsa çağıran onu geçer. */
  units: number | null;
}

/**
 * SAF KATLAMA: tezgâh satırları → atölye başına (iş sayısı, ağırlıklı birim).
 *
 * İade filtresi BU FONKSİYONDA DEĞİL SQL'dedir ve bu bilinçli: fonksiyon yalnız
 * kendisine VERİLEN satırları katlar, yani hiçbir çağıran burada "iadeyi de
 * sayayım" diyemez. Testin doğrudan çalıştırabildiği yarı da budur.
 */
export function foldManufacturerBench(
  rows: readonly ManufacturerBenchRow[]
): Map<string, { activeJobs: number; loadUnits: number }> {
  const out = new Map<string, { activeJobs: number; loadUnits: number }>();
  for (const row of rows) {
    if (!row.manufacturerId) continue;
    const acc = out.get(row.manufacturerId) ?? { activeJobs: 0, loadUnits: 0 };
    acc.activeJobs += 1;
    // Ağırlık kuralı BURADA YENİDEN YAZILMAZ: tek kaynak painterLoadUnits.
    acc.loadUnits += painterLoadUnits(row.units);
    out.set(row.manufacturerId, acc);
  }
  return out;
}

/**
 * Verilen atölyelerin kapasitesi. Ekranlar, sıralayıcı ve uçlar bunu çağırır.
 *
 * Var olan her atölye için satır döner (tezgâhı boş olanlar dâhil): eksik satır
 * "bilinmiyor" diye okunur ve çağıranı tahmine iter.
 *
 * Üç küçük sorgu, N+1 yok. Tezgâh satırları devam eden işlerdir, tüm sipariş
 * geçmişi değil — sayıları küçüktür.
 */
export async function loadManufacturerCapacities(
  manufacturerIds: Iterable<string>
): Promise<Map<string, ManufacturerCapacity>> {
  const ids = [...new Set(manufacturerIds)].filter((id) => !!id);
  const out = new Map<string, ManufacturerCapacity>();
  if (ids.length === 0) return out;

  // Kapasite sınırı DB'den okunur, çağıranın elindeki kopyadan değil: iki
  // yüzeyin farklı tazelikte `maxConcurrentOrders` taşıması, aynı atölye için
  // farklı cevap üretirdi.
  const mfgRows = await db
    .select({
      id: manufacturers.id,
      maxConcurrentOrders: manufacturers.maxConcurrentOrders,
    })
    .from(manufacturers)
    .where(inArray(manufacturers.id, ids));
  if (mfgRows.length === 0) return out;

  const foundIds = mfgRows.map((m) => m.id);

  // TEZGÂH: aktif üretim işinin TEK tanımı (dosya başlığı, KARAR 1).
  // `isNotNull(manufacturerId)` gerekmez: NULL hiçbir zaman `inArray` listesine
  // eşleşmez, yani filtre zaten kapsıyor.
  const bench = await db
    .select({
      orderId: orders.id,
      manufacturerId: orders.manufacturerId,
      quantity: orders.quantity,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.manufacturerId, foundIds),
        inArray(orders.manufacturerStatus, [...ACTIVE_MFG_STATUSES]),
        orderStillOnManufacturerBench(),
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

  const folded = foldManufacturerBench(
    bench
      .filter(
        (b): b is typeof b & { manufacturerId: string } => !!b.manufacturerId
      )
      .map((b) => ({
        orderId: b.orderId,
        manufacturerId: b.manufacturerId,
        units: itemUnits.get(b.orderId) ?? b.quantity,
      }))
  );

  for (const m of mfgRows) {
    const f = folded.get(m.id);
    if (!f) {
      out.set(m.id, emptyManufacturerCapacity(m.id, m.maxConcurrentOrders));
      continue;
    }
    out.set(m.id, {
      manufacturerId: m.id,
      activeJobs: f.activeJobs,
      loadUnits: f.loadUnits,
      maxConcurrentOrders: m.maxConcurrentOrders,
      hasRoom: manufacturerHasRoom({
        loadUnits: f.loadUnits,
        maxConcurrentOrders: m.maxConcurrentOrders,
      }),
    });
  }
  return out;
}

/** Tek atölyenin kapasitesi; üretici satırı yoksa null. */
export async function loadManufacturerCapacity(
  manufacturerId: string
): Promise<ManufacturerCapacity | null> {
  const map = await loadManufacturerCapacities([manufacturerId]);
  return map.get(manufacturerId) ?? null;
}

/**
 * Yazma uçlarının kapısı: cevabı ve Türkçe gerekçesi bir arada.
 *
 * YALNIZ KAPASİTEYİ yanıtlar. "Aktif değil" / "sipariş almıyor" / "bu işi
 * reddetti" / "malzeme uyumsuz" / "büyük format yok" kapıları çağıranda kalır:
 * her birinin kendi Türkçe cümlesi ve kendi hata üyesi var, buraya
 * toplanırlarsa mesajlar birbirine karışır.
 */
export type ManufacturerCapacityGate =
  | { ok: true; capacity: ManufacturerCapacity }
  | { ok: false; error: string; capacity: ManufacturerCapacity | null };

export async function manufacturerCapacityGate(
  manufacturerId: string
): Promise<ManufacturerCapacityGate> {
  const capacity = await loadManufacturerCapacity(manufacturerId);
  if (!capacity) {
    return { ok: false, error: MANUFACTURER_NOT_FOUND_ERROR, capacity: null };
  }
  if (!capacity.hasRoom) {
    return { ok: false, error: MANUFACTURER_CAPACITY_FULL_ERROR, capacity };
  }
  return { ok: true, capacity };
}
