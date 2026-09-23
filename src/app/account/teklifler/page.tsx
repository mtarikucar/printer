import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { NotificationBell } from "@/components/notification-bell";
import { SiteHeader } from "@/components/site-header";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { getSessionUser } from "@/lib/services/customer-auth";
import { quoteApiEnabled } from "@/lib/services/quote-access";
import { AccountQuotesClient } from "./quotes-client";

/**
 * `/account/teklifler` — "Tekliflerim".
 *
 * Kapı SUNUCUDA: oturum yoksa doğrudan girişe yönlendirilir ve dönüşte bu
 * sayfaya gelinir (`?redirect=`, giriş sayfasının okuduğu ad). İstemci tarafı
 * bir kontrol, sayfanın bir an açılıp sonra atmasına yol açardı.
 *
 * `noindex` `account/layout.tsx`'ten gelir; robots zaten `/account`'u kapatır.
 */
export const dynamic = "force-dynamic";

export default async function AccountQuotesPage() {
  // Bayrak kapalıyken (admin dışında) teklif yüzeyleri YOK gibi davranır —
  // uçlarla aynı kapı, aksi hâlde sayfa açılır ve liste 404 ile boş kalırdı.
  if (!(await quoteApiEnabled())) notFound();

  const session = await getSessionUser();
  if (!session) redirect("/login?redirect=/account/teklifler");

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
              {d["instantQuote.account.quotes.title"]}
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              {d["instantQuote.account.quotes.subtitle"]}
            </p>
          </div>
          <NotificationBell />
        </div>

        <div className="mt-8">
          <AccountQuotesClient />
        </div>
      </div>
    </main>
  );
}
