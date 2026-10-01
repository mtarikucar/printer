/**
 * Takım çalışma alanının DB kabuğu (0072): okuma + YAZMA yolu.
 *
 * İki soru cevaplanıyor. Birincisi T-2'de geldi: *bu kullanıcı BU TEKLİFİN
 * takımının neyi?* (`teamMembershipFor`) — cevabı erişim kabuğu
 * (`quote-access.ts` · `resolveQuoteTeam`) sorar ve `QuoteViewer`ın takım dalını
 * o cevap açar. İkincisi T-3'ün konusu: *takım nasıl KURULUR, üye nasıl
 * GİRER/ÇIKAR?* Üyelik satırını yazan TEK yol bu dosyadır.
 *
 * ─── DÖRT DEĞİŞMEZ ─────────────────────────────────────────────────────────
 *
 * 1. **Yetkiyi bu dosya KARAR VERMEZ, SORAR.** Her yazma
 *    `src/lib/config/quote-team.ts` yüklemlerinden geçer (`canInvite`,
 *    `canAssignRole`, …). Yüklem burada yeniden yazılmaz: matris tek yerde
 *    okunabilir kalmak zorunda, yoksa ekran, uç ve servis üç ayrı kurala göre
 *    davranır.
 * 2. **Her yazma TAM OLARAK BİR denetim satırı bırakır** (`customer_team_actions`,
 *    `before`/`after` jsonb). Tek istisna `updateTeamProfile`tir: üç AYRI
 *    açıklama (ad / fatura / teslimat) için `TEAM_ACTIONS`ta üç ayrı ad var ve
 *    hangisinin değiştiğini tek satıra sıkıştırmak denetimi yalancı yapardı —
 *    orada değişen BÖLÜM başına bir satır yazılır.
 * 3. **Ham davet token'ı DB'ye GİRMEZ**: yalnız `sha256(raw)`. Desen
 *    `password-reset.ts`in `newToken`ıdır. Ham hâli YALNIZ dönüş değerinde
 *    yaşar, tek tüketicisi e-posta gövdesidir ve denetim satırına da yazılmaz.
 * 4. **INSERT ÖNCESİ kontrol tercih edilir, `23505` yakalamaya güvenilmez.**
 *    drizzle 0.45 pg hatasını sarıyor: yakalanan hatada `.code` `undefined`,
 *    gerçek kod `.cause`ta ([[drizzle-error-wrapping]]). Kapılar bu yüzden iki
 *    katmanlı — servis önce bakıp Türkçe cümle döner, tekil indeks ikinci
 *    savunma hattıdır (ve `uniqueViolation` onu da Türkçeye çevirir).
 *
 * ─── PARA HATTINA DOKUNULMAZ ───────────────────────────────────────────────
 *
 * Bu dosya hiçbir tutar, kalem ya da indirim üretmez; `orders`/`order_drafts`a
 * yazmaz. **Üye çıkarmak ASLA para taşımaz**: iade `orders.userId`e (ödeyene)
 * gider, hediye kredisi `redeemedByUserId`e bağlıdır. `member_can_checkout` bir
 * YETKİ anahtarıdır, fiyat girdisi değil.
 *
 * `import "server-only"` YOK ve olmayacak: bu modüle `quote-access.ts`
 * üzerinden BullMQ worker zinciri ulaşıyor (`order-draft.ts` → …) ve
 * `server-only` standalone-Node worker'ını crash-loop'a sokar (hit 2026-06-13,
 * [[worker-server-only-trap]]). Aynı sebeple `next/headers` ve oturum okuması
 * da burada yok: kimlik çağırandan GELİR.
 *
 * ÖNBELLEK YOKTUR ve olmayacak. Üyelik satırı silindiği anda erişim kesilmek
 * zorunda; bir istek sürecek bir gecikme bile, çıkarılmış bir üyenin elindeki
 * teklif URL'sini çalışır bırakır (tasarım §3.3). Bayrağın Redis önbellekli
 * olması bunu bozmaz: bayrak "özellik açık mı" sorusudur, üyelik "bu kişi hâlâ
 * içeride mi" sorusudur ve ikincisi bayatlayamaz.
 */
import crypto from "node:crypto";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerTeamActions,
  customerTeamInvites,
  customerTeamMembers,
  customerTeams,
  quotes,
  users,
  type CustomerTeam,
  type TurkishAddress,
} from "@/lib/db/schema";
import {
  INVITE_TTL_MS,
  canAssignRole,
  canDeleteTeam,
  canEditTeamProfile,
  canInvite,
  canLeave,
  canRemoveMember,
  canTransferOwnership,
  inviteAcceptable,
  normalizeTeamEmail,
  type InviteRejection,
  type TeamAction,
  type TeamInviteRole,
  type TeamRole,
} from "@/lib/config/quote-team";
import type { InvoiceType, QuoteAccessTeam } from "@/lib/config/quote-types";

/**
 * Kullanıcının BU takımdaki üyeliği + takımın karar veren iki alanı; üyelik
 * yoksa `null`.
 *
 * TEK sorgu ve TEK satır: `customer_team_members_team_user_uq` tekil indeksi
 * `(team_id, user_id)` üzerinde, `customer_teams` ona JOIN'lenir. Takım ADI ve
 * `member_can_checkout` buradan gelmek ZORUNDA — ikisi de rolün yanında kararı
 * besliyor (ad gövdeye, ödeme anahtarı `canCheckoutQuote`a) ve ayrı bir
 * sorguyla okunsalar her teklif açılışına ikinci bir gidiş-dönüş eklerdi.
 */
export async function teamMembershipFor(
  userId: string,
  teamId: string
): Promise<QuoteAccessTeam | null> {
  const [row] = await db
    .select({
      id: customerTeams.id,
      name: customerTeams.name,
      role: customerTeamMembers.role,
      memberCanCheckout: customerTeams.memberCanCheckout,
    })
    .from(customerTeamMembers)
    .innerJoin(customerTeams, eq(customerTeams.id, customerTeamMembers.teamId))
    .where(and(eq(customerTeamMembers.teamId, teamId), eq(customerTeamMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

// ─── Hata sözleşmesi ───────────────────────────────────────────────────────

/**
 * Beklenen ret: durum + makine kodu + MÜŞTERİNİN OKUYACAĞI Türkçe cümle.
 *
 * `QuoteServiceError`ın (`quote-service.ts:90`) birebir deseni ve aynı gerekçe:
 * rota katmanı `e.status`/`e.code`/`e.message`i olduğu gibi gövdeye yazar, yani
 * "beklenmeyen hata = gövdesi olan cevap" kuralı beklenen retlerde de tutar ve
 * hiçbir ret BOŞ GÖVDELİ 500'e düşmez.
 *
 * `code` kümesi tasarım §8'in kapalı listesidir (`not_member`, `not_allowed`,
 * `invite_expired`, `invite_email_mismatch`, `already_in_team`,
 * `owner_must_transfer`) + bu sevkiyatın üç eklemesi (`owner_transfer_race`,
 * `team_not_empty`, `invite_not_found`) ve gövde doğrulama kodları
 * (`invalid_name`, `invalid_body`). Arayüz (T-5) cümleyi doğrudan basabilir;
 * kodu yalnız özel bir ekran davranışı için okur.
 */
export class TeamServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "TeamServiceError";
  }
}

const NOT_ALLOWED = "Bu işlem için takımdaki yetkiniz yeterli değil.";
const NOT_MEMBER = "Bir takımda değilsiniz.";
const MEMBER_NOT_FOUND = "Bu kişi takımın üyesi değil.";

/** Saf yüklem `false` dediyse tek cevap vardır; karar burada değil ORADA verilir. */
function assertAllowed(allowed: boolean): void {
  if (!allowed) throw new TeamServiceError(NOT_ALLOWED, 403, "not_allowed");
}

/**
 * Davet ret sebebinin müşteriye giden karşılığı.
 *
 * `invite_revoked` ve `invite_used` tasarım §8'in kod kümesinde olmadığı için
 * `not_allowed`a düşer — AMA cümleleri ayrıdır: "iptal edilmiş" ile "zaten
 * kullanılmış" aynı şey değil ve davet edilen kişinin ne yapacağı (yeni davet
 * istemek / hiçbir şey) buna bağlı.
 */
const INVITE_REJECTION_RESPONSES: Record<
  InviteRejection,
  { status: number; code: string; message: string }
> = {
  invite_revoked: {
    status: 400,
    code: "not_allowed",
    message: "Bu davet iptal edilmiş. Takım yöneticisinden yeni bir davet isteyin.",
  },
  invite_used: {
    status: 400,
    code: "not_allowed",
    message: "Bu davet daha önce kullanılmış. Davet bağlantıları tek kullanımlıktır.",
  },
  invite_expired: {
    status: 400,
    code: "invite_expired",
    message: "Bu davetin süresi dolmuş. Takım yöneticisinden yeni bir davet isteyin.",
  },
  invite_no_identity: {
    status: 401,
    code: "not_allowed",
    message: "Daveti kabul etmek için davet edilen e-posta adresiyle giriş yapmanız gerekir.",
  },
  invite_email_mismatch: {
    status: 403,
    code: "invite_email_mismatch",
    message:
      "Bu davet başka bir e-posta adresine gönderilmiş. Davetin gittiği adresle giriş yapıp tekrar deneyin.",
  },
  already_in_team: {
    status: 400,
    code: "already_in_team",
    message:
      "Zaten bir takımdasınız. Bir kullanıcı aynı anda yalnız bir takımda olabilir; yeni bir takıma katılmak için önce mevcut takımdan ayrılmanız gerekir.",
  },
};

function rejectionError(reason: InviteRejection): TeamServiceError {
  const r = INVITE_REJECTION_RESPONSES[reason];
  return new TeamServiceError(r.message, r.status, r.code);
}

/**
 * drizzle 0.45'in SARDIĞI pg hatasından tekil indeks ihlalini okur.
 *
 * Yakalanan hatada `.code` `undefined`, gerçek kod `.cause`ta
 * ([[drizzle-error-wrapping]]) — bu yüzden İKİ yer de okunur. Yine de bu
 * fonksiyon İKİNCİ savunma hattıdır: her kapı INSERT'ten ÖNCE kontrol edilir
 * (değişmez 4), çünkü yalnız yakalamaya güvenen bir kapı drizzle'ın bir sonraki
 * sürümünde sessizce boş gövdeli 500'e dönebilir.
 */
function uniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  if ((e.code ?? e.cause?.code) !== "23505") return false;
  if (constraint === undefined) return true;
  const name = e.constraint ?? e.cause?.constraint;
  // Kısıt adı taşınmıyorsa daraltma YAPILMAZ: 23505'i yutup yanlış cümle
  // söylemek yerine, bu kapının beklediği ihlal sayılır.
  return name === undefined || name === constraint;
}

// ─── Üyelik okumaları ──────────────────────────────────────────────────────

/** Kullanıcının takımı + rolü + takım satırının tamamı. */
export interface TeamMembership {
  teamId: string;
  role: TeamRole;
  team: CustomerTeam;
}

/**
 * "Bu kullanıcının takımı" — TEK sorgu, TEK satır.
 *
 * Tek satır olabilmesinin sebebi bir kısıt: `customer_team_members_user_uq`
 * UNIQUE `(user_id)` (sahibin kararı 6.5). Çok takımlı üyelik yazılırsa bu
 * fonksiyonun imzası (ve onu çağıran her uç) değişmek zorunda — yani kararın
 * geri alınması derleyicide görünür, sessizce olmaz.
 */
export async function loadMembership(userId: string): Promise<TeamMembership | null> {
  const [row] = await db
    .select({ role: customerTeamMembers.role, team: customerTeams })
    .from(customerTeamMembers)
    .innerJoin(customerTeams, eq(customerTeams.id, customerTeamMembers.teamId))
    .where(eq(customerTeamMembers.userId, userId))
    .limit(1);
  if (!row) return null;
  return { teamId: row.team.id, role: row.role, team: row.team };
}

async function requireMembership(userId: string): Promise<TeamMembership> {
  const membership = await loadMembership(userId);
  if (!membership) throw new TeamServiceError(NOT_MEMBER, 403, "not_member");
  return membership;
}

/**
 * Hedef kişi BU takımın üyesi mi — rol kararları hedefin ROLÜNE dayanır.
 *
 * E-posta da döner çünkü her hedefli yazma bir İŞLEM BİLDİRİMİ tetikliyor
 * (rol değişti / çıkarıldın / sahip oldun) ve rota katmanının adresi ikinci bir
 * sorguyla aramasına gerek yok. Adres yalnız bildirime gider; üye listesinin ne
 * taşıdığı ayrı ve daha dar bir karardır (`listMembers`).
 */
async function requireTeamMember(
  teamId: string,
  userId: string
): Promise<{ role: TeamRole; email: string }> {
  const [row] = await db
    .select({ role: customerTeamMembers.role, email: users.email })
    .from(customerTeamMembers)
    .innerJoin(users, eq(users.id, customerTeamMembers.userId))
    .where(and(eq(customerTeamMembers.teamId, teamId), eq(customerTeamMembers.userId, userId)))
    .limit(1);
  if (!row) throw new TeamServiceError(MEMBER_NOT_FOUND, 404, "not_member");
  return row;
}

/** Üye satırı: tasarım değişmezi 6 — YALNIZ ad + e-posta + rol (+ katılma anı). */
export interface TeamMemberRow {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  joinedAt: Date;
}

/**
 * Takımın üyeleri.
 *
 * Telefon, adres ve adres defteri BİLEREK yok (tasarım §1.2): takımın teslimat
 * adresi AYRI ve takım düzeyinde girilir, üyenin kişisel adresi paylaşılmaz.
 * Buraya bir kolon eklemek bir KVKK kararıdır, bir kolaylık değil.
 */
export async function listMembers(teamId: string): Promise<TeamMemberRow[]> {
  return db
    .select({
      userId: customerTeamMembers.userId,
      name: users.fullName,
      email: users.email,
      role: customerTeamMembers.role,
      joinedAt: customerTeamMembers.joinedAt,
    })
    .from(customerTeamMembers)
    .innerJoin(users, eq(users.id, customerTeamMembers.userId))
    .where(eq(customerTeamMembers.teamId, teamId))
    .orderBy(customerTeamMembers.joinedAt);
}

/** Bekleyen davet satırı — ham token TAŞIMAZ (DB'de de yok, yalnız sha256'sı var). */
export interface TeamInviteRow {
  id: string;
  email: string;
  role: TeamInviteRole;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * BEKLEYEN davetler (kabul edilmemiş + iptal edilmemiş).
 *
 * Süresi dolmuş davet de listede kalır: ekran "süresi doldu" diyebilsin ve
 * yönetici yenileyebilsin. Kabul edilmiş/iptal edilmiş satırlar denetim izinde
 * yaşar, listede değil.
 */
export async function listInvites(teamId: string): Promise<TeamInviteRow[]> {
  return db
    .select({
      id: customerTeamInvites.id,
      email: customerTeamInvites.email,
      role: customerTeamInvites.role,
      expiresAt: customerTeamInvites.expiresAt,
      createdAt: customerTeamInvites.createdAt,
    })
    .from(customerTeamInvites)
    .where(
      and(
        eq(customerTeamInvites.teamId, teamId),
        isNull(customerTeamInvites.acceptedAt),
        isNull(customerTeamInvites.revokedAt)
      )
    )
    .orderBy(desc(customerTeamInvites.createdAt));
}

// ─── Denetim ───────────────────────────────────────────────────────────────

/**
 * `db.transaction` geri çağrısının aldığı işlem nesnesi — EN DAR hâliyle.
 * `recordTeamAction`ın tek ihtiyacı `insert`; daha genişi, denetim satırı
 * yazarken işin kendisine de dokunabilen bir yardımcı olurdu.
 */
type TeamTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TeamActionWriter = Pick<TeamTx, "insert">;

/**
 * Denetim satırı. `action` adı `TEAM_ACTIONS`tan GELMEK ZORUNDA: DB CHECK'i
 * (`customer_team_actions_action_chk`) aynı listeden kurulu, yani listede
 * olmayan bir ad `23514` ile düşer ve yazma işlemi tamamen geri alınır.
 *
 * `tx` ZORUNLU: denetim satırı işin KENDİSİYLE aynı işlemde yazılır. Ayrı bir
 * bağlantıdan yazılsa, işlemi geri alan bir hata "olmamış bir eylemi" izde
 * bırakırdı.
 */
async function recordTeamAction(
  tx: TeamActionWriter,
  args: {
    teamId: string;
    actorUserId: string | null;
    action: TeamAction;
    targetUserId?: string | null;
    targetQuoteId?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }
): Promise<void> {
  await tx.insert(customerTeamActions).values({
    teamId: args.teamId,
    actorUserId: args.actorUserId,
    action: args.action,
    targetUserId: args.targetUserId ?? null,
    targetQuoteId: args.targetQuoteId ?? null,
    before: args.before ?? null,
    after: args.after ?? null,
  });
}

// ─── Davet token'ı ─────────────────────────────────────────────────────────

/**
 * Ham token + sha256'sı. `password-reset.ts:17,22` deseninin birebir kopyası:
 * DB YALNIZ `hash` saklar, yani `customer_team_invites` tablosunun sızması
 * kullanılabilir TEK bir davet vermez.
 */
function newInviteToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: crypto.createHash("sha256").update(raw).digest("hex") };
}

function hashInviteToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ─── Takım kurma ve profil ─────────────────────────────────────────────────

const TEAM_NAME_MIN = 2;
const TEAM_NAME_MAX = 80;

/**
 * Ad doğrulaması SERVİSTE (şema yorumunun dediği yer). Rota katmanı zod ile aynı
 * sınırı tekrar söyler; bu iki kapı değil iki KATMAN: servis uçtan bağımsız
 * çağrılabilir (betik, ileride admin) ve sınır tek yerde tanımlı kalır.
 */
function validateTeamName(raw: string): string {
  const name = raw.trim();
  if (name.length < TEAM_NAME_MIN || name.length > TEAM_NAME_MAX) {
    throw new TeamServiceError(
      `Takım adı ${TEAM_NAME_MIN}-${TEAM_NAME_MAX} karakter olmalı.`,
      400,
      "invalid_name"
    );
  }
  return name;
}

/**
 * Takımı KURAR ve kurucuyu `owner` yapar — tek işlemde üç yazma.
 *
 * KAPI İKİ KATMANLI (değişmez 4): servis önce "zaten bir takımda mı" diye sorar
 * ve Türkçe `already_in_team` döner; `customer_team_members_user_uq` ikinci
 * savunma hattıdır. Yalnız ikinciye güvenmek `23505`e ve boş gövdeli 500'e yol
 * açardı.
 *
 * `kvkkNoticeVersion` ZORUNLU: kurucuya GÖSTERİLEN bilgilendirmenin sürümü
 * (metin değil sürüm). Onay anı `kvkk_consent_at` ile satırın kendisinde durur;
 * kurucunun üyelik satırında `kvkk_acknowledged_at` NULL kalır, çünkü onayı
 * takım satırında verdi.
 */
export async function createTeam(args: {
  userId: string;
  name: string;
  kvkkNoticeVersion: string;
}): Promise<{ teamId: string; team: CustomerTeam }> {
  const name = validateTeamName(args.name);
  if (await loadMembership(args.userId)) throw rejectionError("already_in_team");
  try {
    return await db.transaction(async (tx) => {
      const [team] = await tx
        .insert(customerTeams)
        .values({
          name,
          ownerUserId: args.userId,
          kvkkNoticeVersion: args.kvkkNoticeVersion,
        })
        .returning();
      await tx
        .insert(customerTeamMembers)
        .values({ teamId: team.id, userId: args.userId, role: "owner" });
      await recordTeamAction(tx, {
        teamId: team.id,
        actorUserId: args.userId,
        action: "team_created",
        targetUserId: args.userId,
        after: { name, kvkkNoticeVersion: args.kvkkNoticeVersion },
      });
      return { teamId: team.id, team };
    });
  } catch (e) {
    if (uniqueViolation(e, "customer_team_members_user_uq")) throw rejectionError("already_in_team");
    throw e;
  }
}

/** PATCH gövdesi: verilen alanlar yazılır, verilmeyenler DOKUNULMAZ. */
export interface TeamProfilePatch {
  name?: string;
  invoiceType?: InvoiceType;
  companyName?: string | null;
  taxId?: string | null;
  taxIdType?: "vkn" | "tckn" | null;
  taxOffice?: string | null;
  billingAddress?: TurkishAddress | null;
  shippingAddress?: TurkishAddress | null;
  memberCanCheckout?: boolean;
}

/** Fatura bölümünün kolonları — denetim satırının `before`/`after`ı bu listeden. */
const BILLING_FIELDS = [
  "invoiceType",
  "companyName",
  "taxId",
  "taxIdType",
  "taxOffice",
  "billingAddress",
  "memberCanCheckout",
] as const;

/**
 * Takımın adı, PAYLAŞILAN fatura bilgisi, PAYLAŞILAN teslimat adresi ve
 * `member_can_checkout` anahtarı.
 *
 * ─── FATURA BİLGİSİ YALNIZ ÖN DOLDURUR (bilinçli değişmez) ─────────────────
 *
 * Teklifin faturası `quotes.invoice_type/company_name/tax_id/tax_id_type/
 * tax_office/billing_address` kolonlarında DONAR (`schema.ts:3912-3917`) ve
 * ödeme sırasında oradan kesilir. Takımın bilgisini sonradan değiştirmek
 * **ödenmiş bir teklifin faturasını geçmişe dönük DEĞİŞTİRMEZ** ve
 * değiştirmemelidir: bir sonraki tur "takım faturası değişti, teklif faturası da
 * değişsin" diye bir senkronizasyon yazarsa muhasebe oynar.
 *
 * Teslimat adresi de yalnız SAKLANIR: `quotes`ta kardeş kolon YOKTUR, teslimat
 * ödeme sırasında müşteriden alınıp doğrudan taslağa yazılıyor
 * (`quote-checkout.ts` → `order_drafts.shippingAddress`). Ön doldurma T-5'in
 * işi; `order_drafts` yazımına ASLA dokunulmaz.
 *
 * Denetim: değişen BÖLÜM başına bir satır (`team_renamed` / `billing_updated` /
 * `shipping_updated`). Üçü `TEAM_ACTIONS`ta ayrı ad taşıyor çünkü üç ayrı
 * açıklama; hangisinin değiştiğini tek satıra sıkıştırmak izi yalancı yapardı.
 * `member_can_checkout` fatura bölümündedir: "takımın parasını kim
 * harcayabilir" sorusu fatura bilgisiyle aynı ekranda ve aynı yetkiyle
 * (`canEditTeamProfile`) yönetiliyor, ve listeye yeni bir ad eklemek migration
 * demek.
 */
export async function updateTeamProfile(args: {
  actorUserId: string;
  patch: TeamProfilePatch;
}): Promise<{ team: CustomerTeam; role: TeamRole }> {
  const membership = await requireMembership(args.actorUserId);
  assertAllowed(canEditTeamProfile(membership.role));

  const patch = args.patch;
  const set: Partial<typeof customerTeams.$inferInsert> = {};
  if (patch.name !== undefined) set.name = validateTeamName(patch.name);
  for (const field of BILLING_FIELDS) {
    if (patch[field] !== undefined) (set as Record<string, unknown>)[field] = patch[field];
  }
  if (patch.shippingAddress !== undefined) set.shippingAddress = patch.shippingAddress;
  if (Object.keys(set).length === 0) {
    throw new TeamServiceError("Güncellenecek bir alan gönderilmedi.", 400, "invalid_body");
  }

  const before = membership.team;
  return db.transaction(async (tx) => {
    const [team] = await tx
      .update(customerTeams)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(customerTeams.id, membership.teamId))
      .returning();
    if (set.name !== undefined && set.name !== before.name) {
      await recordTeamAction(tx, {
        teamId: team.id,
        actorUserId: args.actorUserId,
        action: "team_renamed",
        before: { name: before.name },
        after: { name: team.name },
      });
    }
    const billingChanged = BILLING_FIELDS.filter((f) => patch[f] !== undefined);
    if (billingChanged.length > 0) {
      await recordTeamAction(tx, {
        teamId: team.id,
        actorUserId: args.actorUserId,
        action: "billing_updated",
        before: Object.fromEntries(billingChanged.map((f) => [f, before[f]])),
        after: Object.fromEntries(billingChanged.map((f) => [f, team[f]])),
      });
    }
    if (patch.shippingAddress !== undefined) {
      await recordTeamAction(tx, {
        teamId: team.id,
        actorUserId: args.actorUserId,
        action: "shipping_updated",
        before: { shippingAddress: before.shippingAddress },
        after: { shippingAddress: team.shippingAddress },
      });
    }
    // Rol GÜNCELLENMEDİ ama cevaba giriyor: rota katmanı aynı isteği ikinci bir
    // üyelik sorgusuyla tamamlamasın (ekran rolü her cevapta okuyor).
    return { team, role: membership.role };
  });
}

/**
 * Takımı SİLER. Boş olmayan takım SİLİNMEZ.
 *
 * ÖN KONTROL (değişmez 4): başka üye, BEKLEYEN davet ya da takıma bağlı teklif
 * varsa `team_not_empty` döner. `quotes.team_id` `restrict` FK olduğu için DB de
 * reddeder, ama DB'nin reddi müşteriye söylenecek bir cümle taşımaz.
 *
 * ─── NEDEN ÇOCUK SATIRLARI DA SİLİYOR ──────────────────────────────────────
 *
 * Üç çocuk tablonun (`actions`, `invites`, `members`) `team_id`si `restrict` ve
 * NOT NULL. `createTeam` daima bir `team_created` denetim satırı yazdığı için
 * "yalnız takım satırını sil" HİÇ çalışmaz: silme her zaman 23503 ile düşerdi.
 * Denetim izi işaret ettiği takım yok olduğunda okunamaz hâle gelir; bu yüzden
 * takımın KENDİSİYLE birlikte, çocuktan ebeveyne doğru (migration down'ının
 * sırası) ve sahibin AÇIK isteğiyle silinir. Gerçek bir paylaşım ilişkisinin izi
 * (başka üye, bekleyen davet, bağlı teklif) duruyorsa yukarıdaki kapı çoktan
 * reddetmiştir.
 */
export async function deleteTeam(args: { actorUserId: string }): Promise<{ teamId: string }> {
  const membership = await requireMembership(args.actorUserId);
  assertAllowed(canDeleteTeam(membership.role));
  const teamId = membership.teamId;

  const [otherMember] = await db
    .select({ userId: customerTeamMembers.userId })
    .from(customerTeamMembers)
    .where(
      and(eq(customerTeamMembers.teamId, teamId), ne(customerTeamMembers.userId, args.actorUserId))
    )
    .limit(1);
  const [liveInvite] = await db
    .select({ id: customerTeamInvites.id })
    .from(customerTeamInvites)
    .where(
      and(
        eq(customerTeamInvites.teamId, teamId),
        isNull(customerTeamInvites.acceptedAt),
        isNull(customerTeamInvites.revokedAt)
      )
    )
    .limit(1);
  const [attachedQuote] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(eq(quotes.teamId, teamId))
    .limit(1);
  if (otherMember || liveInvite || attachedQuote) {
    throw new TeamServiceError(
      "Takım boş değil: silmeden önce üyeleri çıkarın, bekleyen davetleri iptal edin ve takıma bağlı teklifleri ayırın.",
      409,
      "team_not_empty"
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(customerTeamActions).where(eq(customerTeamActions.teamId, teamId));
    await tx.delete(customerTeamInvites).where(eq(customerTeamInvites.teamId, teamId));
    await tx.delete(customerTeamMembers).where(eq(customerTeamMembers.teamId, teamId));
    await tx.delete(customerTeams).where(eq(customerTeams.id, teamId));
  });
  return { teamId };
}

// ─── Davet yaşam döngüsü ───────────────────────────────────────────────────

/** `inviteMember`in dönüşü. `rawToken` YALNIZ burada yaşar: tek tüketicisi e-posta. */
export interface IssuedInvite {
  inviteId: string;
  /** HAM token. Cevap gövdesine YAZILMAZ; davet e-postasının bağlantısıdır. */
  rawToken: string;
  email: string;
  role: TeamInviteRole;
  expiresAt: Date;
  teamName: string;
  /** Daveti GÖNDEREN kişinin adı — davet e-postasının "kim davet etti" cümlesi. */
  inviterName: string;
  /** Yenileme olduysa iptal edilen eski davetin kimliği (denetim izinde de var). */
  renewedInviteId: string | null;
}

/**
 * Davet gönderir ya da YENİLER.
 *
 * `customer_team_invites_live_uq` UNIQUE `(team_id, email) WHERE accepted_at IS
 * NULL AND revoked_at IS NULL` aynı adrese iki CANLI davet bırakmıyor, yani
 * "yeniden gönder" bir hata değil tek bir YENİLEME işlemidir: eskisi
 * `revoked_at` ile kapatılır ve yenisi AYNI işlemde yazılır. Sıra tersine
 * çevrilse (önce yaz, sonra kapat) INSERT tekil indekse çarpardı.
 *
 * ÖN KONTROL: bu adresin sahibi ZATEN bir takımdaysa davet GÖNDERİLMEZ — kabul
 * edilemeyeceği kesin olan bir davet, davet edilene gereksiz bir e-posta ve
 * desteğe bir "neden çalışmıyor" sorusudur.
 *
 * `owner` rolü davetle VERİLMEZ: hem tip (`TeamInviteRole`, owner'ı dışlayan
 * liste) hem DB CHECK'i (`customer_team_invites_role_chk`) aynı listeden kurulu.
 */
export async function inviteMember(args: {
  actorUserId: string;
  email: string;
  role: TeamInviteRole;
}): Promise<IssuedInvite> {
  const membership = await requireMembership(args.actorUserId);
  assertAllowed(canInvite(membership.role));
  const email = normalizeTeamEmail(args.email);

  const [clash] = await db
    .select({ teamId: customerTeamMembers.teamId })
    .from(users)
    .innerJoin(customerTeamMembers, eq(customerTeamMembers.userId, users.id))
    .where(eq(users.email, email))
    .limit(1);
  if (clash) {
    throw new TeamServiceError(
      clash.teamId === membership.teamId
        ? "Bu kişi zaten takımın üyesi."
        : "Bu e-posta adresinin sahibi başka bir takımda. Bir kullanıcı aynı anda yalnız bir takımda olabilir.",
      400,
      "already_in_team"
    );
  }

  const [inviter] = await db
    .select({ name: users.fullName })
    .from(users)
    .where(eq(users.id, args.actorUserId))
    .limit(1);

  const { raw, hash } = newInviteToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  return db.transaction(async (tx) => {
    const closed = await tx
      .update(customerTeamInvites)
      .set({ revokedAt: now, revokedByUserId: args.actorUserId })
      .where(
        and(
          eq(customerTeamInvites.teamId, membership.teamId),
          eq(customerTeamInvites.email, email),
          isNull(customerTeamInvites.acceptedAt),
          isNull(customerTeamInvites.revokedAt)
        )
      )
      .returning({ id: customerTeamInvites.id });
    const [invite] = await tx
      .insert(customerTeamInvites)
      .values({
        teamId: membership.teamId,
        email,
        role: args.role,
        tokenHash: hash,
        invitedByUserId: args.actorUserId,
        expiresAt,
      })
      .returning({ id: customerTeamInvites.id });
    const renewedInviteId = closed[0]?.id ?? null;
    // Denetim izi davet edilen ADRESİ taşır (eylemin konusu o) ama HAM TOKEN'I
    // taşımaz: izi okuyan yönetici kimin davet edildiğini görür, kimsenin
    // davetini kabul edemez.
    await recordTeamAction(tx, {
      teamId: membership.teamId,
      actorUserId: args.actorUserId,
      action: "invite_sent",
      before: renewedInviteId ? { renewedInviteId } : null,
      after: { inviteId: invite.id, email, role: args.role, expiresAt: expiresAt.toISOString() },
    });
    return {
      inviteId: invite.id,
      rawToken: raw,
      email,
      role: args.role,
      expiresAt,
      teamName: membership.team.name,
      inviterName: inviter?.name ?? membership.team.name,
      renewedInviteId,
    };
  });
}

/** Bekleyen daveti iptal eder. Kabul edilmiş davet iptal EDİLMEZ (üyelik ayrı kapı). */
export async function revokeInvite(args: {
  actorUserId: string;
  inviteId: string;
}): Promise<{ email: string; role: TeamInviteRole }> {
  const membership = await requireMembership(args.actorUserId);
  assertAllowed(canInvite(membership.role));
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .update(customerTeamInvites)
      .set({ revokedAt: new Date(), revokedByUserId: args.actorUserId })
      .where(
        and(
          eq(customerTeamInvites.id, args.inviteId),
          // Takım koşulu bir KAPIDIR: başka takımın davet kimliğini bilen biri
          // onu iptal edemez.
          eq(customerTeamInvites.teamId, membership.teamId),
          isNull(customerTeamInvites.acceptedAt),
          isNull(customerTeamInvites.revokedAt)
        )
      )
      .returning({ email: customerTeamInvites.email, role: customerTeamInvites.role });
    if (!invite) {
      throw new TeamServiceError("Bekleyen böyle bir davet yok.", 404, "invite_not_found");
    }
    await recordTeamAction(tx, {
      teamId: membership.teamId,
      actorUserId: args.actorUserId,
      action: "invite_revoked",
      before: { email: invite.email, role: invite.role },
    });
    return invite;
  });
}

/**
 * Daveti KABUL eder ve üyelik satırını yazar.
 *
 * ─── KABUL, DAVET EDİLEN E-POSTAYLA GİRİŞ YAPMAYI ŞART KOŞAR ───────────────
 *
 * Token'ı ele geçiren BAŞKA bir hesap kabul EDEMEZ. Karar saf yüklemde
 * (`inviteAcceptable`) ve karşılaştırmanın iki tarafı da `normalizeTeamEmail`den
 * geçer: tekil indeks (`customer_team_invites_live_uq`) ile bu kapı aynı
 * normalizasyonu paylaşmak ZORUNDA.
 *
 * TEK KULLANIMLIK iki katmanda: yüklem `accepted_at` dolu daveti reddeder, ve
 * tüketme UPDATE'i `accepted_at IS NULL` KOŞULUYLA yazılır — iki eşzamanlı kabul
 * denemesinden yalnız biri satırı tüketir, ikincisi 0 satır günceller ve aynı
 * Türkçe cevabı alır.
 */
export async function acceptInvite(args: {
  rawToken: string;
  userId: string;
  email: string;
}): Promise<{ teamId: string; teamName: string; role: TeamInviteRole }> {
  const [invite] = await db
    .select()
    .from(customerTeamInvites)
    .where(eq(customerTeamInvites.tokenHash, hashInviteToken(args.rawToken)))
    .limit(1);
  if (!invite) {
    throw new TeamServiceError(
      "Davet bulunamadı. Bağlantının tamamını kopyaladığınızdan emin olun.",
      404,
      "not_allowed"
    );
  }
  const rejection = inviteAcceptable(
    {
      revokedAt: invite.revokedAt,
      acceptedAt: invite.acceptedAt,
      expiresAt: invite.expiresAt,
      inviteEmail: invite.email,
      sessionEmail: args.email,
      alreadyInTeam: (await loadMembership(args.userId)) !== null,
    },
    new Date()
  );
  if (rejection) throw rejectionError(rejection);

  try {
    return await db.transaction(async (tx) => {
      const consumed = await tx
        .update(customerTeamInvites)
        .set({ acceptedAt: new Date(), acceptedUserId: args.userId })
        .where(
          and(
            eq(customerTeamInvites.id, invite.id),
            isNull(customerTeamInvites.acceptedAt),
            isNull(customerTeamInvites.revokedAt)
          )
        )
        .returning({ id: customerTeamInvites.id });
      if (consumed.length === 0) throw rejectionError("invite_used");
      await tx.insert(customerTeamMembers).values({
        teamId: invite.teamId,
        userId: args.userId,
        role: invite.role,
        invitedByUserId: invite.invitedByUserId,
        // Kabul ekranındaki onay kutusunun damgası (tasarım §8, KVKK 2).
        kvkkAcknowledgedAt: new Date(),
      });
      await recordTeamAction(tx, {
        teamId: invite.teamId,
        actorUserId: args.userId,
        action: "invite_accepted",
        targetUserId: args.userId,
        after: { inviteId: invite.id, role: invite.role },
      });
      const [team] = await tx
        .select({ name: customerTeams.name })
        .from(customerTeams)
        .where(eq(customerTeams.id, invite.teamId))
        .limit(1);
      return { teamId: invite.teamId, teamName: team.name, role: invite.role };
    });
  } catch (e) {
    // İkinci savunma hattı: ön kontrol ile INSERT arasına giren başka bir kabul.
    if (uniqueViolation(e, "customer_team_members_user_uq")) throw rejectionError("already_in_team");
    throw e;
  }
}

// ─── Rol, çıkarma, ayrılma, devir ──────────────────────────────────────────

/** Rol değiştirir. Asimetriler saf yüklemde (`canAssignRole`), burada DEĞİL. */
export async function changeRole(args: {
  actorUserId: string;
  targetUserId: string;
  nextRole: TeamRole;
}): Promise<{ teamName: string; email: string; previousRole: TeamRole; role: TeamRole }> {
  const membership = await requireMembership(args.actorUserId);
  const target = await requireTeamMember(membership.teamId, args.targetUserId);
  assertAllowed(canAssignRole(membership.role, target.role, args.nextRole));
  if (target.role === args.nextRole) {
    throw new TeamServiceError("Üye zaten bu rolde.", 400, "invalid_body");
  }
  return db.transaction(async (tx) => {
    await tx
      .update(customerTeamMembers)
      .set({ role: args.nextRole, updatedAt: new Date() })
      .where(
        and(
          eq(customerTeamMembers.teamId, membership.teamId),
          eq(customerTeamMembers.userId, args.targetUserId)
        )
      );
    await recordTeamAction(tx, {
      teamId: membership.teamId,
      actorUserId: args.actorUserId,
      action: "role_changed",
      targetUserId: args.targetUserId,
      before: { role: target.role },
      after: { role: args.nextRole },
    });
    return {
      teamName: membership.team.name,
      email: target.email,
      previousRole: target.role,
      role: args.nextRole,
    };
  });
}

/**
 * Üyeyi ÇIKARIR — üyelik satırı SİLİNİR, soft-delete YOK.
 *
 * Gerekçe: `teamMembershipFor` önbelleksizdir ve her istekte taze okur, yani
 * satır silindiği an bir sonraki istekte erişim kesilir (tasarım §3.3). Bir
 * `revoked_at` kolonu aynı kapıyı iki sorguya bölerdi ("üye mi" + "hâlâ geçerli
 * mi") ve ikisinden birini unutan bir çağıran çıkarılmış üyeyi içeride
 * bırakırdı.
 *
 * ÜYE ÇIKARMAK PARA TAŞIMAZ: ödenmiş siparişler ödeyende (`orders.userId`)
 * kalır, iade ödeyene gider, hediye kredisi `redeemedByUserId`e bağlıdır.
 * Çıkarılan üyenin KENDİ açtığı teklifler `quotes.user_id` üzerinden ona
 * görünmeye devam eder (kişisel sahip dalı).
 */
export async function removeMember(args: {
  actorUserId: string;
  targetUserId: string;
}): Promise<{ teamName: string; email: string; role: TeamRole }> {
  if (args.actorUserId === args.targetUserId) {
    throw new TeamServiceError(
      "Kendinizi çıkaramazsınız; takımdan ayrılmak için ayrılma işlemini kullanın.",
      400,
      "not_allowed"
    );
  }
  const membership = await requireMembership(args.actorUserId);
  const target = await requireTeamMember(membership.teamId, args.targetUserId);
  assertAllowed(canRemoveMember(membership.role, target.role));
  return db.transaction(async (tx) => {
    await tx
      .delete(customerTeamMembers)
      .where(
        and(
          eq(customerTeamMembers.teamId, membership.teamId),
          eq(customerTeamMembers.userId, args.targetUserId)
        )
      );
    await recordTeamAction(tx, {
      teamId: membership.teamId,
      actorUserId: args.actorUserId,
      action: "member_removed",
      targetUserId: args.targetUserId,
      before: { role: target.role },
    });
    return { teamName: membership.team.name, email: target.email, role: target.role };
  });
}

/**
 * Takımdan AYRILIR. Sahip ayrılamaz: önce devretmek zorunda
 * (`canLeave("owner") === false`), yoksa takım öksüz kalır ve
 * `customer_team_members_one_owner_idx` bir sonraki devri de kilitler.
 */
export async function leaveTeam(args: {
  actorUserId: string;
}): Promise<{ teamName: string; role: TeamRole }> {
  const membership = await requireMembership(args.actorUserId);
  if (!canLeave(membership.role)) {
    throw new TeamServiceError(
      "Takımın sahibi ayrılamaz: önce sahipliği başka bir üyeye devretmeniz gerekir.",
      400,
      "owner_must_transfer"
    );
  }
  return db.transaction(async (tx) => {
    await tx
      .delete(customerTeamMembers)
      .where(
        and(
          eq(customerTeamMembers.teamId, membership.teamId),
          eq(customerTeamMembers.userId, args.actorUserId)
        )
      );
    await recordTeamAction(tx, {
      teamId: membership.teamId,
      actorUserId: args.actorUserId,
      action: "member_left",
      targetUserId: args.actorUserId,
      before: { role: membership.role },
    });
    return { teamName: membership.team.name, role: membership.role };
  });
}

function ownerTransferRace(): TeamServiceError {
  return new TeamServiceError(
    "Sahiplik devri aynı anda başka bir istek tarafından yapıldı. Takımın güncel hâlini görmek için sayfayı yenileyin.",
    409,
    "owner_transfer_race"
  );
}

/**
 * Sahipliği devreder — TEK İŞLEMDE iki üyelik satırı + takım satırı.
 *
 * ─── SIRA ZORUNLU: ÖNCE DÜŞÜR, SONRA YÜKSELT ───────────────────────────────
 *
 * `customer_team_members_one_owner_idx` UNIQUE `(team_id) WHERE role = 'owner'`
 * kısmi tekil indeksi ERTELENEBİLİR DEĞİL: hedefi önce `owner` yapmak, tek
 * sıralı çağrıda bile 23505 verirdi. Bu yüzden eski sahip ÖNCE `admin` olur.
 *
 * ─── YARIŞ İKİ KATMANDA KESİLİR ────────────────────────────────────────────
 *
 * 1. Düşürme UPDATE'i `role = 'owner'` KOŞULUYLA yazılır. İki eşzamanlı çağrıda
 *    ikinci istek satır kilidinde bekler; kilit açıldığında satır artık `admin`
 *    olduğu için 0 satır günceller ve 409 `owner_transfer_race` alır. Yarışı
 *    kesen şey ilk işlemin TUTTUĞU satır kilidi + koşuldur.
 * 2. Yükseltme yine de 23505 alırsa (başka bir yoldan ikinci bir sahip
 *    yazılmışsa) aynı 409'a çevrilir — boş gövdeli 500 bırakılmaz.
 *
 * `customer_teams.owner_user_id` de GÜNCELLENİR: güncellenmezse takım satırı
 * üyelik satırlarıyla çelişir ve "takımın sahibi kim" sorusunun iki farklı
 * cevabı olur.
 */
export async function transferOwnership(args: {
  actorUserId: string;
  targetUserId: string;
}): Promise<{ teamName: string; email: string; previousRole: TeamRole }> {
  const membership = await requireMembership(args.actorUserId);
  assertAllowed(canTransferOwnership(membership.role));
  if (args.actorUserId === args.targetUserId) {
    throw new TeamServiceError("Sahiplik zaten sizde.", 400, "invalid_body");
  }
  const target = await requireTeamMember(membership.teamId, args.targetUserId);
  const now = new Date();
  return db.transaction(async (tx) => {
    const demoted = await tx
      .update(customerTeamMembers)
      .set({ role: "admin", updatedAt: now })
      .where(
        and(
          eq(customerTeamMembers.teamId, membership.teamId),
          eq(customerTeamMembers.userId, args.actorUserId),
          eq(customerTeamMembers.role, "owner")
        )
      )
      .returning({ id: customerTeamMembers.id });
    if (demoted.length === 0) throw ownerTransferRace();
    try {
      await tx
        .update(customerTeamMembers)
        .set({ role: "owner", updatedAt: now })
        .where(
          and(
            eq(customerTeamMembers.teamId, membership.teamId),
            eq(customerTeamMembers.userId, args.targetUserId)
          )
        );
    } catch (e) {
      if (uniqueViolation(e, "customer_team_members_one_owner_idx")) throw ownerTransferRace();
      throw e;
    }
    await tx
      .update(customerTeams)
      .set({ ownerUserId: args.targetUserId, updatedAt: now })
      .where(eq(customerTeams.id, membership.teamId));
    await recordTeamAction(tx, {
      teamId: membership.teamId,
      actorUserId: args.actorUserId,
      action: "ownership_transferred",
      targetUserId: args.targetUserId,
      before: { ownerUserId: args.actorUserId, targetRole: target.role },
      after: { ownerUserId: args.targetUserId, previousOwnerRole: "admin" },
    });
    return { teamName: membership.team.name, email: target.email, previousRole: target.role };
  });
}
