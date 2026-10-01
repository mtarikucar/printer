/**
 * `/api/customer/team/members/[userId]` — rol değiştir / üyeyi çıkar / ayrıl (0072).
 *
 * YÖNTEM KÜMESİ SÖZLEŞMEDİR (tasarım §6.1): **PATCH** (rol), **DELETE**
 * (çıkar / ayrıl).
 *
 * ─── İKİ YÖNTEM, DÖRT EYLEM: AYRIM `[userId]`DE ────────────────────────────
 *
 * PATCH `{ role: "owner" }` bir rol ataması DEĞİL, SAHİPLİK DEVRİDİR ve
 * `transferOwnership`a gider. Sebebi saf matris: `canAssignRole` `nextRole ===
 * "owner"` olan her çağrıyı reddeder, çünkü "takım başına tek sahip" kuralını
 * tutan şey kısmi tekil indekstir ve iki satırın tek işlemde takas edilmesi
 * gerekir. Tasarım §6.1 ayrı bir devir ucu tanımlamadığı için ayrım BURADA,
 * istenen role bakılarak yapılır.
 *
 * DELETE `[userId]` ÇAĞIRANIN KENDİSİYSE "ayrıl" (`leaveTeam`), değilse "çıkar"
 * (`removeMember`). İkisi ayrı servis çağrısıdır çünkü ayrı kuralları var:
 * sahip ayrılamaz (önce devretmeli), ve bir üye kendini "çıkaramaz" — denetim
 * izinde `member_left` ile `member_removed` AYRI eylemlerdir ve hangisinin
 * olduğu sonradan sorulabilir olmalı.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { TEAM_ROLES } from "@/lib/config/quote-team";
import { getSessionUser } from "@/lib/services/customer-auth";
import {
  sendTeamMemberRemovedEmail,
  sendTeamOwnershipTransferredEmail,
  sendTeamRoleChangedEmail,
} from "@/lib/services/customer-team-notify";
import {
  changeRole,
  leaveTeam,
  removeMember,
  transferOwnership,
} from "@/lib/services/customer-team";
import { teamsEnabled } from "@/lib/services/quote-access";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import {
  TEAM_NOT_FOUND,
  teamRouteBody,
  teamJsonBody,
  teamTooManyRequests,
  teamUnauthorized,
} from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ userId: string }> };

const roleSchema = z.object({
  role: z.enum(TEAM_ROLES, { message: "Geçerli bir rol seçin" }),
});

async function handlePATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`team-member:${ip}`, 30, 60 * 60 * 1000)).success) {
    return teamTooManyRequests();
  }

  const { userId } = await ctx.params;
  const data = roleSchema.parse(await teamJsonBody(request));

  if (data.role === "owner") {
    const result = await transferOwnership({
      actorUserId: session.userId,
      targetUserId: userId,
    });
    // İŞLEM BİLDİRİMİ (ticari ileti DEĞİL). `.catch()`: posta arızası devri
    // geri almaz — sahiplik DEĞİŞTİ ve ekran onu zaten gösterecek.
    await sendTeamOwnershipTransferredEmail({
      email: result.email,
      teamName: result.teamName,
    }).catch((e) => console.error("team ownership email failed (non-fatal)", e));
    return NextResponse.json({ success: true, role: "owner", transferred: true });
  }

  const result = await changeRole({
    actorUserId: session.userId,
    targetUserId: userId,
    nextRole: data.role,
  });
  await sendTeamRoleChangedEmail({
    email: result.email,
    teamName: result.teamName,
    previousRole: result.previousRole,
    role: result.role,
  }).catch((e) => console.error("team role email failed (non-fatal)", e));
  return NextResponse.json({ success: true, role: result.role, transferred: false });
}

async function handleDELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`team-member:${ip}`, 30, 60 * 60 * 1000)).success) {
    return teamTooManyRequests();
  }

  const { userId } = await ctx.params;
  if (userId === session.userId) {
    // AYRILMA: kendi kararı olduğu için bildirim e-postası GÖNDERİLMEZ.
    await leaveTeam({ actorUserId: session.userId });
    return NextResponse.json({ success: true, left: true });
  }
  const result = await removeMember({ actorUserId: session.userId, targetUserId: userId });
  await sendTeamMemberRemovedEmail({
    email: result.email,
    teamName: result.teamName,
  }).catch((e) => console.error("team removal email failed (non-fatal)", e));
  return NextResponse.json({ success: true, left: false });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    return await teamRouteBody(() => handlePATCH(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "PATCH /api/customer/team/members/[userId]",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    return await teamRouteBody(() => handleDELETE(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "DELETE /api/customer/team/members/[userId]",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}
