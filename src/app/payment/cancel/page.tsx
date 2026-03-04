import Link from "next/link";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";

export default async function PaymentCancelPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <div className="flex items-center justify-center px-4 py-16 sm:py-24">
        <div className="max-w-md mx-auto text-center animate-fade-in-up">
          <div className="w-20 h-20 bg-beige-600 rounded-full flex items-center justify-center mx-auto shadow-lg animate-bounce-in">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="mt-6 text-3xl font-serif text-text-primary animate-fade-in-up delay-100">
            {d["payment.cancel.title"]}
          </h1>
          <p className="mt-3 text-text-secondary animate-fade-in-up delay-200">
            {d["payment.cancel.message"]}
          </p>
          <p className="mt-2 text-sm text-text-muted font-medium animate-fade-in-up delay-200">
            {d["payment.cancel.noCharge"]}
          </p>
          <div className="mt-8 space-y-3 animate-fade-in-up delay-300">
            <Link
              href="/create"
              className="btn-primary w-full !block text-center"
            >
              {d["payment.cancel.retry"]}
            </Link>
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
