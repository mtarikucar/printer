import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturerActions,
  manufacturers,
  orders,
  painterActions,
  painters,
} from "@/lib/db/schema";
import { currentModelRevision } from "@/lib/services/order-model";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import {
  MODEL_ACK_REQUIRED_ERROR,
  PARTNER_MODEL_ACK_ACTION,
  PARTNER_MODEL_REVISION_ACTION,
  formatModelRevisionNote,
  modelAckState,
  modelRevisionNoticeTr,
  partnerAckTargets,
  type ModelAckState,
  type PartnerKind,
} from "@/lib/config/partner-model-ack";

/**
 * P2-C3: yeni bir model sürümünü DUYURAN tek yer.
 *
 * Bir siparişe her yeni model sürümü yüklendiğinde (admin yüklemesi ya da
 * otomatik üretim) atanmış üretici ve boyacı; gelen kutusu + e-posta ile
 * bilgilendirilir, iki partner kanalına da realtime olay basılır ve her
 * partnerin KENDİ eylem günlüğüne bir duyuru satırı yazılır. O satır, ekranın
 * "onay bekliyor" kapısının dayanağıdır (bkz. config/partner-model-ack.ts).
 *
 * TASARIM NOTLARI
 *  - Asla fırlatmaz. Çağıran yükleme rotasıdır: dosyalar çoktan diske ve
 *    veritabanına yazılmıştır; bir SMTP ya da Redis arızası yüklemeyi 500'e
 *    çevirmemelidir. Her yan etki tek tek yakalanır ve sonuçta ne olduğu
 *    dönülür (rota bunu P2-C2'nin appliedSideEffects'ine koyar).
 *  - `import "server-only"` YOKTUR: order-draft.ts / worker zincirine girerse
 *    standalone Node worker crash-loop'a girer (2026-06-13).
 *  - `stage` tipi bilerek `string`: P2-C1'in ModelUploadStage birleşimi J1'in
 *    modülünde yaşıyor ve paralel yazılıyor; birleşim string'e atanabildiği
 *    için sözleşme bozulmadan bağımsız kalıyoruz.
 */
export interface NotifyOrderModelRevisionArgs {
  orderId: string;
  revision: number;
  uploadedByEmail?: string | null;
  /** P2-C1 ModelUploadStage değeri; tanınmayan değer genel cümleye düşer. */
  stage?: string | null;
  /** Admin'in sürüm notu (neden yeniden yüklendi). */
  note?: string | null;
  /**
   * Partnerin "gördüm" onayı istensin mi. Varsayılan true. Kayıt-amaçlı
   * aşamalarda (kargolanmış sipariş) rota false geçerek yalnız haber verir.
   */
  requireAck?: boolean;
}

export interface NotifyOrderModelRevisionResult {
  manufacturerId: string | null;
  painterId: string | null;
  manufacturerNotified: boolean;
  painterNotified: boolean;
  /** Üreticinin ekranı bu sürümü onaylayana kadar ileri adımları kapatacak mı. */
  manufacturerAckRequired: boolean;
  painterAckRequired: boolean;
}

/**
 * Bu partnere YAZILACAK duyuru numarası.
 *
 * Normalde siparişin geçerli sürümüdür. Ama geçerli sürüm OKUNAMADIYSA elde
 * yalnız çağıranın verdiği numara kalır ve o numara partnerin ZATEN ONAYLADIĞI
 * sürümün gerisinde kalabilir (araya başka bir yükleme girdiyse). modelAckState
 * en büyük DUYURU ile en büyük ONAYI kıyasladığı için böyle bir satır kapıyı
 * KAPATMAZ: yeni dosya kümesi yüklenmişken partner eski modele basmaya, QC'ye
 * sokmaya ve kargolamaya devam edebilirdi — bu fazın en sert kuralının tersi.
 *
 * Bu yüzden arızada kapı KAPALI tarafa düşer: duyuru numarası, partnerin
 * onayladığı sürümden en az bir fazla olur; partner yeni sürümü görmeden
 * ilerleyemez ve "gördüm" düğmesi kapıyı normal şekilde açar. Numaranın
 * şişmesi yalnız bu arıza dalında olur ve bildirim metni de aynı numarayı
 * kullanır — ekranla e-posta ayrışmaz.
 *
 * Onay günlüğü de okunamazsa yapılacak bir şey yoktur; o hâlde kapı zaten
 * readPartnerModelAck'in arıza dalında (pending: true) kapalıdır.
 */
async function announcementRevisionFor(
  orderId: string,
  partner: { kind: PartnerKind; id: string },
  revision: number,
  liveReadFailed: boolean
): Promise<number> {
  if (!liveReadFailed) return revision;
  const prior = await readPartnerModelAck(orderId, partner);
  if (prior.readFailed) return revision;
  return Math.max(revision, (prior.acknowledgedRevision ?? 0) + 1);
}

export async function notifyOrderModelRevision(
  args: NotifyOrderModelRevisionArgs
): Promise<NotifyOrderModelRevisionResult> {
  const { orderId } = args;
  const requireAck = args.requireAck !== false;

  // DUYURULAN SÜRÜM, siparişin O ANDA GEÇERLİ sürümüdür — çağıranın verdiği
  // numara değil.
  //
  // NEDEN: "bu sürümü geçerli yap" çağrısı kaynak sürümün numarasını (ör. 1)
  // geçiyor, oysa geri getirme eski dosya kümesini yeni bir sürüm (ör. 3)
  // olarak yayımlıyor. Duyuru 1 deseydi, onay durumu satırlardaki EN BÜYÜK
  // numaraya baktığı için (modelAckState) daha önce duyurulmuş 2'nin gerisine
  // düşer ve "onay bekliyor" kapısı hiç açılmazdı: üretici, dosya kümesi
  // değiştiği hâlde eski sürümü onaylamış görünmeye devam ederdi. Yükleme
  // yolunda iki numara zaten aynıdır; araya başka bir yükleme girdiyse yenisini
  // duyurmak da doğrudur — partner her hâlde EN YENİ kümeyi indirmelidir.
  //
  // Okuma BAŞARISIZ olursa numara artık "bilinmiyor" sayılır (liveRead.failed) —
  // yutulup sessizce çağıranın numarasına düşülmez; aşağıdaki duyuru o durumda
  // kapıyı kapalı tarafa çeker (announcementRevisionFor).
  const liveRead = await currentModelRevision(orderId).then(
    (r) => ({ revision: r, failed: false }),
    (e) => {
      console.error("notifyOrderModelRevision: current revision read failed", e);
      return { revision: null as number | null, failed: true };
    }
  );
  const live = liveRead.revision;
  const revision = Math.max(args.revision, live ?? args.revision);
  // Onay, işi ELİNDE TUTANDAN istenir. Tek bayrak iki partnere birden onay
  // satırı yazıyordu: boyama aşamasında üretici, kendisinden istenmeyen bir
  // onay yüzünden kargo/boyacıya devir adımlarından kilitleniyordu.
  const ackTargets = partnerAckTargets(args.stage, requireAck);

  const order = await db.query.orders
    .findFirst({
      where: eq(orders.id, orderId),
      columns: {
        id: true,
        orderNumber: true,
        userId: true,
        status: true,
        manufacturerId: true,
        manufacturerStatus: true,
        painterId: true,
        painterStatus: true,
      },
    })
    .catch((e) => {
      console.error("notifyOrderModelRevision: order read failed", e);
      return null;
    });

  const result: NotifyOrderModelRevisionResult = {
    manufacturerId: order?.manufacturerId ?? null,
    painterId: order?.painterId ?? null,
    manufacturerNotified: false,
    painterNotified: false,
    manufacturerAckRequired: false,
    painterAckRequired: false,
  };
  if (!order) return result;

  const noteLine = args.note?.trim() ? `\n\nYönetici notu: ${args.note.trim()}` : "";
  const byLine = args.uploadedByEmail ? `\n\nYükleyen: ${args.uploadedByEmail}` : "";

  // ── Üretici ──────────────────────────────────────────────────────────────
  if (order.manufacturerId && order.manufacturerStatus !== "unassigned") {
    const announced = ackTargets.manufacturer
      ? await announcementRevisionFor(
          orderId,
          { kind: "manufacturer", id: order.manufacturerId },
          revision,
          liveRead.failed
        )
      : revision;
    const body =
      `${order.orderNumber} numaralı sipariş için modelin ${announced}. sürümü yüklendi.\n\n` +
      `${modelRevisionNoticeTr("manufacturer", args.stage)}` +
      noteLine +
      byLine;
    const notified = await notifyManufacturer({
      manufacturerId: order.manufacturerId,
      type: "model_revision",
      subject: `Model güncellendi (v${announced}) — ${order.orderNumber}`,
      body,
      orderId,
    })
      .then(() => true)
      .catch((e) => {
        console.error("notifyOrderModelRevision: manufacturer notify failed", e);
        return false;
      });
    result.manufacturerNotified = notified;

    if (ackTargets.manufacturer) {
      // Duyuru satırı ekranın kapısıdır: bildirim/e-posta başarısız olsa bile
      // yazılır, yoksa üretici eski modelle basmaya devam edebilirdi.
      const recorded = await db
        .insert(manufacturerActions)
        .values({
          orderId,
          manufacturerId: order.manufacturerId,
          action: PARTNER_MODEL_REVISION_ACTION,
          notes: formatModelRevisionNote(announced, args.note),
        })
        .then(() => true)
        .catch((e) => {
          console.error("notifyOrderModelRevision: manufacturerActions insert failed", e);
          return false;
        });
      result.manufacturerAckRequired = recorded;
    }
  }

  // ── Boyacı ───────────────────────────────────────────────────────────────
  if (order.painterId && order.painterStatus !== "unassigned") {
    const announced = ackTargets.painter
      ? await announcementRevisionFor(
          orderId,
          { kind: "painter", id: order.painterId },
          revision,
          liveRead.failed
        )
      : revision;
    const body =
      `${order.orderNumber} numaralı sipariş için modelin ${announced}. sürümü yüklendi.\n\n` +
      `${modelRevisionNoticeTr("painter", args.stage)}` +
      noteLine +
      byLine;
    const notified = await notifyPainter({
      painterId: order.painterId,
      type: "model_revision",
      subject: `Model güncellendi (v${announced}) — ${order.orderNumber}`,
      body,
      orderId,
    })
      .then(() => true)
      .catch((e) => {
        console.error("notifyOrderModelRevision: painter notify failed", e);
        return false;
      });
    result.painterNotified = notified;

    if (ackTargets.painter) {
      const recorded = await db
        .insert(painterActions)
        .values({
          orderId,
          painterId: order.painterId,
          action: PARTNER_MODEL_REVISION_ACTION,
          notes: formatModelRevisionNote(announced, args.note),
        })
        .then(() => true)
        .catch((e) => {
          console.error("notifyOrderModelRevision: painterActions insert failed", e);
          return false;
        });
      result.painterAckRequired = recorded;
    }
  }

  // İki partner konusuna da tek olay: panelleri (liste + detay) yeniden çeker.
  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    painterId: order.painterId,
    status: order.status,
    manufacturerStatus: order.manufacturerStatus,
    painterStatus: order.painterStatus,
  }).catch((e) => console.error("notifyOrderModelRevision: emit failed", e));

  return result;
}

/** Partnerin bu siparişteki duyuru/onay satırları (en yeni önce). */
async function partnerAckRows(
  orderId: string,
  partner: { kind: PartnerKind; id: string }
): Promise<{ action: string; notes: string | null; createdAt: Date }[]> {
  if (partner.kind === "manufacturer") {
    return db
      .select({
        action: manufacturerActions.action,
        notes: manufacturerActions.notes,
        createdAt: manufacturerActions.createdAt,
      })
      .from(manufacturerActions)
      .where(
        and(
          eq(manufacturerActions.orderId, orderId),
          eq(manufacturerActions.manufacturerId, partner.id)
        )
      )
      .orderBy(desc(manufacturerActions.createdAt));
  }
  return db
    .select({
      action: painterActions.action,
      notes: painterActions.notes,
      createdAt: painterActions.createdAt,
    })
    .from(painterActions)
    .where(and(eq(painterActions.orderId, orderId), eq(painterActions.painterId, partner.id)))
    .orderBy(desc(painterActions.createdAt));
}

export interface PartnerModelAckRead extends ModelAckState {
  acknowledgedAt: string | null;
  /**
   * Eylem günlüğü OKUNAMADI: aşağıdaki durum bilgiden değil TEMKİNDEN geliyor.
   * Çağıran, partnere "onay bekliyor" derken bunun bir karar değil arıza
   * olduğunu buradan ayırt eder.
   */
  readFailed: boolean;
}

/**
 * Bu partner için onay durumu. Ekran da sunucu da bunu çağırır; "onay
 * bekliyor" cevabı tek yerden gelir.
 */
export async function readPartnerModelAck(
  orderId: string,
  partner: { kind: PartnerKind; id: string }
): Promise<PartnerModelAckRead> {
  let rows: { action: string; notes: string | null; createdAt: Date }[];
  try {
    rows = await partnerAckRows(orderId, partner);
  } catch (e) {
    console.error("readPartnerModelAck: read failed", e);
    // OKUNAMAYAN GÜNLÜK "ONAY GEREKMİYOR" DEMEK DEĞİLDİR: kapalı tarafa düşülür.
    //
    // NEDEN: burada eskiden hata yutulup BOŞ satır listesi dönülüyordu.
    // modelAckState boş listeye "duyuru yok → pending:false" der, yani bu kapıya
    // dayanan HER uç — üreticinin beş ileri adımı (start/finish-printing,
    // submit-qc, send-to-painter, ship), boyacının QC/kargosu ve admin'in
    // partner adına işlemi — bir veritabanı sarsıntısında SESSİZCE açılırdı.
    // Oysa kapının tek işi, yeni sürüm yüklendikten sonra ESKİ modele basılmış
    // işin ilerlemesini ve kargolanmasını durdurmaktır. Yanlış açılmanın bedeli
    // (eski model müşteriye gider, iş baştan basılır) yanlış kapanmanın
    // bedelinden (partner birkaç dakika bekler, sonra yeniden dener)
    // kıyaslanamayacak kadar büyüktür.
    //
    // Sürüm numaraları bilinmediği için null kalır — uydurulmuş bir numara
    // partnerin görmediği bir sürümü onaylamasına yol açardı.
    return {
      announcedRevision: null,
      acknowledgedRevision: null,
      pending: true,
      acknowledgedAt: null,
      readFailed: true,
    };
  }
  const state = modelAckState(rows);
  const ackRow = rows.find((r) => r.action === PARTNER_MODEL_ACK_ACTION) ?? null;
  return {
    ...state,
    acknowledgedAt: ackRow?.createdAt?.toISOString() ?? null,
    readFailed: false,
  };
}

/**
 * Onay günlüğü OKUNAMADIĞINDA partnere dönecek cümle.
 *
 * NEDEN AYRI BİR CÜMLE: bu durumda partnere MODEL_ACK_REQUIRED_ERROR ("yeni bir
 * model sürümü yüklendi, onaylayın") gösteriliyordu — OLMAYAN bir olayı
 * anlatan bir cümle. Partner talimata uyup "Yeni sürümü gördüm" düğmesine
 * basıyor, recordPartnerModelAck tasarım gereği fırlıyor ve panel boş gövdeli
 * bir 500'ü "İşlem tamamlanamadı (HTTP 500)" diye gösteriyordu: kısa ama
 * çıkışsız bir döngü. Kapının KAPALI kalması doğrudur; yanlış olan gerekçedir.
 */
export const MODEL_ACK_UNAVAILABLE_ERROR =
  "Model onay kaydınız şu anda okunamadı (geçici sistem arızası). Güvenlik gereği bu adım durduruldu; lütfen birkaç dakika sonra tekrar deneyin.";

export interface ModelAckRefusal {
  /** Arıza 503 (geçici), onay bekliyor 409 (kural). */
  status: number;
  /** İstemcinin ayırt etmesi için makine-okur kod. */
  code: string;
  error: string;
}

/**
 * Kapının cevabı TEK yerde: engel yoksa null, varsa rotanın döneceği gövde.
 *
 * Rotalar `ack.pending`i kendileri okuyup ortak cümleyi yazıyordu; arıza dalı
 * (readFailed) o okumada görünmediği için partner yanlış gerekçeyi alıyordu.
 * Gerekçe ile HTTP kodunu birlikte üreten tek bir yardımcı, iki cümlenin
 * rotadan rotaya ayrışmasını da imkânsız kılar.
 *
 * KAPIYI OKUYAN HER UÇ BUNDAN GEÇMELİ. `ack.pending`i tek başına okuyan bir uç
 * arıza dalını yine yutar: partner, OLMAYAN bir yüklemenin ("yeni bir model
 * sürümü yüklendi, onaylayın") gerekçesini okur, o cümlenin işaret ettiği onay
 * düğmesine basar ve recordPartnerModelAck tasarım gereği fırladığı için boş
 * gövdeli bir 500 alır — kısa ve çıkışsız bir döngü. Hangi uçların bağlandığı
 * scripts/test-partner-model-ack.ts'te kurala bağlıdır.
 */
export function modelAckRefusal(ack: PartnerModelAckRead): ModelAckRefusal | null {
  if (ack.readFailed) {
    return { status: 503, code: "ack_log_unreadable", error: MODEL_ACK_UNAVAILABLE_ERROR };
  }
  if (ack.pending) {
    return { status: 409, code: "model_ack_required", error: MODEL_ACK_REQUIRED_ERROR };
  }
  return null;
}

/**
 * recordPartnerModelAck'in arıza dalında fırlattığı hatanın işareti.
 *
 * Onay ucu (ack-model) bunu yakalayıp 503 + MODEL_ACK_UNAVAILABLE_ERROR
 * dönebilsin diye dışa açıktır: aksi hâlde partnerin gördüğü tek şey boş
 * gövdeli bir 500 olur.
 */
export const ACK_LOG_UNREADABLE = "recordPartnerModelAck: partner action log unreadable";

export function isAckLogUnreadable(e: unknown): boolean {
  return e instanceof Error && e.message === ACK_LOG_UNREADABLE;
}

/**
 * Onay YAZIMI arızaya düştüyse (ack-model ucu) partnere dönecek gövde.
 *
 * Kapının 503'ü ile onay ucunun 503'ü AYNI yerden gelir: partner önce "bu adım
 * durduruldu, birkaç dakika sonra tekrar deneyin" diye okuyup, düğmeye
 * bastığında farklı (ya da boş) bir hikâye duymamalı. Hata bu arızaya ait
 * değilse null döner ve çağıran kendi 500'ünü verir — yutulmuş bir hata,
 * geçici arıza gibi gösterilmez.
 */
export function ackWriteFailureRefusal(e: unknown): ModelAckRefusal | null {
  if (!isAckLogUnreadable(e)) return null;
  return modelAckRefusal({
    announcedRevision: null,
    acknowledgedRevision: null,
    acknowledgedAt: null,
    pending: true,
    readFailed: true,
  });
}

export type RecordAckResult =
  | { code: "ok"; revision: number }
  | { code: "nothing_pending" }
  | { code: "stale"; announcedRevision: number };

/**
 * Partnerin "yeni sürümü gördüm" onayını yazar.
 *
 * Gönderilen sürüm, duyurulan sürümle aynı olmalıdır: iki sekmesi açık bir
 * partner eski sekmedeki düğmeye basıp henüz görmediği bir sürümü
 * onaylayamasın.
 */
export async function recordPartnerModelAck(args: {
  orderId: string;
  partner: { kind: PartnerKind; id: string };
  revision: number;
  note?: string | null;
  /** Admin partner adına onayladıysa (J4) kimliği not satırına yazılır. */
  byAdminEmail?: string | null;
}): Promise<RecordAckResult> {
  const state = await readPartnerModelAck(args.orderId, args.partner);
  // Günlük okunamadıysa onay YAZILMAZ ve "zaten onaylıydı" da denmez: hangi
  // sürümün duyurulduğu bilinmiyorken yazılacak satır yanlış sürümü kapatır,
  // partnere dönecek "başarılı" cevabı ise kapıyı (pending:true) açılmış
  // gösterirdi. Fırlatmak dürüst cevaptır — aşağıdaki INSERT de aynı arızada
  // zaten fırlıyordu, tek fark hatanın ONAYDAN ÖNCE görünmesi.
  if (state.readFailed) {
    throw new Error(ACK_LOG_UNREADABLE);
  }
  if (!state.pending || state.announcedRevision == null) {
    return { code: "nothing_pending" };
  }
  if (args.revision !== state.announcedRevision) {
    return { code: "stale", announcedRevision: state.announcedRevision };
  }

  const suffix = args.byAdminEmail
    ? `admin ${args.byAdminEmail} partner adına onayladı${args.note?.trim() ? ` — ${args.note.trim()}` : ""}`
    : args.note;
  const notes = formatModelRevisionNote(state.announcedRevision, suffix);

  if (args.partner.kind === "manufacturer") {
    await db.insert(manufacturerActions).values({
      orderId: args.orderId,
      manufacturerId: args.partner.id,
      action: PARTNER_MODEL_ACK_ACTION,
      notes,
    });
  } else {
    await db.insert(painterActions).values({
      orderId: args.orderId,
      painterId: args.partner.id,
      action: PARTNER_MODEL_ACK_ACTION,
      notes,
    });
  }

  // Yönetici tarafı da anında görsün: onay, siparişin kendi odasına düşer.
  const ord = await db.query.orders
    .findFirst({
      where: eq(orders.id, args.orderId),
      columns: {
        orderNumber: true,
        userId: true,
        status: true,
        manufacturerId: true,
        manufacturerStatus: true,
        painterId: true,
        painterStatus: true,
      },
    })
    .catch(() => null);
  if (ord) {
    await emitOrderChanged({
      orderId: args.orderId,
      orderNumber: ord.orderNumber,
      userId: ord.userId,
      manufacturerId: ord.manufacturerId,
      painterId: ord.painterId,
      status: ord.status,
      manufacturerStatus: ord.manufacturerStatus,
      painterStatus: ord.painterStatus,
    }).catch(() => {});
  }

  return { code: "ok", revision: state.announcedRevision };
}

/** Partnerin adı — bildirim metinleri ve admin ekranı için. */
export async function partnerDisplayName(partner: {
  kind: PartnerKind;
  id: string;
}): Promise<string | null> {
  if (partner.kind === "manufacturer") {
    const row = await db.query.manufacturers
      .findFirst({ where: eq(manufacturers.id, partner.id), columns: { companyName: true } })
      .catch(() => null);
    return row?.companyName ?? null;
  }
  const row = await db.query.painters
    .findFirst({ where: eq(painters.id, partner.id), columns: { companyName: true } })
    .catch(() => null);
  return row?.companyName ?? null;
}

/**
 * Siparişin GÜNCEL model sürümü.
 *
 * TEK UYGULAMA: kural ve sorgu `services/order-model.ts` içindeki
 * `currentModelRevision`tedir; burası yalnız onu çağırır. Eskiden iki ayrı
 * uygulama vardı (biri sürümleri artan, diğeri azalan sırada tarayıp dosya
 * anahtarı eşleştiriyordu) ve ikisi de "geçerli sürüm" sorusuna anahtar
 * eşlemesiyle cevap veriyordu. İki kopya ayrışırsa QC kapısı ile üreticinin
 * indirdiği dosya ayrışır; bu isim yine de duruyor çünkü QC uçları onu
 * çağırıyor.
 */
export async function currentOrderModelRevision(orderId: string): Promise<number | null> {
  return currentModelRevision(orderId);
}
