import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { deleteFile, saveFile } from "@/lib/services/storage";
import {
  ModelRevisionEmptyError,
  ModelRevisionInUseError,
  ModelRevisionNotFoundError,
  TooManyModelFilesError,
  attachOrderModelFiles,
  currentModelRevision,
  deleteModelRevision,
  resetQcForNewRevision,
  setCurrentModelRevision,
  type OrderModelFileInput,
} from "@/lib/services/order-model";
import {
  isValidUploadId,
  promoteStagedUpload,
  readStagedHead,
  discardStagedUpload,
  stagedSize,
} from "@/lib/services/chunked-upload";
import {
  MAX_ORDER_MODEL_FILES,
  MODEL_HEAD_BYTES,
  orderModelKindOf,
  verifyModelHead,
  type OrderModelKind,
} from "@/lib/config/order-model";
import {
  modelUploadAllowed,
  modelUploadSideEffects,
  modelUploadStage,
  type ModelUploadStage,
} from "@/lib/config/order-model-policy";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { autoAssignIfEligible } from "@/lib/services/order-confirm";
import { notifyOrderModelRevision } from "@/lib/services/order-model-revision";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { openModelApproval } from "@/lib/services/model-approval";
import { getEmailQueue } from "@/lib/queue/queues";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// No size cap: production models are hundreds of megabytes. Files come in
// through the chunked staging API (src/lib/services/chunked-upload.ts) and are
// never held in memory; this POST only carries the staged ids.

/**
 * Admin uploads the model FILES for a paid order — one revision, any number
 * of STL and/or GLB parts (some jobs are 12-13 parts, often a ZIP the browser
 * already expanded). GLB is optional: STL-only and GLB-only are both valid.
 *
 * Body (multipart):
 *   files = JSON [{ uploadId, name }]   ← current client
 *   glbUploadId / stlUploadId / glb / stl ← older single-pair clients, still accepted
 *   note  = sürüm notu (bazı aşamalarda ZORUNLU, bkz. P2-C1)
 *
 * Every file is checked by its first bytes BEFORE any is promoted: one bad
 * part rejects the whole batch and discards every staged upload, so a revision
 * never goes live with 12 of 13 parts.
 *
 * FAZ 2 (late-model-upload kararı): yükleme artık bir DURUM LİSTESİNE bağlı
 * değil. Model HER aşamada yüklenebilir; yalnız reddedilmiş ve iade edilmiş
 * sipariş dışarıdadır. Aşamanın yan etkileri (QC sıfırlama, üretici onayı,
 * boyacı bildirimi, yeni müşteri onay turu, yalnız-kayıt) tek politikadan
 * gelir: src/lib/config/order-model-policy.ts. Ne olduğu da uydurulmaz —
 * `appliedSideEffects` GERÇEKTEN uygulananı döner (P2-C2), çünkü kargo ile
 * QC sıfırlaması aynı satırda yarışabilir.
 */

/**
 * Yol parçası gerçekten bir sipariş kimliği mi? Bozuk bir kimlik (ör. kırpılmış
 * UUID) doğrudan sorguya girerse Postgres 22P02 fırlatır; Next bunu HTML 500'e
 * çevirir, admin JSON hata göremez ve HAZIRLANMIŞ yüklemeler diskte kalır.
 * Route'un kendi 404'ü bunların ikisini de çözer.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Kargolanmış siparişte yeni bir sürümün haber verileceği TEK kişi: DİJİTAL
 * DOSYA satın almış müşteri. İndirme ucu her zaman GÜNCEL sürümü sunar, yani bu
 * yükleme onun elindeki dosyayı değiştirdi; haber vermezsek eski dosyayla
 * kalır. Satın almamış müşteriye duyurmak ise satmadığımız bir şeyi duyurmak
 * olurdu. Hesabı olmayan (misafir) siparişte indirme zaten hesaba bağlı.
 */
async function notifyDigitalFilesCustomer(
  order: {
    id: string;
    userId: string | null;
    orderNumber: string;
    upsells: string[] | null;
  },
  revision: number
): Promise<boolean> {
  if (!order.userId || !(order.upsells ?? []).includes("digital_files")) return false;
  await notifyCustomer({
    userId: order.userId,
    orderId: order.id,
    type: "model_revision",
    title: "Modelinizin yeni sürümü hazır",
    body:
      `${order.orderNumber} numaralı siparişinizin 3B modeli güncellendi (v${revision}). ` +
      "Satın aldığınız dijital dosyaları hesabınızdan yeniden indirebilirsiniz.",
  }).catch((e) => console.error("[upload-model] dijital dosya bildirimi gönderilemedi", e));
  return true;
}

type Entry =
  | { source: "staged"; uploadId: string; name: string; kind: OrderModelKind }
  | { source: "inline"; file: File; name: string; kind: OrderModelKind };

/** P2-C2: yüklemenin GERÇEKTEN doğurduğu yan etkiler. */
interface AppliedSideEffects {
  qcReset: boolean;
  qcRound: number | null;
  approvalRoundOpened: boolean;
  manufacturerAckRequired: boolean;
  painterNotified: boolean;
  /** Dijital dosya satın almış müşteriye haber verildi mi (kargo sonrası). */
  customerNotified: boolean;
}

/** Sürüm notu: bazı aşamalarda zorunlu, her zaman 1000 karakterle sınırlı. */
function readNote(raw: FormDataEntryValue | null): string {
  return typeof raw === "string" ? raw.trim().slice(0, 1000) : "";
}

/** Denetim satırı: sürümün YAKALADIĞI anın tam fotoğrafı. */
function auditNote(
  revision: number,
  stage: ModelUploadStage,
  snapshot: { status: string; manufacturerStatus: string | null; painterStatus: string | null },
  detail: string,
  note: string
): string {
  const where =
    `aşama=${stage}; durum=${snapshot.status}; ` +
    `üretici=${snapshot.manufacturerStatus ?? "yok"}; boyacı=${snapshot.painterStatus ?? "yok"}`;
  return `Sürüm ${revision}: ${detail} [${where}]${note ? ` · Not: ${note}` : ""}`;
}

/**
 * Yan etkiler uygulandıktan SONRA siparişin gerçekten bulunduğu aşama.
 *
 * Yalnız DENENEN QC sıfırlaması tutmadığında okunur: o durumda sipariş aşamadan
 * çıkmıştır (ör. aynı anda kargolandı) ve partnere gidecek cümle aşamaya göre
 * seçildiği için, eski aşamayla haber vermek OLMAYAN bir sıfırlamayı duyururdu.
 */
async function stageAfterSideEffects(
  orderId: string,
  fallback: ModelUploadStage
): Promise<ModelUploadStage> {
  const fresh = await db.query.orders
    .findFirst({
      where: eq(orders.id, orderId),
      columns: {
        status: true,
        manufacturerStatus: true,
        painterStatus: true,
        paymentStatus: true,
      },
    })
    .catch((e) => {
      console.error("[upload-model] güncel aşama okunamadı", e);
      return null;
    });
  return fresh ? modelUploadStage(fresh) : fallback;
}

/**
 * Yeni bir sürümün doğurduğu yan etkileri uygular — YÜKLEME ve GERİ GETİRME
 * için aynı yerden.
 *
 * NEDEN ORTAK: iki yol da aynı fiziksel gerçeği yaratıyor — partnerin indirdiği
 * dosya kümesi değişiyor (geri getirme kaynağın kopyasını EN ÜSTE yeni bir sürüm
 * olarak yayımlar). Ayrı yazıldıklarında geri getirme QC'yi sıfırlamıyordu:
 * sipariş QC turundayken geri getirilen sürüm, QC onayının (haklı olarak) BAYAT
 * diye reddettiği bir turu açık bırakıyordu; üretici o turda yeni fotoğraf da
 * yükleyemediği için admin'in tek çıkışı QC reddiydi — çıkmaz sokak.
 *
 * Ne olduğu UYDURULMAZ (P2-C2): dönen nesne GERÇEKTEN uygulananı taşır, çünkü
 * kargo ile QC sıfırlaması aynı satırda yarışabilir.
 */
async function applyRevisionSideEffects(args: {
  orderId: string;
  order: typeof orders.$inferSelect;
  stage: ModelUploadStage;
  effects: ReturnType<typeof modelUploadSideEffects>;
  /** Duyurulacak sürüm: yüklemede yeni sürüm, geri getirmede YAYIMLANAN sürüm. */
  revision: number;
  note: string;
  adminEmail: string;
  locale: ReturnType<typeof getRequestLocale>;
}): Promise<AppliedSideEffects> {
  const { orderId, order, revision, note, adminEmail, locale } = args;
  const applied: AppliedSideEffects = {
    qcReset: false,
    qcRound: null,
    approvalRoundOpened: false,
    manufacturerAckRequired: false,
    painterNotified: false,
    customerNotified: false,
  };

  // ── QC sıfırlama ─────────────────────────────────────────────────────────
  // Baskı bitmiş ya da QC turundaysa: tur artar, bekleyen fotoğraflar
  // reddedilir, üretici `printing`e döner. Kargo kapısı (`manufacturerStatus =
  // 'qc_approved'`) aynı satırda olduğu için ESKİ modelin baskısı QC'den geçip
  // yola çıkamaz — ikisi aynı satırda sıralanır (bkz. resetQcForNewRevision).
  // Yarışı kargo kazandıysa `qcReset:false` döner ve admin gerçeği görür.
  if (args.effects.resetsQc) {
    const reset = await resetQcForNewRevision(orderId).catch((e) => {
      console.error("[upload-model] QC sıfırlanamadı", e);
      return { qcReset: false, qcRound: null, rejectedPhotos: 0 };
    });
    applied.qcReset = reset.qcReset;
    applied.qcRound = reset.qcRound;
  }

  // ── Müşteri onay turu ────────────────────────────────────────────────────
  // Müşteri onay bekliyorsa, gördüğü model artık geçersizdir: YENİ tur açılır
  // ve bağlantı yeniden gider. Eski turu "onaylanmış" saymak, mesafeli
  // sözleşmenin üretim şartını yok saymak olurdu.
  if (args.effects.newApprovalRound) {
    try {
      const approval = await openModelApproval({
        orderId,
        channel: order.waConversationId ? "whatsapp" : "email",
      });
      applied.approvalRoundOpened = true;
      if (order.email) {
        await getEmailQueue()
          .add("model-approval", {
            type: "model_approval_request",
            to: order.email,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            approvalUrl: approval.approvalUrl,
            turntableUrl: approval.turntableUrl ?? undefined,
            locale,
          })
          .catch((e) => console.error("[upload-model] onay e-postası kuyruğa girmedi", e));
      }
    } catch (e) {
      console.error("[upload-model] yeni onay turu açılamadı", e);
    }
  }

  // Partnere gidecek CÜMLEYİ aşama seçer (partner-model-ack · modelRevisionNoticeTr):
  // `printed_or_qc` cümlesi "kalite kontrol turu sıfırlandı" der. Denenen
  // sıfırlama tutmadıysa o cümle yalan olurdu — sipariş o anda hangi aşamadaysa
  // haber ona göre verilir, yani partner OLAN BİTENİ okur.
  const stage =
    args.effects.resetsQc && !applied.qcReset
      ? await stageAfterSideEffects(orderId, args.stage)
      : args.stage;
  const effects = stage === args.stage ? args.effects : modelUploadSideEffects(stage);

  // ── Duyuru (P2-C3) ───────────────────────────────────────────────────────
  // Üretici ve boyacı gelen kutusu + e-posta ile haber alır, iki partner
  // konusuna da realtime olay düşer. `requireAck` yalnız üretimin etkilendiği
  // aşamalarda: kargolanmış siparişte kimseyi onaya zorlamak anlamsızdır,
  // üretim başlamamışken de kapı gereksizdir.
  // Kargolanmış/teslim edilmiş sipariş (recordOnly) DIŞARIDA: karar açık —
  // kargodan sonra üretimde değişen bir şey yoktur ve haber verilecek tek kişi
  // dijital dosya satın almış müşteridir. İşini teslim etmiş üreticiye "model
  // güncellendi" yazmak, yapacak bir şeyi olmayan birine iş varmış gibi görünen
  // bir bildirim göndermek olurdu (P2A-8).
  const announced = effects.recordOnly
    ? { manufacturerAckRequired: false, painterNotified: false }
    : await notifyOrderModelRevision({
        orderId,
        revision,
        uploadedByEmail: adminEmail,
        stage,
        note: note || null,
        requireAck: effects.needsManufacturerAck || effects.notifiesPainter,
      });
  applied.manufacturerAckRequired = announced.manufacturerAckRequired;
  applied.painterNotified = announced.painterNotified;

  if (effects.recordOnly) {
    applied.customerNotified = await notifyDigitalFilesCustomer(order, revision);
  }

  return applied;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locale = getRequestLocale(request);
    const d = getDictionary(locale);

    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id: orderId } = await params;

    const entries: Entry[] = [];
    const stagedIds: string[] = [];
    const fail = async (status: number, error: string) => {
      await Promise.all(stagedIds.map((id) => discardStagedUpload(id).catch(() => {})));
      return NextResponse.json({ error }, { status });
    };

    // SİPARİŞ KAPILARI GÖVDEDEN ÖNCE: kimlik, varlık ve İADE.
    //
    // NEDEN: gövde ayrıştırma (formData) bu kapıların önündeydi ve korumasızdı.
    // multipart olmayan bir gövde (ör. JSON) formData()'yı fırlatıyor, Next bunu
    // BOŞ GÖVDELİ bir 500'e çeviriyordu; iade edilmiş bir siparişte bile yönetici
    // "(HTTP 500)" görüyor, kardeş uçların verdiği tek Türkçe iade cümlesini
    // göremiyordu. Sipariş kimliği YOLDAN gelir, gövdeden değil — iade cevabı
    // gövdeye hiç bakmadan verilebilir ve verilmelidir. Bu noktada hazırlanmış
    // parça da yoktur (stagedIds boş), yani `fail` yalnız cevabı yazar.
    if (!UUID_RE.test(orderId)) return fail(404, d["api.order.notFound"]);

    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!order) return fail(404, d["api.order.notFound"]);
    // A model upload is a forward action (refund-end-state): it advances
    // awaiting_model → approved, the assignable shape.
    if (isRefunded(order)) return fail(409, REFUNDED_ORDER_ERROR);

    // Gövde ayrıştırma KORUMALI: bozuk/yanlış türde gövde, sessiz bir 500 değil
    // okunaklı bir 400 döndürür.
    const formData = await request.formData().catch((e) => {
      console.error("[upload-model] istek gövdesi okunamadı", e);
      return null;
    });
    if (!formData) {
      return fail(
        400,
        "İstek gövdesi okunamadı: model dosyaları multipart/form-data olarak gönderilmelidir."
      );
    }

    // "Önceki parçaları koru": aynı adlı parça yenisiyle yerinde değişir, diğerleri
    // önceki sürümden aynen taşınır (bkz. mergeRevisionFiles).
    const carryForward = formData.get("carryForward") === "1";
    const note = readNote(formData.get("note"));

    const rawFiles = formData.get("files");
    if (typeof rawFiles === "string" && rawFiles.trim()) {
      let list: unknown;
      try {
        list = JSON.parse(rawFiles);
      } catch {
        return fail(400, "Geçersiz dosya listesi.");
      }
      if (!Array.isArray(list)) return fail(400, "Geçersiz dosya listesi.");
      // Register every id FIRST so a rejection further down discards them all.
      for (const item of list) {
        const uploadId = String((item as { uploadId?: unknown })?.uploadId ?? "");
        if (isValidUploadId(uploadId)) stagedIds.push(uploadId);
      }
      for (const item of list) {
        const uploadId = String((item as { uploadId?: unknown })?.uploadId ?? "");
        const name = String((item as { name?: unknown })?.name ?? "").slice(0, 300);
        if (!isValidUploadId(uploadId)) return fail(400, "Geçersiz yükleme kimliği.");
        const kind = orderModelKindOf(name);
        if (!kind) return fail(400, `${name || "Dosya"}: yalnız STL ve GLB yüklenebilir.`);
        entries.push({ source: "staged", uploadId, name, kind });
      }
    }

    // Older single-pair clients.
    for (const kind of ["glb", "stl"] as const) {
      const upId = String(formData.get(`${kind}UploadId`) ?? "");
      const file = formData.get(kind);
      if (upId) {
        if (!isValidUploadId(upId)) return fail(400, "Geçersiz yükleme kimliği.");
        stagedIds.push(upId);
        entries.push({ source: "staged", uploadId: upId, name: `model.${kind}`, kind });
      } else if (file instanceof File && file.size > 0) {
        entries.push({ source: "inline", file, name: file.name || `model.${kind}`, kind });
      }
    }

    if (entries.length === 0) return fail(400, "En az bir STL ya da GLB dosyası yükleyin.");
    if (entries.length > MAX_ORDER_MODEL_FILES) {
      return fail(400, `Bir sürümde en fazla ${MAX_ORDER_MODEL_FILES} dosya yüklenebilir.`);
    }

    // Tek politika (P2-C1): reddedilmiş sipariş dışında her aşama açıktır.
    if (!modelUploadAllowed(order)) {
      return fail(400, "Reddedilmiş siparişe model yüklenemez.");
    }

    const stage = modelUploadStage(order);
    const effects = modelUploadSideEffects(stage);
    // Üretici `accepted`'ın ötesindeyse gerekçe ŞART: o noktadan sonra yeni bir
    // model birinin elindeki fiziksel işi geçersiz kılıyor.
    if (effects.requiresNote && !note) {
      return fail(
        400,
        "Bu aşamada model değiştirmek için gerekçe yazın: " + effects.warningTr
      );
    }

    // Validate everything before promoting anything.
    const checked: { entry: Entry; sizeBytes: number | null }[] = [];
    for (const e of entries) {
      let size: number | null;
      let head: Uint8Array;
      if (e.source === "staged") {
        size = await stagedSize(e.uploadId);
        if (size === null) return fail(400, `${e.name}: yükleme bulunamadı ya da süresi doldu.`);
        head = await readStagedHead(e.uploadId, MODEL_HEAD_BYTES).catch(() => new Uint8Array(0));
      } else {
        size = e.file.size;
        head = new Uint8Array(await e.file.slice(0, MODEL_HEAD_BYTES).arrayBuffer());
      }
      const verdict = verifyModelHead(e.kind, head, size);
      if (!verdict.ok) return fail(400, `${e.name}: ${verdict.reason}.`);
      checked.push({ entry: e, sizeBytes: size });
    }

    // Disk names are ASCII nanoids; the human name lives in order_model_files.
    //
    // Everything from here on runs AFTER validation. If promotion or the DB write
    // throws (disk full, lock timeout, the merged set exceeding the cap), undo it
    // all: discard what is still staged and delete what was already promoted, so
    // a failed upload leaves neither orphaned files nor a half revision — and the
    // admin gets a readable JSON error instead of an HTML 500 page.
    const dir = `models/${orderId}`;
    const inputs: OrderModelFileInput[] = [];
    let result: Awaited<ReturnType<typeof attachOrderModelFiles>>;
    try {
      for (const { entry: e, sizeBytes } of checked) {
        const diskName = `${nanoid()}.${e.kind}`;
        const key =
          e.source === "staged"
            ? await promoteStagedUpload(e.uploadId, dir, diskName)
            : await saveFile(Buffer.from(await e.file.arrayBuffer()), dir, diskName);
        inputs.push({ key, name: e.name, kind: e.kind, sizeBytes });
      }

      // Revision archiving + the order's live model columns are written by
      // attachOrderModelFiles(), the SAME function the auto-3D worker reaches — the
      // two hands that produce a model must not keep separate copies of this logic.
      // It does not touch orders.status; that stays here. `turntableKey` is NOT
      // passed: leaving it out preserves the 360° video of a meshy_auto order
      // instead of silently wiping it.
      result = await attachOrderModelFiles({
        orderId,
        files: inputs,
        carryForward,
        source: "admin_upload",
        note: note || undefined,
        uploadedByEmail: a.session.user.email,
      });
    } catch (err) {
      await Promise.all(stagedIds.map((id) => discardStagedUpload(id).catch(() => {})));
      await Promise.all(inputs.map((f) => deleteFile(f.key).catch(() => {})));
      if (err instanceof TooManyModelFilesError) {
        return NextResponse.json(
          {
            error: `Önceki parçalarla birlikte ${err.total} dosya oluyor; bir sürümde en fazla ${MAX_ORDER_MODEL_FILES} dosya olabilir. "Önceki parçaları koru" kutusunu kapatıp tüm seti yükleyin.`,
          },
          { status: 400 }
        );
      }
      console.error("[upload-model] kaydedilemedi", err);
      return NextResponse.json(
        { error: "Dosyalar kaydedilemedi; sipariş değişmedi. Tekrar deneyin." },
        { status: 500 }
      );
    }

    // Advance awaiting_model → approved. Durum SADECE oradan ilerler: başka bir
    // aşamada okunan (bayat) durumu geri yazmak, aynı istekte QC sıfırlamasının
    // yazacağı `printing`i ezerdi.
    //
    // Cancellation can leave payment succeeded. Check the current status too,
    // and only advance if the order still awaits its model. The saved revision
    // remains attached and audited even when the transition loses.
    const advances = order.status === "awaiting_model";
    const newStatus = advances ? "approved" : order.status;
    const [advanced] = await db
      .update(orders)
      .set({
        ...(advances ? { status: "approved" as const } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(orders.id, orderId),
        notRefundedGuard(),
        ne(orders.status, "rejected"),
        advances ? eq(orders.status, "awaiting_model") : undefined,
      ))
      .returning({ id: orders.id });

    const stl = inputs.filter((f) => f.kind === "stl").length;
    const glb = inputs.length - stl;
    await db.insert(adminActions).values({
      orderId,
      action: "upload_model",
      adminEmail: a.session.user.email,
      notes: auditNote(
        result.revision,
        stage,
        order,
        `${inputs.length} dosya yüklendi (${stl} STL, ${glb} GLB)${
        result.carriedCount > 0 ? `, ${result.carriedCount} parça önceki sürümden taşındı` : ""
      }; toplam ${result.fileCount} dosya`,
        note
      ),
    });

    if (!advanced) {
      return NextResponse.json({
        error: "Model dosyaları kaydedildi ancak sipariş durumu değiştiği için sonraki işlemler uygulanmadı. Sayfayı yenileyin.",
      }, { status: 409 });
    }

    // Yan etkiler (QC sıfırlama, müşteri onay turu, partner duyurusu, kargo
    // sonrası dijital dosya müşterisi) TEK yerden uygulanır: "bu sürümü geçerli
    // yap" yolu da aynı fonksiyondan geçer, yoksa iki yol ayrışır.
    const applied = await applyRevisionSideEffects({
      orderId,
      order,
      stage,
      effects,
      revision: result.revision,
      note,
      adminEmail: a.session.user.email,
      locale,
    });

    await emitOrderChanged({
      orderId,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: applied.qcReset ? "printing" : newStatus,
    });

    // Model yüklemesi, elle yazılmış siparişin üreticiye gidebildiği ANDIR
    // (manual-orders-without-model kararı): sipariş o ana kadar basılabilir
    // içeriği olmadığı için `awaiting_model`'da bekler, dosya inince burada
    // yerleştirilir. Durum kontrolü yapılmaz — `autoAssignIfEligible` her
    // siparişte güvenlidir ve uygun değilse hiçbir şey yapmaz; böylece zaten
    // `approved` + atanmamış duran bir siparişe model eklemek de onu yerleştirir.
    const placement = await autoAssignIfEligible(orderId, {
      reason: "model yüklendi",
    });

    return NextResponse.json({
      success: true,
      status: applied.qcReset ? "printing" : newStatus,
      autoAssigned: placement.assigned,
      ...(placement.skipped ? { autoAssignSkipped: placement.skipped } : {}),
      revision: result.revision,
      fileCount: result.fileCount,
      carriedCount: result.carriedCount,
      modelGlbUrl: result.glbUrl,
      // P2-C2: admin ne olduğunu tam olarak görür.
      stage,
      warning: effects.warningTr,
      appliedSideEffects: applied,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/upload-model", ADMIN_ACTION_FAILED_ERROR);
  }
}

/**
 * Sürüm yönetimi — "bu sürümü geçerli yap".
 *
 * Kaynak sürümün dosya kümesi EN ÜSTE yeni bir sürüm (N+1) olarak yayımlanır
 * (bkz. setCurrentModelRevision): partnerin indirdiği ZIP, müşterinin dijital
 * dosyası ve QC damgası hep EN YÜKSEK sürümü okuduğu için, geri getirmenin
 * gerçekten "ne indirildiğini" değiştirmesinin tek yolu budur.
 *
 * Bu yüzden geri getirme bir YÜKLEMEDİR: aşamanın yan etkileri (QC sıfırlama,
 * yeni müşteri onay turu, partner duyurusu, kargo sonrası dijital dosya
 * müşterisi) yükleme yolundaki fonksiyonun aynısından geçer. Aksi hâlde QC
 * turundayken geri getirilen sürüm, QC onayının bayat sayıp reddettiği bir turu
 * açık bırakıyor ve admin'i çıkışsız bırakıyordu.
 *
 * Body: { revision: number, note?: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locale = getRequestLocale(request);
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id: orderId } = await params;

    const body = await request.json().catch(() => ({}));
    const revision = Number((body as { revision?: unknown })?.revision);
    if (!Number.isInteger(revision) || revision <= 0) {
      return NextResponse.json({ error: "Geçersiz sürüm numarası." }, { status: 400 });
    }
    const note = typeof (body as { note?: unknown })?.note === "string"
      ? (body as { note: string }).note.trim().slice(0, 1000)
      : "";

    if (!UUID_RE.test(orderId)) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    if (!modelUploadAllowed(order)) {
      return NextResponse.json(
        { error: "Reddedilmiş siparişin modeli değiştirilemez." },
        { status: 400 }
      );
    }

    const stage = modelUploadStage(order);
    const effects = modelUploadSideEffects(stage);
    if (effects.requiresNote && !note) {
      return NextResponse.json(
        { error: "Bu aşamada geçerli sürümü değiştirmek için gerekçe yazın: " + effects.warningTr },
        { status: 400 }
      );
    }

    let changed;
    try {
      // Gerekçe ve YAPAN kişi yeni sürümün kendisine yazılır: geri getirme de bir
      // yüklemedir, sürüm listesi admin'in az önce açtığı sürüm için "Yükleyen:
      // bilinmiyor" göstermemeli.
      changed = await setCurrentModelRevision(orderId, revision, {
        note: note || null,
        uploadedByEmail: a.session.user.email,
      });
    } catch (err) {
      if (err instanceof ModelRevisionNotFoundError) {
        return NextResponse.json({ error: `Sürüm ${revision} bulunamadı.` }, { status: 404 });
      }
      // Dosya satırı da başlık anahtarı da olmayan (bozuk ya da 0053 öncesi) kayıt:
      // yayımlansaydı EN ÜST sürüm boş olur ve üreticinin parça listesi BOŞALIRDI.
      // Servis bu yüzden reddediyor; admin genel bir 500 yerine ne yapacağını
      // söyleyen Türkçe bir ret görmeli.
      if (err instanceof ModelRevisionEmptyError) {
        return NextResponse.json(
          {
            error:
              `Sürüm ${revision} geri getirilemez: bu sürümün dosya kaydı yok. ` +
              "Dosyaları yeni bir sürüm olarak yükleyin.",
          },
          { status: 409 }
        );
      }
      console.error("[upload-model] sürüm geçerli yapılamadı", err);
      return NextResponse.json({ error: "Sürüm değiştirilemedi." }, { status: 500 });
    }

    // Sürüm ZATEN geçerliyse hiçbir şey değişmedi (servis de yazmaz): ne QC
    // sıfırlanır ne de partnere "yeni sürüm" denir. Değişmemiş bir dosya için
    // üreticiyi baskıya döndürmek, olmayan bir değişikliği cezalandırmak olurdu.
    const republished = changed.newRevision !== null;
    const liveRevision = changed.newCurrentRevision;

    await db.insert(adminActions).values({
      orderId,
      action: "upload_model",
      adminEmail: a.session.user.email,
      // Denetim satırı CANLI sürüme anahtarlanır: admin ekranı sürümleri notun
      // başındaki "Sürüm N" ile eşliyor (page.tsx), geri getirme ise kaynağın
      // kopyasını N+1 olarak yayımlıyor. Kaynağa anahtarlamak, satırı hiç
      // değişmemiş eski sürümün altına asardı.
      notes: auditNote(
        liveRevision,
        stage,
        order,
        republished
          ? `sürüm ${revision} yeniden geçerli yapıldı (sürüm ${liveRevision} olarak yayımlandı)`
          : `sürüm ${revision} zaten geçerliydi; değişiklik yapılmadı`,
        note
      ),
    });

    // Geri getirme de bir yüklemedir: aşamanın yan etkileri YÜKLEME ile aynı
    // fonksiyondan geçer (QC sıfırlama dahil) ve rapor da aynı şekilde döner.
    const applied: AppliedSideEffects = republished
      ? await applyRevisionSideEffects({
          orderId,
          order,
          stage,
          effects,
          revision: liveRevision,
          note,
          adminEmail: a.session.user.email,
          locale,
        })
      : {
          qcReset: false,
          qcRound: null,
          approvalRoundOpened: false,
          manufacturerAckRequired: false,
          painterNotified: false,
          customerNotified: false,
        };

    // Tek olay, yüklemedeki kuralın aynısı: duyuru kendi olayını basar ama her
    // yolda basmaz (kayıt amaçlı aşamada duyuru yok, değişmeyen sürümde hiç yan
    // etki yok) ve QC sıfırlaması durumu `printing`e çekmiş olabilir.
    await emitOrderChanged({
      orderId,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: applied.qcReset ? "printing" : order.status,
    });

    return NextResponse.json({
      success: true,
      // Yayımlanan (canlı) sürüm; kaynak numara ayrıca döner.
      revision: liveRevision,
      sourceRevision: changed.revision,
      newRevision: changed.newRevision,
      republished,
      fileCount: changed.fileCount,
      modelGlbUrl: changed.glbUrl,
      modelStlUrl: changed.stlUrl,
      stage,
      warning: effects.warningTr,
      appliedSideEffects: applied,
      manufacturerAckRequired: applied.manufacturerAckRequired,
      painterNotified: applied.painterNotified,
      customerNotified: applied.customerNotified,
    });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/admin/orders/[id]/upload-model", ADMIN_ACTION_FAILED_ERROR);
  }
}

/**
 * Sürüm silinemez: parçayı KİM tutuyor?
 *
 * Cümleyi politikanın AŞAMASI kurar (ModelRevisionInUseError `stage` taşır),
 * üretici durumu değil. Tek başına üretici durumunu okumak iki hâli yanlış
 * anlatıyordu: parça BOYACIDAYKEN "üretici onu basıyor" deniyordu ve admin'in
 * kendi bastığı siparişte (üretici yok, manufacturerStatus NULL) cümle "üretici
 * onu basıyor (bilinmiyor)" oluyordu — admin, işin içinde olmayan bir atölyeyi
 * aramaya gidiyordu.
 *
 * Çözüm cümlesi de ULAŞILABİLİR: kilit yalnız GEÇERLİ sürüme vurulur, yani yeni
 * bir sürüm yayımlandığı anda eskisi silinebilir hâle gelir. "Üretici onaylayınca
 * silersiniz" ise üreticisi olmayan siparişte çıkışsız bir tarifti.
 */
function revisionInUseMessage(err: ModelRevisionInUseError): string {
  const mfr = err.manufacturerStatus ? ` (üretici durumu: ${err.manufacturerStatus})` : "";
  const tail =
    "Silmek yerine yeni bir sürüm yükleyin; yeni sürüm yayımlandıktan sonra bu sürümü silebilirsiniz.";
  switch (err.stage) {
    case "painting":
      return (
        `Bu sürüm siparişin GEÇERLİ modeli ve bu sürümden basılan parça şu anda BOYACIDA${mfr}. ` +
        tail
      );
    case "shipped_or_delivered":
      return (
        "Bu sürüm siparişin GEÇERLİ modeli ve sipariş kargoya verildi; müşteriye giden baskının " +
        "kaydı silinemez. Kayıt için yeni bir sürüm yükleyebilirsiniz."
      );
    case "printed_or_qc":
      return err.manufacturerStatus
        ? `Bu sürüm siparişin GEÇERLİ modeli; üretici bu sürümü bastı ve kalite kontrol sürüyor${mfr}. ${tail}`
        : `Bu sürüm siparişin GEÇERLİ modeli; baskı burada (üretici atanmadan) yapıldı ve kalite kontrol sürüyor. ${tail}`;
    default:
      return err.manufacturerStatus
        ? `Bu sürüm siparişin GEÇERLİ modeli ve üretici onu basıyor${mfr}. ${tail}`
        : `Bu sürüm siparişin GEÇERLİ modeli ve sipariş burada (üretici atanmadan) basılıyor. ${tail}`;
  }
}

/**
 * Yanlış bir yüklemeyi siler.
 *
 * Üretici O SÜRÜMÜ basıyorsa reddedilir (409): elindeki dosyayı altından
 * çekmek, ekranını boşaltmak ve neyi bastığını kaydsız bırakmaktır. Diskteki
 * dosyalar yalnız BAŞKA sürüm göstermiyorsa silinir ("önceki parçaları koru"
 * ile açılan sürümler aynı dosyayı paylaşır).
 *
 * `?revision=N` ya da body { revision: N }.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id: orderId } = await params;

    const body = await request.json().catch(() => ({}));
    const raw =
      request.nextUrl.searchParams.get("revision") ?? (body as { revision?: unknown })?.revision;
    const revision = Number(raw);
    if (!Number.isInteger(revision) || revision <= 0) {
      return NextResponse.json({ error: "Geçersiz sürüm numarası." }, { status: 400 });
    }

    if (!UUID_RE.test(orderId)) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }

    let removed;
    try {
      removed = await deleteModelRevision(orderId, revision);
    } catch (err) {
      if (err instanceof ModelRevisionNotFoundError) {
        return NextResponse.json({ error: `Sürüm ${revision} bulunamadı.` }, { status: 404 });
      }
      if (err instanceof ModelRevisionInUseError) {
        return NextResponse.json({ error: revisionInUseMessage(err) }, { status: 409 });
      }
      console.error("[upload-model] sürüm silinemedi", err);
      return NextResponse.json({ error: "Sürüm silinemedi." }, { status: 500 });
    }

    // Depolama hatası veritabanı işlemini geri almamalı: satırlar gitti, dosya
    // artıkları en kötü ihtimalle diskte kalır.
    await Promise.all(removed.deletedKeys.map((k) => deleteFile(k).catch(() => {})));

    await db.insert(adminActions).values({
      orderId,
      action: "upload_model",
      adminEmail: a.session.user.email,
      notes: auditNote(
        revision,
        modelUploadStage(order),
        order,
        `sürüm silindi (${removed.deletedKeys.length} dosya diskten kaldırıldı); geçerli sürüm: ${
        removed.newCurrentRevision ?? "yok"
      }`,
        ""
      ),
    });

    await emitOrderChanged({
      orderId,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: order.status,
    });

    return NextResponse.json({
      success: true,
      deletedFiles: removed.deletedKeys.length,
      // BİLGİLENDİRME alanı, kapı değil: silme YAPILDI (satırlar gitti, dosyalar
      // diskten kaldırıldı). Korumasız hâlinde sürüm tablosunun aynı arızası bu
      // son okumada fırlıyor ve tamamlanmış bir silme, admin'e "işlem
      // tamamlanamadı" diye dönüyordu — admin de silinmiş sürümü yeniden
      // silmeyi deniyordu (404).
      currentRevision:
        removed.newCurrentRevision ??
        (await currentModelRevision(orderId).catch((e) => {
          console.error("[upload-model] silme sonrası geçerli sürüm okunamadı", e);
          return null;
        })),
    });
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/admin/orders/[id]/upload-model", ADMIN_ACTION_FAILED_ERROR);
  }
}
