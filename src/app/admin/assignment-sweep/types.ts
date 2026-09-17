import type { AutoAssignOrderKind } from "@/lib/config/flags";
// YALNIZ TİP (`import type`, derlemede silinir): bu modülü istemci bileşeni de
// okuyor. `@/lib/config/scoring` zaten saf bir modül, ama tip olarak almak
// sözleşmeyi tek kaynakta tutar — ekranın gösterdiği karşılaştırma ile gölge
// kaydına düşen karşılaştırma aynı şeklin iki kopyası olamaz.
import type { ShadowComparison } from "@/lib/config/scoring";

/**
 * /admin/assignment-sweep — ekran, API ve istemci arasındaki veri sözleşmesi.
 *
 * SAF tip modülü: istemci bileşeni (`client.tsx`) de buradan okuduğu için
 * buraya asla `@/lib/db`, bir servis ya da başka bir sunucu modülü girmez.
 * (`@/lib/config/flags` kasıtlı tek istisna: o da saf ve BullMQ worker'ının
 * yüklediği bir modül, DB'ye dokunmaz.)
 *
 * Sunucu tarafı yükleyici `sweep-data.ts`, HTTP ucu `/api/admin/assignment-sweep`.
 */

/**
 * Sıralamayı üreten yetkili ağırlık profili. "v3" BİLEREK yok: o yalnızca
 * gölgede çalışır (ranker-rollout kararı), hiçbir zaman atamayı belirlemez.
 */
export type SweepProfile = "v1" | "v2";

/**
 * Sipariş türü başına otomatik atama anahtarının AÇIK/KAPALI durumu.
 * Atölye her zaman `false`'tır (anahtarı yoktur, hiç otomatik atanmaz).
 */
export type AutoAssignSwitches = Record<AutoAssignOrderKind, boolean>;

/** Adayın alt skorları — sipariş detayındaki aday kartıyla aynı alanlar. */
export interface SweepScoreBreakdown {
  distance: number;
  load: number;
  reliability: number;
  onTimeDelivery: number;
  compliance: number;
  batchAffinity: number;
}

/** Siparişin gideceği üretici adayı (kuru tarama sonucu). */
export interface SweepCandidate {
  manufacturerId: string;
  companyName: string;
  city: string | null;
  district: string | null;
  totalScore: number;
  currentLoad: number;
  maxConcurrentOrders: number;
  reasons: string[];
  scores: SweepScoreBreakdown;
  /**
   * Bu aday SIRALAMANIN değil, MÜLKİYETİN sonucu: sipariş satıcının kendi
   * kataloğundan çıktı ve yalnız o satıcının atölyesine verilebilir. Skorlar
   * yine gösterilir (admin yükü görsün) ama kararı vermezler — ekran bunu
   * ayrıca yazar, yoksa admin "neden en yüksek skorlu atölye değil?" diye
   * sorardı.
   */
  sellerOwned: boolean;
}

/**
 * Taramanın listelediği sipariş. Sayfa ilk açıldığında (tarama ÇALIŞMADAN)
 * gösterilen alanlar bunlar; aday ve gerekçe taramayla gelir.
 */
export interface SweepOrderBase {
  orderId: string;
  orderNumber: string;
  customerName: string;
  /** Teslimat ili — mesafe skorunun girdisi. */
  city: string | null;
  /** Otomatik atama taksonomisindeki tür (anahtarlarla aynı küme). */
  kind: AutoAssignOrderKind;
  status: string;
  amountKurus: number;
  quantity: number;
  isBulk: boolean;
  /** ISO — istemci Europe/Istanbul biçimleyicisiyle yazar. */
  createdAt: string;
  /** Kaç gündür üretici bekliyor. */
  waitingDays: number;
  /**
   * Bu siparişin TÜRÜNÜN otomatik atama anahtarı açık mı. Kapalıysa tarama
   * satırı yine gösterir (admin birikeni görebilmeli) ama satır seçili GELMEZ
   * ve uygulanması ayrı bir onay ister: kapatılmış bir anahtarın iki tıkla
   * toplu atamaya dönüşmesi, anahtarı anlamsız kılardı.
   */
  autoAssignEnabled: boolean;
}

/**
 * Sipariş türlerinin Türkçe karşılığı. Anahtar kümesi `AutoAssignOrderKind`
 * olduğu için yeni bir tür eklendiğinde burada derleme hatası alınır — etiketi
 * unutulmuş bir tür ekranda boş görünmez.
 */
export const SWEEP_KIND_LABEL_TR: Record<AutoAssignOrderKind, string> = {
  custom: "Kişiye özel figür",
  upload: "Müşteri model yüklemesi",
  whatsapp_ai: "WhatsApp siparişi",
  manual: "Elle yazılan sipariş",
  cart_platform: "Katalog / sepet siparişi",
  workshop: "Atölye seansı",
};

export type SweepBlockReason =
  | "workshop"
  | "flag_off"
  | "refunded"
  | "not_eligible"
  | "no_printable_content"
  | "no_candidate"
  | "rank_failed"
  /**
   * Satıcının kendi ürünü, ama kendi atölyesine verilemiyor. Rakip bir
   * atölyeye atamak pazaryeri sözleşmesinin ihlali olurdu, o yüzden tarama
   * bu satırı ATANAMAZ gösterir ve uygulama ucu da reddeder.
   */
  | "seller_owned";

/** Neden bu sipariş atanamıyor — admin'e gösterilen Türkçe gerekçe. */
export interface SweepBlock {
  reason: SweepBlockReason;
  message: string;
}

/** Taranmış sipariş: aday + skor kırılımı ya da gerekçe. */
export interface SweepRow extends SweepOrderBase {
  candidate: SweepCandidate | null;
  /** İkinci aday — "neden bu üretici" sorusunun karşılaştırma noktası. */
  runnerUp: SweepCandidate | null;
  block: SweepBlock | null;
  /** Aday çıkmadıysa elenen üreticiler ve eleme gerekçeleri (ilk birkaçı). */
  ineligible: { companyName: string; reason: string }[];
  profile: SweepProfile;
  /**
   * FAZ 5 GÖLGESİ: yeni sinyallerle yapılan sıralamanın canlıyla farkı.
   *
   * SALT GÖSTERİMDİR — bu alan hiçbir atamayı belirlemez ve uygulama ucu onu
   * hiç okumaz (ranker-rollout = B: sinyaller bir-iki hafta yalnız ölçülür).
   * `null` = gölge kapalı ya da hesaplanamadı; ekran o zaman bir şey iddia
   * etmez, "gölge çalışmadı" der.
   */
  shadow: ShadowComparison | null;
}

export interface SweepDryRunResponse {
  /** ISO — sonucun ne kadar taze olduğunu ekranda göstermek için. */
  scannedAt: string;
  /** Üretici bekleyen TÜM siparişlerin sayısı (limitten bağımsız). */
  total: number;
  /** Bu taramada en fazla kaç sipariş değerlendirildi. */
  limit: number;
  rows: SweepRow[];
}

/**
 * Uygulama isteği: admin'in EKRANDA GÖRDÜĞÜ aday da gönderilir. Sunucu yeniden
 * sıralar ve aday değiştiyse atamayı YAPMAZ — admin'in onaylamadığı bir
 * üreticiye sipariş gitmez.
 */
export interface SweepApplyItem {
  orderId: string;
  manufacturerId: string;
}

export interface SweepApplyResult {
  orderId: string;
  orderNumber: string | null;
  ok: boolean;
  manufacturerName: string | null;
  /** Türkçe sonuç ya da atlama gerekçesi. */
  message: string;
  /**
   * Sonuç "ekranın verisi bayatladı" anlamına geliyorsa true (aday değişti,
   * sipariş artık uygun değil). İstemci bunu görünce yeniden tarama ister.
   */
  rescan?: boolean;
}

export interface SweepApplyResponse {
  assigned: number;
  skipped: number;
  results: SweepApplyResult[];
}

/**
 * Tek POST'ta uygulanan sipariş sayısı.
 *
 * Neden küçük: her atama yeniden sıralama (üretici başına birkaç sorgu),
 * denetim satırı, bildirim ve SSE yayını demek. 50 siparişi tek istekte
 * işlemek bir vekil sunucu zaman aşımına denk gelirse admin hangi siparişin
 * atandığını göremezdi. İstemci seçimi bu boyda gruplara böler, her grubun
 * sonucunu tek tek gösterir; yarıda kalan bir grup yalnız kendi siparişlerini
 * belirsiz bırakır.
 */
export const SWEEP_APPLY_BATCH = 10;
/** Tek onayda uygulanabilecek en fazla sipariş (istemci gruplara böler). */
export const SWEEP_MAX_APPLY = 25;
/** Tek taramada değerlendirilen varsayılan sipariş sayısı. */
export const SWEEP_DEFAULT_LIMIT = 25;
/**
 * Tarama üst sınırı. Her sipariş için üretici başına birkaç sorgu çalışır
 * (güvenilirlik, zamanında teslim, yük), yani tarama ucuz değildir; sınır
 * admin'in bir tıkla veritabanını meşgul etmesini ve tek isteğin zaman
 * aşımına uğramasını engeller.
 */
export const SWEEP_MAX_LIMIT = 25;
