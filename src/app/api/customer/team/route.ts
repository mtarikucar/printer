/**
 * `/api/customer/team` — takımın kendisi (0072).
 *
 * YÖNTEM KÜMESİ SÖZLEŞMEDİR (tasarım §6.1):
 *
 *   GET    takım + üyeler + bekleyen davetler
 *   POST   takımı kur (KVKK onayı zorunlu)
 *   PATCH  ad / fatura / teslimat / `member_can_checkout`
 *   DELETE takımı sil (boş değilse reddedilir)
 *
 * T-5 yalnız BU yöntemleri çağırabilir: `scripts/test-api-contracts.ts`
 * istemcideki her düz `fetch` çağrısını (yolu `/api/` ile başlayan, yöntemi
 * `init`te yazan) tarayıp hedef rotanın o yöntemi GERÇEKTEN dışa açtığını
 * iddia ediyor; `scripts/test-customer-team-api.ts` ise tersini — rotanın
 * tablodan FAZLA ya da EKSİK yöntem açmadığını — iddia ediyor.
 *
 * (Yukarıdaki cümlede örnek bir çağrı YAZILMIYOR: o tarayıcı metin üzerinde
 * çalışıyor ve yorumdaki örnek, var olmayan bir uca giden "istemci çağrısı"
 * sayılıp testi kırıyor — ölçüldü.)
 *
 * HER YÖNTEMDE SIRA: bayrak (kapalıysa 404) → oturum (yoksa 401) → yazanlarda
 * oran limiti (gövde AYRIŞTIRILMADAN ÖNCE) → zod → servis.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CUSTOMER_ACTION_FAILED_ERROR, CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { INVOICE_TYPES } from "@/lib/config/quote-types";
import { TEAM_KVKK_NOTICE_VERSION, canInvite } from "@/lib/config/quote-team";
import { getSessionUser } from "@/lib/services/customer-auth";
import type { CustomerTeam } from "@/lib/db/schema";
import {
  createTeam,
  deleteTeam,
  listInvites,
  listMembers,
  loadMembership,
  updateTeamProfile,
} from "@/lib/services/customer-team";
import { teamsEnabled } from "@/lib/services/quote-access";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import {
  TEAM_NOT_FOUND,
  kvkkConsentField,
  teamRouteBody,
  teamJsonBody,
  teamTooManyRequests,
  teamUnauthorized,
} from "./_shared";

export const dynamic = "force-dynamic";

const addressField = z.object({
  adres: z.string().trim().min(5, "Açık adres gerekli").max(500),
  mahalle: z.string().trim().max(120).optional(),
  ilce: z.string().trim().min(2, "İlçe gerekli").max(80),
  il: z.string().trim().min(2, "İl gerekli").max(80),
  postaKodu: z.string().trim().min(4, "Posta kodu gerekli").max(10),
  telefon: z.string().trim().min(7, "Telefon gerekli").max(30),
});

const createSchema = z.object({
  name: z.string().trim().min(2, "Takım adı en az 2 karakter olmalı").max(80),
  kvkkConsent: kvkkConsentField,
});

/**
 * Hepsi `optional`: verilmeyen alan DOKUNULMAZ. `nullable` olanlar BİLEREK
 * boşaltılabilir (firma bilgisini silmek bir işlemdir), `name` ve
 * `memberCanCheckout` boşaltılamaz.
 */
const patchSchema = z.object({
  name: z.string().trim().min(2, "Takım adı en az 2 karakter olmalı").max(80).optional(),
  invoiceType: z.enum(INVOICE_TYPES).optional(),
  companyName: z.string().trim().max(200).nullable().optional(),
  taxId: z.string().trim().max(20).nullable().optional(),
  taxIdType: z.enum(["vkn", "tckn"]).nullable().optional(),
  taxOffice: z.string().trim().max(120).nullable().optional(),
  billingAddress: addressField.nullable().optional(),
  shippingAddress: addressField.nullable().optional(),
  memberCanCheckout: z.boolean().optional(),
});

/**
 * Müşteriye giden takım gövdesi.
 *
 * `kvkkNoticeVersion` ve `kvkkConsentAt` DIŞARIDA: onay kaydı denetim verisidir,
 * ekranın göstereceği bir şey değil. `ownerUserId` de dışarıda — sahibin kim
 * olduğu üye listesindeki `owner` rolünden okunur ve ikinci bir kimlik alanı
 * aynı gerçeğin ikinci kopyası olurdu.
 *
 * Fatura ve teslimat bilgisi TAKIMIN her üyesine (viewer dahil) gider, çünkü o
 * bilgi FİRMANIN bilgisidir, kişisel veri değil (tasarım §4, `quote-present.ts`
 * `invoice` alanının aynı gerekçesi). Üyenin kişisel adresi ve telefonu ise
 * hiçbir yerde paylaşılmaz — DÜZENLEME yetkisi ayrıdır (`canEditTeamProfile`).
 */
function publicTeam(t: CustomerTeam) {
  return {
    id: t.id,
    name: t.name,
    invoiceType: t.invoiceType,
    companyName: t.companyName,
    taxId: t.taxId,
    taxIdType: t.taxIdType,
    taxOffice: t.taxOffice,
    billingAddress: t.billingAddress,
    shippingAddress: t.shippingAddress,
    memberCanCheckout: t.memberCanCheckout,
    createdAt: t.createdAt,
  };
}

async function handleGET(request: NextRequest): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);

  const membership = await loadMembership(session.userId);
  // Takımı OLMAYAN müşteri bir hata değil: ekran "takım kur" diyecek.
  if (!membership) {
    return NextResponse.json({ team: null, role: null, members: [], invites: [] });
  }
  // Üye satırı YALNIZ ad + e-posta + rol taşır (tasarım değişmezi 6); bekleyen
  // davetler yalnız onlarla bir şey YAPABİLEN role gider.
  const [members, invites] = await Promise.all([
    listMembers(membership.teamId),
    canInvite(membership.role) ? listInvites(membership.teamId) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    team: publicTeam(membership.team),
    role: membership.role,
    members,
    invites,
  });
}

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);
  // Oran limiti GÖVDE AYRIŞTIRILMADAN ÖNCE: tersi, limitin kendisini bir CPU
  // saldırı yüzeyine çevirirdi (`api/workshop-requests/route.ts:80` sırası).
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`team-create:${ip}`, 5, 60 * 60 * 1000)).success) {
    return teamTooManyRequests();
  }

  const data = createSchema.parse(await teamJsonBody(request));
  const { team } = await createTeam({
    userId: session.userId,
    name: data.name,
    // Onayın KANITI: kullanıcıya gösterilen bilgilendirmenin sürümü satıra
    // yazılır (`kvkk_consent_at` DB varsayılanıyla aynı anda damgalanır).
    kvkkNoticeVersion: TEAM_KVKK_NOTICE_VERSION,
  });
  return NextResponse.json(
    { team: publicTeam(team), role: "owner" },
    { status: 201 }
  );
}

async function handlePATCH(request: NextRequest): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`team-update:${ip}`, 30, 60 * 60 * 1000)).success) {
    return teamTooManyRequests();
  }

  const patch = patchSchema.parse(await teamJsonBody(request));
  // FATURA BİLGİSİ YALNIZ ÖN DOLDURUR: teklifin faturası ödeme anında
  // `quotes.invoice_*` kolonlarında DONAR (`schema.ts:3912-3917`), yani burada
  // yapılan bir değişiklik ÖDENMİŞ bir teklifin faturasını geçmişe dönük
  // DEĞİŞTİRMEZ ve değiştirmemelidir. Teslimat adresi de yalnız SAKLANIR;
  // ödeme formunu ön doldurması T-5'in işi, `order_drafts` yazımına
  // dokunulmaz.
  const { team, role } = await updateTeamProfile({ actorUserId: session.userId, patch });
  return NextResponse.json({ team: publicTeam(team), role });
}

async function handleDELETE(request: NextRequest): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`team-delete:${ip}`, 5, 60 * 60 * 1000)).success) {
    return teamTooManyRequests();
  }

  await deleteTeam({ actorUserId: session.userId });
  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  try {
    return await teamRouteBody(() => handleGET(request));
  } catch (e) {
    return handleRouteFailure(e, "GET /api/customer/team", CUSTOMER_READ_FAILED_ERROR);
  }
}

export async function POST(request: NextRequest) {
  try {
    return await teamRouteBody(() => handlePOST(request));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/customer/team", CUSTOMER_ACTION_FAILED_ERROR);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    return await teamRouteBody(() => handlePATCH(request));
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/customer/team", CUSTOMER_ACTION_FAILED_ERROR);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return await teamRouteBody(() => handleDELETE(request));
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/customer/team", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
