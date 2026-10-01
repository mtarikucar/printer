/**
 * `/api/customer/team/invites/accept` — daveti KABUL et (0072).
 *
 * YÖNTEM KÜMESİ SÖZLEŞMEDİR (tasarım §6.1): yalnız **POST** `{ token }`.
 *
 * Yol `invites/[id]`in KARDEŞİ ama çakışmaz: App Router'da durağan parça
 * dinamik parçayı yener, yani `/invites/accept` daima bu dosyaya düşer.
 *
 * ─── KABUL, DAVET EDİLEN E-POSTAYLA GİRİŞ YAPMAYI ŞART KOŞAR ───────────────
 *
 * Token'ı ele geçiren BAŞKA bir hesap kabul EDEMEZ. Karar saf yüklemde
 * (`inviteAcceptable`, `quote-team.ts`) ve karşılaştırmanın iki tarafı da
 * `normalizeTeamEmail`den geçer. Bu ucun tek işi oturumu ve gövdeyi o yükleme
 * taşımaktır — kapıyı burada İKİNCİ bir kez yazmak, iki kuralın ayrışması
 * demekti.
 *
 * Ham token GÖVDEDE gelir, URL'de değil: adres çubuğu tarayıcı geçmişine,
 * günlüklere ve `Referer` başlığına yazılır.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { getSessionUser } from "@/lib/services/customer-auth";
import { acceptInvite } from "@/lib/services/customer-team";
import { teamsEnabled } from "@/lib/services/quote-access";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import {
  TEAM_NOT_FOUND,
  kvkkConsentField,
  teamRouteBody,
  teamJsonBody,
  teamTooManyRequests,
  teamUnauthorized,
} from "../../_shared";

export const dynamic = "force-dynamic";

const acceptSchema = z.object({
  token: z.string().trim().min(16, "Davet bağlantısı geçersiz").max(200),
  /**
   * KVKK onayı (tasarım §8, KVKK 2): kabul eden kişi, takıma bağlı
   * tekliflerdeki dosyaların ve fiyatların diğer üyelerle karşılıklı görünür
   * olacağını onaylar. Damgası `customer_team_members.kvkk_acknowledged_at`.
   */
  kvkkConsent: kvkkConsentField,
});

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);
  // Oran limiti gövde AYRIŞTIRILMADAN ÖNCE. Bu uçta limit aynı zamanda token
  // DENEME saldırısına karşıdır: sha256 uzayı taranamaz, ama denemeyi ucuz
  // bırakmanın da sebebi yok.
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`team-invite-accept:${ip}`, 10, 60 * 60 * 1000)).success) {
    return teamTooManyRequests();
  }

  const data = acceptSchema.parse(await teamJsonBody(request));
  const joined = await acceptInvite({
    rawToken: data.token,
    userId: session.userId,
    email: session.email,
  });
  return NextResponse.json({
    team: { id: joined.teamId, name: joined.teamName },
    role: joined.role,
  });
}

export async function POST(request: NextRequest) {
  try {
    return await teamRouteBody(() => handlePOST(request));
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/customer/team/invites/accept",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}
