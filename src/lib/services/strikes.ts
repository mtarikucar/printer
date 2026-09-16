import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, orders, painters } from "@/lib/db/schema";
import { STRIKE_SUSPEND_THRESHOLD } from "@/lib/services/performance";
import { isRefunded } from "@/lib/config/order-status-policy";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";

/**
 * Güvenilirlik cezası (strike) — İKİ partner türü için.
 *
 * Boyacı tablosunda `strike_count` kolonu Faz 1'den beri duruyordu ama bu
 * yardımcı YALNIZ `manufacturers` tablosunu güncelliyordu: boyacıya ceza yazan
 * her çağrı sessizce üreticiyi arıyor, boyacının sayacı hep 0 kalıyordu. Yani
 * boyacılar için eşik (3) hiç dolmuyor, otomatik askıya alma hiç çalışmıyordu.
 *
 * Çağrı ŞEKLİ korunur: `applyStrike(manufacturerId)` bugünkü davranışın
 * birebir aynısıdır (varsayılan tür üretici), böylece mevcut üç çağıran
 * değişmeden aynı sonucu alır.
 *
 * BOYACI TARAFINDA CEZA YAZAN TEK YOL: admin'in "boyacıdan geri al" rotası ve
 * yalnız admin kutuyu işaretlediğinde (api/admin/orders/[id]/revoke-painter).
 * İki yol bilerek DIŞARIDA:
 *  • RET — iş sıradaki boyacıya gider ve sahibin kararı reddi bir yaptırım
 *    saymaz; sıralamada güvenilirliği düşürmesi yeterli bedeldir.
 *  • 24 SAAT CEVAPSIZLIK — sahibin kararı açık: iş alınır, ceza YAZILMAZ
 *    (yeniden yerleştirme üst sınırına sayılır ama sayaç artmaz; sınır
 *    config/flags.ts · PAINTER_MAX_REPLACEMENTS'tan okunur). SLA worker'ı bu
 *    yüzden bu modülü hiç import etmez; oraya bir `applyStrike` eklemek kararı
 *    bozar. Kuralı geri alma ucu da uygular: işi HENÜZ ÜSTLENMEMİŞ boyacıya
 *    (painter_status = 'assigned') admin elle bile ceza yazdıramaz — ölçülen
 *    kusur, kuralın yalnız panelde durması ve doğrudan bir POST'un sayacı
 *    artırabilmesiydi.
 */
export type StrikePartnerKind = "manufacturer" | "painter";

export interface ApplyStrikeOptions {
  /** Hangi partner? Varsayılan "manufacturer" — eski çağrı şekli korunur. */
  kind?: StrikePartnerKind;
  /**
   * Cezanın SEBEBİ olan sipariş. Verildiğinde ceza, iade edilmiş siparişte
   * YAZILMAZ (aşağıya bakın). Verilmediğinde kapı çalışmaz: çağıranın kendi
   * iade kontrolü tek koruma olarak kalır.
   */
  orderId?: string;
}

export interface StrikeOutcome {
  /** Çağrıdan SONRAKİ sayaç. Ceza yazılmadıysa değişmemiş hâli. */
  strikeCount: number;
  suspended: boolean;
  /** Ceza NEDEN yazılmadı? Yazıldıysa yok. */
  skipped?: "refunded" | "order_unreadable" | "partner_not_found";
}

/**
 * CEZA NEDEN YAZILMADI — Türkçesi TEK yerden.
 *
 * NEDEN BU SÖZLÜK VAR (ölçülen kusur): admin ceza kutusunu işaretlediği hâlde
 * ceza yazılmadığında cevap bunu HİÇ söylemiyordu — `applyStrike`in döndürdüğü
 * `StrikeOutcome` çağıranda tamamen atılıyor, sipariş notunda da tek kelime
 * olmuyordu. Admin, istediği yaptırımın uygulanmadığını hiçbir yerden
 * öğrenemiyordu.
 *
 * Küme, bu modülün KENDİ kapılarından (`StrikeOutcome.skipped`) biraz daha
 * geniştir: `unanswered_job` ve `write_failed` ÇAĞIRANIN kapılarıdır (cevapsız
 * kalan işte ceza yazılmaz — sahibin kararı; ve yazma denemesi hata verebilir).
 * Yine de cümleler burada durur, çünkü "ceza neden yazılmadı" sorusunun tek bir
 * Türkçe kaynağı olmalı: iki ayrı yerde yazılsalardı ekranlar aynı olguyu
 * farklı anlatırdı.
 */
export type StrikeSkipReason =
  | NonNullable<StrikeOutcome["skipped"]>
  | "unanswered_job"
  | "write_failed";

/**
 * `Record` BİLEREK: kümeye yeni bir sebep eklendiği gün Türkçesini yazmayı
 * unutmak DERLEME hatası verir — admin'in okuduğu cümlede "undefined" değil.
 */
export const STRIKE_SKIP_LABELS_TR: Record<StrikeSkipReason, string> = {
  refunded: "sipariş iade edilmiş (iade edilen siparişte hiçbir partner cezalandırılmaz)",
  order_unreadable:
    "siparişin ödeme durumu okunamadı ve ceza kapalı tarafa düşüldü (haksız ceza riskine karşı)",
  partner_not_found: "partner kaydı bulunamadı",
  unanswered_job:
    "boyacı işi henüz üstlenmemişti (cevapsız iş); cevapsız kalan iş yeniden yerleştirme sınırına sayılır ama ceza yazılmaz",
  write_failed: "ceza yazılırken beklenmeyen bir hata oluştu",
};

/** Admin'in ekranda okuyacağı tam cümle. */
export function strikeSkipNoticeTr(reason: StrikeSkipReason): string {
  return `Güvenilirlik cezası UYGULANMADI: ${STRIKE_SKIP_LABELS_TR[reason]}.`;
}

/**
 * Sayacı bir artırır ve yeni değeri döndürür (partner yoksa null).
 *
 * İki tablo için iki ayrı zincir: drizzle'da tabloyu değişkende taşımak
 * kolonların tipini kaybettirir, oysa buradaki güvence tam da yanlış tabloya
 * yazılamamasıdır.
 */
async function bumpStrikeCount(
  kind: StrikePartnerKind,
  partnerId: string
): Promise<number | null> {
  if (kind === "painter") {
    const [row] = await db
      .update(painters)
      .set({ strikeCount: sql`${painters.strikeCount} + 1`, updatedAt: new Date() })
      .where(eq(painters.id, partnerId))
      .returning({ strikeCount: painters.strikeCount });
    return row?.strikeCount ?? null;
  }
  const [row] = await db
    .update(manufacturers)
    .set({ strikeCount: sql`${manufacturers.strikeCount} + 1`, updatedAt: new Date() })
    .where(eq(manufacturers.id, partnerId))
    .returning({ strikeCount: manufacturers.strikeCount });
  return row?.strikeCount ?? null;
}

/**
 * Eşiğe gelen partneri ATOMİK olarak askıya alır: geçiş, satırın HÂLÂ aktif ve
 * eşiğin üstünde olmasına aynı ifade içinde bağlanır. Kontrolü daha önceki bir
 * anlık görüntüden yapmak, aradaki bir admin yeniden etkinleştirmesini ezerdi.
 */
async function suspendIfOverThreshold(
  kind: StrikePartnerKind,
  partnerId: string
): Promise<boolean> {
  if (kind === "painter") {
    const [row] = await db
      .update(painters)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(
        and(
          eq(painters.id, partnerId),
          eq(painters.status, "active"),
          gte(painters.strikeCount, STRIKE_SUSPEND_THRESHOLD)
        )
      )
      .returning({ id: painters.id });
    return !!row;
  }
  const [row] = await db
    .update(manufacturers)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(
      and(
        eq(manufacturers.id, partnerId),
        eq(manufacturers.status, "active"),
        gte(manufacturers.strikeCount, STRIKE_SUSPEND_THRESHOLD)
      )
    )
    .returning({ id: manufacturers.id });
  return !!row;
}

/** Ceza yazılmadığında bile doğru sayacı döndürebilmek için (en iyi çaba). */
async function readStrikeCount(
  kind: StrikePartnerKind,
  partnerId: string
): Promise<number> {
  try {
    if (kind === "painter") {
      const row = await db.query.painters.findFirst({
        where: eq(painters.id, partnerId),
        columns: { strikeCount: true },
      });
      return row?.strikeCount ?? 0;
    }
    const row = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, partnerId),
      columns: { strikeCount: true },
    });
    return row?.strikeCount ?? 0;
  } catch {
    return 0;
  }
}

/**
 * İade edilmiş siparişte CEZA YOKTUR — kapı burada, cezanın YAZILDIĞI yerde.
 *
 * Kural order-status-policy.ts'te yazılı: iade edilmiş siparişte temizlik
 * koparır ama hiçbir partneri cezalandırmaz. Çağıranlar bunu kendi dallarında
 * sorar (geri alma, üretici iptali), ama soran YALNIZ onlardır: sormayan bir
 * çağrı (ör. anlaşmazlık çözümündeki clawback) cezayı iade edilmiş bir
 * siparişte de yazdırabiliyordu. `orderId` gönderildiğinde kapı çağırandan
 * bağımsız olarak kapanır.
 *
 * Okuma KAPALI tarafa düşer: sipariş okunamıyorsa ya da bulunamıyorsa ceza
 * YAZILMAZ. Kapıyı besleyen okumanın belirsizliği, partnerin aleyhine değil
 * lehine yorumlanır — haksız bir ceza, eşiğe gelmiş bir partneri askıya
 * aldırabilir.
 */
async function refundGate(
  orderId: string
): Promise<"ok" | "refunded" | "order_unreadable"> {
  try {
    const row = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: { paymentStatus: true },
    });
    if (!row) return "order_unreadable";
    return isRefunded(row) ? "refunded" : "ok";
  } catch (err) {
    console.error(`applyStrike: sipariş ödeme durumu okunamadı (${orderId})`, err);
    return "order_unreadable";
  }
}

const SUSPEND_BODY =
  "Tekrar eden olumsuzluklar (geç kargo, iptal veya kalite sorunları) nedeniyle";

/**
 * Bir güvenilirlik cezası kaydeder ve eşiğe ulaşan partneri otomatik askıya
 * alır (Faz 3 politikası). Yeni sayacı ve bu çağrıda askıya alınıp
 * alınmadığını döndürür.
 */
export async function applyStrike(
  partnerId: string,
  opts: ApplyStrikeOptions = {}
): Promise<StrikeOutcome> {
  const kind = opts.kind ?? "manufacturer";

  if (opts.orderId) {
    const gate = await refundGate(opts.orderId);
    if (gate !== "ok") {
      return {
        strikeCount: await readStrikeCount(kind, partnerId),
        suspended: false,
        skipped: gate,
      };
    }
  }

  const strikeCount = await bumpStrikeCount(kind, partnerId);
  if (strikeCount === null) {
    return { strikeCount: 0, suspended: false, skipped: "partner_not_found" };
  }

  const suspended = await suspendIfOverThreshold(kind, partnerId);

  if (suspended) {
    if (kind === "painter") {
      await notifyPainter({
        painterId: partnerId,
        type: "system_announcement",
        subject: "Hesabınız askıya alındı",
        body: `${SUSPEND_BODY} boyacı hesabınız otomatik olarak askıya alındı. Yeni iş alamazsınız. Durumu görüşmek için lütfen bizimle iletişime geçin.`,
      }).catch((e) => console.error("notifyPainter (auto-suspend) failed", e));
    } else {
      await notifyManufacturer({
        manufacturerId: partnerId,
        type: "system_announcement",
        subject: "Hesabınız askıya alındı",
        body: `${SUSPEND_BODY} üretici hesabınız otomatik olarak askıya alındı. Yeni sipariş alamazsınız. Durumu görüşmek için lütfen bizimle iletişime geçin.`,
      }).catch((e) => console.error("notifyManufacturer (auto-suspend) failed", e));
    }
  }

  return { strikeCount, suspended };
}
