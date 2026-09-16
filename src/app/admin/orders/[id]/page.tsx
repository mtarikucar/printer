export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { and, eq, desc, inArray, asc, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews, orderModelRevisions, orderModelFiles, orderModelApprovals, manufacturerAssignmentEvaluations, painterAssignmentEvaluations, manufacturerEarnings, generationAttempts, meshReports, adminActions, adminMessages, manufacturers, manufacturerActions, qcPhotos, qcReviews, painters, painterActions, painterEarnings, painterQcPhotos, painterQcReviews } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { OrderDetailClient } from "./client";
import { getLocale } from "@/lib/i18n/get-locale";
import { normalizeFileUrl, getPublicUrl } from "@/lib/services/storage";
import { rankForOrderPreview } from "@/lib/services/manufacturer-assignment-shadow";
// Boyacı sıralayıcısı: ekrandaki sıra ile otomatik atamanın seçtiği boyacı TEK
// kaynaktan gelsin diye (P4-C1). İki ayrı sıra olsaydı admin, sistemin neden
// başkasını seçtiğini bu sayfadan asla anlayamazdı.
import { rankPaintersForOrder } from "@/lib/services/painter-assignment";
import { weightsVersion } from "@/lib/config/manufacturer-scoring";
import {
  buildOrderEvaluation,
  groupEvaluationDecisions,
  parseEvaluationSide,
} from "@/app/admin/scoring-evaluations/evaluation-view";
import { buildPainterEvaluation } from "@/app/admin/scoring-evaluations/painter-evaluation-view";
// KAPASİTE TEK ÖLÇÜDEN: aday kartı, üretici seçicisi ve yazma uçları aynı
// fonksiyonu okur, yoksa ekran ucun reddedeceği boyacıyı sunar.
import {
  emptyPainterCapacity,
  loadPainterCapacities,
  painterLoadLabel,
} from "@/lib/services/painter-capacity";
import {
  modelUploadAllowed,
  modelUploadSideEffects,
  modelUploadStage,
  qcRoundPrintProof,
} from "@/lib/config/order-model-policy";
import { resolveCurrentRevision } from "@/lib/config/order-model";
import { modelAckState } from "@/lib/config/partner-model-ack";
import { partnerHoldingOrder } from "@/lib/services/on-behalf";
import { modelApprovalUrl } from "@/lib/services/model-approval";
import { isRefunded } from "@/lib/config/order-status-policy";
import { buildOrderMoneyBreakdown } from "@/lib/services/order-money";
import {
  gateMode,
  requiresOverride,
  type PrintGateVerdict,
} from "@/lib/services/print-gate";
import {
  ensureJourneyToken,
  journeyUrl,
  journeyEligibility,
} from "@/lib/services/order-journey";

/**
 * QC fotoğrafının ait olduğu model sürümü.
 *
 * `qc_photos.model_revision` Faz 2'de ekleniyor (migration ayrı sahipte).
 * Kolon henüz yoksa satırda alan da yoktur; sayfa o zaman sürümü bilmediğini
 * söyler. Alanı doğrudan okumak, migration sırası yüzünden sipariş ekranını
 * tamamen düşürürdü.
 */
function qcPhotoRevision(row: unknown): number | null {
  const v = (row as { modelRevision?: unknown }).modelRevision;
  return typeof v === "number" ? v : null;
}

/**
 * GÖSTERİM amaçlı bir okuma: sonucu ekranda yalnızca GÖSTERİLİR; bir kapıyı
 * açıp kapatmaz.
 *
 * NEDEN: burası iade durumunu, para dökümünü, QC kapısını, geri alma kartlarını
 * ve partner adına işlem kartını gösteren TEK ekran. Yalnızca GÖSTERİLEN bir
 * tablo okunamadığında sayfanın tamamının 500 vermesi, admin'i tam da arızayı
 * yönetmesi gereken anda dışarıda bırakıyordu (ölçüm: 42 siparişin 42'si 500).
 * Bir gösterim tablosunun arızası artık sayfayı DÜŞÜRMEZ.
 *
 * Hata YUTULMAZ: null döner ve null "boş" değil "BİLİNMİYOR" demektir. Bayrak
 * ekrana geçer (serialized.readFailures) ve o veriyi gösteren kartın KENDİ
 * yerinde yazılır — sessizlik de bir iddiadır.
 */
async function displayRead<T>(
  label: string,
  orderId: string,
  query: PromiseLike<T>
): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[admin order ${orderId}] ${label} okunamadı`, e);
    return null;
  }
}

/**
 * Sayfanın en üstünde, SEKME ÇUBUĞUNUN DIŞINDA duran arıza şeridi.
 *
 * NEDEN sekmelerin dışında: kartların kendi "okunamadı" uyarıları Üretim ve
 * Geçmiş sekmelerinde duruyor, admin ise sayfayı VARSAYILAN sekmede (Özet)
 * açıyor. Eylem günlüğü arızasında admin hiçbir şey görmüyordu: ne kayıt, ne
 * uyarı — sessizlik "her şey yolunda" diye okunuyordu. Bu şerit, adminin
 * fiilen BAKTIĞI yerdedir ve kart uyarılarının yerini almaz, onları özetler.
 */
function CoreReadNotice({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">
        Bu siparişin bazı kayıtları şu anda okunamıyor (geçici sistem arızası)
      </p>
      <p className="mt-1 text-amber-900/80">
        Sipariş açıldı ve aşağıdaki gerçek kayıtlardır; ama şu bölümler BOŞ
        DEĞİL, BİLİNMİYOR: {areas.join(" · ")}. Boş görünen bu kartlar &quot;kayıt
        yok&quot; anlamına gelmez, hiçbir veri silinmedi. Bilinmezliğe dayanan
        adımlar güvenlik gereği kapalı tutuldu. Birkaç dakika sonra sayfayı
        yenileyin.
      </p>
    </div>
  );
}

export default async function AdminOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ weights?: string }>;
}) {
  const { id } = await params;
  const { weights: weightsParam } = await searchParams;
  const locale = await getLocale();
  // Escape hatch — ?weights=v1|v2|v3 shows the ranked list under one profile
  // regardless of the canary percent. v3 is the continuous-distance shadow, so
  // this is how the admin sees what the new distance model WOULD pick before
  // it is switched on. Nothing here is logged: no view writes an evaluation.
  const forceProfile =
    weightsParam === "v1" || weightsParam === "v2" || weightsParam === "v3"
      ? weightsParam
      : undefined;

  // ─── ÇEKİRDEK OKUMA: yalnız SİPARİŞİN KENDİSİ ────────────────────────────
  //
  // `with:` BİLEREK YOK. Drizzle'ın ilişkisel sorgusu TEK ifadedir: `with`
  // içindeki YAN tablolardan biri okunamadığında SORGUNUN TAMAMI fırlar. Bir
  // önceki tur yalnız SAYFA DÜZEYİNDEKİ okumaları korudu; arıza bu kez
  // çekirdek okumanın İÇİNDEN geldi ve sayfa yine 500 verdi — üstelik tam da
  // aşağıdaki "okunamadı" uyarılarının okunması gereken anda, yani uyarıların
  // hiçbiri ekrana çıkamadı (ölçüm: üretici panelinde 13 sayfanın 13'ü).
  //
  // Kural: yalnızca GÖSTERİLEN her ilişki AYRI ve KORUMALI okunur. Çekirdek
  // okumada yalnızca siparişin kendisi kalır — o okunamazsa zaten gösterilecek
  // bir sayfa yoktur.
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
  });

  if (!order) notFound();

  // ─── Yalnız GÖSTERİLEN ilişkiler: her biri AYRI ve KORUMALI ──────────────
  //
  // Tek `Promise.all`: sorgular yine aynı anda gider (sayfa yavaşlamaz), ama
  // biri düşerse yalnız KENDİ kartı "okunamadı" der. Hiçbiri null'ı "kayıt
  // yok" saymaz — null BİLİNMİYOR demektir ve bayrağı ekrana geçer.
  const [
    photoRead,
    previewRead,
    generationRead,
    adminActionRead,
    adminMessageRead,
    manufacturerRead,
    painterRead,
    qcPhotoRead,
    qcReviewRead,
  ] = await Promise.all([
    displayRead(
      "referans fotoğraflar",
      id,
      db
        .select({
          id: orderPhotos.id,
          originalUrl: orderPhotos.originalUrl,
          thumbnailUrl: orderPhotos.thumbnailUrl,
        })
        .from(orderPhotos)
        .where(eq(orderPhotos.orderId, id))
    ),
    // Sonuç nesneye SARILIR ki "önizleme yok" (previewId null) ile "okunamadı"
    // ayrı kalsın; ikisini tek null'a indirmek, yapılmamış bir okumayı "müşteri
    // tasarım onaylamamış" diye göstermek olurdu.
    displayRead("onaylanan tasarım görseli", id, (async () => {
      if (!order.previewId) return { row: null };
      const row = await db.query.previews.findFirst({
        where: eq(previews.id, order.previewId),
        columns: { selectedStyledImageUrl: true },
      });
      return { row: row ?? null };
    })()),
    // Denemeler + ölçüm raporları TEK bayrakta: kart ikisini birlikte gösterir
    // ve rapor, denemesi bilinmeden anlamsızdır.
    displayRead("üretim denemeleri ve ölçüm raporları", id, (async () => {
      const attempts = await db
        .select()
        .from(generationAttempts)
        .where(eq(generationAttempts.orderId, id))
        .orderBy(desc(generationAttempts.createdAt));
      // `mesh_reports` orderId TAŞIMAZ, generationId taşır: raporlar bu
      // siparişin denemelerinden okunur — tek IN sorgusu, N+1 yok.
      const reports = attempts.length
        ? await db
            .select()
            .from(meshReports)
            .where(
              inArray(
                meshReports.generationId,
                attempts.map((a) => a.id)
              )
            )
        : [];
      return { attempts, reports };
    })()),
    displayRead(
      "yönetici işlem günlüğü",
      id,
      db
        .select()
        .from(adminActions)
        .where(eq(adminActions.orderId, id))
        .orderBy(desc(adminActions.createdAt))
    ),
    displayRead(
      "müşteriye giden e-postalar",
      id,
      db
        .select()
        .from(adminMessages)
        .where(eq(adminMessages.orderId, id))
        .orderBy(desc(adminMessages.sentAt))
    ),
    // Atölye/boyacı KAYDI: siparişin kime atandığı kolonda (manufacturerId)
    // duruyor, burada okunan yalnız o kaydın ADI/İLETİŞİMİ. Okunamadığında
    // "atanmamış" DEĞİL "kaydı okunamadı" denir — aksi hâlde ekran atanmış bir
    // siparişe yeniden atama açardı (kapı aşağıda kapalı tutulur).
    displayRead("üretici kaydı", id, (async () => {
      if (!order.manufacturerId) return { row: null };
      const row = await db.query.manufacturers.findFirst({
        where: eq(manufacturers.id, order.manufacturerId),
      });
      return { row: row ?? null };
    })()),
    displayRead("boyacı kaydı", id, (async () => {
      if (!order.painterId) return { row: null };
      const row = await db.query.painters.findFirst({
        where: eq(painters.id, order.painterId),
      });
      return { row: row ?? null };
    })()),
    displayRead(
      "QC fotoğrafları",
      id,
      db
        .select()
        .from(qcPhotos)
        .where(eq(qcPhotos.orderId, id))
        .orderBy(desc(qcPhotos.createdAt))
    ),
    displayRead(
      "QC kararları",
      id,
      db
        .select()
        .from(qcReviews)
        .where(eq(qcReviews.orderId, id))
        .orderBy(desc(qcReviews.createdAt))
    ),
  ]);

  const photosUnreadable = photoRead === null;
  const photoRows = photoRead ?? [];
  const previewUnreadable = previewRead === null;
  const previewRow = previewRead?.row ?? null;
  const generationUnreadable = generationRead === null;
  const generationAttemptRows = generationRead?.attempts ?? [];
  const meshReportRows = generationRead?.reports ?? [];
  const reportsByAttempt = new Map<string, (typeof meshReportRows)[number][]>();
  for (const r of meshReportRows) {
    const list = reportsByAttempt.get(r.generationId) ?? [];
    list.push(r);
    reportsByAttempt.set(r.generationId, list);
  }
  const adminActionsUnreadable = adminActionRead === null;
  const adminActionRows = adminActionRead ?? [];
  const adminMessagesUnreadable = adminMessageRead === null;
  const adminMessageRows = adminMessageRead ?? [];
  const manufacturerUnreadable = manufacturerRead === null;
  const manufacturerRow = manufacturerRead?.row ?? null;
  const painterUnreadable = painterRead === null;
  const painterRow = painterRead?.row ?? null;
  const qcPhotosUnreadable = qcPhotoRead === null;
  const qcPhotoRows = qcPhotoRead ?? [];
  const qcReviewsUnreadable = qcReviewRead === null;
  const qcReviewRows = qcReviewRead ?? [];

  // ─── Okunamayan kayıt sayfayı DÜŞÜRMEZ ───────────────────────────────────
  //
  // Bu iki okuma sipariş sorgusunun İÇİNDE (lateral join) duruyordu: üreticinin
  // eylem günlüğü ya da sürüm tablosu okunamadığında SORGUNUN TAMAMI fırlıyor ve
  // HER siparişin admin sayfası 500 veriyordu — hem de tam olarak kapıların
  // kapandığı, admin'in sebebi okuması gereken anda. Aynı arıza üretici ve
  // boyacı panellerinde bu şekilde çözüldü (manufacturer/orders/[id]/page.tsx ·
  // painter/jobs/page.tsx); admin ekranı korumayı daha çok hak ediyor, çünkü
  // iade durumunu, para dökümünü, QC kapısını, geri alma kartlarını ve partner
  // adına işlem kartını gösteren TEK ekran burasıdır.
  //
  // Arıza "sorun yok" diye OKUNMAZ: her okumanın null'ı ekrana bayrak olarak
  // gider, kart "okunamadı" der ve kapılar kapalı tarafta kalır.
  const manufacturerActionLog = await db
    .select({
      id: manufacturerActions.id,
      action: manufacturerActions.action,
      notes: manufacturerActions.notes,
      createdAt: manufacturerActions.createdAt,
    })
    .from(manufacturerActions)
    .where(eq(manufacturerActions.orderId, order.id))
    .orderBy(desc(manufacturerActions.createdAt))
    .catch((e) => {
      console.error(`[admin order ${order.id}] üretici işlem günlüğü okunamadı`, e);
      return null;
    });
  const manufacturerActionsUnreadable = manufacturerActionLog === null;
  const manufacturerActionRows = manufacturerActionLog ?? [];

  const modelRevisionLog = await db
    .select()
    .from(orderModelRevisions)
    .where(eq(orderModelRevisions.orderId, order.id))
    .orderBy(desc(orderModelRevisions.revision))
    .catch((e) => {
      console.error(`[admin order ${order.id}] model sürümleri okunamadı`, e);
      return null;
    });
  const revisionReadFailed = modelRevisionLog === null;
  const modelRevisionRows = modelRevisionLog ?? [];

  // ─── Para dökümü ─────────────────────────────────────────────────────────
  // Started here and awaited just before serialisation so its queries overlap
  // the rest of this page's. It is a read-only view: if it throws, the card says
  // so and the page still renders. A money view must never lock the admin out of
  // shipping, assigning or refunding the order.
  const moneyPromise = buildOrderMoneyBreakdown(order.id).catch((e) => {
    console.error(`[admin order ${order.id}] money breakdown failed`, e);
    return null;
  });

  // Query active manufacturers for the assignment dropdown
  const activeManufacturerList = await displayRead(
    "aktif üretici listesi",
    id,
    db.query.manufacturers.findMany({
      where: sql`${manufacturers.status} = 'active'`,
      columns: { id: true, companyName: true },
    })
  );
  const activeManufacturersUnreadable = activeManufacturerList === null;
  const activeManufacturers = activeManufacturerList ?? [];

  // ─── Painting side ───────────────────────────────────────────────────────
  // Queried separately rather than through `with:` because orders has no
  // relation to these three tables, and adding one just to read them here
  // would be schema churn for a page-local need.
  //
  // Only fetched for orders that actually involve a painter — an ordinary print
  // job pays nothing for this.
  const paintingRelevant = order.needsPainting || !!order.painterId;

  // Every file of every model revision — a revision is a SET of parts (some
  // jobs are 12-13 STLs), so the single glb/stl pair on the revision header is
  // only the primary. Queried flat and grouped here; one query, no N+1.
  const modelFileLog = await displayRead(
    "model dosyaları",
    order.id,
    db
      .select()
      .from(orderModelFiles)
      .where(eq(orderModelFiles.orderId, order.id))
      .orderBy(asc(orderModelFiles.revision), asc(orderModelFiles.sortOrder))
  );
  const modelFilesUnreadable = modelFileLog === null;
  const modelFileRows = modelFileLog ?? [];
  const filesByRevision = new Map<number, typeof modelFileRows>();
  for (const f of modelFileRows) {
    const list = filesByRevision.get(f.revision) ?? [];
    list.push(f);
    filesByRevision.set(f.revision, list);
  }

  // ─── Can the admin still ADD a painting line to this order? ───────────────
  // Mirrors /api/admin/orders/[id]/add-painting exactly (the route is the
  // authority; this only decides what the card shows and why). The painting
  // share is carved out of the production share, so it is only possible before
  // the manufacturer's earning has accrued. A refunded order is closed for new
  // work, so it is refused first.
  // Bu okuma GÖSTERİM DEĞİL, bir KAPININ girdisi: hakediş tahakkuk etmişse
  // boyama payı artık üretim payından ayrılamaz. Okunamadığında kapı AÇIK
  // varsayılamaz ("kayıt yok" ile "okuyamadım" aynı şey değildir), bu yüzden
  // arıza ayrı bir bayrağa düşer ve aşağıda GEREKÇE olarak yazılır: kapı kapalı
  // tarafta kalır, sebebini de ekran söyler.
  const manufacturerEarningRead = order.needsPainting
    ? { accrued: false }
    : await displayRead(
        "üretici hakediş kaydı",
        order.id,
        db.query.manufacturerEarnings
          .findFirst({
            where: and(
              eq(manufacturerEarnings.orderId, order.id),
              ne(manufacturerEarnings.status, "reversed")
            ),
            columns: { id: true },
          })
          .then((row) => ({ accrued: !!row }))
      );
  const manufacturerEarningUnreadable = manufacturerEarningRead === null;
  const manufacturerEarningAccrued = manufacturerEarningRead?.accrued ?? false;
  const addPaintingBlockedReason: string | null = order.needsPainting
    ? null
    : isRefunded(order)
      ? "Sipariş iade edildi; iade edilen siparişe boyama eklenemez."
    : order.workshopSessionId
      ? "Atölye siparişine boyama eklenemez: atölye partisi mekâna toplu teslim edilir, boyacı hattına girmez."
      : order.painterId
      ? "Sipariş zaten bir boyacıda."
      : order.shippedAt || ["shipped", "delivered", "rejected"].includes(order.status)
        ? "Sipariş kargolanmış ya da kapanmış; boyama eklenemez."
        : manufacturerEarningUnreadable
          ? "Üreticinin hakediş kaydı şu anda okunamadı (geçici sistem arızası); boyama payının üretim payından ayrılıp ayrılamayacağı bilinmiyor. Kapı güvenlik gereği KAPALI tutuldu; birkaç dakika sonra sayfayı yenileyin."
        : manufacturerEarningAccrued
          ? "Üreticinin hakedişi tahakkuk etmiş; boyama payı artık üretim payından ayrılamaz."
          : (order.productionBaseKurus ?? order.amountKurus) <= 1
            ? "Üretim payı boyama ayırmaya yetmiyor."
            : null;

  // ─── Journey QR ──────────────────────────────────────────────────────────
  // Resolved here so the order page can show the code itself rather than a
  // button leading somewhere else — and, when there is no code, say WHY. An
  // absent button reads as "the feature is missing", which is exactly how this
  // landed the first time.
  //
  // Bu iki adım da (uygunluk okuması + jetonun basılması) KORUMALI: hatıra
  // karekodu siparişin yürümesi için gerekli değil, yalnız gösterilen bir
  // karttır — okunamadığında sipariş sayfasının tamamını düşürmesi kabul
  // edilemez.
  const journeyRead = await displayRead(
    "yolculuk karekodu",
    id,
    (async () => {
      const { eligible, blockedBy } = await journeyEligibility(order);
      // An order that already has a token keeps its code even if it would no
      // longer qualify — the card may already be printed and in the box.
      const token =
        eligible || order.journeyToken ? await ensureJourneyToken(id) : null;
      return { eligible, blockedBy, token };
    })()
  );
  const journeyUnreadable = journeyRead === null;
  const journey = {
    eligible: journeyRead?.eligible ?? false,
    blockedBy: journeyRead?.blockedBy ?? null,
    url: journeyRead?.token ? journeyUrl(journeyRead.token) : null,
    qrUrl: journeyRead?.token ? `/api/yolculuk/${journeyRead.token}/qr.png` : null,
  };

  const [painterActionLog, painterQcRead, painterQcDecisionRead, painterEarningRead] =
    paintingRelevant
      ? await Promise.all([
          // Boyacının günlüğü de KORUMALI: çıplak select, painter_actions
          // okunamadığında boyama siparişlerinin sayfasını ikinci bir yoldan
          // düşürüyordu.
          db
            .select()
            .from(painterActions)
            .where(eq(painterActions.orderId, id))
            .orderBy(desc(painterActions.createdAt))
            .catch((e) => {
              console.error(`[admin order ${id}] boyacı işlem günlüğü okunamadı`, e);
              return null;
            }),
          displayRead(
            "boyacı QC fotoğrafları",
            id,
            db
              .select()
              .from(painterQcPhotos)
              .where(eq(painterQcPhotos.orderId, id))
              .orderBy(desc(painterQcPhotos.createdAt))
          ),
          displayRead(
            "boyacı QC kararları",
            id,
            db
              .select()
              .from(painterQcReviews)
              .where(eq(painterQcReviews.orderId, id))
              .orderBy(desc(painterQcReviews.createdAt))
          ),
          // Sonuç bir nesneye SARILIR ki "satır yok" ile "okunamadı" ayrı
          // kalsın: tahakkuk etmiş bir parayı "henüz oluşmadı" diye göstermek,
          // para hakkında yapılmamış bir okumanın iddiası olurdu.
          displayRead(
            "boyacı hakedişi",
            id,
            db.query.painterEarnings
              .findFirst({ where: eq(painterEarnings.orderId, id) })
              .then((row) => ({ row: row ?? null }))
          ),
        ])
      : [[], [], [], { row: null }];
  // Okunamayan günlük "hareket yok" DEĞİL, "bilinmiyor" demektir.
  const painterActionsUnreadable = painterActionLog === null;
  const painterActionRows = painterActionLog ?? [];
  const painterQcUnreadable = painterQcRead === null;
  const painterQc = painterQcRead ?? [];
  const painterQcDecisionsUnreadable = painterQcDecisionRead === null;
  const painterQcDecisions = painterQcDecisionRead ?? [];
  const painterEarningUnreadable = painterEarningRead === null;
  const painterEarning = painterEarningRead?.row ?? null;

  // Painters the admin can hand this job to. Capacity is computed here (not in
  // the browser) so the dropdown can grey out a full shop instead of letting
  // the admin pick one and eat a 409.
  const declinedPainterIds = Array.isArray(order.declinedPainterIds)
    ? (order.declinedPainterIds as string[])
    : [];
  const painterCandidateRead = paintingRelevant
    ? await displayRead(
        "boyacı listesi",
        id,
        (async () => {
        const rows = await db
          .select({
            id: painters.id,
            companyName: painters.companyName,
            contactPerson: painters.contactPerson,
            phone: painters.phone,
            status: painters.status,
            acceptingOrders: painters.acceptingOrders,
            maxConcurrentOrders: painters.maxConcurrentOrders,
          })
          .from(painters)
          .where(eq(painters.status, "active"))
          .orderBy(painters.companyName);
        if (rows.length === 0) return [];
        // KAPASİTE, ORTAK ÖLÇÜDEN (services/painter-capacity.ts). Burada kendi
        // sayımımız duruyordu ve iş SAYISI sayıyordu: bir PARTİ işi tutan
        // boyacı (100 adet = 6 birim) sıralayıcıda dolu görünürken bu sayım
        // onu boş sayıyordu ve kart, kapının kabul/reddiyle çelişiyordu
        // (ölçüm: P4F-1 ve P4F-2 aynı ayrışmanın iki yönü).
        const caps = await loadPainterCapacities(rows.map((p) => p.id));
        return rows.map((p) => {
          // Eksik anahtar "bilinmiyor" değil "boş tezgâh" demektir.
          const cap =
            caps.get(p.id) ?? emptyPainterCapacity(p.id, p.maxConcurrentOrders);
          const declined = declinedPainterIds.includes(p.id);
          return {
            id: p.id,
            companyName: p.companyName,
            contactPerson: p.contactPerson,
            phone: p.phone,
            // GÖSTERİM: tezgâhtaki ayrı kutu sayısı. Alan adı korunuyor
            // (istemci bunu okuyor) ama artık KAPI DEĞİL.
            currentLoad: cap.activeJobs,
            // KAPI: ağırlıklı yük ve onun tek boolean cevabı.
            loadUnits: cap.loadUnits,
            hasRoom: cap.hasRoom,
            // Tek yük etiketi: "6/2 birim · 1 iş".
            loadLabel: painterLoadLabel(cap),
            maxConcurrentOrders: cap.maxConcurrentOrders,
            acceptingOrders: p.acceptingOrders,
            declined,
            eligible: p.acceptingOrders && !declined && cap.hasRoom,
          };
        });
        })()
      )
    : [];
  const painterCandidatesUnreadable = painterCandidateRead === null;
  const painterCandidates = painterCandidateRead ?? [];

  // Names for the "already refused this job" list — an id tells the admin nothing.
  const declinedPainterRead =
    declinedPainterIds.length > 0
      ? await displayRead(
          "reddeden boyacı adları",
          id,
          db
            .select({ id: painters.id, companyName: painters.companyName })
            .from(painters)
            .where(inArray(painters.id, declinedPainterIds))
        )
      : [];
  const painterDeclinedUnreadable = declinedPainterRead === null;
  const declinedPainters = declinedPainterRead ?? [];

  // ─── Boyacı SIRALAMASI (P4-C1) ───────────────────────────────────────────
  //
  // Kutu eskiden alfabetikti ve yükü yalnız sayı olarak gösteriyordu: admin
  // "hangisi daha iyi" sorusunu ekrandan cevaplayamıyordu, otomatik atama ise
  // başka bir sıradan seçiyordu. Artık ikisi aynı sıralayıcıdan besleniyor.
  //
  // Sıralama bir TAVSİYEDİR, kapı değil: üretilemediğinde liste alfabetik
  // kalır, elle atama açık kalır ve kart sırasız olduğunu SÖYLER.
  //
  // YALNIZ GEREKTİĞİNDE hesaplanır. Sıralayıcı boyacı başına geçmiş sorgusu
  // açar (~2N+5 sorgu) ve bu, sipariş sayfasının HER render'ında koşuyordu:
  // iade edilmiş, kargolanmış ya da boyaması çoktan bitmiş siparişlerde de,
  // yani iki boyacı kutusunun da gizli olduğu ekranlarda. Kapılar istemcideki
  // kutu koşullarının AYNISIDIR (client.tsx · "Boyacı ata" ve "Boyacıyı
  // değiştir"); biri değişirse bu da değişmeli, yoksa kutu açılır ama sırası
  // gelmez. Hesaplanmadığında liste sırasız kalır ve `painterRankingUnreadable`
  // false kalır: sıralama BAŞARISIZ olmadı, hiç İSTENMEDİ — ekran "sıralama
  // hesaplanamadı" uyarısını yalnız gerçek arızada göstermeli.
  const painterRefunded = isRefunded(order);
  const painterAssignBoxOpen =
    (!order.painterStatus || order.painterStatus === "unassigned") &&
    order.manufacturerStatus === "qc_approved";
  const painterSwapBoxOpen =
    !!order.painterStatus &&
    order.painterStatus !== "unassigned" &&
    order.painterStatus !== "shipped";
  const painterRankingNeeded =
    paintingRelevant &&
    !painterRefunded &&
    (painterAssignBoxOpen || painterSwapBoxOpen);
  const painterRankingRead = painterRankingNeeded
    ? await displayRead("boyacı sıralaması", id, rankPaintersForOrder(id))
    : [];
  const painterRankingUnreadable = painterRankingRead === null;
  const painterRankById = new Map(
    (painterRankingRead ?? []).map((c, i) => [c.painterId, { ...c, rank: i + 1 }])
  );
  // Kart verisi: kimlik/kapasite yerel okumadan, sıra ve skor bileşenleri
  // sıralayıcıdan. Sırası bilinmeyen boyacı null taşır — sıfır DEĞİL; sıfır
  // "en kötü aday" diye okunurdu.
  const painterCandidateCards = painterCandidates
    .map((c) => {
      const ranked = painterRankById.get(c.id);
      return {
        ...c,
        rank: ranked?.rank ?? null,
        score: ranked?.score ?? null,
        parts: ranked?.parts ?? null,
        // AĞIRLIKLI yük KAPININ ölçüsüdür ve yerel okumadan gelir (`c.loadUnits`,
        // yayılımla zaten taşınıyor); sıralamadan ALINMAZ, çünkü sıralama
        // hesaplanamadığında kapının ölçüsü ekrandan kaybolurdu.
        reasons: ranked?.reasons ?? [],
        // EKRAN NEYİ KAPATIRSA UÇ ONU REDDEDER. Kart ile atama/devir uçları
        // artık AYNI `painterHasRoom` cevabını okuyor: sunulan satır gerçekten
        // kabul edilir, kilitlenen satır gerçekten kapalı bir kapıdır.
        // Sıralayıcının kendi kapıları (ret kaydı, hesap durumu) üstüne binmeye
        // devam eder; sıra okunamadığında yerel kapılar tek başına yeter.
        eligible: ranked ? ranked.eligible && c.eligible : c.eligible,
        // Gerekçe GERÇEK ölçüyü adıyla söyler: "1 iş" tutan bir boyacının neden
        // dolu olduğu ancak BİRİM yazılınca anlaşılır.
        ineligibleReason: c.declined
          ? "Bu işi daha önce reddetti"
          : !c.acceptingOrders
            ? "Şu an iş almıyor"
            : !c.hasRoom
              ? `Kapasitesi dolu (${c.loadLabel})`
              : (ranked?.ineligibleReason ?? null),
        suggested: false,
      };
    })
    .sort((a, b) => {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.companyName.localeCompare(b.companyName, "tr");
    });
  // ÖNERİ yalnız sıralama gerçekten okunduğunda verilir: sırasız bir listenin
  // ilk satırını "önerilen" diye işaretlemek, alfabeyi tavsiye diye satardı.
  const suggestedPainterCard = painterRankingUnreadable
    ? undefined
    : painterCandidateCards.find((c) => c.eligible && c.rank !== null);
  if (suggestedPainterCard) suggestedPainterCard.suggested = true;

  // ─── "Bu iş neden bu boyacıya gitti?" ────────────────────────────────────
  //
  // Kaynak, kararın ANINDA yazılmış satırlardır (painter_assignment_evaluations).
  // Sayfa açılışında yeniden sıralamak, yük ve güvenilirlik o günden beri
  // değiştiği için kararı AÇIKLAMAYAN — hatta onunla çelişen — bir tablo
  // gösterirdi. Üretici ikizinden farklı olarak bir karar TEK satır yazar
  // (gölge sıralama yok), bu yüzden limit doğrudan gösterilecek karar sayısıdır:
  // bir iş DÖRT rete kadar (üç yeniden yerleştirme hakkı; config/flags.ts ·
  // PAINTER_MAX_DECLINES) + SLA yeniden yerleştirmeleriyle birkaç kez el
  // değiştirebilir ve kart bunların hepsini geçmiş olarak göstermelidir.
  const painterEvaluationRead = paintingRelevant
    ? await displayRead(
        "boyacı atama değerlendirmeleri",
        id,
        db
          .select({
            id: painterAssignmentEvaluations.id,
            orderId: painterAssignmentEvaluations.orderId,
            createdAt: painterAssignmentEvaluations.createdAt,
            weightsVersion: painterAssignmentEvaluations.weightsVersion,
            trigger: painterAssignmentEvaluations.trigger,
            winnerPainterId: painterAssignmentEvaluations.winnerPainterId,
            placedPainterId: painterAssignmentEvaluations.placedPainterId,
            excludedPainterIds: painterAssignmentEvaluations.excludedPainterIds,
            outcomeReason: painterAssignmentEvaluations.outcomeReason,
            candidates: painterAssignmentEvaluations.candidates,
          })
          .from(painterAssignmentEvaluations)
          .where(eq(painterAssignmentEvaluations.orderId, id))
          .orderBy(desc(painterAssignmentEvaluations.createdAt))
          .limit(10)
      )
    : [];
  const painterEvaluationRowsUnreadable = painterEvaluationRead === null;
  const painterEvaluationRows = painterEvaluationRead ?? [];
  // Adlar: kazanan ya da işi alan boyacı pasif/silinmiş olabilir, yani yukarıdaki
  // aktif boyacı listesinde bulunmayabilir. Çözülmezse kartta çıplak uuid kalırdı.
  const painterEvaluationIds = Array.from(
    new Set(
      painterEvaluationRows
        .flatMap((r) => [r.winnerPainterId, r.placedPainterId])
        .filter((x): x is string => !!x)
    )
  );
  const painterEvaluationNameRead =
    painterEvaluationIds.length > 0
      ? await displayRead(
          "değerlendirmedeki boyacı adları",
          id,
          db
            .select({ id: painters.id, companyName: painters.companyName })
            .from(painters)
            .where(inArray(painters.id, painterEvaluationIds))
        )
      : [];
  // Adlar okunamadıysa kart çıplak uuid göstermek yerine "okunamadı" der: yarım
  // bir gerekçe, gerekçe değildir.
  const painterAssignmentDecisionsUnreadable =
    painterEvaluationRowsUnreadable || painterEvaluationNameRead === null;
  const painterEvaluationNameMap = new Map(
    (painterEvaluationNameRead ?? []).map((p) => [p.id, p.companyName])
  );
  const painterAssignmentDecisions = painterEvaluationRows.map((r) =>
    buildPainterEvaluation(r, (pid) => painterEvaluationNameMap.get(pid) ?? null)
  );

  // ─── Müşteri model onayı: turlar ve kararlar ─────────────────────────────
  // Sipariş sayfası onay turlarını hiç göstermiyordu: müşterinin ne zaman ne
  // karar verdiği yalnız /onay ekranında ve e-postada duruyordu, telefonla
  // gelen bir karar da hiçbir yere yazılamıyordu.
  const approvalRoundRead = await displayRead(
    "müşteri onay turları",
    id,
    db
      .select()
      .from(orderModelApprovals)
      .where(eq(orderModelApprovals.orderId, id))
      .orderBy(desc(orderModelApprovals.revision))
  );
  const approvalRoundsUnreadable = approvalRoundRead === null;
  const approvalRounds = approvalRoundRead ?? [];

  // Reddeden üreticiler: kimlik listesi admin'e hiçbir şey söylemiyordu.
  const declinedManufacturerIds = Array.isArray(order.declinedManufacturerIds)
    ? (order.declinedManufacturerIds as string[])
    : [];
  const declinedManufacturerRead =
    declinedManufacturerIds.length > 0
      ? await displayRead(
          "reddeden üretici adları",
          id,
          db
            .select({ id: manufacturers.id, companyName: manufacturers.companyName })
            .from(manufacturers)
            .where(inArray(manufacturers.id, declinedManufacturerIds))
        )
      : [];
  const manufacturerDeclinedUnreadable = declinedManufacturerRead === null;
  const declinedManufacturers = declinedManufacturerRead ?? [];

  // ─── Model yükleme politikası (P2-C1) ────────────────────────────────────
  // Aşamayı ve yan etkilerini SUNUCU söyler, ekran yalnız gösterir. İstemcide
  // ikinci bir kural kopyası, yükleme kapısıyla ekranın ayrı düşmesi demekti;
  // aynı hata "Reddet" butonunda bir kez yaşandı (order-status-policy.ts).
  const uploadPolicyInput = {
    status: order.status,
    manufacturerStatus: order.manufacturerStatus,
    painterStatus: order.painterStatus,
    paymentStatus: order.paymentStatus,
  };
  // Adımı KİMİN adına yapacağımızı P2-C4'ün kendi fonksiyonu söyler; ekranda
  // ikinci bir kopya tutmak, admin'in üretici sanıp boyacı adına işlem
  // yapmasına yol açardı.
  const onBehalfHolder = partnerHoldingOrder(order);
  const uploadStage = modelUploadStage(uploadPolicyInput);
  const modelUpload = {
    stage: uploadStage,
    allowed: modelUploadAllowed(uploadPolicyInput),
    effects: modelUploadSideEffects(uploadStage),
  };

  // Sürümün yüklendiği ANDAKİ durum, o yüklemenin denetim satırından okunur:
  // notu "Sürüm N: …" ile başlayan upload_model satırı o sürüme aittir. Ayrı
  // bir kolon açmak yerine zaten yazılan kayıt kullanılır.
  const uploadAudits = new Map<number, (typeof adminActionRows)[number]>();
  for (const a of adminActionRows) {
    if (a.action !== "upload_model" || !a.notes) continue;
    const m = /^Sürüm (\d+)/.exec(a.notes);
    if (!m) continue;
    const rev = Number(m[1]);
    // adminActions en yeniden eskiye sıralı: ilk eşleşen o sürümün son kaydı.
    if (!uploadAudits.has(rev)) uploadAudits.set(rev, a);
  }

  // Geçerli sürüm TEK kuraldan gelir: en yüksek numaralı sürüm
  // (config/order-model.ts · resolveCurrentRevision) — üreticinin indirdiği,
  // QC kapısının kıyasladığı ve bu ekranın "GÜNCEL" dediği sayı aynı olsun.
  // Burada duran ikinci kopya siparişin canlı model ANAHTARLARINI sürümlerle
  // eşliyordu; "önceki parçaları koru" ile açılan sürümler aynı dosya anahtarını
  // PAYLAŞTIĞI için o eşleme yanlış sürümü güncel gösterebiliyordu ve ekran
  // sunucudan sessizce ayrışabiliyordu.
  const currentRevision = resolveCurrentRevision(modelRevisionRows);

  // ─── Partnerin yeni sürümü onaylayıp onaylamadığı ────────────────────────
  // Kaynak, partnerin KENDİ eylem günlüğüdür (duyuru + onay satırları); kural
  // saf modülde, yani admin ekranı ile partner ekranı aynı cevabı verir. Yeni
  // kolon yok: pg enum'a değer eklemek geri alınamayacağı için duyuru/onay
  // serbest metinli `action` olarak yazılıyor (bkz. partner-model-ack.ts).
  //
  // GÜNLÜK OKUNAMADIYSA ONAY DURUMU BİLİNMİYOR DEMEKTİR, "ONAY GEREKMİYOR"
  // DEĞİL: modelAckState boş listeye "duyuru yok → pending:false" der, yani
  // hatayı yutup boş liste geçmek bu ekranda kapıyı AÇIK gösterirdi — oysa
  // partner uçları aynı arızada 503 veriyor (readPartnerModelAck ·
  // modelAckRefusal) ve partner adına yapılan adımlar da kapalı. Sayılar null
  // kalır: uydurulmuş bir sürüm numarası, olmamış bir duyuruyu anlatırdı.
  const UNREADABLE_ACK = {
    announcedRevision: null,
    acknowledgedRevision: null,
    pending: true,
  };
  const manufacturerAck = manufacturerActionsUnreadable
    ? UNREADABLE_ACK
    : modelAckState(manufacturerActionRows);
  const painterAck = painterActionsUnreadable
    ? UNREADABLE_ACK
    : modelAckState(painterActionRows);

  // Canlı QC turunun fotoğrafları GÜNCEL sürümün baskısını mı gösteriyor?
  // Sürüm sıfırlaması üreticiyi baskıya döndürür ama üretici yeni turda eski
  // baskının fotoğraflarını yükleyebilir; onay veren admin bunu görmeli.
  //
  // KAPI AYNI KAPIDIR: `proven`, qcPhotosMatchCurrentRevision'ın döndürdüğü
  // boolenin ta kendisidir (o fonksiyon zaten bu hesabı çağırıyor), yani ekran
  // uçtan daha hoşgörülü olamaz ve fail-closed davranış değişmez. Değişen tek
  // şey, ekranın SEBEBİ de görmesi: tek boole dört ayrı hâli (eski baskı /
  // damgasız / fotoğrafsız / sürüm okunamadı) tek cümleye indiriyordu ve kart
  // hepsine "daha eski bir baskı" diyordu — kaydın yazmadığı bir iddia.
  const qcProof = qcRoundPrintProof({
    photos: qcPhotoRows
      .filter((p) => p.round === order.qcRound)
      .map((p) => ({ modelRevision: qcPhotoRevision(p) })),
    currentRevision,
    // Sürüm tablosu okunamadıysa bu, `currentRevision: null` ile AYNI ŞEY
    // DEĞİLDİR: null "sürüm yok" demek ve kıyaslanacak bir şey olmadığı için
    // turu SERBEST bırakır. Okuma arızası bilinmezliktir; kapı kapalı tarafa
    // çekilir. Bayrak buraya kadar gelmediği için kanıtın dördüncü hâli
    // (revision_unreadable) ekranda hiç doğamıyordu: uç aynı arızada o hâli
    // adıyla söylüyor (qc-approve/route.ts), ekran ise söyleyemiyordu.
    revisionReadFailed,
  });
  const qcRevisionMismatch = !qcProof.proven;

  // Rank candidates for the assignment recommendation UI.
  //
  // The PREVIEW ranker, not the shadow wrapper: opening this page is not an
  // assignment decision, so it must not write an evaluation row. Rows are
  // written where the decision is made (automatic assignment, decline retry),
  // and they now ACCUMULATE rather than overwrite — a row written by a page
  // view would therefore show up on both admin screens as a placement that
  // never happened, next to the real ones, with no way to tell them apart.
  //
  // The profile still follows the canary, so the admin sees the same ranking
  // the assignment would use; ?weights=... overrides it for diagnostics.
  //
  // KORUMALI, çünkü bu çağrı tabloya DOLAYLI iniyor: rankForOrderPreview →
  // rankManufacturersForOrder → reliabilityScoreFor, ve oradaki
  // `manufacturer_actions` okuması çıplak. Sayfanın kendi okumaları korunduğu
  // hâlde bu tek çağrı yüzünden HER siparişin admin sayfası 500 veriyordu
  // (ölçüm: 42/42) — üstelik tam da yeni "okunamadı" uyarılarının okunması
  // gereken arızada, yani uyarıların hiçbiri ekrana çıkamıyordu.
  //
  // Sıralama bir TAVSİYEDİR, kapı değil: üretilemediğinde elle atama açık
  // kalır (aşağıdaki düz açılır liste) ve kart neden boş olduğunu söyler.
  const candidateRead = await displayRead(
    "üretici öneri sıralaması",
    id,
    rankForOrderPreview(id, forceProfile)
  );
  const candidatesUnreadable = candidateRead === null;
  const candidates = candidateRead ?? [];

  // ─── "Bu iş neden bu atölyeye gitti?" ────────────────────────────────────
  // Bir atama KARARI birden çok satır yazar (ağırlık karşılaştırması + sürekli
  // mesafe gölgesi), çünkü bir satırda yalnız iki kazanan sütunu var. Bu yüzden
  // satır limiti karar sayısının katı seçilir ve satırlar aşağıda kararlara
  // bölünür; "en yeni satır" manşete alınırsa hangi karşılaştırmanın öne
  // çıkacağı iki eşzamanlı INSERT'ün mikrosaniyelik yarışına kalırdı.
  //
  // Limit neden bu kadar geniş: satırlar artık üst üste yazılmıyor, birikiyor.
  // Bir sipariş birden çok kez yerleştirilebilir (ret, geri alma, yeniden
  // atama) ve her yerleştirme kendi satırlarını bırakır; kart beş KARAR
  // gösterdiğine göre, o beş kararın satırlarının hepsi pencereye sığmalı —
  // yoksa "önceki atama kararları" eksik kalır.
  const evaluationRowRead = await displayRead(
    "atama değerlendirme kayıtları",
    id,
    db
      .select({
        id: manufacturerAssignmentEvaluations.id,
        orderId: manufacturerAssignmentEvaluations.orderId,
        createdAt: manufacturerAssignmentEvaluations.createdAt,
        weightsVersion: manufacturerAssignmentEvaluations.weightsVersion,
        authoritative: manufacturerAssignmentEvaluations.authoritative,
        v1WinnerId: manufacturerAssignmentEvaluations.v1WinnerId,
        v2WinnerId: manufacturerAssignmentEvaluations.v2WinnerId,
        v1Scores: manufacturerAssignmentEvaluations.v1Scores,
        v2Scores: manufacturerAssignmentEvaluations.v2Scores,
      })
      .from(manufacturerAssignmentEvaluations)
      .where(eq(manufacturerAssignmentEvaluations.orderId, id))
      .orderBy(desc(manufacturerAssignmentEvaluations.createdAt))
      .limit(40)
  );
  const evaluationRowsUnreadable = evaluationRowRead === null;
  const evaluationRows = evaluationRowRead ?? [];

  // Winner names. The jsonb summary usually carries companyName, but a winner
  // outside the stored top-3 (or an older row shape) would otherwise render as
  // a bare uuid, which tells the admin nothing.
  const evaluationWinnerIds = Array.from(
    new Set(
      evaluationRows
        .flatMap((r) => [
          r.v1WinnerId,
          r.v2WinnerId,
          // Kararın YERLEŞTİĞİ atölye, sıralamanın kazananı olmayabilir (elle
          // atama, sonradan devir). Adı burada çözülmezse kartta çıplak uuid
          // kalırdı — kart da tam o cümleyi kurmak için var.
          parseEvaluationSide(r.v1Scores).placedManufacturerId,
          parseEvaluationSide(r.v2Scores).placedManufacturerId,
        ])
        .filter((x): x is string => !!x)
    )
  );
  const evaluationNameRead =
    evaluationWinnerIds.length > 0
      ? await displayRead(
          "değerlendirme kazanan adları",
          id,
          db
            .select({ id: manufacturers.id, companyName: manufacturers.companyName })
            .from(manufacturers)
            .where(inArray(manufacturers.id, evaluationWinnerIds))
        )
      : [];
  // Adlar okunamadıysa kart çıplak uuid göstermek yerine yine "okunamadı" der:
  // yarım bir gerekçe, gerekçe değildir.
  const assignmentDecisionsUnreadable =
    evaluationRowsUnreadable || evaluationNameRead === null;
  const evaluationNames = evaluationNameRead ?? [];
  const evaluationNameMap = new Map(
    evaluationNames.map((m) => [m.id, m.companyName])
  );
  // The distance-shadow row stores its columns differently from the weights
  // row (v1 = the live pick, v2 = the continuous-distance challenger), so the
  // reader has to be told which stamp marks it.
  const distanceShadowVersion = weightsVersion("v3");
  // Satırlar → kararlar. En yeni karar sayfanın manşeti olur, kalanlar gerçek
  // GEÇMİŞTİR (aynı kararın kardeş satırı değil). Beş karar, admin'in "bu iş
  // kaç kez el değiştirdi" sorusunu cevaplamasına yeter.
  const assignmentDecisions = groupEvaluationDecisions(
    evaluationRows.map((r) =>
      buildOrderEvaluation(r, (mid) => evaluationNameMap.get(mid) ?? null, {
        distanceShadowVersion,
      })
    )
  ).slice(0, 5);

  const latestGeneration = generationAttemptRows.find(
    (g) => g.status === "succeeded"
  );
  const latestReport = latestGeneration
    ? reportsByAttempt.get(latestGeneration.id)?.[0]
    : undefined;

  // ─── Print gate ──────────────────────────────────────────────────────────
  // `mesh_reports` keys on generationId, never on orderId, so the newest report
  // for this order is found by flattening every attempt's reports rather than
  // by reading the succeeded attempt alone — a failed-then-retried round still
  // carries the measurements the admin has to judge.
  const gateReport =
    [...meshReportRows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )[0] ?? null;

  // Only an automatically produced model gets the gate card: a hand-sculpted or
  // customer-supplied mesh was never measured, and painting a verdict on it
  // would be an invention.
  const gateVerdict = (gateReport?.verdict ?? null) as PrintGateVerdict | null;
  const bbox = gateReport?.boundingBox;
  // `volume_cm3` is not a column — it is exactly fillRatio × bounding-box
  // volume (see scripts/process_mesh.py), so it is derived here instead of
  // costing a migration. fill_ratio is stored at 4 dp, hence "≈" in the UI.
  const volumeCm3 =
    bbox?.size && gateReport?.fillRatio != null
      ? (bbox.size[0] * bbox.size[1] * bbox.size[2] * gateReport.fillRatio) / 1000
      : null;

  const printGate =
    order.modelSource === "meshy_auto"
      ? {
          mode: gateMode(),
          verdict: gateVerdict,
          reasons: (gateReport?.verdictReasons ?? []) as string[],
          // The approve route defaults a missing verdict to "pass"; mirror that
          // here so the button and the API never disagree about the override.
          //
          // AMA "ölçüm kaydı yok" ile "ölçüm kaydını OKUYAMADIM" aynı şey
          // değildir: ilki yeni bir sipariştir, ikincisi bilinmezlik. Okuma
          // arızasında kapı açık varsayılamaz, gerekçeli onaya çekilir.
          requiresOverride:
            generationUnreadable || requiresOverride(gateVerdict ?? "pass"),
          round: order.modelGenerationRound,
          turntableUrl: normalizeFileUrl(order.modelTurntableUrl),
          measurements: gateReport
            ? {
                heightMm: gateReport.heightMm,
                volumeCm3,
                faceCount: gateReport.faceCount,
                componentCount: gateReport.componentCount,
                minWallP1Mm: gateReport.minWallP1Mm,
                minWallP5Mm: gateReport.minWallP5Mm,
                fillRatio: gateReport.fillRatio,
                baseAdded: gateReport.baseAdded,
              }
            : null,
        }
      : null;

  const money = await moneyPromise;

  // Şeritte SAYILAN alanlar. Kapı davranışını değiştirenler parantez içinde
  // söylenir: admin bir düğmenin neden kapalı olduğunu aynı cümlede okusun.
  const unreadableAreas = [
    photosUnreadable && "Referans fotoğraflar",
    previewUnreadable && "Onaylanan tasarım görseli",
    generationUnreadable &&
      "Üretim denemeleri ve ölçüm raporları (baskı kapısı gerekçeli onaya çekildi)",
    adminActionsUnreadable && "Yönetici işlem geçmişi",
    adminMessagesUnreadable && "Müşteriye gönderilen e-postalar",
    manufacturerUnreadable && "Üretici kaydı (yeniden atama kapatıldı)",
    painterUnreadable && "Boyacı kaydı",
    qcPhotosUnreadable && "QC fotoğrafları (tur onayı kapalı tutuldu)",
    qcReviewsUnreadable && "QC karar geçmişi",
    manufacturerActionsUnreadable && "Üreticinin işlem günlüğü",
    painterActionsUnreadable && "Boyacının işlem günlüğü",
    modelFilesUnreadable && "Model parça listesi",
    // Sürüm TABLOSU okunamadı: liste boş değil, BİLİNMİYOR. Bayrak şeritte
    // OLMADIĞI için bu arıza 19 sipariş sayfasının 18'inde hiçbir yerde
    // görünmüyordu — cümle yalnız Üretim sekmesinde duruyor, admin ise sayfayı
    // Özet sekmesinde açıyor. Şerit, sekmelerin dışında olduğu için adminin
    // FİİLEN indiği yerdir.
    revisionReadFailed &&
      "Model sürümleri (güncel sürüm bilinmediği için QC turu onayı kapalı tutuldu)",
    approvalRoundsUnreadable && "Müşterinin model onay turları",
    activeManufacturersUnreadable && "Aktif üretici listesi (atama kutusu boş kaldı)",
    candidatesUnreadable && "Üretici öneri sıralaması (elle atama açık kalır)",
    manufacturerDeclinedUnreadable && "Reddeden üretici adları",
    evaluationRowsUnreadable &&
      "Atama değerlendirme kayıtları (bu işin neden bu atölyeye gittiği gösterilemiyor)",
    !evaluationRowsUnreadable &&
      assignmentDecisionsUnreadable &&
      "Değerlendirmedeki atölye adları",
    manufacturerEarningUnreadable &&
      "Üreticinin hakediş kaydı (boyama kalemi ekleme kapalı tutuldu)",
    painterQcUnreadable && "Boyacı QC fotoğrafları",
    painterQcDecisionsUnreadable && "Boyacı QC karar geçmişi",
    painterEarningUnreadable && "Boyacının hakediş kaydı",
    painterCandidatesUnreadable && "Boyacı listesi (boyacı atama kutusu boş kaldı)",
    painterDeclinedUnreadable && "Reddeden boyacı adları",
    painterRankingUnreadable &&
      "Boyacı öneri sıralaması (liste sırasız kaldı, önerilen boyacı gösterilemiyor; elle atama açık)",
    painterEvaluationRowsUnreadable &&
      "Boyacı atama değerlendirme kayıtları (bu işin neden bu boyacıya gittiği gösterilemiyor)",
    !painterEvaluationRowsUnreadable &&
      painterAssignmentDecisionsUnreadable &&
      "Değerlendirmedeki boyacı adları",
    journeyUnreadable && "Yolculuk karekodu",
  ].filter((x): x is string => typeof x === "string");

  // Serialize everything for client component
  const serialized = {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      // Sipariş bir atölye partisinin parçası mı: DELETE /ship atölye siparişini
      // her zaman 409 (code "workshop") ile reddeder — parti kaydı "bu parti şu
      // firmayla sevk edildi" der ve tek sipariş geri alınamaz. Ekran, garantili
      // reddedilecek kargo geri alma düğmesini bu alana bakarak gizler. Kimliğin
      // kendisi gösterilmez; yalnız "parti siparişi mi" sorusu okunur.
      workshopSessionId: order.workshopSessionId,
      // Revoke guards: a marketplace seller order can only be printed by its
      // owner, and an order already with a painter must not be pulled back.
      sellerManufacturerId: order.sellerManufacturerId,
      painterStatus: order.painterStatus,
      // Painting economics — the "revoke from painter" panel warns which
      // print-portion earning (the stored kalem production base) gets reversed.
      needsPainting: order.needsPainting,
      paintingPriceKurus: order.paintingPriceKurus,
      productionBaseKurus: order.productionBaseKurus,
      productTitleSnapshot: order.productTitleSnapshot,
      email: order.email,
      customerName: order.customerName,
      phone: order.phone,
      figurineSize: order.figurineSize,
      material: order.material,
      finish: order.finish,
      style: order.style,
      modifiers: order.modifiers as string[] | null,
      // Technical spec shown to the manufacturer; editable from this page.
      selectedOptions: (order.selectedOptions ?? []).map((o) => ({
        groupName: o.groupName,
        choiceName: o.choiceName,
      })),
      shippingAddress: order.shippingAddress as TurkishAddress | null,
      status: order.status,
      amountKurus: order.amountKurus,
      giftCardAmountKurus: order.giftCardAmountKurus,
      paidAt: order.paidAt?.toISOString() ?? null,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      adminNotes: order.adminNotes,
      failureReason: order.failureReason,
      retryCount: order.retryCount,
      createdAt: order.createdAt.toISOString(),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      havaleDiscountKurus: order.havaleDiscountKurus,
      bankTransferReceiptUrl: order.draftId
        ? `/api/admin/orders/${order.id}/receipt`
        : null,
      customerNote: order.customerNote,
      modelGlbKey: order.modelGlbKey,
      modelGlbUrl: normalizeFileUrl(order.modelGlbUrl),
      modelStlKey: order.modelStlKey,
      modelStlUrl: normalizeFileUrl(order.modelStlUrl),
      modelUploadedAt: order.modelUploadedAt?.toISOString() ?? null,
      modelSource: order.modelSource,
    },
    printGate,
    approvedImageUrl: previewRow
      ? normalizeFileUrl(previewRow.selectedStyledImageUrl)
      : null,
    photos: photoRows.map(p => ({
      id: p.id,
      originalUrl: normalizeFileUrl(p.originalUrl) ?? p.originalUrl,
      thumbnailUrl: normalizeFileUrl(p.thumbnailUrl),
    })),
    modelRevisions: modelRevisionRows.map((r) => ({
      id: r.id,
      revision: r.revision,
      glbUrl: normalizeFileUrl(r.glbUrl),
      stlUrl: normalizeFileUrl(r.stlUrl),
      uploadedByEmail: r.uploadedByEmail,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      isCurrent: r.revision === currentRevision,
      audit: (() => {
        const a = uploadAudits.get(r.revision);
        return a
          ? {
              notes: a.notes,
              adminEmail: a.adminEmail,
              createdAt: a.createdAt.toISOString(),
            }
          : null;
      })(),
      files: (filesByRevision.get(r.revision) ?? []).map((f) => ({
        id: f.id,
        name: f.fileName,
        kind: f.kind,
        sizeBytes: f.sizeBytes,
        url: getPublicUrl(f.fileKey),
      })),
    })),
    // Sürüm listesi BOŞ mu, yoksa OKUNAMADI mı: ekran ikisini ayırmadan
    // "Henüz model yüklenmedi" diyordu — yapılmamış bir okumanın iddiası.
    modelRevisionsUnreadable: revisionReadFailed,
    latestGeneration: latestGeneration ? {
      id: latestGeneration.id,
      provider: latestGeneration.provider,
      status: latestGeneration.status,
      outputGlbUrl: normalizeFileUrl(latestGeneration.outputGlbUrl),
      outputStlUrl: normalizeFileUrl(latestGeneration.outputStlUrl),
      costCents: latestGeneration.costCents,
      durationMs: latestGeneration.durationMs,
      createdAt: latestGeneration.createdAt.toISOString(),
    } : null,
    latestReport: latestReport ? {
      isWatertight: latestReport.isWatertight,
      isVolume: latestReport.isVolume,
      vertexCount: latestReport.vertexCount,
      faceCount: latestReport.faceCount,
      componentCount: latestReport.componentCount,
      boundingBox: latestReport.boundingBox,
      baseAdded: latestReport.baseAdded,
      repairsApplied: latestReport.repairsApplied as string[] | null,
    } : null,
    generationAttempts: generationAttemptRows.map(a => ({
      id: a.id,
      provider: a.provider,
      status: a.status,
      outputGlbUrl: normalizeFileUrl(a.outputGlbUrl),
      outputStlUrl: normalizeFileUrl(a.outputStlUrl),
      errorMessage: a.errorMessage,
      costCents: a.costCents,
      durationMs: a.durationMs,
      createdAt: a.createdAt.toISOString(),
    })),
    adminActions: adminActionRows.map(a => ({
      id: a.id,
      action: a.action,
      adminEmail: a.adminEmail,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
    adminMessages: adminMessageRows.map(m => ({
      id: m.id,
      subject: m.subject,
      body: m.body,
      templateKey: m.templateKey,
      adminEmail: m.adminEmail,
      sentAt: m.sentAt.toISOString(),
    })),
    manufacturer: manufacturerRow ? {
      id: manufacturerRow.id,
      companyName: manufacturerRow.companyName,
      contactPerson: manufacturerRow.contactPerson,
      status: manufacturerRow.status,
      // Atölyeye ULAŞMAK için gerekenler: admin sipariş sayfasından üreticiyi
      // arayamıyor, her seferinde /admin/manufacturers'a gidip aratıyordu.
      phone: manufacturerRow.phone,
      email: manufacturerRow.email,
      // Atölyenin ili/ilçesi ayrı kolon değil, adresin içinde.
      city: (manufacturerRow.address as TurkishAddress | null)?.il ?? null,
      district: (manufacturerRow.address as TurkishAddress | null)?.ilce ?? null,
    } : null,
    painter: painterRow ? {
      id: painterRow.id,
      companyName: painterRow.companyName,
      contactPerson: painterRow.contactPerson,
      phone: painterRow.phone,
      email: painterRow.email,
      status: painterRow.status,
      acceptingOrders: painterRow.acceptingOrders,
    } : null,
    // ─── Everything the painting side of this order is doing ───
    journey,
    painting: {
      needsPainting: order.needsPainting,
      amountKurus: order.amountKurus,
      canAddPainting: !order.needsPainting && addPaintingBlockedReason === null,
      addPaintingBlockedReason,
      paintingPriceKurus: order.paintingPriceKurus,
      productionBaseKurus: order.productionBaseKurus,
      painterStatus: order.painterStatus,
      qcRound: order.painterQcRound,
      assignedAt: order.assignedToPainterAt?.toISOString() ?? null,
      sentAt: order.sentToPainterAt?.toISOString() ?? null,
      receivedAt: order.receivedByPainterAt?.toISOString() ?? null,
      paintedAt: order.paintedAt?.toISOString() ?? null,
      handoffCarrier: order.painterHandoffCarrier,
      handoffTrackingNumber: order.painterHandoffTrackingNumber,
      // What the painter is owed for this job, once it has accrued.
      earning: painterEarning
        ? {
            grossKurus: painterEarning.grossKurus,
            netKurus: painterEarning.netKurus,
            commissionKurus: painterEarning.commissionKurus,
            status: painterEarning.status,
          }
        : null,
      actionsUnreadable: painterActionsUnreadable,
      actions: painterActionRows.map((x) => ({
        id: x.id,
        action: x.action,
        notes: x.notes,
        createdAt: x.createdAt.toISOString(),
      })),
      // HER turun fotoğrafları. Ekran canlı turu ayrı gösterir, eskileri QC
      // geçmişinde: bir reddin neye bakılarak verildiği tur numarasıyla
      // birlikte sayfada kalmalı.
      qcPhotos: painterQc.map((p) => ({
        id: p.id,
        url: getPublicUrl(p.storageKey),
        reviewStatus: p.reviewStatus,
        round: p.round,
        createdAt: p.createdAt.toISOString(),
      })),
      qcReviews: painterQcDecisions.map((r) => ({
        id: r.id,
        round: r.round,
        decision: r.decision,
        reason: r.reason,
        adminEmail: r.adminEmail,
        createdAt: r.createdAt.toISOString(),
      })),
      candidates: painterCandidateCards,
      declined: declinedPainters,
    },
    manufacturerActionsUnreadable,
    manufacturerActions: manufacturerActionRows.map(a => ({
      id: a.id,
      action: a.action,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
    manufacturerStatus: order.manufacturerStatus,
    qcRound: order.qcRound,
    // Tüm turlar: hangi fotoğrafın hangi tura ve hangi MODEL SÜRÜMÜNE ait
    // olduğu ekranda görünmeli — yeni sürüm yüklendiğinde QC sıfırlandığı
    // için "bu fotoğraf hangi modelin baskısı?" sorusunun tek cevabı budur.
    qcPhotos: qcPhotoRows.map((p) => ({
      id: p.id,
      url: getPublicUrl(p.storageKey),
      reviewStatus: p.reviewStatus,
      round: p.round,
      modelRevision: qcPhotoRevision(p),
      createdAt: p.createdAt.toISOString(),
    })),
    qcReviews: qcReviewRows.map((r) => ({
      id: r.id,
      round: r.round,
      decision: r.decision,
      reason: r.reason,
      adminEmail: r.adminEmail,
      createdAt: r.createdAt.toISOString(),
    })),
    assignedToManufacturerAt: order.assignedToManufacturerAt?.toISOString() ?? null,
    manufacturerAcceptedAt: order.manufacturerAcceptedAt?.toISOString() ?? null,
    manufacturerPrintedAt: order.manufacturerPrintedAt?.toISOString() ?? null,
    declinedManufacturers,
    modelUpload,
    qcRevisionMismatch,
    // Aynı boolenin SEBEBİ. Ekran "neden onaylanamıyor" sorusuna ancak kaydın
    // yazdığı cevabı verebilsin diye hâl adıyla gönderilir; cümleyi ekran
    // uydurmaz, uçla ortak saf modülden okur (qcRoundProofErrorTr).
    qcProof: {
      failure: qcProof.failure,
      oldestStampedRevision: qcProof.oldestStampedRevision,
      unstampedCount: qcProof.unstampedCount,
      photoCount: qcProof.photoCount,
      currentRevision,
    },
    onBehalfHolder,
    partnerAck: {
      manufacturer: {
        announcedRevision: manufacturerAck.announcedRevision,
        acknowledgedRevision: manufacturerAck.acknowledgedRevision,
        pending: manufacturerAck.pending,
        // Kapı kapalı ama SEBEBİ ayrı: bekleyen onay gerçek bir duyuruya
        // dayanır, okunamayan günlük ise hiçbir şey bilmediğimiz anlamına
        // gelir. Ekran önce buna bakar.
        readFailed: manufacturerActionsUnreadable,
      },
      painter: {
        announcedRevision: painterAck.announcedRevision,
        acknowledgedRevision: painterAck.acknowledgedRevision,
        pending: painterAck.pending,
        readFailed: painterActionsUnreadable,
      },
    },
    modelApproval: {
      open: order.status === "awaiting_customer_approval",
      // Müşteriye giden onay adresi: bağlantıyı yeniden göndermek için de,
      // telefonda müşteriye okumak için de gerekir.
      url: order.modelApprovalToken ? modelApprovalUrl(order.modelApprovalToken) : null,
      approvedAt: order.customerModelApprovedAt?.toISOString() ?? null,
      revisionNote: order.customerModelRevisionNote,
      rounds: approvalRounds.map((r) => ({
        id: r.id,
        revision: r.revision,
        channel: r.channel,
        shownAt: r.shownAt.toISOString(),
        reminderSentAt: r.reminderSentAt?.toISOString() ?? null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decision: r.decision,
        note: r.note,
      })),
    },
    // Computed server-side: the client must not derive it from Date.now() in an
    // effect (hydration mismatch + the set-state-in-effect lint rule).
    assignmentAgeHours: order.assignedToManufacturerAt
      ? Math.floor(
          (Date.now() - order.assignedToManufacturerAt.getTime()) / 3600000
        )
      : null,
    activeManufacturers: activeManufacturers.map(m => ({
      id: m.id,
      companyName: m.companyName,
    })),
    candidates,
    // Why the chosen shop won. Already serialisable (dates as ISO strings).
    assignmentDecisions,
    // Aynı soru boyacı için: kararlar en yenisi başta (her karar TEK satır).
    painterAssignmentDecisions,
    // ─── Hangi GÖSTERİM tablosu okunamadı ───────────────────────────────
    // Her bayrak, o veriyi gösteren KARTIN kendi yerinde yazılır. Boş bir liste
    // "kayıt yok" demek değildir; bayrak olmadan ekran, yapılmamış bir okumanın
    // sonucunu gerçek bir kayıt gibi gösterirdi.
    readFailures: {
      // Çekirdek okumadan ÇIKARILAN gösterim ilişkilerinin bayrakları. Dördü
      // ekranda karar değiştirir: fotoğraf kartı "boş" demez, üretici kaydı
      // okunamazken yeniden atama açılmaz, QC turu kanıtsız onaylanmaz, ölçüm
      // kaydı okunamayan baskı kapısı gerekçe ister.
      photos: photosUnreadable,
      manufacturer: manufacturerUnreadable,
      qcPhotos: qcPhotosUnreadable,
      printGateReport: generationUnreadable,
      candidates: candidatesUnreadable,
      activeManufacturers: activeManufacturersUnreadable,
      modelFiles: modelFilesUnreadable,
      modelApprovalRounds: approvalRoundsUnreadable,
      manufacturerDeclined: manufacturerDeclinedUnreadable,
      assignmentDecisions: assignmentDecisionsUnreadable,
      journey: journeyUnreadable,
      painterQcPhotos: painterQcUnreadable,
      painterQcReviews: painterQcDecisionsUnreadable,
      painterEarning: painterEarningUnreadable,
      painterCandidates: painterCandidatesUnreadable,
      painterDeclined: painterDeclinedUnreadable,
      painterRanking: painterRankingUnreadable,
      painterAssignmentDecisions: painterAssignmentDecisionsUnreadable,
    },
    // Already serialisable by contract (dates as ISO strings); null = loader failed.
    money,
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      {forceProfile && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <strong>Tanı görünümü:</strong> aday listesi{" "}
          <code className="rounded bg-amber-100 px-1 text-xs">{forceProfile}</code>{" "}
          profiliyle sıralandı (kanarya oranı yok sayıldı). Bu görünüm yalnızca
          incelemek içindir; atamayı değiştirmez ve hiçbir yere kaydedilmez.{" "}
          <a
            href={`/admin/orders/${id}`}
            className="underline hover:text-amber-700"
          >
            Normal görünüme dön
          </a>
        </div>
      )}
      <CoreReadNotice areas={unreadableAreas} />
      <OrderDetailClient data={serialized} locale={locale} />
    </div>
  );
}
