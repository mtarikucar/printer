export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { painters, painterEarnings, painterPayouts } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import { PainterPayoutRequestButton } from "./payout-request-button";

// Boyacının kazanç + ödeme geçmişi — üreticinin /manufacturer/earnings
// sayfasının karşılığı. Boyacı paneli önceden yalnızca tek bir "Bekleyen
// kazanç" rakamı gösteriyordu: hangi işin ne kazandırdığını, neyin ödemeye
// girdiğini, neyin ödendiğini göremiyordu. Rakamlar hakediş satırlarının
// KENDİSİDİR (tahakkukta computeEarning ile yazılmış); burada komisyon
// yeniden hesaplanmaz. Boyacı paneli i18n anahtarı taşımaz (Türkçe sabit).

const EARNING_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Bekliyor", cls: "bg-amber-100 text-amber-700" },
  in_payout: { label: "Ödeme sürecinde", cls: "bg-indigo-100 text-indigo-700" },
  paid: { label: "Ödendi", cls: "bg-emerald-100 text-emerald-700" },
  reversed: { label: "Geri alındı", cls: "bg-gray-100 text-gray-500" },
};

function maskIban(iban: string): string {
  const compact = iban.replace(/\s+/g, "");
  return compact.length <= 8 ? compact : `${compact.slice(0, 4)} •••• •••• ${compact.slice(-4)}`;
}

export default async function PainterEarningsPage() {
  const session = await getPainterSession();
  if (!session) redirect("/painter/login");

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
    columns: {
      status: true,
      iban: true,
      bankAccountHolder: true,
      bankName: true,
      ibanReviewStatus: true,
    },
  });
  // Aktif olmayan boyacı, hesap durumunu anlatan panele düşer (işler sayfası gibi).
  if (!painter || painter.status !== "active") redirect("/painter/dashboard");

  const locale = (await getLocale()) as Locale;
  const pid = session.painterId;

  const [[totals], earnings, payoutRows] = await Promise.all([
    // Toplamlar SQL'de: aşağıdaki liste son 200 satırla sınırlı, toplam değil.
    db
      .select({
        owed: sql<number>`coalesce(sum(${painterEarnings.netKurus}) filter (where ${painterEarnings.status} = 'pending' and ${painterEarnings.payoutId} is null), 0)::int`,
        inPayout: sql<number>`coalesce(sum(${painterEarnings.netKurus}) filter (where ${painterEarnings.status} = 'pending' and ${painterEarnings.payoutId} is not null), 0)::int`,
        paid: sql<number>`coalesce(sum(${painterEarnings.netKurus}) filter (where ${painterEarnings.status} = 'paid'), 0)::int`,
      })
      .from(painterEarnings)
      .where(eq(painterEarnings.painterId, pid)),
    db.query.painterEarnings.findMany({
      where: eq(painterEarnings.painterId, pid),
      with: { order: { columns: { orderNumber: true } } },
      orderBy: [desc(painterEarnings.createdAt)],
      limit: 200,
    }),
    db.query.painterPayouts.findMany({
      where: eq(painterPayouts.painterId, pid),
      with: {
        earnings: {
          columns: { id: true, netKurus: true, status: true },
          with: { order: { columns: { orderNumber: true } } },
        },
      },
      orderBy: [desc(painterPayouts.createdAt)],
      limit: 50,
    }),
  ]);

  const owed = Number(totals?.owed ?? 0);
  const inPayout = Number(totals?.inPayout ?? 0);
  const paidTotal = Number(totals?.paid ?? 0);

  const badgeFor = (e: { status: string; payoutId: string | null }) =>
    EARNING_BADGE[e.status === "pending" && e.payoutId ? "in_payout" : e.status] ??
    EARNING_BADGE.pending;

  const cards: Array<{ label: string; value: number; cls: string; hint: string }> = [
    {
      label: "Talep edilebilir",
      value: owed,
      cls: "border-amber-200 bg-amber-50 text-amber-900",
      hint: "Tahakkuk etmiş, henüz bir ödemeye girmemiş",
    },
    {
      label: "Ödeme sürecinde",
      value: inPayout,
      cls: "border-indigo-200 bg-indigo-50 text-indigo-900",
      hint: "Ödemeye eklendi, transfer bekleniyor",
    },
    {
      label: "Ödenen toplam",
      value: paidTotal,
      cls: "border-emerald-200 bg-emerald-50 text-emerald-900",
      hint: "Banka hesabınıza gönderilen",
    },
  ];

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900">Kazançlar ve ödemeler</h1>
      <p className="mt-1 text-sm text-gray-500">
        Her boyama işinin kazancı, işi kargoladığınızda tahakkuk eder. Tutarlar platform hizmet
        bedeli düşülmüş net tutarlardır.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-2xl border p-5 ${c.cls}`}>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{c.label}</p>
            <p className="mt-1 text-3xl font-bold">{formatCurrency(c.value, locale)}</p>
            <p className="mt-1 text-xs opacity-70">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="text-sm text-gray-700">
            <p className="text-xs uppercase tracking-wide text-gray-500">Ödeme hesabı</p>
            {painter.iban ? (
              <p className="mt-1">
                <span className="font-mono">{maskIban(painter.iban)}</span>
                {painter.bankAccountHolder ? ` · ${painter.bankAccountHolder}` : ""}
                {painter.bankName ? ` · ${painter.bankName}` : ""}
              </p>
            ) : (
              <p className="mt-1 text-amber-800">Kayıtlı IBAN yok.</p>
            )}
            {painter.ibanReviewStatus === "pending" && (
              <p className="mt-1 text-xs text-amber-800">
                IBAN değişikliğiniz onay bekliyor; onaylanana kadar ödemeler kayıtlı IBAN&apos;a
                gönderilir.
              </p>
            )}
            <Link href="/painter/profile" className="mt-1 inline-block text-xs text-indigo-600 hover:underline">
              Profilde düzenle
            </Link>
          </div>
          <PainterPayoutRequestButton owedKurus={owed} hasIban={!!painter.iban} />
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
        İş bazında kazanç
      </h2>
      {earnings.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          Henüz tahakkuk etmiş bir kazanç yok.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Sipariş</th>
                <th className="px-4 py-2.5 text-left font-medium">Tarih</th>
                <th className="px-4 py-2.5 text-right font-medium">Boyama payı</th>
                <th className="px-4 py-2.5 text-right font-medium">Hizmet bedeli</th>
                <th className="px-4 py-2.5 text-right font-medium">Net</th>
                <th className="px-4 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {earnings.map((e) => {
                const badge = badgeFor(e);
                return (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 font-mono text-gray-700">{e.order?.orderNumber ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-500">{formatDate(e.createdAt, locale)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{formatCurrency(e.grossKurus, locale)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      −{formatCurrency(e.commissionKurus, locale)}
                      <span className="block text-[11px] text-gray-400">%{e.commissionRateBps / 100}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                      {formatCurrency(e.netKurus, locale)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
        Ödeme geçmişi
      </h2>
      {payoutRows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          Henüz ödeme yok.
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {payoutRows.map((p) => (
            <details key={p.id} className="px-4 py-3 text-sm">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                <span className="text-gray-700">
                  {formatDate(p.createdAt, locale)} · {p.earningCount} iş
                  {p.adminEmail === "painter-request" ? " · sizin talebiniz" : ""}
                  {p.reference ? ` · Ref: ${p.reference}` : ""}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900">{formatCurrency(p.totalKurus, locale)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"
                    }`}
                  >
                    {p.status === "paid"
                      ? `Ödendi${p.paidAt ? ` · ${formatDate(p.paidAt, locale)}` : ""}`
                      : "Transfer bekleniyor"}
                  </span>
                </span>
              </summary>
              {p.earnings.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-gray-600">
                  {p.earnings.map((e) => (
                    <li key={e.id} className="flex justify-between gap-3">
                      <span className="font-mono">{e.order?.orderNumber ?? "—"}</span>
                      <span>{formatCurrency(e.netKurus, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
