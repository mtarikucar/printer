import Link from "next/link";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { PaymentSuccessClient } from "./client";

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  const locale = await getLocale();
  const d = getDictionary(locale);

  return (
    <main className="min-h-screen bg-bg-base relative overflow-hidden">
      <SiteHeader />

      <PaymentSuccessClient />

      <div className="flex items-center justify-center px-4 py-16 sm:py-24 relative z-10">
        <div className="max-w-md mx-auto text-center animate-fade-in-up">
          <div className="w-20 h-20 bg-beige-400 rounded-full flex items-center justify-center mx-auto shadow-lg animate-bounce-in">
            <svg className="w-10 h-10 text-bg-base" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-6 text-3xl font-serif text-text-primary animate-fade-in-up delay-100">
            {d["payment.success.title"]}
          </h1>
          <p className="mt-3 text-text-secondary animate-fade-in-up delay-200">
            {d["payment.success.message"]}
          </p>
          <p className="mt-2 text-sm text-green-500 font-medium animate-fade-in-up delay-200">
            {d["payment.success.inProgress"]}
          </p>
          {order && (
            <div className="mt-6 animate-fade-in-up delay-300">
              <p className="text-sm text-text-muted">{d["payment.success.orderNumber"]}</p>
              <p className="mt-1 bg-bg-elevated inline-block font-mono font-bold text-text-primary px-4 py-1.5 rounded-lg text-lg border border-bg-subtle">
                {order}
              </p>
            </div>
          )}
          <div className="mt-8 space-y-3 animate-fade-in-up delay-400">
            {order && (
              <Link
                href={`/track/${order}`}
                className="btn-primary w-full !block text-center"
              >
                {d["payment.success.track"]}
              </Link>
            )}
            <Link
              href="/"
              className="btn-secondary w-full !block text-center"
            >
              {d["common.backHome"]}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
