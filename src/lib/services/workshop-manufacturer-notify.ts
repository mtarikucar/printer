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
 * Üretici bulunamadığında muhatap ADMİN'dir; o tek istisna da burada yaşıyor
 * (`notifyAdminSessionWithoutManufacturer`) — aynı seans verisini okuyor ve
 * ayrı bir modüle bölmek yalnızca aynı yükleyiciyi kopyalamak olurdu.
 *
 * Hiçbiri FIRLATMAZ: bir bildirim hatası, kapanış işleminin kendisini (paranın
 * dondurulduğu adım) asla geri almamalı.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopSessions } from "@/lib/db/schema";
import { workshopCommissionLadderLines } from "@/lib/config/workshop";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { getEmailQueue } from "@/lib/queue/queues";

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

/** Seans + mekan. Mekansız seans olamaz; yoksa bildirim üretilmez. */
async function loadSessionWithVenue(sessionId: string) {
  const session = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.id, sessionId),
    with: { venue: true },
  });
  if (!session || !session.venue) return null;
  return { ...session, venue: session.venue };
}

/** Üreticiye bildirim ancak ön rezerve bir üretici varsa gider. */
async function loadCommittedSession(sessionId: string) {
  const session = await loadSessionWithVenue(sessionId);
  if (!session || !session.manufacturerId) return null;
  return { ...session, manufacturerId: session.manufacturerId };
}

type SessionWithVenue = NonNullable<Awaited<ReturnType<typeof loadSessionWithVenue>>>;

function venueLine(session: SessionWithVenue): string {
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

/**
 * Seans admin tarafından İPTAL edildiğinde üreticiye gider.
 *
 * Zorunlu, çünkü iade her siparişin `manufacturerId`sini NULL yapıyor (bkz.
 * order-refund.ts): parti üreticinin kuyruğundan hiçbir iz bırakmadan
 * kayboluyor. Üretici o tarih için kapasite ayırmıştı — sessiz kalmak ona
 * gerçek slot kaybettirir. `notifyManufacturerSessionClosed`'ın "parti boş"
 * hâlinin elle iptal karşılığıdır.
 *
 * `leftWithManufacturerCount` sıfır değilse partide üreticiyi hâlâ ilgilendiren
 * sipariş var (figürü sevk edilmiş ya da iadesi tamamlanamamış); "her şeyi
 * bırakabilirsiniz" demek o durumda yanlış olurdu.
 */
export async function notifyManufacturerSessionCancelled(
  sessionId: string,
  result: { refundedCount: number; leftWithManufacturerCount: number }
): Promise<void> {
  try {
    const session = await loadCommittedSession(sessionId);
    if (!session) return;

    const tail =
      result.leftWithManufacturerCount > 0
        ? `\n\nDikkat: partideki ${result.leftWithManufacturerCount} sipariş bu iptalin\n` +
          `DIŞINDA kaldı (figürü sevk edilmiş ya da iadesi tamamlanamamış) ve\n` +
          `panelinizde durmaya devam edebilir. Bunlar için sizinle ayrıca\n` +
          `iletişime geçeceğiz.`
        : "";

    await notifyManufacturer({
      manufacturerId: session.manufacturerId,
      type: "workshop_session",
      subject: `Atölye seansı iptal edildi — ${session.venue.name}, ${formatDateTime(session.startsAt)}`,
      body:
        `${venueLine(session)}\n` +
        `Seans tarihi: ${formatDateTime(session.startsAt)}\n` +
        `İptal edilen sipariş: ${result.refundedCount}\n\n` +
        `Bu seans iptal edildi ve ödemesi alınmış katılımcıların parası iade\n` +
        `edildi. İptal edilen siparişler panelinizden düştü; bu tarih için\n` +
        `ayırdığınız kapasiteyi serbest bırakabilirsiniz.` +
        tail,
    });
  } catch (err) {
    console.error(
      `[workshop] seans iptal bildirimi gönderilemedi (session ${sessionId})`,
      err
    );
  }
}

/**
 * Kapanmış bir partiye SONRADAN düşen siparişler üreticiye bildirilir.
 *
 * Sipariş üreticinin panelinde zaten `accepted` olarak belirir, ama partiyi
 * "5 figür" diye duyurup altıncıyı sessizce eklemek, üreticinin beşini basıp
 * göndermesi demektir: geç ödeyen katılımcı seans günü figürsüz kalır.
 */
export async function notifyManufacturerOrdersAdopted(
  sessionId: string,
  /**
   * PARTİNİN atandığı üretici — seansın o anki `manufacturerId`'si DEĞİL.
   * Admin kapanıştan sonra seansın üreticisini değiştirmiş olabilir; haber
   * gitmesi gereken, kutuyu gerçekten hazırlayan taraftır.
   */
  manufacturerId: string,
  adoptedCount: number
): Promise<void> {
  try {
    const session = await loadSessionWithVenue(sessionId);
    if (!session) return;

    await notifyManufacturer({
      manufacturerId,
      type: "workshop_session",
      subject: `Atölye partisine ${adoptedCount} figür eklendi — ${session.venue.name}`,
      body:
        `${venueLine(session)}\n` +
        `Seans tarihi: ${formatDateTime(session.startsAt)}\n` +
        `Eklenen: ${adoptedCount} figür\n` +
        `Mekana teslim: ${formatDateTime(session.deliverBy)}\n\n` +
        `Ödemesi parti kapandıktan sonra tamamlanan ${adoptedCount} katılımcı daha\n` +
        `var. Siparişleri panelinize "kabul edildi" olarak eklendi ve partinin\n` +
        `donmuş oranını taşıyorlar.\n\n` +
        `Lütfen sevkiyattan önce parti adedini panelden tekrar kontrol edin.`,
    });
  } catch (err) {
    console.error(
      `[workshop] parti ekleme bildirimi gönderilemedi (session ${sessionId})`,
      err
    );
  }
}

/**
 * Ödenmiş siparişi olan bir seans ÜRETİCİSİZ kapandığında admin'e gider.
 *
 * Bu seans `in_production`'a geçmez, `closed`'da bekler: kimse basmıyor. Tek
 * uyarı kanalı sunucu log'u olsaydı, ödenmiş bir yığın sipariş kimsenin
 * bakmadığı bir durumda kalırdı.
 */
export async function notifyAdminSessionWithoutManufacturer(
  sessionId: string,
  orderCount: number
): Promise<void> {
  try {
    const session = await loadSessionWithVenue(sessionId);
    if (!session) return;

    await getEmailQueue().add("workshop-session-no-manufacturer", {
      type: "admin_custom",
      to: process.env.ADMIN_EMAIL || "system@figurunica.com",
      orderNumber: "",
      customerName: "Admin",
      customSubject: `Atölye partisi üreticisiz kapandı — ${session.venue.name} (${orderCount} sipariş)`,
      customBody:
        `${venueLine(session)}\n` +
        `Seans tarihi: ${formatDateTime(session.startsAt)}\n` +
        `Mekana teslim: ${formatDateTime(session.deliverBy)}\n` +
        `Ödenmiş sipariş: ${orderCount}\n\n` +
        `Katılım linki kapandı ama seansta ön rezerve üretici yok; parti kimseye\n` +
        `atanmadı. Seans "Katılım kapandı" durumunda bekliyor ve HİÇ KİMSE\n` +
        `basmıyor. Komisyon oranı dondu, siparişler ödendi.\n\n` +
        `Yapılması gereken: seansa bir üretici atayın ve siparişleri elle\n` +
        `üreticiye verin.`,
      locale: "tr",
    });
  } catch (err) {
    console.error(
      `[workshop] üreticisiz kapanış admin bildirimi gönderilemedi (session ${sessionId})`,
      err
    );
  }
}
