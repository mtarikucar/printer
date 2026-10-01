import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { getSessionUser } from "@/lib/services/customer-auth";
import { teamsEnabled } from "@/lib/services/quote-access";
import { InviteAcceptClient } from "./invite-client";

/**
 * `/takim/davet/<token>` — davet KARŞILAMA sayfası (0072).
 *
 * KAPI `account/takim/page.tsx` ile aynı: `teamsEnabled()` kapalıysa
 * `notFound()` (404, 403 DEĞİL — kapalı bir özelliğin varlığını duyurmanın
 * anlamı yok), oturumsuz ziyaretçi `?redirect=` ile girişe gider. `?next=`
 * DEĞİL: giriş sayfasının okuduğu ad `redirect`tir ve davet e-postasındaki
 * adres (`teamInvitePath`) ile bu sayfanın beklediği adres tek kaynaktan
 * geliyor.
 *
 * ─── BU SAYFA BİR SIR TAŞIYOR ─────────────────────────────────────────────
 *
 * Adresteki token TEK KULLANIMLIK bir davettir; şekli `/atolye/katil/<token>`
 * ile birebir aynıdır. `/takim` öneki bu yüzden AYNI sevkiyatta hem
 * `NOINDEX_PREFIXES`e hem `robots.ts` disallow listesine girdi — biri
 * taramayı, öteki indekslenmeyi keser ve ikisi de gerekir (başka bir yerde
 * keşfedilen bir URL, taranamasa da meta etiketi olmadan indekslenebilir).
 *
 * ─── SAYFA DAVETİ OKUMAZ ──────────────────────────────────────────────────
 *
 * Takımın adı burada GÖSTERİLMEZ, çünkü göstermek token'ı bir OKUMA ucuna
 * çevirirdi: eline token geçen herkes, kabul etmeden, hangi firmanın davet
 * ettiğini öğrenirdi. Ad ancak KABULDEN SONRA, kabul ucunun cevabından
 * gösterilir. Karşılama metni bu yüzden takım adı taşımaz.
 *
 * Ham token adresten alınır ve istemciye prop olarak geçer; KABUL çağrısında
 * GÖVDEYE yazılır (T-3 ucunun sözleşmesi: adres çubuğu tarayıcı geçmişine,
 * günlüklere ve `Referer` başlığına düşüyor).
 */
export const dynamic = "force-dynamic";

export default async function TeamInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!(await teamsEnabled(null))) notFound();

  const { token } = await params;
  const session = await getSessionUser();
  if (!session) {
    redirect(`/login?redirect=${encodeURIComponent(`/takim/davet/${token}`)}`);
  }

  const d = getDictionary(await getLocale());

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1
          className="text-3xl text-text-primary"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {d["instantQuote.team.invite.acceptTitle"]}
        </h1>
        <div className="mt-6">
          <InviteAcceptClient token={token} />
        </div>
      </div>
    </main>
  );
}
