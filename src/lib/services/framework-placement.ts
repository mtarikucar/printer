/**
 * ÇERÇEVE ANLAŞMANIN ÇAPALI ATÖLYESİ — parti siparişinin ilk adayı (0073).
 *
 * Bir çerçeve anlaşma bir atölyeye çapalanabilir (`quote_frameworks.
 * preferred_manufacturer_id`). Anlaşmanın her partisi KENDİ siparişi olarak
 * ödenir ve admin onayından sonra atanır; bu modülün yaptığı tek şey o
 * atamada SIRALAMADAN ÖNCE anlaşmanın atölyesini denemektir.
 *
 * ─── KAPI ATLANMAZ ──────────────────────────────────────────────────────────
 *
 * Mülkiyet → aktiflik → malzeme → büyük format → `acceptingOrders` → kapasite:
 * kapıların HEPSİ `assignManufacturerToOrder`ın İÇİNDE uygulanır ve bu modül
 * onları görmez bile. Çerçeve hiçbirini baypas etmez, yalnız bir ADAY önerir.
 * Kapı reddederse (`AssignResult.ok === false`) çağıran mevcut
 * `autoAssignIfEligible` yoluna düşer ve siparişe gerekçeli bir not kalır.
 *
 * ─── HİÇ FIRLATMAZ ──────────────────────────────────────────────────────────
 *
 * `autoAssignIfEligible`in sözleşmesiyle AYNI (`order-confirm.ts`): çağıranlar
 * bunu ÇOKTAN COMMIT OLMUŞ bir geçişin (admin onayı) ardından çağırır. Buradan
 * fırlayan bir hata o geçişi geri ALMAZ, yalnız admin'e "onay başarısız"
 * yalanını söylerdi — onay isteği atama yüzünden 500 dönmemeli. Her arıza
 * loglanır ve `null` dönülür, yani sıralama yolu devreye girer.
 *
 * ─── AYRI DOSYA, ÇÜNKÜ ÖLÇÜLEBİLİR OLMALI ──────────────────────────────────
 *
 * Karar onay rotasının gövdesine gömülseydi, "çapa gerçekten sıralamadan önce
 * mi deneniyor" ve "red hâlinde not yazılıyor mu" sorularının cevabı yalnız
 * bütün rotayı taklit ederek ölçülebilirdi. Burada duran hâliyle
 * `scripts/test-admin-order-routes.ts` kararı doğrudan koşturuyor.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, orders, quoteFrameworkBatches, quoteFrameworks } from "@/lib/db/schema";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";
import {
  ASSIGN_FAILURE_MESSAGES,
  assignManufacturerToOrder,
  type AssignFailure,
} from "@/lib/services/manufacturer-assign";

export interface FrameworkPreferredPlacement {
  /** Atamanın düştüğü atölye. */
  manufacturerId: string;
  /** `C-000123` — denetim ve ekran için. */
  frameworkNumber: string;
  /** Partinin sırası (`parti 3/8`in ilk yarısı). */
  batchPosition: number;
}

/**
 * Çapanın reddinin siparişe yazılan TEK cümlesi.
 *
 * SAF ve dışa açık: cümlenin kendisi testle çivilenebilir olmalı, oysa
 * `adminNotes` bir SQL birleştirmesinin içine giriyor ve oradan geri
 * okunamıyor. `[ÇERÇEVE]` ön eki ev üslubudur (`[ATAMA]`, `[SLA]`, `[N12]`):
 * aynı listede duran diğer bayraklar gibi taranabilir.
 *
 * Ret KODU da yazılır (Türkçe cümlenin yanında): kod GEÇİCİ ile KALICI reddi
 * ayırır — `capacity_full` yarın çalışır, `large_format_required` asla.
 */
export function frameworkPlacementNote(args: {
  frameworkNumber: string;
  shopLabel: string;
  reason: AssignFailure;
}): string {
  return (
    `[ÇERÇEVE] Çerçeve ${args.frameworkNumber}'ün atölyesi ${args.shopLabel} uygun ` +
    `değil (${args.reason}: ${ASSIGN_FAILURE_MESSAGES[args.reason]}), sıralama seçti.`
  );
}

/**
 * Bu sipariş bir çerçeve partisiyse, anlaşmanın çapalı atölyesini DENER.
 *
 * Dönen değer:
 *  - `FrameworkPreferredPlacement` — atama yapıldı, sıralamaya GEREK YOK.
 *  - `null` — sipariş parti değil, anlaşmanın çapası yok, kapı reddetti ya da
 *    bir arıza oldu. Üçünde de çağıran mevcut sıralama yoluna düşer.
 */
export async function tryFrameworkPreferredPlacement(args: {
  orderId: string;
  adminEmail: string;
}): Promise<FrameworkPreferredPlacement | null> {
  try {
    // `orders`a HİÇ BAKILMAZ: köprü `quote_framework_batches.order_id`dir ve
    // kapasite ölçüsü bu modülün konusu değil (tek sahibi
    // `manufacturer-capacity.ts`).
    const [row] = await db
      .select({
        frameworkNumber: quoteFrameworks.number,
        frameworkStatus: quoteFrameworks.status,
        preferredManufacturerId: quoteFrameworks.preferredManufacturerId,
        position: quoteFrameworkBatches.position,
      })
      .from(quoteFrameworkBatches)
      .innerJoin(quoteFrameworks, eq(quoteFrameworks.id, quoteFrameworkBatches.frameworkId))
      .where(eq(quoteFrameworkBatches.orderId, args.orderId))
      .limit(1);

    // Parti değil, ya da anlaşma bir atölyeye çapalanmamış: sıradan sipariş
    // gibi davranılır ve BUGÜNKÜ yol birebir korunur.
    if (!row || !row.preferredManufacturerId) return null;

    const result = await assignManufacturerToOrder({
      orderId: args.orderId,
      manufacturerId: row.preferredManufacturerId,
      selectionBasis: "framework_preferred",
      adminEmail: args.adminEmail,
    });
    if (result.ok) {
      return {
        manufacturerId: row.preferredManufacturerId,
        frameworkNumber: row.frameworkNumber,
        batchPosition: row.position,
      };
    }

    // ─── Red: sessizce düşülMEZ ───────────────────────────────────────────
    // "Anlaşmada yazan atölye bu işi basmadı" bir operasyon gerçeğidir ve
    // admin onu siparişin kendi notunda görmek zorunda.
    const [shop] = await db
      .select({ companyName: manufacturers.companyName })
      .from(manufacturers)
      .where(eq(manufacturers.id, row.preferredManufacturerId))
      .limit(1);
    const line = formatAdminNoteLine(
      frameworkPlacementNote({
        frameworkNumber: row.frameworkNumber,
        shopLabel: shop?.companyName ?? row.preferredManufacturerId,
        reason: result.reason,
      })
    );
    // EKLENİR, üzerine YAZILMAZ (ev kuralı, `order-status-policy.ts`): araya
    // giren [SLA]/[ATAMA]/[N12] bayrakları kaybolmasın.
    await db
      .update(orders)
      .set({
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                        THEN ${line} ELSE ${orders.adminNotes} || E'\n' || ${line} END`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, args.orderId));
    return null;
  } catch (e) {
    console.error(
      `[ÇERÇEVE] tercih edilen üretici denemesi düştü (${args.orderId}); sıralamaya düşülüyor`,
      e
    );
    return null;
  }
}
