import { notFound } from "next/navigation";
import Link from "next/link";
import { NotificationBell } from "@/components/notification-bell";
import { SiteHeader } from "@/components/site-header";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { RealtimeProvider } from "@/lib/realtime/provider";
import { frameworkSurfacesEnabled, resolveFrameworkAccess } from "@/lib/services/quote-access";
import { loadFrameworkDetail } from "@/lib/services/quote-framework";
import { presentFramework } from "@/lib/services/quote-framework-present";
import { getPublicUrl } from "@/lib/services/storage";
import { FrameworkClient } from "./client";

/**
 * `/cerceve/[number]` — müşterinin çerçeve anlaşma ekranı.
 *
 * BAYRAK KAPALIYKEN 404 (`notFound`), 403 DEĞİL: kapalı bir özelliğin varlığını
 * duyurmanın anlamı yok. Ölçü `frameworkSurfacesEnabled`dir — bu bir MÜŞTERİ
 * sayfası, yani admin oturumunu geçiren kapı burada gerçekten bir şey açıyor
 * (lansman öncesi iç test); admin'den başkasının giremediği `/admin/cerceve`
 * yalnız bayrağa bakar (`frameworkScreensEnabled`, gerekçe orada).
 *
 * ERİŞİM `resolveFrameworkAccess`tedir: `user_id` = oturum sahibi ya da admin.
 * Anonim çerez dalı ve paylaşım jetonu YOK — taahhüt kurumsal ve kişiye özel.
 * Erişimi olmayan izleyici 404 alır, 403 değil.
 *
 * `noindex` kök düzenden gelir (`isNoindexPath("/cerceve")`) ve `robots.ts`
 * `/cerceve/` yolunu taramaya da kapatır: ikisi AYRI iş yapıyor, biri ötekinin
 * yerine geçmez.
 *
 * CANLI: sayfa MÜŞTERİ akışına abone olur (`/api/realtime/customer`).
 * `emitFrameworkChanged` olayı `topics.customer(userId)`ye de düşüyor, yani
 * parti serbest bırakıldığında açık ekran kendini tazeler. Ayrı bir çerçeve SSE
 * ucu AÇILMADI: ikinci bir akış, ikinci bir erişim matrisi demekti.
 */
export const dynamic = "force-dynamic";

export default async function CustomerFrameworkPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  if (!(await frameworkSurfacesEnabled())) notFound();

  const { number } = await params;
  const access = await resolveFrameworkAccess(number);
  if (!access) notFound();

  // Anlaşmanın KENDİSİ sayfanın çekirdek verisidir: okunamazsa gösterilecek bir
  // şey de yoktur, bu yüzden bu okuma korumasızdır (ev kuralı, `CORE_READS`).
  const detail = await loadFrameworkDetail(access.frameworkId);
  if (!detail) notFound();

  const framework = presentFramework({
    detail,
    viewer: access.viewer,
    now: new Date(),
    sign: getPublicUrl,
  });
  const d = getDictionary(await getLocale());

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="flex items-start justify-between gap-4">
          <Link
            href="/account/cerceve"
            className="text-xs text-text-muted underline-offset-4 hover:underline"
          >
            ← {d["instantQuote.framework.account.title"]}
          </Link>
          <NotificationBell />
        </div>
        <div className="mt-6">
          <RealtimeProvider url="/api/realtime/customer">
            <FrameworkClient initial={framework} />
          </RealtimeProvider>
        </div>
      </div>
    </main>
  );
}
