export const dynamic = "force-dynamic";

import { readPartnerPayables } from "@/lib/services/partner-payables";
import { PartnerAdjustmentHistory } from "@/components/partner-adjustment-history";
import { PartnerPayoutHistory } from "@/components/partner-payout-history";
import { PayoutHistoryNavigation } from "@/components/payout-history-navigation";
import { readPayoutPage } from "@/lib/services/payout-list";
import { parsePayoutListQuery, type PayoutListQuery } from "@/lib/config/payout-list";

import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painters, painterEarnings } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import { PainterPayoutRequestButton } from "./payout-request-button";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";
import {
  refundedOpenEarningWhere,
  refundedInPayoutEarningWhere,
} from "@/lib/services/earning-claimable";

// Boyacının kazanç + ödeme geçmişi — üreticinin /manufacturer/earnings
// sayfasının karşılığı. Boyacı paneli önceden yalnızca tek bir "Bekleyen
// kazanç" rakamı gösteriyordu: hangi işin ne kazandırdığını, neyin ödemeye
// girdiğini, neyin ödendiğini göremiyordu. Rakamlar hakediş satırlarının
// KENDİSİDİR (tahakkukta computeEarning ile yazılmış); burada komisyon
// yeniden hesaplanmaz. Boyacı paneli i18n anahtarı taşımaz (Türkçe sabit).

/** Liste son N kaydı gösterir; TOPLAMLAR bu listeden değil SQL'den gelir. */
const EARNING_LIST_LIMIT = 200;

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

/**
 * GÖSTERİM amaçlı okuma: sonucu ekranda yalnızca GÖSTERİLİR, bir kapıyı açıp
 * kapatmaz, hiçbir para rakamını beslemez. Arıza YUTULMAZ — null döner ve null
 * "kayıt yok" DEĞİL "BİLİNMİYOR" demektir; bayrak, o verinin KENDİ yerinde
 * yazılır.
 *
 * NEDEN: ödeme geçmişi tablosu para rakamlarıyla AYNI Promise.all içinde
 * okunuyordu ve tek bir reddedilen okuma SAYFANIN TAMAMINI düşürüyordu. Boyacı,
 * geçmişe hiç BAĞLI OLMAYAN "talep edilebilir"/"ödenen toplam" tutarlarını, iade
 * uyarısını ve ödeme talebi düğmesini de göremiyordu — oysa o rakamlar ayrı bir
 * sorgudan gelir ve okunabiliyordu. Yalnız GÖSTERİLEN bir tablonun arızası
 * partnerin parasını ekrandan silemez.
 */
async function displayRead<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[boyacı kazançlar] ${label} okunamadı`, e);
    return null;
  }
}

export default async function PainterEarningsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  if (!painter) redirect("/painter/login");

  const historyScope = { audience: "partner" as const, kind: "painter" as const, partnerId: session.painterId };
  const rawHistory = await searchParams;
  let historyQuery: PayoutListQuery;
  try {
    if (rawHistory.partnerId !== undefined || rawHistory.kind !== undefined) throw new Error("Partner bilgisi oturumdan belirlenir; liste bağlantısı geçersiz.");
    const params = new URLSearchParams();
    for (const key of ["status", "limit", "cursor"]) {
      const value = rawHistory[key];
      if (Array.isArray(value)) value.forEach(item => params.append(key, item));
      else if (value !== undefined) params.set(key, value);
    }
    historyQuery = parsePayoutListQuery(params, historyScope);
  } catch {
    return <div role="alert" className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Ödeme geçmişi filtresi veya sayfa bağlantısı geçersiz. <a href="/painter/earnings" className="underline">Listeyi yeniden açın</a>.</div>;
  }
  const locale = (await getLocale()) as Locale;
  const pid = session.painterId;

  // Hak ediş + düzeltme bakiyesi partilemenin ortak okuyucusundan gelir.
  // Aşağıdaki SQL yalnız iade edilmiş eski hak edişleri ayrıca açıklar;
  // 200 satırlık gösterim listesi hiçbir toplamın kaynağı değildir.
  const [[totals], earnings, payoutPage, moneySummary] = await Promise.all([
    // Toplamlar SQL'de: aşağıdaki liste son 200 satırla sınırlı, toplam değil.
    db
      .select({
        refundedOpen: sql<number>`coalesce(sum(${painterEarnings.netKurus}) filter (where ${refundedOpenEarningWhere(painterEarnings)}), 0)::int`,
        refundedInPayout: sql<number>`coalesce(sum(${painterEarnings.netKurus}) filter (where ${refundedInPayoutEarningWhere(painterEarnings)}), 0)::int`,
      })
      .from(painterEarnings)
      .leftJoin(orders, eq(orders.id, painterEarnings.orderId))
      .where(eq(painterEarnings.painterId, pid)),
    db.query.painterEarnings.findMany({
      where: eq(painterEarnings.painterId, pid),
      with: { order: { columns: { orderNumber: true, paymentStatus: true } } },
      orderBy: [desc(painterEarnings.createdAt)],
      limit: EARNING_LIST_LIMIT,
    }),
    // YALNIZ GÖSTERİM: bu geçmiş listesi bakiye okuyucusundan ayrı yüklenir, o
    // yüzden arızası sayfayı düşürmez (bkz. displayRead).
    displayRead("ödeme geçmişi", readPayoutPage(historyScope, historyQuery)),
    displayRead("güncel hak ediş ve düzeltme toplamları", readPartnerPayables("painter", pid)),
  ]);

  if (!moneySummary) return <div role="alert" className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">Hak ediş ve düzeltme toplamları okunamadı. Tutarlar bilinmediği için ödeme talebi kapalı; kayıtlar silinmedi. Sayfayı yeniden yükleyin.</div>;

  const owed = moneySummary.claimableNet;
  const refundedOpen = Number(totals?.refundedOpen ?? 0);
  const refundedInPayout = Number(totals?.refundedInPayout ?? 0);
  const inPayout = moneySummary.pendingPayoutNet;
  const paidTotal = moneySummary.paidTransferNet;

  const badgeFor = (e: { status: string; payoutId: string | null }) => {
    const batch = moneySummary.payouts.find(p => p.id === e.payoutId);
    if (batch?.settlementKind === "netting" && !batch.voidedAt) return {
      label: batch.status === "paid" ? "Mahsupla kapandı" : "Mahsup bekliyor",
      cls: "bg-indigo-100 text-indigo-700",
    };
    return EARNING_BADGE[e.status === "pending" && e.payoutId ? "in_payout" : e.status] ?? EARNING_BADGE.pending;
  };

  const cards: Array<{ label: string; value: number; cls: string; hint: string }> = [
    {
      label: "Talep edilebilir",
      value: owed,
      cls: "border-amber-200 bg-amber-50 text-amber-900",
      hint: "Hak ediş ve düzeltmelerin birlikte ödenebilir net tutarı",
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

      <PartnerAdjustmentHistory summary={moneySummary} />

      {/* İKİ PARAGRAF DA KENDİ KOŞULUNDA DURUR, biri ötekinin İÇİNDE DEĞİL.
          "Partiye girmiş iade hakedişi" cümlesi eskiden `refundedOpen > 0`
          bloğunun içine yazılmıştı; oysa bir hakediş partiye girdiği anda
          refundedOpen'dan düşüp refundedInPayout'a geçer. Yani cümle tam da
          yazıldığı durumda (para partide) görünmez oluyordu: uyarı, anlattığı
          risk gerçekleştiği anda ekrandan siliniyordu. */}
      {(refundedOpen > 0 || refundedInPayout > 0) && (
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900"
        >
          <p className="font-semibold">
            İade edilen siparişlerden kapanmamış hakediş:{" "}
            {formatCurrency(refundedOpen + refundedInPayout, locale)}
          </p>
          {refundedOpen > 0 && (
            <p className="mt-1 text-red-900/80">
              Bunun {formatCurrency(refundedOpen, locale)} kadarı henüz bir ödemeye
              girmedi: bu siparişlerin parası müşteriye iade edildi, tutar talep
              edilebilir kazancınıza sayılmaz ve ödeme talebi oluşturduğunuzda
              partiye de girmez. Kaydı yönetici kapatır, sizden bir işlem beklenmez.
            </p>
          )}
          {refundedInPayout > 0 && (
            <p className="mt-2 text-red-900/80">
              Bunun {formatCurrency(refundedInPayout, locale)} kadarı bir ödeme
              partisine girmiş durumda. Bu tutar ödenmeyebilir; yönetici ile
              teyitleşin.
            </p>
          )}
        </div>
      )}

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
          {painter.status === "active" ? <PainterPayoutRequestButton owedKurus={owed} hasClaimable={moneySummary.claimableCount > 0} hasIban={!!painter.iban} /> : <p className="text-sm text-amber-800">Hesabınız aktif olmadığı için yeni ödeme talebi kapalıdır; geçmiş kayıtlarınızı görebilirsiniz.</p>}
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
        İş bazında kazanç
      </h2>
      {earnings.length === EARNING_LIST_LIMIT && (
        <p className="-mt-2 mb-3 text-xs text-gray-500">
          En son {EARNING_LIST_LIMIT} kayıt listelenir; yukarıdaki toplamlar tüm
          kayıtları kapsar.
        </p>
      )}
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
                    <td className="px-4 py-2.5 font-mono text-gray-700">
                      {e.order?.orderNumber ?? "—"}
                      {/* Satırın rozeti "Bekliyor" kalır (veri onu diyor); iade
                          edilen sipariş ayrı bir işaretle söylenir. */}
                      {e.order?.paymentStatus === REFUNDED_PAYMENT_STATUS && (
                        <span className="ml-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                          İade edildi
                        </span>
                      )}
                    </td>
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

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Ödeme geçmişi</h2>
      <PayoutHistoryNavigation key={historyScope.kind} status={historyQuery.status} limit={historyQuery.limit} cursor={historyQuery.cursor}
        nextCursor={payoutPage?.nextCursor ?? null} rowCount={payoutPage?.rows.length ?? 0} unavailable={payoutPage === null}
        exportHref={`/api/painter/payouts/export?status=${historyQuery.status}`} />
      <PartnerPayoutHistory rows={payoutPage?.rows ?? []} unavailable={payoutPage === null} />
    </div>
  );
}
