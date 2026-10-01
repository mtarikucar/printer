/**
 * Teklif bildirimleri: e-posta + uygulama içi + admin rozeti.
 *
 * İKİ KURAL bütün dosyayı biçimlendirir:
 *
 * 1. **Hiçbiri fırlatmaz.** Bildirim, tetikleyen işlemin yan etkisidir: SMTP
 *    düşükken "inceleme talebiniz alınamadı" demek, alınmış bir talebi
 *    müşteriye kaybettirmek olurdu. Her işlev kendi içinde `try/catch`lidir ve
 *    hata yalnız günlüğe yazılır.
 * 2. **Fiyat yazılmaz.** Gövdeler tutar taşımaz, teklife BAĞLANTI verir:
 *    e-posta fiyat kapısını tanımaz (anonim sahibin adresi de burada olabilir)
 *    ve bir tutar, sayfadaki tutardan bağımsız olarak eskir.
 *
 * `import "server-only"` YOK: saatlik bakım işi (`quote-maintenance`) bu
 * modülü BullMQ worker sürecinden çağırır.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { quoteFrameworks, quotes, users } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { escHtml, sendRawEmail } from "@/lib/services/email";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
}

function adminEmail(): string {
  return process.env.ADMIN_EMAIL || "system@figurunica.com";
}

interface QuoteRecipient {
  quoteId: string;
  number: string;
  title: string | null;
  url: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  marketingConsent: boolean;
}

/** Teklif + (varsa) sahibinin iletişim bilgisi. Anonim teklifte e-posta yoktur. */
async function loadRecipient(quoteId: string): Promise<QuoteRecipient | null> {
  const [row] = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      userId: quotes.userId,
      email: users.email,
      name: users.fullName,
      marketingConsent: users.marketingConsent,
    })
    .from(quotes)
    .leftJoin(users, eq(users.id, quotes.userId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!row) return null;
  return {
    quoteId: row.id,
    number: row.number,
    title: row.title,
    url: `${appUrl()}/teklif/${row.number}`,
    userId: row.userId,
    email: row.email,
    name: row.name,
    marketingConsent: row.marketingConsent ?? false,
  };
}

/** Bildirim gövdesinin ortak kabuğu — tek bir yerde biçimlenir. */
function emailHtml(heading: string, lines: string[], q: QuoteRecipient): string {
  const body = lines.map((line) => `<p>${escHtml(line)}</p>`).join("");
  const label = q.title ? `${q.number} — ${q.title}` : q.number;
  return `<div style="font-family:system-ui,sans-serif;line-height:1.6">
      <h1 style="font-size:20px">${escHtml(heading)}</h1>
      <p>${escHtml(q.name ?? "Merhaba")},</p>
      ${body}
      <p><a href="${escHtml(q.url)}">${escHtml(label)}</a></p>
    </div>`;
}

/** Müşteriye hem e-posta hem uygulama içi bildirim; ikisi de en iyi çaba. */
async function tellCustomer(
  q: QuoteRecipient,
  args: { type: string; subject: string; heading: string; lines: string[] }
): Promise<void> {
  if (q.userId) {
    await notifyCustomer({
      userId: q.userId,
      type: args.type,
      title: args.subject,
      body: `${q.number}: ${args.lines[0] ?? ""}`,
    });
  }
  if (q.email) {
    await sendRawEmail({
      to: q.email,
      subject: `${args.subject} (${q.number})`,
      html: emailHtml(args.heading, args.lines, q),
    });
  }
}

/** Admin kenar çubuğundaki rozeti tazeler (gövdesiz olay). */
async function nudgeAdmin(): Promise<void> {
  await publishRealtime([topics.admin()], { kind: "badge" });
}

/**
 * Her dışa açık işlevin ortak kabuğu: hata YUTULUR.
 *
 * Yutma sessiz değil — `console.error` çağrı yerini yazar, böylece SMTP/Redis
 * arızası günlükte görünür ama müşterinin işlemini düşürmez.
 */
async function safe(where: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(`[quote-notify] ${where} başarısız (ölümcül değil)`, err);
  }
}

/**
 * Müşteri manuel teklif / RFQ / hedef fiyat istedi.
 *
 * ÜÇ alıcı: müşteri (talebin alındığı), admin (yeni iş) ve admin rozeti.
 */
export async function notifyReviewRequested(quoteId: string): Promise<void> {
  await safe("notifyReviewRequested", async () => {
    const q = await loadRecipient(quoteId);
    if (!q) return;
    await tellCustomer(q, {
      type: "quote_review_requested",
      subject: "Teklif talebiniz alındı",
      heading: "Teklif talebiniz alındı",
      lines: [
        "Talebinizi aldık; ekibimiz teklifinizi inceleyip en kısa sürede fiyatlayacak.",
        "Teklifinizi aşağıdaki bağlantıdan takip edebilirsiniz.",
      ],
    });
    await sendRawEmail({
      to: adminEmail(),
      subject: `Yeni teklif incelemesi: ${q.number}`,
      html: emailHtml(
        "Yeni teklif incelemesi",
        [
          `${q.number} numaralı teklif inceleme sırasına girdi.`,
          q.email ? `Müşteri: ${q.name ?? ""} <${q.email}>` : "Müşteri: giriş yapmamış ziyaretçi",
        ],
        q
      ),
      ...(q.email ? { replyTo: q.email } : {}),
    });
    await nudgeAdmin();
  });
}

/** Admin manuel fiyatı girdi; teklif `quoted` oldu. */
export async function notifyManualQuoteReady(quoteId: string): Promise<void> {
  await safe("notifyManualQuoteReady", async () => {
    const q = await loadRecipient(quoteId);
    if (!q) return;
    await tellCustomer(q, {
      type: "quote_ready",
      subject: "Teklifiniz hazır",
      heading: "Teklifiniz hazır",
      lines: [
        "Ekibimiz teklifinizi fiyatladı; ayrıntıları ve geçerlilik süresini teklif sayfanızda görebilirsiniz.",
        "Onaylıyorsanız aynı sayfadan ödemeye geçebilirsiniz.",
      ],
    });
  });
}

const TARGET_LINES: Record<"accept" | "counter" | "reject", { subject: string; lines: string[] }> = {
  accept: {
    subject: "Hedef fiyatınız kabul edildi",
    lines: [
      "Önerdiğiniz birim fiyatı kabul ettik; teklifiniz bu fiyatla güncellendi.",
      "Teklif sayfanızdan ödemeye geçebilirsiniz.",
    ],
  },
  counter: {
    subject: "Hedef fiyatınıza karşı teklif",
    lines: [
      "Önerdiğiniz fiyatı karşılayamadık; teklif sayfanızda karşı teklifimizi bulabilirsiniz.",
      "Kabul ederseniz aynı sayfadan ödemeye geçebilirsiniz.",
    ],
  },
  reject: {
    subject: "Hedef fiyatınız hakkında",
    lines: [
      "Önerdiğiniz fiyatla bu işi üstlenemiyoruz; gerekçemizi teklif sayfanızdaki notta bulabilirsiniz.",
      "Parçaları ya da adetleri değiştirip yeniden deneyebilirsiniz.",
    ],
  },
};

/** Hedef fiyat kararı: kabul / karşı teklif / red. */
export async function notifyTargetDecision(
  quoteId: string,
  decision: "accept" | "counter" | "reject"
): Promise<void> {
  await safe("notifyTargetDecision", async () => {
    const q = await loadRecipient(quoteId);
    if (!q) return;
    const copy = TARGET_LINES[decision];
    await tellCustomer(q, {
      type: `quote_target_${decision}`,
      subject: copy.subject,
      heading: copy.subject,
      lines: copy.lines,
    });
  });
}

/**
 * Süresi dolmak üzere (bakım işi, üç gün kala).
 *
 * İŞLEMSELDİR: müşterinin elindeki teklifin sonlanacağını bildirmek bir
 * pazarlama iletisi değildir, ticari ileti izni aranmaz.
 */
export async function notifyQuoteExpiring(quoteId: string): Promise<void> {
  await safe("notifyQuoteExpiring", async () => {
    const q = await loadRecipient(quoteId);
    if (!q) return;
    await tellCustomer(q, {
      type: "quote_expiring",
      subject: "Teklifinizin süresi dolmak üzere",
      heading: "Teklifinizin süresi dolmak üzere",
      lines: [
        "Teklifiniz birkaç gün içinde geçerliliğini yitirecek.",
        "Süresi dolarsa teklif sayfanızdaki \"Yeniden fiyatla\" ile güncel katalogdan yeni bir fiyat alabilirsiniz.",
      ],
    });
  });
}

/**
 * Terk edilmiş teklif hatırlatması (24 saat).
 *
 * YALNIZ TİCARİ İLETİ İZNİ VARSA: bu bir satış hatırlatmasıdır (ETK 6563).
 * İzin yoksa hiçbir şey gönderilmez — uygulama içi bildirim de değil, çünkü
 * o da aynı satış amacını taşır.
 */
export async function notifyQuoteAbandoned(quoteId: string): Promise<void> {
  await safe("notifyQuoteAbandoned", async () => {
    const q = await loadRecipient(quoteId);
    if (!q || !q.marketingConsent) return;
    await tellCustomer(q, {
      type: "quote_abandoned",
      subject: "Teklifiniz sizi bekliyor",
      heading: "Teklifiniz sizi bekliyor",
      lines: [
        "Yarım kalan teklifinizi tamamlamak isterseniz parçalarınız ve fiyatınız hazır.",
        "Sorularınız için bu e-postayı yanıtlamanız yeterli.",
      ],
    });
  });
}

/**
 * Çerçeve anlaşma + sahibinin iletişim bilgisi.
 *
 * Teklifin alıcısından AYRI bir yükleyici, çünkü iki şey ayrışıyor: bağlantı
 * `/cerceve/<C-numarası>`dır (teklif değil, ANLAŞMA sayfası) ve
 * `quote_frameworks.user_id` NOT NULL'dur — anonim çerçeve YOK, yani "adresi
 * olmayan alıcı" hâli bu yüzeyde doğmaz.
 */
interface FrameworkRecipient {
  frameworkId: string;
  number: string;
  title: string | null;
  url: string;
  userId: string;
  email: string | null;
  name: string | null;
}

async function loadFrameworkRecipient(
  frameworkId: string
): Promise<FrameworkRecipient | null> {
  const [row] = await db
    .select({
      id: quoteFrameworks.id,
      number: quoteFrameworks.number,
      title: quoteFrameworks.title,
      userId: quoteFrameworks.userId,
      email: users.email,
      name: users.fullName,
    })
    .from(quoteFrameworks)
    .leftJoin(users, eq(users.id, quoteFrameworks.userId))
    .where(eq(quoteFrameworks.id, frameworkId))
    .limit(1);
  if (!row) return null;
  return {
    frameworkId: row.id,
    number: row.number,
    title: row.title,
    url: `${appUrl()}/cerceve/${row.number}`,
    userId: row.userId,
    email: row.email,
    name: row.name,
  };
}

/**
 * Bir partinin SERBEST BIRAKMA PENCERESİ açıldı (saatlik bakım işi).
 *
 * İŞLEMSELDİR, TİCARİ İLETİ DEĞİL: imzalanmış bir anlaşmanın parti planında
 * zamanın geldiğini bildirmek bir satış iletisi değildir, bu yüzden
 * `users.marketing_consent` ARANMAZ (terk hatırlatması aranır —
 * `notifyQuoteAbandoned`; ikisini karıştırmak ya İYS ihlali ya gereksiz bir
 * kapı olurdu). Yeni bir İYS onayı da gerekmez (tasarım §10 madde 4).
 *
 * İKİ ALICI, iki farklı cümle: serbest bırakma kararı ADMİN'indir (insansız
 * serbest bırakma yok, tasarım §1), yani eyleme çağıran mektup ona gider;
 * müşteriye giden mektup yalnız planının zamanının geldiğini söyler ve ona
 * yapacak bir iş YÜKLEMEZ — ödeme talebi partiyi serbest bıraktığımızda doğar.
 *
 * FİYAT YAZILMAZ (dosyanın 2. kuralı): gövde tutar taşımaz, anlaşmaya BAĞLANTI
 * verir. Anlaşmanın tutarı fiyat kapısının arkasındadır ve e-posta o kapıyı
 * tanımaz.
 */
export async function notifyFrameworkReleaseWindow(frameworkId: string): Promise<void> {
  await safe("notifyFrameworkReleaseWindow", async () => {
    const f = await loadFrameworkRecipient(frameworkId);
    if (!f) return;
    const label = f.title ? `${f.number} — ${f.title}` : f.number;
    const quoteLike: QuoteRecipient = {
      quoteId: f.frameworkId,
      number: f.number,
      title: f.title,
      url: f.url,
      userId: f.userId,
      email: f.email,
      name: f.name,
      marketingConsent: false,
    };
    await tellCustomer(quoteLike, {
      type: "framework_release_window",
      subject: "Çerçeve anlaşmanızın parti zamanı geldi",
      heading: "Çerçeve anlaşmanızın parti zamanı geldi",
      lines: [
        "Planladığımız partinin üretim penceresi açıldı: bu partiyi şimdi başlatırsak planlanan sevk tarihine yetişir.",
        "Ekibimiz partiyi serbest bırakıp ödeme talebini iletecek; anlaşmanızın güncel durumunu aşağıdaki bağlantıdan görebilirsiniz.",
      ],
    });
    await sendRawEmail({
      to: adminEmail(),
      subject: `Çerçeve partisi serbest bırakılmayı bekliyor: ${f.number}`,
      html: emailHtml(
        "Çerçeve partisi serbest bırakılmayı bekliyor",
        [
          `${label} anlaşmasında planlı bir partinin serbest bırakma penceresi açıldı.`,
          "Bugün bırakılmazsa planlanan sevk tarihi kayar.",
          f.email ? `Müşteri: ${f.name ?? ""} <${f.email}>` : "Müşteri adresi okunamadı",
        ],
        quoteLike
      ),
      ...(f.email ? { replyTo: f.email } : {}),
    });
    await nudgeAdmin();
  });
}

/** Teklif sohbetine yeni mesaj düştü. */
export async function notifyQuoteMessage(
  quoteId: string,
  from: "customer" | "admin"
): Promise<void> {
  await safe("notifyQuoteMessage", async () => {
    const q = await loadRecipient(quoteId);
    if (!q) return;
    if (from === "admin") {
      await tellCustomer(q, {
        type: "quote_message",
        subject: "Teklifinizle ilgili yeni mesaj",
        heading: "Teklifinizle ilgili yeni mesaj",
        lines: ["Ekibimiz teklif sohbetinize bir mesaj yazdı."],
      });
      return;
    }
    await sendRawEmail({
      to: adminEmail(),
      subject: `Teklif sohbetinde yeni mesaj: ${q.number}`,
      html: emailHtml(
        "Teklif sohbetinde yeni mesaj",
        [`${q.number} numaralı teklifin sohbetine müşteri bir mesaj yazdı.`],
        q
      ),
      ...(q.email ? { replyTo: q.email } : {}),
    });
    await nudgeAdmin();
  });
}
