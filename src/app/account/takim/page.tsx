import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { canInvite } from "@/lib/config/quote-team";
import { getSessionUser } from "@/lib/services/customer-auth";
import { listInvites, listMembers, loadMembership } from "@/lib/services/customer-team";
import { teamsEnabled } from "@/lib/services/quote-access";
import { TeamClient, type TeamInviteView, type TeamMemberView } from "./team-client";

/**
 * `/account/takim` — "Takımım".
 *
 * KAPI `account/teklifler/page.tsx` ile BİREBİR aynı desendir, tek farkla:
 * bayrak `teamsEnabled()`tir, `quoteApiEnabled()` DEĞİL. Özellik KENDİ
 * bayrağını taşıyor (`quote_teams_enabled`), yani teklif motoru açık olsa bile
 * takım kapalıyken bu sayfa müşteriye YOK gibi davranır (404, 403 DEĞİL:
 * kapalı bir özelliğin varlığını duyurmanın anlamı yok). Admin oturumu iç test
 * için kapıdan geçer.
 *
 * Oturumsuz ziyaretçi `?redirect=` ile girişe gider — `?next=` DEĞİL, giriş
 * sayfasının okuduğu ad odur.
 *
 * ─── ROL SUNUCUDAN GELİR ──────────────────────────────────────────────────
 *
 * Üyelik, üyeler ve bekleyen davetler BURADA okunup istemciye prop olarak
 * verilir. İstemcinin rolü kendi türetmesi ("takım sahibi miyim") bir güvenlik
 * sınırı DEĞİL bir kolaylık olurdu; sınır uçlardadır (T-3). Bu okuma ayrıca
 * ekranın ilk karesini doğru çizer: rolü uçtan bekleyen bir ekran, bir an için
 * "yetkisiz" hâlini gösterirdi.
 *
 * Bekleyen davetler YALNIZ onlarla bir şey yapabilen role okunur
 * (`canInvite`): davet edilmiş kişilerin adresleri, iptal yetkisi olmayan bir
 * üyenin işine yaramaz ve gereksiz bir yayılımdır (ucun aynı kuralı).
 *
 * `noindex` `account/layout.tsx`'ten gelir; `/account` hem `NOINDEX_PREFIXES`
 * hem robots tarafında kapalı. `/takim` öneki de aynı sevkiyatta kapatıldı —
 * davet KARŞILAMA sayfası (`/takim/davet/<token>`) bu önekin altında.
 */
export const dynamic = "force-dynamic";

export default async function AccountTeamPage() {
  if (!(await teamsEnabled(null))) notFound();

  const session = await getSessionUser();
  if (!session) redirect("/login?redirect=/account/takim");

  const d = getDictionary(await getLocale());
  const membership = await loadMembership(session.userId);

  // Takımı olmayan müşteri bir hata değil: ekran "takım kur" diyecek.
  let members: TeamMemberView[] = [];
  let invites: TeamInviteView[] = [];
  if (membership) {
    const [memberRows, inviteRows] = await Promise.all([
      listMembers(membership.teamId),
      canInvite(membership.role) ? listInvites(membership.teamId) : Promise.resolve([]),
    ]);
    // Tarihler dizeye çevrilir: istemci onları yalnız BİÇİMLENDİRİR ve
    // `Date` nesnesi sunucu/istemci sınırında bir tuzak (yerel saat dilimi).
    members = memberRows.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    }));
    invites = inviteRows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
    }));
  }

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="mx-auto max-w-4xl px-4 py-12">
        <Link
          href="/account"
          className="text-xs text-text-muted underline-offset-4 hover:underline"
        >
          ← {d["account.title"]}
        </Link>
        <h1
          className="mt-2 text-3xl text-text-primary"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {d["instantQuote.team.title"]}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">{d["instantQuote.team.subtitle"]}</p>

        <div className="mt-8">
          <TeamClient
            team={
              membership
                ? {
                    // KVKK damgası ve `ownerUserId` BİLEREK dışarıda: onay
                    // kaydı denetim verisidir, sahibin kim olduğu ise üye
                    // listesindeki `owner` rolünden okunur (ucun aynı kararı).
                    id: membership.team.id,
                    name: membership.team.name,
                    invoiceType: membership.team.invoiceType,
                    companyName: membership.team.companyName,
                    taxId: membership.team.taxId,
                    taxIdType: membership.team.taxIdType,
                    taxOffice: membership.team.taxOffice,
                    billingAddress: membership.team.billingAddress,
                    shippingAddress: membership.team.shippingAddress,
                    memberCanCheckout: membership.team.memberCanCheckout,
                  }
                : null
            }
            role={membership?.role ?? null}
            members={members}
            invites={invites}
            sessionUserId={session.userId}
          />
        </div>
      </div>
    </main>
  );
}
