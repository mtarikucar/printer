import Link from "next/link";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  const locale = await getLocale();
  const d = getDictionary(locale);

  return (
    <main className="min-h-screen bg-surface-50 relative overflow-hidden">
      <SiteHeader showAuth={false} />

      {/* CSS Confetti */}
      <div className="fixed inset-0 pointer-events-none z-50" aria-hidden="true">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-sm"
            style={{
              left: `${Math.random() * 100}%`,
              backgroundColor: ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6'][i % 6],
              animation: `confetti-fall ${2 + Math.random() * 3}s ${Math.random() * 2}s ease-in both`,
            }}
          />
        ))}
      </div>

      <div className="flex items-center justify-center px-4 py-16 sm:py-24 relative z-10">
        <div className="max-w-md mx-auto text-center animate-fade-in-up">
          <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-lg animate-bounce-in">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-6 text-3xl font-bold text-gray-900 animate-fade-in-up delay-100">
            {d["payment.success.title"]}
          </h1>
          <p className="mt-3 text-gray-600 animate-fade-in-up delay-200">
            {d["payment.success.message"]}
          </p>
          <p className="mt-2 text-sm text-primary-600 font-medium animate-fade-in-up delay-200">
            {d["payment.success.inProgress"]}
          </p>
          {order && (
            <div className="mt-6 animate-fade-in-up delay-300">
              <p className="text-sm text-gray-500">{d["payment.success.orderNumber"]}</p>
              <p className="mt-1 bg-surface-100 inline-block font-mono font-bold text-gray-900 px-4 py-1.5 rounded-lg text-lg">
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
