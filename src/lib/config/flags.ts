/**
 * Runtime kill switches. The values live in the `platform_flags` table; this
 * module is only the closed key set and the defaults, so both the Next.js app
 * and the standalone Node worker can import it without touching the DB.
 *
 * It also holds the PURE half of automatic manufacturer assignment: which
 * switch governs a given order, and whether that order may be placed at all.
 * Those rules live next to the keys because the answer has to be identical in
 * three places that cannot share a runtime — the API routes, the BullMQ worker
 * and the test suite — and because a rule kept only inside the async
 * assignment service could not be tested without a database.
 *
 * NOTE: no `import "server-only"` here — BullMQ workers reach this module.
 */
// YALNIZ TİP: derlemede silinir, yani bu modülü import eden BullMQ worker'ı ve
// admin istemci bileşeni için çalışma anında hiçbir şey değişmez. Sinyal
// kümesinin TANIMI `config/scoring.ts`te durur ve orada kalmalı — yerleştirme
// kapısı ile sıralayıcı AYNI kümeyi okumak zorunda (bkz. placementGateRefusal).
import type { Phase5SignalSet } from "@/lib/config/scoring";

export const FLAG_KEYS = [
  "auto_model_enabled",
  "meshy_enabled",
  "wa_bot_enabled",
  "wa_agent_enabled",
  "fal_enabled",
  // Faz 1 — otomatik üretici ataması, sipariş türü başına tek anahtar. Ayrı
  // anahtarlar tek bir "otomatik atama" anahtarından daha iyidir: bir türde
  // (ör. elle yazılan siparişler) atamayı durdurmak, diğerlerini de
  // durdurmadan mümkün olmalı.
  "auto_assign_custom",
  "auto_assign_upload",
  "auto_assign_whatsapp_ai",
  "auto_assign_manual",
  "auto_assign_cart_platform",
  // Faz 4 — otomatik BOYACI ataması. Üretici anahtarlarının aksine TEK anahtar,
  // çünkü boyacı seçimi sipariş türüne göre dallanmaz: üretici QC'sinden geçen
  // ve boyama kalemi olan her sipariş aynı kapıdan geçer. Türe göre bölmek,
  // hiçbir zaman kullanılmayacak beş ayrı düğme demek olurdu.
  "auto_assign_painter",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

/**
 * Used when the table has no row yet. Everything that spends NEW money starts
 * OFF: shipping the code must never be the same event as enabling the spend.
 *
 * Otomatik atama anahtarları AÇIK doğar: yeni para harcamazlar, yalnızca
 * admin'in bugün elle yaptığı atamayı yapar. Kapalı doğsalardı, sahibi her
 * siparişi yine elle atamaya devam eder ve fazın amacı (tıklama beklemeyen
 * sipariş) sessizce hiç başlamazdı.
 */
export const FLAG_DEFAULTS: Record<FlagKey, boolean> = {
  auto_model_enabled: false,
  meshy_enabled: false,
  wa_bot_enabled: false,
  wa_agent_enabled: false,
  fal_enabled: true,
  auto_assign_custom: true,
  auto_assign_upload: true,
  auto_assign_whatsapp_ai: true,
  auto_assign_manual: true,
  auto_assign_cart_platform: true,
  auto_assign_painter: true,
};

export const FLAG_LABELS_TR: Record<FlagKey, string> = {
  auto_model_enabled: "Otomatik 3D model üretimi",
  meshy_enabled: "Meshy sağlayıcısı",
  wa_bot_enabled: "WhatsApp kanalı",
  wa_agent_enabled: "WhatsApp yapay zekâ asistanı",
  fal_enabled: "fal.ai görsel üretimi",
  auto_assign_custom: "Otomatik atama — kişiye özel figür siparişleri",
  auto_assign_upload: "Otomatik atama — müşteri model yükleme siparişleri",
  auto_assign_whatsapp_ai: "Otomatik atama — WhatsApp yapay zekâ siparişleri",
  auto_assign_manual: "Otomatik atama — elle yazılan siparişler",
  auto_assign_cart_platform: "Otomatik atama — platform kataloğu / sepet siparişleri",
  auto_assign_painter: "Otomatik boyacı ataması (üretici QC onayında)",
};

export function isFlagKey(value: unknown): value is FlagKey {
  return typeof value === "string" && (FLAG_KEYS as readonly string[]).includes(value);
}

/**
 * AI_KILL_ALL'ın kapsadığı anahtarlar: dışarıya PARA harcayan ya da müşteriye
 * yapay zekâ çıktısı gönderen her şey. Kapalı küme olarak yazılır, çünkü acil
 * durumda "neyin durduğu" tahmine bırakılamaz.
 */
export const AI_SPEND_FLAG_KEYS = [
  "auto_model_enabled",
  "meshy_enabled",
  "wa_bot_enabled",
  "wa_agent_enabled",
  "fal_enabled",
] as const satisfies readonly FlagKey[];

/**
 * Kill switch'in KAPSAMADIĞI anahtarlar: otomatik üretici ataması. Ayrı küme
 * olarak yazılır ki her yeni anahtarın iki kümeden birine bilinçli konması
 * gereksin (testte kümelerin birleşimi FLAG_KEYS'e eşit olmak zorunda).
 */
export const AUTO_ASSIGN_FLAG_KEYS = [
  "auto_assign_custom",
  "auto_assign_upload",
  "auto_assign_whatsapp_ai",
  "auto_assign_manual",
  "auto_assign_cart_platform",
  // Boyacı ataması da bir YÖNLENDİRMEDİR, harcama değil: kill switch onu da
  // durdurmamalı. Acil durumda boyacı atamasının durması, üretici QC'sinden
  // geçmiş işlerin kimsenin tezgâhına düşmeden beklemesi demek olurdu.
  "auto_assign_painter",
] as const satisfies readonly FlagKey[];

export function isAiSpendFlag(key: FlagKey): boolean {
  return (AI_SPEND_FLAG_KEYS as readonly FlagKey[]).includes(key);
}

/** Break-glass: AI_KILL_ALL=1 forces every AI/spend flag off without a DB write. */
export function killAllEngaged(): boolean {
  return process.env.AI_KILL_ALL === "1";
}

/**
 * Kill switch bu anahtarı kapatıyor mu?
 *
 * AI_KILL_ALL bir PARA musluğudur, sipariş yönlendirmesi değil. Her anahtarı
 * kapatan eski hâli, otomatik atamayı da durdururdu: siparişler `flag_off` ile
 * atlanır, hiçbiri üreticiye gitmez ve harcanmayan bir kuruş da kurtarılmazdı
 * — üstelik tam da acil durumda, sahibi bunu elle atamak zorunda kalırdı.
 * Kapsam bu yüzden AI_SPEND_FLAG_KEYS ile sınırlıdır.
 */
export function flagForcedOffByKillSwitch(key: FlagKey): boolean {
  return killAllEngaged() && isAiSpendFlag(key);
}

// ─── Otomatik atama: sipariş türü ve kapı ───────────────────────────────────

/**
 * Otomatik atama açısından siparişin türü. `workshop` bilinçli olarak
 * listededir ve KARŞILIĞINDA BİR ANAHTAR YOKTUR: atölye seansı siparişleri
 * hiçbir zaman otomatik atanmaz (sahibin kararı — seans için sıralı ÖNERİ
 * gösterilir, üreticiyi admin onaylar). Türü listede tutmak, "atanmadı çünkü
 * atölye" cevabının açıklanabilir kalmasını sağlar.
 */
export type AutoAssignOrderKind =
  | "custom"
  | "upload"
  | "whatsapp_ai"
  | "manual"
  | "cart_platform"
  | "workshop";

/** Otomatik atama kararının okuduğu sipariş kolonları (DB'ye bağlı değil). */
export interface AutoAssignOrderShape {
  status: string | null;
  paymentStatus: string | null;
  orderType: string | null;
  manufacturerId: string | null;
  manufacturerStatus: string | null;
  workshopSessionId: string | null;
  /** Pazarlama kanalı; WhatsApp yapay zekâ siparişini web siparişinden ayırır. */
  attributionChannel: string | null;
  productId: string | null;
  parentReference: string | null;
  /** Siparişin `order_items` satırı var mı (sepet alt siparişi). */
  hasOrderItems: boolean;
}

/**
 * Siparişin türünü kolonlarından türetir.
 *
 * Sıra kuralın kendisidir: atölye bağı her şeyi ezer (o sipariş bir seansın
 * parçasıdır, türü ne olursa olsun). Sonra taşıyıcı tür (`orderType`), en son
 * pazaryeri siparişinin üç şekli ayrılır — sepet/katalog ürünü mü, yoksa
 * admin'in WhatsApp'ta elle yazdığı, ürünü olmayan sipariş mi.
 *
 * WhatsApp yapay zekâ siparişi `custom` taşıyıcı türüyle gelir (web'deki
 * kişiye özel figürle aynı boru hattı), ayrımı `attributionChannel` yapar —
 * terfide taslaktan siparişe kopyalanan tek kanal alanı odur.
 */
export function classifyAutoAssignOrder(
  o: Pick<
    AutoAssignOrderShape,
    "orderType" | "workshopSessionId" | "attributionChannel" | "productId" | "parentReference" | "hasOrderItems"
  >
): AutoAssignOrderKind {
  if (o.workshopSessionId) return "workshop";
  if (o.orderType === "upload") return "upload";
  if (o.orderType === "marketplace") {
    // Sepet alt siparişi, tek ürünlü katalog siparişi: basılacak ürün vardır.
    if (o.hasOrderItems || o.parentReference || o.productId) return "cart_platform";
    // Ürünü olmayan pazaryeri siparişi = admin'in elle yazdığı sipariş.
    return "manual";
  }
  if (o.attributionChannel === "whatsapp") return "whatsapp_ai";
  return "custom";
}

/**
 * Bu türü yöneten anahtar. `null` = anahtar yok, yani tür HİÇBİR ZAMAN
 * otomatik atanmaz (atölye).
 */
export function autoAssignFlagFor(kind: AutoAssignOrderKind): FlagKey | null {
  switch (kind) {
    case "custom":
      return "auto_assign_custom";
    case "upload":
      return "auto_assign_upload";
    case "whatsapp_ai":
      return "auto_assign_whatsapp_ai";
    case "manual":
      return "auto_assign_manual";
    case "cart_platform":
      return "auto_assign_cart_platform";
    case "workshop":
      return null;
  }
}

/**
 * SATIR KAPISININ verebileceği sebepler: yalnız siparişin KENDİ satırından
 * okunabilen hâller (tür, anahtar, iade, durum). Atama taraması bu kümeyi
 * çevirir, çünkü tarama hiçbir yerleştirme DENEMEZ — sipariş satırına bakar.
 */
export type AutoAssignRowSkip =
  | "flag_off"
  | "not_eligible"
  | "no_candidate"
  | "refunded"
  | "workshop";

/**
 * Otomatik atamanın yapılmama sebebi (P1-C1 sözleşmesindeki kapalı küme).
 *
 * FAZ 5'TE GENİŞLEDİ ve genişlemesi ZORUNLUYDU. Yerleştirme kapısı artık iki
 * yeni sebeple reddedebiliyor (`capacity_full`, `large_format_required`) ve
 * ikisinin de bu kümede karşılığı YOKTU. Ölçülen sonuç: ikisi de
 * `not_eligible`e çöküyordu, yani sipariş `manufacturer_id` NULL ile
 * ATANMAMIŞ beklerken
 *   - admin'e "sipariş artık atanabilir durumda değil" (yani işlem gerekmiyor),
 *   - koparılan atölyeye "iş başka bir atölyeye yönlendirildi"
 * deniyordu. Üçü de yanlıştı: iş kayboluyor, kimse doğru bilgilendirilmiyordu.
 *
 * KÜME KAPALI KALMALI: `Record<AutoAssignSkip, ...>` yazan her sözlük, yeni bir
 * sebebin karşılığı unutulduğunda DERLEME hatası verir — admin'in e-postasına
 * düşen bir "undefined" değil. Aşağıdaki üç tablo (sebep, sonraki adım, atama
 * bekleniyor mu) bilerek bu tipe bağlıdır.
 */
export type AutoAssignSkip =
  | AutoAssignRowSkip
  // Atölyenin tezgâhı dolu. GEÇİCİDİR: aynı sipariş yarın yerleşebilir, bu
  // yüzden "artık atanamaz" diyen `not_eligible` ile aynı cümleyi kuramaz.
  | "capacity_full"
  // İş büyük format ister, atölye bu yeteneği beyan etmemiş. KALICIDIR: tekrar
  // denemek işe yaramaz; admin ya başka atölye seçmeli ya beyanı düzeltmeli.
  | "large_format_required";

/**
 * Sipariş atanabilir bir durumda mı? `paid` + pazaryeri, platform kataloğu
 * siparişinin doğduğu hâldir ve atanabilir; geri kalan her şey için kapı
 * `approved`'dır. SQL karşılığı `assignableStatusGuard()`
 * (services/manufacturer-assign.ts); ikisi aynı cümleyi söylemek zorundadır.
 */
function hasAssignableStatus(o: Pick<AutoAssignOrderShape, "status" | "orderType">): boolean {
  if (o.status === "approved") return true;
  return o.status === "paid" && o.orderType === "marketplace";
}

/** Sipariş şu anda bir üreticide mi? NULL / 'unassigned' = boşta. */
function isUnassigned(
  o: Pick<AutoAssignOrderShape, "manufacturerId" | "manufacturerStatus">
): boolean {
  if (o.manufacturerId) return false;
  return !o.manufacturerStatus || o.manufacturerStatus === "unassigned";
}

/**
 * Yalnız sipariş SATIRINDAN karar verilebilen kapı: atölye, anahtar, iade,
 * "onaylı + atanmamış". Basılabilir içerik kontrolü burada YOKTUR çünkü o bir
 * DB sorgusu ister; çağıran önce bunu çalıştırır, uygun çıkarsa sorguyu yapar.
 * Böylece elenecek bir sipariş için boşuna sorgu atılmaz.
 *
 * Sıra kuralın kendisidir ve sebep metni bu sıradan gelir: önce hiç atanmayan
 * tür (atölye), sonra kapatılmış anahtar, sonra iade (ileri işlem yasağı),
 * en son siparişin kendi durumu.
 */
export function autoAssignRowGate(
  o: AutoAssignOrderShape,
  flagEnabled: boolean
): AutoAssignRowSkip | null {
  const kind = classifyAutoAssignOrder(o);
  if (autoAssignFlagFor(kind) === null) return "workshop";
  if (!flagEnabled) return "flag_off";
  // İade kararı (refund-end-state): iade edilmiş sipariş `approved` +
  // `unassigned` durur, yani tam olarak atanabilir bir siparişe benzer.
  // Buradaki kontrol olmadan otomatik atama onu bir partnerin tezgâhına geri
  // koyardı; SQL tarafındaki notRefundedGuard() ikinci savunma hattıdır.
  if (o.paymentStatus === "refunded") return "refunded";
  if (!hasAssignableStatus(o)) return "not_eligible";
  if (!isUnassigned(o)) return "not_eligible";
  return null;
}

/**
 * Tam kural: satır kapısı + basılabilir içerik. Üreticiye gidecek bir şeyi
 * olmayan sipariş (model yok, katalog ürünü yok) atanmaz — sahibin kararı:
 * elle yazılan sipariş, modeli yüklenene kadar `awaiting_model`'da bekler.
 */
export function autoAssignSkipReason(
  o: AutoAssignOrderShape,
  ctx: { flagEnabled: boolean; hasPrintableContent: boolean }
): AutoAssignRowSkip | null {
  const gate = autoAssignRowGate(o, ctx.flagEnabled);
  if (gate) return gate;
  return ctx.hasPrintableContent ? null : "not_eligible";
}

/**
 * Otomatik atamanın KİME bakacağı. Üç cevaptan biri:
 *
 *  - `seller`: sipariş bir satıcının KENDİ katalog ürünü (`sellerManufacturerId`
 *    dolu). Böyle bir iş sıralamaya girmez — pazaryeri ürününün dosyaları
 *    satıcıya aittir ve rakip bir atölyeye otomatik verilmesi, satıcının ürünü
 *    rakibine bastırmak olurdu. Yalnız satıcının kendi atölyesine atanır.
 *  - `skip`: satıcının ürünü, ama kendi atölyesine de verilemiyor (atama az
 *    önce ondan geri alındı ya da siparişi daha önce reddetti). Otomatik atama
 *    burada DURUR; kararı admin verir.
 *  - `rank`: sahipsiz iş, sıralayıcı seçer. `excluded`, sıralayıcının kendi
 *    reddedenler listesinden AYRI bir dışlamadır: bir atama geri alındığında
 *    kara liste işaretlenmemiş olsa bile sipariş aynı atölyeye saniyeler içinde
 *    geri dönmemelidir.
 *
 * Saf tutulur (DB yok) çünkü kural hem rota hem worker hem test tarafında aynı
 * cümleyi söylemek zorunda.
 */
export type AutoAssignPlacementPlan =
  | { kind: "seller"; manufacturerId: string }
  | { kind: "skip" }
  | { kind: "rank"; excluded: string[] };

export function autoAssignPlacementPlan(o: {
  sellerManufacturerId: string | null;
  declinedManufacturerIds: readonly string[];
  excludeManufacturerIds: readonly string[];
}): AutoAssignPlacementPlan {
  const excluded = o.excludeManufacturerIds.filter((id) => !!id);
  if (o.sellerManufacturerId) {
    const blocked =
      excluded.includes(o.sellerManufacturerId) ||
      o.declinedManufacturerIds.includes(o.sellerManufacturerId);
    return blocked
      ? { kind: "skip" }
      : { kind: "seller", manufacturerId: o.sellerManufacturerId };
  }
  return { kind: "rank", excluded };
}

/* ────────────────────────────────────────────────────────────────────────────
 * FAZ 5 YERLEŞTİRME KAPILARI — HANGİ ÖLÇÜ UYGULANIYOR (ranker-rollout = B)
 *
 * Faz 5 yerleştirme kapısına İKİ YENİ KURAL koydu (büyük format sert filtresi ve
 * ağırlıklı kapasite), ama SIRALAYICIDAKİ İKİZLERİ bayrakla KAPALI bırakıldı:
 *   - sıralayıcı: `required = signals.largeFormat ? orderRequirements(...) : []`
 *   - sıralayıcı: `loadValue = signals.weightedLoad ? m.loadUnits : currentLoad`
 *
 * Bu asimetri tek başına ölçülen kusurların neredeyse hepsini üretiyordu: ekran
 * ham iş sayısına göre bir atölye ÖNERİYOR, uç ağırlıklı birime göre REDDEDİYOR;
 * ekran büyük format beyanı olmayan atölyeyi öneriyor, uç onu KALICI olarak
 * reddediyordu. Hiçbir ekran bu reddi önceden söyleyemiyordu.
 *
 * ÇÖZÜM, beş ekranı yeni ölçüye taşımak DEĞİL: iki kapıyı da İKİZLERİYLE AYNI
 * anahtara bağlamak. Bayrak kapalıyken (bugünkü hâl) yerleştirme Faz 5
 * ÖNCESİYLE BİT-BİT AYNIDIR, yani "ekran ile uç birbirini yalanlar" durumu
 * ihtimal olmaktan çıkar — ekran kovalayarak değil, YAPISI GEREĞİ. Bayraklar
 * ikizleriyle BİRLİKTE açılır; o gün ekran ve uç aynı ölçüye aynı anda geçer.
 *
 * SAF ve BURADA, çünkü kararı üç ayrı çalışma ortamı vermek zorunda: atama
 * kapısı (Next rotaları), BullMQ worker'ı ve veritabanısız birim testi.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Yerleştirmenin Faz 5 kapılarından biri tarafından reddedilme sebebi.
 * `AssignFailure` üyeleriyle AYNI dizeler — kapı bunları doğrudan döndürür.
 */
export type PlacementGateRefusal = "large_format_required" | "capacity_full";

/**
 * İKİ KAPININ TEK KARARI. Bayrak kapalıysa kapı YOKTUR.
 *
 * `hasRoom === null` "ölçülmedi" demektir (kapasite sinyali kapalıyken kapı o
 * sorguyu hiç açmaz): ölçülmemiş bir değer ASLA ret sebebi olamaz.
 *
 * SIRA KURALIN KENDİSİDİR — kalıcı uyumsuzluk, geçici doluluktan ÖNCE söylenir:
 * "kapasitesi dolu" cevabı admin'i yarın tekrar denemeye (ve aynı duvara
 * toslamaya) gönderirdi, oysa yetenek eksikse o iş oraya hiçbir zaman gitmez.
 */
export function placementGateRefusal(input: {
  signals: Phase5SignalSet;
  /** `largeFormatPlacementBlocked()` sonucu (saf kural, services/manufacturer-assign). */
  largeFormatBlocked: boolean;
  /** Ağırlıklı kapasite kapısının cevabı; `null` = sinyal kapalı, ölçülmedi. */
  hasRoom: boolean | null;
}): PlacementGateRefusal | null {
  if (input.signals.largeFormat && input.largeFormatBlocked) {
    return "large_format_required";
  }
  if (input.signals.weightedLoad && input.hasRoom === false) {
    return "capacity_full";
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * ATLAMA SEBEBİNİN ÜÇ MUHATABI: sebep, sonraki adım, atama bekleniyor mu
 *
 * NEDEN BU DOSYADA: aynı cümleyi İKİ modül kuruyor — otomatik atamanın kendisi
 * (services/order-confirm.ts, admin notu + e-posta) ve SLA süpürmesi
 * (queue/workers/manufacturer-accept-sla.worker.ts, toplu e-posta + üretici
 * bildirimi). Süpürme order-confirm'i import ediyor, yani ters yönde bir import
 * DÖNGÜ kurardı; tablolar worker'da kalsaydı order-confirm kendi kopyasını
 * yazmak zorunda kalırdı ve iki kopya ilk düzeltmede ayrışırdı.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Sebebin admin'e söylenen hâli. Cümle DEĞİL, cümlenin içine giren bir ibare:
 * çağıranlar bunu "Otomatik atama yapılamadı: <ibare>." gibi kurar.
 */
export const AUTO_ASSIGN_SKIP_REASON_TR: Record<AutoAssignSkip, string> = {
  flag_off: "bu sipariş türünün otomatik atama anahtarı kapalı",
  not_eligible:
    "sipariş artık atanabilir durumda değil (bu sırada başkası almış, durumu değişmiş ya da basılacak içeriği yok)",
  no_candidate: "uygun üretici kalmadı",
  refunded: "sipariş iade edilmiş",
  workshop: "atölye seansı siparişi otomatik atanmaz",
  // Faz 5 — GERÇEĞİ söyleyen iki cümle. Eskiden ikisi de `not_eligible`e
  // çöküyordu ve admin'e "sipariş artık atanabilir durumda değil" deniyordu:
  // sipariş ATANABİLİR durumdaydı, yalnız seçilen atölye alamıyordu.
  capacity_full:
    "sıralamanın seçtiği atölyenin tezgâhı dolu; sipariş yerleştirilemedi ve atanmamış bekliyor",
  large_format_required:
    "sıralamanın seçtiği atölye büyük format baskı yapabildiğini beyan etmemiş; sipariş atanmamış bekliyor",
};

/**
 * Admin'e "BUNDAN SONRA NE OLACAK" cümlesi — SEBEBE göre.
 *
 * Sebep ne olursa olsun "elle üretici atayın" yazmak, atama BEKLENMEYEN
 * siparişlerde (iade, bu sırada başkasına atanmış) admin'i yapılmaması gereken
 * bir işe çağırır ve gerçekten atama bekleyen kayıtları aynı cümlenin
 * gürültüsünde eşitlerdi.
 */
export const AUTO_ASSIGN_SKIP_NEXT_STEP_TR: Record<AutoAssignSkip, string> = {
  flag_off:
    "Sipariş üretici bekliyor: /admin/orders üzerinden elle atayabilirsiniz (türün otomatik atama anahtarı açılırsa sıradaki atölyeye kendiliğinden de yerleşir).",
  not_eligible:
    "Siparişin durumu değişmiş olabilir: önce sipariş sayfasını açıp güncel hâline bakın, gerekiyorsa elle atayın.",
  no_candidate:
    "Sipariş üretici bekliyor: /admin/orders üzerinden elle atayın ya da /admin/manufacturers üzerinden kapasite ve etki alanı ayarlarını gözden geçirin.",
  refunded:
    "Sipariş iade edilmiş: üretici atanmayacak, bu sipariş için işlem gerekmiyor.",
  workshop:
    "Atölye seansı siparişi otomatik atanmaz: üreticiyi seans ekranından onaylayın.",
  capacity_full:
    "Sipariş üretici bekliyor: /admin/orders üzerinden tezgâhı müsait başka bir atölyeye elle atayın ya da /admin/manufacturers üzerinden atölyenin kapasite sınırını gözden geçirin.",
  large_format_required:
    "Sipariş üretici bekliyor: büyük format baskı yapabilen bir atölyeye elle atayın ya da /admin/manufacturers üzerinden atölyenin yetenek beyanını düzeltin.",
};

/**
 * Bu siparişte gerçekten bir ATAMA bekleniyor mu?
 *
 * Toplu e-postanın konusu ve giriş cümlesi buna bakar: "atama için yönetici
 * kararı bekliyor" diyen bir başlık, atanmayacak siparişler için gelen
 * kutusunda YANLIŞ bir iş listesi kurardı — satırın kendisi doğruyu söylerken.
 *
 * Record (fonksiyon içi `if` zinciri DEĞİL): yeni bir sebep eklendiğinde cevabı
 * unutmak DERLEME hatasıdır. Eski `if` hâli yeni üyeleri sessizce `true`ya
 * düşürüyordu — bu iki yeni sebepte doğru cevap zaten `true`, ama bir sonraki
 * sebepte sessiz varsayılan yanlış tarafa düşebilirdi.
 */
export const AUTO_ASSIGN_ASSIGNMENT_EXPECTED: Record<AutoAssignSkip, boolean> = {
  flag_off: true,
  // Çoğunlukla "bu sırada başkası aldı": iş bir atölyededir, admin'den bir
  // atama beklenmez.
  not_eligible: false,
  no_candidate: true,
  refunded: false,
  workshop: true,
  // Faz 5: SİPARİŞ ATANMAMIŞ KALDI. Admin gerçekten bir atama yapmalı — bu
  // satırın `false` olması, işin kaybolduğu ve kimsenin beklemediği hâlin ta
  // kendisiydi.
  capacity_full: true,
  large_format_required: true,
};

/**
 * Otomatik atama bu sebepte KENDİ admin notunu ve e-postasını yazar mı?
 *
 * SLA süpürmesi bunu bilmek zorunda: kendi toplu e-postasında "bu sipariş için
 * ayrıca bir e-posta daha aldınız" diyebilmesi gerekiyor, yoksa admin ikinci
 * postayı ayrı bir olay sanar.
 */
export const AUTO_ASSIGN_SKIP_NOTIFIES_ADMIN: Record<AutoAssignSkip, boolean> = {
  flag_off: false,
  not_eligible: false,
  no_candidate: true,
  refunded: false,
  workshop: false,
  // Sipariş atanmamış kaldı ve sebebi geçici/kalıcı bir YERLEŞTİRME engeli:
  // admin'in bunu duyması gerekir.
  capacity_full: true,
  large_format_required: true,
};

// ─── Otomatik BOYACI ataması: kapı ve ret üst sınırı (Faz 4) ────────────────
//
// Üretici ikizinin yanında durur ve aynı sebeple SAF tutulur: kural rotada
// (admin QC onayı), boyacı ret yolunda, SLA süpürmesinde ve testte AYNI cümleyi
// söylemek zorunda; hiçbiri diğerinin çalışma ortamını paylaşmıyor. DB'ye bağlı
// olsaydı veritabanı olmadan sınanamazdı.

/**
 * Otomatik boyacı atamasının yapılmama sebebi. KAPALI KÜME — P4-C2 sözleşmesi.
 *
 * `not_needed` bilerek iki hâli birden taşır: siparişte boyama kalemi yok, ya da
 * baskı henüz üretici QC'sinden geçmedi. İkisinde de "şu anda devredilecek bir
 * iş yok" doğrudur ve sözleşmenin kümesi genişletilemez.
 */
export type PainterAssignSkip =
  | "flag_off"
  | "not_needed"
  | "paints_in_house"
  | "already_assigned"
  | "refunded"
  | "no_candidate";

/** Otomatik boyacı atamasının okuduğu alanlar (DB'ye bağlı değil). */
export interface PainterAssignOrderShape {
  paymentStatus: string | null;
  needsPainting: boolean;
  /** Üreticinin sipariş üstündeki alt durumu; devir yalnız `qc_approved`da açılır. */
  manufacturerStatus: string | null;
  painterId: string | null;
  painterStatus: string | null;
  /** Siparişin üreticisi boyamayı KENDİ atölyesinde yapıyor mu. */
  manufacturerPaintsInHouse: boolean;
}

/**
 * Sipariş satırından karar verilebilen kapı. Aday sıralaması BURADA YOKTUR
 * (DB ister): çağıran önce bunu çalıştırır, `null` dönerse sıralamaya gider —
 * böylece elenecek bir sipariş için boşuna sorgu atılmaz.
 *
 * SIRA KURALIN KENDİSİDİR, çünkü admin'e ve kayda yazılan sebep bu sıradan
 * çıkar — ve sebep YANLIŞSA gerçek arıza gürültüye gömülür. Ölçülen kusur tam
 * buydu: anahtar EN BAŞTA sorulduğu için, boyacı hiç İSTEMEYEN bir siparişin
 * (needs_painting=false) QC onayı bile admin'e "otomatik boyacı atama anahtarı
 * kapalı… elle boyacı atayın" alarmı yazıyordu. Boyamasız her sipariş için
 * yanlış alarm demekti bu; gerçek arıza da o gürültünün altında kalırdı.
 *
 * Bu yüzden önce "bu sipariş zaten bir boyacı İSTEMİYOR" soruları sorulur
 * (iade → boyama yok → üretici kendi boyuyor → zaten bir boyacıda → baskı
 * henüz hazır değil), anahtar EN SON gelir. Böylece `flag_off` yalnız gerçekten
 * boyacıya gidecek bir sipariş durdurulduğunda yazılır — ve orada alarm
 * DOĞRUDUR: baskı üreticide öksüz bekliyordur (painterUnplacedNeedsAdmin onu
 * bilerek insana çıkarır).
 */
export function painterAssignRowGate(
  o: PainterAssignOrderShape,
  flagEnabled: boolean
): Exclude<PainterAssignSkip, "no_candidate"> | null {
  // İade kararı (refund-end-state): iade edilmiş sipariş durumunu KORUR, yani
  // üreticisi QC'den geçmiş bir sipariş tam olarak devredilebilir görünür.
  // Buradaki kontrol olmadan otomatik atama onu bir boyacının tezgâhına
  // koyardı; SQL tarafındaki notRefundedGuard() ikinci savunma hattıdır.
  if (o.paymentStatus === "refunded") return "refunded";
  if (!o.needsPainting) return "not_needed";
  // Üretici kendi boyuyorsa boyacı ataması YAPILMAZ (sahibin kararı). Boyama
  // payı da onun hakedişinde kalır (earning-base.ts · manufacturerBaseKurus).
  if (o.manufacturerPaintsInHouse) return "paints_in_house";
  if (o.painterId) return "already_assigned";
  if (o.painterStatus && o.painterStatus !== "unassigned") return "already_assigned";
  // Boyacıya giden şey FİZİKSEL baskıdır: QC onayından önce ortada devredilecek
  // bir parça yoktur.
  if (o.manufacturerStatus !== "qc_approved") return "not_needed";
  // ANAHTAR EN SON: buraya ulaşan sipariş, anahtar açık olsaydı GERÇEKTEN bir
  // boyacıya gidecek olandır. "Kapalı" cevabı ancak burada doğrudur.
  if (!flagEnabled) return "flag_off";
  return null;
}

/**
 * Bir ret (ya da 24 saatlik sessizlik) sonrası sipariş EN FAZLA kaç kez yeniden
 * bir boyacıya yerleştirilir.
 *
 * SAHİBİN CÜMLESİ ÖLÇÜDÜR: "bir ret üç kez yeniden seçer, sonra admin kuyruğuna
 * gider". Ölçülen davranış bunun bir eksiğiydi — ret #1 ve #2 yeniden
 * yerleştiriliyor, #3 doğrudan admin kuyruğuna düşüyordu — çünkü sayaç REDLERİ
 * sayıyor ve İŞLENMEKTE OLAN ret de sayıya dâhil: ilk yerleştirme bir "yeniden
 * seçim" değildir, ama sayaçta ondan ayrılmıyordu.
 *
 * Kural bu yüzden YENİDEN YERLEŞTİRME sayısıyla yazılır; ret üst sınırı ondan
 * TÜRETİLİR. İki sayı birbirinden bağımsız yazılsaydı, birini değiştiren
 * diğerini sessizce yalanlardı.
 *
 * Cevapsız bırakılan iş de bu sayıya girer — sahibin kararı: ceza yazılmaz ama
 * deneme sayılır, yoksa cevap vermeyen boyacılar siparişi sonsuza kadar
 * dolaştırırdı.
 *
 * NOT: üretici ikizi (MAX_DECLINES_BEFORE_ADMIN = 3 ret) bir eksik dener; ayrım
 * bilinçlidir, boyacı tarafının sınırını sahibin yukarıdaki cümlesi belirler.
 */
export const PAINTER_MAX_REPLACEMENTS = 3;

/**
 * Kaçıncı retten sonra artık hiç denenmez. TÜRETİLMİŞTİR: ilk yerleştirme bir
 * yeniden seçim olmadığı için üç yeniden seçim ancak DÖRDÜNCÜ rette tükenir.
 */
export const PAINTER_MAX_DECLINES = PAINTER_MAX_REPLACEMENTS + 1;

/** Ret/cevapsızlık sayısı üst sınıra ulaştı mı (artık admin kuyruğu)? */
export function painterDeclinesExhausted(declinedCount: number): boolean {
  return declinedCount >= PAINTER_MAX_DECLINES;
}

/**
 * Atlama sebebinin Türkçe karşılığı — CÜMLE İÇİNDE kullanılacak kısa parça
 * ("Boyacı atanmadı: <parça>.").
 *
 * `Record<PainterAssignSkip, string>` olarak yazılır: kümeye yeni bir sebep
 * eklendiği gün karşılığını yazmayı unutmak DERLEME hatası verir — admin'in
 * notuna düşen bir "undefined" değil.
 */
export const PAINTER_ASSIGN_SKIP_LABELS_TR: Record<PainterAssignSkip, string> = {
  flag_off: "otomatik boyacı atama anahtarı kapalı",
  not_needed: "siparişte boyama yok ya da baskı henüz QC'den geçmedi",
  paints_in_house: "üretici boyamayı kendi yapıyor",
  already_assigned: "sipariş bu sırada başka bir boyacıya atandı",
  refunded: "sipariş iade edilmiş",
  no_candidate: "uygun boyacı kalmadı",
};

/**
 * Kapalı kümeye GİRMEYEN sonuçlar.
 *
 * `PainterAssignSkip` "kural baktı ve yerleştirmedi" demektir; bu ikisi ise
 * kuralın hiç çalışamadığı ya da çalışmasının YASAK olduğu hâllerdir:
 *
 *  - `unexpected_error`: yerleştirme beklenmeyen bir hatayla durdu. Kapalı
 *    kümeye sokulamaz, çünkü küme sözleşmedir (P4-C2) ve "arıza" bir atlama
 *    sebebi değildir; ama CEVAPSIZ da bırakılamaz — ölçülen kusur tam olarak
 *    buydu: hata yutuluyor, sipariş boyacısız kalıyor ve kimse duymuyordu.
 *  - `parcel_in_transit`: baskı, işi bırakan boyacıya ÇOKTAN yola çıkmış. Yeni
 *    bir boyacı yazmak, fiziksel paketi öksüz bırakırdı; kararı admin verir.
 *
 * NOT (sahibine): `parcel_in_transit` gerçek bir yerleştirme kuralıdır ve
 * doğru yeri `PainterAssignSkip`tir. Kümeye eklemek SLA süpürmesindeki
 * `Record<PainterAssignSkip, string>` sözlüğünü de aynı anda güncellemeyi
 * gerektirdiği için (başka bir dosyanın sahibi) burada ayrı tutuldu.
 */
export type PainterAssignFailure = "unexpected_error" | "parcel_in_transit";

export const PAINTER_ASSIGN_FAILURE_LABELS_TR: Record<PainterAssignFailure, string> = {
  unexpected_error: "beklenmeyen bir hata nedeniyle yerleştirme yapılamadı",
  parcel_in_transit:
    "baskı, işi bırakan boyacıya çoktan gönderilmiş (kargo kaydı var); paket yoldayken iş otomatik devredilmez",
};

/** Yerleştirmenin sonucu: ya kapalı kümeden bir atlama, ya bir arıza. */
export type PainterAssignOutcomeReason = PainterAssignSkip | PainterAssignFailure;

/** Sebep kapalı kümeden mi geliyor? (Sözlük TEK kaynaktır; ikinci liste tutulmaz.) */
export function isPainterAssignSkip(value: unknown): value is PainterAssignSkip {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PAINTER_ASSIGN_SKIP_LABELS_TR, value)
  );
}

/** Her sebebin Türkçesi; sözlükte olmayan bir değer bile boş cümle bırakmaz. */
export function painterAssignReasonTr(reason: PainterAssignOutcomeReason): string {
  if (isPainterAssignSkip(reason)) return PAINTER_ASSIGN_SKIP_LABELS_TR[reason];
  return PAINTER_ASSIGN_FAILURE_LABELS_TR[reason] ?? "sebep bilinmiyor";
}

/**
 * Boyacısız kalan siparişi bir İNSANIN görmesi gerekiyor mu?
 *
 * Ölçülen kusur: yerleştirme yapılmadığında yalnız `no_candidate` dalı admin'e
 * not+e-posta yazıyordu. `flag_off` ve `paints_in_house` sessizce dönüyor,
 * baskı üreticide, sipariş boyacısız ve kimsenin haberi olmadan bekliyordu.
 *
 * Cevap BAĞLAMA bağlıdır ve tek ayrım şudur: siparişten AZ ÖNCE bir boyacı
 * koparıldı mı?
 *
 *  - Koparıldıysa (ret / 24 saat sessizlik) ortada sahibi belirsiz kalmış
 *    FİZİKSEL bir baskı vardır; sebep ne olursa olsun bir insan bakmalıdır.
 *  - Koparılmadıysa (QC onayı) boyamasız sipariş ya da kendi boyayan üretici
 *    OLAĞAN akıştır; her QC onayında admin'e e-posta atmak, gerçek arızayı
 *    gürültüye gömerdi. Burada yalnız "boyacıya gitmesi GEREKEN ama gidemeyen"
 *    hâller insana çıkar.
 *
 * `already_assigned` iki bağlamda da sessizdir: iş ZATEN bir boyacıdadır.
 */
export function painterUnplacedNeedsAdmin(
  reason: PainterAssignOutcomeReason,
  ctx: { painterDetached: boolean }
): boolean {
  if (reason === "already_assigned") return false;
  if (ctx.painterDetached) return true;
  return (
    reason === "flag_off" ||
    reason === "no_candidate" ||
    reason === "unexpected_error" ||
    reason === "parcel_in_transit"
  );
}

/** Paketin yolda olup olmadığını söyleyen sipariş alanları. */
export interface PainterParcelShape {
  painterHandoffTrackingNumber: string | null;
  receivedByPainterAt: Date | null;
}

/**
 * Baz baskı boyacıya ulaştı ya da ona doğru yola çıktı mı?
 *
 * SLA süpürmesinin kuralıyla AYNI cümle (painter-accept-sla.worker.ts ·
 * `parcelOnTheWay`): iki ölçü ayrışırsa aynı sipariş bir yolda taşınır,
 * diğerinde taşınmaz.
 *
 * Kargo FİRMASI bilerek kanıt sayılmaz: firma panelde paket çıkmadan da
 * seçilebilir. Takip numarası ise ancak paket kargoya verildiğinde doğar.
 */
export function painterParcelOnTheWay(o: PainterParcelShape): boolean {
  if (o.receivedByPainterAt) return true;
  return (o.painterHandoffTrackingNumber ?? "").trim().length > 0;
}

// ─── Üretici kabul SLA'sı: yanıtsız atama, üst sınır ve yola çıkmışlık (Faz 5) ─
//
// Boyacı bölümünün yanında ve aynı sebeple SAF durur: kural süpürmede, admin
// ekranında ve testte AYNI cümleyi söylemek zorunda; hiçbiri diğerinin çalışma
// ortamını paylaşmıyor.

/**
 * Bir ret (ya da 24 saatlik sessizlik) sonrası sipariş EN FAZLA kaç RET
 * biriktirince artık hiç denenmez ve admin kuyruğuna düşer.
 *
 * DEĞER BUGÜNKÜ DAVRANIŞTIR, yeni bir karar değil: ret yolunun kendi özel
 * sabiti (services/manufacturer-decline.ts · MAX_DECLINES_BEFORE_ADMIN = 3)
 * yıllardır bu sayıyı uyguluyor. Buraya taşınmasının sebebi, SLA süpürmesinin
 * de aynı sayaca yazması: cevapsız bırakılan iş de bu sayıya girer (sahibin
 * kararı — ceza yazılmaz ama deneme sayılır, yoksa cevap vermeyen atölyeler
 * siparişi sonsuza kadar dolaştırırdı).
 *
 * İKİ KOPYA ŞU AN VAR ve bu bilinçli bir geçiş hâlidir: ret yolu başka bir
 * fixer'ın dosyası olduğu için import'u bu fazda değiştirilemedi.
 * `scripts/test-manufacturer-sla.ts` iki sayının EŞİT kaldığını her koşuda
 * doğrular — biri değişirse test düşer, yani kopya sessizce ayrışamaz.
 *
 * NOT: boyacı ikizi (PAINTER_MAX_REPLACEMENTS = 3 yeniden yerleştirme, yani
 * DÖRDÜNCÜ rette tükenir) bir fazla dener; ayrım bilinçlidir ve iki tarafın
 * sınırını kendi sözleşmeleri belirler.
 */
export const MANUFACTURER_MAX_DECLINES = 3;

/**
 * Sipariş en fazla kaç kez YENİDEN yerleştirilir. TÜRETİLMİŞTİR: ilk
 * yerleştirme bir "yeniden seçim" değildir, o yüzden üst sınırın bir eksiğidir.
 * İki sayı birbirinden bağımsız yazılsaydı, birini değiştiren diğerini sessizce
 * yalanlardı (boyacı tarafında ölçülen kusur tam buydu).
 */
export const MANUFACTURER_MAX_REPLACEMENTS = MANUFACTURER_MAX_DECLINES - 1;

/** Ret/cevapsızlık sayısı üst sınıra ulaştı mı (artık admin kuyruğu)? */
export function manufacturerDeclinesExhausted(declinedCount: number): boolean {
  return declinedCount >= MANUFACTURER_MAX_DECLINES;
}

/**
 * 24 saat yanıtsız kalan atamanın `manufacturer_actions` günlüğündeki adı.
 *
 * SIRALAYICININ PUAN KÜMELERİNİN DIŞINDADIR ve öyle kalmalıdır: ne GOOD_ACTIONS
 * ne BAD_ACTIONS (services/manufacturer-assignment.ts) bu dizeyi tanır, yani
 * satır güvenilirlik puanını DEĞİŞTİRMEZ. Sahibin kararı yanıtsızlığa ceza
 * yasaklıyor (sla-no-answer = C) ve bu satır yalnız "ne olduğunu" açıklayan bir
 * denetim kaydıdır.
 *
 * Boyacı ikizinden (PAINTER_SLA_TIMEOUT_ACTION) ayrılan nokta budur: orada
 * sinyal sıralayıcının olumsuz kümesinde SAYILIYOR. Burada saymak, partner
 * gelirini canlıda kaydıran bir sıralama değişikliği olurdu; bu fazın kuralı
 * (ranker-rollout = B) yeni sinyalin önce GÖLGEDE koşmasını şart koşuyor. Yani
 * bu dizeyi BAD_ACTIONS'a eklemek tek başına yapılacak bir iş değildir: gölge
 * şeridinden geçmesi gerekir.
 */
export const MANUFACTURER_SLA_TIMEOUT_ACTION = "sla_timeout";

/** İşin fiziksel olarak yola çıkıp çıkmadığını söyleyen sipariş alanları. */
export interface ManufacturerJobShape {
  /** Müşteriye sevk damgası. */
  shippedAt: Date | null;
  /** Müşteri kargosunun takip numarası. */
  trackingNumber: string | null;
  /** Baskının boyacıya devredildiği an. */
  sentToPainterAt: Date | null;
  /** Boyacıya giden kolinin takip numarası. */
  painterHandoffTrackingNumber: string | null;
}

/**
 * İş üreticinin elinden ÇIKTI mı (kargoya verildi ya da boyacıya devredildi)?
 *
 * Yanıtsız bir atamanın taşınmasını engelleyen ölçü. Boyacı tarafındaki
 * `painterParcelOnTheWay` ile aynı gerekçe: ortada FİZİKSEL bir parça varsa işi
 * başka bir atölyeye yazmak o parçayı öksüz bırakır — kararı admin verir.
 *
 * Kargo FİRMASI bilerek kanıt sayılmaz (panelde paket çıkmadan da seçilebilir);
 * takip numarası ve damgalar ancak iş gerçekten hareket ettiğinde doğar.
 */
export function manufacturerJobInTransit(o: ManufacturerJobShape): boolean {
  if (o.shippedAt || o.sentToPainterAt) return true;
  if ((o.trackingNumber ?? "").trim().length > 0) return true;
  return (o.painterHandoffTrackingNumber ?? "").trim().length > 0;
}
