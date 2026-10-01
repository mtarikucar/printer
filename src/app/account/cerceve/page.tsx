import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { NotificationBell } from "@/components/notification-bell";
import { SiteHeader } from "@/components/site-header";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { getSessionUser } from "@/lib/services/customer-auth";
import { frameworkSurfacesEnabled } from "@/lib/services/quote-access";
import { AccountFrameworksClient } from "./frameworks-client";

/**
 * `/account/cerceve` — "Çerçeve anlaşmalarım".
 *
 * `/account/teklifler` deseninin birebir kardeşi: kapı SUNUCUDA (bayrak →
 * `notFound`, oturum → `/login?redirect=`), liste istemciden uca gider.
 * İstemci tarafı bir kontrol, sayfanın bir an açılıp sonra atmasına yol açardı.
 *
 * Bayrak kapalıyken (admin dışında) 404: aksi hâlde sayfa açılır ve liste 404
 * ile boş kalır — "anlaşmanız yok" diye okunacak bir yanlış.
 *
 * `noindex` `account/layout.tsx`'ten gelir; robots zaten `/account`'u kapatır.
 */
export const dynamic = "force-dynamic";

export default async function AccountFrameworksPage() {
  if (!(await frameworkSurfacesEnabled())) notFound();

  const session = await getSessionUser();
  if (!session) redirect("/login?redirect=/account/cerceve");

  const d = getDictionary(await getLocale());

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
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
              {d["instantQuote.framework.account.title"]}
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              {d["instantQuote.framework.account.subtitle"]}
            </p>
          </div>
          <NotificationBell />
        </div>

        <div className="mt-8">
          <AccountFrameworksClient />
        </div>
      </div>
    </main>
  );
}
