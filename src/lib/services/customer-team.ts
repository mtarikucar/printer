/**
 * Takım çalışma alanının DB kabuğu (0072) — bu sevkiyatta YALNIZ OKUMA yarısı.
 *
 * Yazma yarısı (davet, kabul, rol değişimi, üye çıkarma, denetim satırı) T-3'ün
 * işidir. Bugün tek bir soru cevaplanıyor: *bu kullanıcı BU TEKLİFİN takımının
 * neyi?* Cevabı erişim kabuğu (`quote-access.ts` · `resolveQuoteTeam`) sorar ve
 * `QuoteViewer`ın takım dalını o cevap açar.
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
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerTeamMembers, customerTeams } from "@/lib/db/schema";
import type { QuoteAccessTeam } from "@/lib/config/quote-types";

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
