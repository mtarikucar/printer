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
 * ─── KAPILARIN BAĞLANDIĞI YER (T-4) ───────────────────────────────────────
 *
 * T-1 bu dosyayı yazdı ama HİÇBİR yüzey çağırmıyordu; T-2 erişim matrisine
 * takım dalını ekledi (`QuoteViewer.isTeam`/`teamRole`); T-4 ölçülen 22
 * `viewer.isOwner` kapısını TEK TEK bu yüklemlere çevirdi. Yani buradaki her
 * gövde artık canlı bir kapıdır ve bir satırını değiştirmek 22 yüzeyi birden
 * değiştirir — ölçülen çağrı yerleri:
 *
 *   `canEditTeamQuote`  → `quote-service.ts` (`requote`), `quote-banners.tsx`
 *   `canChatOnQuote`    → `api/quotes/[id]/messages/route.ts` (POST),
 *                         `quote-chat-panel.tsx` (yazma alanı)
 *   `canShareQuote`     → `quote-service.ts` (`setShareToken`),
 *                         `workspace-client.tsx` (paylaş düğmesi)
 *   `canSeeOwnerFields` → `quote-present.ts` (sahibe giden dört alan),
 *                         `messages` GET + `messages/read`, `quote-header.tsx`
 *                         (belge bağlantısı), `workspace-client.tsx`
 *   `canCheckoutQuote`  → `checkout`/`gift-card` uçları, `odeme/page.tsx`,
 *                         `quote-summary.tsx` (düğme VE cümlesi)
 *   `canCancelCheckout` → `checkout` ucunun DELETE'i, `quote-checkout.ts`
 *
 * `isOwner`IN ANLAMI DEĞİŞMEDİ (T-2 değişmez 4): her yüklem `isOwner`a EK
 * olarak takım yüklemini sorar; hiçbiri `isOwner`ı takımı da kapsayacak şekilde
 * yeniden tanımlamaz. Bayrak (`quote_teams_enabled`) KAPALIYKEN erişim kabuğu
 * rolü hiç okumaz, yani `isTeam` daima `false` döner ve buradaki her yüklem
 * bugünkü cevabına düşer — geri dönüş planı budur.
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

/**
 * Takım kurma formunda GÖSTERİLEN KVKK bilgilendirmesinin sürümü
 * (`customer_teams.kvkk_notice_version`).
 *
 * Metin değil SÜRÜM saklanır: "kurucu neye onay verdi" sorusunun cevabı, metnin
 * o günkü hâlidir ve metni kopyalamak satırı şişirip yine de eski bir kopyayı
 * dondurmaktı. Bilgilendirme METNİ değişirse bu sabit de artırılır — yoksa
 * farklı iki metne verilen onaylar veritabanında ayırt edilemez hâle gelir.
 *
 * Burada duruyor çünkü İKİ taraf da okumak zorunda: onayı yazan uç
 * (`POST /api/customer/team`) ve metni gösteren form (T-5). Saf modül ikisine de
 * açıktır (`server-only` yok, DB yok).
 */
export const TEAM_KVKK_NOTICE_VERSION = "2026-09-22";

/** İHRAÇ EDİLMEZ (değişmez 3): rütbe bir ayrıntı, karar veren yüklemdir. */
const RANK: Record<TeamRole, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

// ─── Teklif yüzeyi: `QuoteViewer` alan yüklemler ───────────────────────────
//
// Dördü de `QuoteViewer` alır (`TeamRole` değil), çünkü 22 kapının hepsinde
// elde olan şey `viewer`dır. `isOwner` dalı HER BİRİNDE ÖNCE sorulur: takım
// dalı bir EKLEMEDİR, bugünkü cevabın yerine geçen bir şey değil.
//
// TAKIM DALININ ÖLÇÜSÜ `viewer.canEdit`tir, `teamRole !== "viewer"` DEĞİL —
// aynı şeyi söylüyorlar (`resolveQuoteViewer` takım dalında
// `canEdit: teamRole !== "viewer"` yazıyor) ama rütbe karşılaştırmasını burada
// tekrarlamak, matrisin İKİNCİ bir kopyasını açmak olurdu. `isOwner` dalında
// `canEdit` SORULMAZ: kişisel sahip süresi dolmuş ya da siparişe dönmüş
// teklifte de bu kapılardan geçer (bugünkü ifade).

/**
 * Parça ekleme/silme, yeniden fiyatlama ve yeniden teklif.
 *
 * Kişisel sahipte `viewer.isOwner`a DENK (`quote-service.ts` · `requote`).
 * `viewer.canEdit` ile BİRLEŞTİRİLMEZ: `requote` süresi dolmuş ya da siparişe
 * dönmüş bir teklifte de çalışır ve kişisel sahipte tek koşulu sahipliktir.
 * Takımın `viewer` rolü düzenlemez.
 */
export function canEditTeamQuote(viewer: QuoteViewer): boolean {
  return viewer.isOwner || (viewer.isTeam && viewer.canEdit);
}

/**
 * Teklif sohbetine MÜŞTERİ olarak YAZMAK.
 *
 * Admin BİLEREK dışarıda: admin kendi ucundan yazar (`sender: 'admin'`); bu
 * kapıyı admin'e açmak müşteri adına mesaj yazmak olurdu.
 *
 * OKUMA bu kapıdan GEÇMEZ, `canSeeOwnerFields`ten geçer: takımın `viewer`
 * rolü yazışmayı okur ama yazmaz (`messages` GET 200, POST 404). İki ucun
 * ayrı yüklem okuması tam da bu asimetri içindir.
 */
export function canChatOnQuote(viewer: QuoteViewer): boolean {
  return viewer.isOwner || (viewer.isTeam && viewer.canEdit);
}

/**
 * Paylaşım bağlantısı üretmek / döndürmek / iptal etmek
 * (`quote-service.ts` · `setShareToken`).
 *
 * "Bu teklifi bağlantısı olan HERKESE açıyorum" kararı salt okunur bir üyenin
 * kararı değildir: takımın `viewer` rolü dışarıda.
 */
export function canShareQuote(viewer: QuoteViewer): boolean {
  return viewer.isOwner || (viewer.isTeam && viewer.canEdit);
}

/**
 * Yalnız sahibe giden alanlar: `liveDraftReference`, `orderNumber`, `invoice`,
 * `shareUrl` (`quote-present.ts`) + sohbetin OKUNMASI ve belge bağlantısı.
 *
 * Takımın DÖRT rolü de geçer (`canEdit` SORULMAZ): bu alanlar bir OKUMADIR ve
 * tasarım §4 fatura bilgisini TAKIMIN bilgisi sayıyor (firma/VKN, kişisel veri
 * değil). Kapıyı `canEdit` ile daraltmak, belgeye girebilen bir üyenin
 * bağlantıyı GÖREMEDİĞİ hâli üretirdi — "yetkisi var ama ekranı yok".
 *
 * Paylaşım izleyicisine bu alanlar GİTMEZ: hangi firmanın teklifi olduğu ve
 * hangi siparişe döndüğü, bağlantıyı eline geçiren herkesin bilgisi değildir.
 */
export function canSeeOwnerFields(viewer: QuoteViewer): boolean {
  return viewer.isOwner || viewer.isTeam;
}

// ─── Para kapıları: rol + takım ayarı ──────────────────────────────────────
//
// Para kapısının İKİ GİRİŞİ var ve ikisi de AYNI çekirdeği okur:
//
//   • `canCheckoutQuote(viewer, team)` — rota, sayfa ve ekran (izleyici elde).
//   • `teamRoleCanCheckout(role, team)` — SERVİS katmanı (`quote-checkout.ts`),
//     çünkü orada `viewer` YOK: servis bir istek nesnesi ve oturum görmez,
//     kimliği çağırandan alır.
//
// Çekirdeğin ayrı bir adı olması bir tercih değil zorunluluk: iki girişin tek
// gövdeyi paylaşmaması, "member ödeyebilir mi" sorusunun uçta ve serviste iki
// farklı cevap alabileceği gün demekti.

/**
 * Teklifi ÖDEMEK — ROL düzeyi. Varsayılan olarak DAR: `member_can_checkout`
 * KAPALI doğar, yani takım kurulduğunda ödemeyi yalnız owner/admin başlatabilir.
 *
 * `viewer` HİÇBİR hâlde ödeyemez — takım ayarı açık olsa bile. Ayar `member`
 * rolü için bir anahtardır, bütün takım için değil.
 */
export function teamRoleCanCheckout(
  role: TeamRole,
  team: { memberCanCheckout: boolean }
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role === "viewer") return false;
  return team.memberCanCheckout === true;
}

/**
 * Teklifi ÖDEMEK — İZLEYİCİ düzeyi; 22 kapının çağırdığı ifade.
 *
 * `team === null` (takımsız teklif, ya da üyeliği okunmamış istek) iken ifade
 * BUGÜNKÜNE DENK: yalnız kişisel sahip ödeyebilir. `team`in ZORUNLU olması
 * fail-closed bir karardır — rolü okuyup takım satırını okumamış bir çağıran
 * `member_can_checkout`u varsayılanıyla uydurmuş olurdu.
 *
 * ANONİM sahip bu kapıdan geçer ama uç katmanı onu ayrıca durdurur
 * (`quote_unclaimed`, 409): ödediği siparişin bağlanacağı bir hesabı yok.
 * Kapının kendisi bunu bilmez; hesabın varlığı bir SATIR gerçeğidir
 * (`quotes.user_id`), izleyicinin hakkı değil.
 */
export function canCheckoutQuote(
  viewer: QuoteViewer,
  team: { memberCanCheckout: boolean } | null
): boolean {
  if (viewer.isOwner) return true;
  if (!viewer.isTeam || viewer.teamRole === null || team === null) return false;
  return teamRoleCanCheckout(viewer.teamRole, team);
}

/**
 * Bekleyen bir ödemeyi (açık taslağı) İPTAL etmek — ROL düzeyi.
 *
 * `member` yalnız KENDİ başlattığını iptal eder: bir meslektaşın havale
 * dekontunu beklediği taslağı iptal etmek, ödenmiş bir işi yarıda kesmek
 * olabilir. owner/admin her taslağı iptal eder (takımın parasının sorumlusu
 * onlar), `viewer` hiçbirini.
 *
 * `member_can_checkout` BU KAPIDA SORULMAZ ve imza takımı hiç ALMAZ: ayar
 * ödeme BAŞLATMANIN anahtarıdır. Ayarı sonradan kapatılan bir takımda, kendi
 * taslağını iptal edemeyen bir üye hem ödeyemez hem düzenleyemez hâlde kalırdı
 * (teklif bekleyen taslak dururken salt okunurdur).
 *
 * `draftUserId` null = taslağı kim başlattığı bilinmiyor → `member` için kapı
 * KAPALI (fail-closed).
 */
export function teamRoleCanCancelCheckout(
  role: TeamRole,
  draftUserId: string | null,
  actorUserId: string
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role !== "member") return false;
  return draftUserId !== null && draftUserId === actorUserId;
}

/**
 * Bekleyen ödemeyi İPTAL etmek — İZLEYİCİ düzeyi.
 *
 * Kişisel sahip bugün olduğu gibi geçer (taslak onun teklifinde açıldı);
 * takım dalında karar taslağın SAHİBİNE bağlı, o yüzden `draftUserId`
 * zorunludur. Uç katmanı taslağı okumadan KABA bir kapı tutar ve kesin karar
 * `quote-checkout.ts`in İÇİNDE, taslak satırı AYNI işlemde okunduktan sonra
 * verilir (gerekçe orada).
 */
export function canCancelCheckout(
  viewer: QuoteViewer,
  draftUserId: string | null,
  actorUserId: string
): boolean {
  if (viewer.isOwner) return true;
  if (!viewer.isTeam || viewer.teamRole === null) return false;
  return teamRoleCanCancelCheckout(viewer.teamRole, draftUserId, actorUserId);
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

// ─── Davet kabulünün SAF ön koşulları ──────────────────────────────────────

/**
 * Bir davetin reddedilme sebepleri — KAPALI küme.
 *
 * Neden burada ve neden saf: ret sebebi bir KVKK kararıdır (hangi hesap hangi
 * takımın dosyalarını, fiyatlarını ve fatura bilgisini görebilir hâle gelir) ve
 * altı sebebin her birinin kendi testi ancak DB'siz taranabildiği sürece olur
 * (`scripts/test-quote-team.ts` tablo testi). Servis katmanı bu kodları
 * müşteriye giden TÜRKÇE cümleye ve tasarım §8'in kod kümesine çevirir —
 * `invite_revoked` ile `invite_used` orada `not_allowed` olur, çünkü §8'in
 * listesi arayüz sözlüğünün anahtar kümesidir; burada ikisi AYRI durur, yoksa
 * "daveti iptal ettim" ile "bu davet zaten kullanıldı" tek cevaba karışırdı.
 */
export const INVITE_REJECTIONS = [
  "invite_revoked",
  "invite_used",
  "invite_expired",
  "invite_no_identity",
  "invite_email_mismatch",
  "already_in_team",
] as const;
export type InviteRejection = (typeof INVITE_REJECTIONS)[number];

/**
 * Kabul kararının TÜM girdisi. Hepsi çağırandan gelir: bu yüklem ne DB'ye ne
 * saate bakar (`now` de parametre), yani tablo testiyle taranabilir.
 */
export interface InviteAcceptanceFacts {
  revokedAt: Date | null;
  acceptedAt: Date | null;
  expiresAt: Date;
  /** Davetin GİTTİĞİ adres (DB'de `normalizeTeamEmail`den geçmiş hâliyle durur). */
  inviteEmail: string;
  /** Kabul etmeye çalışan OTURUMUN adresi; oturum yoksa null. */
  sessionEmail: string | null;
  /** Kullanıcının (başka ya da aynı) bir takımda ÜYELİĞİ var mı (karar 6.5). */
  alreadyInTeam: boolean;
}

/**
 * Davet kabul edilebilir mi? `null` = edilebilir, aksi hâlde SEBEP.
 *
 * SIRA DETERMİNİSTTİR ve bu bir üslup tercihi değil: iki sebep birden varsa
 * (iptal edilmiş VE süresi dolmuş) cevap tek ve aynı olmak zorunda, yoksa aynı
 * davet iki farklı cümleyle reddedilir ve destek "hangisi" diye sorar.
 *
 * İKİ KAPI BURADA ÇİVİLİ:
 *
 * 1. **E-posta eşleşmesi** — token'ı ele geçiren BAŞKA bir hesap kabul EDEMEZ.
 *    Karşılaştırmanın iki tarafı da `normalizeTeamEmail`den geçer: tekil indeks
 *    (`customer_team_invites_live_uq`) ile bu kapı aynı normalizasyonu
 *    paylaşmak zorunda, yoksa biri küçük harfe indirip diğeri indirmediğinde
 *    davet hiç kabul edilemez hâle gelir.
 * 2. **Süre sınırı KAPALI uçtur** (`expiresAt <= now`): eşitlikte kabul etmek
 *    TTL'i bir milisaniye de olsa uzatırdı.
 *
 * `sessionEmail === null` ayrı bir sebeptir (`invite_no_identity`) ve
 * `invite_email_mismatch`e KATLANMAZ: ikisi aynı kodu dönse, "giriş yapmalısın"
 * ile "yanlış hesapla giriş yaptın" tek cümleye düşerdi.
 */
export function inviteAcceptable(
  facts: InviteAcceptanceFacts,
  now: Date
): InviteRejection | null {
  if (facts.revokedAt !== null) return "invite_revoked";
  if (facts.acceptedAt !== null) return "invite_used";
  if (facts.expiresAt.getTime() <= now.getTime()) return "invite_expired";
  if (facts.sessionEmail === null || facts.sessionEmail.trim() === "") {
    return "invite_no_identity";
  }
  if (normalizeTeamEmail(facts.inviteEmail) !== normalizeTeamEmail(facts.sessionEmail)) {
    return "invite_email_mismatch";
  }
  if (facts.alreadyInTeam) return "already_in_team";
  return null;
}
