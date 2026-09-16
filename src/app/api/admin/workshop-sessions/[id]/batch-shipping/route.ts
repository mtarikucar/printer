import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminActions, orders, workshopSessions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { batchShipSchema } from "@/lib/validators/workshop";
import { batchOrderFilter } from "@/lib/services/workshop-session";
import { WORKSHOP_CANCEL_SHIPPED_STATUSES } from "@/lib/config/workshop";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parti sevkiyatının KARGO FİRMASI + TAKİP NUMARASI düzeltmesi.
 *
 * NEDEN AYRI BİR UÇ VAR: atölye siparişinin kargosu tek tek düzeltilemez.
 * Siparişin kendi ucu (PATCH /api/admin/orders/[id]/ship) atölye siparişini
 * 409 code "workshop" ile reddediyor, geri alma da reddediyor, üreticinin kendi
 * kargo ucu da reddediyor — çünkü takip numarası siparişin değil PARTİNİN
 * kaydıdır (workshop_sessions.batch_carrier / batch_tracking_number) ve tek
 * siparişi değiştirmek o kaydı yalanlar. O kapılar konduğunda düzeltmenin
 * YAPILABİLECEĞİ hiçbir yer kalmamıştı: her ret "parti sevkiyatı üzerinden
 * düzeltin" diyordu, ama parti sevkiyatını yazan ekran onu yalnızca
 * GÖSTERİYORDU. Bu uç o boşluğu kapatır ve düzeltmeyi kaydın yaşadığı yere —
 * seans ekranına — koyar.
 *
 * NE YAPAR: parti kaydını düzeltir ve AYNI kaydı taşıyan siparişleri onunla
 * birlikte düzeltir. Siparişin aşaması, durumu ve parası DEĞİŞMEZ: bu bir
 * hareket değil, yanlış yazılmış bir numaranın düzeltilmesidir.
 *
 * NE YAPMAZ: kısmi sevkte ÖNCEKİ konsinyeyle gitmiş siparişlere dokunmaz.
 * Seans tek bir parti kaydı tutar (son sevkiyatın firması + numarası); daha
 * önce başka bir numarayla yola çıkmış koliler o numarayı taşır ve bu düzeltme
 * onları başka bir konsinyenin numarasına çevirmemelidir. Onlar yanıtta
 * `untouched` olarak sayılır ki admin sessizce eksik düzeltme yaptığını
 * sanmasın.
 *
 * İADE EDİLMİŞ SİPARİŞ: `batchOrderFilter` onu partinin dışında tutar (iade
 * `orders.status`e dokunmaz, bu yüzden kural payment_status'ten okunur). İade
 * edilmiş siparişin kaydı olduğu gibi kalır ve müşterisine bildirim gitmez —
 * iade edilmiş sipariş hiçbir yöne kımıldamaz.
 */
const correctionSchema = z.object({
  // Firma listesi toplu sevk ucunun şemasından OKUNUR (batchShipSchema):
  // düzeltme, sevkin kabul ettiğinden başka bir firma yazabilseydi parti kaydı
  // kendi ucunun doğrulamasına uymayan bir değere düşerdi. "elden" de dâhildir
  // — parti mekana elden teslim edilebilir.
  carrier: batchShipSchema.shape.carrier.optional(),
  trackingNumber: z.string().trim().max(60).optional(),
  /**
   * Müşteriye haber verilsin mi — KARARI ADMIN VERİR, varsayılan HAYIR.
   *
   * Atölye katılımcısı figürünü kargodan değil seansta MEKANDAN alır ve ona hiç
   * takip numarası gönderilmemiştir ("figürünüz atölyede sizi bekliyor").
   * Düzeltmeyi otomatik bildirmek, kargo beklemeyen bir katılımcıya takip
   * numarası göndermek olurdu. Yine de gerçek bir kargo gönderisi olan
   * partilerde admin bunu açabilir.
   */
  notifyCustomers: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz seans kimliği." }, { status: 400 });
    }

    // Bozuk gövde istemci hatasıdır: okunamayan JSON 500 değil 400 döner.
    const raw = await request.json().catch(() => null);
    if (raw === null || typeof raw !== "object") {
      return NextResponse.json(
        { error: "İstek gövdesi okunamadı (geçersiz JSON)." },
        { status: 400 }
      );
    }
    const parsed = correctionSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }

    const session = await db.query.workshopSessions.findFirst({
      where: eq(workshopSessions.id, id),
      columns: {
        id: true,
        batchCarrier: true,
        batchTrackingNumber: true,
        batchShippedAt: true,
      },
    });
    if (!session) {
      return NextResponse.json({ error: "Seans bulunamadı." }, { status: 404 });
    }
    // Düzeltilecek bir kayıt ancak GERÇEKLEŞMİŞ bir parti sevkiyatında vardır.
    // Sevk edilmemiş bir seansa firma/numara yazmak, hiç yola çıkmamış bir
    // sevkiyat uydurmak olurdu (toplu sevk ucunun da aynı kuralı var).
    if (!session.batchShippedAt) {
      return NextResponse.json(
        {
          error:
            "Bu seansta düzeltilecek bir parti sevkiyatı yok. Önce \"Toplu sevk\" ile partiyi sevk edin.",
        },
        { status: 400 }
      );
    }

    const nextCarrier = parsed.data.carrier ?? session.batchCarrier;
    if (!nextCarrier) {
      return NextResponse.json(
        { error: "Parti sevkiyatının kargo firması seçilmeli." },
        { status: 400 }
      );
    }
    // Elden teslimde takip numarası YOKTUR: firma "elden"e çevrildiğinde numara
    // da temizlenir, aksi hâlde müşteriye açılmayan bir takip bağlantısı ve
    // kimsenin sorgulayamadığı bir numara kalırdı.
    const nextTracking =
      nextCarrier === "elden"
        ? null
        : parsed.data.trackingNumber !== undefined
          ? parsed.data.trackingNumber.trim() || null
          : session.batchTrackingNumber;
    if (nextCarrier !== "elden" && !nextTracking) {
      return NextResponse.json(
        { error: "Kargoyla sevkte takip numarası zorunludur." },
        { status: 400 }
      );
    }

    const changed: string[] = [];
    if (nextCarrier !== session.batchCarrier) changed.push("kargo firması");
    if (nextTracking !== session.batchTrackingNumber) changed.push("takip numarası");
    // Değişen bir şey yoksa ne yazma, ne denetim satırı, ne de bildirim olur.
    if (changed.length === 0) {
      return NextResponse.json({ success: true, changed: [], corrected: 0, untouched: 0 });
    }

    const now = new Date();
    // Parti kaydı + siparişlerin kaydı TEK işlemde: ikisi ayrı düşerse ekran
    // partinin bir numarasını, müşterinin sipariş kaydı başka bir numarayı
    // gösterir — düzeltmenin ortadan kaldırmak için var olduğu durumun ta kendisi.
    const result = await db.transaction(async (tx) => {
      // OKUNAN DEĞERLERİN ÜZERİNDE (compare-and-set): iki admin (ya da iki sekme)
      // aynı anda düzeltirse kaybeden yazma HİÇ olmaz — yoksa biri diğerinin
      // numarasını sessizce ezer ve iki farklı bildirim giderdi. NULL karşılaştırması
      // eq() ile yapılamaz (SQL'de NULL = NULL asla doğru değildir).
      const [updatedSession] = await tx
        .update(workshopSessions)
        .set({
          batchCarrier: nextCarrier,
          batchTrackingNumber: nextTracking,
          updatedAt: now,
        })
        .where(
          and(
            eq(workshopSessions.id, id),
            session.batchCarrier === null
              ? isNull(workshopSessions.batchCarrier)
              : eq(workshopSessions.batchCarrier, session.batchCarrier),
            session.batchTrackingNumber === null
              ? isNull(workshopSessions.batchTrackingNumber)
              : eq(workshopSessions.batchTrackingNumber, session.batchTrackingNumber)
          )
        )
        .returning({ id: workshopSessions.id });
      if (!updatedSession) return { raced: true as const };

      // YALNIZ bu kaydı taşıyan siparişler düzeltilir (bkz. dosya başı: önceki
      // konsinye kendi numarasını korur).
      const corrected = await tx
        .update(orders)
        .set({ carrier: nextCarrier, trackingNumber: nextTracking, updatedAt: now })
        .where(
          and(
            batchOrderFilter(id),
            inArray(orders.status, [...WORKSHOP_CANCEL_SHIPPED_STATUSES]),
            session.batchCarrier === null
              ? isNull(orders.carrier)
              : eq(orders.carrier, session.batchCarrier),
            session.batchTrackingNumber === null
              ? isNull(orders.trackingNumber)
              : eq(orders.trackingNumber, session.batchTrackingNumber)
          )
        )
        .returning({
          id: orders.id,
          orderNumber: orders.orderNumber,
          userId: orders.userId,
          manufacturerId: orders.manufacturerId,
          status: orders.status,
          manufacturerStatus: orders.manufacturerStatus,
        });

      // Partide sevk edilmiş ama bu kaydı TAŞIMAYAN siparişler: sayısı admin'e
      // söylenir, sessizce atlanmaz.
      const shippedRows = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(batchOrderFilter(id), inArray(orders.status, [...WORKSHOP_CANCEL_SHIPPED_STATUSES]))
        );

      return {
        raced: false as const,
        corrected,
        untouched: shippedRows.length - corrected.length,
      };
    });

    if (result.raced) {
      return NextResponse.json(
        {
          error:
            "Parti sevkiyat kaydı bu sırada başka bir yerden değişti. Sayfayı yenileyip güncel kaydın üzerinden düzeltin.",
          code: "conflict",
        },
        { status: 409 }
      );
    }

    const carrierText = nextCarrier === "elden" ? "elden teslim" : nextCarrier;
    const before = `${session.batchCarrier ?? "—"}/${session.batchTrackingNumber ?? "—"}`;
    const after = `${nextCarrier}/${nextTracking ?? "—"}`;
    const note = `Atölye parti sevkiyatı düzeltildi (${changed.join(", ")}): ${before} → ${after} (seans ${id})`;

    // Yan etkiler COMMIT'ten SONRA ve tek tek yakalanır: bir bildirim hatası
    // yapılmış düzeltmeyi geri almamalı (toplu sevk ucundaki aynı ilke).
    for (const o of result.corrected) {
      await db
        .insert(adminActions)
        .values({ orderId: o.id, action: "edit", adminEmail, notes: note })
        .catch((e) =>
          console.error(`workshop batch-shipping: adminActions insert ${o.id} failed`, e)
        );

      if (parsed.data.notifyCustomers === true) {
        await notifyCustomer({
          userId: o.userId,
          orderId: o.id,
          type: "order_shipped",
          title: "Atölye sevkiyat bilgisi güncellendi",
          body:
            `${o.orderNumber} numaralı atölye siparişinizin sevkiyat bilgisi güncellendi: ${carrierText}` +
            (nextTracking ? ` · Takip no: ${nextTracking}` : ""),
        }).catch((e) => console.error("workshop batch-shipping notifyCustomer failed", e));
      }

      await emitOrderChanged({
        orderId: o.id,
        orderNumber: o.orderNumber,
        userId: o.userId,
        manufacturerId: o.manufacturerId,
        status: o.status,
        manufacturerStatus: o.manufacturerStatus,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      changed,
      corrected: result.corrected.length,
      untouched: result.untouched,
      carrier: nextCarrier,
      trackingNumber: nextTracking,
      customersNotified: parsed.data.notifyCustomers === true && result.corrected.length > 0,
    });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/admin/workshop-sessions/[id]/batch-shipping", ADMIN_ACTION_FAILED_ERROR);
  }
}
