/**
 * Takım çalışma alanı (0072) — SAF yetki çekirdeği.
 *
 * Bir kurumsal müşteri tek hesapla çalışmıyor: teklifi açan mühendis, fiyatı
 * onaylayan satın alma ve faturayı isteyen muhasebe AYNI işi görmek zorunda.
 * Bu dosya o işin KİMİN NEYİ yapabileceğini söyleyen kapalı matristir.
 *
 * ─── ÜÇ DEĞİŞMEZ ───────────────────────────────────────────────────────────
 *
 * 1. `import "server-only"` YOK ve olmayacak. BullMQ worker'ı `order-draft.ts`
 *    üzerinden `src/lib/config/**`e ulaşıyor; `server-only` standalone-Node
 *    worker'ını crash-loop'a sokar (hit 2026-06-13, [[worker-server-only-trap]]).
 *    Aynı sebeple burada DB, `next/headers`, çerez ve oturum okuması da yok.
 * 2. SAF: her yüklem girdisinden deterministik bir boolean üretir. `schema.ts`
 *    buradaki iki listeden CHECK kurduğu (`quoteInList`) ve matris testi
 *    (`scripts/test-quote-team.ts`) veritabanına hiç bağlanmadığı için
 *    saflık bir tercih değil, iki ayrı zorunluluktur.
 * 3. RÜTBE (`RANK`) DIŞA AÇILMAZ. Rütbe bir uygulama ayrıntısıdır; karar veren
 *    yüklemlerdir. İhraç edilse her çağıran kendi karşılaştırmasını yazar ve
 *    matris tek yerde okunamaz hâle gelir.
 *
 * ─── SAHİBİN KARARI 6.5 (bağlayıcı) ────────────────────────────────────────
 *
 * Roller `owner` / `admin` / `member` / `viewer` ve **bir kullanıcı EN FAZLA
 * BİR takımda**. İkincisi bir yorum değil bir kısıt: `customer_team_members`
 * üzerinde `user_id` TEKİL (`customer_team_members_user_uq`). Çok takımlı
 * üyelik, takım seçici ve `?team=` parametresi YOKTUR.
 *
 * ─── BU SEVKİYATTA HİÇ ÇAĞRILMAZ ───────────────────────────────────────────
 *
 * `quote_teams_enabled` KAPALI doğar ve `quotes.team_id`yi OKUYAN tek satır
 * yoktur: kapılar T-2'de bağlanır. Dört teklif yüzeyi yüklemi
 * (`canEditTeamQuote`, `canChatOnQuote`, `canShareQuote`, `canSeeOwnerFields`)
 * bu yüzden BUGÜNKÜ ifadelerin birebir karşılığıdır — ölçülen hâl:
 * `quote-service.ts:1611` (`setShareToken`) ve `:1842` (`requote`),
 * `quote-present.ts:377-378` (`liveDraftReference`, `orderNumber`) ve `:395`
 * (`invoice`, `shareUrl`), `api/quotes/[id]/messages/route.ts:27,36`. Hepsi
 * bugün TEK bir koşul okuyor: `viewer.isOwner`. T-2 her birine tek satır
 * (`|| viewer.isTeam`) ekler; bugün o satırı yazmak, güvenlik testleri henüz
 * yokken bir yüzeyi genişletmek olurdu.
 */
import type { QuoteViewer } from "./quote-types";

export const TEAM_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/**
 * Davetle verilebilen roller — `owner` BİLEREK dışarıda. Sahiplik bir davetin
 * kabulüyle doğmaz; tek yolu devirdir (`canTransferOwnership`) ve "takım başına
 * tek sahip" kuralı DB düzeyinde kısmi tekil indeksle tutulur
 * (`customer_team_members_one_owner_idx`).
 */
export const TEAM_INVITE_ROLES = ["admin", "member", "viewer"] as const;
export type TeamInviteRole = (typeof TEAM_INVITE_ROLES)[number];

/**
 * Denetim izinin kapalı eylem kümesi (`customer_team_actions.action`).
 * `QUOTE_ADMIN_ACTIONS` deseni: liste BURADA durur, CHECK ondan üretilir
 * (`schema.ts` · `quoteInList(TEAM_ACTIONS)`), yani yeni bir eylem adı yeni bir
 * migration olmadan veritabanına giremez.
 */
export const TEAM_ACTIONS = [
  "team_created",
  "team_renamed",
  "billing_updated",
  "shipping_updated",
  "invite_sent",
  "invite_revoked",
  "invite_accepted",
  "role_changed",
  "member_removed",
  "member_left",
  "ownership_transferred",
  "quote_attached",
  "quote_detached",
  "checkout_cancelled",
] as const;
export type TeamAction = (typeof TEAM_ACTIONS)[number];

/** Davet ömrü: 7 gün. Süresi dolan davet SİLİNMEZ, denetim izinde kalır. */
export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

/** İHRAÇ EDİLMEZ (değişmez 3): rütbe bir ayrıntı, karar veren yüklemdir. */
const RANK: Record<TeamRole, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

// ─── Teklif yüzeyi: `QuoteViewer` alan yüklemler ───────────────────────────
//
// Dördü de `QuoteViewer` alır (`TeamRole` değil), çünkü T-2 ve T-4 bunları 22
// kapıda çağıracak ve `viewer` her kapıda elde. `QuoteViewer` T-2'de
// `isTeam`/`teamRole` kazanacak; imzalar o gün DEĞİŞMEZ, yalnız gövdeler bir
// satır uzar.

/**
 * Parça ekleme/silme, yeniden fiyatlama ve yeniden teklif.
 *
 * Bugün `viewer.isOwner`a DENK (`quote-service.ts:1842` · `requote`).
 * `viewer.canEdit` ile BİRLEŞTİRİLMEZ: `requote` süresi dolmuş ya da siparişe
 * dönmüş bir teklifte de çalışır ve tek koşulu sahipliktir.
 * T-2: `|| (viewer.isTeam && viewer.canEdit)` — takımın `viewer` rolü düzenlemez.
 */
export function canEditTeamQuote(viewer: QuoteViewer): boolean {
  return viewer.isOwner;
}

/**
 * Teklif sohbetine MÜŞTERİ olarak yazmak ve okundu damgası.
 *
 * Bugün `viewer.isOwner` (`api/quotes/[id]/messages/route.ts:27,36`). Admin
 * BİLEREK dışarıda: admin kendi ucundan yazar (`sender: 'admin'`); bu kapıyı
 * admin'e açmak müşteri adına mesaj yazmak olurdu.
 */
export function canChatOnQuote(viewer: QuoteViewer): boolean {
  return viewer.isOwner;
}

/**
 * Paylaşım bağlantısı üretmek / döndürmek / iptal etmek.
 * Bugün `viewer.isOwner` (`quote-service.ts:1611` · `setShareToken`).
 */
export function canShareQuote(viewer: QuoteViewer): boolean {
  return viewer.isOwner;
}

/**
 * Yalnız sahibe giden alanlar: `liveDraftReference`, `orderNumber`, `invoice`,
 * `shareUrl` (`quote-present.ts:377-378` ve `:395`).
 *
 * Bugün `viewer.isOwner`. Paylaşım izleyicisine bu alanlar GİTMEZ: hangi
 * firmanın teklifi olduğu ve hangi siparişe döndüğü, bağlantıyı eline geçiren
 * herkesin bilgisi değildir.
 */
export function canSeeOwnerFields(viewer: QuoteViewer): boolean {
  return viewer.isOwner;
}

// ─── Para kapıları: rol + takım ayarı ──────────────────────────────────────

/**
 * Teklifi ÖDEMEK. Varsayılan olarak DAR: `member_can_checkout` KAPALI doğar,
 * yani takım kurulduğunda ödemeyi yalnız owner/admin başlatabilir.
 *
 * `viewer` HİÇBİR hâlde ödeyemez — takım ayarı açık olsa bile. Ayar `member`
 * rolü için bir anahtardır, bütün takım için değil.
 */
export function canCheckoutQuote(
  role: TeamRole,
  team: { memberCanCheckout: boolean }
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role === "viewer") return false;
  return team.memberCanCheckout === true;
}

/**
 * Bekleyen bir ödemeyi (açık taslağı) İPTAL etmek.
 *
 * `member` yalnız KENDİ başlattığını iptal eder: bir meslektaşın havale
 * dekontunu beklediği taslağı iptal etmek, ödenmiş bir işi yarıda kesmek
 * olabilir. owner/admin her taslağı iptal eder (takımın parasının sorumlusu
 * onlar), `viewer` hiçbirini.
 *
 * `draftUserId` null = taslağı kim başlattığı bilinmiyor → `member` için kapı
 * KAPALI (fail-closed).
 */
export function canCancelCheckout(
  role: TeamRole,
  draftUserId: string | null,
  actorUserId: string
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role !== "member") return false;
  return draftUserId !== null && draftUserId === actorUserId;
}

// ─── Teklifi takıma bağlamak / ayırmak ─────────────────────────────────────
//
// Aynı kural iki kapı: `member` yalnız KENDİ açtığı teklifi bağlar ya da
// ayırır. İki ad ayrı durur çünkü T-4 ikisini ayrı uçlara bağlar ve kuralın
// birinde değişmesi (ör. ayırmayı yalnız admin'e bırakmak) diğerine sızmamalı.

function canMoveOwnWork(
  role: TeamRole,
  quoteUserId: string | null,
  actorUserId: string
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role !== "member") return false;
  return quoteUserId !== null && quoteUserId === actorUserId;
}

/** Teklifi takıma BAĞLAMAK. */
export function canAttachQuote(
  role: TeamRole,
  quoteUserId: string | null,
  actorUserId: string
): boolean {
  return canMoveOwnWork(role, quoteUserId, actorUserId);
}

/** Teklifi takımdan AYIRMAK. */
export function canDetachQuote(
  role: TeamRole,
  quoteUserId: string | null,
  actorUserId: string
): boolean {
  return canMoveOwnWork(role, quoteUserId, actorUserId);
}

// ─── Takım yönetimi: yalnız rol ────────────────────────────────────────────

/** Davet göndermek ve iptal etmek. */
export function canInvite(role: TeamRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Rol değiştirmek. İki asimetri birden uygulanır:
 *
 * - **Sahip rütbesi bu kapıdan HİÇ verilmez** (`nextRole === "owner"`): devir
 *   ayrı ve açık bir eylemdir (`canTransferOwnership`) ve "tek sahip" kuralını
 *   DB'de kısmi tekil indeks tutar.
 * - **Sahip bu kapıdan DÜŞÜRÜLEMEZ** (`targetRole === "owner"`): takım başına
 *   tek sahip olduğu için "hedef = owner" demek "hedef = sahibin kendisi"dir;
 *   kendini düşüren bir sahip takımı öksüz bırakır ve `canLeave("owner") ===
 *   false` kapısı boşa düşer.
 *
 * Kalanı rütbe sırası: sahip altındakileri serbestçe değiştirir, admin YALNIZ
 * kendinden düşük bir rütbeyi ve YALNIZ kendinden düşük bir rütbeye.
 */
export function canAssignRole(
  actorRole: TeamRole,
  targetRole: TeamRole,
  nextRole: TeamRole
): boolean {
  if (nextRole === "owner") return false;
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole !== "admin") return false;
  return RANK[targetRole] < RANK[actorRole] && RANK[nextRole] < RANK[actorRole];
}

/** Üye çıkarmak. Sahip çıkarılamaz; admin yalnız daha düşük rütbeyi çıkarır. */
export function canRemoveMember(actorRole: TeamRole, targetRole: TeamRole): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole !== "admin") return false;
  return RANK[targetRole] < RANK[actorRole];
}

/** Takımdan ayrılmak. Sahip AYRILAMAZ: önce sahipliği devreder. */
export function canLeave(role: TeamRole): boolean {
  return role !== "owner";
}

/** Takım adı, fatura ve teslimat bilgisini düzenlemek. */
export function canEditTeamProfile(role: TeamRole): boolean {
  return role === "owner" || role === "admin";
}

/** Takımı silmek. */
export function canDeleteTeam(role: TeamRole): boolean {
  return role === "owner";
}

/** Sahipliği devretmek. */
export function canTransferOwnership(role: TeamRole): boolean {
  return role === "owner";
}

/**
 * Davet e-postasının TEK normalizasyonu.
 *
 * İki yerde iki türlü normalize edilen bir adres `customer_team_invites_live_uq`
 * tekil indeksini sessizce atlatır (`(team_id, email)` üzerinde, canlı davetler
 * için): aynı kişi iki canlı davet alır, ikisini de kabul edemez ve ikinci
 * davet "neden çalışmıyor" diye desteğe düşer. Yazan ve arayan her yol bu
 * fonksiyondan geçer.
 */
export function normalizeTeamEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
