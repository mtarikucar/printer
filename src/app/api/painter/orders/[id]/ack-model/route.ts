import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import {
  ackWriteFailureRefusal,
  recordPartnerModelAck,
  type RecordAckResult,
} from "@/lib/services/order-model-revision";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";

/**
 * Nereye kadar gelindi. Tek soru: ONAY YAZILDI MI? Beklenmeyen bir hatada
 * boyacıya ne diyeceğimizi bu ayrım belirler.
 */
type AckProgress = { acknowledged: boolean };

/**
 * Boyacı, siparişe yüklenen YENİ model sürümünü gördüğünü onaylar.
 *
 * Neden gerekli: boyacının elindeki baskı, yeni sürüm yüklendiği anda eski
 * sürüme ait olabilir. Dosyayı sessizce değiştirmek, boyacının farkında
 * olmadan ıskartaya çıkacak bir işi bitirmesi demekti. Onay verilene kadar
 * QC'ye gönderme ve kargolama kapalıdır (partner-model-ack.ts).
 */
async function handlePainterAck(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  progress: AckProgress
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.painterId, g.painterId)),
    columns: { id: true, paymentStatus: true },
  });
  if (!order) return NextResponse.json({ error: "İş bulunamadı" }, { status: 404 });
  // İade kararı (refund-end-state): iade edilmiş siparişte iş iptaldir; onay
  // da dahil hiçbir adım işlenmez.
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
  // ve boyacıya kapıyı açılmış gösterirdi. Boyacı önce kapının dürüst 503'ünü
  // okuyup o cümlenin gösterdiği tek düğmeye basar; aynı arıza burada da AYNI
  // cümleyle karşılanmalıdır.
  //
  // Arıza bu arızaya ait DEĞİLSE hata artık YENİDEN FIRLATILMAZ: eskiden
  // fırlatılıyordu ve Next bunu BOŞ GÖVDELİ bir 500'e çeviriyordu — panel o
  // zaman kendi yedek cümlesini gösterir, ekranda olan bitene dair tek kelime
  // yoktur. Dıştaki yakalama onu iki hâli ayıran, gövdeli bir cevaba çevirir;
  // yutulmuş bir hata yine de geçici arıza gibi GÖSTERİLMEZ.
  let result: RecordAckResult;
  try {
    result = await recordPartnerModelAck({
      orderId: id,
      partner: { kind: "painter", id: g.painterId },
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
 * Bu uç, kapının 503'ünün boyacıya gösterdiği TEK düğmedir; burada boş gövde
 * dönmek boyacıyı çıkışsız bir döngüde bırakır (panel yalnız kendi yedek
 * cümlesini gösterebilir). Rotanın bütün işi tek yerden geçer — oturum, iş ve
 * gövde okumaları dahil: bunlar eskiden try'ın DIŞINDAYDI, yani bir
 * painters/orders arızası da aynı düğmeye sıfır bayt döndürüyordu.
 *
 * İKİ HÂL ayrılır, çünkü boyacıya verilecek öğüt bu ayrıma bağlıdır:
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
    return await handlePainterAck(request, ctx, progress);
  } catch (e) {
    console.error("boyacı model onayı: beklenmeyen hata", e);
    return NextResponse.json(
      {
        error: progress.acknowledged
          ? "Onayınız kaydedildi, ancak cevabın hazırlanması sırasında beklenmeyen bir hata oluştu. Sayfayı yenileyin; onay görünüyorsa işlem tamamdır ve boyamaya devam edebilirsiniz."
          : "Beklenmeyen bir hata nedeniyle onayınız kaydedilemedi; kapı hâlâ kapalı ve işte hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin, sorun sürerse yöneticiye bildirin.",
        reason: "unexpected_error",
      },
      { status: 500 }
    );
  }
}
