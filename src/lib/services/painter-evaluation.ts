import { desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  painterAssignmentEvaluations,
  type PainterEvaluationCandidateSnapshot,
} from "@/lib/db/schema";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";
import { PAINTER_TRIGGER_LABELS_TR } from "@/app/admin/scoring-evaluations/painter-evaluation-view";

/**
 * Boyacı atama KARAR KAYDI — `painter_assignment_evaluations` yazıcısı (P4-C3).
 *
 * Ne işe yarar: otomatik boyacı ataması bir işi kime, hangi skorla ve NİYE
 * verdiğini açıklayabilsin diye. Ortağın geliri bu karara bağlı olduğu için
 * "neden ben değil" sorusunun cevabı, siparişin bugünkü hâline bakarak değil
 * ancak KARAR ANINDA yazılmış bir satırdan verilebilir.
 *
 * SATIR YALNIZ GERÇEK BİR KARARDA YAZILIR. Girdide "sadece sıraladım" diye bir
 * seçenek YOKTUR: `outcome` ya bir boyacının yerleştiğini ya da hiçbir uygun
 * boyacı bulunmadığını (iş admin kuyruğuna düştü) söyler. Sayfa görüntülemesi,
 * admin'in aday listesini açması ya da üreticinin boyacı seçiciyi görmesi satır
 * YAZAMAZ; satırlar üst üste yazılmayıp BİRİKTİĞİ için bir önizlemenin yazacağı
 * satır, hiç yaşanmamış bir yerleştirme olarak gerçeklerin arasına karışırdı
 * (üretici tarafında bu tam olarak yaşandı — migration 0054 notu).
 *
 * `server-only` BİLEREK YOK: cevapsız kalan 24 saatlik SLA'yı işleyip işi
 * yeniden yerleştiren iş parçacığı BullMQ worker'ında çalışır ve bu modüle
 * oradan ulaşır. `server-only` girerse standalone Node worker çöker (bkz.
 * worker-server-only-trap).
 *
 * TELEMETRİ ATAMAYI GERİ ALMAZ: yazma hataları yutulur ve Türkçe uyarıya
 * çevrilir. Kaydın yazılamaması, yerleşmiş bir işi geri almak için sebep değil.
 *
 * GİZLİLİK: boyacı kimliği yalnız işi devreden üreticiye açılır (boyacı
 * sözleşmesi). Bu tablo İÇ kayıttır — müşteriye görünen hiçbir yüzeye
 * bağlanmaz.
 */

/** Kararı tetikleyen olay. Yeni bir tetikleyici eklemek migration istemez (text). */
export const PAINTER_ASSIGNMENT_TRIGGERS = [
  "qc_approve",
  "decline_retry",
  "sla_reassign",
  "admin_manual",
  // İki İNSAN yolu. Eskiden ikisi de hiçbir satır yazmıyordu: bir siparişin
  // boyacısının nasıl belirlendiği, yerleştirmeyi KİMİN yaptığına göre
  // cevaplanabilir ya da cevaplanamaz hâle geliyordu (üretici kendi devrettiyse
  // ortada hiçbir gerekçe kaydı yoktu). Ayrı damgalar, çünkü üç insan kararı
  // aynı şey değil: admin boş bir siparişe boyacı ATAR, admin bir boyacıyı
  // DEĞİŞTİRİR (parça eski boyacıdadır), üretici ise işi kendi devreder.
  "manufacturer_handoff",
  "admin_swap",
] as const;

export type PainterAssignmentTrigger =
  (typeof PAINTER_ASSIGNMENT_TRIGGERS)[number];

/**
 * Admin'in okuduğu Türkçe etiketler — TEK SÖZLÜK, ekranla ORTAK.
 *
 * Burada ikinci bir kopya vardı ve kopyalar ayrışmıştı: sipariş notu "Yönetici
 * seçimi" derken /admin/scoring-evaluations aynı kararı "Admin elle atadı" diye
 * gösteriyordu; admin notta okuduğu kararı listede arayamıyordu. Sözlüğün
 * kendisi SAF ekran modülünde durur (painter-evaluation-view.ts), çünkü bu dosya
 * @/lib/db import eder ve boyacı seçicisi bir istemci bileşenidir — yani sözlük
 * ancak o yönde paylaşılabilir. Buradaki yalnız ADIDIR: aynı nesne.
 */
export { PAINTER_TRIGGER_LABELS_TR as PAINTER_ASSIGNMENT_TRIGGER_LABELS_TR } from "@/app/admin/scoring-evaluations/painter-evaluation-view";

/**
 * Sıralayıcının HİÇ çalışmadığı tetikleyiciler: kazananı bir insan seçti.
 *
 * Ekran bu ayrımı bilmek zorunda. Aday listesi boş bir satırda "sıralama
 * kimseyi seçemedi" yazmak, çalışmamış bir sıralamayı başarısız göstermek
 * olurdu — oysa o kararda sıralayıcıya hiç sorulmadı.
 */
export const PAINTER_HUMAN_TRIGGERS: readonly PainterAssignmentTrigger[] = [
  "admin_manual",
  "manufacturer_handoff",
  "admin_swap",
];

/** Bu kararı bir sıralama mı üretti? Bilinmeyen damga "bilinmiyor" değil, sıralama sayılır. */
export function painterTriggerIsHuman(trigger: string | null): boolean {
  return (
    !!trigger &&
    (PAINTER_HUMAN_TRIGGERS as readonly string[]).includes(trigger)
  );
}

export function isPainterAssignmentTrigger(
  value: unknown
): value is PainterAssignmentTrigger {
  return (
    typeof value === "string" &&
    (PAINTER_ASSIGNMENT_TRIGGERS as readonly string[]).includes(value)
  );
}

/**
 * Satırı üreten ağırlık kümesinin sürümü.
 *
 * Ağırlıklar sıralayıcıda (P4-C1) yaşıyor; burada duran yalnızca DAMGADIR.
 * Ağırlıklar değiştiğinde bu sürüm de artırılmalı: yoksa yeni ağırlıklarla
 * alınmış kararlar eski kararlarla aynı etikete sahip olur ve "ağırlığı
 * değiştirince işler yer değiştirdi mi" sorusu bir daha cevaplanamaz. Çağıran
 * kendi sürümünü geçirebilir (`weightsVersion`); geçmezse bu varsayılan yazılır.
 */
export const PAINTER_EVALUATION_WEIGHTS_VERSION = "p1.0";

/**
 * Kayda giren aday sayısı. Sıralamanın tamamı değil, İLK ÜÇ uygun aday
 * saklanır: karar kalitesine bakarken üçüncüden sonrası gürültüdür ve her
 * kararda onlarca boyacıyı jsonb'ye yazmak tabloyu sebepsiz şişirir.
 */
const KEEP_ELIGIBLE = 3;

/**
 * Uygun aday YOKKEN saklanan elenmiş aday sayısı. İş admin kuyruğuna düştüğünde
 * "neden kimse uygun değildi" sorusunun TEK cevabı bu listedir (kapasite dolu,
 * sipariş almıyor, zaten reddetti...). Yerleşen bir karar için elenmişler
 * yazılmaz — orada cevabı kazanan veriyor.
 */
const KEEP_INELIGIBLE = 10;

/**
 * Kararın sonucu. İki hâl vardır ve üçüncüsü YOKTUR: "sıraladım ama bir şey
 * yapmadım" bu tabloya yazılmaz.
 */
export type PainterEvaluationOutcome =
  /** Boyacı yerleşti. `painterId` işi GERÇEKTEN alan boyacıdır. */
  | { kind: "placed"; painterId: string }
  /** Kimse yerleşmedi; iş admin kuyruğuna düştü. `reason` makine kodudur. */
  | { kind: "no_eligible_candidate"; reason: string };

export interface PainterEvaluationInput {
  orderId: string;
  trigger: PainterAssignmentTrigger;
  /**
   * Sıralayıcının döndürdüğü liste — EN İYİDEN KÖTÜYE sıralı (P4-C1).
   * Yazıcı listeyi YENİDEN SIRALAMAZ: sıralama sıralayıcının işidir ve burada
   * ikinci bir sıralama, sıralayıcıdaki bir hatayı kayıtta gizlerdi.
   */
  candidates: readonly PainterEvaluationCandidateSnapshot[];
  outcome: PainterEvaluationOutcome;
  /** Bu denemede sıralamaya hiç sokulmayan boyacılar (önceki retler, SLA). */
  excludedPainterIds?: readonly string[];
  /** Varsayılan: PAINTER_EVALUATION_WEIGHTS_VERSION. */
  weightsVersion?: string;
}

/** Yazılmaya hazır satır — saf üretimin çıktısı (DB'ye bu hâliyle gider). */
export interface PainterEvaluationRow {
  orderId: string;
  winnerPainterId: string | null;
  placedPainterId: string | null;
  candidates: PainterEvaluationCandidateSnapshot[];
  excludedPainterIds: string[];
  weightsVersion: string;
  trigger: PainterAssignmentTrigger;
  outcomeReason: string | null;
}

/**
 * Girdiyi satıra çevirir. SAF: DB yok, saat yok, rastgelelik yok — aynı girdi
 * her zaman aynı satırı verir, testi de bu yüzden DB'siz yazılabiliyor.
 *
 * Üç kural:
 *  1. KAZANAN = listedeki İLK UYGUN aday. Yeniden sıralama yok (yukarıdaki not).
 *  2. YERLEŞEN ADAY HER ZAMAN KAYITTA KALIR — ilk üçün dışında kalsa, hatta
 *     elenmiş sayılsa bile. Yoksa yönetici sıralamanın birincisi yerine
 *     başkasını seçtiğinde (admin_manual) kayıt, işi alan boyacıyı hiç
 *     anmayan bir satır olurdu: "şu karar şu boyacıya gitti" cümlesi
 *     doğrulanamazdı.
 *  3. Aynı boyacı iki kez gelmişse (yükleyicinin çift join'i) İLK geçişi kalır;
 *     kopya satır ekranda aynı adayı iki kez sayardı.
 */
export function buildPainterEvaluationRow(
  input: PainterEvaluationInput
): PainterEvaluationRow {
  const unique = dedupeByPainter(input.candidates);
  const eligible = unique.filter((c) => c.eligible);
  const winnerPainterId = eligible[0]?.painterId ?? null;
  const placedPainterId =
    input.outcome.kind === "placed" ? input.outcome.painterId : null;

  const kept: PainterEvaluationCandidateSnapshot[] = eligible.slice(
    0,
    KEEP_ELIGIBLE
  );
  // Uygun aday yoksa elenmişler kararın TEK açıklamasıdır.
  if (eligible.length === 0) {
    kept.push(...unique.filter((c) => !c.eligible).slice(0, KEEP_INELIGIBLE));
  }
  // Kural 2: yerleşen aday listede yoksa ekle (sırayı bozmamak için sona).
  if (placedPainterId && !kept.some((c) => c.painterId === placedPainterId)) {
    const placed = unique.find((c) => c.painterId === placedPainterId);
    if (placed) kept.push(placed);
  }

  return {
    orderId: input.orderId,
    winnerPainterId,
    placedPainterId,
    candidates: kept,
    excludedPainterIds: [...(input.excludedPainterIds ?? [])],
    weightsVersion: input.weightsVersion ?? PAINTER_EVALUATION_WEIGHTS_VERSION,
    trigger: input.trigger,
    outcomeReason:
      input.outcome.kind === "no_eligible_candidate"
        ? input.outcome.reason
        : null,
  };
}

function dedupeByPainter(
  candidates: readonly PainterEvaluationCandidateSnapshot[]
): PainterEvaluationCandidateSnapshot[] {
  const seen = new Set<string>();
  const out: PainterEvaluationCandidateSnapshot[] = [];
  for (const c of candidates) {
    if (seen.has(c.painterId)) continue;
    seen.add(c.painterId);
    out.push(c);
  }
  return out;
}

/**
 * Kararı yazar. ASLA FIRLATMAZ — çağıranın (otomatik atama) yerleştirdiği işi
 * bir telemetri hatası geri aldıramaz.
 *
 * `created_at` yazılmaz: tek saat veritabanınınkidir (kolonun `now()`
 * varsayılanı). Uygulama saatiyle DB saati arasındaki sapma, "en yeni karar"
 * manşetini yanıltırdı.
 *
 * Dönüş: satır yazıldıysa true. Çağıran buna bakmak ZORUNDA değildir; bakan
 * olursa da false, atamanın başarısız olduğu anlamına GELMEZ.
 */
export async function recordPainterEvaluation(
  input: PainterEvaluationInput
): Promise<boolean> {
  const row = buildPainterEvaluationRow(input);
  try {
    await db.insert(painterAssignmentEvaluations).values(row);
    return true;
  } catch (err) {
    console.warn(
      `[boyacı atama] değerlendirme yazılamadı (${input.orderId}):`,
      err
    );
    return false;
  }
}

/**
 * YERLEŞTİRMENİN KARARINI YAZAN TEK KAPI — ve yazamadığında SUSMAYAN kapı.
 *
 * Sahibin kararı: bir boyacıyı siparişe koyan HER yol, onu haklı çıkaran satırı
 * yazar. Üç insan yolu (yöneticinin ataması, yöneticinin boyacı değişimi,
 * üreticinin kendi devri) bu kapıdan geçer; otomatik yollar sıralamayı da
 * taşıdığı için `recordPainterEvaluation`u doğrudan çağırır. Tek INSERT yolu
 * korunur: burada ikinci bir `db.insert` YOKTUR, çağrı delege edilir.
 *
 * ADAY LİSTESİ BOŞTUR ve bu bir eksiklik değil, kararın kendisidir: bu üç yolda
 * sıralayıcı hiç çalışmadı, kazananı bir insan seçti. Ağırlık sürümü de bu
 * yüzden varsayılan damgadır — ortada bir formülün ürettiği sıra yok.
 *
 * YAZILAMAZSA İKİ ŞEY OLUR, ATAMA GERİ ALINMAZ:
 *  1. siparişe kalıcı bir [BOYACI KAYDI] notu düşer — admin'in bunu öğrenmesi
 *     ekranın o anki cevabı okumasına bağlı kalmamalı (ölçülen kusur buydu:
 *     uç uyarıyı döndürüyor, ekran başarı dalında gövdeyi hiç okumuyordu),
 *  2. çağırana Türkçe uyarı cümlesi döner ve cevabın gövdesine konur.
 */
export interface PainterPlacementRecordResult {
  /** Satır yazıldı mı. Çağıran buna bakıp işlemi geri ALMAZ. */
  recorded: boolean;
  /** Yazılamadıysa admin'e gösterilecek Türkçe cümle; yazıldıysa null. */
  warningTr: string | null;
}

/**
 * Uyarının ORTAK gövdesi. Baş cümleyi çağıran verir ("Boyacı atandı ve hakediş
 * işlendi" / "Boyacı değiştirildi"), çünkü her yolda gerçekten OLAN şey farklı
 * ve hepsine aynı cümleyi yazmak birinde yalan olurdu (devirde para hareket
 * etmez).
 */
export function painterEvaluationWriteWarningTr(doneTr: string): string {
  return (
    `${doneTr}, ancak bu kararın gerekçe kaydı yazılamadı: sipariş sayfasındaki ` +
    `gerekçe kartında ve karar listesinde bu atama görünmeyecek. İşlem geçerlidir; ` +
    `kaydın tutulamadığını yöneticiye bildirin.`
  );
}

/**
 * Yazılamayan kaydı siparişin admin notuna işler. ASLA FIRLATMAZ.
 *
 * Not SQL'de BİRLEŞTİRİLİR (flagPainterManualAssignment ile aynı kalıp): araya
 * giren [SLA]/[ATAMA]/[BOYACI] bayrakları ezilmemeli.
 */
async function notePainterEvaluationWriteFailure(
  orderId: string,
  trigger: PainterAssignmentTrigger
): Promise<void> {
  const note = formatAdminNoteLine(
    `[BOYACI KAYDI] "${PAINTER_TRIGGER_LABELS_TR[trigger]}" kararının gerekçe ` +
      `kaydı yazılamadı. Atama GEÇERLİDİR ve para etkilenmedi; yalnız "bu iş neden bu ` +
      `boyacıya gitti" dökümü bu karar için oluşmadı.`
  );
  try {
    await db
      .update(orders)
      .set({
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
  } catch (err) {
    console.warn(
      `[boyacı atama] değerlendirme uyarısı nota da yazılamadı (${orderId}):`,
      err
    );
  }
}

export async function recordPainterPlacementDecision(args: {
  orderId: string;
  /** Yerleştirmeyi hangi insan yolu yaptı. */
  trigger: PainterAssignmentTrigger;
  /** İşi GERÇEKTEN alan boyacı. */
  painterId: string;
  /**
   * Bu kararda bilerek dışarıda bırakılanlar: daha önce reddedenler ve —
   * boyacı değişiminde — işi elinden alınan boyacı. "Neden yine o boyacı
   * seçilmedi" sorusunun tek cevabı bu listedir.
   */
  excludedPainterIds?: readonly string[];
  /** Uyarının baş cümlesi: o yolda GERÇEKTEN olan şey. */
  doneTr: string;
}): Promise<PainterPlacementRecordResult> {
  const recorded = await recordPainterEvaluation({
    orderId: args.orderId,
    trigger: args.trigger,
    candidates: [],
    outcome: { kind: "placed", painterId: args.painterId },
    excludedPainterIds: args.excludedPainterIds,
  });
  if (recorded) return { recorded: true, warningTr: null };
  await notePainterEvaluationWriteFailure(args.orderId, args.trigger);
  return {
    recorded: false,
    warningTr: painterEvaluationWriteWarningTr(args.doneTr),
  };
}

/**
 * RET ÜST SINIRI DOLDU — işin admin kuyruğuna düştüğü ANIN kaydı.
 *
 * Bu yol sıralayıcıyı HİÇ çalıştırmaz: üst sınır (flags.ts · PAINTER_MAX_DECLINES,
 * bugün 4) kapıyı aday aranmadan kapatır.
 * Aday listesinin boş olması bu yüzden kaydın eksikliği DEĞİL kararın kendisidir
 * — "kimse uygun değildi" ile "kimseye bakılmadı" farklı iki cümledir ve satır
 * ikincisini söyler (`outcome_reason` ayırt eder).
 *
 * Satır neden şart: sahibin kararına göre ret üst sınırı (PAINTER_MAX_DECLINES)
 * dolduğunda iş üreticiye geri
 * DÖNMEZ, admin kuyruğuna düşer. Yazılmazsa o an hiçbir yerde görünmez ve
 * sipariş, kararı hiç alınmamış gibi "boyacısız bekliyor" diye okunur; ortağın
 * "bu iş neden bana gelmedi" sorusunun cevabı da kaybolur.
 *
 * `recordPainterEvaluation` gibi ASLA FIRLATMAZ.
 */
export const PAINTER_DECLINE_CAP_REASON = "decline_cap_reached";

export async function recordPainterDeclineCapReached(args: {
  orderId: string;
  /** Kapıyı hangi olay kapattı: ret yolu mu, cevapsızlık süpürmesi mi. */
  trigger: PainterAssignmentTrigger;
  /** Siparişin kara listesi — "kimler reddetti" sorusunun cevabı. */
  excludedPainterIds?: readonly string[];
  weightsVersion?: string;
}): Promise<boolean> {
  return recordPainterEvaluation({
    orderId: args.orderId,
    trigger: args.trigger,
    candidates: [],
    outcome: {
      kind: "no_eligible_candidate",
      reason: PAINTER_DECLINE_CAP_REASON,
    },
    excludedPainterIds: args.excludedPainterIds,
    weightsVersion: args.weightsVersion,
  });
}

/** Ekrana giden satır — jsonb alanları çözülmüş hâliyle. */
export interface PainterEvaluationRecord extends PainterEvaluationRow {
  id: string;
  createdAt: Date;
}

/**
 * Bir siparişin son kararları — YALNIZ GÖSTERİM İÇİN.
 *
 * Okunamazsa boş liste döner ve sayfa yine render edilir (migration henüz
 * uygulanmamış bir ortamda tablo 42P01 verir). Bu gevşeklik yalnız gösterime
 * aittir: hiçbir KAPI bu tablodan beslenmez, dolayısıyla boş dönen bir okuma
 * kimseye bir hak açmaz. Bir gün bir kapı buraya bakacak olursa o kapı kendi
 * okumasını yapmalı ve hatada KAPALI kalmalıdır.
 */
export async function listPainterEvaluationsForOrder(
  orderId: string,
  limit = 5
): Promise<PainterEvaluationRecord[]> {
  try {
    const rows = await db
      .select()
      .from(painterAssignmentEvaluations)
      .where(eq(painterAssignmentEvaluations.orderId, orderId))
      .orderBy(desc(painterAssignmentEvaluations.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      winnerPainterId: r.winnerPainterId,
      placedPainterId: r.placedPainterId,
      candidates: r.candidates ?? [],
      excludedPainterIds: r.excludedPainterIds ?? [],
      weightsVersion: r.weightsVersion,
      trigger: isPainterAssignmentTrigger(r.trigger) ? r.trigger : "admin_manual",
      outcomeReason: r.outcomeReason,
      createdAt: r.createdAt,
    }));
  } catch (err) {
    console.warn(
      `[boyacı atama] değerlendirme okunamadı (${orderId}); ekran boş gösterilecek:`,
      err
    );
    return [];
  }
}

/**
 * SAKLAMA: kayıt sonsuza kadar tutulmaz.
 *
 * Üretici değerlendirmeleriyle AYNI pencere (30 gün) ve aynı gerekçe: tablo
 * her atamada ve her yeniden yerleştirmede büyür, oysa tanı değeri yalnız
 * yakın geçmişte. Temizlik günlük çalışan `scoring-evaluations-cleanup`
 * worker'ından çağrılır (bkz. queue/workers/scoring-evaluations-cleanup.worker.ts).
 */
export const PAINTER_EVALUATION_RETENTION_DAYS = 30;

/** Saklama sınırı — bu tarihten ESKİ satırlar silinir. Saf. */
export function painterEvaluationCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setDate(cutoff.getDate() - PAINTER_EVALUATION_RETENTION_DAYS);
  return cutoff;
}

/**
 * Eski satırları siler, silinen sayısını döndürür.
 *
 * Yalnız BU tabloya dokunur: üretici değerlendirmelerinin temizliği kendi
 * kodunda kalır, çünkü iki tablonun saklama penceresi ileride ayrışabilir ve
 * tek bir DELETE ikisini birden sessizce kısaltırdı. Operasyon/para verisine
 * hiç dokunmaz — bu tablo salt telemetridir.
 */
export async function purgeOldPainterEvaluations(
  now: Date = new Date()
): Promise<number> {
  const deleted = await db
    .delete(painterAssignmentEvaluations)
    .where(lt(painterAssignmentEvaluations.createdAt, painterEvaluationCutoff(now)))
    .returning({ id: painterAssignmentEvaluations.id });
  return deleted.length;
}
