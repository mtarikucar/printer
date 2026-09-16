/**
 * Model yükleme politikası: "bu siparişe şimdi yeni bir model yüklenebilir mi,
 * yüklenirse NE OLUR" sorusunun TEK cevabı.
 *
 * Neden ayrı modül: yükleme route'u ile admin ekranı bu soruyu ayrı ayrı
 * cevaplıyordu. Route dört duruma izin veriyordu (`awaiting_model`, `approved`,
 * `review`, `paid`), ekran da kendi listesini tutuyordu; ikisi ayrıştığında
 * admin düğmeyi görüyor, sunucu "Sipariş model beklemiyor." diyordu. Sahibin
 * kararı (late-model-upload) listeyi kaldırdı: model HER aşamada yüklenebilir,
 * yalnız reddedilmiş ve iade edilmiş siparişte yüklenemez. Bunun bedeli, her
 * aşamanın FARKLI yan etkisi olmasıdır — o eşleme de burada durur.
 *
 * SAF MODÜL: `@/lib/db` import etmez, `server-only` YOKTUR. İstemci bileşeni
 * (uyarı metni + onay adımı), API rotası (kapı + yan etkiler) ve worker aynı
 * kuralı okur. "server-only" eklenirse BullMQ worker'ı crash-loop'a girer
 * (2026-06-13'te yaşandı).
 */
import { isRefunded } from "./order-status-policy";

/**
 * Yeni bir modelin siparişi hangi noktada yakaladığı. Sıra ÖNEMLİDİR: aşağıdaki
 * `modelUploadStage` bu sırayla eler, çünkü bir sipariş aynı anda birden çok
 * tanıma uyabilir (ör. `status='painting'` + `manufacturerStatus='qc_approved'`:
 * üretici işini bitirmiştir, parça boyacıdadır — aşama `painting`'dir).
 */
export type ModelUploadStage =
  | "before_production"
  | "printing"
  | "printed_or_qc"
  | "painting"
  | "awaiting_customer_approval"
  | "shipped_or_delivered"
  | "blocked";

/** Politikanın okuduğu sipariş alanları — tamamı ham kolon değeri. */
export interface ModelUploadOrderShape {
  status: string;
  manufacturerStatus: string | null;
  painterStatus: string | null;
  paymentStatus: string | null;
}

/**
 * Üreticinin baskıyı BİTİRDİĞİ, yani yeni modelin QC'yi sıfırlaması gereken
 * üretici durumları. `printed` ve sonrası: elde ESKİ modelin baskısı vardır ve
 * o baskı QC'den geçerse kargoya çıkar.
 *
 * `shipped` bilerek DIŞARIDA: paket yola çıkmıştır, üretimde geri alınacak bir
 * şey kalmamıştır (bkz. `shipped_or_delivered`).
 */
export const QC_RESET_MANUFACTURER_STATUSES: readonly string[] = [
  "printed",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
];

/**
 * Parçanın fiziksel olarak BOYACIDA olduğu boyacı durumları. `assigned` da
 * dahildir: üretici parçayı kargoya vermiş olabilir, admin'in bunu bilerek
 * yapması gerekir.
 */
const PAINTER_HOLDS_PIECE: readonly string[] = [
  "assigned",
  "accepted",
  "painting",
  "painted",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
];

/**
 * Üreticinin baskıya BAŞLADIĞI ama henüz bitirmediği durumlar. `status` da
 * okunur: üreticisi olmayan, admin'in kendi bastığı sipariş yalnız
 * `orders.status='printing'` taşır (start-printing rotası).
 */
function isPrinting(o: ModelUploadOrderShape): boolean {
  return o.manufacturerStatus === "printing" || o.status === "printing";
}

/**
 * Yeni model bu siparişi hangi aşamada yakalıyor?
 *
 * Eleme sırası fiziksel gerçeği izler: önce "artık geri alınacak bir şey yok"
 * (kargo), sonra "parça kimin elinde" (boyacı → üretici), en sonda "henüz
 * üretim başlamadı".
 */
export function modelUploadStage(o: ModelUploadOrderShape): ModelUploadStage {
  if (!modelUploadAllowed(o)) return "blocked";

  // Kargoya verilmiş: üretimde değiştirilecek bir şey yok, kayıt amaçlı yükleme.
  if (
    o.status === "shipped" ||
    o.status === "delivered" ||
    o.manufacturerStatus === "shipped" ||
    o.painterStatus === "shipped"
  ) {
    return "shipped_or_delivered";
  }

  // Parça boyacıda: üreticinin QC'si zaten geçmiştir, yeniden baskı AYRI ve
  // bilinçli bir karardır (late-model-upload). Burada yalnız haber verilir.
  if (o.status === "painting" || PAINTER_HOLDS_PIECE.includes(o.painterStatus ?? "")) {
    return "painting";
  }

  // Baskı bitti / QC turunda: eski modelin baskısı elde, QC sıfırlanmalı.
  if (QC_RESET_MANUFACTURER_STATUSES.includes(o.manufacturerStatus ?? "")) {
    return "printed_or_qc";
  }

  if (isPrinting(o)) return "printing";

  if (o.status === "awaiting_customer_approval") return "awaiting_customer_approval";

  return "before_production";
}

/**
 * Model yüklenebilir mi? YALNIZ iki durumda hayır:
 *   - sipariş reddedilmiş (`rejected`): kapanmış bir işe dosya eklenmez,
 *   - sipariş iade edilmiş (refund-end-state): yükleme ileri bir işlemdir,
 *     siparişi `approved` + atanabilir hâle getirir ve yeni bir hakediş doğurur.
 *
 * Geri kalan HER durumda yüklenebilir — yan etkileri `modelUploadSideEffects`
 * söyler.
 */
export function modelUploadAllowed(o: ModelUploadOrderShape): boolean {
  if (isRefunded(o)) return false;
  return o.status !== "rejected";
}

/** Bir aşamada yüklemenin doğurduğu yan etkiler. */
export interface ModelUploadSideEffects {
  /** QC sıfırlanır: tur artar, bekleyen QC fotoğrafları reddedilir, üretici `printing`'e döner. */
  resetsQc: boolean;
  /** Üreticinin yeni modeli GÖRDÜĞÜNÜ onaylaması gerekir. */
  needsManufacturerAck: boolean;
  /** Atanmış boyacıya haber verilir. */
  notifiesPainter: boolean;
  /** Müşteriye yeni bir onay turu açılır. */
  newApprovalRound: boolean;
  /** Üretim etkilenmez; yükleme yalnız kayda geçer. */
  recordOnly: boolean;
  /** Admin gerekçe yazmadan yükleyemez. */
  requiresNote: boolean;
  /** Admin'e gösterilecek uyarı (Türkçe). */
  warningTr: string;
}

const SIDE_EFFECTS: Record<ModelUploadStage, ModelUploadSideEffects> = {
  before_production: {
    resetsQc: false,
    needsManufacturerAck: false,
    notifiesPainter: false,
    newApprovalRound: false,
    recordOnly: false,
    requiresNote: false,
    warningTr:
      "Üretim henüz başlamadı. Yeni sürüm doğrudan geçerli model olur; atanmışsa üreticiye bildirilir.",
  },
  printing: {
    resetsQc: false,
    // Üretici ŞU AN eski modeli basıyor. Pasif bir uyarı yetmez: yeni modeli
    // gördüğünü onaylaması gerekir, yoksa eski baskı sürer.
    needsManufacturerAck: true,
    notifiesPainter: false,
    newApprovalRound: false,
    recordOnly: false,
    requiresNote: true,
    warningTr:
      "Üretici şu anda ESKİ modeli basıyor. Yeni sürüm bildirilir ve üreticinin gördüğünü onaylaması istenir; devam eden baskının maliyeti elle çözülür.",
  },
  printed_or_qc: {
    resetsQc: true,
    needsManufacturerAck: true,
    notifiesPainter: false,
    newApprovalRound: false,
    recordOnly: false,
    requiresNote: true,
    warningTr:
      "Elde ESKİ modelin baskısı var. QC otomatik sıfırlanır: tur artar, bekleyen QC fotoğrafları reddedilir, üretici baskı aşamasına döner ve yeni sürüm QC'den geçmeden kargolayamaz. Yeniden baskının bedeli şimdilik elle çözülür.",
  },
  painting: {
    resetsQc: false,
    needsManufacturerAck: false,
    notifiesPainter: true,
    newApprovalRound: false,
    recordOnly: false,
    requiresNote: true,
    warningTr:
      "Parça boyacıda ve ESKİ modelden basıldı. Boyacı ile üreticiye bildirilir; yeniden baskı ya da boyacı değişikliği AYRI ve bilinçli bir karardır. Bedeli şimdilik elle çözülür.",
  },
  awaiting_customer_approval: {
    resetsQc: false,
    needsManufacturerAck: false,
    notifiesPainter: false,
    newApprovalRound: true,
    recordOnly: false,
    requiresNote: false,
    warningTr:
      "Müşteri onay bekliyor. Yeni sürüm için YENİ bir onay turu açılır; müşteri eski modeli onaylamış sayılmaz.",
  },
  shipped_or_delivered: {
    resetsQc: false,
    needsManufacturerAck: false,
    notifiesPainter: false,
    newApprovalRound: false,
    recordOnly: true,
    requiresNote: true,
    warningTr:
      "Sipariş kargoya verildi. Üretim etkilenmez; yükleme yalnız kayda geçer. Dijital dosya satın alan müşteri yeni sürümü indirebilir.",
  },
  blocked: {
    resetsQc: false,
    needsManufacturerAck: false,
    notifiesPainter: false,
    newApprovalRound: false,
    recordOnly: false,
    requiresNote: false,
    warningTr: "Bu siparişe model yüklenemez (reddedilmiş ya da iade edilmiş).",
  },
};

/**
 * Aşamanın yan etkileri. Kopya DÖNER: çağıran tablonun kendisini değiştirip
 * sonraki çağıranların politikasını bozamasın.
 */
export function modelUploadSideEffects(stage: ModelUploadStage): ModelUploadSideEffects {
  return { ...SIDE_EFFECTS[stage] };
}

/**
 * Yükleme için gerekçe şart mı?
 *
 * Kural: üretici `accepted`'ın ÖTESİNE geçtiyse şart. O noktadan sonra yeni bir
 * model birinin elindeki fiziksel işi geçersiz kılar; "neden" sorusunun cevabı
 * denetim kaydında durmalıdır. `accepted`'ın kendisi dahil değildir: üretici işi
 * kabul etmiştir ama henüz hiçbir şey basmamıştır.
 */
export function modelUploadRequiresNote(o: ModelUploadOrderShape): boolean {
  return modelUploadSideEffects(modelUploadStage(o)).requiresNote;
}

/**
 * Yeni sürüm sonrası siparişin GÖRÜNEN model kaynağı.
 *
 * `orders.model_source` yalnız "hangi el üretti" bilgisi değildir: müşteri onay
 * KAPISINI da o taşır (`requiresCustomerModelApproval` yalnız `meshy_auto`
 * siparişlerde onay ister). Admin, otomatik üretilmiş bir modeli düzeltmek için
 * dosya yüklediğinde kaynak `admin_upload`'a dönseydi o kapı SESSİZCE düşerdi —
 * mesafeli sözleşmenin üretim şartı ve cayma hakkı istisnası o onaya dayanıyor.
 * Bu yüzden `meshy_auto` YAPIŞKANDIR. Sürümü gerçekte kimin yüklediği
 * kaybolmaz: `order_model_revisions.uploaded_by_email` + notu ve `admin_actions`
 * satırı onu tutar.
 */
export function nextModelSource(
  existing: string | null,
  incoming: "meshy_auto" | "admin_upload"
): string {
  if (existing === "meshy_auto" && incoming === "admin_upload") return "meshy_auto";
  return incoming;
}

/* ─── QC turu: BASILAN SÜRÜMÜN KANITI ─────────────────────────────────────
 *
 * TEK CÜMLE: DAMGASIZ BİR FOTOĞRAF, GÜNCEL SÜRÜMÜN BASILDIĞININ KANITI
 * DEĞİLDİR.
 *
 * `qc_photos.model_revision` (migration 0055) fotoğrafın çekildiği baskının
 * sürümüdür. Yeni bir sürüm QC'yi sıfırlar ve üreticiyi `printing`e döndürür,
 * ama üretici yeni turda da ESKİ baskının fotoğraflarını yükleyebilir; damga
 * bu ikisini ayırt eder.
 *
 * KURAL NEDEN FAIL-CLOSED: damgasızlık eskiden "eski değil" sayılıyordu. O
 * hoşgörü, kanıtın YOKLUĞUNU kanıt yerine koyuyordu ve kapıyı SİLİNEBİLİR
 * yapıyordu: damgaları düşüren bir geri alma (0055'in down'ı kolonu düşürür)
 * bütün turları "damgasız" hâle getirip bayat bir baskının kilidini açıyordu —
 * yani migration'ı geri almak bir güvenlik kapısını kaldırıyordu. Artık
 * damgasızlık "bilinmiyor" demektir ve bilinmeyen tur kendiliğinden geçmez.
 *
 * HOŞGÖRÜ NEREDE KALDI: damgasızlık ancak ortada ESKİ bir baskı OLAMAYACAĞI
 * hâllerde geçer — siparişin hiç sürüm kaydı yoksa (elle açılan iş) ya da tek
 * sürümü varsa (v1). Bu, geçmiş siparişlerin topluca kilitlenmesi korkusunun
 * gerçek cevabıdır: 0055 öncesi satırların hepsi tek sürümlü siparişlerdedir,
 * çünkü ikinci sürüm ancak 0055 ile gelen akışta yüklenir. Birden çok sürümü
 * OLAN siparişte damgasızlık gerçek bir belirsizliktir ve admin'in bilerek
 * (gerekçeyle, denetim kaydına geçerek) onaylaması gerekir.
 *
 * SIKILAŞTIRMA TEK YÖNLÜDÜR: bu kural, eski kuralın geçirdiği hiçbir turu
 * geçirmemeye başlamaz — yalnız geçirdiklerinin bir kısmını gerekçeye bağlar.
 * (scripts/test-qc-photo-revision.ts bunu matris üzerinde pinler.)
 */

/** Turun neden KANITLANAMADIĞI. */
export type QcRoundProofFailure =
  /** En az bir fotoğraf, güncel sürümden ESKİ bir baskıyı gösteriyor. */
  | "stale"
  /** Damgasız fotoğraf var ve siparişin birden çok sürümü var: hangi baskı olduğu bilinmiyor. */
  | "unstamped"
  /** Turda hiç fotoğraf yok: onaylanacak bir kanıt yok. */
  | "no_photos"
  /** Siparişin güncel sürümü OKUNAMADI: kıyaslanacak sayı yok. */
  | "revision_unreadable";

export interface QcRoundProof {
  /** Tur, GÜNCEL sürümün baskısını gösterdiğini KANITLIYOR mu? */
  proven: boolean;
  failure: QcRoundProofFailure | null;
  /** Turun EN ESKİ damgası (uyarıda gösterilir; sorunu doğuran odur). */
  oldestStampedRevision: number | null;
  unstampedCount: number;
  photoCount: number;
}

export interface QcRoundProofInput {
  photos: { modelRevision: number | null }[];
  /** Siparişin güncel model sürümü; sürüm kaydı yoksa null. */
  currentRevision: number | null;
  /**
   * Güncel sürüm OKUNAMADI (sorgu patladı). `currentRevision: null` ile aynı
   * şey DEĞİLDİR: null "sürüm yok" demektir, bu ise "bilmiyoruz" demektir ve
   * bilmeden onay verilmez.
   */
  revisionReadFailed?: boolean;
}

/**
 * Turun kanıt durumu. Tek yerde hesaplanır: admin ekranı (kapı), admin rotası
 * (ret + gerekçe) ve testler aynı cevabı okur.
 */
export function qcRoundPrintProof(input: QcRoundProofInput): QcRoundProof {
  const photos = input.photos;
  const unstampedCount = photos.filter((p) => p.modelRevision == null).length;
  const oldestStampedRevision = photos.reduce<number | null>(
    (lowest, p) =>
      p.modelRevision != null && (lowest == null || p.modelRevision < lowest)
        ? p.modelRevision
        : lowest,
    null
  );
  const base = {
    oldestStampedRevision,
    unstampedCount,
    photoCount: photos.length,
  };

  if (input.revisionReadFailed) {
    return { proven: false, failure: "revision_unreadable", ...base };
  }
  if (photos.length === 0) {
    // Sözleşme her tur için en az 4 fotoğraf ister (submit-qc kapısı), yani bu
    // hâl normal akışta doğmaz; doğduysa ortada onaylanacak kanıt yoktur.
    return { proven: false, failure: "no_photos", ...base };
  }

  const current = input.currentRevision;
  // Sürüm kaydı olmayan sipariş (elle açılan iş): ESKİ bir sürüm YOKTUR, yani
  // ortada kanıtlanacak bir ayrım da yoktur.
  if (current == null) return { proven: true, failure: null, ...base };

  // Damgalı-eski satır, kanıtın KENDİSİdir: damgasızlıktan önce gelir.
  if (oldestStampedRevision != null && oldestStampedRevision < current) {
    return { proven: false, failure: "stale", ...base };
  }
  // Damgasızlık ancak daha eski bir sürüm OLAMAZKEN (v1) geçer.
  if (unstampedCount > 0 && current > 1) {
    return { proven: false, failure: "unstamped", ...base };
  }
  return { proven: true, failure: null, ...base };
}

/**
 * QC turu GERÇEKTEN basılan sürümü mü gösteriyor? (kapının boole yüzü)
 *
 * `qcRoundPrintProof(...).proven` ile AYNI cevaptır — admin ekranı bunu, admin
 * rotası ikisini birden okur; ayrışmaları imkânsızdır çünkü tek hesap vardır.
 */
export function qcPhotosMatchCurrentRevision(
  photos: { modelRevision: number | null }[],
  currentRevision: number | null
): boolean {
  return qcRoundPrintProof({ photos, currentRevision }).proven;
}

/** Denetim kaydında istisnanın HANGİ hâl için verildiğini adlandıran etiket. */
export const QC_PROOF_FAILURE_LABEL_TR: Record<QcRoundProofFailure, string> = {
  stale: "ESKİ SÜRÜM ONAYI",
  unstamped: "DAMGASIZ TUR ONAYI",
  no_photos: "FOTOĞRAFSIZ TUR ONAYI",
  revision_unreadable: "SÜRÜMÜ OKUNAMAYAN TUR ONAYI",
};

/**
 * Kanıtlanamayan turun admin'e dönen cümlesi.
 *
 * `stale` hâli burada YOKTUR: onun cümlesi partner-model-ack.ts'te
 * (`staleQcRevisionErrorTr`) ve oradan okunur — bu modül onu import edemez
 * (partner-model-ack zaten bunu import ediyor; ters yön döngü olurdu).
 *
 * Cümleler VERİNİN SÖYLEDİĞİNDEN fazlasını iddia etmez: damgasız tur için
 * "eski baskı" denmez, "hangi sürüm olduğu bilinmiyor" denir.
 */
export function qcRoundProofErrorTr(proof: QcRoundProof, currentRevision: number | null): string {
  const current = currentRevision != null ? `v${currentRevision}` : "güncel sürüm";
  switch (proof.failure) {
    case "unstamped":
      return (
        `Bu turdaki ${proof.unstampedCount} fotoğraf sürüm damgası taşımıyor; siparişin güncel ` +
        `modeli ${current} ve daha eski sürümleri de var. Damgasız fotoğraf, GÜNCEL sürümün ` +
        "basıldığının kanıtı değildir: hangi baskı olduğu doğrulanamadan bu tur onaylanamaz. " +
        "Üreticiden güncel sürümün fotoğraflarını isteyin; yine de onaylayacaksanız gerekçe " +
        "yazarak bilinçli onayı kullanın."
      );
    case "no_photos":
      return (
        "Bu turda hiç QC fotoğrafı yok; onaylanacak bir kanıt bulunmuyor. Üreticiden bu turun " +
        "fotoğraflarını isteyin; yine de onaylayacaksanız gerekçe yazarak bilinçli onayı kullanın."
      );
    case "revision_unreadable":
      return (
        "Siparişin güncel model sürümü şu anda okunamadı (geçici sistem arızası). Hangi sürümün " +
        "basıldığı doğrulanamadığı için tur onaylanmadı; hiçbir şey değişmedi. Birkaç dakika " +
        "sonra tekrar deneyin; acilse gerekçe yazarak bilinçli onayı kullanın."
      );
    default:
      // "stale" ve "kanıtlandı" hâlleri buraya düşmez; düşerse genel cümle.
      return (
        `Bu turun GÜNCEL sürümün (${current}) baskısını gösterdiği doğrulanamadı; tur ` +
        "onaylanmadı."
      );
  }
}
