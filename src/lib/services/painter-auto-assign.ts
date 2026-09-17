import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  painterActions,
  painters,
  manufacturers,
} from "@/lib/db/schema";
import { accrueEarning } from "@/lib/services/payouts";
import { manufacturerBaseKurus } from "@/lib/services/earning-base";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import {
  rankPaintersForOrder,
  type PainterCandidate,
} from "@/lib/services/painter-assignment";
// KAPASİTEYİ SORAN TEK YER. Bu modül kendi sayımını KURMAZ: ölçülen kusur,
// yerleştiricinin İŞ SAYISI sayarken sıralayıcının AĞIRLIKLI birim saymasıydı —
// aynı boyacı bir yolda "dolu", ötekinde "uygun" oluyordu.
import { painterCapacityGate } from "@/lib/services/painter-capacity";
import {
  PAINTER_ASSIGNMENT_TRIGGER_LABELS_TR,
  PAINTER_DECLINE_CAP_REASON,
  painterEvaluationWriteWarningTr,
  recordPainterDeclineCapReached,
  recordPainterEvaluation,
  type PainterAssignmentTrigger,
} from "@/lib/services/painter-evaluation";
import { painterWeightsVersion } from "@/lib/config/painter-scoring";
import { isFlagEnabled } from "@/lib/services/flags";
import {
  PAINTER_MAX_REPLACEMENTS,
  isPainterAssignSkip,
  painterAssignReasonTr,
  painterAssignRowGate,
  painterDeclinesExhausted,
  painterParcelOnTheWay,
  painterUnplacedNeedsAdmin,
  type PainterAssignOutcomeReason,
  type PainterAssignSkip,
} from "@/lib/config/flags";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";
import { getEmailQueue } from "@/lib/queue/queues";

/**
 * Otomatik boyacı ataması (Faz 4 · P4-C2).
 *
 * Bugüne kadar boyacıyı YALNIZ insan seçiyordu: üretici kendi panelinden, ya da
 * admin sipariş sayfasından. Üretici QC'sinden geçen boyalı bir sipariş,
 * birileri tıklayana kadar kimsenin tezgâhında değildi.
 *
 * Bu modül o tıklamanın yerini alır ve ÜÇ yolun ortak evidir:
 *   1. admin üreticinin QC'sini onayladığında (qc-approve rotası),
 *   2. atanan boyacı işi reddettiğinde (boyacı ret rotası) — iş artık üreticiye
 *      GERİ DÖNMEZ, sıradaki boyacıya gider,
 *   3. 24 saat cevapsız kalan otomatik atamalarda (SLA süpürmesi; bu faz
 *      `sla_reassign` tetiğini ve `excludePainterIds` kapısını hazır bırakır).
 *
 * `server-only` YOKTUR ve eklenmemelidir: SLA süpürmesi standalone Node
 * worker'ında koşar ve bu zinciri import eder (2026-06-13'te yaşanan
 * crash-loop).
 *
 * BOYACI KİMLİĞİ İÇ BİLGİDİR. Sıralama, puanlar ve aday listesi yalnız
 * değerlendirme kaydına ve admin'e gider; boyacının adı ve adresi SADECE işi
 * devreden üreticiye açılır (boyacı sözleşmesi · config/network-map.ts).
 */

/**
 * Atamayı hangi olay tetikledi.
 *
 * Kelime dağarcığı KARAR KAYDININ kendisinden gelir (P4-C3 ·
 * services/painter-evaluation.ts). İkinci bir liste tutulsaydı, kodun bildiği
 * tetikleyiciler ile kayda yazılabilenler bir gün ayrışır ve yazıcı sessizce
 * reddedilen bir değer alırdı.
 */
export type PainterAssignTrigger = PainterAssignmentTrigger;

/**
 * OTOMATİK yerleştirmenin boyacı eylem günlüğündeki adı.
 *
 * Elle atamadan (`admin_assigned`) ayrı tutulur, çünkü SLA kuralı tam olarak bu
 * ayrımı sorar: cevapsız kalan iş YALNIZ otomatik atandıysa yeniden dağıtılır.
 * Admin bir boyacıyı elle seçtiyse o bir insan kararıdır ve sistem onu 24 saat
 * sonra kendi kendine bozamaz.
 */
export const PAINTER_AUTO_ASSIGNED_ACTION = "auto_assigned";

/**
 * P4-C2 sözleşmesinin dönüş tipi.
 *
 * `reason` ve `messageTr` ZORUNLUDUR ve hiçbir dalda boş kalmaz. Ölçülen kusur
 * tam buydu: beklenmeyen bir hatada cevap `{assigned:false}` oluyor, `skipped`
 * boş dönüyordu — rota 200 ile "atanmadı" diyor ama NEDEN atanmadığını ne ekran
 * ne günlük ne de admin öğrenebiliyordu.
 *
 * `skipped` kapalı kümedir (sözleşme) ve yalnız kuralın verdiği kararları
 * taşır; arıza hâlleri (`unexpected_error`, `parcel_in_transit`) `reason`da
 * durur. İki alanın ayrı olması, kümeye bakan çağıranların (SLA süpürmesinin
 * Türkçe sözlüğü) bir arıza değeriyle karşılaşmamasını sağlar.
 */
export interface AutoAssignPainterResult {
  assigned: boolean;
  painterId?: string;
  skipped?: PainterAssignSkip;
  /** HER ZAMAN dolu: "placed" ya da atlama/arıza sebebinin makine kodu. */
  reason: PainterAssignOutcomeReason | "placed";
  /** HER ZAMAN dolu: aynı cevabın Türkçesi (ekrana/bildirime gider). */
  messageTr: string;
  /**
   * Yerleştirme/karar GEÇERLİ ama gerekçe KAYDI yazılamadıysa Türkçe uyarı.
   *
   * İnsan yollarının (admin ataması, devir, değişim) cevabında bu uyarı zaten
   * vardı; otomatik yolda hiç yoktu. Alan İSTEĞE BAĞLI: kayıt yazıldıysa hiç
   * görünmez ve hiçbir çağıran bozulmaz.
   */
  recordWarningTr?: string;
}

/** Yerleştirilemeyen her dalın TEK çıkışı: sebep ve Türkçesi birlikte doğar. */
function unplacedResult(
  reason: PainterAssignOutcomeReason,
  recordWarningTr?: string | null
): AutoAssignPainterResult {
  return {
    assigned: false,
    // Kapalı küme korunur: arıza sebepleri `skipped`e sızmaz.
    skipped: isPainterAssignSkip(reason) ? reason : undefined,
    reason,
    messageTr: `Boyacı atanmadı: ${painterAssignReasonTr(reason)}.`,
    ...(recordWarningTr ? { recordWarningTr } : {}),
  };
}

/** Yerleştirmenin korumalı UPDATE'inden çıkan sonuç. */
export type PlacePainterResult =
  | { code: "ok"; painterId: string; orderNumber: string }
  | { code: "lost_race" }
  | { code: "painter_unavailable"; reason: string };

/**
 * Siparişin boyacıya devredilebilir hâlde OLDUĞUNU yazının içinde bir kez daha
 * soran koşullar.
 *
 * Ön okuma ile yazma arasına düşen bir iade, bir admin ataması ya da üreticinin
 * kendi devri bu koşullarda kapanır: üçü de siparişi "artık uygun değil" yapar
 * ve UPDATE hiçbir satırla eşleşmez.
 */
function painterHandoffConditions(orderId: string) {
  return [
    eq(orders.id, orderId),
    eq(orders.manufacturerStatus, "qc_approved"),
    // Sıralama sırasında kaldırılmış boyama için yeni bir iş yazılmaz.
    eq(orders.needsPainting, true),
    gt(orders.paintingPriceKurus, 0),
    notRefundedGuard(),
    ne(orders.status, "rejected"),
    sql`(${orders.painterStatus} IS NULL OR ${orders.painterStatus} = 'unassigned')`,
  ];
}

/**
 * Üreticiye devrin adresini yazan satırlar.
 *
 * Boyacının kimliği ve adresi YALNIZ burada, yalnız işi fiilen devreden
 * üreticiye açılır. Adres yoksa uydurulmaz: üretici "adres girilmemiş" cümlesini
 * okur ve admin'e sorar — yanlış bir adrese gönderilen baskının sahibi olmaz.
 */
function painterHandoffAddressTr(painter: {
  companyName: string;
  contactPerson: string | null;
  phone: string | null;
  address: {
    adres: string;
    mahalle?: string;
    ilce: string;
    il: string;
    postaKodu: string;
    telefon: string;
  } | null;
}): string {
  const lines = [`Boyacı: ${painter.companyName}`];
  if (painter.contactPerson) lines.push(`Yetkili: ${painter.contactPerson}`);
  const a = painter.address;
  if (a) {
    lines.push(
      "Teslimat adresi:",
      [a.adres, a.mahalle, `${a.ilce} / ${a.il}`, a.postaKodu]
        .filter((p) => !!p && String(p).trim().length > 0)
        .join(", ")
    );
    if (a.telefon) lines.push(`Adres telefonu: ${a.telefon}`);
  } else {
    lines.push(
      "Teslimat adresi: SİSTEMDE KAYITLI DEĞİL — göndermeden önce yöneticiye sorun."
    );
  }
  if (painter.phone) lines.push(`Telefon: ${painter.phone}`);
  return lines.join("\n");
}

/**
 * Boyacıya "yeni iş" bildirimi. Otomatik yol da admin'in elle ataması da AYNI
 * cümleyi gönderir: boyacı, işin nasıl seçildiğine göre farklı bir dil
 * okumamalı.
 */
export async function notifyPainterOfNewJob(args: {
  painterId: string;
  orderId: string;
  orderNumber: string;
}): Promise<void> {
  await notifyPainter({
    painterId: args.painterId,
    type: "order_assigned",
    subject: "Yeni boyama işi atandı",
    body:
      `${args.orderNumber} numaralı sipariş için yeni bir boyama işiniz var. ` +
      `Panelinizden inceleyip kabul edebilirsiniz.\n\n` +
      `Not: 24 saat içinde cevap verilmeyen işler otomatik olarak başka bir boyacıya aktarılır.`,
    orderId: args.orderId,
  }).catch((e) => console.error("notifyPainter (yeni boyama işi) failed", e));
}

/**
 * Üreticiye devir adresini bildirir.
 *
 * Boyacının kimliği ve adresi YALNIZ burada, yalnız işi fiilen devreden
 * üreticiye açılır (boyacı sözleşmesi). Ortak yardımcı olmasının sebebi de bu:
 * adresin nereye gittiği tek yerde okunabilmeli.
 */
export async function notifyManufacturerOfPainterHandoff(args: {
  manufacturerId: string;
  painterId: string;
  orderId: string;
  orderNumber: string;
}): Promise<void> {
  try {
    const painter = await db.query.painters.findFirst({
      where: eq(painters.id, args.painterId),
      columns: {
        companyName: true,
        contactPerson: true,
        phone: true,
        address: true,
      },
    });
    if (!painter) return;
    await notifyManufacturer({
      manufacturerId: args.manufacturerId,
      type: "system_announcement",
      subject: `Boyacı atandı — ${args.orderNumber}`,
      body:
        `${args.orderNumber} numaralı siparişin boyacısı belirlendi. ` +
        `Baskıyı müşteriye DEĞİL, aşağıdaki boyacıya gönderin.\n\n` +
        `${painterHandoffAddressTr(painter)}\n\n` +
        `Kargo bilgisini üretici panelindeki siparişe girin.`,
      orderId: args.orderId,
    });
  } catch (e) {
    console.error("notifyManufacturer (boyacı devri adresi) failed", e);
  }
}

/**
 * Devirde üreticinin BASKI payını tahakkuk ettirir.
 *
 * Üreticinin işi devirde biter, parası da orada yazılır. Hesap tek kaynaktan
 * gelir (earning-base.ts) ve `orderId` üzerinde tekildir: ret sonrası yeniden
 * yerleştirme ikinci kez ödemez.
 */
export async function accrueHandoffPrintEarning(args: {
  orderId: string;
  manufacturerId: string | null;
  painterId: string;
  amountKurus: number;
  productionBaseKurus: number | null;
  paintingPriceKurus: number;
}): Promise<void> {
  if (!args.manufacturerId) return;
  const printBaseKurus = manufacturerBaseKurus({
    amountKurus: args.amountKurus,
    productionBaseKurus: args.productionBaseKurus,
    paintingPriceKurus: args.paintingPriceKurus,
    painterId: args.painterId,
    paintsInHouse: false,
  });
  await accrueEarning(args.orderId, args.manufacturerId, printBaseKurus).catch((e) =>
    console.error("accrueEarning (baskı payı, boyacıya devir) failed", e)
  );
}

/**
 * Siparişi bir boyacıya yazan TEK yer (otomatik yollar için).
 *
 * Durum yazması ile onu haklı çıkaran kayıt AYNI işlemde, AYNI tutamaçla
 * yazılır: bir yerleştirmenin, onu kimin/neyin yaptığını söyleyen satırı
 * olmadan var olması mümkün olmamalı.
 *
 * İşlemden SONRA gelen üç adım (hakediş, bildirimler, realtime) bilerek
 * dışarıdadır:
 *  - `accrueEarning` KENDİ işlemini açar ve sipariş satırını kilitler; açık bir
 *    işlemin içinden çağrılsaydı kendi kilidini beklerdi (payouts.ts'teki
 *    lock_timeout notu) ve 5 sn sonra hata verirdi;
 *  - bildirim/SSE hataları yerleştirmeyi geri almamalı: iş devredildi, haber
 *    gitmediyse bu bir kayıt sorunudur, atamanın kendisi değil.
 */
export async function placePainterOnOrder(args: {
  orderId: string;
  painterId: string;
  trigger: PainterAssignTrigger;
  /** Devir kargosu (admin elle atarken girebilir). */
  carrier?: string | null;
  trackingNumber?: string | null;
  /** Eylem günlüğüne düşecek not (admin e-postası ya da tetiğin adı). */
  notes?: string | null;
}): Promise<PlacePainterResult> {
  const { orderId, painterId, trigger } = args;

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, painterId),
    columns: {
      id: true,
      status: true,
      acceptingOrders: true,
      maxConcurrentOrders: true,
      companyName: true,
      contactPerson: true,
      phone: true,
      address: true,
    },
  });
  if (!painter || painter.status !== "active") {
    return { code: "painter_unavailable", reason: "Seçilen boyacı aktif değil." };
  }
  if (!painter.acceptingOrders) {
    return { code: "painter_unavailable", reason: "Seçilen boyacı şu an iş almıyor." };
  }
  // KAPASİTE — ORTAK ÖLÇÜ (painter-capacity.ts). Burada kendi sayımımız YOK ve
  // olmamalı:
  //  • iade edilmiş iş SAYILMAZ (fazın kuralı: iade edilmiş sipariş kimseyi
  //    yerleştirmez, kimseyi cezalandırmaz, KİMSENİN KAPASİTESİNİ TÜKETMEZ),
  //  • ölçü AĞIRLIKLI birimdir, ham iş sayısı değil. Ölçülen kusur buydu: bu
  //    kapı iş SAYISI sayarken sıralayıcı ağırlıklı birim sayıyordu, yani
  //    kazananı seçen ölçü ile onu yazan ölçü ayrışıyordu — parti işi tutan bir
  //    boyacı ekranda kapalıyken buradan iş alabiliyordu.
  // Türkçe cümle de ortak kaynaktan gelir; üç insan ucu da aynı şeyi söyler.
  const capacity = await painterCapacityGate(painter.id);
  if (!capacity.ok) {
    return { code: "painter_unavailable", reason: capacity.error };
  }

  const now = new Date();
  const placed = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(orders)
      .set({
        painterId: painter.id,
        painterStatus: "assigned",
        assignedToPainterAt: now,
        sentToPainterAt: now,
        // Kargo alanları YENİDEN yazılır: eski değerler bir ÖNCEKİ boyacıya
        // gönderilen paketi anlatır ve yeni boyacının satırında dururlarsa
        // üretici yanlış kutuyu takip eder. Devredilmiş bir paketin izini
        // silmek tehlikeli olurdu; o yüzden paket yoldayken buraya hiç
        // gelinmez (assignPainterAutomatically · painterParcelOnTheWay).
        painterHandoffCarrier: args.carrier ?? null,
        painterHandoffTrackingNumber: args.trackingNumber || null,
        status: "painting",
        updatedAt: now,
      })
      .where(and(...painterHandoffConditions(orderId)))
      .returning();
    if (!updated) return null;
    // Gerekçe kaydı, geçişle AYNI işlemde: yerleştirme geri sarılırsa kayıt da
    // sarılır, kayıt yazılamazsa yerleştirme de olmaz.
    await tx.insert(painterActions).values({
      orderId,
      painterId: painter.id,
      action: PAINTER_AUTO_ASSIGNED_ACTION,
      notes: args.notes ?? `otomatik atama (${trigger})`,
    });
    return updated;
  });
  if (!placed) return { code: "lost_race" };

  // Devrin parası ve iki bildirimi ORTAK yardımcılardan gelir: admin'in elle
  // ataması da aynı üçünü çağırır, böylece "otomatik atanan iş" ile "admin'in
  // attığı iş" arasında para ya da haber farkı oluşamaz.
  await accrueHandoffPrintEarning({
    orderId,
    manufacturerId: placed.manufacturerId,
    painterId: painter.id,
    amountKurus: placed.amountKurus,
    productionBaseKurus: placed.productionBaseKurus,
    paintingPriceKurus: placed.paintingPriceKurus,
  });

  await notifyPainterOfNewJob({
    painterId: painter.id,
    orderId,
    orderNumber: placed.orderNumber,
  });

  if (placed.manufacturerId) {
    await notifyManufacturerOfPainterHandoff({
      manufacturerId: placed.manufacturerId,
      painterId: painter.id,
      orderId,
      orderNumber: placed.orderNumber,
    });
  }

  await emitOrderChanged({
    orderId: placed.id,
    orderNumber: placed.orderNumber,
    userId: placed.userId,
    manufacturerId: placed.manufacturerId,
    painterId: painter.id,
    status: placed.status,
    manufacturerStatus: placed.manufacturerStatus,
    painterStatus: placed.painterStatus,
  });

  return { code: "ok", painterId: painter.id, orderNumber: placed.orderNumber };
}

/**
 * Bayrağı doğuran sebep: yerleştirme sonuçları + ret üst sınırı.
 *
 * Üst sınır `PainterAssignOutcomeReason` kümesinde YOK, çünkü o küme
 * "yerleştirici baktı ve yerleştirmedi" demektir; üst sınır ise yerleştiriciye
 * hiç girilmeden, ret yolunda verilen bir karardır.
 */
export type PainterManualReason = PainterAssignOutcomeReason | "decline_cap";

/** Admin'e söylenecek şey: bir atama BEKLENİYOR mu, ve sonraki adım ne. */
interface PainterManualStep {
  /** Bu siparişte gerçekten bir boyacı ataması bekleniyor mu? */
  expected: boolean;
  /** Admin'in yapması gereken GERÇEK sonraki adım. */
  nextStepTr: string;
}

/**
 * SEBEP BAŞINA SONRAKİ ADIM — ölçülen kusurun kapatıldığı yer.
 *
 * Not ve e-posta, sebep ne olursa olsun "/admin/orders üzerinden elle boyacı
 * atayın" diyordu. Üreticisi boyamayı KENDİ yapan sipariş de bu cümleyi
 * alıyordu: oysa o siparişe boyacı ATANMAYACAK (painterAssignRowGate sonsuza
 * kadar `paints_in_house` ile atlar), yani admin yapılmaması gereken bir işe
 * çağrılıyordu. Aynı gürültünün içinde gerçekten atama bekleyen kayıtlar
 * (anahtar kapalı, aday yok, üst sınır) eşitleniyordu.
 *
 * `Record` BİLEREK: yeni bir sebep eklendiği gün sonraki adımı yazmayı unutmak
 * DERLEME hatası verir.
 */
const PAINTER_MANUAL_STEPS: Record<PainterManualReason, PainterManualStep> = {
  flag_off: {
    expected: true,
    nextStepTr:
      "Baskı üreticide hazır bekliyor. /admin/orders üzerinden elle boyacı atayın " +
      "ya da otomatik boyacı atama anahtarını yeniden açın.",
  },
  no_candidate: {
    expected: true,
    nextStepTr:
      "Baskı üreticide hazır bekliyor. /admin/orders üzerinden elle boyacı atayın " +
      "ya da /admin/painters üzerinden boyacıların kapasite ve iş alma ayarlarını gözden geçirin.",
  },
  unexpected_error: {
    expected: true,
    nextStepTr:
      "Baskı üreticide hazır bekliyor. /admin/orders üzerinden elle boyacı atayın; " +
      "hata tekrarlıyorsa sunucu günlüklerine bakın.",
  },
  parcel_in_transit: {
    expected: true,
    nextStepTr:
      "Baz baskı, işi bırakan boyacıya çoktan gönderilmiş: önce kolinin nerede olduğunu " +
      "netleştirin, sonra /admin/orders üzerinden yeni boyacıyı elle atayın. Paket yoldayken " +
      "sistem işi kendiliğinden devretmez.",
  },
  decline_cap: {
    expected: true,
    nextStepTr:
      "Üst sınıra ulaşıldı; sistem bu sipariş için artık kendiliğinden denemeyecek. " +
      "/admin/orders üzerinden elle boyacı atayın ya da işi üreticinin kendi boyamasına çevirin.",
  },
  // ─── ATAMA BEKLENMEYEN HÂLLER: admin yapılmayacak bir işe ÇAĞRILMAZ ──────
  paints_in_house: {
    expected: false,
    nextStepTr:
      "Bu siparişe boyacı ATANMAYACAK: boyamayı üretici kendi yapıyor. Baskı da boyama da " +
      "üreticide; sipariş üreticinin kargolamasını bekliyor, yönetici ataması gerekmiyor.",
  },
  refunded: {
    expected: false,
    nextStepTr:
      "Sipariş iade edilmiş: boyacı atanmaz ve hiçbir partner cezalandırılmaz. " +
      "Bu sipariş için yapılacak bir atama yok.",
  },
  not_needed: {
    expected: false,
    nextStepTr:
      "Siparişte boyama kalemi yok ya da baskı henüz QC'den geçmedi; boyacı ataması " +
      "beklenmiyor. Sipariş boyamalı olmalıysa kalemleri ve üretici QC'sini kontrol edin.",
  },
  already_assigned: {
    expected: false,
    nextStepTr: "Sipariş bu sırada başka bir boyacıya atandı; yapılacak bir işlem yok.",
  },
};

/** Sebebi bilinmeyen (ya da geçilmeyen) çağrı için güvenli, genel adım. */
const PAINTER_MANUAL_STEP_FALLBACK: PainterManualStep = {
  expected: true,
  nextStepTr: "Sipariş boyacısız bekliyor; /admin/orders üzerinden elle boyacı atayın.",
};

/** Sebebin sonraki adımı. SAF — testten doğrudan çağrılabilir. */
export function painterManualNextStep(reason?: PainterManualReason): PainterManualStep {
  return reason ? PAINTER_MANUAL_STEPS[reason] : PAINTER_MANUAL_STEP_FALLBACK;
}

/**
 * Siparişe [BOYACI] notu EKLER ve admin'e e-posta atar.
 *
 * Üretici tarafındaki flagManualAssignment'ın ikizi ve aynı sebeple var:
 * boyacısız kalan sipariş sessizce beklerse kimse haberdar olmaz. Not SQL'de
 * BİRLEŞTİRİLİR — araya giren [SLA]/[ATAMA]/[N12] bayrakları ezilmez.
 *
 * `reasonCode` İSTEĞE BAĞLIDIR: geçilmediğinde eski genel cümle yazılır, yani
 * bu modülün dışındaki çağıran (boyacı ret rotasının beklenmeyen-hata dalı)
 * değişmeden çalışır. Geçildiğinde not da e-posta da SEBEBİN gerçek sonraki
 * adımını söyler — ve atama beklenmeyen hâllerde "atayın" demez.
 *
 * ASLA fırlatmaz: not da e-posta da kendi içinde yakalanır.
 */
export async function flagPainterManualAssignment(args: {
  orderId: string;
  orderNumber: string;
  reason: string;
  reasonCode?: PainterManualReason;
}): Promise<void> {
  const step = painterManualNextStep(args.reasonCode);
  // Baş cümle de doğru olmak zorunda: "yapılamadı" bir DENEMENİN başarısızlığını
  // anlatır, oysa kendi boyayan üreticinin siparişinde deneme hiç yapılmadı.
  const lead = step.expected
    ? `[BOYACI] Otomatik boyacı ataması yapılamadı: ${args.reason}.`
    : `[BOYACI] Bu siparişe otomatik boyacı atanmadı: ${args.reason}.`;
  const note = formatAdminNoteLine(`${lead} ${step.nextStepTr}`);
  try {
    await db
      .update(orders)
      .set({
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, args.orderId));
  } catch (err) {
    console.error(`[BOYACI] not yazılamadı: ${args.orderNumber}`, err);
  }

  const adminEmail = process.env.ADMIN_EMAIL || "system@figurunica.com";
  try {
    await getEmailQueue().add("admin-painter-assignment", {
      type: "admin_custom",
      to: adminEmail,
      orderNumber: args.orderNumber,
      customerName: "Admin",
      // Konu da ayrışır: "Boyacı ataması gerekli" diyen bir e-posta, atama
      // gerekmeyen siparişte gelen kutusunda YANLIŞ bir iş listesi kurardı.
      customSubject: step.expected
        ? `Boyacı ataması gerekli — ${args.orderNumber}`
        : `Boyacısız kalan sipariş — ${args.orderNumber}`,
      customBody:
        (step.expected
          ? `${args.orderNumber} numaralı sipariş otomatik olarak bir boyacıya atanamadı.\n\n`
          : `${args.orderNumber} numaralı sipariş otomatik boyacı atamasının dışında kaldı.\n\n`) +
        `Sebep: ${args.reason}\n\n` +
        step.nextStepTr,
      locale: "tr",
    });
  } catch (err) {
    console.error(
      `[BOYACI] elle atama e-postası kuyruğa alınamadı: ${args.orderNumber}`,
      err
    );
  }
}

/**
 * KARAR KAYDI YAZILAMADIYSA KALICI İZ BIRAKIR — otomatik yolun eksiğiydi.
 *
 * `recordPainterEvaluation` bir telemetri yazıcısıdır ve ASLA fırlatmaz: hata
 * hâlinde `false` döner. Üç insan yolu bu `false`u okuyup hem siparişe
 * [BOYACI KAYDI] notu düşüyor hem de cevaba Türkçe uyarı koyuyordu; OTOMATİK
 * yol — yani yerleştirmelerin ÇOĞUNLUĞU — dönüşü atıyordu. Sonuç: sunucu
 * günlüğünde bir `console.warn`, admin tarafında hiçbir şey.
 *
 * Not, insan yolundakiyle AYNI [BOYACI KAYDI] etiketini taşır (admin aynı
 * kelimeyle arayabilsin) ama cümlesi ayrıdır, çünkü otomatik yolda kaydı
 * yazılamayan karar YERLEŞTİRME de olabilir, "kimse uygun değildi" de — ikisine
 * aynı cümleyi yazmak birinde yalan olurdu.
 *
 * Dönüş: uyarı cümlesi (kayıt yazıldıysa null). ASLA fırlatmaz.
 */
async function notePainterDecisionUnrecorded(args: {
  recorded: boolean;
  orderId: string;
  trigger: PainterAssignTrigger;
  /** Yerleşen boyacı; "kimse yerleşmedi" kararında null. */
  placedPainterId: string | null;
}): Promise<string | null> {
  if (args.recorded) return null;
  const label = PAINTER_ASSIGNMENT_TRIGGER_LABELS_TR[args.trigger];
  const note = formatAdminNoteLine(
    args.placedPainterId
      ? `[BOYACI KAYDI] "${label}" kararının gerekçe kaydı yazılamadı. Boyacı ataması ` +
          `GEÇERLİDİR ve para etkilenmedi; yalnız "bu iş neden bu boyacıya gitti" dökümü ` +
          `bu karar için oluşmadı.`
      : `[BOYACI KAYDI] "${label}" kararında uygun boyacı bulunamadı ve bu kararın gerekçe ` +
          `kaydı da yazılamadı; "neden kimse uygun değildi" dökümü bu karar için oluşmadı. ` +
          `Sipariş boyacısız bekliyor.`
  );
  try {
    await db
      .update(orders)
      .set({
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, args.orderId));
  } catch (err) {
    console.warn(
      `[boyacı atama] değerlendirme uyarısı nota da yazılamadı (${args.orderId}):`,
      err
    );
  }
  return args.placedPainterId
    ? painterEvaluationWriteWarningTr("Sipariş otomatik olarak bir boyacıya atandı")
    : `Boyacı yerleştirilemedi ve bu kararın gerekçe kaydı yazılamadı: karar listesinde ` +
        `bu deneme görünmeyecek. Sipariş boyacısız bekliyor.`;
}

/**
 * Boyacısız kalan siparişi İNSANA ulaştırır — ya da bilerek susar.
 *
 * Kararı SAF kural verir (config/flags.ts · painterUnplacedNeedsAdmin), bu
 * yüzden "sessizce dönen dal" diye bir şey kalmaz. Ölçülen kusur buydu: yalnız
 * `no_candidate` dalı admin'e yazıyordu; `flag_off` ve `paints_in_house`
 * hiçbir şey söylemeden dönüyor, baskı üreticide bekliyor ve sipariş
 * boyacısızken kimsenin haberi olmuyordu.
 *
 * ASLA fırlatmaz (flagPainterManualAssignment kendi içinde yakalar).
 */
async function announceUnplacedPainter(args: {
  orderId: string;
  orderNumber: string;
  reason: PainterAssignOutcomeReason;
  painterDetached: boolean;
  /** Çağıran kendi bildirimini yapıyorsa (SLA süpürmesi) kapatılır. */
  enabled: boolean;
  /** Sebebin daha ayrıntılı Türkçe hâli; yoksa ortak sözlükten gelir. */
  detailTr?: string;
}): Promise<void> {
  if (!args.enabled) return;
  if (!painterUnplacedNeedsAdmin(args.reason, { painterDetached: args.painterDetached })) {
    return;
  }
  await flagPainterManualAssignment({
    orderId: args.orderId,
    orderNumber: args.orderNumber,
    reason: args.detailTr ?? painterAssignReasonTr(args.reason),
    // Sebebin METNİ ayrıntılı olabilir (detailTr), ama sonraki adımı KOD
    // belirler: ikisini tek dizeye karıştırmak, kendi boyayan üreticinin
    // siparişinde admin'i yine "elle atayın" diye çağırırdı.
    reasonCode: args.reason,
  });
}

/**
 * P4-C2: siparişe en uygun boyacıyı otomatik yerleştirir.
 *
 * ASLA FIRLATMAZ. Çağıranları (QC onayı rotası, boyacı reddi, SLA süpürmesi)
 * kendi işlerini çoktan commit etmiş durumdadır; buradan çıkan bir hata onların
 * cevabını "olmadı"ya çeviremez.
 */
export async function assignPainterAutomatically(
  orderId: string,
  opts?: {
    trigger?: PainterAssignTrigger;
    /** Bu denemeye özgü ek dışlama (ör. az önce reddeden/cevapsız boyacı). */
    excludePainterIds?: readonly string[];
    /** Aday kalmadığında admin'e not+e-posta gitsin mi (varsayılan: evet). */
    notifyAdminOnFailure?: boolean;
    /**
     * Bu çağrıdan hemen ÖNCE siparişten bir boyacı koparıldı mı (ret, 24 saat
     * sessizlik)? Sonucu DEĞİŞTİRMEZ, kimin haberdar olacağını değiştirir:
     * koparılmış bir siparişte ortada sahibi belirsiz kalmış FİZİKSEL bir baskı
     * vardır ve sebep ne olursa olsun bir insan bakmalıdır.
     */
    painterDetached?: boolean;
  }
): Promise<AutoAssignPainterResult> {
  const trigger = opts?.trigger ?? "qc_approve";
  const excluded = (opts?.excludePainterIds ?? []).filter((id) => !!id);
  const painterDetached = opts?.painterDetached === true;
  const notifyAdmin = opts?.notifyAdminOnFailure !== false;
  // Sipariş numarası try'ın DIŞINDA durur: beklenmeyen bir hatada da admin notu
  // ve e-postası yazılabilmeli. Numara okunamadıysa siparişin kimliğiyle
  // yazarız — notu hiç yazmamaktansa çirkin ama bulunabilir bir başlık.
  let orderNumber = orderId;
  try {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: {
        id: true,
        orderNumber: true,
        paymentStatus: true,
        needsPainting: true,
        manufacturerId: true,
        manufacturerStatus: true,
        painterId: true,
        painterStatus: true,
        // Fiziksel paketin izi: koparılmış bir siparişte hâlâ duruyorsa kutu
        // yola çıkmış demektir (aşağıdaki painterParcelOnTheWay kapısı).
        painterHandoffTrackingNumber: true,
        receivedByPainterAt: true,
      },
    });
    // Olmayan sipariş boyacıya da ihtiyaç duymaz. Küme kapalı olduğu için en
    // doğru üye bu; sebep günlüğe adıyla düşer.
    if (!order) {
      console.error(`otomatik boyacı ataması: sipariş bulunamadı ${orderId}`);
      return unplacedResult("not_needed");
    }
    orderNumber = order.orderNumber;

    let paintsInHouse = false;
    if (order.manufacturerId) {
      const mfg = await db.query.manufacturers.findFirst({
        where: eq(manufacturers.id, order.manufacturerId),
        columns: { paintsInHouse: true },
      });
      // Okunamayan/bulunamayan üretici "kendi boyamıyor" sayılır: boyacı
      // ataması KAPALI tarafa değil, işin yürüdüğü tarafa düşer — yanlış
      // atanan boyacı admin tarafından değiştirilebilir, atanmayan boyacı ise
      // siparişi sessizce bekletir.
      paintsInHouse = mfg?.paintsInHouse === true;
    }

    const flagEnabled = await isFlagEnabled("auto_assign_painter");
    const gate = painterAssignRowGate(
      {
        paymentStatus: order.paymentStatus,
        needsPainting: order.needsPainting,
        manufacturerStatus: order.manufacturerStatus,
        painterId: order.painterId,
        painterStatus: order.painterStatus,
        manufacturerPaintsInHouse: paintsInHouse,
      },
      flagEnabled
    );
    if (gate) {
      // ATLAMAK SESSİZ KALMAK DEĞİLDİR. Hangi atlamanın insana çıkacağına saf
      // kural karar verir: QC onayında "boyaması yok" olağandır ve susar, ama
      // anahtarın kapalı olması baskının üreticide öksüz beklemesi demektir;
      // koparılmış bir siparişte ise her sebep insana çıkar.
      await announceUnplacedPainter({
        orderId,
        orderNumber,
        reason: gate,
        painterDetached,
        enabled: notifyAdmin,
      });
      return unplacedResult(gate);
    }

    // ── FİZİKSEL PAKET YOLDAYSA KİMSE YERLEŞTİRİLMEZ ────────────────────────
    //
    // Boyacı işi bıraktığında (ya da cevap vermediğinde) sipariş satırı
    // koparılır, ama kargo alanları DURUR: kutu gerçekten yola çıktıysa tek izi
    // odur. İşi sıradaki boyacıya yazmak, fiziksel paketi artık işi olmayan bir
    // adrese giderken öksüz bırakırdı — iki boyacı, tek kutu, kimse sorumlu
    // değil. Sahibin kararı: bu hâlde karar ADMİNİNDİR.
    //
    // Kapı burada, sıralamadan ÖNCE durur (boşuna sorgu yok) ve SLA
    // süpürmesinin kuralıyla aynı cümleyi söyler (planPainterAcceptSla ·
    // parcelOnTheWay): iki ölçü ayrışırsa aynı sipariş bir yolda taşınır,
    // diğerinde taşınmazdı.
    if (painterParcelOnTheWay(order)) {
      await announceUnplacedPainter({
        orderId,
        orderNumber,
        reason: "parcel_in_transit",
        painterDetached,
        enabled: notifyAdmin,
        detailTr:
          "baskı, işi bırakan boyacıya çoktan gönderilmiş (kargo kaydı duruyor); " +
          "paket yoldayken iş otomatik devredilmez, kargoyu ve yeni boyacıyı yönetici kararlaştırmalı",
      });
      return unplacedResult("parcel_in_transit");
    }

    // DIŞLAMA SIRALAMANIN İÇİNDE uygulanır, sonradan süzülerek DEĞİL. Sonradan
    // süzmek kayda SEÇİLEMEYECEK bir "kazanan" bırakırdı: karar satırı bir
    // boyacıyı birinci gösterir, iş başkasına gider ve admin ayrışmayı "elle
    // atanmış olmalı" diye açıklardı (üretici tarafında ölçülen hata).
    let candidates: PainterCandidate[];
    try {
      candidates = await rankPaintersForOrder(orderId, {
        excludePainterIds: excluded,
      });
    } catch (e) {
      // Sıralayıcının hata politikası: KAPIYI BESLEYEN okuma (sipariş, boyacı
      // listesi, yük) kapalı düşer ve fırlatır. Yerleştirmeyi yapan taraf
      // olarak bunu "aday yok" sayarız — kapasitesi bilinmeyen bir boyacıya iş
      // yazmaktansa iş admin kuyruğunda bekler.
      console.error(`boyacı sıralaması okunamadı: ${orderId}`, e);
      await announceUnplacedPainter({
        orderId,
        orderNumber,
        reason: "no_candidate",
        painterDetached,
        enabled: notifyAdmin,
        detailTr: "boyacı sıralaması okunamadı (geçici sistem arızası)",
      });
      return unplacedResult("no_candidate");
    }

    const best = candidates.find((c) => c.eligible);
    if (!best) {
      // Karar KAYDI: iş admin kuyruğuna düştü ve bu gerçek bir karardır —
      // elenmiş adaylar "neden kimse uygun değildi"nin tek cevabıdır.
      const recorded = await recordPainterEvaluation({
        orderId,
        trigger,
        candidates,
        outcome: {
          kind: "no_eligible_candidate",
          reason: "no_eligible_painter",
        },
        excludedPainterIds: excluded,
        weightsVersion: painterWeightsVersion(),
      });
      const recordWarningTr = await notePainterDecisionUnrecorded({
        recorded,
        orderId,
        trigger,
        placedPainterId: null,
      });
      await announceUnplacedPainter({
        orderId,
        orderNumber,
        reason: "no_candidate",
        painterDetached,
        enabled: notifyAdmin,
        detailTr: "uygun (aktif, iş alan, kapasitesi olan) boyacı kalmadı",
      });
      return unplacedResult("no_candidate", recordWarningTr);
    }

    const placed = await placePainterOnOrder({
      orderId,
      painterId: best.painterId,
      trigger,
      notes: `otomatik atama (${trigger}) — puan ${Math.round(best.score)}`,
    });

    if (placed.code === "ok") {
      const recorded = await recordPainterEvaluation({
        orderId,
        trigger,
        candidates,
        outcome: { kind: "placed", painterId: best.painterId },
        excludedPainterIds: excluded,
        weightsVersion: painterWeightsVersion(),
      });
      const recordWarningTr = await notePainterDecisionUnrecorded({
        recorded,
        orderId,
        trigger,
        placedPainterId: best.painterId,
      });
      return {
        assigned: true,
        painterId: best.painterId,
        reason: "placed",
        messageTr: "Sipariş otomatik olarak bir boyacıya atandı.",
        ...(recordWarningTr ? { recordWarningTr } : {}),
      };
    }

    if (placed.code === "painter_unavailable") {
      // Sıralama ile yazma arasında aday elverişsizleşti (kapasite doldu, iş
      // almayı kapattı). İş admin kuyruğuna düştü, yani bu da GERÇEK bir
      // karardır ve kaydı tutulur. Bir sonraki tetik (ret, SLA) yeniden sıralar.
      const recorded = await recordPainterEvaluation({
        orderId,
        trigger,
        candidates,
        outcome: {
          kind: "no_eligible_candidate",
          reason: "winner_unavailable_at_write",
        },
        excludedPainterIds: excluded,
        weightsVersion: painterWeightsVersion(),
      });
      const recordWarningTr = await notePainterDecisionUnrecorded({
        recorded,
        orderId,
        trigger,
        placedPainterId: null,
      });
      await announceUnplacedPainter({
        orderId,
        orderNumber,
        reason: "no_candidate",
        painterDetached,
        enabled: notifyAdmin,
        detailTr: placed.reason,
      });
      return unplacedResult("no_candidate", recordWarningTr);
    }

    // KAYIT YAZILMAZ: korumalı UPDATE eşleşmediyse ortada BİZİM verdiğimiz bir
    // karar yoktur (araya iade, admin ataması ya da üreticinin kendi devri
    // girdi). "Sıraladım ama bir şey yapmadım" satırı bu tabloya yazılmaz —
    // yazılsaydı hiç yaşanmamış bir yerleştirme gerçeklerin arasına karışırdı.

    // Korumalı UPDATE eşleşmedi: araya iade, admin ataması ya da üreticinin
    // kendi devri girdi. Sebebi siparişin GÜNCEL hâlinden okuruz; uydurmayız.
    const now = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: { paymentStatus: true, painterId: true, needsPainting: true, paintingPriceKurus: true },
    });
    const lost: PainterAssignOutcomeReason =
      now?.paymentStatus === "refunded"
        ? "refunded"
        : !now || !now.needsPainting || now.paintingPriceKurus <= 0
          ? "not_needed"
          : now.painterId
            ? "already_assigned"
            : "no_candidate";
    // Kaybedilen yazma yeni bir karar değildir; para veya karar kaydı yok.
    // Ama hâlâ boyacı bekleyen iş admin'e görünmeli. İade, kaldırılan boyama
    // ve başka bir boyacıya atanmış iş için yeni bildirim gerekmez.
    if (lost === "no_candidate") {
      await announceUnplacedPainter({
        orderId,
        orderNumber,
        reason: lost,
        painterDetached,
        enabled: notifyAdmin,
      });
    }
    return unplacedResult(lost);
  } catch (err) {
    // Çağıran kendi işini commit etmiştir; burada fırlatmak ona yalan söylerdi.
    // AMA SESSİZ KALMAK DA YALAN: sipariş boyacısız kaldı ve bunu yalnız biz
    // biliyoruz. Ölçülen kusur buydu — hata yutuluyor, cevap sebepsiz dönüyor,
    // siparişte not yok, admin'e e-posta yok; baskı üreticide, kimsenin
    // kuyruğunda olmadan bekliyordu.
    console.error(`otomatik boyacı ataması hata verdi: ${orderId}`, err);
    await announceUnplacedPainter({
      orderId,
      orderNumber,
      reason: "unexpected_error",
      painterDetached,
      enabled: notifyAdmin,
    });
    return unplacedResult("unexpected_error");
  }
}

/**
 * Ret/cevapsızlık sonrası yeniden yerleştirmenin sonucu.
 *
 * `parcelInTransit` AYRI bir alandır, çünkü çağıranın söyleyeceği cümleyi o
 * değiştirir: baskıyı çoktan göndermiş bir üreticiye "baskıyı elinizde tutun"
 * demek, elinde olmayan bir şeyi beklettirmek olurdu.
 */
export type PainterRepickResult =
  | { action: "reassigned"; painterId: string }
  | {
      action: "admin_queue";
      reason:
        | PainterAssignOutcomeReason
        | typeof PAINTER_DECLINE_CAP_REASON
        | "repick_error";
      parcelInTransit: boolean;
    };

/**
 * Bir boyacı işi bıraktıktan (ya da 24 saat cevaplamadıktan) SONRA sıradaki
 * boyacıyı bulur.
 *
 * SAHİBİN KARARI — İŞ ÜRETİCİYE GERİ DÖNMEZ. Eski davranışta ret, siparişi
 * üreticinin "boyacıya gönder" adımına geri sarıyordu: üretici, kendi hatası
 * olmayan bir iş için ikinci kez boyacı seçmek zorunda kalıyordu. Artık sistem
 * seçer; üç denemeden sonra karar admin'indir.
 *
 * ASLA FIRLATMAZ — ve bu artık bir DİLEK değil, koddaki try/catch. Eskiden
 * sözleşme burada yazıyordu ama gövde korumasızdı: ilk satırdaki saf çağrının
 * fırlaması bile (ölçüldü) ret rotasını 500'e düşürüyor, boyacı koparılmış
 * hâlde kalıyor, üreticiye tek kelime gitmiyordu.
 */
export async function repickPainterAfterDecline(args: {
  orderId: string;
  orderNumber: string;
  /**
   * Siparişin kara listesi (BU ret dâhil), kilit altında okunmuş hâli.
   *
   * Sayı değil LİSTE alınır: üst sınır kararı için uzunluğu yeter, ama üst
   * sınır dolduğunda yazılan karar kaydı "kimler reddetti" sorusunu da
   * cevaplamalıdır — sayı, o cevabı taşıyamaz.
   */
  declinedPainterIds: readonly string[];
  trigger?: PainterAssignTrigger;
}): Promise<PainterRepickResult> {
  const trigger = args.trigger ?? "decline_retry";
  const declinedCount = args.declinedPainterIds.length;
  try {
    if (painterDeclinesExhausted(declinedCount)) {
      const reason = `${declinedCount} boyacı işi almadı (en fazla ${PAINTER_MAX_REPLACEMENTS} kez yeniden yerleştirilir)`;
      // KARAR KAYDI, admin notundan ÖNCE: üst sınırın dolması sahibin kararının
      // en keskin ânı (iş üreticiye geri dönmez, admin kuyruğuna düşer) ve bu
      // yol sıralayıcıyı hiç çağırmadığı için başka hiçbir yerde satır
      // yazılmıyordu — yani tam da kaydı en çok gereken hâl, iki yeni ekranda
      // da görünmezdi.
      const capRecorded = await recordPainterDeclineCapReached({
        orderId: args.orderId,
        trigger,
        excludedPainterIds: args.declinedPainterIds,
      });
      await flagPainterManualAssignment({
        orderId: args.orderId,
        orderNumber: args.orderNumber,
        // Kaydın yazılamadığı da admin'in okuduğu nota girer: bu dal
        // sıralayıcıyı hiç çalıştırmadığı için başka hiçbir yerde iz bırakmaz.
        reason: capRecorded
          ? reason
          : `${reason}; bu kararın gerekçe kaydı da yazılamadı`,
        reasonCode: "decline_cap",
      });
      return {
        action: "admin_queue",
        reason: PAINTER_DECLINE_CAP_REASON,
        parcelInTransit: false,
      };
    }

    // `painterDetached: true`: boyacı az önce koparıldı, yani ATLAMANIN HER
    // TÜRLÜSÜ bir insana çıkmalı. Eskiden yalnız "aday yok" dalı admin'e not ve
    // e-posta yazıyordu; anahtar kapalıyken ya da üretici kendi boyuyorken
    // sipariş boyacısız kalıyor, üreticiye "sizden bir işlem beklenmiyor"
    // deniyor ve kimse bakmıyordu.
    const placement = await assignPainterAutomatically(args.orderId, {
      trigger,
      painterDetached: true,
    });
    if (placement.assigned && placement.painterId) {
      return { action: "reassigned", painterId: placement.painterId };
    }
    return {
      action: "admin_queue",
      // "placed ama kimlik yok" olamaz; olursa arıza olarak okunur.
      reason: placement.reason === "placed" ? "unexpected_error" : placement.reason,
      parcelInTransit: placement.reason === "parcel_in_transit",
    };
  } catch (err) {
    // SÖZLEŞME BURADA TUTULUR. Ret çoktan commit oldu: buradan çıkan bir hata
    // boyacıya "reddedemediniz" dedirtemez, ama siparişi de sahipsiz
    // bırakamaz — bu yüzden fırlatmak yerine admin kuyruğuna yazılır.
    console.error(`boyacı yeniden yerleştirme hata verdi: ${args.orderId}`, err);
    await flagPainterManualAssignment({
      orderId: args.orderId,
      orderNumber: args.orderNumber,
      reason:
        "ret sonrası yeniden yerleştirme beklenmeyen bir hatayla durdu; sipariş boyacısız",
      reasonCode: "unexpected_error",
    }).catch((e) => console.error("[BOYACI] ret sonrası uyarı yazılamadı", e));
    return { action: "admin_queue", reason: "repick_error", parcelInTransit: false };
  }
}
