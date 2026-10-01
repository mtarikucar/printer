/**
 * `/api/customer/team/invites/[id]` — bekleyen daveti İPTAL et (0072).
 *
 * YÖNTEM KÜMESİ SÖZLEŞMEDİR (tasarım §6.1): yalnız **DELETE**.
 *
 * `[id]` davet kimliğidir ve TEK BAŞINA bir hak vermez: servis katmanı
 * `WHERE id = … AND team_id = <çağıranın takımı>` yazar, yani başka bir takımın
 * davet kimliğini bilen biri onu iptal edemez (cevap "bekleyen böyle bir davet
 * yok" olur, "senin değil" değil).
 *
 * Kabul edilmiş bir davet buradan iptal EDİLMEZ: o artık bir üyeliktir ve kapısı
 * `members/[userId]` DELETE'tir.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { getSessionUser } from "@/lib/services/customer-auth";
import { revokeInvite } from "@/lib/services/customer-team";
import { teamsEnabled } from "@/lib/services/quote-access";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import {
  TEAM_NOT_FOUND,
  teamRouteBody,
  teamTooManyRequests,
  teamUnauthorized,
} from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleDELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`team-invite-revoke:${ip}`, 30, 60 * 60 * 1000)).success) {
    return teamTooManyRequests();
  }

  const { id } = await ctx.params;
  const invite = await revokeInvite({ actorUserId: session.userId, inviteId: id });
  // İptal edilen kişiye e-posta GÖNDERİLMEZ: davet edildiğini bilen kişi,
  // bağlantıyı denediğinde "bu davet iptal edilmiş" cümlesini zaten görür ve
  // "davet edildin / edilmedin" diye ikinci bir bildirim göndermek, henüz
  // taraf olmayan birine gereksiz bir ileti olurdu.
  return NextResponse.json({ success: true, email: invite.email });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    return await teamRouteBody(() => handleDELETE(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "DELETE /api/customer/team/invites/[id]",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}
