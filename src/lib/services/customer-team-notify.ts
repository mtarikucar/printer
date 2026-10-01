/**
 * Takım çalışma alanının e-postaları (0072): davet, rol değişimi, üye çıkarma,
 * sahiplik devri.
 *
 * ─── BUNLAR İŞLEM BİLDİRİMİDİR, TİCARİ ELEKTRONİK İLETİ DEĞİL ──────────────
 *
 * Dördü de kişinin KENDİ hesabında olan bir değişikliği bildirir (bir takıma
 * davet edildi, rolü değişti, çıkarıldı, sahip oldu) ve hiçbiri ürün/kampanya
 * tanıtmaz. Bu yüzden ETK/İYS kapsamında ticari ileti SAYILMAZ:
 * `users.marketingConsent` ARANMAZ, İYS'ye KAYDEDİLMEZ ve takıma katılmak
 * ticari ileti onayı ÜRETMEZ. Terk hatırlatmasının hedefi
 * (`quote-maintenance.ts` · `eq(users.marketingConsent, true)`) bu dosyadan
 * etkilenmez ve DEĞİŞMEZ (tasarım §8).
 *
 * ─── `email.ts`İN `type` BİRLEŞİMİNE DOKUNULMAZ ────────────────────────────
 *
 * `workshop-notify.ts` deseni: gövdeler BURADA kurulur ve genel `sendRawEmail`
 * ile gider. Sipariş merkezli şablon kaydı (`EmailJobData`, `sendEmail`in `type`
 * birleşimi) takım bildirimleri için açılmaz — takımın sipariş numarası yok ve
 * o birleşime eklenen her değer kuyruk işçisini de değiştirir.
 *
 * TÜM dinamik değerler `escHtml`ten geçer. Çağıranlar `.catch()`ler: bir posta
 * arızası DB yazımını geri almamalı (davet satırı yazıldıysa davet VARDIR;
 * yönetici "yeniden gönder" ile yenileyebilir).
 */
import { escHtml, sendRawEmail } from "./email";
import { APP_TIME_ZONE } from "@/lib/config/timezone";
import type { TeamInviteRole, TeamRole } from "@/lib/config/quote-team";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const BRAND_FOOTER = `<p style="margin-top:24px;color:#999;font-size:12px;">Figurünica</p>`;

function wrap(inner: string): string {
  return `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color:#1f2937;">${inner}${BRAND_FOOTER}</div>`;
}

/** Rol adlarının Türkçesi. Sözlüğe GİRMEZ: e-posta gövdeleri satır içi Türkçedir. */
const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Sahip",
  admin: "Yönetici",
  member: "Üye",
  viewer: "İzleyici",
};

/** Rolün ne yapabildiği — davet edilen kişi neye onay verdiğini bilmeli. */
const ROLE_HINTS: Record<TeamRole, string> = {
  owner: "Takımın tamamını yönetir: üye ekler/çıkarır, bilgileri düzenler, ödeme yapar.",
  admin: "Üye davet eder, rolleri düzenler, takım bilgilerini günceller ve ödeme yapabilir.",
  member: "Teklif açar, parça ekler ve fiyatları görür; ödeme yetkisi takım ayarına bağlıdır.",
  viewer: "Teklifleri ve fiyatları yalnız GÖRÜR; değişiklik yapamaz, ödeme yapamaz.",
};

/**
 * Davet bağlantısının BİÇİMİ — tek kaynak.
 *
 * Ham token adresin içinde taşınır (DB'de yalnız sha256'sı var), bu yüzden
 * `encodeURIComponent`ten geçer: `base64url` bugün `+`/`/` üretmiyor ama token
 * üretimi değişirse adres sessizce bozulurdu.
 *
 * T-5 karşılama sayfasını (`/takim/davet/[token]`) yazacak ve girişi olmayan
 * ziyaretçiyi `/login?redirect=<bu yol>`a yollayacak — **`?redirect=`, `?next=`
 * DEĞİL** (depo deseni). Biçim burada kesinleşir ki e-postadaki adres ile
 * sayfanın beklediği adres ayrışamasın.
 */
export function teamInvitePath(rawToken: string): string {
  return `/takim/davet/${encodeURIComponent(rawToken)}`;
}

function teamInviteUrl(rawToken: string): string {
  return `${APP_URL}${teamInvitePath(rawToken)}`;
}

/**
 * Saat dilimi AÇIKÇA yazılır (`workshop-notify.ts`in aynı gerekçesi): sunucu ve
 * konteyner UTC'de koşuyor, davetin son günü ise müşterinin takvimindeki bir
 * TARİH. Belirtilmezse 7 günlük TTL'in son günü bir gün geride görünebilir ve
 * kişi daveti "süresi dolmuş sanıp" kullanmaz.
 */
function formatDate(value: Date): string {
  return value.toLocaleDateString("tr-TR", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Davet e-postası — HAM token'ın TEK tüketicisi.
 *
 * Gövde iki şeyi açıkça söyler: (a) kabul etmek için DAVET EDİLEN ADRESLE giriş
 * yapmak gerekir (kapı servis katmanında da var, ama kişi tıklamadan önce
 * bilmeli), (b) takıma katılınca neyin paylaşılacağı — dosyalar, fiyatlar ve
 * firma fatura bilgisi (tasarım §8, KVKK).
 */
export async function sendTeamInviteEmail(args: {
  email: string;
  teamName: string;
  role: TeamInviteRole;
  inviterName: string;
  rawToken: string;
  expiresAt: Date;
}): Promise<void> {
  const url = teamInviteUrl(args.rawToken);
  await sendRawEmail({
    to: args.email,
    subject: `${args.teamName} takımına davet edildiniz`,
    html: wrap(`
      <h1 style="color:#1a1a1a;font-size:20px;">${escHtml(args.teamName)} takımına davet edildiniz</h1>
      <p><strong>${escHtml(args.inviterName)}</strong>, sizi Figurünica'daki
      <strong>${escHtml(args.teamName)}</strong> takımına
      <strong>${escHtml(ROLE_LABELS[args.role])}</strong> olarak davet etti.</p>
      <p style="color:#6b7280;font-size:13px;">${escHtml(ROLE_HINTS[args.role])}</p>
      ${
        APP_URL
          ? `<p style="margin:24px 0;"><a href="${escHtml(url)}" style="display:inline-block;background:#16a34a;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Daveti görüntüle</a></p>`
          : ""
      }
      <p>Daveti kabul etmek için <strong>${escHtml(args.email)}</strong> adresiyle giriş yapmanız
      gerekir; başka bir hesapla bu davet kabul edilemez.</p>
      <p style="color:#6b7280;font-size:13px;">Davet ${escHtml(formatDate(args.expiresAt))}
      tarihine kadar geçerlidir ve tek kullanımlıktır.</p>
      <div style="margin:20px 0;padding:16px;background:#f9fafb;border-radius:12px;">
        <p style="margin:0;font-size:13px;color:#374151;">Takıma katıldığınızda, takıma bağlı
        tekliflerdeki 3B dosyalar, fiyatlar ve firma fatura bilgileri takımın diğer üyeleriyle
        karşılıklı olarak görünür olur. Kişisel adresiniz, telefonunuz ve adres defteriniz
        paylaşılmaz.</p>
      </div>
      <p style="color:#6b7280;font-size:13px;">Bu daveti beklemiyorduysanız hiçbir şey yapmanıza
      gerek yok: kabul edilmeyen davet süresi dolunca kendiliğinden geçersiz olur.</p>
    `),
  });
}

/** Rol değişimi bildirimi — kişi neyin değiştiğini ve ne anlama geldiğini görür. */
export async function sendTeamRoleChangedEmail(args: {
  email: string;
  teamName: string;
  previousRole: TeamRole;
  role: TeamRole;
}): Promise<void> {
  await sendRawEmail({
    to: args.email,
    subject: `${args.teamName} takımındaki rolünüz değişti`,
    html: wrap(`
      <h1 style="color:#1a1a1a;font-size:20px;">Takım rolünüz güncellendi</h1>
      <p><strong>${escHtml(args.teamName)}</strong> takımındaki rolünüz
      <strong>${escHtml(ROLE_LABELS[args.previousRole])}</strong> iken
      <strong>${escHtml(ROLE_LABELS[args.role])}</strong> olarak güncellendi.</p>
      <p style="color:#6b7280;font-size:13px;">${escHtml(ROLE_HINTS[args.role])}</p>
      ${
        APP_URL
          ? `<p style="margin:24px 0;"><a href="${APP_URL}/account/takim" style="display:inline-block;background:#16a34a;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Takımı görüntüle</a></p>`
          : ""
      }
    `),
  });
}

/**
 * Üye çıkarma bildirimi.
 *
 * Son paragraf bir söz değil bir GERÇEK: çıkarılan üyenin KENDİ açtığı teklifler
 * ona görünmeye devam eder (`quotes.user_id` üzerinden kişisel sahip dalı) ve
 * ödediği siparişler ona aittir — üye çıkarmak para taşımaz.
 */
export async function sendTeamMemberRemovedEmail(args: {
  email: string;
  teamName: string;
}): Promise<void> {
  await sendRawEmail({
    to: args.email,
    subject: `${args.teamName} takımından çıkarıldınız`,
    html: wrap(`
      <h1 style="color:#1a1a1a;font-size:20px;">Takım üyeliğiniz sona erdi</h1>
      <p><strong>${escHtml(args.teamName)}</strong> takımındaki üyeliğiniz sona erdi. Takımın
      tekliflerine erişiminiz bu andan itibaren kapandı.</p>
      <p style="color:#6b7280;font-size:13px;">Kendi açtığınız teklifler ve ödediğiniz siparişler
      sizde kalır: hesabınızdan görmeye ve yönetmeye devam edebilirsiniz.</p>
    `),
  });
}

/** Sahiplik devri bildirimi — YENİ sahibe gider. */
export async function sendTeamOwnershipTransferredEmail(args: {
  email: string;
  teamName: string;
}): Promise<void> {
  await sendRawEmail({
    to: args.email,
    subject: `${args.teamName} takımının sahibi oldunuz`,
    html: wrap(`
      <h1 style="color:#1a1a1a;font-size:20px;">Takımın sahipliği size devredildi</h1>
      <p><strong>${escHtml(args.teamName)}</strong> takımının sahipliği size devredildi. Artık
      üyeleri yönetebilir, takım bilgilerini düzenleyebilir ve takımı silebilirsiniz.</p>
      <p style="color:#6b7280;font-size:13px;">Önceki sahip takımda
      <strong>${escHtml(ROLE_LABELS.admin)}</strong> olarak kaldı.</p>
      ${
        APP_URL
          ? `<p style="margin:24px 0;"><a href="${APP_URL}/account/takim" style="display:inline-block;background:#16a34a;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Takımı görüntüle</a></p>`
          : ""
      }
    `),
  });
}
