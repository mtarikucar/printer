/**
 * "Bu isteği kim yapıyor ve bu teklifte ne görebilir?"
 *
 * Tek kapı: her `/api/quotes/**` rotası ve teklif sayfası erişimi BURADAN
 * sorar. Karar veren çekirdek (`resolveQuoteViewer`) saftır — DB'si, çerezi,
 * oturumu yoktur — çünkü erişim matrisi testle çivilenebilir olmalı; DB ve
 * çerez okuması ince bir kabukta (`resolveQuoteAccess`) durur.
 *
 * TEK BİLİNÇLİ İSTİSNA: `src/app/api/realtime/quote/[id]/route.ts` kendi dar
 * sorgusunu ve kendi `allowed` ifadesini taşır. Buradan DAHA SIKIDIR — admin'i
 * ve paylaşım token'ını KASITLI olarak dışarıda bırakır (canlı akış "şu parça
 * hazır oldu" der; paylaşım görünümü durağandır) — yani bir hak sızdırmaz.
 * Ama bir yandan da buraya eklenen yeni bir HAK SAHİBİ o uca KENDİLİĞİNDEN
 * ULAŞMAZ: matrise dal ekleyen, o rotayı da elden geçirmek zorundadır. Takım
 * dalı (0072) o yüzden orada da elle açıldı ve kapının kendisi — bayrak +
 * üyelik + kısa devre sırası — tek yerde, `resolveQuoteTeam` içinde durur.
 *
 * T-numarası ERİŞİM VERMEZ: numaralar sıradandır (`T-000123`), tahmin
 * edilebilir. Numara yalnız satırı BULUR; hakkı oturum, anonim çerez ya da
 * paylaşım token'ı verir.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { quoteFrameworks, quotes, type Quote } from "@/lib/db/schema";
import {
  formatFrameworkNumber,
  parseFrameworkNumber,
} from "@/lib/config/quote-framework";
import { formatQuoteNumber, parseQuoteNumber } from "@/lib/config/quote-number";
import type { TeamRole } from "@/lib/config/quote-team";
import type { QuoteAccessTeam, QuoteViewer } from "@/lib/config/quote-types";
import { resolveAuthenticatedUploadOwner } from "@/lib/services/chunked-upload";
import { teamMembershipFor } from "@/lib/services/customer-team";
import { isFlagEnabled } from "@/lib/services/flags";

export interface QuoteAccess {
  quote: Quote;
  viewer: QuoteViewer;
  sessionUserId: string | null;
  /**
   * BU TEKLİFİN takımı (0072, `quotes.team_id`) — SATIRIN gerçeği, isteğin
   * HAKKI değil. Rota katmanı "bu teklif hangi takımın" sorusunu ikinci bir
   * sorgu açmadan cevaplayabilsin diye arayüzün yazılı maddesi (tasarım §3.2).
   *
   * AŞAĞIDAKİ `team` İLE KARIŞTIRILMAMALI ve bir KAPI olarak OKUNMAMALI:
   * `teamId` bayrak kapalıyken de, üyelik yokken de, paylaşım izleyicisinde de
   * DOLUDUR. `teamId !== null` ile yazılmış bir kapı, takım teklifini herkese
   * açardı. Üyeliği `team`, kararı `viewer.isTeam` söyler.
   */
  teamId: string | null;
  /**
   * Oturum sahibinin BU TEKLİFİN takımındaki ÜYELİĞİ (0072); `null` = takım
   * yok, üyelik yok ya da bayrak kapalı. Yani `teamId` dolu + `team` null bir
   * erişim tamamen olağandır (üstteki uyarı).
   *
   * Rol TEK BAŞINA yetmediği için satırın tamamı taşınıyor: `canCheckoutQuote`
   * takımın `member_can_checkout` anahtarını, müşteri gövdesi takımın ADINI
   * istiyor. Kabuk ikisini zaten TEK sorguda okuyor; burada durmasalar rota
   * katmanı aynı satırı ikinci kez sorardı.
   */
  team: QuoteAccessTeam | null;
  /**
   * Çağıranın taşıdığı TÜM sahneleme sahiplik anahtarları
   * (`admin:<e-posta>` | `manufacturer:<id>` | `painter:<id>` | `u:<id>`).
   *
   * Sahnelenmiş yüklemeyi teklife bağlarken aday sahipler arasına girerler.
   * Neden bir küme: `/api/uploads/chunk` yüklemeyi çağıranın İLK eşleşen
   * kimliğiyle kaydeder (admin → üretici → boyacı → müşteri). Aynı tarayıcıda
   * bir panel çerezi ile müşteri oturumu bir arada bulunabilir — örneğin
   * `/manufacturer`'da açık bir üretici kendi hesabıyla teklif oluştururken —
   * ve o zaman dosya `manufacturer:<id>` ile kaydedilir. Yalnız müşteri
   * anahtarına bakmak, bu kişiye KENDİ dosyası için 403 demek olurdu.
   * `quoteApiEnabled()` yöneticiyi bayrak kapalıyken de içeri aldığından
   * lansman öncesi iç testi de bu kümeye dayanır.
   */
  uploadOwnerKeys?: string[];
}

export interface QuoteViewerContext {
  /** Müşteri oturumundaki kullanıcı (`customer_session`), yoksa null. */
  sessionUserId: string | null;
  /** `anonymous_session` çerezi — ÜRETİLMEZ, yalnız okunur. */
  anonymousId: string | null;
  /** `?t=` ile gelen paylaşım token'ı. */
  shareToken: string | null;
  /** NextAuth admin oturumu var mı. */
  isAdmin: boolean;
  /**
   * Oturum sahibinin BU TEKLİFİN takımındaki rolü (0072).
   *
   * Kabuk doldurur; çekirdek sormaz. `null` = takım yok, üyelik yok YA DA
   * `quote_teams_enabled` kapalı. Üçünün tek bir `null`a indirilmesi bilinçli:
   * çekirdek "neden rol yok" sorusunu sormaz, matris sade kalır ve bayrağı
   * kapatmak `team_id` dolu satırları da bugünkü matrise düşürür.
   */
  teamRole: TeamRole | null;
}

/**
 * Tek uuid kalıbı. Teklif kimliğini aramak için doğduğu yer burası; PARÇA
 * kimliğini doğrulayanlar da (uç + servis) aynı kalıbı okur — ikinci bir kopya,
 * bir gün yalnız birinin sıkılaştırıldığı gün demek olurdu.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Erişim matrisi (spec §"Erişim ve fiyat gizleme"). `null` = 404.
 *
 * Dallar, SIRASIYLA: kişisel sahip → admin → takım üyeliği → anonim çerez →
 * paylaşım token'ı → `null`.
 *
 * Sıra önemli: sahiplik paylaşımdan ÖNCE bakılır, yoksa kendi teklifini
 * paylaşım bağlantısıyla açan müşteri kendi teklifinde salt okunur kalırdı.
 *
 * Anonim sahip fiyat GÖRMEZ: fiyat kapısı gizlilik değil müşteri kazanımıdır
 * (spec §Müşteri arayüzü, "fiyat kapısı modalı") — herkes kayıt olup fiyatı
 * görebilir, ama kim olduğunu söyleyerek.
 */
/**
 * Girişli müşteri, kendi anonim çerezine bağlı teklifi açtı mı?
 *
 * Saf koşul: yazma `resolveQuoteAccess` içinde, koşul burada — testten
 * doğrulanabilsin diye. Sahipli teklif (`userId` dolu) asla devredilmez:
 * başka bir hesaba geçmesi teklifin çalınması olurdu.
 *
 * Devralan KİŞİSEL sahip olur, takıma BAĞLANMAZ (0072, tasarım §3.3): giriş
 * yapmak, dosyayı meslektaşlara göstermeye rıza değildir. Teklifi takıma
 * bağlamak AYRI ve AÇIK bir eylemdir (`canAttachQuote`, T-4).
 */
export function shouldClaimQuote(
  quote: Pick<Quote, "userId" | "anonymousId">,
  identity: { sessionUserId: string | null; anonymousId: string | null }
): boolean {
  return (
    quote.userId === null &&
    quote.anonymousId !== null &&
    identity.sessionUserId !== null &&
    identity.anonymousId === quote.anonymousId
  );
}

export function resolveQuoteViewer(
  quote: Pick<Quote, "userId" | "anonymousId" | "shareToken" | "teamId">,
  ctx: QuoteViewerContext
): QuoteViewer | null {
  if (quote.userId !== null && ctx.sessionUserId === quote.userId) {
    return {
      canSeePrices: true,
      canEdit: true,
      isOwner: true,
      isShare: false,
      isAdmin: false,
      isTeam: false,
      teamRole: null,
    };
  }
  // Admin, anonim çerez dalından ÖNCE gelir: panelde girişli olan sahip, teklifi
  // bir kez de tarayıcısında anonim açmışsa, aşağıdaki dal eşleşip onu fiyatsız
  // bırakıyordu.
  if (ctx.isAdmin) {
    return {
      canSeePrices: true,
      canEdit: true,
      isOwner: false,
      isShare: false,
      isAdmin: true,
      isTeam: false,
      teamRole: null,
    };
  }
  // TAKIM (0072). Dalın YERİ üç argümanla seçildi, kopyalanmadı:
  //
  // 1. PAYLAŞIMDAN ÖNCE olmak ZORUNLU. Bu, yukarıdaki "sahiplik paylaşımdan
  //    ÖNCE bakılır" gerekçesinin takım karşılığıdır: dal paylaşımın ALTINA
  //    konsa, `viewer` olmayan bir üye `?t=`li bir URL ile açtığı KENDİ
  //    takımının işinde salt okunur kalırdı.
  // 2. ANONİM dala göre yeri DAVRANIŞI DEĞİŞTİRMEZ: `quotes_team_requires_user_chk`
  //    (CHECK `team_id IS NULL OR user_id IS NOT NULL`) sayesinde takım
  //    teklifinde `user_id` daima doludur, yani anonim dalın İLK koşulu
  //    (`quote.userId === null`) bir takım teklifinde hiç tutmaz. Okunurluk
  //    için anonim dalın ÜSTÜNE yazıldı; kısıt `scripts/test-quote-team-db.ts`
  //    içinde 23514 ile ölçülüyor, çünkü argüman ona dayanıyor.
  // 3. KİŞİSEL SAHİP dalının ÖNÜNE GEÇMEZ: üyelikten çıkarılmış ama teklifi
  //    kendisi açmış bir kişi erişimini KAYBETMEMELİ (tasarım §3.3) — kendi
  //    yüklediği dosya, takımdan çıkarıldığı gün kilitlenmez.
  //
  // `isOwner: false` döner ve bu KASITLIDIR: `isOwner` "kişisel sahip" demeye
  // devam eder, böylece bugünkü `viewer.isOwner` okumaları sessizce genişlemez;
  // her biri `src/lib/config/quote-team.ts` yüklemleriyle tek tek açılır.
  if (quote.teamId !== null && ctx.teamRole !== null) {
    return {
      // Üye GİRİŞ YAPMIŞTIR (rol ancak oturumdan okunur): fiyat kapısının amacı
      // gizlilik değil müşteri kazanımıdır ve zaten sağlanmıştır.
      canSeePrices: true,
      canEdit: ctx.teamRole !== "viewer",
      isOwner: false,
      isShare: false,
      isAdmin: false,
      isTeam: true,
      teamRole: ctx.teamRole,
    };
  }
  if (
    quote.userId === null &&
    quote.anonymousId !== null &&
    ctx.anonymousId !== null &&
    ctx.anonymousId === quote.anonymousId
  ) {
    // Oturum varsa bu çerez sahibi TANINAN müşteridir; fiyat kapısının amacı
    // (müşteri kazanımı) sağlanmıştır, fiyat açılır. `resolveQuoteAccess` aynı
    // istekte teklifi hesaba devreder, yoksa teklif "Tekliflerim"de hiç görünmez.
    const known = ctx.sessionUserId !== null;
    return {
      canSeePrices: known,
      canEdit: true,
      isOwner: true,
      isShare: false,
      isAdmin: false,
      isTeam: false,
      teamRole: null,
    };
  }
  if (
    quote.shareToken !== null &&
    ctx.shareToken !== null &&
    ctx.shareToken.length === quote.shareToken.length &&
    ctx.shareToken === quote.shareToken
  ) {
    // Paylaşım izleyicisi salt okunurdur; fiyatı yalnız giriş yapmışsa görür.
    return {
      canSeePrices: ctx.sessionUserId !== null,
      canEdit: false,
      isOwner: false,
      isShare: true,
      isAdmin: false,
      isTeam: false,
      teamRole: null,
    };
  }
  return null;
}

/**
 * NextAuth admin oturumu — yoksa null.
 *
 * Yalnız "var mı" değil E-POSTA da döner, çünkü sahiplik anahtarı ondan
 * kurulur (`admin:<e-posta>`) ve erişim çözümü oturumu zaten bir kez okuyor;
 * ikinci bir `auth()` çağrısı aynı isteğe ikinci bir tur eklerdi.
 *
 * `@/lib/auth/config` TEMBEL yüklenir: bu modülü teklif servisleri ve (dolaylı
 * olarak) worker zinciri de import ediyor; next-auth sağlayıcı zincirini her
 * seferinde çözmek gereksiz ve ortam değişkeni uyarılarını her betiğe taşır.
 */
async function adminSession(): Promise<{ email: string } | null> {
  try {
    const { auth } = await import("@/lib/auth/config");
    const session = await auth();
    const user = session?.user as { role?: string; email?: string | null } | undefined;
    if (user?.role !== "admin") return null;
    // Kimliksiz anahtar üretilemez; `uploads/chunk` de aynı yedeği kullanır.
    return { email: user.email || "admin" };
  } catch {
    // Admin oturumu okunamıyorsa istek admin DEĞİLDİR; erişim kapısı sessizce
    // açılmaz.
    return null;
  }
}

/** NextAuth admin oturumu var mı. */
export async function isAdminSession(): Promise<boolean> {
  return (await adminSession()) !== null;
}

/**
 * Anlık teklif yüzeyleri açık mı.
 *
 * Bayrak kapalıyken uçlar YOK gibi davranır (404, 403 değil): kapalı bir
 * özelliğin varlığını duyurmanın anlamı yok. Admin oturumu iç testi için
 * kapıdan geçer (spec §"Bayrak ve geçiş").
 */
export async function quoteApiEnabled(): Promise<boolean> {
  if (await isFlagEnabled("instant_quote_enabled")) return true;
  return isAdminSession();
}

/**
 * Çerçeve sipariş UÇLARI açık mı (`/api/admin/frameworks/**`).
 *
 * `quoteApiEnabled`in birebir deseni ve AYNI gerekçe: bayrak kapalıyken uç YOK
 * gibi davranır (404, 403 DEĞİL — kapalı bir özelliğin varlığını duyurmanın
 * anlamı yok), admin oturumu İÇ TEST için kapıdan geçer (spec §F3.2).
 *
 * EKRANLAR BU KAPIYI KULLANMAZ, `frameworkScreensEnabled`i kullanır: bu
 * fonksiyon admin oturumunda DAİMA `true` döner ve admin'den başkasının
 * giremediği bir sayfada kapı olmaktan çıkar (bkz. orada).
 *
 * KAPSAM YÜZEYLERDİR, servis değil: serbest bırakılmış bir partinin klon
 * teklifi bayrak kapalıyken de ÖDENMEYE DEVAM ETMEK ZORUNDA (sıradan bir
 * `quotes` satırıdır ve `/teklif/[number]/odeme` yolundan geçer). Bayrağı
 * kapatmak ödenmiş ya da ödenecek bir partiyi asla tuzağa düşürmez.
 */
export async function frameworkSurfacesEnabled(): Promise<boolean> {
  if (await isFlagEnabled("framework_orders_enabled")) return true;
  return isAdminSession();
}

/**
 * Çerçeve sipariş EKRANLARI açık mı (`/admin/cerceve/**`, `/admin/teklifler/[id]`
 * dönüştürme kartı, kenar çubuğu satırı) — YALNIZ BAYRAK.
 *
 * Neden ikinci bir kapı: `frameworkSurfacesEnabled` admin oturumunu iç test
 * için geçiriyor, ama bu ekranlara ZATEN yalnız admin girebiliyor (panel
 * düzeni oturumu kontrol edip `/admin/login`e yönlendiriyor). Yani o kapı bir
 * ekranda hiçbir şeyi kapatmaz: bayrak KAPALIYKEN de dönüştürme kartı her
 * admin'e çizilir ve anlaşma kurulabilirdi. Spec §F3.4 bunun tersini söylüyor:
 * **"Bayrak kapalıyken render edilmez."** Ölçü o yüzden burada oturumdan
 * ARINDIRILIYOR; §F3.2'nin iç test istisnası UÇLARIN kapısında kalıyor (bir
 * admin bayrak kapalıyken uçları curl/test ile yine sürebilir).
 */
export async function frameworkScreensEnabled(): Promise<boolean> {
  return isFlagEnabled("framework_orders_enabled");
}

/**
 * Çerçeve anlaşmada izleyicinin hakları.
 *
 * `QuoteViewer`dan AYRI ve DAHA DAR bir şekil, çünkü matrisin iki dalı burada
 * HİÇ YOK: anonim çerez (`quote_frameworks.user_id` NOT NULL — anonim çerçeve
 * YOK) ve paylaşım jetonu (taahhüt kurumsal ve kişiye özeldir; "bu anlaşmayı
 * herkese açabilirim" diye bir yetki tanımlanmadı). Alanları `QuoteViewer`ın
 * ADLARINI taşır, böylece fiyat kapısının dili iki yüzeyde aynı okunur.
 */
export interface FrameworkViewer {
  canSeePrices: boolean;
  isOwner: boolean;
  isAdmin: boolean;
}

/**
 * Erişim matrisi — SAF. `null` = 404 ("var ama senin değil" de bir bilgidir).
 *
 * `canSeePrices` İKİ dalda da açıktır (sahip ve admin), çünkü üçüncü bir dal
 * yok: anlaşmayı açabilen herkes ya taahhüdü imzalayan kişidir ya yöneticidir.
 * Alan buna rağmen VAR ve sunucu onu uygular — fiyat gizleme bir görünüm ayarı
 * değil güvenlik sınırıdır ve yarın bir dal eklenirse (ör. müşterinin satın
 * alma birimine okuma hakkı) kapı YERİNDE olmalı, sonradan hatırlanacak bir iş
 * olmamalı. `scripts/test-quote-ui.ts` kapıyı `canSeePrices=false` bir
 * izleyiciyle her koşuda sınıyor.
 *
 * Sıra: SAHİPLİK admin'den ÖNCE. Kendi anlaşmasını açan bir yönetici "sahip"
 * olarak görülür ve `isAdmin` dalına düşüp admin bağlantılarını görmez.
 */
export function resolveFrameworkViewer(
  framework: { userId: string },
  ctx: { sessionUserId: string | null; isAdmin: boolean }
): FrameworkViewer | null {
  if (ctx.sessionUserId !== null && ctx.sessionUserId === framework.userId) {
    return { canSeePrices: true, isOwner: true, isAdmin: false };
  }
  if (ctx.isAdmin) return { canSeePrices: true, isOwner: false, isAdmin: true };
  return null;
}

export interface FrameworkAccess {
  frameworkId: string;
  number: string;
  viewer: FrameworkViewer;
}

/**
 * `C-000123` (ya da uuid) → anlaşma kimliği + izleyici hakları; erişim yoksa
 * `null` ve çağıran 404 verir.
 *
 * Satır okuması DAR: yalnız kimlik, numara ve sahip. Anlaşmanın gövdesini
 * (donmuş katalog + parça anlık görüntüsü, onlarca KB jsonb) erişim kapısında
 * okumak, 404 alacak bir istek için de telden geçirmek olurdu.
 */
export async function resolveFrameworkAccess(
  idOrNumber: string
): Promise<FrameworkAccess | null> {
  const value = idOrNumber.trim();
  let condition;
  if (UUID_RE.test(value)) {
    condition = eq(quoteFrameworks.id, value);
  } else {
    const seq = parseFrameworkNumber(value);
    if (seq === null) return null;
    condition = eq(quoteFrameworks.number, formatFrameworkNumber(seq));
  }

  const [row] = await db
    .select({
      id: quoteFrameworks.id,
      number: quoteFrameworks.number,
      userId: quoteFrameworks.userId,
    })
    .from(quoteFrameworks)
    .where(condition)
    .limit(1);
  if (!row) return null;

  const [identity, admin] = await Promise.all([requestIdentity(), adminSession()]);
  const viewer = resolveFrameworkViewer(row, {
    sessionUserId: identity.sessionUserId,
    isAdmin: admin !== null,
  });
  if (!viewer) return null;
  return { frameworkId: row.id, number: row.number, viewer };
}

/**
 * STEP (`.step`/`.stp`) yüklemesi bu istek için açık mı.
 *
 * TEK okuma noktası, bilerek: aynı cevap hem SUNUCU KAPISINI
 * (`addPartFromUpload`, güvenlik sınırı) hem müşteriye gönderilen biçim
 * listesini (`PresentedCatalog.acceptedFormats`, kolaylık) besler. İki ayrı
 * okuma, dropzone'un `.step` seçtirdiği ama ucun 400 döndürdüğü bir hâl
 * üretirdi — özelliğin en olası sessiz kırılması.
 *
 * `quoteApiEnabled` deseni: bayrak kapalıyken admin oturumu iç test için
 * geçer. `viewer` verildiğinde admin-lik ONDAN da okunur, çünkü erişim çözümü
 * onu bu istekte zaten sormuştur (`resolveQuoteAccess`) — ama yetmez: teklifin
 * SAHİBİ olan bir admin `isOwner` dalına düşer ve `isAdmin` false olur, o
 * yüzden oturum yine sorulur.
 */
export async function stepUploadsEnabled(viewer: QuoteViewer | null): Promise<boolean> {
  if (await isFlagEnabled("quote_step_enabled")) return true;
  if (viewer?.isAdmin) return true;
  return isAdminSession();
}

/**
 * Takım çalışma alanı YÜZEYLERİ bu istek için açık mı (0072).
 *
 * `stepUploadsEnabled` deseninin birebir kopyası ve aynı gerekçe: bayrak
 * kapalıyken ekran/uç YOK gibi davranır, admin oturumu iç test için geçer.
 * `viewer` verildiğinde admin-lik ONDAN da okunur, çünkü erişim çözümü onu bu
 * istekte zaten sormuştur — ama yetmez: teklifin SAHİBİ olan bir admin
 * `isOwner` dalına düşer ve `isAdmin` false olur, o yüzden oturum yine sorulur.
 *
 * ERİŞİM KABUĞU BU KAPIYI KULLANMAZ, `resolveQuoteTeam` kullanır. Sebebi bir
 * SIRA TUZAĞI: `teamRole` `resolveQuoteViewer`ın GİRDİSİ olduğu için kabuk
 * bayrağı `viewer` HESAPLANMADAN ÖNCE okumak zorunda. O noktada `viewer?.isAdmin`
 * kısayolu yoktur ve buradaki `isAdminSession()` aynı isteğe İKİNCİ bir `auth()`
 * turu eklerdi (`adminSession` başlığının yasakladığı şey). Kabuk bu yüzden elde
 * olan `admin` değeriyle aynı kapıyı kendisi kurar.
 */
export async function teamsEnabled(viewer: QuoteViewer | null): Promise<boolean> {
  if (await isFlagEnabled("quote_teams_enabled")) return true;
  if (viewer?.isAdmin) return true;
  return isAdminSession();
}

/**
 * Teklifin takım üyeliğini okuyan TEK yer. `null` = takım dalı KAPALI.
 *
 * KISA DEVRE SIRASI BİR KURALDIR, üslup değil:
 *
 *   1. `quote.teamId === null` → hemen çık. Takımsız müşteri için istek başına
 *      fazladan TEK sorgu bile yok; bayrak okuması (DB/Redis) dahil. Bugünkü
 *      davranış = bugünkü maliyet.
 *   2. Oturum yok → çık. Rol ancak girişli bir kullanıcıya ait olabilir
 *      (anonim teklif zaten takım teklifi olamaz, `quotes_team_requires_user_chk`).
 *   3. BAYRAK (ya da elde olan admin oturumu) → kapalıysa rol HİÇ OKUNMAZ, yani
 *      `team_id` dolu satırlar bile bugünkü matrise düşer. **Geri dönüş planı
 *      budur:** bayrağı kapatmak takım dalını ULAŞILAMAZ yapar.
 *   4. Üyelik satırı — önbelleksiz, her istekte taze (bkz. `customer-team.ts`).
 *
 * Sırayı bozmanın bedeli adım adım AYRIDIR: 3 ile 4'ü takas etmek kapalı bir
 * özellik için her teklif açılışında bir üyelik sorgusu yakmak (ölçülüyor:
 * `scripts/test-quote-cutover.ts` sorgu sayacı), 1 ile 3'ü takas etmek TAKIMSIZ
 * müşteriye bir bayrak okuması eklemek, 3'ü tamamen DÜŞÜRMEK ise bayrağı
 * anlamsız kılıp fiyatı sessizce açmaktır.
 *
 * `admin` PARAMETRE olarak geliyor çünkü çağıranların elinde ZATEN var; burada
 * `isAdminSession()` çağırmak ikinci bir `auth()` turu demekti. SSE ucu bu
 * yüzden `null` geçer: o uç admin'i BİLEREK dışarıda bırakıyor (bkz. dosya
 * başlığı) ve bu kapı o kararı değiştirmemeli.
 */
export async function resolveQuoteTeam(
  quote: Pick<Quote, "teamId">,
  sessionUserId: string | null,
  admin: { email: string } | null
): Promise<QuoteAccessTeam | null> {
  if (quote.teamId === null || sessionUserId === null) return null;
  if (!(await isFlagEnabled("quote_teams_enabled")) && admin === null) return null;
  return teamMembershipFor(sessionUserId, quote.teamId);
}

/**
 * İstek kimliği: müşteri oturumu + anonim çerez.
 *
 * `customer-auth` TEMBEL yüklenir çünkü `@/lib/env` (ve `next/headers`) ile
 * gelir; erişim matrisinin saf çekirdeğini import eden testler ve betikler
 * bunların hiçbirine ihtiyaç duymaz. Anonim kimlik yalnız OKUNUR
 * (`getAnonymousId`): sahiplik kontrolünde çerez ÜRETMEK, sahibi olmayan bir
 * isteğe taze bir kimlik verip onu "yeni sahip" gibi göstermek olurdu.
 */
async function requestIdentity(): Promise<{
  sessionUserId: string | null;
  anonymousId: string | null;
}> {
  const { getAnonymousId, getSessionUser } = await import("@/lib/services/customer-auth");
  const [session, anonymousId] = await Promise.all([getSessionUser(), getAnonymousId()]);
  return { sessionUserId: session?.userId ?? null, anonymousId };
}

/** `id` bir uuid ya da `T-000123`; ikisi de değilse arama YAPILMAZ. */
function lookupCondition(idOrNumber: string) {
  const value = idOrNumber.trim();
  if (UUID_RE.test(value)) return eq(quotes.id, value);
  const seq = parseQuoteNumber(value);
  if (seq === null) return null;
  return eq(quotes.number, formatQuoteNumber(seq));
}

/**
 * Teklifi bulur ve izleyicinin haklarını çıkarır. Erişim yoksa `null` döner ve
 * çağıran 404 verir — "bu teklif var ama senin değil" bilgisi bile sızmaz.
 *
 * `forEdit` verildiğinde salt okunur izleyici (paylaşım) de `null` alır:
 * düzenleme uçlarının varlığını paylaşım bağlantısına açmanın gereği yok.
 * Teklifin DURUMUNDAN gelen kilitler (süre dolumu, bekleyen ödeme, siparişe
 * dönmüş) burada değil, `quotePermissions` ile servis katmanında kontrol
 * edilir; onların müşteriye söyleyecek bir cümlesi var.
 */
export async function resolveQuoteAccess(
  idOrNumber: string,
  opts: { shareToken?: string | null; forEdit?: boolean } = {}
): Promise<QuoteAccess | null> {
  const condition = lookupCondition(idOrNumber);
  if (!condition) return null;

  const [quote] = await db.select().from(quotes).where(condition).limit(1);
  if (!quote) return null;

  const [identity, admin] = await Promise.all([requestIdentity(), adminSession()]);
  // Üyelik sorgusu YALNIZ takım teklifinde ve YALNIZ bayrak açıkken yapılır;
  // kısa devre sırasının gerekçesi `resolveQuoteTeam` başlığında. `viewer`
  // HENÜZ YOK: `teamRole` onun GİRDİSİ, o yüzden kapı elde olan `admin`
  // değeriyle kuruluyor (`teamsEnabled(viewer)` burada çağrılamaz).
  const team = await resolveQuoteTeam(quote, identity.sessionUserId, admin);
  const viewer = resolveQuoteViewer(quote, {
    ...identity,
    shareToken: opts.shareToken ?? null,
    isAdmin: admin !== null,
    // Çekirdeğe yalnız ROL girer: matrisi testle çivileyebilmek için
    // `resolveQuoteViewer` SAF kalmak zorunda (ad ve ödeme anahtarı
    // `QuoteAccess.team` ile taşınır, karara girmez).
    teamRole: team?.role ?? null,
  });
  if (!viewer) return null;
  if (opts.forEdit && !viewer.canEdit) return null;

  // Girişli müşteri kendi anonim teklifini açtı: devri BURADA yap. Modal'ın
  // `claim` çağrısı yalnız o an giriş yapanı kapsıyordu; sayfayı zaten girişken
  // açan müşterinin teklifi sahipsiz kalıyor, "Tekliflerim"de görünmüyor ve
  // çerez silindiğinde tamamen erişilemez hale geliyordu. Koşullu UPDATE, iki
  // eşzamanlı isteğin ikisinin de aynı sonuca varmasını sağlar.
  const claimAnonymousId = quote.anonymousId;
  const claimUserId = identity.sessionUserId;
  if (claimAnonymousId !== null && claimUserId !== null && shouldClaimQuote(quote, identity)) {
    const [claimed] = await db
      .update(quotes)
      .set({ userId: claimUserId, updatedAt: new Date() })
      .where(
        and(
          eq(quotes.id, quote.id),
          isNull(quotes.userId),
          eq(quotes.anonymousId, claimAnonymousId)
        )
      )
      .returning();
    if (claimed) Object.assign(quote, claimed);
  }

  // Sahiplik anahtarları sahnelemeyi KAYDEDEN uçla aynı gövdeden çıkar
  // (`resolveAuthenticatedUploadOwner`); burada yalnız zaten okunmuş iki oturum
  // ona geri verilir, ikinci bir `auth()`/`getSessionUser()` turu olmasın diye.
  // Geriye kalan üretici/boyacı okuması çerez + JWT doğrulamasıdır, sorgusuz.
  const { keys } = await resolveAuthenticatedUploadOwner({
    adminEmail: admin?.email ?? null,
    customerUserId: identity.sessionUserId,
  });

  return {
    quote,
    viewer,
    sessionUserId: identity.sessionUserId,
    // Satırın takımı, ÜYELİKTEN bağımsız: devir UPDATE'inden SONRA okunuyor ki
    // `quote` nesnesi ne ise alan da o olsun (devir `team_id`ye dokunmaz —
    // devralınan teklif anonimdir, `quotes_team_requires_user_chk`).
    teamId: quote.teamId,
    team,
    uploadOwnerKeys: keys,
  };
}
