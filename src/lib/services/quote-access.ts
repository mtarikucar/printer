/**
 * "Bu isteği kim yapıyor ve bu teklifte ne görebilir?"
 *
 * Tek kapı: her `/api/quotes/**` rotası ve teklif sayfası erişimi BURADAN
 * sorar. Karar veren çekirdek (`resolveQuoteViewer`) saftır — DB'si, çerezi,
 * oturumu yoktur — çünkü erişim matrisi testle çivilenebilir olmalı; DB ve
 * çerez okuması ince bir kabukta (`resolveQuoteAccess`) durur.
 *
 * T-numarası ERİŞİM VERMEZ: numaralar sıradandır (`T-000123`), tahmin
 * edilebilir. Numara yalnız satırı BULUR; hakkı oturum, anonim çerez ya da
 * paylaşım token'ı verir.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { quotes, type Quote } from "@/lib/db/schema";
import { formatQuoteNumber, parseQuoteNumber } from "@/lib/config/quote-number";
import type { QuoteViewer } from "@/lib/config/quote-types";
import { resolveAuthenticatedUploadOwner } from "@/lib/services/chunked-upload";
import { isFlagEnabled } from "@/lib/services/flags";

export interface QuoteAccess {
  quote: Quote;
  viewer: QuoteViewer;
  sessionUserId: string | null;
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
  quote: Pick<Quote, "userId" | "anonymousId" | "shareToken">,
  ctx: QuoteViewerContext
): QuoteViewer | null {
  if (quote.userId !== null && ctx.sessionUserId === quote.userId) {
    return { canSeePrices: true, canEdit: true, isOwner: true, isShare: false, isAdmin: false };
  }
  // Admin, anonim çerez dalından ÖNCE gelir: panelde girişli olan sahip, teklifi
  // bir kez de tarayıcısında anonim açmışsa, aşağıdaki dal eşleşip onu fiyatsız
  // bırakıyordu.
  if (ctx.isAdmin) {
    return { canSeePrices: true, canEdit: true, isOwner: false, isShare: false, isAdmin: true };
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
    return { canSeePrices: known, canEdit: true, isOwner: true, isShare: false, isAdmin: false };
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
  const viewer = resolveQuoteViewer(quote, {
    ...identity,
    shareToken: opts.shareToken ?? null,
    isAdmin: admin !== null,
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
    uploadOwnerKeys: keys,
  };
}
