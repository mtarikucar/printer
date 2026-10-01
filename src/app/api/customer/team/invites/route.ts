/**
 * `/api/customer/team/invites` — davet gönder / bekleyen davetleri listele (0072).
 *
 * YÖNTEM KÜMESİ SÖZLEŞMEDİR (tasarım §6.1): **POST** (davet), **GET** (liste).
 * Başka yöntem YOK; T-5 yalnız bu ikisini çağırabilir
 * (`scripts/test-customer-team-api.ts`).
 *
 * ─── BU UCUN ÜÇ KAPISI VAR, ÜÇÜ DE AYRI BİR SALDIRIYA KARŞI ────────────────
 *
 * 1. **IP başına limit** — gövde AYRIŞTIRILMADAN ÖNCE koşar. Tersi, limitin
 *    kendisini bir CPU saldırı yüzeyine çevirirdi.
 * 2. **Turnstile** — otomatik davet yağmurunu keser.
 * 3. **Alıcı e-postası başına limit** — asıl koruma. 1'deki IP kovası,
 *    `TRUSTED_PROXY_IPS` yapılandırılmamış bir kurulumda `X-Forwarded-For`
 *    uydurularak atlatılabilir; bu kova, kaç IP dolaşılırsa dolaşılsın TEK bir
 *    gelen kutusuna gidebilecek markalı e-posta sayısını sınırlar
 *    (`api/workshop-requests/route.ts:117`in aynı gerekçesi).
 *
 * HAM TOKEN CEVAP GÖVDESİNE YAZILMAZ: tek tüketicisi davet e-postasıdır. Uç onu
 * döndürse, daveti gönderen kişi davet edilenin yerine kabul edebilirdi.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  CUSTOMER_ACTION_FAILED_ERROR,
  CUSTOMER_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { TEAM_INVITE_ROLES, canInvite } from "@/lib/config/quote-team";
import { getSessionUser } from "@/lib/services/customer-auth";
import { sendTeamInviteEmail } from "@/lib/services/customer-team-notify";
import {
  TeamServiceError,
  inviteMember,
  listInvites,
  loadMembership,
} from "@/lib/services/customer-team";
import { teamsEnabled } from "@/lib/services/quote-access";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import { verifyTurnstileToken } from "@/lib/services/turnstile";
import {
  TEAM_NOT_FOUND,
  inviteEmailRateKey,
  teamRouteBody,
  teamJsonBody,
  teamTooManyRequests,
  teamUnauthorized,
} from "../_shared";

export const dynamic = "force-dynamic";

const inviteSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta adresi girin").max(160),
  // `owner` BİLEREK listede yok: sahiplik davetle verilmez, yalnız devirle.
  role: z.enum(TEAM_INVITE_ROLES, { message: "Geçerli bir rol seçin" }),
  turnstileToken: z.string().optional(),
});

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);

  // 1) IP limiti — gövdeden BAĞIMSIZ ve gövdeden ÖNCE.
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`team-invite:ip:${ip}`, 20, 60 * 60 * 1000)).success) {
    return teamTooManyRequests();
  }

  const body = await teamJsonBody(request);

  // 2) Bot kontrolü (TURNSTILE_SECRET_KEY yokken dev'de no-op).
  const token = (body as { turnstileToken?: unknown }).turnstileToken;
  if (!(await verifyTurnstileToken(typeof token === "string" ? token : "", ip))) {
    throw new TeamServiceError(
      "Doğrulama başarısız. Sayfayı yenileyip tekrar deneyin.",
      403,
      "not_allowed"
    );
  }

  const data = inviteSchema.parse(body);

  // 3) Alıcı başına limit: takma adlar daraltılır, adres anahtara açık yazılmaz.
  if (
    !(await rateLimitAsync(`team-invite:email:${inviteEmailRateKey(data.email)}`, 3, 24 * 60 * 60 * 1000))
      .success
  ) {
    return teamTooManyRequests();
  }

  const invite = await inviteMember({
    actorUserId: session.userId,
    email: data.email,
    role: data.role,
  });

  // İŞLEM BİLDİRİMİ (ticari ileti DEĞİL): `users.marketingConsent` aranmaz.
  // `.catch()` zorunlu: posta arızası daveti geri almaz — satır yazıldıysa davet
  // VARDIR ve yönetici "yeniden gönder" ile yenileyebilir.
  await sendTeamInviteEmail({
    email: invite.email,
    teamName: invite.teamName,
    role: invite.role,
    inviterName: invite.inviterName,
    rawToken: invite.rawToken,
    expiresAt: invite.expiresAt,
  }).catch((e) => console.error("team invite email failed (non-fatal)", e));

  // Cevap: davetin KENDİSİ, token'ı OLMADAN.
  return NextResponse.json(
    {
      invite: {
        id: invite.inviteId,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
      renewed: invite.renewedInviteId !== null,
    },
    { status: 201 }
  );
}

async function handleGET(request: NextRequest): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);

  const membership = await loadMembership(session.userId);
  if (!membership) {
    throw new TeamServiceError("Bir takımda değilsiniz.", 403, "not_member");
  }
  // Bekleyen davetler yalnız onlarla bir şey YAPABİLEN role gösterilir: davet
  // edilmiş kişilerin adresleri, iptal/yenileme yetkisi olmayan bir üyenin
  // işine yaramaz ve gereksiz bir yayılımdır.
  if (!canInvite(membership.role)) {
    throw new TeamServiceError(
      "Bekleyen davetleri yalnız takım sahibi ve yöneticiler görebilir.",
      403,
      "not_allowed"
    );
  }
  return NextResponse.json({ invites: await listInvites(membership.teamId) });
}

export async function POST(request: NextRequest) {
  try {
    return await teamRouteBody(() => handlePOST(request));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/customer/team/invites", CUSTOMER_ACTION_FAILED_ERROR);
  }
}

export async function GET(request: NextRequest) {
  try {
    return await teamRouteBody(() => handleGET(request));
  } catch (e) {
    return handleRouteFailure(e, "GET /api/customer/team/invites", CUSTOMER_READ_FAILED_ERROR);
  }
}
