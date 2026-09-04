/**
 * Üreticiye giden ATÖLYE bildirimleri: seans açılışı (ön rezervasyon çağrısı)
 * ve kapanış (parti atandı / parti buharlaştı).
 *
 * Neden `workshop-notify.ts`'te DEĞİL: o modül `sessionJoinUrl` için
 * `workshop-session.ts`'i import ediyor. Kapanış bildirimini oraya koysaydık,
 * `closeSession` onu çağırdığı anda `workshop-session ↔ workshop-notify`
 * import döngüsü doğardı. Bu dosya `workshop-session.ts`'i import ETMEZ;
 * gerekli her şeyi `sessionId`'den kendisi okur.
 *
 * Kanal `notifyManufacturer`: hem panel kutusuna satır yazar hem e-posta
 * kuyruğuna iş atar. Gövde DÜZ METİNDİR — e-posta şablonu (`escHtml`) kaçışı
 * kendisi yapar, panel `whitespace-pre-line` ile satır sonlarını korur.
 *
 * Hiçbiri FIRLATMAZ: bir bildirim hatası, kapanış işleminin kendisini (paranın
 * dondurulduğu adım) asla geri almamalı.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopSessions } from "@/lib/db/schema";
import { workshopCommissionLadderLines } from "@/lib/config/workshop";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";

/**
 * `workshop-notify.ts` de aynı biçimlendiricileri tutuyor; oradan import etmek
 * yukarıda anlatılan döngüyü açardı, bu yüzden bilerek kopya.
 */
function formatDateTime(value: Date): string {
  return value.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatKurus(kurus: number): string {
  return `₺${(kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Seans + mekan; üreticisi olmayan seans bildirim üretmez. */
async function loadCommittedSession(sessionId: string) {
  const session = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.id, sessionId),
    with: { venue: true },
  });
  if (!session || !session.venue || !session.manufacturerId) return null;
  return { ...session, manufacturerId: session.manufacturerId, venue: session.venue };
}

type CommittedSession = NonNullable<Awaited<ReturnType<typeof loadCommittedSession>>>;

function venueLine(session: CommittedSession): string {
  const a = session.venue.address;
  return `${session.venue.name} — ${a.adres} (${a.ilce}/${a.il})`;
}

/**
 * Seans `open` yapıldığında üreticiye giden çağrı: tarihi ve kontenjanı bildirir
 * ve komisyon merdivenini gösterir.
 *
 * Üretici, katılım linki kapanmadan ÖNCE tarihi taahhüt eder; kapanışta parti
 * soğuk atama ve 24 saatlik kabul beklemesi olmadan doğrudan ona düşer. 5 günlük
 * pencereyi gerçekçi kılan şey budur — bu yüzden bu bildirim bir "sipariş atandı"
 * bildirimi değil, bir TAKVİM taahhüdü talebidir.
 */
export async function notifyManufacturerSessionOpened(
  sessionId: string
): Promise<void> {
  try {
    const session = await loadCommittedSession(sessionId);
    if (!session) return;

    const ladder = workshopCommissionLadderLines()
      .map((line) => `  • ${line}`)
      .join("\n");

    await notifyManufacturer({
      manufacturerId: session.manufacturerId,
      type: "workshop_session",
      subject: `Atölye seansı sizin için açıldı — ${session.venue.name}, ${formatDateTime(session.startsAt)}`,
      body:
        `${venueLine(session)}\n` +
        `Seans tarihi: ${formatDateTime(session.startsAt)}\n` +
        `Kontenjan: ${session.capacity} kişi\n` +
        `Kişi başı fiyat: ${formatKurus(session.pricePerSeatKurus)}\n` +
        `Katılım kapanışı: ${formatDateTime(session.joinClosesAt)}\n` +
        `Mekana teslim: ${formatDateTime(session.deliverBy)}\n\n` +
        `Katılım linki kapandığında, o ana kadar ödenmiş TÜM siparişler tek parti\n` +
        `hâlinde size atanır. Seansı açılışta taahhüt ettiğiniz için ayrıca kabul\n` +
        `etmeniz gerekmez; siparişler panelinize doğrudan "kabul edildi" olarak düşer.\n\n` +
        `Payınız parti büyüklüğüne göre belirlenir ve kapanışta DONAR — partideki\n` +
        `her sipariş aynı oranı taşır:\n${ladder}\n\n` +
        `Tarihi tutamayacaksanız kapanıştan önce bize haber verin.`,
    });
  } catch (err) {
    console.error(
      `[workshop] seans açılış bildirimi gönderilemedi (session ${sessionId})`,
      err
    );
  }
}

/**
 * Kapanış bildirimi. İki hâli var ve ikisi de gönderilmek zorunda:
 *  - parti doldu   → kaç figür, hangi oran, ne zaman teslim,
 *  - parti boş     → seans iptal edildi; üretici o tarih için ayırdığı kapasiteyi
 *                    serbest bırakabilmeli. Sessiz kalmak, üreticiyi gelmeyecek
 *                    bir parti için beklemede bırakır.
 */
export async function notifyManufacturerSessionClosed(
  sessionId: string,
  result: { orderCount: number; commissionRateBps: number }
): Promise<void> {
  try {
    const session = await loadCommittedSession(sessionId);
    if (!session) return;

    if (result.orderCount === 0) {
      await notifyManufacturer({
        manufacturerId: session.manufacturerId,
        type: "workshop_session",
        subject: `Atölye partisi iptal — ${session.venue.name}, ${formatDateTime(session.startsAt)}`,
        body:
          `${venueLine(session)}\n` +
          `Seans tarihi: ${formatDateTime(session.startsAt)}\n\n` +
          `Katılım linki kapandı ve bu seansa ödenmiş katılımcı olmadı. Seans iptal\n` +
          `edildi, size düşen bir parti yok. Bu tarih için ayırdığınız kapasiteyi\n` +
          `serbest bırakabilirsiniz.`,
      });
      return;
    }

    const sharePercent = (10000 - result.commissionRateBps) / 100;
    await notifyManufacturer({
      manufacturerId: session.manufacturerId,
      type: "workshop_session",
      subject: `Atölye partisi size atandı — ${session.venue.name}, ${result.orderCount} figür`,
      body:
        `${venueLine(session)}\n` +
        `Seans tarihi: ${formatDateTime(session.startsAt)}\n` +
        `Parti: ${result.orderCount} figür\n` +
        `Payınız: %${sharePercent} (parti büyüklüğüne göre donduruldu)\n` +
        `Mekana teslim: ${formatDateTime(session.deliverBy)}\n\n` +
        `Katılım linki kapandı ve parti kesinleşti. Siparişler panelinizde\n` +
        `"kabul edildi" durumunda görünür — açılışta taahhüt ettiğiniz için ayrıca\n` +
        `kabul etmeniz gerekmiyor.\n\n` +
        `Tüm parti mekana TEK sevkiyatla, yukarıdaki teslim tarihine kadar\n` +
        `ulaşmalı; katılımcılar figürlerini seansta boyayacak.`,
    });
  } catch (err) {
    console.error(
      `[workshop] seans kapanış bildirimi gönderilemedi (session ${sessionId})`,
      err
    );
  }
}
