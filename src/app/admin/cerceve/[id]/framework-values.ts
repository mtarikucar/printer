/**
 * ÇERÇEVE EKRANININ SAF KATMANI: ekrandaki metin ↔ telden giden sayı.
 *
 * Neden ekranın içinde değil ayrı bir modülde (emsal:
 * `src/app/admin/teklifler/[id]/price-values.ts`): burası admin'in yazdığı
 * ADEDİN ilk durağı ve buradaki bir hata sunucuda YAKALANAMAZ — "1o" gibi bir
 * yazım hatası `NaN`a, `NaN` da `JSON.stringify` içinde `null`a düşer ve
 * `null` bir adet alanında "bu parçayı partiye hiç koyma" demektir. Yani bir
 * harf hatası, planlanmış bir adedi sessizce düşürürdü. Kural burada duruyor ki
 * bir düğüm testi onu koşabilsin (`"use client"` bir bileşen import edilemez).
 *
 * ─── EKRANDA PARA ARİTMETİĞİ YOKTUR ────────────────────────────────────────
 *
 * Bu dosyada da, `client.tsx` dosyalarında da tutar ÇARPILMAZ, BÖLÜNMEZ,
 * ORANLANMAZ. Parti tutarı önizlemesi sunucudan gelir
 * (`POST /api/admin/frameworks/[id]/batches` + `dryRun: true`) ve
 * `committed_total_kurus` ile `Σ batch.amountKurus` AYRI alanlardır — biri
 * ötekinin yerine yazılmaz.
 *
 * Buradaki tek aritmetik ADET ORANIDIR (yığın çubuğun genişlikleri): birim
 * sayısı paraya dönüşmez ve bir çubuğun yüzdesi bir tutar değildir.
 *
 * SAF MODÜL: React yok, DB yok, `node:` import'u yok.
 */
import type {
  FrameworkBatchStatus,
  FrameworkProgress,
  FrameworkStatus,
} from "@/lib/config/quote-framework";

/** Anlaşma durumunun Türkçe hâli — `Record` tiplidir, yenisi DERLEME hatası. */
export const FRAMEWORK_STATUS_LABELS_TR: Record<FrameworkStatus, string> = {
  draft: "Taslak",
  active: "Aktif",
  completed: "Tamamlandı",
  expired: "Süresi doldu",
  cancelled: "İptal",
};

export const FRAMEWORK_STATUS_TONES: Record<FrameworkStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-800",
  completed: "bg-indigo-100 text-indigo-800",
  expired: "bg-amber-100 text-amber-800",
  cancelled: "bg-red-100 text-red-700",
};

export const BATCH_STATUS_LABELS_TR: Record<FrameworkBatchStatus, string> = {
  planned: "Planlandı",
  released: "Serbest bırakıldı",
  cancelled: "İptal",
};

export const BATCH_STATUS_TONES: Record<FrameworkBatchStatus, string> = {
  planned: "bg-gray-100 text-gray-700",
  released: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
};

/**
 * Yığın çubuğun bir dilimi.
 *
 * `pct` bir GÖSTERİM genişliğidir (yüzde), bir tutar DEĞİL. Toplamı 100'ü
 * aşmaz çünkü paylar aynı taahhütten bölünür.
 */
export interface ProgressSegment {
  key: keyof Omit<FrameworkProgress, "committedUnits">;
  label: string;
  units: number;
  /** Tailwind arka plan sınıfı. */
  tone: string;
  pct: number;
}

/**
 * Kovaların ekran sırası ve etiketleri.
 *
 * Sıra İŞİN AKIŞIDIR (planlanmamış → planlandı → ödeme bekliyor → üretimde →
 * sevk → teslim), ayrık kova en sonda. Admin ekranı Türkçeyi SABİT yazabilir
 * (ev precedent'i); müşteri yüzeyinin karşılıkları sözlükte
 * (`instantQuote.framework.*`) durur ve bu dosya onları KOPYALAMAZ — iki yüzey
 * aynı cümleyi paylaşmıyor, aynı SAYIYI paylaşıyor.
 */
const SEGMENTS: Array<{
  key: ProgressSegment["key"];
  label: string;
  tone: string;
}> = [
  { key: "unplannedUnits", label: "Planlanmamış", tone: "bg-gray-200" },
  { key: "plannedUnits", label: "Planlanan", tone: "bg-sky-400" },
  { key: "awaitingPaymentUnits", label: "Ödeme bekleyen", tone: "bg-amber-400" },
  { key: "inProductionUnits", label: "Üretimde", tone: "bg-indigo-500" },
  { key: "shippedUnits", label: "Sevk edilen", tone: "bg-emerald-500" },
  { key: "deliveredUnits", label: "Teslim edilen", tone: "bg-green-700" },
  { key: "cancelledOrRefundedUnits", label: "İptal / iade", tone: "bg-red-400" },
];

/**
 * Kova kırılımını çubuk dilimlerine çevirir.
 *
 * `committedUnits === 0` iken HİÇBİR dilim çizilmez: sıfıra bölmek `NaN`
 * genişlik demekti ve `NaN` bir CSS değeri olarak sessizce yok sayılır — yani
 * ekran boş bir çubuğu "her şey tamam" gibi gösterirdi.
 */
export function progressSegments(progress: FrameworkProgress): ProgressSegment[] {
  const committed = progress.committedUnits;
  return SEGMENTS.map((s) => ({
    ...s,
    units: progress[s.key],
    pct: committed > 0 ? (progress[s.key] * 100) / committed : 0,
  }));
}

/** `null` = alan boş (parça partiye girmez), `"invalid"` = okunamadı. */
export type PlanQuantityValue = number | null | "invalid";

/**
 * "12" → 12 adet.
 *
 * Kabul edilen biçim bilerek dar: yalnız rakamlar. `Number()`in gevşekliği
 * (`"0x10"`, `"1e3"`, `" 12 "`, `"1.5"`) bir adet alanında yardım değil
 * sürprizdir ve `1e3` yazan admin 1000 parça planlamak istemiş olamaz.
 */
export function toQuantity(text: string): PlanQuantityValue {
  const clean = text.replace(/\s/g, "");
  if (clean === "") return null;
  if (!/^\d+$/.test(clean)) return "invalid";
  const value = Number(clean);
  return value === 0 ? null : value;
}

export interface PlanPart {
  partId: string;
  position: number;
  name: string;
  /** Bu parçadan KALAN taahhüt (sunucudan gelir; ekran hesaplamaz). */
  remaining: number;
}

export interface PlanLine {
  partId: string;
  quantity: number;
}

/**
 * Plan taslağı → parti satırları; okunamayan ya da kalandan büyük TEK alan bile
 * varsa hiçbir satır dönmez ve hangi parçanın yanlış olduğunu söyleyen TÜRKÇE
 * bir cümle döner.
 *
 * Yarım bir istek göndermek, doğru yazılmış satırları planlayıp yanlış olanı
 * sessizce atlamak olurdu — ve atlanan satır taahhütte KALIR, yani admin
 * planladığını sanır.
 *
 * KALAN kontrolü bir KOLAYLIKTIR, kapı değil: gerçek kapı uçta
 * (`validateBatchPlan` → `commitment_exceeded`) ve bu ekran onun cevabını
 * aynen gösterir. Burada sorulması, admin'in aynı formu üç kez göndermesini
 * önlemek için.
 */
export function planRows(parts: readonly PlanPart[], draft: Record<string, string>): PlanLine[] | string {
  const rows: PlanLine[] = [];
  for (const part of parts) {
    const label = `P${String(part.position).padStart(2, "0")} ${part.name}`;
    const value = toQuantity(draft[part.partId] ?? "");
    if (value === "invalid") {
      return `${label}: adedi okuyamadım. Yalnız tam sayı yazın, örnek: 120`;
    }
    if (value === null) continue;
    if (value > part.remaining) {
      return `${label}: ${value} adet istendi, taahhütten kalan ${part.remaining}`;
    }
    rows.push({ partId: part.partId, quantity: value });
  }
  if (rows.length === 0) {
    return "Partiye en az bir parçadan adet yazın.";
  }
  return rows;
}

/** Çerçeve ekranındaki düğmeler (istek anahtarı = işlem kimliği). */
export type FrameworkActionKey =
  | "plan-preview"
  | "plan"
  | "release"
  | "batch-cancel"
  | "activate"
  | "cancel"
  | "extend"
  | "preferences";

/**
 * Başarı şeridinin cümlesi — İŞLEME göre.
 *
 * Neden saf ve neden işlem başına (emsal: `price-values.ts` `successNotice`):
 * sekiz düğme tek bir istek işlevini paylaşıyor ve ortak bir cümle, kilit
 * uzatmada "parti serbest bırakıldı" derdi. Para ekranında admin'e yanlış
 * söylemek, müşteriye yanlış söylemenin ikizidir.
 */
export function frameworkNotice(action: FrameworkActionKey): string {
  switch (action) {
    case "plan-preview":
      return "Ön izleme hazır: aşağıdaki tutarlar anlaşmanın kilitli fiyatından hesaplandı. Hiçbir parti YAZILMADI.";
    case "plan":
      return "Parti planlandı. Taahhütten düşen adetler kova kırılımında görünür; ödeme, partiyi serbest bıraktığınızda istenir.";
    case "release":
      return "Parti serbest bırakıldı: müşteriye ödenebilir bir teklif açıldı ve tutarı anlaşmada yazan tutarla BİREBİR aynı.";
    case "batch-cancel":
      return "Parti iptal edildi. Para hiç hareket etmemişti, o yüzden adet taahhüde geri döndü.";
    case "activate":
      return "Anlaşma aktifleştirildi: fiyat kilidi yürürlükte ve partiler serbest bırakılabilir.";
    case "cancel":
      return "Anlaşma iptal edildi: planlı partiler düştü ve fiyat kilidi kalktı. ÖDENMİŞ partiler kendi akışında devam eder.";
    case "extend":
      return "Fiyat kilidi uzatıldı. Kilitli birim fiyatlar ve taahhüt DEĞİŞMEDİ.";
    case "preferences":
      return "Tercihler kaydedildi. Çapalı atölye yalnız atamanın ilk adayıdır; kapasite ve malzeme kapıları aynen uygulanır.";
  }
}
