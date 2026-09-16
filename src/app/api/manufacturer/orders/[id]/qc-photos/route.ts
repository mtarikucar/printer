import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { db } from "@/lib/db";
import { orders, manufacturers, qcPhotos } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { saveFile, deleteFile, getPublicUrl } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import {
  canUploadQcPhotos,
  qcPhotosWouldExceed,
  type ManufacturerOrderStatus,
} from "@/lib/services/qc";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { currentOrderModelRevision } from "@/lib/services/order-model-revision";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * SÜRÜM DAMGASI KOŞULSUZ YAZILIR — DAĞITIM SIRASI ÖN KOŞULDUR.
 *
 * Burada bir zamanlar "0055 uygulanmamış veritabanı" için damgasız yazıma
 * düşen bir yedek yol vardı. O yol ÇALIŞAMIYORDU: Drizzle INSERT cümlesine
 * şemadaki HER kolonu adıyla yazar, yani damgasız sanılan `values(base)` bile
 * `model_revision` kolonunu adlandırıyordu. Kolon yoksa yedek yol da aynı
 * 42703 hatasını alırdı — üstelik kendi try/catch'inin dışında, yani üreticiye
 * 500 olarak. Ölü bir yedek yolu taşımak, olmayan bir güvenceyi vaat ediyordu.
 *
 * Dağıtım sırası bunu zaten imkânsız kılar: deploy.sh app ve worker'ı yeniden
 * başlatmadan ÖNCE `migrate` servisini koşturur (deploy.sh 4. adım → 5. adım),
 * yani çalışan her sürüm kendi migration'larını görmüş olur. Bu rotanın ÖN
 * KOŞULU iki DDL parçasıdır: `order_model_revisions` tablosu (0053, okuma) ve
 * `qc_photos.model_revision` kolonu (0055, yazma). İkisi uygulanmadan bu uç
 * çalıştırılmamalıdır.
 *
 * Şema eksikse GÜRÜLTÜLÜ başarısızlık doğru davranıştır: damgasız satır
 * `qcPhotosMatchCurrentRevision` için "eski değil" sayılır, yani sessiz düşüş
 * eski modelin baskısını QC'den geçirirdi — bu fazın en sert kuralının
 * (eski modelin baskısı ne QC'den geçer ne kargoya çıkar) tam tersi.
 */

/**
 * Sürüm okunamadığında üreticiye dönen cümle.
 *
 * Boş gövdeli bir 500, panelde "İşlem tamamlanamadı (HTTP 500)" olarak
 * görünüyordu: üretici ne olduğunu ve ne yapacağını bilmiyordu. Durum
 * gerçekte geçici bir okuma arızasıdır ve fotoğraf YAZILMAMIŞTIR.
 */
const MODEL_REVISION_UNAVAILABLE_ERROR =
  "Siparişin model sürümü şu anda okunamadı (geçici sistem arızası). Fotoğraf yüklenmedi; lütfen birkaç dakika sonra tekrar deneyin.";

/**
 * Turun fotoğraf SAYISI okunamadığında üreticiye dönen cümle.
 *
 * Kardeş sürüm okuması (yukarıda) aynı arızada adıyla 503 verirken bu sayım
 * korumasızdı: ekran yükleyiciyi bu arızada da sunduğu için üretici baytları
 * gönderiyor, rota sayımda fırlıyor ve panele sebebi olmayan genel bir 500
 * düşüyordu. Ekranın sunduğu kontrolün, arızada da CEVAP veren bir ucu olmalı.
 */
const QC_PHOTO_COUNT_UNAVAILABLE_ERROR =
  "Bu turda kaç QC fotoğrafı olduğu şu anda okunamadı (geçici sistem arızası). Tur başına 6 fotoğraf sınırı bilinmeyen bir sayıya uygulanamayacağı için yükleme yapılmadı. Daha önce yüklediğiniz fotoğraflar SİLİNMEDİ; birkaç dakika sonra tekrar deneyin.";

// Active-manufacturer gate, mirrors finish-printing/ship route.ts.
async function requireActiveManufacturer() {
  const session = await getManufacturerSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return {
      error: NextResponse.json({ error: "Your account is not active" }, { status: 403 }),
    };
  }
  return { session };
}

// POST: upload one or more finished-product (QC) photos for the current round.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireActiveManufacturer();
    if ("error" in auth) return auth.error;
    const { session } = auth;
    const { id } = await params;

    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
      columns: { id: true, manufacturerStatus: true, qcRound: true, paymentStatus: true },
    });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    // QC photos are the step before submit-qc; a refunded order has no QC left
    // to do. Deleting a pending photo (DELETE below) stays allowed.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    if (!canUploadQcPhotos((order.manufacturerStatus ?? "") as ManufacturerOrderStatus)) {
      return NextResponse.json(
        { error: "Bu durumda QC fotoğrafı yüklenemez" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    let files = formData.getAll("files").filter((f): f is File => f instanceof File);
    const single = formData.get("file");
    if (files.length === 0 && single instanceof File) files = [single];
    if (files.length === 0) {
      return NextResponse.json({ error: "Dosya seçilmedi" }, { status: 400 });
    }

    // TUR BAŞINA SAYIM: 6 fotoğraflık kapının tek girdisi. KORUMALI, çünkü bu
    // okuma kapının ÖNÜNDE duruyor ve ekran aynı arızada yükleyiciyi sunmaya
    // devam ediyor: korumasız hâlinde üretici dosyaları gönderdikten SONRA rota
    // burada fırlıyor ve genel zarf 500'ü dönüyordu — sebebi olmayan bir hata.
    // Kapı KAPALI kalır (fail closed): bilinmeyen bir sayıya 6 sınırı
    // uygulanamaz, yani bu dal asla fazladan fotoğraf yazılmasına izin vermez.
    let existing: number;
    try {
      const [existingRow] = await db
        .select({ value: count() })
        .from(qcPhotos)
        .where(and(eq(qcPhotos.orderId, id), eq(qcPhotos.round, order.qcRound)));
      existing = Number(existingRow?.value ?? 0);
    } catch (e) {
      console.error("qc-photos: tur başına QC fotoğraf sayısı okunamadı", e);
      return NextResponse.json(
        { error: QC_PHOTO_COUNT_UNAVAILABLE_ERROR, code: "qc_photo_count_unavailable" },
        { status: 503 }
      );
    }
    if (qcPhotosWouldExceed(existing, files.length)) {
      return NextResponse.json(
        { error: "Çok fazla fotoğraf (tur başına en fazla 6)" },
        { status: 400 }
      );
    }

    // Fotoğrafın HANGİ model sürümünün baskısını gösterdiği (migration 0055).
    //
    // Tur numarası bu soruyu cevaplamıyordu: yeni bir sürüm QC'yi sıfırlar (tur
    // artar, üretici baskıya döner) ama fotoğraflar aynı turda eskisinden
    // kalabilir; damgasız satırlar "eski değil" sayıldığı için onay tarafı
    // farkı göremezdi ve eski modelin baskısı QC'den geçip kargoya çıkabilirdi.
    // Damga yüklemenin YAPILDIĞI andaki geçerli sürümdür — 0055'in backfill'i de
    // geçmiş satırları tam olarak böyle doldurdu, yani eski ve yeni satırlar aynı
    // anlamı taşır. Turun tamamı tek damga alsın diye döngüden ÖNCE okunur.
    // NULL yalnız GERÇEK bir cevaptır: siparişin hiç model sürümü yoksa (elle
    // açılan sipariş) damga boş kalır ve o satır "eski" sayılmaz. Okuma hatası
    // NULL'a çevrilmez — çevrilseydi arıza, sessizce damgasız satıra dönüşürdü.
    let modelRevision: number | null;
    try {
      modelRevision = await currentOrderModelRevision(id);
    } catch (e) {
      // Fail-closed KALIR (damgasız satır yazılmaz) ama sebep söylenir: yukarıdaki
      // notun gerekçesi "sessizce damgasız yazma" değil, GÜRÜLTÜLÜ başarısızlıktı.
      console.error("qc-photos: model sürümü okunamadı", e);
      return NextResponse.json(
        { error: MODEL_REVISION_UNAVAILABLE_ERROR, code: "model_revision_unavailable" },
        { status: 503 }
      );
    }

    const created: { id: string; url: string }[] = [];
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: "Dosya çok büyük (en fazla 10 MB)" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const detected = validateImageMagicBytes(buffer);
      if (!detected || !["image/jpeg", "image/png"].includes(detected)) {
        return NextResponse.json({ error: "Geçersiz görsel biçimi; yalnızca JPEG veya PNG yükleyin" }, { status: 400 });
      }
      const isPng = detected === "image/png";
      const ext = isPng ? "png" : "jpg";

      // Re-encode through sharp to strip EXIF/GPS metadata (sharp drops metadata
      // by default) and produce a thumbnail. If sharp can't process the image we
      // REJECT it rather than persisting the raw upload — a raw write would keep
      // EXIF/GPS metadata and could store a magic-byte-valid polyglot that is
      // later served (potential stored-XSS / data leak via the file endpoint).
      let mainBuffer: Buffer;
      let thumbBuffer: Buffer;
      try {
        const oriented = sharp(buffer).rotate();
        mainBuffer = await (isPng
          ? oriented.png()
          : oriented.jpeg({ quality: 90 })
        ).toBuffer();
        thumbBuffer = await sharp(buffer)
          .rotate()
          .resize(400, 400, { fit: "inside" })
          .jpeg({ quality: 80 })
          .toBuffer();
      } catch {
        return NextResponse.json(
          { error: "Görsel işlenemedi; lütfen geçerli bir JPEG/PNG yükleyin." },
          { status: 400 }
        );
      }

      // ÖNCE iki görüntü de bellekte üretilir, SONRA diske yazılır.
      //
      // Küçük görsel işleme bloğunun içinde yazılıyordu; ASIL görselin yazımı
      // patladığında (disk dolu, izin hatası) küçük görsel diskte sahipsiz
      // kalıyordu: hiçbir satır onu göstermez, hiçbir temizlik ona bakmaz
      // (önizleme temizliği yalnız previews'a bakar) ve her yeniden deneme bir çöp
      // dosya daha bırakırdı. Artık iki dosya tek bir temizlikle birlikte yaşar.
      const thumbnailKey = await saveFile(thumbBuffer, "qc-photos", `${nanoid()}.jpg`);
      let storageKey: string;
      try {
        storageKey = await saveFile(mainBuffer, "qc-photos", `${nanoid()}.${ext}`);
      } catch (e) {
        await deleteFile(thumbnailKey).catch(() => {});
        throw e;
      }

      // Dosyalar diske YAZILDI ama satır açılamazsa ikisi de ortada kalırdı:
      // hiçbir kayıt onları göstermez, hiçbir temizlik onlara bakmaz (önizleme
      // temizliği yalnız previews'a bakar) ve her yeniden deneme yeni bir çift
      // bırakırdı. Hata yukarı çıkmadan önce kendi çöpümüzü toplarız.
      const discardSavedFiles = async () => {
        await deleteFile(storageKey).catch(() => {});
        await deleteFile(thumbnailKey).catch(() => {});
      };

      let row: { id: string; storageKey: string } | undefined;
      try {
        [row] = await db
          .insert(qcPhotos)
          .values({
            orderId: id,
            manufacturerId: session.manufacturerId,
            round: order.qcRound,
            modelRevision,
            storageKey,
            thumbnailKey,
          })
          .returning({ id: qcPhotos.id, storageKey: qcPhotos.storageKey });
      } catch (e) {
        await discardSavedFiles();
        throw e;
      }
      if (!row) {
        await discardSavedFiles();
        throw new Error("qc-photos: INSERT satır döndürmedi");
      }
      created.push({ id: row.id, url: getPublicUrl(row.storageKey) });
    }

    return NextResponse.json({ photos: created });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/manufacturer/orders/[id]/qc-photos", PARTNER_ACTION_FAILED_ERROR);
  }
}

// DELETE ?photoId=… : remove a not-yet-reviewed photo before submission.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireActiveManufacturer();
    if ("error" in auth) return auth.error;
    const { session } = auth;
    const { id } = await params;

    const photoId = new URL(request.url).searchParams.get("photoId");
    if (!photoId) {
      return NextResponse.json({ error: "photoId gerekli" }, { status: 400 });
    }

    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
      columns: { manufacturerStatus: true },
    });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    if (!canUploadQcPhotos((order.manufacturerStatus ?? "") as ManufacturerOrderStatus)) {
      return NextResponse.json(
        { error: "Bu durumda QC fotoğrafları değiştirilemez" },
        { status: 400 }
      );
    }

    const photo = await db.query.qcPhotos.findFirst({
      where: and(
        eq(qcPhotos.id, photoId),
        eq(qcPhotos.orderId, id),
        eq(qcPhotos.manufacturerId, session.manufacturerId),
        eq(qcPhotos.reviewStatus, "pending")
      ),
    });
    if (!photo) return NextResponse.json({ error: "Fotoğraf bulunamadı" }, { status: 404 });

    await db.delete(qcPhotos).where(eq(qcPhotos.id, photoId));
    await deleteFile(photo.storageKey).catch(() => {});
    if (photo.thumbnailKey) await deleteFile(photo.thumbnailKey).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/manufacturer/orders/[id]/qc-photos", PARTNER_ACTION_FAILED_ERROR);
  }
}
