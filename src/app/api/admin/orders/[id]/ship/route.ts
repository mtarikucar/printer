import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import {
  orders,
  adminActions,
  manufacturerEarnings,
  painterEarnings,
} from "@/lib/db/schema";
import { createAdminShipOrderSchema, revertReasonError } from "@/lib/validators/order";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import {
  shipRevertEarningAuditSentence,
  type ShipRevertEarningOutcome,
} from "@/lib/config/order-money";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { reverseEarning } from "@/lib/services/payouts";
import { reversePainterEarning } from "@/lib/services/painter-payouts";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { onBehalfOfPartner, partnerHoldingOrder } from "@/lib/services/on-behalf";
import { isCarrier } from "@/lib/services/carriers";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { sendSms } from "@/lib/services/sms";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Bozuk bir [id] Postgres'te 22P02 fırlatır ve HTML 500 olarak kaçar; kardeş
 * rotaların (model-approval, model-revisions, partner-messages) kapısının
 * aynısı burada da durur, böylece yanıt okunaklı Türkçe JSON kalır.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin kargolama.
 *
 * İKİ YOL vardır ve ayrımı siparişi kimin tuttuğu belirler:
 *
 *  1. Siparişi bir partner (üretici ya da boyacı) tutuyorsa, kargo O'NUN ADINA
 *     yapılır: istek tek servise (P2-C4, services/on-behalf.ts) devredilir, yani
 *     partnerin kendi rotasındaki kapıdan ve aynı hakediş servisinden geçer.
 *     Gerekçe zorunludur. Bu rota eskiden `isNull(manufacturerId)` şartı yüzünden
 *     üreticili siparişte HİÇ çalışmıyordu; partner panele girmediğinde sipariş
 *     kilitleniyordu.
 *  2. Partner yoksa (platformun kendi ürettiği sipariş) kargoyu platform yazar:
 *     `printing → shipped`. Burada partner hakedişi YOKTUR, çünkü iş partnere
 *     hiç gitmemiştir.
 *
 * Her iki yolda da kargo FİRMASI kaydedilir: firmasız bir takip numarasından
 * müşteriye gösterilecek takip bağlantısı kurulamıyor (services/carriers.ts).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locale = getRequestLocale(request);
    const d = getDictionary(locale);

    const a = await requireAdmin();


    if ("response" in a) return a.response;


    const session = { user: { email: a.session.user.email } };

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }

    try {
      const body = await request.json();
      const validated = createAdminShipOrderSchema(locale).parse(body);

      const current = await db.query.orders.findFirst({
        where: eq(orders.id, id),
        columns: {
          manufacturerId: true,
          manufacturerStatus: true,
          painterId: true,
          painterStatus: true,
        },
      });
      if (!current) {
        return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
      }

      // ─── 1. Partnerin elindeki sipariş: onun adına kargola ───
      if (partnerHoldingOrder(current) !== "none") {
        const result = await onBehalfOfPartner({
          orderId: id,
          action: "ship",
          adminEmail: session.user.email,
          reason: typeof body.reason === "string" ? body.reason : "",
          trackingNumber: validated.trackingNumber,
          carrier: validated.carrier,
        });
        if (!result.ok) {
          return NextResponse.json(
            { error: result.error, code: result.code },
            { status: result.httpStatus }
          );
        }
        return NextResponse.json({
          success: true,
          onBehalfOf: result.partner,
          status: result.status,
        });
      }

      // ─── 2. Platformun kendi ürettiği sipariş ───
      // notRefundedGuard(): a refund detaches the manufacturer, so a refunded
      // order that was mid-production lands at printing + no manufacturer —
      // exactly what this admin-fulfilment route accepts. Shipping it would
      // deliver goods already refunded (refund-end-state).
      const [order] = await db
        .update(orders)
        .set({
          status: "shipped",
          trackingNumber: validated.trackingNumber,
          carrier: validated.carrier,
          shippedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.status, "printing"),
            isNull(orders.manufacturerId),
            notRefundedGuard()
          )
        )
        .returning();

      if (!order) {
        // Name the refund when it is the reason; the generic 400 would send the
        // admin hunting for a status problem that is not there.
        if (await isOrderRefunded(id)) {
          return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
        }
        return NextResponse.json(
          { error: "Sipariş baskı aşamasında değil." },
          { status: 400 }
        );
      }

      await db.insert(adminActions).values({
        orderId: id,
        action: "ship",
        adminEmail: session.user.email,
        notes: `Kargo: ${validated.carrier} — Takip: ${validated.trackingNumber}`,
      });

      await emitOrderChanged({
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        manufacturerId: order.manufacturerId,
        status: order.status,
      });

      // Send shipping email
      await getEmailQueue().add("shipped", {
        type: "order_shipped",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        finish: order.finish,
        trackingNumber: validated.trackingNumber,
        locale,
      });

      return NextResponse.json({ success: true });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "ZodError") {
        return NextResponse.json({ error: (error as Error & { errors?: unknown }).errors }, { status: 400 });
      }
      console.error("Ship order failed:", error);
      return NextResponse.json(
        { error: d["api.order.shipFailed"] },
        { status: 500 }
      );
    }
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/ship", ADMIN_ACTION_FAILED_ERROR);
  }
}

/** Kargo geri almanın neden yapılamadığı — tek hesap, iki tüketici. */
type ShipRevertBlockCode =
  | "not_found"
  | "refunded"
  | "not_shipped"
  | "workshop"
  | "earning_paid";

interface ShipRevertBlock {
  code: ShipRevertBlockCode;
  error: string;
  httpStatus: number;
}

/**
 * Parti kaydının sahibi tek yerdir; iki reddin de sonu ORAYI gösterir ki admin
 * aynı siparişte iki farklı adres duymasın.
 */
const WORKSHOP_BATCH_FIX_HINT =
  "Düzeltmeyi atölye seansı ekranından, parti sevkiyatı üzerinden yapın.";

const WORKSHOP_REVERT_ERROR =
  "Bu sipariş bir atölye partisiyle sevk edildi; kargosu tek tek geri alınamaz. " +
  WORKSHOP_BATCH_FIX_HINT;

/**
 * Aynı sınırın DÜZELTME (PATCH) ucundaki hâli.
 *
 * Parti sevkiyatı takip numarasını ve firmayı HEM seansın kaydına
 * (workshop_sessions.batch_carrier / batch_tracking_number) HEM partideki her
 * siparişe aynı değerlerle yazar: tek irsaliye, tek konsinye. Tek siparişin
 * numarasını değiştirmek o kaydı yalanlar — üstelik katılımcı figürünü mekandan
 * teslim alır, gönderiyi tek tek takip etmez. Geri alma bu kaydı korurken
 * düzeltmenin serbest kalması, iki ucun AYNI kayıt üzerinde ters karar
 * vermesiydi.
 */
const WORKSHOP_TRACKING_EDIT_ERROR =
  "Bu sipariş bir atölye partisiyle sevk edildi; kargo bilgisi tek tek düzeltilemez — " +
  "takip numarası ve kargo firması partinin kendi kaydından gelir. " +
  WORKSHOP_BATCH_FIX_HINT;

/**
 * Kargo geri almanın TEK karar yeri: DELETE reddetmek için, GET ekranın düğmeyi
 * hiç açmaması için okur.
 *
 * Neden tek yerde: karar iki yere yazıldığında ekran, sunucunun KESİNLİKLE
 * reddedeceği bir düğmeyi açık tutuyordu. Atölye partisiyle sevk edilmiş
 * siparişte "Kargoyu geri al" her zaman 409 dönüyor, admin bunu ancak
 * tıkladıktan sonra öğreniyordu. Kural burada durduğu sürece ekranın gösterdiği
 * şey ile sunucunun yaptığı şey ayrışamaz.
 */
async function loadShipRevertState(id: string) {
  const row = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      id: true,
      status: true,
      paymentStatus: true,
      manufacturerId: true,
      manufacturerStatus: true,
      painterId: true,
      painterStatus: true,
      workshopSessionId: true,
    },
  });
  if (!row) {
    return {
      row: null,
      revertsPainter: false,
      revertsManufacturer: false,
      block: {
        code: "not_found",
        error: "Sipariş bulunamadı.",
        httpStatus: 404,
      } satisfies ShipRevertBlock,
    };
  }

  // Kargodan önceki aşama: boyacıdaysa boyama QC onayı, üreticideyse üretici
  // QC onayı, platform siparişinde baskı.
  const revertsPainter = row.painterStatus === "shipped";
  const revertsManufacturer = !revertsPainter && row.manufacturerStatus === "shipped";

  let block: ShipRevertBlock | null = null;
  if (isRefunded(row)) {
    // İade edilen sipariş HİÇBİR yere kımıldamaz (refund-end-state). Geri alma
    // da bir harekettir, üstelik siparişi üretim tarafına GERİ SOKAR: iade
    // `status`e dokunmadığı için sipariş 'shipped'te kalıyor, geri alma da onu
    // printing/quality_check/painting aşamasına döndürüyordu.
    block = { code: "refunded", error: REFUNDED_ORDER_ERROR, httpStatus: 409 };
  } else if (row.status !== "shipped") {
    block = {
      code: "not_shipped",
      error: "Sipariş 'kargolandı' durumunda değil.",
      httpStatus: 400,
    };
  } else if (row.workshopSessionId) {
    // Atölye partisi TEK TEK geri alınamaz: parti kaydı (workshop_sessions
    // batch_carrier/batch_tracking_number/batch_shipped_at) "bu parti şu firmayla
    // sevk edildi" der. Tek siparişi geri almak o kaydı yalanlar; üstelik iki
    // tekil kargo yolu da atölye siparişini reddettiği için (services/on-behalf
    // ve üreticinin kendi ucu) sipariş bir daha ancak yeni bir parti sevkiyatıyla
    // kımıldayabilirdi. Düzeltme, partiyi yazan ekrandan yapılır.
    block = { code: "workshop", error: WORKSHOP_REVERT_ERROR, httpStatus: 409 };
  } else {
    // Ödenmiş hakediş varsa geri alma yapılmaz (aşağıdaki para sınırı) — ama
    // soru YALNIZ geri almanın dokunacağı hakediş için sorulur. Boyamalı
    // siparişte üreticinin baskı payı boyacıya devir anında doğar ve çoğu zaman
    // boyacı kargolamadan çok önce ödenir; iki hakedişi birden aramak, yalnız
    // painterEarnings'i geri çevirecek bir boyacı-kargo geri almasını ödenmiş
    // ÜRETİCİ payı yüzünden kalıcı olarak reddediyordu. Bakılan satır, sonra
    // gerçekten geri çevrilen satırın aynısıdır.
    const paidEarning = revertsPainter
      ? await db.query.painterEarnings.findFirst({
          where: and(eq(painterEarnings.orderId, id), eq(painterEarnings.status, "paid")),
          columns: { id: true },
        })
      : revertsManufacturer
        ? await db.query.manufacturerEarnings.findFirst({
            where: and(
              eq(manufacturerEarnings.orderId, id),
              eq(manufacturerEarnings.status, "paid")
            ),
            columns: { id: true },
          })
        : null;
    if (paidEarning) {
      block = {
        code: "earning_paid",
        error: `Bu siparişin ${
          revertsPainter ? "boyacı" : "üretici"
        } hakedişi ÖDENDİ; kargo geri alınamaz. Ödenen tutarın düzeltmesi elle yapılmalı.`,
        httpStatus: 409,
      };
    }
  }

  return { row, revertsPainter, revertsManufacturer, block };
}

/**
 * Geri almanın partner hakedişine GERÇEKTEN ne yaptığı. Denetim kaydına yazılan
 * para cümlesi de bu sonuçtan türer ve cümlelerin kendisi config/order-money.ts'te
 * durur: kaydı YAZAN ile okuyan (services/order-money.ts) aynı sabiti paylaşır,
 * yani "hakediş geri çevrildi" cümlesi ikisinde ayrışamaz.
 */
type EarningReversalOutcome = ShipRevertEarningOutcome;

/**
 * Partnere giden para cümlesi. Üreticiye "sipariş", boyacıya "iş" denir; ikisi
 * de aynı sonuçtan türer ki bildirim ile denetim kaydı ayrışmasın.
 */
function earningReversalPartnerLine(
  outcome: EarningReversalOutcome,
  subject: "sipariş" | "iş"
): string {
  switch (outcome) {
    case "reversed":
      // reverseEarning/reversePainterEarning satırı SİLMEZ, durumunu "reversed"
      // yapar ve orada bırakır; yeniden tahakkuk sipariş başına
      // onConflictDoNothing yazdığı için aynı siparişte bir daha satır AÇMAZ,
      // ödeme kapanışı da "reversed" bir satırı bilerek diriltmez. Yani
      // "yeniden kargolanınca yeniden doğar" cümlesi yanlıştı: partner sessizce
      // hiç ödenmeyecekti. Düzeltme Faz 6'ya kadar elle yapılır.
      return (
        `Bu ${subject}e ait bekleyen hakediş geri çevrildi ve kaydı “geri çevrildi” olarak kalır. ` +
        `${subject === "iş" ? "İş" : "Sipariş"} yeniden kargolandığında hakediş kendiliğinden yeniden doğmaz; ` +
        "hak ettiğiniz tutar Figurünica ekibince elle düzeltilir."
      );
    case "already_reversed":
      return (
        `Bu ${subject}e ait hakediş DAHA ÖNCE geri çevrilmişti; bu işlem hakedişinizde bir değişiklik yapmadı. ` +
        "Hak ettiğiniz tutar Figurünica ekibince elle düzeltilir."
      );
    case "failed":
      return (
        `Bu ${subject}e ait hakediş geri çevrilemedi (teknik hata kaydedildi); ` +
        "tutar Figurünica ekibince elle düzeltilecek."
      );
    case "none":
      return `Bu ${subject}e ait bir hakediş doğmamıştı; bu işlem hakedişinizde bir değişiklik yapmadı.`;
  }
}

/**
 * Kargo geri almanın mümkün olup olmadığını EKRANA veren uç.
 *
 * Neden bir uç: sayfa sunucu bileşeni olarak siparişi kendi okuyor ama geri
 * almanın kuralı (iade, durum, atölye partisi, ödenmiş hakediş) bu rotada
 * duruyor. Kural kopyalanırsa ikisi ayrışır; bu uç kopyalamak yerine kuralın
 * kendisini verir: `canRevert` false ise `reason` OLDUĞU GİBİ gösterilebilir ve
 * düğme hiç açılmaz. DELETE ile TEK kaynaktan (loadShipRevertState) beslenir,
 * yani ekranın gördüğü ile sunucunun yaptığı ayrışamaz.
 *
 * DURUM (bu fazın kapanmamış işi): admin sipariş sayfası bu ucu HENÜZ
 * çağırmıyor; koşulu kendi içinde yeniden kuruyor ve yalnız atölye ayağını
 * kapsıyor (client.tsx'teki canRevertShipping). Bu yüzden iade edilmiş ya da
 * hakedişi ödenmiş bir siparişte "Kargoyu geri al" düğmesi hâlâ açık görünüp
 * tıklandığında 409 dönüyor — tam olarak bu ucun engellemek için var olduğu
 * ayrışma. Sayfa bu ucu çağırır çağırmaz o kopya silinmelidir.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }

    const { row, block } = await loadShipRevertState(id);
    if (!row) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }

    return NextResponse.json({
      canRevert: block === null,
      code: block?.code ?? "ok",
      reason: block?.error ?? null,
      // Ekranın "bu bir atölye siparişi" demesi için: düğmeyi gizlemek yerine
      // atölye seansına yönlendirmek isteyebilir.
      workshopSessionId: row.workshopSessionId,
    });
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/orders/[id]/ship", ADMIN_READ_FAILED_ERROR);
  }
}

/**
 * Kargoyu geri al: shipped → kargolanmadan önceki aşama.
 *
 * Neden gerekiyor: yanlış siparişe takip numarası girmek ya da partnerin hiç
 * yapmadığı bir kargoyu onun adına işaretlemek geri alınamıyordu; sipariş
 * kalıcı olarak "kargolandı" kalıyor, müşteri takip numarasını boşuna
 * kovalıyordu.
 *
 * PARA SINIRI: kargo, partner hakedişinin doğduğu andır. Geri alma, hakedişi
 * iadenin kullandığı AYNI servisle (reverseEarning / reversePainterEarning)
 * geri çevirir — yeni bir para kaydı UYDURULMAZ (düzeltme kalemleri Faz 6'da
 * gelir). Hakediş ÖDENDİYSE geri alma reddedilir: ödenmiş parayı sessizce
 * yok saymak, partnerin hesabını bozar. O durumda düzeltme elle yapılır.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    // Gerekçe ZORUNLU: geri alma, müşteriye gitmiş bir "kargolandı" bildirimini
    // yalanlar ve partner hakedişini geri çevirir; sebebi yalnız denetim
    // kaydında kalır. Metin iki geri alma ucunda da tek yerden gelir.
    const reasonError = revertReasonError(body.reason);
    if (reasonError) {
      return NextResponse.json({ error: reasonError }, { status: 400 });
    }
    const reason = String(body.reason).trim();

    // Kural TEK yerde: GET aynı hesabı ekrana verir, bu uç onu uygular. Reddin
    // kendisi de (iade / durum / atölye partisi / ödenmiş hakediş) oradan gelir.
    const { row: current, revertsPainter, revertsManufacturer, block } =
      await loadShipRevertState(id);
    if (block || !current) {
      return NextResponse.json(
        {
          error: block?.error ?? "Sipariş bulunamadı.",
          code: block?.code ?? "not_found",
        },
        { status: block?.httpStatus ?? 404 }
      );
    }

    const nextStatus = revertsPainter
      ? ("painting" as const)
      : revertsManufacturer
        ? ("quality_check" as const)
        : ("printing" as const);

    const [order] = await db
      .update(orders)
      .set({
        status: nextStatus,
        shippedAt: null,
        trackingNumber: null,
        carrier: null,
        ...(revertsPainter ? { painterStatus: "qc_approved" as const } : {}),
        ...(revertsManufacturer ? { manufacturerStatus: "qc_approved" as const } : {}),
        updatedAt: new Date(),
      })
      // notRefundedGuard(): yukarıdaki okuma iadeyi zaten reddetti; bu, o okumadan
      // SONRA araya giren bir iadeye karşı atomik ikinci kapıdır. İade siparişi
      // 'shipped'te bıraktığı için durum şartı tek başına onu durdurmaz.
      .where(and(eq(orders.id, id), eq(orders.status, "shipped"), notRefundedGuard()))
      .returning();

    if (!order) {
      // İade araya girdiyse sebebini söyle; "durumunda değil" mesajı admin'i
      // olmayan bir durum sorununu aramaya gönderirdi.
      if (await isOrderRefunded(id)) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json(
        { error: "Sipariş 'kargolandı' durumunda değil." },
        { status: 400 }
      );
    }

    // Bekleyen (ödenmemiş) hakediş, iadenin kullandığı servisle geri çevrilir.
    //
    // NE OLDUĞUNU SÖYLEYEBİLMEK İÇİN ÖNCE NE OLACAĞINA BAKILIR: reverseEarning /
    // reversePainterEarning yalnız "pending" (ne ödenmiş ne geri çevrilmiş)
    // satırlara dokunur ve sıfır satırda SESSİZCE başarılı olur. Satırın yalnızca
    // VAR olmasına bakmak, ikinci bir geri almada "bekleyen hakediş geri
    // çevrildi" diyen bir denetim satırı ve iki partner bildirimi üretiyordu —
    // oysa satır çoktan "reversed"dı ve bu işlem paraya HİÇ dokunmamıştı. Sorgu,
    // servisin kendi süzgecinin aynısıdır.
    let earningReversal: EarningReversalOutcome = "none";
    if (revertsManufacturer) {
      const pending = await db.query.manufacturerEarnings.findFirst({
        where: and(
          eq(manufacturerEarnings.orderId, id),
          ne(manufacturerEarnings.status, "reversed"),
          ne(manufacturerEarnings.status, "paid")
        ),
        columns: { id: true },
      });
      if (pending) {
        earningReversal = await reverseEarning(id)
          .then(() => "reversed" as const)
          .catch((e) => {
            // Başarısız bir geri çevirmeyi "geri çevrildi" diye yazmak, elde
            // mutabakat yapan admin'i yanıltır.
            console.error("ship revert: reverseEarning failed", e);
            return "failed" as const;
          });
      } else {
        const existing = await db.query.manufacturerEarnings.findFirst({
          where: eq(manufacturerEarnings.orderId, id),
          columns: { id: true },
        });
        earningReversal = existing ? "already_reversed" : "none";
      }
    }
    if (revertsPainter) {
      const pending = await db.query.painterEarnings.findFirst({
        where: and(
          eq(painterEarnings.orderId, id),
          ne(painterEarnings.status, "reversed"),
          ne(painterEarnings.status, "paid")
        ),
        columns: { id: true },
      });
      if (pending) {
        earningReversal = await reversePainterEarning(id)
          .then(() => "reversed" as const)
          .catch((e) => {
            console.error("ship revert: reversePainterEarning failed", e);
            return "failed" as const;
          });
      } else {
        const existing = await db.query.painterEarnings.findFirst({
          where: eq(painterEarnings.orderId, id),
          columns: { id: true },
        });
        earningReversal = existing ? "already_reversed" : "none";
      }
    }

    await db
      .insert(adminActions)
      .values({
        orderId: id,
        // admin_action_type bir pg enum'u; bu faz migration açmıyor, nötr "edit"
        // kullanılır ve gerçek anlam notta durur.
        action: "edit",
        adminEmail,
        notes:
          `Kargo geri alındı → "${nextStatus}". Takip numarası ve kargo firması temizlendi. ` +
          // Kaydı okuyan para kartı bu cümleyi TAM metniyle arar; üstelik geri
          // alma yalnızca kargolayan partnerin hakedişini çevirir, o yüzden cümle
          // hangi paya dokunulduğunu da yazar. Kayıt siparişe düşer, tek bir
          // cümlenin İKİ payın birden sebebi sayılmaması buna bağlı.
          shipRevertEarningAuditSentence(
            earningReversal,
            revertsPainter ? "painter" : revertsManufacturer ? "manufacturer" : null
          ) +
          ` Gerekçe: ${reason}`,
      })
      .catch((e) => console.error("ship revert: adminActions insert failed", e));

    // Partner, kargo kaydının geri alındığını ve parasına NE OLDUĞUNU kendi
    // panelinden görmeli. Cümle denetim kaydıyla aynı sonuçtan türer: partnere
    // "hakedişiniz geri çevrildi" deyip denetim kaydına "değişiklik yok" yazmak
    // (ya da tersi) partnerin hesabıyla bizimkini ayrıştırırdı.
    if (revertsManufacturer && order.manufacturerId) {
      await notifyManufacturer({
        manufacturerId: order.manufacturerId,
        type: "system_announcement",
        subject: `Kargo geri alındı — ${order.orderNumber}`,
        body:
          `${order.orderNumber} numaralı siparişin kargo kaydı geri alındı ve sipariş QC onaylı aşamaya döndürüldü.\n` +
          `İşlemi yapan: ${adminEmail}\nGerekçe: ${reason}\n\n` +
          earningReversalPartnerLine(earningReversal, "sipariş"),
        orderId: id,
      }).catch((e) => console.error("ship revert: notifyManufacturer failed", e));
    }
    if (revertsPainter && order.painterId) {
      await notifyPainter({
        painterId: order.painterId,
        type: "system_announcement",
        subject: `Kargo geri alındı — ${order.orderNumber}`,
        body:
          `${order.orderNumber} numaralı işin kargo kaydı geri alındı ve iş QC onaylı aşamaya döndürüldü.\n` +
          `İşlemi yapan: ${adminEmail}\nGerekçe: ${reason}\n\n` +
          earningReversalPartnerLine(earningReversal, "iş"),
        orderId: id,
      }).catch((e) => console.error("ship revert: notifyPainter failed", e));
    }

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: order.status,
      manufacturerStatus: order.manufacturerStatus,
    }).catch((e) => console.error("ship revert: emit failed", e));

    return NextResponse.json({
      success: true,
      status: order.status,
      // "Gerçekten geri çevrildi mi" sorusunun cevabı; ayrımı (zaten geri
      // çevrilmişti / hiç doğmamıştı / çevrilemedi) earningReversal'da durur.
      reversedEarning: earningReversal === "reversed",
      earningReversal,
    });
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/admin/orders/[id]/ship", ADMIN_ACTION_FAILED_ERROR);
  }
}


/**
 * Kargo bilgisini DÜZELT: takip numarası ve/veya kargo firması.
 *
 * Neden gerekiyor: takip numarası elle giriliyor ve yanlış girilebiliyor;
 * partner de zaman zaman gönderiyi başka bir firmayla çıkarıyor. Düzeltme yolu
 * olmadığı için müşteri çalışmayan bir takip numarasıyla kalıyordu ve tek çare
 * siparişi geri alıp yeniden kargolamaktı — bu da partner hakedişini gereksiz
 * yere geri çevirip yeniden doğuruyordu.
 *
 * Bu bir DÜZELTMEDİR, ileri bir adım değil: durum değişmez, hakediş doğmaz,
 * geri çevrilmez. Yalnız kayıt düzelir ve müşteri yeni numarayı öğrenir.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locale = getRequestLocale(request);

    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      trackingNumber?: unknown;
      carrier?: unknown;
      /** Varsayılan: müşteri bilgilendirilir. Yazım hatası düzeltmesinde kapatılabilir. */
      notify?: unknown;
      reason?: unknown;
    };

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        orderNumber: true,
        userId: true,
        email: true,
        phone: true,
        customerName: true,
        finish: true,
        status: true,
        paymentStatus: true,
        trackingNumber: true,
        carrier: true,
        workshopSessionId: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    // Düzeltilecek bir kargo kaydı ancak kargolanmış siparişte vardır.
    if (order.status !== "shipped" && order.status !== "delivered") {
      return NextResponse.json(
        { error: "Sipariş henüz kargolanmadı; düzeltilecek kargo bilgisi yok." },
        { status: 400 }
      );
    }
    // İade edilen sipariş hiçbir yere kımıldamaz (refund-end-state). Burada asıl
    // zarar BİLDİRİMDİR: iade `status`e dokunmadığı için sipariş 'shipped'te
    // kalır, düzeltme kabul edilirdi ve müşteriye parası iade edilmiş bir gönderi
    // için "kargo bilginiz güncellendi" e-postası + SMS'i giderdi.
    if (isRefunded(order)) {
      return NextResponse.json(
        { error: REFUNDED_ORDER_ERROR, code: "refunded" },
        { status: 409 }
      );
    }
    // Atölye partisi: DÜZELTME de geri alma kadar kapalıdır. İki uç aynı kayda
    // (parti sevkiyatı) bakar; biri onu korurken diğerinin serbest kalması, tek
    // siparişin takip numarasını partinin kaydıyla çelişecek şekilde
    // değiştirebiliyordu. Kapı burada, yazmadan önce: aşağıdaki compare-and-set
    // yalnız YARIŞI kapatır, bu kararı değil.
    if (order.workshopSessionId) {
      return NextResponse.json(
        { error: WORKSHOP_TRACKING_EDIT_ERROR, code: "workshop" },
        { status: 409 }
      );
    }

    const changes: Record<string, unknown> = {};
    const changed: string[] = [];

    if (body.trackingNumber !== undefined) {
      const next = String(body.trackingNumber).trim();
      if (!next || next.length > 60) {
        return NextResponse.json(
          { error: "Takip numarası boş olamaz ve en fazla 60 karakter olabilir." },
          { status: 400 }
        );
      }
      if (next !== order.trackingNumber) {
        changes.trackingNumber = next;
        changed.push("takip numarası");
      }
    }
    if (body.carrier !== undefined) {
      const raw = String(body.carrier);
      // DOĞRULAMA YALNIZ GERÇEK BİR DEĞİŞİKLİĞE: kayıtta duran firma
      // carrierEnum'da olup isCarrier'da olmayabilir ('elden' — elden teslimin
      // takip bağlantısı yok). Ekran mevcut firmayı olduğu gibi geri gönderdiği
      // için, yalnız takip numarasını düzelten admin "Geçersiz kargo firması."
      // yiyordu. Değişmeyen bir değeri doğrulamanın anlamı yok.
      //
      // NOT: bunu ilk ortaya çıkaran atölye partisiydi (müşteri bacağına 'elden'
      // yazar), ama atölye siparişi artık yukarıdaki parti kapısında duruyor;
      // kural burada eski/elle girilmiş kayıtlar için kalır.
      if (raw !== order.carrier) {
        if (!isCarrier(raw)) {
          return NextResponse.json({ error: "Geçersiz kargo firması." }, { status: 400 });
        }
        changes.carrier = raw;
        changed.push("kargo firması");
      }
    }

    // Değişen bir şey yoksa ne yazma ne denetim satırı ne de müşteriye ikinci bir
    // "kargolandı" bildirimi olur.
    if (changed.length === 0) {
      return NextResponse.json({ success: true, changed: [] });
    }

    // ATOMİK ve OKUDUĞU DEĞERLERİN ÜZERİNDE (compare-and-set).
    //
    // Durum şartı tek başına YETMEZ: araya giren bir DELETE /ship'i yakalar (durum
    // değişir) ama araya giren ikinci bir PATCH /ship'i YAKALAMAZ, çünkü orada
    // durum aynı kalır. İki admin (ya da iki sekme) aynı anda takip numarası
    // düzeltince ikisi de 200 alıyor, biri diğerinin değerini sessizce eziyor ve
    // müşteriye BİRBİRİNİ TUTMAYAN iki "kargo bilginiz güncellendi" bildirimi
    // gidiyordu. WHERE artık okunan takip numarası + firmayı da şart koşuyor:
    // kaybeden yazma HİÇ olmaz, dolayısıyla bildirim de gitmez (bildirim bloğu
    // yalnız gerçekleşen yazmanın arkasındadır).
    //
    // null karşılaştırması eq() ile yapılamaz (SQL'de NULL = NULL asla doğru
    // değildir), o yüzden boş alanlar isNull() ile eşlenir.
    const [updated] = await db
      .update(orders)
      .set({ ...changes, updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.status, order.status),
          order.trackingNumber === null
            ? isNull(orders.trackingNumber)
            : eq(orders.trackingNumber, order.trackingNumber),
          order.carrier === null ? isNull(orders.carrier) : eq(orders.carrier, order.carrier),
          // Okumadan sonra araya giren bir iadeye karşı: yukarıdaki iade kapısı
          // okunan satır üzerindeydi, bu yazmanın kendisinde durur.
          notRefundedGuard()
        )
      )
      .returning();

    if (!updated) {
      // Reddin SEBEBİNİ söyle: admin aynı ekranda hangi kaydın kazandığını
      // görmeden aynı düzeltmeyi tekrar denerdi.
      const now = await db.query.orders.findFirst({
        where: eq(orders.id, id),
        columns: {
          status: true,
          paymentStatus: true,
          trackingNumber: true,
          carrier: true,
        },
      });
      if (!now) {
        return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
      }
      if (isRefunded(now)) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json(
        {
          error:
            "Sipariş siz düzenlerken başka bir işlemle değişti; düzeltme YAZILMADI (yoksa girdiğiniz bilgi diğerini sessizce ezerdi). " +
            `Kayıt şu an: ${now.carrier ?? "firma yok"} / ${now.trackingNumber ?? "takip yok"}` +
            `${now.status !== order.status ? ` (durum: ${now.status})` : ""}. ` +
            "Sayfayı yenileyip yeniden deneyin.",
          code: "stale_status",
        },
        { status: 409 }
      );
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    await db
      .insert(adminActions)
      .values({
        orderId: id,
        // admin_action_type bir pg enum'u; bu faz migration açmıyor, nötr "edit"
        // kullanılır ve gerçek anlam notta durur.
        action: "edit",
        adminEmail,
        notes:
          `Kargo bilgisi düzeltildi (${changed.join(", ")}): ` +
          `${order.carrier ?? "firma yok"}/${order.trackingNumber ?? "takip yok"} → ` +
          `${updated.carrier ?? "firma yok"}/${updated.trackingNumber ?? "takip yok"}` +
          `${reason ? ` — Gerekçe: ${reason}` : ""}`,
      })
      .catch((e) => console.error("tracking edit: adminActions insert failed", e));

    // Müşteri yanlış numarayı kovalamayı bıraksın: düzeltme kendisine bildirilir.
    const notify = body.notify !== false;
    if (notify && updated.trackingNumber) {
      await notifyCustomer({
        userId: updated.userId,
        orderId: updated.id,
        type: "order_shipped",
        title: "Kargo bilginiz güncellendi",
        body: `${updated.orderNumber} numaralı siparişinizin kargo bilgisi güncellendi. Takip no: ${updated.trackingNumber}`,
      }).catch((e) => console.error("tracking edit: notifyCustomer failed", e));
      await sendSms(
        updated.phone,
        `Figurünica: ${updated.orderNumber} siparişinizin kargo bilgisi güncellendi. Takip: ${updated.trackingNumber}`
      ).catch((e) => console.error("tracking edit: sendSms failed", e));
      await getEmailQueue()
        .add("shipped", {
          type: "order_shipped",
          to: updated.email,
          orderNumber: updated.orderNumber,
          customerName: updated.customerName,
          finish: updated.finish,
          trackingNumber: updated.trackingNumber,
          locale,
        })
        .catch((e) => console.error("tracking edit: shipped email enqueue failed", e));
    }

    await emitOrderChanged({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      userId: updated.userId,
      manufacturerId: updated.manufacturerId,
      status: updated.status,
    }).catch((e) => console.error("tracking edit: emit failed", e));

    return NextResponse.json({
      success: true,
      changed,
      trackingNumber: updated.trackingNumber,
      carrier: updated.carrier,
      customerNotified: notify,
    });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/admin/orders/[id]/ship", ADMIN_ACTION_FAILED_ERROR);
  }
}
