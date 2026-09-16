import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, orders } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import {
  ackWriteFailureRefusal,
  recordPartnerModelAck,
  type RecordAckResult,
} from "@/lib/services/order-model-revision";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";

/**
 * Nereye kadar gelindi. Tek soru: ONAY YAZILDI MI? Beklenmeyen bir hatada
 * üreticiye ne diyeceğimizi bu ayrım belirler.
 */
type AckProgress = { acknowledged: boolean };

/**
 * Üretici, siparişe yüklenen YENİ model sürümünü gördüğünü onaylar
 * (late-model-upload kararı: "baskı sırasında üretici yeni modeli
 * ONAYLAMALI").
 *
 * Eski davranış pasif bir rozetti ("Model güncellendi — yeni dosyayı
 * indirin"); kimse okuduğunu kanıtlayamıyordu ve eski sürümle basılan iş
 * QC'den geçip kargolanabiliyordu. Onay verilene kadar baskı başlatma,
 * bitirme, QC'ye gönderme, boyacıya devir ve kargo kapalıdır.
 */
async function handleManufacturerAck(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  progress: AckProgress
) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { status: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
  }

  const { id } = await params;
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: { id: true, paymentStatus: true },
  });
  if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  if (isRefunded(order)) {
    return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const revision = Number((body as { revision?: unknown })?.revision);
  if (!Number.isInteger(revision) || revision <= 0) {
    return NextResponse.json({ error: "Geçersiz sürüm numarası." }, { status: 400 });
  }

  // Onay YAZIMININ arızası, kapının 503'üyle AYNI cümleyi döner.
  //
  // NEDEN: recordPartnerModelAck, günlük okunamadığında bilerek fırlatır
  // (ACK_LOG_UNREADABLE) — okunamayan günlüğe onay yazmak yanlış sürümü kapatır
  // ve partnere kapıyı açılmış gösterirdi. Üretici önce kapının dürüst 503'ünü
  // okuyup ("birkaç dakika sonra tekrar deneyin") o cümlenin gösterdiği tek
  // düğmeye basar; aynı arıza burada da AYNI cümleyle karşılanmalıdır.
  //
  // Arıza bu arızaya ait DEĞİLSE hata artık YENİDEN FIRLATILMAZ: eskiden
  // fırlatılıyordu ve Next bunu BOŞ GÖVDELİ bir 500'e çeviriyordu — kısa ve
  // çıkışsız bir döngü (dürüst 503 → tek düğme → sıfır bayt). Dıştaki
  // yakalama onu iki hâli ayıran, gövdeli bir cevaba çevirir; yutulmuş bir hata
  // yine de geçici arıza gibi GÖSTERİLMEZ, kendi ayrı cümlesini alır.
  let result: RecordAckResult;
  try {
    result = await recordPartnerModelAck({
      orderId: id,
      partner: { kind: "manufacturer", id: session.manufacturerId },
      revision,
    });
  } catch (e) {
    const refusal = ackWriteFailureRefusal(e);
    if (!refusal) throw e;
    return NextResponse.json(
      { error: refusal.error, code: refusal.code },
      { status: refusal.status }
    );
  }
  // Buradan sonrası "ONAY YAZILDI" dünyası: kapı açıldı.
  progress.acknowledged = true;
  if (result.code === "nothing_pending") {
    return NextResponse.json({ success: true, alreadyAcknowledged: true });
  }
  if (result.code === "stale") {
    return NextResponse.json(
      {
        error: `Bu arada ${result.announcedRevision}. sürüm yüklendi. Sayfayı yenileyip yeni sürümü onaylayın.`,
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ success: true, revision: result.revision });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap.
 *
 * Bu uç, kapının 503'ünün üreticiye gösterdiği TEK düğmedir; burada boş gövde
 * dönmek partneri çıkışsız bir döngüde bırakır. Rotanın bütün işi tek yerden
 * geçer — oturum, atölye durumu, sipariş ve gövde okumaları dahil: bunlar
 * eskiden try'ın DIŞINDAYDI, yani bir manufacturers/orders arızası da aynı
 * düğmeye sıfır bayt döndürüyordu.
 *
 * İKİ HÂL ayrılır, çünkü üreticiye verilecek öğüt bu ayrıma bağlıdır:
 *  • Onay yazılmadan patladıysa kapı hâlâ kapalıdır ve işte hiçbir şey
 *    değişmemiştir; güvenle tekrar denenebilir.
 *  • Yazıldıktan sonra patladıysa onay ÇOKTAN kaydedilmiştir; "tekrar deneyin"
 *    demek, açılmış bir kapıyı ikinci kez açtırmaya çalışmak olurdu.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const progress: AckProgress = { acknowledged: false };
  try {
    return await handleManufacturerAck(request, ctx, progress);
  } catch (e) {
    console.error("üretici model onayı: beklenmeyen hata", e);
    return NextResponse.json(
      {
        error: progress.acknowledged
          ? "Onayınız kaydedildi, ancak cevabın hazırlanması sırasında beklenmeyen bir hata oluştu. Sayfayı yenileyin; onay görünüyorsa işlem tamamdır ve üretime devam edebilirsiniz."
          : "Beklenmeyen bir hata nedeniyle onayınız kaydedilemedi; kapı hâlâ kapalı ve işte hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin, sorun sürerse yöneticiye bildirin.",
        reason: "unexpected_error",
      },
      { status: 500 }
    );
  }
}
