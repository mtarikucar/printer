import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { NotificationBell } from "@/components/notification-bell";
import { SiteHeader } from "@/components/site-header";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { getSessionUser } from "@/lib/services/customer-auth";
import { quoteApiEnabled } from "@/lib/services/quote-access";
import { AccountPartsClient } from "./parts-client";

/**
 * `/account/parcalar` — "Parça kütüphanem".
 *
 * Kapısı `/account/teklifler` ile aynıdır (bayrak → oturum → sayfa). Aynı
 * dosyayı ikinci kez yüklemek yerine buradan yeni bir teklife taşımak, hem
 * müşterinin zamanını hem de analiz işçiliğini geri kazandırır.
 */
export const dynamic = "force-dynamic";

export default async function AccountPartsPage() {
  if (!(await quoteApiEnabled())) notFound();

  const session = await getSessionUser();
  if (!session) redirect("/login?redirect=/account/parcalar");

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
              {d["instantQuote.account.parts.title"]}
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              {d["instantQuote.account.parts.subtitle"]}
            </p>
          </div>
          <NotificationBell />
        </div>

        <div className="mt-8">
          <AccountPartsClient />
        </div>
      </div>
    </main>
  );
}
