/**
 * Partner model-revision acknowledgement: the pure rules.
 *
 * Phase 2 kararı (late-model-upload): yeni bir model sürümü HER aşamada
 * yüklenebilir ve herkes haberdar edilir. Baskı sürerken üreticinin yeni
 * sürümü GÖRDÜĞÜNÜ onaylaması gerekir; boyacı da elindeki baskının eski sürüme
 * ait olabileceğini okumadan işe devam etmemelidir. Eski pasif rozet ("Model
 * güncellendi") kimsenin okuduğunu kanıtlamıyordu.
 *
 * NEDEN AYRI, SAF MODÜL:
 *  - `@/lib/db` import etmez → BullMQ worker'ın zincirine girse bile güvenli
 *    ("server-only" da YOKTUR; bkz. worker-server-only tuzağı),
 *  - istemci bileşenleri (üretici sipariş ekranı, boyacı iş listesi) aynı
 *    kuralı çalıştırır; sunucu ile ekranın ayrışması bu yüzden imkânsızdır,
 *  - scripts/test-partner-model-ack.ts bunu veritabanı olmadan test eder.
 *
 * order-model-policy.ts import EDİLİR: o da saf bir modüldür (db yok,
 * server-only yok), böylece "hangi aşamada kimden onay istenir" sorusunun tek
 * kaynağı aşama tablosunun kendisi olur ve iki liste ayrışamaz.
 *
 * NEDEN YENİ KOLON/ENUM YOK: duyuru ve onay, partnerin KENDİ serbest metinli
 * eylem günlüğüne (manufacturer_actions / painter_actions — `action` kolonu
 * text) yazılır. Böylece migration gerekmez ve kayıt, partnerin kendi zaman
 * çizelgesinde zaten görünür. pg enum'a değer eklemek yasak: down migration
 * onu temiz şekilde geri alamaz.
 */
import { modelUploadSideEffects, type ModelUploadStage } from "./order-model-policy";

/** Yeni sürüm DUYURUSU (notifyOrderModelRevision yazar). */
export const PARTNER_MODEL_REVISION_ACTION = "model_revision";
/** Partnerin "gördüm" onayı (ack uçları yazar). */
export const PARTNER_MODEL_ACK_ACTION = "model_ack";

export type PartnerKind = "manufacturer" | "painter";

/** Eylem günlüğü satırının onay/duyuru için okunan tek parçası. */
export interface PartnerActionRow {
  action: string;
  notes: string | null;
  createdAt?: Date | string | null;
}

/**
 * Sürüm numarasını not metnine gömmenin biçimi. Numara ayrı bir kolonda
 * DEĞİL çünkü yeni kolon migration ister; biçimi tek yerde yazıp tek yerde
 * okuduğumuz için ayrışamaz.
 *   "rev:3" · "rev:3 — kaide düzeltildi"
 */
export function formatModelRevisionNote(revision: number, note?: string | null): string {
  const base = `rev:${Math.trunc(revision)}`;
  const extra = (note ?? "").trim();
  return extra ? `${base} — ${extra}`.slice(0, 500) : base;
}

/** "rev:3 — ..." → 3. Biçime uymayan (elle yazılmış) not null döner. */
export function parseModelRevisionNote(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const m = /^rev:(\d{1,9})\b/.exec(notes.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Verilen eylem türündeki satırlar içinde EN BÜYÜK sürüm numarası. */
function maxRevisionFor(rows: PartnerActionRow[], action: string): number | null {
  let best: number | null = null;
  for (const r of rows) {
    if (r.action !== action) continue;
    const rev = parseModelRevisionNote(r.notes);
    if (rev != null && (best == null || rev > best)) best = rev;
  }
  return best;
}

export interface ModelAckState {
  /** Bu partnere duyurulan en yeni sürüm (hiç duyurulmadıysa null). */
  announcedRevision: number | null;
  /** Partnerin onayladığı en yeni sürüm. */
  acknowledgedRevision: number | null;
  /** Onay bekliyor mu: duyurulan sürüm onaylanandan yeni. */
  pending: boolean;
}

/**
 * Partnerin eylem günlüğünden onay durumu.
 *
 * Kıyas siparişin sürüm SAYISIYLA değil, bu partnere yapılan DUYURUYLA
 * yapılır. Sebep: sürüm sayısını okumak, partner işi almadan önce yüklenmiş
 * her sürümü ona onaylatırdı — geçmişteki her iş bir anda "onay bekliyor"
 * görünür ve Faz 0/1 davranışı (iş akan siparişler) kırılırdı. Duyuru satırı
 * yalnızca partner işi elinde tutarken yazılır.
 */
export function modelAckState(rows: PartnerActionRow[]): ModelAckState {
  const announcedRevision = maxRevisionFor(rows, PARTNER_MODEL_REVISION_ACTION);
  const acknowledgedRevision = maxRevisionFor(rows, PARTNER_MODEL_ACK_ACTION);
  return {
    announcedRevision,
    acknowledgedRevision,
    pending:
      announcedRevision != null &&
      (acknowledgedRevision == null || acknowledgedRevision < announcedRevision),
  };
}

/**
 * Onay beklerken partnerin yapamayacağı ileri adımlar.
 *
 * Kabul (accept) ve reddetme (decline/cancel) KASITLI olarak serbesttir: işi
 * hiç almamış bir partneri onaya zorlamak onu kilitler, işten çıkış yolunu
 * kapatmak ise siparişi dondurur. Engellenen adımlar, eski modelle ÜRETİM ya
 * da TESLİM üreten adımlardır.
 */
export const MANUFACTURER_ACK_BLOCKED_ACTIONS = [
  "start-printing",
  "finish-printing",
  "submit-qc",
  "ship",
  "send-to-painter",
] as const;

export const PAINTER_ACK_BLOCKED_ACTIONS = ["submit-qc", "ship"] as const;

/** Onay bekleyen partnerin ekranında ve sunucusunda aynı Türkçe cümle. */
export const MODEL_ACK_REQUIRED_ERROR =
  "Bu sipariş için yeni bir model sürümü yüklendi. Devam etmeden önce yeni sürümü gördüğünüzü onaylayın.";

/**
 * Onay ekranında gösterilen uyarı. Aşama adı ModelUploadStage birleşimidir ama
 * imza `string` kabul eder: çağıranların çoğu aşamayı sunucudan serbest metin
 * olarak taşır (JSON sınırı) ve tanınmayan bir aşama sessizce genel cümleye
 * düşmelidir — uyarı metni yüzünden istek patlamaz.
 */
export function modelRevisionNoticeTr(
  partner: PartnerKind,
  stage: string | null | undefined
): string {
  if (partner === "painter") {
    switch (stage) {
      case "painting":
        return "Bu iş boyanırken modelin yeni bir sürümü yüklendi. Elinizdeki baskı ESKİ sürüme ait olabilir; boyamaya devam etmeden önce yönetici ile teyitleşin.";
      case "shipped_or_delivered":
        return "Sipariş çıktıktan sonra modelin yeni bir sürümü yüklendi. Ürettiğiniz iş etkilenmez; kayıt için bilginize.";
      default:
        return "Bu sipariş için modelin yeni bir sürümü yüklendi. Dosyayı yeniden indirip devam edin.";
    }
  }
  switch (stage) {
    case "printing":
      return "Baskı sürerken modelin yeni bir sürümü yüklendi. Yeni dosyayı indirip baskıyı yeni sürümle yapın; devam etmek için onaylayın.";
    case "printed_or_qc":
      return "Baskı bittikten sonra modelin yeni bir sürümü yüklendi. Kalite kontrol turu sıfırlandı: yeni sürümü basıp yeni QC fotoğrafları yükleyin.";
    case "painting":
      return "İş boyacıdayken modelin yeni bir sürümü yüklendi. Yönetici boyacıyı da bilgilendirdi.";
    case "shipped_or_delivered":
      return "Sipariş kargolandıktan sonra modelin yeni bir sürümü yüklendi. Üretim etkilenmez; kayıt için bilginize.";
    default:
      return "Bu sipariş için modelin yeni bir sürümü yüklendi. Devam etmeden önce yeni dosyayı indirin.";
  }
}

/**
 * Bir sürüm duyurusunda ONAY hangi partnerden istenir?
 *
 * Eskiden tek bir `requireAck` bayrağı vardı ve duyuru satırı İKİ partnere
 * birden yazılıyordu. Bu, boyama aşamasında yanlıştı: parça boyacıdayken
 * üreticinin işi bitmiştir (politika `needsManufacturerAck: false` der), ama
 * yazılan onay satırı üreticinin `send-to-painter` ve `ship` adımlarını
 * kilitliyordu — yani hiç sorumlusu olmadığı bir onay yüzünden elindeki teslim
 * akışı duruyordu. Onay, işi GERÇEKTEN elinde tutandan istenir.
 *
 * Kaynak, aşama tablosunun kendisidir (order-model-policy.ts): üretici için
 * `needsManufacturerAck`, boyacı için `notifiesPainter`. Böylece tablo ile bu
 * kapı ayrışamaz. Tanınmayan bir aşama gelirse (ör. ileride eklenen bir çağrı
 * `stage` geçmezse) TEMKİNLİ davranılır: ikisinden de onay istenir — eksik
 * kapı, fazla kapıdan pahalıdır.
 */
export interface PartnerAckTargets {
  manufacturer: boolean;
  painter: boolean;
}

/**
 * Aşama adlarının çalışma zamanı kümesi. `Record` olmasının sebebi
 * DERLEME ZAMANI kontrolü: `ModelUploadStage` birleşimine yeni bir aşama
 * eklenirse bu nesne eksik kalır ve derleme kırılır, yani yeni aşama sessizce
 * "tanınmayan" kovasına düşmez.
 */
const MODEL_UPLOAD_STAGE_NAMES: Record<ModelUploadStage, true> = {
  before_production: true,
  printing: true,
  printed_or_qc: true,
  painting: true,
  awaiting_customer_approval: true,
  shipped_or_delivered: true,
  blocked: true,
};

function isModelUploadStage(stage: string | null | undefined): stage is ModelUploadStage {
  return (
    typeof stage === "string" &&
    Object.prototype.hasOwnProperty.call(MODEL_UPLOAD_STAGE_NAMES, stage)
  );
}

export function partnerAckTargets(
  stage: string | null | undefined,
  requireAck = true
): PartnerAckTargets {
  // Kayıt amaçlı yükleme (kargolanmış sipariş): kimseden onay istenmez.
  if (!requireAck) return { manufacturer: false, painter: false };
  if (!isModelUploadStage(stage)) return { manufacturer: true, painter: true };
  const effects = modelUploadSideEffects(stage);
  return { manufacturer: effects.needsManufacturerAck, painter: effects.notifiesPainter };
}

/* ─── QC turu ile model sürümü uyuşmazlığı ────────────────────────────────
 *
 * Bu metinler ONAY kapısının değil, QC kapısının sözlüğüdür; yine de burada
 * duruyorlar çünkü modül saftır (db yok, server-only yok): admin rotası,
 * admin ekranı ve testler aynı cümleyi ve aynı makine-okur kodu paylaşsın.
 */

/** İstemcinin "gerekçe sor" akışını açması için makine-okur işaret. */
export const STALE_QC_REVISION_CODE = "stale_model_revision";

/** Eski sürümü bilerek onaylamak için istenen en kısa gerekçe. */
export const STALE_QC_OVERRIDE_REASON_MIN = 10;

export const STALE_QC_OVERRIDE_REASON_ERROR =
  `Eski sürümün baskısını onaylıyorsunuz. Gerekçe zorunludur (en az ${STALE_QC_OVERRIDE_REASON_MIN} karakter).`;

/** Sunucunun reddederken yazdığı cümle; ekrandaki uyarıyla aynı dili konuşur. */
export function staleQcRevisionErrorTr(
  currentRevision: number | null,
  photoRevision: number | null
): string {
  const current = currentRevision != null ? `v${currentRevision}` : "güncel sürüm";
  const shown = photoRevision != null ? `v${photoRevision}` : "daha eski bir sürüm";
  return (
    `Bu turdaki fotoğraflar ${shown} baskısını gösteriyor; siparişin güncel modeli ${current}. ` +
    "Onaylarsanız ESKİ modelin baskısı kargoya çıkar. Üreticiden güncel sürümün " +
    "fotoğraflarını isteyin; yine de onaylayacaksanız gerekçe yazarak eski sürüm onayını kullanın."
  );
}
