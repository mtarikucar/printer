/**
 * Boyacı sıralamasının AYARLARI — saf yapılandırma modülü.
 *
 * DB yok, `server-only` yok: bu modülü hem API rotaları, hem BullMQ worker'ı
 * (boyacı atama zinciri worker'dan da tetiklenecek), hem de DB'siz birim testi
 * import eder. Üretici tarafındaki ikizi `manufacturer-scoring.ts`.
 *
 * NEDEN AYRI DOSYA: sıralayıcının kendisi (`services/painter-assignment.ts`)
 * yükleyici yarısı için `@/lib/db`yi import ediyor. Kalibrasyon sayıları orada
 * dursaydı, bir istemci bileşeni ya da saf test bu sayıları okumak için `pg`yi
 * de paketine sürüklerdi (bir kez yaşandı: `next dev` "Module not found: pg").
 */
import {
  PARTNER_MODEL_ACK_ACTION,
  PARTNER_MODEL_REVISION_ACTION,
} from "@/lib/config/partner-model-ack";

/** Alt skorların ağırlıkları. Tüketiciler NORMALİZE ETMEZ; toplamı 1.0 olmalı. */
export interface PainterScoringWeights {
  /** Platformun ÖDEDİĞİ iki kargo bacağı: üretici→boyacı ve boyacı→müşteri. */
  route: number;
  /** Boyacının tezgâhındaki ağırlıklı iş yükü. */
  load: number;
  /** Son işlerdeki davranış (kabul/teslim ↔ ret/yanıtsızlık). */
  reliability: number;
  /** İşin ikinci bir boyacı QC turuna kalma oranı. */
  qcQuality: number;
  /** Devirden kargoya geçen süre. */
  onTime: number;
}

/**
 * Başlangıç ağırlıkları (planın önerdiği .35/.30/.15/.15/.05) ve NEDEN böyle:
 *
 * - route 0.35 — tek gerçek PARA kalemi bu. Boyama işinde platform İKİ kargo
 *   öder (üretici→boyacı devri + boyacı→müşteri teslimi); üretici sıralamasında
 *   tek bacak vardı ve orada mesafe zaten 0.35 taşıyor. İki bacak birden yanlış
 *   seçildiğinde kayıp iki katına çıktığı için bu ağırlık daha düşük olamazdı.
 * - load 0.30 — üretici sıralayıcısıyla birebir aynı. Kapasitesi dolan boyacı
 *   zaten UYGUNSUZ; bu ağırlık "dolmakta olanı" geri çeker, yani teslim süresini
 *   korur. Route'un hemen altında durması bilinçli: yakınlık kısa mesafede
 *   baskın olmalı ama neredeyse dolu bir atölyeyi seçtirecek kadar değil.
 * - reliability 0.15 — ret ve yanıtsızlık sıralamada ceza görmeli, ama bu bir
 *   YAPTIRIM değil (yaptırım = strike, ayrı mekanizma). 0.15, kronik reddeden
 *   bir boyacıyı listenin altına indirmeye yeter, tek bir reddi "kara liste"ye
 *   çevirmeye yetmez.
 * - qcQuality 0.15 — ikinci QC turu müşteriye gecikme, platforma ikinci kargo
 *   riski demek. Güvenilirlikle AYNI ağırlıkta: ikisi de "iş yeniden yapılıyor
 *   mu" sorusunun iki ayrı yüzü ve birini diğerine üstün tutmanın veri temeli
 *   yok.
 * - onTime 0.05 — en zayıf sinyal, çünkü devir→kargo süresi boyacının
 *   denetiminde OLMAYAN bir bacak içeriyor (üreticinin gönderdiği kargonun yolda
 *   geçirdiği gün). Ölçtüğümüz şey kısmen kargo firmasının performansı olduğu
 *   için sıralamayı tek başına çevirmesine izin verilmez.
 *
 * Toplam = 1.0. Tüketiciler normalize etmez (üretici tarafındaki sözleşmenin
 * aynısı), bu yüzden bir ağırlığı değiştiren diğerinden kesmek zorunda.
 */
export const PAINTER_WEIGHTS: PainterScoringWeights = {
  route: 0.35,
  load: 0.3,
  reliability: 0.15,
  qcQuality: 0.15,
  onTime: 0.05,
};

/** Ağırlık başına env anahtarı. Tek yerde durur: ayar ve sürüm damgası aynı listeyi okur. */
export const PAINTER_WEIGHT_ENV: Record<keyof PainterScoringWeights, string> = {
  route: "PAINTER_W_ROUTE",
  load: "PAINTER_W_LOAD",
  reliability: "PAINTER_W_RELIABILITY",
  qcQuality: "PAINTER_W_QC",
  onTime: "PAINTER_W_OTD",
};

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  // Negatif ya da sayı olmayan değer sessizce ağırlığı ters çevirirdi.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Yürürlükteki ağırlıklar. Env ile ayarlanabilir olması bilinçli: kalibrasyonu
 * canlı veriyle düzeltmek için deploy beklemek, yanlış yerleşen her siparişi
 * gerçek paraya çevirir.
 */
export function getPainterWeights(): PainterScoringWeights {
  return {
    route: envFloat(PAINTER_WEIGHT_ENV.route, PAINTER_WEIGHTS.route),
    load: envFloat(PAINTER_WEIGHT_ENV.load, PAINTER_WEIGHTS.load),
    reliability: envFloat(PAINTER_WEIGHT_ENV.reliability, PAINTER_WEIGHTS.reliability),
    qcQuality: envFloat(PAINTER_WEIGHT_ENV.qcQuality, PAINTER_WEIGHTS.qcQuality),
    onTime: envFloat(PAINTER_WEIGHT_ENV.onTime, PAINTER_WEIGHTS.onTime),
  };
}

/** Varsayılan ağırlık kümesinin adı. Değerler değişirse BUMP edilir. */
export const PAINTER_WEIGHTS_BASE_VERSION = "p1.0";

/**
 * Değerlendirme satırına yazılan ağırlık sürümü.
 *
 * NEDEN env'e duyarlı: üretici tarafında `weightsVersion` sabit bir metindi ve
 * env ayarı sürümü DEĞİŞTİRMİYORDU — yani operatör bir ağırlığı çevirdiğinde
 * eski ve yeni kararlar aynı etikete yazılıyor, "bu satır hangi formülün
 * ürünü" sorusu geri dönülemez biçimde kayboluyordu. Burada herhangi bir
 * override devredeyse sürüm "+env" ile damgalanır: karşılaştırma yapan kişi
 * satırların farklı bir formülden geldiğini görür.
 */
export function painterWeightsVersion(): string {
  const tuned = Object.values(PAINTER_WEIGHT_ENV).some((name) => {
    const raw = process.env[name];
    return !!raw && Number.isFinite(parseFloat(raw)) && parseFloat(raw) >= 0;
  });
  return tuned ? `${PAINTER_WEIGHTS_BASE_VERSION}+env` : PAINTER_WEIGHTS_BASE_VERSION;
}

// ─── Kapasite birimi (capacity-unit kararı) ─────────────────────────────────

/**
 * Kaç adet, bir iş yükü birimi daha eder.
 *
 * Sahibin kararı: "sipariş başına bir, toplu işte her yirmi adet için bir tane
 * daha". 20 adet, bir boyacının bir oturuşta seri hâlde boyayabileceği miktarın
 * kabaca karşılığıdır: altındaki sayılar tezgâhta ayrı bir "iş" açmaz.
 */
export const PAINTER_UNITS_PER_EXTRA_SLOT = 20;

/**
 * Bir siparişin iş yükü birimi: 1 + floor(adet / 20).
 *
 *   1 adet → 1     19 adet → 1     20 adet → 2     60 adet → 4
 *
 * NEDEN BAYRAK YOK (isBulk / atölye seansı): "toplu iş" bayrağı yalnız belirli
 * yollarda yazılıyor; elle yazılan 40 parçalık bir sipariş bayraksız kalabilir
 * ve o hâlde tek sipariş gibi sayılırdı — yani kural tam da yazıldığı durumda
 * çalışmazdı. Adet zaten her siparişte var ve doğruyu söylüyor.
 *
 * NEDEN floor (ceil değil): ceil, 2 adetlik sıradan bir siparişi de 2 birime
 * çıkarır ve kapasiteyi yarıya indirirdi. floor, tam da "yirmi adet dolduğunda"
 * bir birim daha ekler.
 *
 * TEK KAYNAK: yük SQL'de de hesaplanabilirdi, ama o kopya bu fonksiyondan
 * sessizce ayrışırdı. Yükleyici tezgâh satırlarını çekip burada katlar.
 */
export function painterLoadUnits(units: number | null | undefined): number {
  // Bozuk/eksik adet 1 sayılır: sipariş var, en az bir birim yer kaplar.
  const q = Number.isFinite(units) && (units as number) > 0 ? Math.floor(units as number) : 1;
  return 1 + Math.floor(q / PAINTER_UNITS_PER_EXTRA_SLOT);
}

// ─── Rota (mesafe) eğrisi ───────────────────────────────────────────────────

/**
 * Rota alt skoru, üretici sıralayıcısındaki SÜREKLİ mesafe eğrisinin aynısını
 * kullanır: 0 birim → 100, 200 birim (~300 km) → 55, 700 birim (~1050 km) → 20.
 *
 * NEDEN KOPYA: eğrinin canlı sahibi `services/manufacturer-assignment.ts` ve o
 * modül `@/lib/db`yi import ediyor; buradan import etmek saf yarıyı DB'ye
 * bağlardı. Kopya BEDAVA DEĞİL — `scripts/test-painter-scoring.ts` her koşuda
 * iki eğrinin aynı sayıları verdiğini doğrular, yani biri kayarsa test düşer.
 *
 * NEDEN KADEMELİ DEĞİL SÜREKLİ: boyamada iki kargo bacağı var ve kademeli model
 * Kocaeli→Düzce (103 km) ile Edirne→Hakkari'yi (1423 km) aynı kovaya atıyor.
 * Bu körlük tek bacakta bile paraya mal oluyordu; iki bacakta iki katına çıkar.
 */
export const ROUTE_NEAR_UNITS = 200;
export const ROUTE_NEAR_SCORE = 55;
export const ROUTE_FLOOR_UNITS = 700;
export const ROUTE_FLOOR_SCORE = 20;
/**
 * İllerden biri bilinmiyorsa nötr skor. 0 DEĞİL: adresi eksik bir boyacı
 * "dünyanın öbür ucu" sayılamaz. 100 de değil: bilmediğimiz şey lehe yazılamaz.
 */
export const ROUTE_UNKNOWN_SCORE = 30;

/**
 * İki bacağın ağırlığı — EŞİT.
 *
 * Devir bacağını (üretici→boyacı) hafifletmek için bir gerekçe yok: ikisini de
 * platform ödüyor, ikisi de aynı boyda tek koli ve ikisi de aynı tarifeye tabi.
 * Kargo desi/bölge tablosu geldiğinde (Phase 10) bu sabit gerçek maliyetle
 * değişir; çağıranlar aynı kalır.
 */
export const ROUTE_LEG_WEIGHTS = { handoff: 0.5, delivery: 0.5 } as const;

// ─── Geçmiş sinyalleri ──────────────────────────────────────────────────────

/** Geçmişe kaç kayıt geriye bakılır (üretici sıralayıcısıyla aynı pencere). */
export const PAINTER_HISTORY_LOOKBACK = 20;

/**
 * Bir sinyalin konuşabilmesi için gereken en az örnek. Altında NÖTR yazılır:
 * yeni boyacı ne ödüllendirilir ne cezalandırılır.
 */
export const PAINTER_MIN_HISTORY_SAMPLES = 3;

/** Veri yokken yazılan nötr skor (üretici sıralayıcısıyla aynı: 70). */
export const PAINTER_NEUTRAL_HISTORY_SCORE = 70;

/**
 * Devirden kargoya hedef süre (gün). Altında tam puan, iki katında 0.
 *
 * 10 gün nereden: üreticiden çıkan kolinin yolda ~2 günü + boyama ~5 gün + QC
 * turu ~1 gün + kargoya verme ~1 gün. Platformun üreticiye verdiği hedefle
 * (7 gün atama→baskı) aynı mantıkla kurulur; boyamada ARAYA BİR KARGO girdiği
 * için daha uzundur.
 */
export const PAINT_TURNAROUND_TARGET_DAYS = 10;

// ─── Eylem günlüğü sözlüğü ──────────────────────────────────────────────────

/**
 * Boyacının KENDİ yaptığı ve işi ilerleten eylemler (rotaların yazdığı
 * dizelerle birebir): accept / received / painting / painted / submit_qc / ship.
 *
 * Üretici tarafında bu liste bir kez yanlış yazılmıştı ("shipped"/"printed"
 * gibi hiç yazılmayan dizeler): iyi sayaç hep 0 kalıyor, tek bir ret partneri
 * 70'ten 0'a düşürüyordu. Bu yüzden liste rotalardaki INSERT'lerden kopyalanır.
 */
export const PAINTER_GOOD_ACTIONS: readonly string[] = [
  "accept",
  "received",
  "painting",
  "painted",
  "submit_qc",
  "ship",
];

/**
 * Yanıtsız kalan iş için eylem günlüğüne yazılacak dize.
 *
 * Sahibin kararı: 24 saat içinde yanıtlamayan boyacı işi kaybeder, STRIKE YEMEZ
 * ve bu üç-ret sayacına işler. "Strike yok" ile "sıralamada hiç görünmesin"
 * aynı şey değildir: strike hesabı askıya alan açık bir yaptırım, sıralama ise
 * "kim daha hızlı yanıt veriyor" sorusunun cevabı. Sessizlik tam olarak bu
 * sorunun cevabıdır, o yüzden güvenilirlikte olumsuz sayılır.
 *
 * Dize BURADA durur ki SLA worker'ı ile bu sözlük ayrışamasın: worker başka bir
 * dize yazarsa sinyal sessizce hiç sayılmaz.
 */
export const PAINTER_SLA_TIMEOUT_ACTION = "sla_no_answer";

/** Boyacı aleyhine sayılan eylemler: kendi reddi ve yanıtsızlığı. */
export const PAINTER_BAD_ACTIONS: readonly string[] = [
  "decline",
  PAINTER_SLA_TIMEOUT_ACTION,
];

/**
 * Sistemin kendi yerleştirme satırı. P2'nin `services/painter-auto-assign.ts`
 * dosyasındaki `PAINTER_AUTO_ASSIGNED_ACTION` ile AYNI olmak zorunda.
 *
 * NEDEN IMPORT DEĞİL KOPYA: o modül `@/lib/db` import ediyor; buradan import
 * etmek bu saf yapılandırmayı (ve onu okuyan istemci yüzeylerini) `pg`ye
 * bağlardı. Kopyanın bedeli ödenmiştir: `scripts/test-painter-scoring.ts`
 * her koşuda o dosyadaki tanımı METİN olarak okur ve eşitliği doğrular.
 */
export const PAINTER_AUTO_ASSIGNED_ACTION = "auto_assigned";

/**
 * Hiçbir yöne sayılmayan eylemler. Üç öbek:
 *
 *  1. ADMIN'in işlemi, boyacının değil (admin_assigned / admin_revoked /
 *     admin_swapped_out / edit). Geri alma için ayrı ve açık bir yaptırım
 *     (strike) var; aynı olayı bir de güvenilirlikten düşmek çifte ceza olurdu.
 *  2. SİSTEMİN işlemi (auto_assigned): iş boyacıya otomatik verilmiş olması
 *     boyacının bir davranışı değildir — ödül de ceza da olamaz.
 *  3. MODEL SÜRÜMÜ duyuru/onayı (model_revision / model_ack). Onay bir
 *     KİLİTTİR: onaylanmamış yeni sürüm varken sipariş ilerleyemez. Onayı
 *     puanlamak o emniyet kilidine parmak basmak olurdu — hızlı onaylayan
 *     ödüllendirilseydi, partner okumadan onaylamaya teşvik edilirdi.
 *     Dizeler `config/partner-model-ack.ts`ten IMPORT edilir (o da saf bir
 *     modül), böylece ayrışmaları imkânsızdır.
 *
 * Kapalı küme olarak yazılır ki yeni bir eylem dizesi eklendiğinde üç kümeden
 * birine BİLİNÇLİ konması gereksin; test, `painter_actions`a YAZAN her dosyayı
 * tarayıp sınıflanmamış dize kalmadığını doğrular.
 */
export const PAINTER_NEUTRAL_ACTIONS: readonly string[] = [
  "admin_assigned",
  "admin_revoked",
  "admin_swapped_out",
  "edit",
  PAINTER_AUTO_ASSIGNED_ACTION,
  PARTNER_MODEL_REVISION_ACTION,
  PARTNER_MODEL_ACK_ACTION,
];
