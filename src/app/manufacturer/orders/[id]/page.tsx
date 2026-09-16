export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderItems,
  orderPhotos,
  generationAttempts,
  manufacturerActions,
  manufacturers,
  manufacturerEarnings,
  qcPhotos,
  qcReviews,
  products,
  orderModelRevisions,
  previews,
  uploadedModels,
} from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { normalizeFileUrl, getPublicUrl } from "@/lib/services/storage";
import { getProductSpec } from "@/lib/services/product-spec";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";
import { orderMoneySplit } from "@/lib/services/earning-base";
import { computeEarning } from "@/lib/services/finance";
import { loadEarningReversalRecord } from "@/lib/services/order-money";
import { latestModelFiles } from "@/lib/services/order-model";
import { readPartnerModelAck } from "@/lib/services/order-model-revision";
import { currentModelUrl } from "@/lib/config/order-model-presence";
import { ManufacturerOrderDetailClient } from "./client";

/**
 * GÖSTERİM amaçlı okuma: sonucu ekranda yalnızca GÖSTERİLİR, bir kapıyı açıp
 * kapatmaz. Arıza YUTULMAZ — null döner ve null "kayıt yok" değil "BİLİNMİYOR"
 * demektir; bayrak sayfanın üstündeki şeritte yazılır.
 *
 * NEDEN: üreticinin sipariş ekranı, uçların dürüst 503'ünü okuyabileceği TEK
 * yerdir. Yalnız gösterilen bir tablo yüzünden sayfanın tamamının 500 vermesi,
 * partneri tam da arıza anında dışarıda bırakıyordu.
 */
async function displayRead<T>(
  label: string,
  orderId: string,
  query: PromiseLike<T>
): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[manufacturer order ${orderId}] ${label} okunamadı`, e);
    return null;
  }
}

/** Sayfanın üstünde duran arıza şeridi (partner sebebini burada okur). */
function CoreReadNotice({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
    >
      <p className="font-semibold">
        Bu siparişin bazı bilgileri şu anda okunamıyor (geçici sistem arızası)
      </p>
      <p className="mt-1 text-amber-900/80">
        Sipariş açıldı; ama şu bölümler BOŞ DEĞİL, BİLİNMİYOR:{" "}
        {areas.join(" · ")}. Boş görünmeleri &quot;kayıt yok&quot; anlamına gelmez
        ve hiçbir dosya silinmedi. Birkaç dakika sonra sayfayı yenileyin; sürerse
        yönetici ile mesajlaşmadan teyitleşin.
      </p>
    </div>
  );
}

export default async function ManufacturerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getManufacturerSession();
  if (!session) {
    redirect("/manufacturer/login");
  }

  // Verify manufacturer is active
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });

  if (!manufacturer || manufacturer.status !== "active") {
    redirect("/manufacturer/dashboard");
  }

  const { id } = await params;
  const locale = await getLocale();

  // ─── ÇEKİRDEK OKUMA: yalnız SİPARİŞİN KENDİSİ ────────────────────────────
  //
  // `with:` BİLEREK YOK. Drizzle'ın ilişkisel sorgusu TEK ifadedir: içindeki
  // YAN tablolardan biri (fotoğraflar, QC kayıtları, ürün görselleri, sürüm
  // başlıkları…) okunamadığında SORGUNUN TAMAMI fırlar ve üreticinin sipariş
  // sayfası 500 verir — tam da "Model onay kaydınız okunamıyor" uyarısının
  // okunması gereken anda (ölçüm: 13 sayfanın 13'ü). Yalnız GÖSTERİLEN her
  // ilişki artık AYRI ve KORUMALI okunur.
  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.id, id),
      eq(orders.manufacturerId, session.manufacturerId)
    ),
  });

  if (!order) notFound();

  // ─── Yalnız GÖSTERİLEN ilişkiler: her biri AYRI ve KORUMALI ──────────────
  const [
    photoRead,
    generationRead,
    qcPhotoRead,
    qcReviewRead,
    productRead,
    previewRead,
    revisionRead,
    uploadedModelRead,
  ] = await Promise.all([
    displayRead(
      "müşteri fotoğrafları",
      id,
      db
        .select({ id: orderPhotos.id, originalUrl: orderPhotos.originalUrl })
        .from(orderPhotos)
        .where(eq(orderPhotos.orderId, id))
    ),
    displayRead(
      "eski üretim denemesi",
      id,
      db
        .select({
          id: generationAttempts.id,
          outputGlbUrl: generationAttempts.outputGlbUrl,
          outputStlUrl: generationAttempts.outputStlUrl,
          outputObjUrl: generationAttempts.outputObjUrl,
        })
        .from(generationAttempts)
        .where(
          and(
            eq(generationAttempts.orderId, id),
            eq(generationAttempts.status, "succeeded")
          )
        )
        .orderBy(desc(generationAttempts.createdAt))
        .limit(1)
    ),
    displayRead(
      "QC fotoğraflarınız",
      id,
      db
        .select({
          id: qcPhotos.id,
          storageKey: qcPhotos.storageKey,
          thumbnailKey: qcPhotos.thumbnailKey,
          round: qcPhotos.round,
          reviewStatus: qcPhotos.reviewStatus,
        })
        .from(qcPhotos)
        .where(eq(qcPhotos.orderId, id))
        .orderBy(desc(qcPhotos.createdAt))
    ),
    displayRead(
      "QC kararları",
      id,
      db
        .select({
          decision: qcReviews.decision,
          reason: qcReviews.reason,
          round: qcReviews.round,
          createdAt: qcReviews.createdAt,
        })
        .from(qcReviews)
        .where(eq(qcReviews.orderId, id))
        .orderBy(desc(qcReviews.createdAt))
    ),
    // Ürün kaydı + görselleri: "ürün yok" ile "okunamadı" ayrı kalsın diye
    // sonuç nesneye sarılır.
    displayRead("ürün bilgisi ve görselleri", id, (async () => {
      if (!order.productId) return { row: null };
      const row = await db.query.products.findFirst({
        where: eq(products.id, order.productId),
        columns: {
          id: true,
          title: true,
          description: true,
          leadTimeDays: true,
          material: true,
        },
        with: { images: { columns: { storageKey: true, sortOrder: true } } },
      });
      return { row: row ?? null };
    })()),
    displayRead("müşterinin onayladığı görsel", id, (async () => {
      if (!order.previewId) return { row: null };
      const row = await db.query.previews.findFirst({
        where: eq(previews.id, order.previewId),
        columns: { selectedStyledImageUrl: true, photoKeys: true },
      });
      return { row: row ?? null };
    })()),
    displayRead(
      "model sürüm başlıkları",
      id,
      db
        .select({
          revision: orderModelRevisions.revision,
          note: orderModelRevisions.note,
          createdAt: orderModelRevisions.createdAt,
        })
        .from(orderModelRevisions)
        .where(eq(orderModelRevisions.orderId, id))
        .orderBy(desc(orderModelRevisions.revision))
    ),
    displayRead("müşterinin yüklediği model bilgileri", id, (async () => {
      if (!order.uploadedModelId) return { row: null };
      const row = await db.query.uploadedModels.findFirst({
        where: eq(uploadedModels.id, order.uploadedModelId),
        columns: {
          fileName: true,
          targetHeightMm: true,
          material: true,
          boundingBoxMm: true,
          minWallThicknessMm: true,
          printRisk: true,
          sourceFormat: true,
          volumeMm3: true,
          isVolume: true,
        },
      });
      return { row: row ?? null };
    })()),
  ]);

  const photoRows = photoRead ?? [];
  const generationRows = generationRead ?? [];
  const qcPhotoRows = qcPhotoRead ?? [];
  const qcReviewRows = qcReviewRead ?? [];
  const productRow = productRead?.row ?? null;
  const previewRow = previewRead?.row ?? null;
  const modelRevisionRows = revisionRead ?? [];
  const uploadedModelRow = uploadedModelRead?.row ?? null;

  // Eylem günlüğü AYRI ve KORUMALI okunur — sipariş sorgusunun İÇİNDE değil.
  //
  // NEDEN: bu satırlar yukarıdaki sorgunun `with` cümlesinde lateral join
  // olarak çekiliyordu, yani manufacturer_actions okunamadığında (geçici arıza)
  // SORGUNUN TAMAMI fırlıyor ve sayfa 500 veriyordu. Tam da o anda gösterilmesi
  // gereken "Model onay kaydınız şu anda okunamıyor" uyarısı (readPartnerModelAck
  // kendi try/catch'iyle readFailed döner, client.tsx onu basar) hiç
  // görünemiyordu: partner, uçların dürüst 503'ünü okuyabileceği bir ekran
  // bulamıyordu. Ayrı okumada arıza yalnız "İşlem geçmişi" kartını boşaltır;
  // sayfa açılır ve partner sebebi okur.
  const actionRows = await db
    .select({
      id: manufacturerActions.id,
      action: manufacturerActions.action,
      notes: manufacturerActions.notes,
      createdAt: manufacturerActions.createdAt,
    })
    .from(manufacturerActions)
    .where(
      and(
        eq(manufacturerActions.orderId, order.id),
        eq(manufacturerActions.manufacturerId, session.manufacturerId)
      )
    )
    .orderBy(desc(manufacturerActions.createdAt))
    .catch((e) => {
      console.error("manufacturer order page: action log read failed", e);
      return null;
    });

  const latestGeneration = generationRows[0] ?? null;
  // Every part of the CURRENT model revision. A job can be 12-13 separate STLs;
  // the single glbUrl/stlUrl below is only the primary file of each kind.
  //
  // NEDEN AYRI BAYRAK: bu okumanın null'ı bir gösterim boşluğu DEĞİL, bir
  // KAPININ girdisidir. Sessizce boş listeye çevrildiğinde istemci `multiPart`ı
  // false hesaplıyor (client.tsx) ve 12-13 parçalık bir iş TEK dosyalık iş gibi
  // görünüyordu: atölye tek parçayı basıp işi bitmiş sayardı. Bilinmezlik "tek
  // parça" DEĞİLDİR.
  const latestFilesRead = await displayRead(
    "model parça listesi",
    id,
    latestModelFiles(order.id)
  );
  const modelFilesUnreadable = latestFilesRead === null;
  const latestFiles = latestFilesRead ?? { revision: null, files: [] };

  // Yeni bir model sürümü bu atölyeye DUYURULDU mu ve atölye onu onayladı mı.
  // Eski ekran yalnız pasif bir rozet gösteriyordu ("Model güncellendi"), yani
  // üreticinin yeni dosyayı gördüğünü kimse bilmiyordu; eski sürümle basılan
  // iş QC'den geçip kargolanabiliyordu (late-model-upload kararı).
  const modelAck = await readPartnerModelAck(order.id, {
    kind: "manufacturer",
    id: session.manufacturerId,
  });

  // Only the current round's photos are shown to the manufacturer; older
  // (rejected) rounds stay in the DB as an audit trail.
  const currentRoundPhotos = qcPhotoRows
    .filter((p) => p.round === order.qcRound)
    .map((p) => ({ id: p.id, url: getPublicUrl(p.thumbnailKey ?? p.storageKey) }));
  const latestReject = qcReviewRows.find((r) => r.decision === "rejected");
  const qcRejectReason =
    order.manufacturerStatus === "qc_rejected"
      ? latestReject?.reason ?? null
      : null;

  // Marketplace orders: surface the listed product (title, description, images)
  // instead of the AI-generated model. Custom orders leave these null/empty.
  const marketplaceProduct =
    order.orderType === "marketplace" && productRow
      ? {
          title: order.productTitleSnapshot ?? productRow.title,
          description: productRow.description,
          images: [...productRow.images]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((img) => getPublicUrl(img.storageKey)),
        }
      : null;

  // Every product this marketplace order covers — single buy-now (order.product)
  // OR a cart sub-order's line items — each with its manufacturable spec, so the
  // fulfilling manufacturer can produce them all.
  // Sepet alt siparişinin kalemleri: okuma `if` bloğunun DIŞINDA, çünkü arızanın
  // bayrağı şeride girmek zorunda. Null "kalem yok" DEĞİLDİR: boş listeye
  // çevrildiğinde istemci `hasProductContext`i false hesaplıyor (client.tsx) ve
  // sepet alt siparişi ürünsüz, parçasız, malzeme listesiz bir "elden sipariş"
  // gibi görünüyordu.
  const orderItemRead =
    order.orderType === "marketplace"
      ? await displayRead(
          "sipariş kalemleri",
          id,
          db
            .select({
              id: orderItems.id,
              productId: orderItems.productId,
              title: orderItems.productTitleSnapshot,
              quantity: orderItems.quantity,
              selectedOptions: orderItems.selectedOptions,
              selectedAddons: orderItems.selectedAddons,
              itemImageKey: orderItems.itemImageKey,
            })
            .from(orderItems)
            .where(eq(orderItems.orderId, order.id))
        )
      : [];
  const orderItemsUnreadable = orderItemRead === null;
  const orderItemRows = orderItemRead ?? [];

  const orderProductRefs: {
    itemId: string;
    productId: string;
    title: string;
    quantity: number;
    selectedOptions: { groupName: string; choiceName: string }[];
    selectedAddons: { name: string }[];
    itemImageUrl: string | null;
  }[] = [];
  if (order.orderType === "marketplace") {
    if (order.productId && productRow) {
      orderProductRefs.push({
        itemId: "single",
        productId: order.productId,
        title: order.productTitleSnapshot ?? productRow.title,
        quantity: order.quantity,
        selectedOptions: order.selectedOptions ?? [],
        selectedAddons: order.selectedAddons ?? [],
        itemImageUrl: order.itemImageKey ? getPublicUrl(order.itemImageKey) : null,
      });
    }
    const itemRows = orderItemRows;
    for (const it of itemRows) {
      // One ref per LINE, not per product: two lines of the same product with
      // different options are two separate production jobs.
      if (it.productId) {
        orderProductRefs.push({
          itemId: it.id,
          productId: it.productId,
          title: it.title,
          quantity: it.quantity,
          selectedOptions: it.selectedOptions ?? [],
          selectedAddons: it.selectedAddons ?? [],
          itemImageUrl: it.itemImageKey ? getPublicUrl(it.itemImageKey) : null,
        });
      }
    }
  }
  // Per-line product facts. getProductSpec covers files/BOM/steps but not the
  // listing itself, so an admin-owned product reached the workshop with no
  // material, no description and no images.
  const refIds = [...new Set(orderProductRefs.map((r) => r.productId))];
  const refProductRead = refIds.length
    ? await displayRead(
        "ürün künyeleri",
        id,
        db.query.products.findMany({
        where: inArray(products.id, refIds),
        columns: { id: true, material: true, description: true, leadTimeDays: true },
        with: {
          images: { columns: { storageKey: true, sortOrder: true } },
        },
        })
      )
    : [];
  const refProducts = refProductRead ?? [];
  const productById = new Map(refProducts.map((pr) => [pr.id, pr]));

  // Üretim künyeleri önce TOPLU okunur ki hangi KALEMİN künyesinin bilinmediği
  // isim isim şeride yazılabilsin. Eskiden null sessizce boş künyeye çevriliyordu
  // ve panel "üretim dosyası yok" diyordu: yapılmamış bir okumanın iddiası.
  const specReads = await Promise.all(
    orderProductRefs.map((ref) =>
      displayRead("üretim künyesi", id, getProductSpec(ref.productId))
    )
  );
  const productSpecUnreadable = specReads.some((s) => s === null);
  const specUnknownTitles = orderProductRefs
    .filter((_, i) => specReads[i] === null)
    .map((r) => r.title);
  const productSpecs = orderProductRefs.map((ref, i) => {
      const s = specReads[i] ?? { files: [], components: [], steps: [] };
      const listing = productById.get(ref.productId);
      return {
        itemId: ref.itemId,
        productId: ref.productId,
        title: ref.title,
        quantity: ref.quantity,
        material: listing?.material ?? null,
        // Only when there is no single-product card above (cart sub-orders),
        // otherwise the description/images would appear twice.
        description: marketplaceProduct ? null : listing?.description ?? null,
        images: marketplaceProduct
          ? []
          : [...(listing?.images ?? [])]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((img) => getPublicUrl(img.storageKey)),
        selectedOptions: ref.selectedOptions,
        selectedAddons: ref.selectedAddons,
        itemImageUrl: ref.itemImageUrl,
        files: s.files.map((f) => ({
          id: f.id,
          partName: f.partName,
          fileName: f.fileName,
          sourceFormat: f.sourceFormat,
          quantity: f.quantity,
          glbUrl: f.glbUrl,
          // Geometry the seller's upload already measured — the workshop can
          // sanity-check the scale before starting a long print.
          fileSizeBytes: f.fileSizeBytes,
          volumeMm3: f.volumeMm3,
          boundingBoxMm: f.boundingBoxMm,
        })),
        components: s.components.map((c) => ({
          name: c.name,
          quantity: c.quantity,
          unit: c.unit,
          notes: c.notes,
        })),
        steps: s.steps.map((st) => ({
          instruction: st.instruction,
          imageUrl: st.imageUrl,
        })),
      };
  });

  // What this job pays, derived ONCE here on the server with the same two
  // helpers the accrual itself uses (manufacturerBaseKurus → computeEarning).
  // The card used to redo the commission split in the browser — a hand-copied
  // money rule that could round or drift away from what actually accrues.
  // orderMoneySplit wraps that same manufacturerBaseKurus call and also says
  // whether the base carries the painting kalem (baseIncludesPainting below).
  const moneySplit = orderMoneySplit({
    amountKurus: order.amountKurus,
    productionBaseKurus: order.productionBaseKurus,
    paintingPriceKurus: order.paintingPriceKurus,
    painterId: order.painterId,
    paintsInHouse: manufacturer.paintsInHouse,
  });
  const earningBaseKurus = moneySplit.manufacturerBaseKurus;
  const rateBps = order.commissionRateBps ?? PLATFORM_COMMISSION_RATE_BPS;
  const expectedEarning = computeEarning(earningBaseKurus, rateBps);
  // Once the earning has accrued the card shows THAT row — the amount that
  // will actually be paid, and whether it has been. Scoped to this workshop:
  // after a revoke the order's earning row can belong to the previous one.
  const accruedRead = await displayRead("hakediş kaydınız", id, (async () => {
    const row = await db.query.manufacturerEarnings.findFirst({
    where: and(
      eq(manufacturerEarnings.orderId, order.id),
      eq(manufacturerEarnings.manufacturerId, session.manufacturerId)
    ),
    columns: {
      grossKurus: true,
      commissionKurus: true,
      netKurus: true,
      commissionRateBps: true,
      status: true,
    },
      with: { payout: { columns: { status: true, paidAt: true } } },
    });
    return { row: row ?? null };
  })());
  const earningUnreadable = accruedRead === null;
  const accrued = accruedRead?.row ?? null;

  // Hakediş geri alındıysa geri almanın KAYITLI sebebi — admin para kartıyla AYNI
  // yükleyiciden (services/order-money.ts, denetim kaydını okur). Sebep BURADA
  // türetilmez, yalnız taşınır.
  //
  // NEDEN: bu alan hiç gönderilmiyordu ve istemci tarafında isteğe bağlı olduğu
  // için tsc de susuyordu. earningReversalCause'a göre "gönderilmedi" (undefined)
  // = "kayda BAKILAMADI", yani panel her geri alınan hakedişte "Sebep kaydı şu
  // anda okunamadı" diyordu: yapılmamış bir okumanın iddiası. Kargo kaydı geri
  // alındığı için çevrilen hakediş de üreticiye iade/itiraz gibi görünüyordu.
  //
  // Yalnız geri alınmış satır için okunur: geri alma yoksa cümle zaten kurulmaz
  // (istemcide earningReversed dalı), boşuna denetim sorgusu açılmaz.
  const earningReversal =
    accrued?.status === "reversed" ? await loadEarningReversalRecord(order.id) : null;

  // ─── KAPI: ÜRETİM BAĞLAMI BİLİNMİYORSA İLERİ ADIMLAR KAPALI ─────────────
  //
  // Yukarıdaki üç okuma (sipariş kalemleri, ürün kaydı, üretim künyeleri) yalnız
  // GÖSTERİM değildir: istemci bunlardan `hasProductContext`i hesaplıyor ve boş
  // liste ile OKUNAMADI'yı ayırt edemiyordu. Null sessizce boş listeye
  // çevrildiğinde bir sepet alt siparişi ürünsüz, parçasız, malzeme listesiz bir
  // "elden sipariş" gibi görünüyor; atölye o hâliyle baskıya başlarsa siparişin
  // görünmeyen kalemleri hiç üretilmemiş olur.
  //
  // Şerit zaten "baskıya başlamayın" diyordu — ama bu bir ÖĞÜTTÜ, kapı açıktı.
  // Model parça listesinde (yukarıda) verilen karar burada da geçerlidir:
  // bilinmezlik "tek parça"/"kalem yok" DEĞİLDİR, o yüzden kapı KAPALI tarafa
  // düşer. Kabul ve iptal/ret KASITLI olarak açık kalır (bkz. modelAck kapısı):
  // işi hiç almamış bir atölyeyi kilitlemek, çıkış yolunu da kapatmak olurdu.
  //
  // ADLANDIRMA BİLEREK "…Unreadable" DEĞİL: bu bir OKUMA arızası bayrağı değil,
  // üç arıza bayrağından türetilen bir KAPI kararıdır. Şeritte kendi satırı da
  // yoktur — üç kaynağı (kalem listesi, ürün kaydı, üretim künyesi) şeritte adı
  // adına zaten yazılıyor; dördüncü bir cümle aynı şeyi tekrar söylerdi.
  const productionGateClosed =
    order.orderType === "marketplace" &&
    (orderItemsUnreadable ||
      productSpecUnreadable ||
      // Tek ürünlü (hemen al) sipariş: ürün satırı okunamadığında da künye
      // listesi boş kalır, yani aynı kapı aynı şekilde yanlış açılırdı.
      (order.productId != null && productRead === null));

  // Hangi GÖSTERİM alanı okunamadı: şerit sayfanın en üstünde basılır.
  const unreadableAreas = [
    photoRead === null && "Müşteri fotoğrafları",
    generationRead === null && "Eski üretim denemesinin dosyaları",
    qcPhotoRead === null && "Yüklediğiniz QC fotoğrafları",
    qcReviewRead === null && "QC kararları",
    productRead === null &&
      (order.productId != null
        ? "Ürün bilgisi ve görselleri (bu siparişin ürünü BİLİNMİYOR; künye okunana kadar baskı başlatma, baskıyı bitirme ve kalite kontrole gönderme adımları KAPATILDI)"
        : "Ürün bilgisi ve görselleri"),
    previewRead === null && "Müşterinin onayladığı görsel",
    revisionRead === null && "Model sürüm başlıkları",
    uploadedModelRead === null && "Müşterinin yüklediği model bilgileri",
    refProductRead === null && "Ürün künyeleri",
    earningUnreadable &&
      "Hakediş kaydınız (bu iş için tahakkuk etmiş bir ödeme VAR MI bilinmiyor; aşağıdaki tutar yalnızca ön hesaptır)",
    actionRows === null && "İşlem geçmişiniz",
    modelFilesUnreadable &&
      "Model parça listesi (bu iş ÇOK PARÇALI olabilir; kaç parçadan oluştuğu bilinmediği için tek dosyalık indirme düğmeleri güvenlik gereği kapatıldı — liste okunana kadar baskıya başlamayın)",
    orderItemsUnreadable &&
      "Siparişin ürün kalemleri (bu siparişte aşağıda görünenden DAHA FAZLA ürün olabilir; eksik üretim riskine karşı baskı başlatma, baskıyı bitirme ve kalite kontrole gönderme adımları geçici olarak KAPATILDI)",
    productSpecUnreadable &&
      `Üretim künyesi — dosyalar, malzeme listesi ve adımlar (${specUnknownTitles.join(", ")}): bu kalemlerin künyesi BOŞ değil, BİLİNMİYOR; künye okunana kadar baskı başlatma, baskıyı bitirme ve kalite kontrole gönderme adımları KAPATILDI`,
  ].filter((x): x is string => typeof x === "string");

  const serialized = {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      customerName: order.customerName,
      phone: order.phone,
      figurineSize: order.figurineSize,
      material: order.material,
      finish: order.finish,
      style: order.style,
      modifiers: order.modifiers as string[] | null,
      // The technical spec the customer/admin agreed on (colour, base, engraving,
      // and — on manual orders — size/material/finish mirrored here so they can
      // be told apart from the columns' schema defaults).
      selectedOptions: order.selectedOptions ?? [],
      // Paid add-ons the customer bought. gift_wrap / extra_paint / rush_shipping
      // are physical work the workshop must actually do; they were charged for
      // and shown to nobody who could fulfil them.
      upsells: (order.upsells ?? []) as string[],
      // Product material for marketplace orders — the workshop was otherwise
      // guessing what an admin-owned store product is printed from.
      productMaterial: productRow?.material ?? null,
      // Customer-uploaded model facts (upload orders only).
      paidAt: order.paidAt?.toISOString() ?? null,
      // Promised lead time (product listing) so the workshop can see the deadline.
      leadTimeDays: refProducts.length
        ? Math.min(...refProducts.map((pr) => pr.leadTimeDays ?? 7))
        : productRow?.leadTimeDays ?? null,
      // A later admin upload makes a previously downloaded file stale.
      modelRevision: modelRevisionRows.length
        ? {
            current: modelRevisionRows[0].revision,
            total: modelRevisionRows.length,
            uploadedAt: order.modelUploadedAt?.toISOString() ?? null,
            // Yöneticinin sürüm notu ("neden yeniden yüklendi"). Kolon vardı,
            // üreticiye hiç gösterilmiyordu.
            note: modelRevisionRows[0].note,
          }
        : null,
      uploadedModel: uploadedModelRow
        ? {
            fileName: uploadedModelRow.fileName,
            sourceFormat: uploadedModelRow.sourceFormat,
            targetHeightMm: uploadedModelRow.targetHeightMm,
            material: uploadedModelRow.material,
            boundingBoxMm: uploadedModelRow.boundingBoxMm ?? null,
            minWallThicknessMm: uploadedModelRow.minWallThicknessMm ?? null,
            printRisk: (uploadedModelRow.printRisk ?? []) as string[],
            volumeMm3: uploadedModelRow.volumeMm3 ?? null,
            isVolume: uploadedModelRow.isVolume ?? null,
          }
        : null,
      status: order.status,
      // A refunded order keeps its sub-status ("printing" …); the page needs
      // the payment status to show the refund and switch off forward actions.
      paymentStatus: order.paymentStatus,
      manufacturerStatus: order.manufacturerStatus,
      needsPainting: order.needsPainting,
      // Atölye partisine ait sipariş: tek tek kargolanamaz (ship ucu 409
      // döner). Ekran bunu SÖYLEMELİ, yoksa üretici QC onayından sonra
      // kargolamayı dener ve neden reddedildiğini anlamaz.
      isWorkshop: order.workshopSessionId != null,
      painterStatus: order.painterStatus,
      // Manufacturer-level flag surfaced on the order so the client can offer
      // the in-house "paint + ship" path instead of a forced painter hand-off.
      paintsInHouse: manufacturer.paintsInHouse,
      qcRound: order.qcRound,
      quantity: order.quantity,
      productTitleSnapshot: order.productTitleSnapshot,
      // Earnings preview. The manufacturer has 24 hours to accept or decline
      // and could not see what the job pays — the contract now promises this.
      //
      // The base is derived from the ORDER's real state (`painterId`), not from
      // the manufacturer's `paintsInHouse` profile flag. Reading the flag meant
      // a "kendim boyarım" manufacturer who then handed the job to a painter
      // kept seeing the full amount here — the same painting share the painter
      // was being promised on their own panel. One shared derivation, so the
      // card can no longer drift from what actually accrues.
      grossKurus: earningBaseKurus,
      // The shop paints in house and the order has a painting kalem, so the
      // base above is production + painting. The card called it "Üretim payı"
      // regardless. Same derivation as the base (orderMoneySplit.paintsItself),
      // so the label cannot disagree with the amount.
      baseIncludesPainting:
        moneySplit.paintsItself && moneySplit.paintingBaseKurus > 0,
      // The rate frozen at accept, so the preview matches what will be paid.
      // Before accept the column is NULL — fall back to the live rate.
      commissionRateBps: rateBps,
      // computeEarning's split of that base — the same call accrueEarning
      // makes, so the preview cannot round differently from the real row.
      commissionKurus: expectedEarning.commissionKurus,
      netEarningKurus: expectedEarning.netKurus,
      accruedEarning: accrued
        ? {
            grossKurus: accrued.grossKurus,
            commissionKurus: accrued.commissionKurus,
            netKurus: accrued.netKurus,
            commissionRateBps: accrued.commissionRateBps,
            status: accrued.status,
            payoutStatus: accrued.payout?.status ?? null,
            paidAt: accrued.payout?.paidAt?.toISOString() ?? null,
          }
        : null,
      // Geri almanın kayıtlı sebebi (yukarıda okundu): kayıt yoksa null,
      // okunamadıysa undefined. Ekran cümleyi bu üçlü durumdan kurar.
      earningReversal,
      // True once the job is with a painter: the card must stop promising the
      // painting share and stop saying "accrues when you ship" (shipping such
      // an order is blocked by the ship gate's isNull(painterId)).
      handedToPainter: order.painterId != null,
      // Manual/WhatsApp orders carry no product row — their contents live here
      // as {name, priceKurus} line items. Without this the manufacturer has no
      // idea what was ordered.
      selectedAddons: order.selectedAddons ?? [],
      customerNote: order.customerNote,
      shippingAddress: order.shippingAddress as TurkishAddress | null,
      assignedToManufacturerAt:
        order.assignedToManufacturerAt?.toISOString() ?? null,
      manufacturerAcceptedAt:
        order.manufacturerAcceptedAt?.toISOString() ?? null,
      manufacturerPrintedAt:
        order.manufacturerPrintedAt?.toISOString() ?? null,
      trackingNumber: order.trackingNumber,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    },
    photos: [
      ...photoRows.map((p) => ({ id: p.id, originalUrl: p.originalUrl })),
      // Multi-angle fusion sets: only the primary photo becomes an order_photo,
      // so the other angles the customer uploaded never reached the workshop.
      // photoKeys[0] IS the primary — skip it to avoid a duplicate.
      ...(previewRow?.photoKeys ?? []).slice(1).map((k, i) => ({
        id: `ref-${i}`,
        originalUrl: getPublicUrl(k),
      })),
    ],
    qcPhotos: currentRoundPhotos,
    qcRejectReason,
    marketplaceProduct,
    productSpecs,
    approvedImageUrl: normalizeFileUrl(previewRow?.selectedStyledImageUrl ?? null),
    // The printable model comes from the ADMIN upload (orders.model_*) since the
    // auto-3D pipeline was removed; generationAttempts is the legacy fallback for
    // historical orders. Reading only the latter left every recent order with no
    // downloadable file at all.
    //
    // That fallback applies ONLY while the order has no model of its own. A
    // revision may now be STL-only or GLB-only, and `modelGlbUrl ?? attempt`
    // then handed the workshop the superseded generated mesh as the "current"
    // GLB (viewer + GLB indir), or the raw attempt STL as the print file.
    // KAPI KAPALI TARAFTA: parça listesi BİLİNMİYORKEN tek dosyalık indirme
    // sunulmaz. İstemci "STL indir"i yalnız `stlParts.length <= 1` iken gösterir
    // (client.tsx), yani liste okunamadığında düğme geri gelir ve 13 parçalık bir
    // işin TEK parçasını "modelin kendisi" diye verirdi. Şerit sebebini yazar;
    // liste okunur okunmaz düğmeler kendiliğinden geri gelir.
    glbUrl: modelFilesUnreadable
      ? null
      : normalizeFileUrl(currentModelUrl(order, "glb", latestGeneration)),
    stlUrl: modelFilesUnreadable
      ? null
      : normalizeFileUrl(currentModelUrl(order, "stl", latestGeneration)),
    objUrl: modelFilesUnreadable
      ? null
      : normalizeFileUrl(latestGeneration?.outputObjUrl ?? null),
    modelFiles: latestFiles.files.map((f) => ({
      id: f.id,
      name: f.fileName,
      kind: f.kind,
      sizeBytes: f.sizeBytes,
    })),
    modelFilesRevision: latestFiles.revision,
    // Üretim bağlamı BİLİNMİYOR: kalem listesi, ürün kaydı ya da üretim künyesi
    // okunamadı. İstemci ileri üretim adımlarını bu bayrakla kapatır (yukarıdaki
    // gerekçe); bilinmezlik "kalem yok" diye gösterilmez.
    productionGateClosed,
    // Onay kapısı: duyurulan sürüm onaylanandan yeniyse ileri adımlar kapalı.
    modelAck: {
      announcedRevision: modelAck.announcedRevision,
      acknowledgedRevision: modelAck.acknowledgedRevision,
      acknowledgedAt: modelAck.acknowledgedAt,
      pending: modelAck.pending,
      // Günlük OKUNAMADI bayrağı: readPartnerModelAck arızada TEMKİNLE
      // pending:true + announcedRevision:null döner. Bayrak burada düşürülünce
      // ekran o temkini bir KARAR sanıp "Yeni model sürümü yüklendi (vnull)"
      // diyordu — olmamış bir olay — ve onay düğmesi null sürümü gönderip
      // "Geçersiz sürüm numarası." alıyordu. Kapı iki dalda da kapalı; ayrışan
      // yalnız partnere anlatılan hikâye.
      readFailed: modelAck.readFailed,
    },
    // Günlük okunamadıysa kart BOŞ kalır; sebebi yukarıdaki modelAck.readFailed
    // uyarısı söyler. Sayfanın tamamını düşürmek yerine tek kartı düşürmek,
    // partnerin o uyarıyı okuyabilmesinin ön şartı.
    actions: (actionRows ?? []).map((a) => ({
      id: a.id,
      action: a.action,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      <CoreReadNotice areas={unreadableAreas} />
      <ManufacturerOrderDetailClient data={serialized} locale={locale} />
    </div>
  );
}
