export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, and, count, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painters, painterEarnings } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

// Turkish labels for the per-order painting sub-lifecycle
// (painterOrderStatusEnum). Hardcoded — the painter realm carries no i18n keys.
const PAINTER_STATUS_LABELS: Record<string, string> = {
  unassigned: "Atanmadı",
  assigned: "Atandı",
  accepted: "Kabul edildi",
  painting: "Boyanıyor",
  painted: "Boyandı",
  shipped: "Kargolandı",
};

// Status banner copy for non-active accounts. Keyed by painterStatusEnum.
const ACCOUNT_BANNERS: Record<
  string,
  { title: string; desc: string; tone: "amber" | "red" }
> = {
  pending_approval: {
    title: "Başvurunuz inceleniyor",
    desc: "Hesabınız onaylandığında boyama işleri bu panelde görünmeye başlayacak.",
    tone: "amber",
  },
  conditionally_approved: {
    title: "Ek doğrulama gerekiyor",
    desc: "Örnek çalışma fotoğrafınız onaylandığında hesabınız tam olarak aktifleşecek.",
    tone: "amber",
  },
  suspended: {
    title: "Hesabınız askıya alındı",
    desc: "Yeni boyama işleri alamazsınız. Lütfen yönetici ile iletişime geçin.",
    tone: "red",
  },
  rejected: {
    title: "Başvurunuz reddedildi",
    desc: "Boyacı başvurunuz onaylanmadı. Detay için yönetici ile iletişime geçebilirsiniz.",
    tone: "red",
  },
};

export default async function PainterDashboardPage() {
  const session = await getPainterSession();
  if (!session) redirect("/painter/login");

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
  });
  if (!painter) redirect("/painter/login");

  const locale = (await getLocale()) as Locale;

  // Not yet active: show a terminal status banner instead of job data. This is
  // also where the jobs guards land non-active painters, so it must not bounce.
  if (painter.status !== "active") {
    const banner = ACCOUNT_BANNERS[painter.status] ?? {
      title: "Hesabınız aktif değil",
      desc: "Boyama işlerini görebilmek için hesabınızın aktif olması gerekir.",
      tone: "amber" as const,
    };
    const toneClasses =
      banner.tone === "red"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-amber-200 bg-amber-50 text-amber-900";
    return (
      <div className="p-4 sm:p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">Boyacı Paneli</h1>
        <div className={`mt-6 rounded-xl border p-6 ${toneClasses}`}>
          <p className="font-medium">{banner.title}</p>
          <p className="mt-1 text-sm opacity-90">{banner.desc}</p>
          {painter.rejectionReason && (
            <p className="mt-3 text-sm opacity-90">
              <span className="font-medium">Not:</span> {painter.rejectionReason}
            </p>
          )}
        </div>
      </div>
    );
  }

  const pid = session.painterId;
  const [[assigned], [accepted], [painting], [pending], recent] =
    await Promise.all([
      db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.painterId, pid), eq(orders.painterStatus, "assigned"))),
      db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.painterId, pid), eq(orders.painterStatus, "accepted"))),
      db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.painterId, pid), eq(orders.painterStatus, "painting"))),
      db
        .select({
          s: sql<number>`coalesce(sum(${painterEarnings.netKurus}), 0)::int`,
        })
        .from(painterEarnings)
        .where(
          and(
            eq(painterEarnings.painterId, pid),
            eq(painterEarnings.status, "pending")
          )
        ),
      db.query.orders.findMany({
        where: and(eq(orders.painterId, pid), eq(orders.needsPainting, true)),
        orderBy: [desc(orders.assignedToPainterAt)],
        limit: 5,
        columns: {
          id: true,
          orderNumber: true,
          customerName: true,
          painterStatus: true,
          assignedToPainterAt: true,
        },
      }),
    ]);

  const pendingEarnings = pending?.s ?? 0;
  const inProgress = (assigned?.c ?? 0) + (accepted?.c ?? 0) + (painting?.c ?? 0);

  const stats: Array<{ label: string; value: string | number }> = [
    { label: "Atanan işler", value: assigned?.c ?? 0 },
    { label: "Kabul edilen", value: accepted?.c ?? 0 },
    { label: "Boyanıyor", value: painting?.c ?? 0 },
    { label: "Bekleyen kazanç", value: formatCurrency(pendingEarnings, locale) },
  ];

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900">Boyacı Paneli</h1>

      {/* Account status banner */}
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-900">
          Hesabınız aktif
        </p>
        <p className="mt-0.5 text-sm text-emerald-800">
          {painter.acceptingOrders
            ? "Yeni boyama işlerini kabul edebilirsiniz."
            : "Şu anda yeni iş kabul etmiyorsunuz."}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-gray-200 bg-white p-4"
          >
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {s.label}
            </p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Devam eden / Maks kapasite
        </p>
        <p className="mt-1 text-2xl font-bold text-gray-900">
          {inProgress} / {painter.maxConcurrentOrders}
        </p>
      </div>

      <div className="mt-8 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="font-semibold text-gray-900">Son işler</h2>
          <Link
            href="/painter/jobs"
            className="text-sm text-indigo-600 hover:underline"
          >
            İşler
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            Henüz iş yok.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map((o) => (
              <li key={o.id}>
                <Link
                  href="/painter/jobs"
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50"
                >
                  <span className="font-mono text-sm text-indigo-600">
                    {o.orderNumber}
                  </span>
                  <span className="text-sm text-gray-600">
                    {o.customerName}
                  </span>
                  <span className="text-xs text-gray-500">
                    {o.painterStatus
                      ? PAINTER_STATUS_LABELS[o.painterStatus] ?? o.painterStatus
                      : "—"}
                  </span>
                  <span className="text-xs text-gray-400">
                    {o.assignedToPainterAt
                      ? formatDate(o.assignedToPainterAt, locale)
                      : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
