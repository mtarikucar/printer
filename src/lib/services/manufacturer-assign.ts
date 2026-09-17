import { and, eq, isNull, ne, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adminActions,
  generationAttempts,
  manufacturers,
  orderItems,
  orders,
} from "@/lib/db/schema";
import {
  autoAssignPlacementPlan,
  placementGateRefusal,
  type AutoAssignSkip,
} from "@/lib/config/flags";
// Kapının hangi ölçüyü UYGULAYACAĞINI belirleyen küme. Sıralayıcı da aynı
// fonksiyondan okur (`signalsForProfile`), yani ekran ile uç aynı anahtara
// bağlıdır — Faz 5'in ölçülen kusuru tam olarak ikisinin ayrı olmasıydı.
import { signalsForProfile, type Phase5SignalSet } from "@/lib/config/scoring";
import {
  LARGE_FORMAT_MIN_MM,
  capabilityMatch,
  orderRequirements,
} from "@/lib/services/capability";
import {
  MANUFACTURER_CAPACITY_FULL_ERROR,
  manufacturerCapacityGate,
} from "@/lib/services/manufacturer-capacity";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import {
  REFUNDED_PAYMENT_STATUS,
  isRefunded,
} from "@/lib/config/order-status-policy";

/**
 * The one place an order is handed to a manufacturer.
 *
 * The "guarded update → audit row → notify → emit" sequence used to be written
 * out three times (the admin assign route, the N12 decline reassignment, and
 * now automatic assignment for platform products). Three copies meant three
 * chances for one of them to forget the concurrency guard or the SSE emit.
 */

/**
 * Statuses from which an order may be handed to a manufacturer:
 * custom/upload orders after admin approval, and marketplace orders straight
 * from payment — a platform-owned product is born `paid` + unassigned, so
 * without this it could never be assigned at all.
 */
export function assignableStatusGuard(): SQL {
  return or(
    eq(orders.status, "approved"),
    and(eq(orders.status, "paid"), eq(orders.orderType, "marketplace"))
  )!;
}

/**
 * The refund guard every forward action puts INSIDE its atomic UPDATE: the SQL
 * twin of `!isRefunded(order)` (order-status-policy.ts). In the write, not in a
 * pre-read, so a refund landing between a route's read and its write still
 * wins.
 *
 * "Not refunded", deliberately not "payment succeeded": the rule stops exactly
 * the refunded orders. Manual, havale, zero-amount and workshop orders may sit
 * at another payment status and must keep moving; a 'succeeded' requirement
 * would silently freeze them the day such a status exists.
 *
 * It lives here, beside assignableStatusGuard(), because assignment is the
 * forward action every path funnels through and this module is already safe to
 * load in the BullMQ worker; order-status-policy.ts is pure and holds no SQL.
 */
export function notRefundedGuard(): SQL {
  return ne(orders.paymentStatus, REFUNDED_PAYMENT_STATUS);
}

/**
 * After a guarded UPDATE matched no row: was a refund the reason? Lets a route
 * answer 409 REFUNDED_ORDER_ERROR instead of a status error that sends the
 * admin looking for a problem that is not there.
 */
export async function isOrderRefunded(orderId: string): Promise<boolean> {
  const row = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { paymentStatus: true },
  });
  return !!row && isRefunded(row);
}

/**
 * Does this order have anything a manufacturer could actually produce?
 *
 * An order with nothing to print must never reach a partner — that is exactly
 * how an assigned order ended up showing someone an empty screen. Printable
 * content = a FILE or a PRODUCT: an uploaded model, the order's own model
 * columns, a legacy generated model, or a marketplace product (its own or per
 * line item).
 *
 * Written line items (`selectedAddons`) used to count too, and that was the
 * bug: an admin typing "Özel figür ×1 · ₺3.500" produced a printable-looking
 * order with no mesh anywhere, so it was handed to a manufacturer who opened
 * it and found a price and nothing to print. A description is a price
 * agreement, not a print job — the owner's rule (manual-orders-without-model)
 * is that such an order waits at `awaiting_model` until the model lands, and
 * the admin upload-model route places it the moment it does.
 *
 * Also the discriminator that keeps `kickOffMarketplaceOrder` honest: a
 * platform catalogue product has a productId, an admin-typed WhatsApp order
 * does not, so the latter still routes to `awaiting_model`.
 */
export async function orderHasPrintableContent(orderId: string): Promise<boolean> {
  const target = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: {
      id: true,
      modelGlbKey: true,
      modelStlKey: true,
      productId: true,
      uploadedModelId: true,
    },
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { id: true },
        limit: 1,
      },
    },
  });
  if (!target) return false;
  if (
    target.modelGlbKey ||
    target.modelStlKey ||
    target.productId ||
    target.uploadedModelId ||
    target.generationAttempts.length > 0
  ) {
    return true;
  }
  // Cart sub-orders carry their products per line (there is no orders→items
  // relation), so check that table directly.
  const lineProducts = await db
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return lineProducts.some((i) => !!i.productId);
}

export type AssignFailure =
  | "manufacturer_unavailable"
  | "no_printable_content"
  | "not_assignable"
  // Atölyenin tezgâhı AĞIRLIKLI ölçüyle dolu (capacity-unit karari = C). Ayrı
  // bir üye, çünkü bu GEÇİCİ bir durumdur: aynı istek yarın çalışır, oysa
  // `not_assignable` "bu sipariş artık bu aşamada değil" demektir ve admin'i
  // bambaşka bir yere bakmaya gönderir.
  | "capacity_full"
  // İş büyük format ister, atölye bunu beyan etmemiş. Kalıcı bir uyumsuzluk:
  // tekrar denemek asla işe yaramaz, atölyenin yeteneği değişmeli.
  | "large_format_required"
  // Satıcının kendi katalog ürünü, hedef atölye o satıcı DEĞİL. Ayrı bir üye,
  // çünkü admin'e söylenecek şey "atanamaz" değil "bu işi yalnız sahibi
  // basabilir"dir ve bu cevap bir yarış kaybı gibi tekrar denenmemelidir.
  | "seller_owned";

/**
 * Admin-facing Turkish copy per failure, shared by the single and the bulk
 * assign routes so both say the same thing. Typed on AssignFailure, so a new
 * reason is a compile error there rather than an undefined entry at runtime.
 * `not_assignable` names the refund because a refunded order fails with it
 * (see notRefundedGuard); the old English text sent the admin looking for a
 * status problem.
 */
export const ASSIGN_FAILURE_MESSAGES: Record<AssignFailure, string> = {
  manufacturer_unavailable: "Üretici bulunamadı ya da aktif değil.",
  no_printable_content:
    "Bu siparişte üreticiye gönderilecek basılabilir içerik yok (model dosyası ya da katalog ürünü). Yazılı kalemler tek başına yetmez: önce 3D modeli yükleyin.",
  not_assignable:
    "Sipariş atanamaz: bulunamadı, onaylı değil, zaten atanmış ya da iade edilmiş.",
  // Cümle BURADA YAZILMAZ, kapasite modülünden okunur: aynı kuralın iki sesi
  // olursa operatör "bu aynı kural mı?" diye tahmin etmek zorunda kalır.
  capacity_full: MANUFACTURER_CAPACITY_FULL_ERROR,
  // GERÇEK sebebi adıyla söyler: hangi ölçü, hangi eksik beyan. "Atanamaz"
  // demek, admin'i siparişin durumunda olmayan bir sorunu aramaya gönderirdi.
  large_format_required:
    `Seçilen atölye büyük format baskı yapabildiğini beyan etmemiş: bu siparişin figür boyu ${LARGE_FORMAT_MIN_MM} mm ve üzeri. ` +
    `Bu iş yalnız "large_format" yeteneğini beyan eden bir atölyeye atanabilir.`,
  // Çağıranın elinde satıcının ADI varsa (AssignResult bunu geri veriyor) daha
  // iyi bir cümle kurabilir; bu, adı çözülemediğinde de doğru kalan hâlidir.
  seller_owned:
    "Bu sipariş bir satıcının kendi kataloğundan çıktı: yalnız o atölyeye atanabilir, başka bir atölyeye verilemez.",
};

/* ────────────────────────────────────────────────────────────────────────────
 * BÜYÜK FORMAT: SERT FİLTRE (Faz 5)
 *
 * Sahibin kararı: 120 mm'yi (LARGE_FORMAT_MIN_MM) aşan bir iş, YALNIZ büyük
 * format basabildiğini BEYAN EDEN atölyeye gidebilir. Yetenek bugün tanımlı
 * (`services/capability.ts`) ve hiçbir yerde KONTROL EDİLMİYOR: `orderRequirements`
 * "large_format" istiyor, sıralayıcı yalnız MALZEMEYİ sert filtre olarak
 * uyguluyor, atama kapısı ise hiçbirine bakmıyordu.
 *
 * Kural BURADA YENİDEN YAZILMAZ: hangi işin büyük format istediğini
 * `orderRequirements`, beyanın yeterli olup olmadığını `capabilityMatch`
 * söyler. İkisi de saf ve test edilmiş (scripts/test-capability.ts); burada
 * yalnız İKİSİ BİRLEŞTİRİLİR.
 *
 * ── "DEĞERLENDİRİLMEMİŞ ATÖLYE" İSTİSNASI ve NEDEN ZORUNLU ───────────────────
 * Bugün `large_format` etiketini HİÇBİR yüzey yazamıyor: kayıt formu yalnız
 * malzeme soruyor, admin düzenleyicisi ve partnerin kendi profili de yalnız
 * `material_*` etiketlerine dokunuyor (ikisi de diğer "yönlendirme
 * etiketlerini" bilerek KORUYOR ama YAZAMIYOR). Satılan tek ürün ise 150 mm,
 * yani eşiğin üstünde.
 *
 * Yani istisnasız bir sert filtre, BUGÜN her siparişi her atölyeye kapatırdı:
 * platformda tek bir iş bile atanamaz olurdu (ölçüldü: canlı veritabanındaki üç
 * atölyenin üçü de hiçbir etiket beyan etmemiş). Bu, kuralı uygulamak değil
 * platformu durdurmaktır.
 *
 * Bu yüzden filtre, atölyenin BASKI HACMİ HAKKINDA BİR ŞEY BEYAN ETMİŞ olup
 * olmadığına bakar. `material_*` etiketleri hacim hakkında hiçbir şey söylemez —
 * kayıt formunun ürettiği tek şey odur. Bir atölyenin YÖNLENDİRME etiketi
 * (material_* dışında herhangi bir etiket) varsa, o atölye değerlendirilmiştir
 * ve `large_format` yoksa iş oraya GİTMEZ. Hiç yönlendirme etiketi yoksa atölye
 * henüz değerlendirilmemiştir ve bugünkü davranış korunur.
 *
 * Bu, `manufacturerSupportsMaterial`in yıllardır uyguladığı "beyan yoksa eski
 * atölye kapsam dışı kalmaz" kararının aynısıdır — yeni bir kural değil, aynı
 * kararın hacim eksenine uygulanması.
 *
 * İSTİSNANIN KAPANMASI bu düzelticinin mülkiyetinde DEĞİL: admin düzenleyicisi
 * `large_format` kutusunu yazabildiği gün (bkz. crossOwnerRequest) istisna
 * kendiliğinden daralır ve filtre tam anlamıyla sert olur.
 * ────────────────────────────────────────────────────────────────────────── */

/** Bu iş, bu atölyenin beyan etmediği bir büyük format işi mi? (saf; DB yok) */
export function largeFormatPlacementBlocked(
  figurineSize: string | null | undefined,
  capabilities: string[] | null | undefined
): boolean {
  const needsLargeFormat = orderRequirements({
    figurineSize: figurineSize ?? undefined,
  }).includes("large_format");
  if (!needsLargeFormat) return false;
  if (capabilityMatch(capabilities, ["large_format"])) return false;
  // Değerlendirilmemiş atölye (yalnız malzeme etiketi ya da hiç etiket yok):
  // bugünkü davranış korunur — bkz. yukarıdaki gerekçe.
  const routingTags = (capabilities ?? []).filter(
    (t) => typeof t === "string" && !t.startsWith("material_")
  );
  return routingTags.length > 0;
}

/**
 * Bu YERLEŞTİRMEDE yürürlükte olan sinyaller — sıralayıcının okuduğu KÜMENİN
 * AYNISI (`signalsForProfile("live")`).
 *
 * Kapı env'i KENDİ okumaz: "canlı davranışa yeni bir kural sızdı mı?" sorusunun
 * cevabı tek bir yerde aranmalı (config/scoring.ts). Gölge şeridi kendi
 * kümesini ("shadow") alır ve bugün her iki sinyali de AÇIK görür, yani
 * /admin/assignment-sweep bayraklar açılsa NE OLACAĞINI göstermeye devam eder.
 */
export function placementSignals(): Phase5SignalSet {
  return signalsForProfile("live");
}

/**
 * Her yerleştirme reddinin OTOMATİK ATAMA karşılığı — TEK tablo.
 *
 * `Record<AssignFailure, AutoAssignSkip>`: yeni bir ret sebebi eklendiğinde
 * karşılığını yazmak DERLEME zorunluluğudur. Tablo yokken otomatik atama her
 * reddi tek bir `not_eligible`e çöküyordu; sipariş ATANMAMIŞ kalırken admin'e
 * "işlem gerekmiyor", koparılan atölyeye "iş başkasına gitti" deniyordu.
 *
 * `seller_owned` OTOMATİK yolda ulaşılamaz (satıcının ürünü sıralamaya hiç
 * girmez, kendi atölyesine gider), ama tablo TOTAL olmak zorunda: ulaşılamaz
 * sayılan bir dalın sessizce yanlış cevap vermesi, tam olarak bu fazda
 * düzeltilen kusurdur. Karşılığı `no_candidate`tir — iş atanmamış bekler ve
 * admin'in karar vermesi gerekir.
 */
export const AUTO_ASSIGN_SKIP_FOR_FAILURE: Record<AssignFailure, AutoAssignSkip> = {
  manufacturer_unavailable: "not_eligible",
  no_printable_content: "not_eligible",
  not_assignable: "not_eligible",
  capacity_full: "capacity_full",
  large_format_required: "large_format_required",
  seller_owned: "no_candidate",
};

/**
 * Atamanın NEDEN bu atölyeye düştüğü — denetim satırının ikinci yarısı.
 *
 * "Kim atadı" sorusunun cevabı zaten `adminEmail`de duruyordu; "bu iş buraya
 * nasıl seçildi" sorusununki hiçbir yerde durmuyordu. Eski yedek not bir de
 * İNGİLİZCEYDİ ("Assigned to X") ve Türkçe sipariş geçmişinin tam ortasında
 * öylece duruyordu — tarama yolu onu artık rutin olarak üretiyor.
 *
 * Varsayılan `admin_manual`dır, çünkü gerekçe GÖNDERMEYEN her çağıran (tek
 * atama rotası, toplu atama, geri alma sonrası devir) admin'in ekranda
 * seçtiği atölyeyi yazar. Otomatik yollar kendi üyelerini gönderir.
 */
export type AssignSelectionBasis =
  | "admin_manual"
  | "auto_ranking"
  | "auto_seller"
  | "decline_retry"
  | "sweep_ranking"
  | "sweep_seller"
  | "sweep_screen_confirmed";

/**
 * Gerekçelerin Türkçe karşılığı. `AssignSelectionBasis` üzerine tiplenmiştir:
 * yeni bir gerekçe eklemek, etiketi unutulduğunda DERLEME hatası verir —
 * çalışma anında "undefined" yazan bir denetim notu değil.
 */
export const ASSIGN_SELECTION_BASIS_TR: Record<AssignSelectionBasis, string> = {
  admin_manual: "admin elle seçti",
  auto_ranking: "otomatik atama, sıralama seçti",
  auto_seller: "otomatik atama, ürünün sahibi satıcı atölyesi (sıralama dışı)",
  decline_retry: "önceki üretici reddetti, sıralama yeni atölyeyi seçti",
  sweep_ranking: "atama taraması, sıralamanın önerdiği atölyeyi admin onayladı",
  sweep_seller:
    "atama taraması, ürünün sahibi satıcı atölyesi (sıralama dışı) — admin onayladı",
  sweep_screen_confirmed:
    "atama taraması, aynı onaydaki atamalar sıralamayı değiştirdi; admin'in ekranda onayladığı (hâlâ uygun) atölye kullanıldı",
};

/* ────────────────────────────────────────────────────────────────────────────
 * PAZARYERİ MÜLKİYET KURALI (E-C1)
 *
 * Kural tek cümle: satıcının kendi kataloğundan çıkan sipariş YALNIZ o satıcının
 * atölyesinde basılır. Ürünün dosyaları satıcıya aittir; rakip bir atölyeye
 * bastırmak, satıcının ürününü rakibine vermektir.
 *
 * Kural artık ÇAĞIRAN BAŞINA değil, siparişi üreticiye yazan TEK NOKTADA durur
 * (assignManufacturerToOrder). Rota başına kopyalandığı sürece bir sonraki
 * yazıcı onu unutabiliyordu — nitekim unutuldu da: atamayı geri alıp doğrudan
 * başka bir atölyeye devreden rota kendi UPDATE'ini yazıyor ve hiçbir mülkiyet
 * kontrolü yapmıyordu.
 *
 * Karar BURADA YENİDEN YAZILMAZ; otomatik atamanın saf kuralından okunur
 * (autoAssignPlacementPlan). `declined`/`exclude` listeleri bilerek boş geçilir:
 * onlar "şu an OTOMATİK verme" sinyalleridir, mülkiyetin kendisi değil — admin
 * siparişi satıcının KENDİ atölyesine her zaman verebilmelidir.
 * ────────────────────────────────────────────────────────────────────────── */

/** Bu yerleştirme mülkiyet kuralını çiğner mi? (saf; DB yok) */
export function sellerOwnedPlacementBlocked(
  sellerManufacturerId: string | null,
  targetManufacturerId: string
): boolean {
  const plan = autoAssignPlacementPlan({
    sellerManufacturerId,
    declinedManufacturerIds: [],
    excludeManufacturerIds: [],
  });
  return plan.kind === "seller" && plan.manufacturerId !== targetManufacturerId;
}

/**
 * Aynı kuralın SQL ikizi: "bu siparişin sahibi yok ya da sahibi tam olarak bu
 * atölye". Tek tek atama bu fonksiyondan geçer; TOPLU yazıcılar (atölye seansı
 * partisi) tek UPDATE ile onlarca siparişe dokunduğu için kuralı satır satır
 * çağıramaz — koşulu WHERE'e koyarlar ve dışarıda kalan siparişi ayrıca
 * raporlarlar.
 */
export function sellerPlacementGuard(manufacturerId: string): SQL {
  return or(
    isNull(orders.sellerManufacturerId),
    eq(orders.sellerManufacturerId, manufacturerId)
  )!;
}

/**
 * Denetlenebilir bir aşma gerekçesinin ALT SINIRI (karakter).
 *
 * Neden BURADA: baraj, aşmayı kabul eden yerin kuralıdır. Rotalara bırakıldığı
 * sürece her rota kendi sayısını yazdı ve biri gevşek kaldı — tek atama ucu 10
 * karakter isterken geri alma ucu zaten zorunlu olan 3 karakterlik "sebep"i
 * gerekçe yerine geçiriyordu, yani aynı mülkiyet aşması oradan "abc" ile
 * geçebiliyordu. Rotalar bunu admin'e ERKEN söylemek için içe aktarır; son sözü
 * kapı söyler.
 */
export const SELLER_OVERRIDE_REASON_MIN_LENGTH = 10;

/**
 * Yerleştirme kararının siparişten okuduğu her şey — TEK sorguda.
 *
 * Satıcı (ve adı) reddi ADIYLA söyleyebilmek için; `figurineSize` ise büyük
 * format sert filtresi için. İkinci bir okuma açmak yerine aynı satırdan
 * alınır: iki okuma arasında sipariş değişirse kapı iki farklı gerçeğe göre
 * karar verirdi.
 */
async function loadPlacementFacts(orderId: string): Promise<{
  sellerManufacturerId: string | null;
  sellerName: string | null;
  figurineSize: string | null;
}> {
  const [row] = await db
    .select({
      sellerManufacturerId: orders.sellerManufacturerId,
      sellerName: manufacturers.companyName,
      figurineSize: orders.figurineSize,
    })
    .from(orders)
    .leftJoin(manufacturers, eq(manufacturers.id, orders.sellerManufacturerId))
    .where(eq(orders.id, orderId))
    .limit(1);
  // Sipariş yoksa mülkiyet de yoktur: cevabı aşağıdaki korumalı UPDATE verir
  // (not_assignable), yoksa var olmayan bir sipariş "satıcının" sanılırdı.
  return {
    sellerManufacturerId: row?.sellerManufacturerId ?? null,
    sellerName: row?.sellerName ?? null,
    figurineSize: row?.figurineSize ?? null,
  };
}

export type AssignResult =
  | {
      ok: true;
      order: {
        id: string;
        orderNumber: string;
        userId: string;
        status: string;
      };
    }
  | {
      ok: false;
      reason: AssignFailure;
      /**
       * `seller_owned` reddinde siparişin SAHİBİ. Mesajı burada değil çağıranda
       * kurmak için: rota "X atölyesinin kendi kataloğundan çıktı" diyebilmeli,
       * servis ise adı çözülemediğinde de doğru kalan genel cümleyi taşır.
       */
      sellerManufacturerId?: string | null;
      sellerName?: string | null;
    };

export interface AssignArgs {
  orderId: string;
  manufacturerId: string;
  /** Writes an `assign_manufacturer` audit row. Omit for non-admin callers. */
  adminEmail?: string;
  /** Overrides the default notification copy (e.g. the decline-reassign wording). */
  notification?: { subject: string; body: string };
  /**
   * Extra condition the order must still satisfy. Defaults to
   * assignableStatusGuard(); pass `null` to skip the status check entirely
   * (the decline path has already validated the order's state).
   */
  statusGuard?: SQL | null;
  /** Skip the printable-content check when the caller already proved it. */
  skipPrintableCheck?: boolean;
  /**
   * SATICI KURALININ BİLİNÇLİ AŞILMASI — yalnız admin, yalnız denetlenerek.
   *
   * Sahibin kararı: satıcının kendi ürünü kazara başka bir atölyeye GİTMEMELİ,
   * ama satıcının atölyesi temelli kapandığında admin'in elinde bir çıkış
   * KALMALI. Bu yüzden aşma mümkündür ve üç şeyi birden ister: açık bayrak,
   * işlemi yapan admin (`adminEmail`) ve bir GEREKÇE. Üçü tamam değilse aşma
   * çalışmaz (aşağıda `seller_owned` ile reddedilir): denetlenemeyen bir aşma,
   * aşma değil sessiz bir ihlaldir.
   *
   * Toplu atama bunu ASLA geçmez (bkz. bulk-orders/assign): tek tıkla elli
   * siparişte mülkiyet aşmak, kuralın kendisini kaldırmak olurdu.
   */
  allowSellerOverride?: boolean;
  /** Aşmanın denetim satırına yazılan gerekçesi. Aşma varsa ZORUNLUDUR. */
  sellerOverrideReason?: string;
  /**
   * Bu atölye NASIL seçildi — denetim satırı bunu yazar. Gönderilmezse
   * "admin elle seçti" varsayılır (ekrandan yapılan atamanın hâli budur).
   */
  selectionBasis?: AssignSelectionBasis;
}

/**
 * Assign an order to a manufacturer, atomically and idempotently.
 *
 * The update requires the order to still be unassigned (NULL or 'unassigned'),
 * which is what stops a concurrent admin action, an auto-assignment and a
 * decline retry from all landing on the same order. Losing that race is not an
 * error for the caller to retry — it means someone else already assigned it.
 *
 * It also refuses a refunded order (notRefundedGuard): that fails with
 * `not_assignable`, whoever the caller is.
 *
 * Ve MÜLKİYET kuralını uygular (E-C1): satıcının kendi katalog ürünü başka bir
 * atölyeye verilemez — `seller_owned` ile reddedilir. Kural buradadır ki
 * siparişe üretici yazan HER yol onu YAPISI GEREĞİ uygulasın; çağıran başına
 * kopyalandığında bir yazıcı onu unutmuştu. Admin, denetlenmiş bir aşma
 * (`allowSellerOverride` + `adminEmail` + gerekçe) ile kuralı bilerek geçebilir.
 */
export async function assignManufacturerToOrder(
  args: AssignArgs
): Promise<AssignResult> {
  const { orderId, manufacturerId } = args;

  // MÜLKİYET, her şeyden ÖNCE. Hedef atölyenin var olup olmadığından da önce:
  // satıcının ürününü rakibe vermek, kapalı bir atölyeye vermekten daha ağır
  // bir hatadır ve cevabın "üretici aktif değil" olması sebebi gizlerdi.
  // DEĞİŞKEN ADI `ownership` KALMALI: scripts/test-auto-assign.ts satıcı
  // bildiriminin ve reddin doğru alandan beslendiğini KAYNAK ÜZERİNDEN pinliyor
  // (`ownership.sellerManufacturerId!` / `ownership.sellerName`). Adı
  // değiştirmek o tuzak telini sessizce koparır — nitekim bir kez kopardı.
  const ownership = await loadPlacementFacts(orderId);
  const sellerBreach = sellerOwnedPlacementBlocked(
    ownership.sellerManufacturerId,
    manufacturerId
  );
  // Aşma DENETLENEBİLİR olmak zorunda: bayrak tek başına yetmez, işlemi yapan
  // admin ve gerekçe de gerekir. Eksikse aşma YOK sayılır ve sipariş reddedilir
  // — sessiz bir ihlal, açık bir redden her zaman daha kötüdür.
  const rawOverrideReason = args.sellerOverrideReason?.trim() ?? "";
  // Barajın altındaki gerekçe YOK sayılır: aşağıdaki `length > 0` artık
  // "gerekçe gönderilmiş mi"yi değil "DENETLENEBİLİR bir gerekçe var mı"yı
  // okur. Baraj kapının kendisinde durduğu için hiçbir çağıran ondan daha
  // gevşek olamaz — rota kendi sayısını yazsa bile aşma burada düşer.
  const overrideReason =
    rawOverrideReason.length >= SELLER_OVERRIDE_REASON_MIN_LENGTH ? rawOverrideReason : "";
  const overrideAudited =
    args.allowSellerOverride === true &&
    !!args.adminEmail &&
    overrideReason.length > 0;
  if (sellerBreach && !overrideAudited) {
    if (args.allowSellerOverride === true) {
      console.error(
        `assignManufacturerToOrder: denetlenmemiş satıcı aşması reddedildi (${orderId}) — ` +
          `adminEmail ve en az ${SELLER_OVERRIDE_REASON_MIN_LENGTH} karakterlik gerekçe zorunlu` +
          (rawOverrideReason.length > 0
            ? ` (gönderilen gerekçe ${rawOverrideReason.length} karakter)`
            : "")
      );
    }
    return {
      ok: false,
      reason: "seller_owned",
      sellerManufacturerId: ownership.sellerManufacturerId,
      sellerName: ownership.sellerName,
    };
  }

  const manufacturer = await db.query.manufacturers.findFirst({
    where: and(
      eq(manufacturers.id, manufacturerId),
      eq(manufacturers.status, "active")
    ),
    columns: { id: true, companyName: true, capabilities: true },
  });
  if (!manufacturer) return { ok: false, reason: "manufacturer_unavailable" };

  if (!args.skipPrintableCheck && !(await orderHasPrintableContent(orderId))) {
    return { ok: false, reason: "no_printable_content" };
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * FAZ 5 KAPILARI — İKİSİ DE SIRALAYICI İKİZİYLE AYNI ANAHTARDA.
   *
   * Bugün her iki sinyal de KAPALI (config/scoring.ts · liveSignalSet), yani bu
   * blok hiçbir yerleştirmeyi reddetmez: canlı davranış Faz 5 ÖNCESİYLE
   * birebir aynıdır. Bayraklar ikizleriyle BİRLİKTE açılınca ekran ve uç aynı
   * ölçüye aynı anda geçer. Sıralamadan sonra tezgâh dolabileceği için yazma
   * yolu kapasiteyi yeniden okur; bu arada oluşan ret kendi sebebiyle bildirilir.
   *
   * Kararı burada YENİDEN YAZMIYORUZ: saf kural flags.ts'te durur, çünkü aynı
   * cevabı DB'siz birim testi de vermek zorunda.
   * ────────────────────────────────────────────────────────────────────────── */
  const signals = placementSignals();
  // Kural (saf, DB'siz) her hâlde HESAPLANIR: gölge kaydı ve aşağıdaki günlük
  // satırı, bayrak kapalıyken bile "açık olsaydı ne olurdu" sorusunu
  // cevaplayabilmeli.
  const largeFormatBlocked = largeFormatPlacementBlocked(
    ownership.figurineSize,
    manufacturer.capabilities
  );
  // KAPASİTE ÖLÇÜSÜ YALNIZ SİNYAL AÇIKKEN OKUNUR. Uygulanmayacak bir ölçü için
  // her yerleştirmede üç sorgu açmak, ölçmenin bedelini canlıya yüklerdi —
  // üstelik gereksiz: gölge ölçümü sıralama şeridinde TEK toplu yüklemeyle
  // zaten alınıyor (manufacturer-assignment-shadow.ts · capacities).
  // Ölçü ORTAKTIR (services/manufacturer-capacity.ts): burada kendi sayımımız
  // YOK — iade edilmiş iş sayılmaz ve ölçü ağırlıklı birimdir.
  const capacity = signals.weightedLoad
    ? await manufacturerCapacityGate(manufacturerId)
    : null;
  const refusal = placementGateRefusal({
    signals,
    largeFormatBlocked,
    // `null` = ölçülmedi (sinyal kapalı). Ölçülmemiş değer ret sebebi olamaz.
    hasRoom: capacity ? capacity.ok : null,
  });
  if (refusal) return { ok: false, reason: refusal };
  if (largeFormatBlocked) {
    // GÖLGE: kural bugün UYGULANMIYOR ama sessiz de kalmıyor. Bayrak açıldığı
    // gün hangi işlerin duvara toslayacağı, o günden önce günlükte görünsün.
    console.info(
      `[GÖLGE] ${orderId}: büyük format sinyali AÇIK olsaydı bu yerleştirme ` +
        `reddedilirdi (atölye ${manufacturerId} 'large_format' beyan etmemiş)`
    );
  }

  const statusGuard =
    args.statusGuard === undefined ? assignableStatusGuard() : args.statusGuard;
  const conditions = [
    eq(orders.id, orderId),
    // Unassigned means NULL (never touched) or the explicit 'unassigned' the
    // cart fan-out writes for platform products — both are up for grabs.
    or(isNull(orders.manufacturerStatus), eq(orders.manufacturerStatus, "unassigned"))!,
    // A refunded order keeps its status (refund-end-state decision) and the
    // refund detaches the partner, so it sits at approved/paid + unassigned —
    // exactly what an assignable order looks like. Without this the admin
    // "Ata" button, bulk assign and automatic assignment would put a refunded
    // order back on a partner's bench and a fresh earning would accrue at ship.
    // It lives in the UPDATE (not a pre-read) so a refund landing between
    // ranking and this write still wins, and outside `statusGuard` so the
    // decline path (statusGuard: null) is covered too. The reason stays
    // `not_assignable`: callers map reasons through fixed tables, and a new
    // member would reach them as an unknown key.
    notRefundedGuard(),
    // Cancellation can retain succeeded payment while the cash return is due.
    // Even a caller bypassing the normal stage guard cannot restart that order.
    ne(orders.status, "rejected"),
  ];
  if (statusGuard) conditions.push(statusGuard);
  // Kuralın SQL ikizi, YAZININ İÇİNDE. Yukarıdaki okuma ile bu UPDATE arasında
  // siparişin sahibi değişirse (ör. admin pazaryeri alanlarını düzenlerse) ön
  // kontrol bayatlar; bu koşul o durumda da ihlali yazdırmaz.
  //
  // Koşulu yalnız GERÇEK bir ihlalin denetlenmiş aşması düşürebilir. Bayrak tek
  // başına yetmez: sahibi OLMAYAN bir siparişte de denetlenmiş aşma üçlüsü
  // gelebilir (rota onu kendi ön okumasına göre gönderir) ve o çağrıda koşulu
  // düşürmek korumayı hiçbir şey karşılığında kaldırırdı — ön okuma ile yazma
  // arasına düşen bir sahiplik yazısı korumasız işlenir, üstelik ne denetim
  // notu ne satıcı bildirimi olurdu (ikisi de `sellerBreach`e bağlı).
  if (!(overrideAudited && sellerBreach)) {
    conditions.push(sellerPlacementGuard(manufacturerId));
  }

  const [order] = await db
    .update(orders)
    .set({
      manufacturerId,
      manufacturerStatus: "assigned",
      assignedToManufacturerAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning({
      id: orders.id,
      orderNumber: orders.orderNumber,
      userId: orders.userId,
      customerName: orders.customerName,
      status: orders.status,
    });

  if (!order) return { ok: false, reason: "not_assignable" };

  /* ──────────────────────────────────────────────────────────────────────────
   * BURADAN SONRASI EN İYİ ÇABADIR — hiçbiri fırlatarak dışarı çıkmaz.
   *
   * Yukarıdaki UPDATE COMMIT oldu: sipariş üreticinin tezgâhında ve hakediş
   * bundan sonra o atölyeye işleyecek. Bu noktadan sonra atılan bir hata
   * atamayı GERİ ALMAZ, yalnızca çağırana "atanamadı" yalanını söyler —
   * otomatik atama yolunda bunun bedeli somut: order-confirm, atamayı bir
   * try/catch içinde çağırıyor ve catch'i `{ assigned: false }` döndürüyor,
   * yani bir Redis kesintisi GERÇEKLEŞMİŞ bir atamayı admin'e "otomatik
   * atanmadı" diye gösterirdi (üstelik değerlendirme taslağı da düşürülerek).
   * Bu yüzden denetim satırı, bildirimler ve canlı yayın AYRI AYRI yakalanır
   * ve gürültülü loglanır: iz kaybolmaz ama dönen sonuç gerçeği söyler.
   * ────────────────────────────────────────────────────────────────────────── */

  if (args.adminEmail) {
    // Aşma, atamanın kendisinden AYRI bir olaydır: denetim satırı satıcıyı,
    // hedefi ve gerekçeyi birlikte adlandırır, çünkü "bu iş rakip atölyeye
    // nasıl gitti" sorusunun cevabı yalnızca burada durur.
    const sellerLabel =
      ownership.sellerName ?? ownership.sellerManufacturerId ?? "bilinmeyen satıcı";
    // Yedek not TÜRKÇEDİR ve atölyenin NASIL seçildiğini söyler: aynı listede
    // duran diğer notlar ("Atama geri alındı: …") Türkçe ve sebepliyken, bu
    // satır tek başına İngilizce ve sebepsizdi.
    const notes = sellerBreach
      ? `SATICI KURALI AŞILDI: ürünün sahibi ${sellerLabel}, sipariş ${manufacturer.companyName} atölyesine atandı. Gerekçe: ${overrideReason}`
      : `Üretici atandı: ${manufacturer.companyName} — ${ASSIGN_SELECTION_BASIS_TR[args.selectionBasis ?? "admin_manual"]}.`;
    try {
      await db.insert(adminActions).values({
        orderId,
        action: "assign_manufacturer",
        adminEmail: args.adminEmail,
        notes,
      });
    } catch (err) {
      // Denetim satırı yazılamasa bile aşmanın izi KALMALI: log satırı aynı
      // cümleyi taşır, böylece "bu iş rakip atölyeye nasıl gitti" sorusunun
      // cevabı hiçbir hâlde tamamen kaybolmaz.
      console.error(
        `assignManufacturerToOrder: denetim satırı yazılamadı (${orderId}) — ${notes}`,
        err
      );
    }
  }

  if (sellerBreach) {
    // Ürünün SAHİBİ bunu öğrenmek zorunda: kendi kataloğundan çıkan bir iş
    // başka bir atölyede basılıyor. Bildirim en iyi çabadır — yazılamaması
    // denetim satırını da atamayı da geri almaz.
    try {
      await notifyManufacturer({
        manufacturerId: ownership.sellerManufacturerId!,
        type: "order_unassigned",
        subject: `Kendi ürününüz başka bir atölyeye atandı: ${order.orderNumber}`,
        body:
          `${order.orderNumber} numaralı sipariş sizin kataloğunuzdan çıktı, ancak yönetici kararıyla ` +
          `${manufacturer.companyName} atölyesine atandı.\n\nGerekçe: ${overrideReason}\n\n` +
          `Sorunuz varsa yöneticiyle iletişime geçin.`,
        orderId,
      });
    } catch (err) {
      console.error(
        `assignManufacturerToOrder: satıcı aşma bildirimi gönderilemedi (${orderId})`,
        err
      );
    }
  }

  // A failed inbox/email write must not undo a committed assignment — the
  // order is already on the partner's bench either way.
  try {
    await notifyManufacturer({
      manufacturerId,
      type: "order_assigned",
      subject:
        args.notification?.subject ??
        `Yeni sipariş atandı: ${order.orderNumber}`,
      body:
        args.notification?.body ??
        `Sayın ${manufacturer.companyName},\n\n${order.orderNumber} numaralı sipariş size atandı. Lütfen üretici panelinizden 24 saat içinde kabul veya reddedin.\n\nMüşteri: ${order.customerName}`,
      orderId,
    });
  } catch (err) {
    console.error(`assignManufacturerToOrder: notify failed for ${orderId}`, err);
  }

  // Canlı yayın da en iyi çaba: Redis'e ulaşılamaması yalnızca açık ekranların
  // birkaç saniye geç yenilenmesi demektir, atamanın kendisi olmuş bitmiştir.
  try {
    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId,
      status: order.status,
      manufacturerStatus: "assigned",
    });
  } catch (err) {
    console.error(`assignManufacturerToOrder: yayın gönderilemedi (${orderId})`, err);
  }

  return {
    ok: true,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      status: order.status,
    },
  };
}
