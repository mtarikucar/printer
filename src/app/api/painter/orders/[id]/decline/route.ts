import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import {
  flagPainterManualAssignment,
  repickPainterAfterDecline,
  type PainterRepickResult,
} from "@/lib/services/painter-auto-assign";
import { formatAdminNoteLine, isRefunded } from "@/lib/config/order-status-policy";

// Painter declines an assigned job: the painter is detached and the order goes
// to the NEXT painter automatically. The decliner is recorded so the ranking
// skips them, and once the decline cap (PAINTER_MAX_DECLINES) is reached the
// order waits for the admin.
//
// İŞ ÜRETİCİYE GERİ DÖNMEZ (sahibin kararı). Eski davranışta ret, siparişi
// üreticinin "boyacıya gönder" adımına geri sarıyor ve üreticiye "lütfen başka
// bir boyacıya gönderin" diye yazıyordu: kendi hatası olmayan bir iş için
// üretici ikinci kez boyacı seçmek zorunda kalıyordu. Artık sıradaki boyacıyı
// sistem seçer (painter-auto-assign.ts); durum `quality_check`e sarılır çünkü
// baskı fiziksel olarak hâlâ üreticidedir ve yeni devir oradan yapılacaktır.
//
// A decline is cleanup, so it is never refused on a refunded job. But on a
// refunded order the detach is ALL that happens: the status is not rewound
// (refund-end-state) and the painter is not written to the order's blocklist —
// the job goes to no one else, so the record would only mark the painter.
// The manufacturer's notice changes too: a refunded order cannot be sent to
// another painter (send-to-painter answers 409), so asking them to do it
// would send them into a refusal.
// İade edilmiş siparişte bu koparmanın SİPARİŞ ÜSTÜNDEKİ tek izi. Boyacının
// kendi eylem günlüğüne bir `decline` satırı düşüyor (puana girmez), ama o satır
// boyacının siciline yazılır: siparişe bakan yönetici, işin neden boyacısız
// kaldığını sipariş sayfasında hiçbir yerde okuyamıyordu. Cümle üretici
// ikizleriyle (CANCEL_NOTE_REFUNDED / DECLINE_NOTE_REFUNDED) aynı kalıpta ve
// olanı söylüyor: sipariş üreticiye GERİ DÖNMEDİ.
const DECLINE_NOTE_REFUNDED =
  "[RET] Boyacı işi bıraktı — sipariş iade edilmiş olduğu için üreticinin kalite kontrol adımına GERİ DÖNMEDİ, iş kapandı. Boyacıya ceza uygulanmadı.";

// Boyacıya dönen dürüst cevap: iade edilmiş siparişte "başka bir boyacıya
// gönderilecek" ya da "üretici yeniden yönlendirecek" demek yalan olurdu.
const REFUNDED_DECLINE_MESSAGE =
  "Bu sipariş iade edilmiş. İşi bıraktınız ve iş listenizden düştü; başka bir boyacıya yönlendirilmeyecek ve bu bırakma güvenilirlik puanınıza işlenmedi.";

/** Yeniden yerleştirme yapılamadığında dönen sebep (admin kuyruğu dalı). */
type RepickAdminQueueReason = Extract<
  PainterRepickResult,
  { action: "admin_queue" }
>["reason"];

/**
 * ÜRETİCİYE GİDEN CÜMLE: HER ÜRETİCİYE KENDİ SİPARİŞİNİN GERÇEĞİ.
 *
 * Ölçülen kusur: cümle yalnız `reassigned` ve `parcelInTransit` ikilisine
 * bakıyordu, bu yüzden boyamayı KENDİ atölyesinde yapan üretici de "yeni boyacı
 * ataması yönetici tarafından yapılacak; baskıyı elinizde tutun ve beklemede
 * kalın" cümlesini alıyordu. Oysa o siparişte otomatik kapı sonsuza kadar
 * `paints_in_house` ile atlar (flags.ts · painterAssignRowGate): beklenen atama
 * HİÇ gelmeyecek. Üretici, elindeki baskıyı boyayıp kargolayabilecekken
 * bekletiliyordu — fazın kapatmaya çalıştığı "sessiz bekleme", burada "yüksek
 * sesli ama YANLIŞ talimat"a dönüşmüştü.
 *
 * Kural: cümle, üreticinin BUNDAN SONRA NE YAPACAĞINI söyler. Sebebin kendisi
 * (sözlük: PAINTER_ASSIGN_*_LABELS_TR) admin notunun işidir; üreticiye gereken
 * tek şey kendi adımıdır. Sebep bilinmeyen/artık yol kalmayan hâllerde
 * ("anahtar kapalı", "uygun boyacı kalmadı", üst sınır, arızalar) sipariş
 * gerçekten admin kuyruğunda bekler ve yerleştirmeyi bir insan yapar
 * (painter-auto-assign.ts · painterUnplacedNeedsAdmin koparma sonrası her
 * sebebi admin'e çıkarır), yani oradaki eski cümle DOĞRUDUR ve korunur.
 */
function manufacturerDeclineNotice(args: {
  orderNumber: string;
  reassigned: boolean;
  parcelInTransit: boolean;
  reason: RepickAdminQueueReason | null;
}): string {
  const { orderNumber, reassigned, parcelInTransit, reason } = args;
  const opener = `${orderNumber} numaralı siparişin boyacısı işi almadı.`;
  if (reassigned) {
    return (
      `${opener} Sipariş otomatik olarak başka bir boyacıya atandı; yeni boyacının ` +
      `teslimat adresi ayrı bir bildirimde size iletildi. Sizden bir işlem beklenmiyor.`
    );
  }
  if (parcelInTransit) {
    return (
      `${opener} Baskıyı ona ÇOKTAN göndermişsiniz (sistemde kargo kaydı var), bu yüzden ` +
      `iş kendiliğinden başka bir boyacıya aktarılmadı. Yeni bir kargo çıkarmayın: paketin ` +
      `ne olacağını yönetici kararlaştıracak ve sizinle iletişime geçecek.`
    );
  }
  // Boyamayı üretici kendi yapıyor: bu siparişe boyacı ATANMAYACAK, dolayısıyla
  // beklemek işi sonsuza kadar durdurur. Baskı zaten onun elinde.
  if (reason === "paints_in_house") {
    return (
      `${opener} Bu siparişin boyamasını kendi atölyenizde yaptığınız için siparişe yeni ` +
      `bir boyacı ATANMAYACAK; yönetici ataması beklemeyin. Baskı sizde: boyamayı ` +
      `tamamlayıp siparişi panelinizden kargolayabilirsiniz.`
    );
  }
  if (reason === "already_assigned") {
    return (
      `${opener} Sipariş bu sırada başka bir boyacıya atanmış görünüyor; güncel boyacıyı ve ` +
      `teslimat adresini sipariş sayfanızdan görebilirsiniz. Sizden bir işlem beklenmiyor.`
    );
  }
  if (reason === "refunded") {
    return (
      `${opener} Sipariş bu sırada müşteriye iade edildiği için başka bir boyacıya ` +
      `gönderilmeyecek; bu sipariş için yapmanız gereken bir işlem yok.`
    );
  }
  if (reason === "not_needed") {
    return (
      `${opener} Sistemde bu sipariş için ayrı bir boyama kalemi görünmediğinden (ya da baskı ` +
      `henüz kalite kontrolden geçmediğinden) yeni bir boyacı atanmadı. Baskıyı elinizde tutun; ` +
      `durum yöneticiye bildirildi, siparişin nasıl devam edeceğini yönetici size iletecek.`
    );
  }
  return (
    `${opener} Yeni boyacı ataması yönetici tarafından yapılacak; baskıyı elinizde tutun ve ` +
    `beklemede kalın. Sizden bir işlem beklenmiyor.`
  );
}

/**
 * BOYACIYA GİDEN CÜMLE: bıraktığı işin gerçekten ne olduğu.
 *
 * Ölçülen kusur: üreticinin yarısı düzeltilmiş, boyacınınki düzeltilmemişti.
 * Yeniden yerleştirilmeyen HER hâlde boyacıya "Yeni boyacıyı yönetici atayacak"
 * deniyordu — üreticisi boyamayı kendi yapan siparişte de. O siparişte kapı
 * sonsuza dek `paints_in_house` ile atlar (flags.ts · painterAssignRowGate):
 * atanacak bir boyacı YOKTUR, dolayısıyla cümle partnere kendi işi hakkında
 * doğru olmayan bir şey söylüyordu.
 *
 * Kural üreticininkiyle aynı: cümle, işin BUNDAN SONRA ne olacağını söyler ve
 * hiçbir boyacının kimliğini taşımaz (sıradaki boyacının adı bu tarafa açılmaz).
 */
function painterDeclineNotice(args: {
  reassigned: boolean;
  parcelInTransit: boolean;
  reason: RepickAdminQueueReason | null;
}): string {
  const { reassigned, parcelInTransit, reason } = args;
  const opener = "İşi bıraktınız ve iş listenizden düştü.";
  if (reassigned) {
    return `${opener} Sipariş otomatik olarak başka bir boyacıya yönlendirildi; sizden bir işlem beklenmiyor.`;
  }
  if (parcelInTransit) {
    return (
      `${opener} Ancak baskı size gönderilmiş görünüyor (kargo kaydı var): paketle ne ` +
      `yapılacağını yönetici size bildirecek.`
    );
  }
  if (reason === "paints_in_house") {
    return (
      `${opener} Bu siparişin boyamasını üretici kendi atölyesinde yapacak: siparişe yeni ` +
      `bir boyacı ATANMAYACAK ve yönetici de atama yapmayacak. Sizden bir işlem beklenmiyor.`
    );
  }
  if (reason === "already_assigned") {
    return `${opener} Sipariş bu sırada başka bir boyacıya atanmış; sizden bir işlem beklenmiyor.`;
  }
  if (reason === "refunded") {
    return (
      `${opener} Sipariş bu sırada müşteriye iade edilmiş: başka bir boyacıya ` +
      `yönlendirilmeyecek ve sizden bir işlem beklenmiyor.`
    );
  }
  if (reason === "not_needed") {
    return (
      `${opener} Sistemde bu sipariş için devredilecek bir boyama adımı görünmüyor; ` +
      `siparişin nasıl devam edeceğine yönetici karar verecek. Sizden bir işlem beklenmiyor.`
    );
  }
  // Kalan sebepler (uygun boyacı kalmadı, anahtar kapalı, ret üst sınırı,
  // arızalar) siparişi GERÇEKTEN admin kuyruğuna koyar: orada eski cümle doğrudur.
  return `${opener} Yeni boyacıyı yönetici atayacak; sizden bir işlem beklenmiyor.`;
}

/**
 * Nereye kadar gelindi. Tek soru: KOPARMA YAZILDI MI? Beklenmeyen bir hatada
 * boyacıya ne diyeceğimizi bu ayrım belirler.
 */
type DeclineProgress = { detached: boolean };

async function handlePainterDecline(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  progress: DeclineProgress
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;

  // Tek işlem, KİLİTLİ okuma: yükün iki alanı (durum ve kara liste) iade
  // durumuna bağlı, bu yüzden o durum okunduktan sonra yazılana kadar
  // değişmemeli. Kilitsiz ön okuma bu pencereyi açık bırakırdı.
  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        manufacturerId: orders.manufacturerId,
        orderNumber: orders.orderNumber,
        declinedPainterIds: orders.declinedPainterIds,
        painterStatus: orders.painterStatus,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.painterId, g.painterId)))
      .for("update");
    if (!existing || existing.painterStatus !== "assigned") {
      return { code: "not_declinable" as const };
    }

    const refunded = isRefunded(existing);
    // Not TARİHLİ yazılır: aynı sütuna yazan komşu bayraklar ([BOYACI],
    // [BOYACI-SLA]) damgalı ve yönetici hangi satırın güncel olduğunu ancak
    // damgadan okuyabiliyor — tarihsiz satır, iki dakika sonra yazılan tarihli
    // satırın yanında zamansız kalıyordu. Damga BİR KEZ alınır: aynı SQL
    // ifadesinde iki kez üretilseydi dakika sınırında iki farklı saat yazardı.
    const refundedNoteLine = formatAdminNoteLine(DECLINE_NOTE_REFUNDED);
    const declined = Array.from(
      new Set([...(existing.declinedPainterIds ?? []), g.painterId])
    );

    const [updated] = await tx
      .update(orders)
      .set({
        painterId: null,
        painterStatus: "unassigned",
        assignedToPainterAt: null,
        sentToPainterAt: null,
        // İade edilmiş siparişte koparma HEPSİ budur: durum `quality_check`e
        // geri sarılmaz (iade edilen sipariş durumunu KORUR) ve boyacı kara
        // listeye yazılmaz — iş başka bir boyacıya zaten gönderilemeyecek, kayıt
        // yalnız bu boyacının siciline iz bırakırdı.
        ...(refunded
          ? {
              // Koparma dışında yapılan TEK şey: admin notu. Ceza değil kayıt —
              // puanlanan bir eylem satırı ya da kara liste yazmıyor, yalnızca
              // olan biteni yöneticinin baktığı yere yazıyor.
              adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${refundedNoteLine} ELSE ${orders.adminNotes} || E'\n' || ${refundedNoteLine} END`,
            }
          : { declinedPainterIds: declined, status: "quality_check" as const }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.painterId, g.painterId),
          eq(orders.painterStatus, "assigned")
        )
      )
      .returning({ id: orders.id });
    if (!updated) return { code: "lost_race" as const };

    // Boyacı eylem günlüğü işlemin İÇİNDE: koparma ile kaydı birbirinden
    // ayrılamaz. (Üretici tarafındaki `decline` satırının aksine bu satır bir
    // ceza değildir — boyacı sıralamasında puanlanmıyor — o yüzden iade edilmiş
    // siparişte de yazılır.)
    await tx
      .insert(painterActions)
      .values({ orderId: id, painterId: g.painterId, action: "decline", notes: reason });

    return {
      code: "ok" as const,
      refunded,
      manufacturerId: existing.manufacturerId,
      orderNumber: existing.orderNumber,
      // Kara liste KİLİT ALTINDA okunur: üst sınır kararı (PAINTER_MAX_DECLINES
      // ret → admin
      // kuyruğu) işlemin gördüğü listeden çıkmalı, sonradan yapılan ikinci bir
      // okumadan değil. Sayı değil LİSTE taşınır — üst sınır dolduğunda yazılan
      // karar kaydı "kimler reddetti" sorusunu da cevaplar.
      declinedPainterIds: declined,
    };
  });

  if (outcome.code === "not_declinable") {
    return NextResponse.json(
      { error: "İş bulunamadı veya reddedilebilir durumda değil" },
      { status: 400 }
    );
  }
  if (outcome.code === "lost_race") {
    return NextResponse.json({ error: "İşlem başarısız" }, { status: 400 });
  }
  const { refunded, manufacturerId, orderNumber, declinedPainterIds } = outcome;

  // Buradan sonrası "KOPARMA YAZILDI" dünyası: işlem commit oldu, iş boyacının
  // listesinden düştü. Aşağıdaki bir adım patlarsa boyacıya "reddedemediniz"
  // DENMEZ.
  progress.detached = true;

  // ── ÜRETİCİNİN BASKI HAKEDİŞİ DURUR ──────────────────────────────────────
  //
  // Burada eskiden reverseEarning() çağrılıyor ve `reversed` satır siliniyordu:
  // baskıyı yapmış, QC'den geçirmiş, hiçbir hatası olmayan üreticinin parası
  // BOYACININ kararıyla geri alınıyordu. Sahibin kararı: hakediş accrued kalır.
  //
  // Eski gerekçe "farklı tutarlı bir yeniden tahakkuk sessizce düşmesin"di
  // (accrueEarning `orderId` üzerinde tekildir ve ikinci yazma no-op olur). O
  // gerekçe bu fazda geçersiz: ret sonrası iş YİNE BİR BOYACIYA gider, yani
  // üreticinin payı aynı baskı payıdır — satırın olduğu gibi kalması zaten
  // doğru tutarı verir. Tutarın gerçekten değiştiği tek yol işin üreticiden
  // tamamen alınmasıdır (boyacıdan geri alma / boyama kaleminin kaldırılması)
  // ve o yol kendi mutabakatını yapar: revoke-after-painter.ts hakedişi çevirir,
  // ödenmiş bir satır varsa işlemi hiç yapmadan reddeder.

  // KOPARMADAN SONRASI TEK PARÇA HÂLİNDE KORUNUR.
  //
  // Ölçülen kusur: yeniden yerleştirme fırladı, rota 500 verdi ve geriye
  // koparılmış ama KİMSENİN KUYRUĞUNDA OLMAYAN bir sipariş kaldı — üreticiye
  // haber gitmedi, admin notu yazılmadı, boyacı da "tamamlanamadı" okudu.
  // Buradan sonra hiçbir hata 500'e dönüşmez: iş gerçekten bırakıldı, cevabın
  // görevi ne olduğunu söylemek ve siparişi bir insanın önüne koymaktır.
  try {
    if (refunded) {
      // İade edilmiş sipariş hiçbir yöne kımıldamaz: yeni boyacı ARANMAZ.
      if (manufacturerId) {
        await notifyManufacturer({
          manufacturerId,
          type: "system_announcement",
          subject: `Boyacı işi reddetti — sipariş iade edildi (${orderNumber})`,
          body:
            `${orderNumber} numaralı sipariş için gönderdiğiniz boyama işi reddedildi. ` +
            `Sipariş müşteriye iade edildiği için başka bir boyacıya göndermeniz gerekmiyor; ` +
            `bu sipariş için yapmanız gereken başka bir işlem yok.`,
          orderId: id,
        }).catch((e) => console.error("notifyManufacturer (painter decline) failed", e));
      }
      return NextResponse.json({
        success: true,
        // Dürüst cevap: iade edilmiş siparişte iş kapandı, sipariş üreticinin
        // kuyruğuna geri konmadı. `message` panelde gösterilir (jobs-client ·
        // notice): kart listeden düştüğü için bu cümleyi taşıyan başka bir yer yok.
        reason: "refunded" as const,
        reassigned: false,
        message: REFUNDED_DECLINE_MESSAGE,
      });
    }

    // Sıradaki boyacıyı SİSTEM seçer; ret üst sınırı (flags.ts ·
    // PAINTER_MAX_DECLINES) dolduğunda iş admin kuyruğunda bekler.
    // Baskı çoktan yola çıkmışsa kimse yerleştirilmez (paket ortada kalırdı) ve
    // karar admin'e bırakılır.
    const repick = await repickPainterAfterDecline({
      orderId: id,
      orderNumber,
      declinedPainterIds,
    });
    const reassigned = repick.action === "reassigned";
    const parcelInTransit = repick.action === "admin_queue" && repick.parcelInTransit;

    // ÜRETİCİYE HER HÂLDE HABER VERİLİR. Eskiden bu blok yeniden yerleştirmenin
    // ARDINDAN, korumasız çalışıyordu: yerleştirme patladığında üretici hiçbir
    // şey duymuyordu — oysa elindeki baskıyı ne yapacağını yalnız bu bildirimden
    // öğrenebilir.
    //
    // Cümlenin HANGİSİ olacağını artık yerleştirmenin SEBEBİ belirliyor
    // (manufacturerDeclineNotice): "atandı"/"paket yolda" ikilisi, kendi boyayan
    // üreticiye de aynı bekleme talimatını veriyordu ve o bekleme hiç bitmezdi.
    if (manufacturerId) {
      await notifyManufacturer({
        manufacturerId,
        type: "system_announcement",
        subject: "Boyacı işi reddetti",
        body: manufacturerDeclineNotice({
          orderNumber,
          reassigned,
          parcelInTransit,
          reason: repick.action === "admin_queue" ? repick.reason : null,
        }),
        orderId: id,
      }).catch((e) => console.error("notifyManufacturer (painter decline) failed", e));
    }

    return NextResponse.json({
      success: true,
      // Boyacıya gösterilen sonuç: işin bir sonraki adımı ne oldu. Kart listeden
      // düştüğü için bu cümleyi taşıyan başka bir yer yok (jobs-client · notice).
      reassigned,
      reason: reassigned ? ("reassigned" as const) : repick.reason,
      message: painterDeclineNotice({
        reassigned,
        parcelInTransit,
        reason: repick.action === "admin_queue" ? repick.reason : null,
      }),
    });
  } catch (e) {
    // KOPARMA COMMIT OLDU: boyacıya "olmadı" denmez. Ama sipariş de sahipsiz
    // bırakılmaz — siparişe [BOYACI] notu düşer ve admin'e e-posta gider, yani
    // bir insan bu işi bulabilir. Cevap 200'dür ve olanı söyler.
    console.error("boyacı reddi: koparma sonrası adımlar tamamlanamadı", e);
    await flagPainterManualAssignment({
      orderId: id,
      orderNumber,
      reason:
        "boyacı işi bıraktı; ret sonrası adımlar beklenmeyen bir hatayla durdu ve sipariş boyacısız kaldı",
    }).catch((err) => console.error("[BOYACI] ret sonrası uyarı yazılamadı", err));
    return NextResponse.json({
      success: true,
      reassigned: false,
      reason: "post_detach_error" as const,
      message:
        "İşi bıraktınız ve iş listenizden düştü. Sonraki adımlar (yeni boyacı ataması, üretici bildirimi) tamamlanamadı; sipariş yöneticinin kuyruğuna işaretlendi, yönetici devam edecek.",
    });
  }
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap.
 *
 * Üretici ikizlerinde ölçülen hâl burada da açıktı: bir okuma/yazma fırlarsa
 * Next'in varsayılan 500'üne düşülüyor ve boyacı paneline SIFIR BAYT gidiyordu
 * (panel o zaman kendi yedek cümlesini gösterir — ekranda ne olduğuna dair tek
 * kelime yoktur). İKİ HÂL ayrılır, çünkü boyacıya verilecek öğüt bu ayrıma
 * bağlıdır:
 *  • Koparma yazılmadan patladıysa işlem geri sarılır ve iş hâlâ boyacınındır;
 *    güvenle tekrar denenebilir.
 *  • Yazıldıktan sonra patladıysa (hakediş düzeltmesi, üretici bildirimi) iş
 *    ÇOKTAN düşmüştür; "tekrar deneyin" demek olmuş bir işi ikinci kez
 *    yaptırmaya çalışmak olurdu.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const progress: DeclineProgress = { detached: false };
  try {
    return await handlePainterDecline(request, ctx, progress);
  } catch (e) {
    console.error("boyacı reddi: beklenmeyen hata", e);
    return NextResponse.json(
      {
        error: progress.detached
          ? "İşi bıraktınız ve iş listenizden düştü, ancak sonraki adımlar (üreticiye bildirim, hakediş düzeltmesi) tamamlanamadı. Liste sayfasını yenileyin; iş listenizde görünmüyorsa işlem tamamdır."
          : "Beklenmeyen bir hata nedeniyle işi bırakma kaydedilemedi; işte hiçbir şey değişmedi ve iş hâlâ sizde. Birkaç dakika sonra tekrar deneyin, sorun sürerse yöneticiye bildirin.",
        reason: "unexpected_error",
      },
      { status: 500 }
    );
  }
}
