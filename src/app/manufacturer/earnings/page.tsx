export const dynamic = "force-dynamic";

import { readPartnerPayables } from "@/lib/services/partner-payables";
import { PartnerAdjustmentHistory } from "@/components/partner-adjustment-history";
import { PartnerPayoutHistory } from "@/components/partner-payout-history";
import { PayoutHistoryNavigation } from "@/components/payout-history-navigation";
import { readPayoutPage } from "@/lib/services/payout-list";
import { parsePayoutListQuery, type PayoutListQuery } from "@/lib/config/payout-list";

import { redirect } from "next/navigation";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, manufacturerEarnings, orders } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import { PayoutRequestButton } from "@/components/manufacturer/payout-request-button";
import { isRefunded } from "@/lib/config/order-status-policy";
import {
  refundedOpenEarningWhere,
  refundedInPayoutEarningWhere,
} from "@/lib/services/earning-claimable";

/** Liste son N kaydı gösterir; TOPLAMLAR bu listeden değil SQL'den gelir. */
const EARNING_LIST_LIMIT = 200;

/**
 * GÖSTERİM amaçlı okuma: sonucu ekranda yalnızca GÖSTERİLİR, bir kapıyı açıp
 * kapatmaz, hiçbir para rakamını beslemez. Arıza YUTULMAZ — null döner ve null
 * "kayıt yok" DEĞİL "BİLİNMİYOR" demektir; bayrak, o verinin KENDİ yerinde
 * yazılır.
 *
 * NEDEN: ödeme geçmişi tablosu para rakamlarıyla AYNI Promise.all içinde
 * okunuyordu ve tek bir reddedilen okuma SAYFANIN TAMAMINI düşürüyordu. Üretici,
 * geçmişe hiç BAĞLI OLMAYAN "ödeme bekleyen"/"ödenen toplam" tutarlarını, iade
 * uyarısını ve ödeme talebi düğmesini de göremiyordu — oysa o rakamlar ayrı bir
 * sorgudan gelir ve okunabiliyordu. Yalnız GÖSTERİLEN bir tablonun arızası
 * partnerin parasını ekrandan silemez.
 */
async function displayRead<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[üretici kazançlar] ${label} okunamadı`, e);
    return null;
  }
}

export default async function ManufacturerEarningsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer) {
    redirect("/manufacturer/login");
  }

  const historyScope = { audience: "partner" as const, kind: "manufacturer" as const, partnerId: session.manufacturerId };
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
    return <div role="alert" className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Ödeme geçmişi filtresi veya sayfa bağlantısı geçersiz. <a href="/manufacturer/earnings" className="underline">Listeyi yeniden açın</a>.</div>;
  }
  const locale = (await getLocale()) as Locale;
  const d = getDictionary(locale);

  // Hak ediş + düzeltme bakiyesi partilemenin ortak okuyucusundan gelir.
  // Aşağıdaki SQL yalnız iade edilmiş eski hak edişleri ayrıca açıklar;
  // 200 satırlık gösterim listesi hiçbir toplamın kaynağı değildir.
  const [[totals], earnings, payoutPage, moneySummary] = await Promise.all([
    db
      .select({
        refundedOpen: sql<number>`coalesce(sum(${manufacturerEarnings.netKurus}) filter (where ${refundedOpenEarningWhere(manufacturerEarnings)}), 0)::int`,
        refundedInPayout: sql<number>`coalesce(sum(${manufacturerEarnings.netKurus}) filter (where ${refundedInPayoutEarningWhere(manufacturerEarnings)}), 0)::int`,
      })
      .from(manufacturerEarnings)
      .leftJoin(orders, eq(orders.id, manufacturerEarnings.orderId))
      .where(eq(manufacturerEarnings.manufacturerId, session.manufacturerId)),
    db.query.manufacturerEarnings.findMany({
      where: eq(manufacturerEarnings.manufacturerId, session.manufacturerId),
      // paymentStatus: satırın yanındaki "İade edildi" işareti için.
      with: { order: { columns: { orderNumber: true, paymentStatus: true } } },
      orderBy: [desc(manufacturerEarnings.createdAt)],
      limit: EARNING_LIST_LIMIT,
    }),
    // YALNIZ GÖSTERİM: bu geçmiş listesi bakiye okuyucusundan ayrı yüklenir, o
    // yüzden arızası sayfayı düşürmez (bkz. displayRead).
    displayRead("ödeme geçmişi", readPayoutPage(historyScope, historyQuery)),
    displayRead("güncel hak ediş ve düzeltme toplamları", readPartnerPayables("manufacturer", session.manufacturerId)),
  ]);

  if (!moneySummary) return <div role="alert" className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">Hak ediş ve düzeltme toplamları okunamadı. Tutarlar bilinmediği için ödeme talebi kapalı; kayıtlar silinmedi. Sayfayı yeniden yükleyin.</div>;

  const owed = moneySummary.claimableNet;
  const refundedOpenKurus = Number(totals?.refundedOpen ?? 0);
  const refundedInPayoutKurus = Number(totals?.refundedInPayout ?? 0);
  const paidTotal = moneySummary.paidTransferNet;

  const refundedOrder = (e: (typeof earnings)[number]) =>
    isRefunded({ paymentStatus: e.order?.paymentStatus ?? null });

  const statusLabel: Record<string, string> = {
    pending: d["manufacturer.earnings.status.pending"],
    paid: d["manufacturer.earnings.status.paid"],
    reversed: d["manufacturer.earnings.status.reversed"],
  };
  const earningLabel = (e: { status: string; payoutId: string | null }) => {
    const batch = moneySummary.payouts.find(p => p.id === e.payoutId);
    if (batch?.settlementKind === "netting" && !batch.voidedAt) return batch.status === "paid" ? "Mahsupla kapandı" : "Mahsup bekliyor";
    return statusLabel[e.status] ?? e.status;
  };
  const statusColor: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    paid: "bg-emerald-100 text-emerald-700",
    reversed: "bg-gray-100 text-gray-500",
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {d["manufacturer.earnings.title"]}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
            {d["manufacturer.earnings.owed"]}
          </p>
          <p className="text-3xl font-bold text-amber-900 mt-1">
            {formatCurrency(owed, locale)}
          </p>
          {/* Neyin dışarıda kaldığı rakamın yanında yazar: tutar düşük
              göründüğünde üretici sebebini burada görür. */}
          <p className="mt-1 text-xs text-amber-800/80">
            Hak ediş ve düzeltmelerin birlikte ödenebilir net tutarı
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
            {d["manufacturer.earnings.paidTotal"]}
          </p>
          <p className="text-3xl font-bold text-emerald-900 mt-1">
            {formatCurrency(paidTotal, locale)}
          </p>
        </div>
      </div>

      <PartnerAdjustmentHistory summary={moneySummary} />

      {/* Türkçe sabit metin: bu uyarı i18n sözlüğünde karşılığı olmayan yeni bir
          cümle ve panel dili yalnız Türkçe. */}
      {/* İKİ PARAGRAF DA KENDİ KOŞULUNDA DURUR, biri ötekinin İÇİNDE DEĞİL.
          "Partiye girmiş iade hakedişi" cümlesi eskiden `refundedOpen > 0`
          bloğunun içine yazılmıştı; oysa bir hakediş partiye girdiği anda
          refundedOpen'dan düşüp refundedInPayout'a geçer. Yani cümle tam da
          yazıldığı durumda (para partide) görünmez oluyordu: uyarı, anlattığı
          risk gerçekleştiği anda ekrandan siliniyordu. */}
      {(refundedOpenKurus > 0 || refundedInPayoutKurus > 0) && (
        <div
          role="alert"
          className="mb-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900"
        >
          <p className="font-semibold">
            İade edilen siparişlerden kapanmamış hakediş:{" "}
            {formatCurrency(refundedOpenKurus + refundedInPayoutKurus, locale)}
          </p>
          {refundedOpenKurus > 0 && (
            <p className="mt-1 text-red-900/80">
              Bunun {formatCurrency(refundedOpenKurus, locale)} kadarı henüz bir
              ödemeye girmedi: bu siparişlerin parası müşteriye iade edildi, tutar
              ödeme bekleyen paranıza sayılmaz ve ödeme talebi oluşturduğunuzda
              partiye de girmez. Kaydı yönetici kapatır, sizden bir işlem beklenmez.
            </p>
          )}
          {refundedInPayoutKurus > 0 && (
            <p className="mt-2 text-red-900/80">
              Bunun {formatCurrency(refundedInPayoutKurus, locale)} kadarı bir
              ödeme partisine girmiş durumda. Bu tutar ödenmeyebilir; yönetici ile
              teyitleşin.
            </p>
          )}
        </div>
      )}

      <div className="mb-8">
        {manufacturer.status === "active" ? <PayoutRequestButton owedKurus={owed} hasClaimable={moneySummary.claimableCount > 0} /> : <p className="text-sm text-amber-800">Hesabınız aktif olmadığı için yeni ödeme talebi kapalıdır; geçmiş kayıtlarınızı görebilirsiniz.</p>}
      </div>

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        {d["manufacturer.earnings.perOrder"]}
      </h2>
      {earnings.length === EARNING_LIST_LIMIT && (
        <p className="-mt-2 mb-3 text-xs text-gray-500">
          En son {EARNING_LIST_LIMIT} kayıt listelenir; yukarıdaki toplamlar tüm
          kayıtları kapsar.
        </p>
      )}
      {earnings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          {d["manufacturer.earnings.empty"]}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-8">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left py-2.5 px-4 font-medium">#</th>
                <th className="text-right py-2.5 px-4 font-medium">{d["manufacturer.earnings.gross"]}</th>
                <th className="text-right py-2.5 px-4 font-medium">{d["manufacturer.earnings.commission"]}</th>
                <th className="text-right py-2.5 px-4 font-medium">{d["manufacturer.earnings.net"]}</th>
                <th className="text-right py-2.5 px-4 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {earnings.map((e) => (
                <tr key={e.id}>
                  <td className="py-2.5 px-4 font-mono text-gray-700">
                    {e.order?.orderNumber ?? "—"}
                    {/* Satırın durumu "Bekliyor" kalır (veri onu diyor); iade
                        edilen sipariş ayrı bir işaretle söylenir. */}
                    {refundedOrder(e) && (
                      <span className="ml-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                        İade edildi
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right text-gray-500">{formatCurrency(e.grossKurus, locale)}</td>
                  <td className="py-2.5 px-4 text-right text-gray-500">−{formatCurrency(e.commissionKurus, locale)}</td>
                  <td className="py-2.5 px-4 text-right font-semibold text-gray-900">{formatCurrency(e.netKurus, locale)}</td>
                  <td className="py-2.5 px-4 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[e.status]}`}>
                      {earningLabel(e)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Ödeme geçmişi</h2>
      <PayoutHistoryNavigation key={historyScope.kind} status={historyQuery.status} limit={historyQuery.limit} cursor={historyQuery.cursor}
        nextCursor={payoutPage?.nextCursor ?? null} rowCount={payoutPage?.rows.length ?? 0} unavailable={payoutPage === null}
        exportHref={`/api/manufacturer/payouts/export?status=${historyQuery.status}`} />
      <PartnerPayoutHistory rows={payoutPage?.rows ?? []} unavailable={payoutPage === null} />
    </div>
  );
}
