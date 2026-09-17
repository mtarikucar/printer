import { readPartnerPayables } from "@/lib/services/partner-payables";
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
import { isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import {
  refundedOpenEarningWhere,
  refundedInPayoutEarningWhere,
} from "@/lib/services/earning-claimable";
// Kapasite TEK ölçüden okunur; bu sayfa sunucu bileşeni olduğu için yükleyiciyi
// doğrudan çağırır (istemci bileşeni çağıramazdı: modül `pg`yi sürükler).
import {
  emptyPainterCapacity,
  loadPainterCapacity,
} from "@/lib/services/painter-capacity";

// Turkish labels for the per-order painting sub-lifecycle
// (painterOrderStatusEnum). Hardcoded — the painter realm carries no i18n keys.
// Same words as /painter/jobs (STATUS_LABEL in jobs-client.tsx), QC states
// included: without them a job in QC showed the raw enum ("qc_approved").
// jobs-client.tsx is a client module, so this server page cannot import its
// constant; keep the two in step.
const PAINTER_STATUS_LABELS: Record<string, string> = {
  unassigned: "Atanmadı",
  assigned: "Atandı",
  accepted: "Kabul edildi",
  painting: "Boyanıyor",
  painted: "Boyandı",
  qc_pending: "QC onayında",
  qc_rejected: "QC reddedildi",
  qc_approved: "QC onaylandı",
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
  const [[assigned], [accepted], [painting], [pending], recent, capacityRow, moneySummary] =
    await Promise.all([
      // İADE: iade edilmiş sipariş kimsenin işi değildir. Bu üç kutu eskiden
      // yalnız painter_status'e bakıyordu, tezgâh kutusu ise ortak ölçüden
      // (painter-capacity.ts) geldiği için iadeyi düşüyordu: aynı ekran iki
      // farklı iş sayısı gösteriyordu. Sayım kuralı tek olsun diye guard eklendi.
      db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.painterId, pid), eq(orders.painterStatus, "assigned"), notRefundedGuard())),
      db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.painterId, pid), eq(orders.painterStatus, "accepted"), notRefundedGuard())),
      db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.painterId, pid), eq(orders.painterStatus, "painting"), notRefundedGuard())),
      // İade edilmiş asıl hak edişler ayrı gösterilir; ödenebilir bakiye
      // düzeltmelerle birlikte ortak partner-payables okuyucusundan gelir.
      db
        .select({
          refundedOpen: sql<number>`coalesce(sum(${painterEarnings.netKurus}) filter (where ${refundedOpenEarningWhere(painterEarnings)}), 0)::int`,
          refundedInPayout: sql<number>`coalesce(sum(${painterEarnings.netKurus}) filter (where ${refundedInPayoutEarningWhere(painterEarnings)}), 0)::int`,
        })
        .from(painterEarnings)
        .leftJoin(orders, eq(orders.id, painterEarnings.orderId))
        .where(eq(painterEarnings.painterId, pid)),
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
          // A refund keeps the painter status, so the row needs this to say
          // the job is cancelled, as /painter/jobs does.
          paymentStatus: true,
        },
      }),
      // TEZGÂH YÜKÜ: kapının ta kendisi (services/painter-capacity.ts). Bu
      // sayfa yükü kendisi sayıyordu ve üç yönden birden yanlıştı: (a) elle
      // yazılmış üç durum (assigned/accepted/painting) aktif küme DEĞİL —
      // boyanmış ve QC'deki işler dışarıda kalıyordu, (b) iade edilmiş iş
      // düşülmüyordu (iade kimsenin kapasitesini tüketmez), (c) BİRİM yerine
      // KUTU sayıyordu. Partnere kendi işi hakkında yanlış bir şey söylenemez.
      loadPainterCapacity(pid),
      readPartnerPayables("painter", pid).catch((error) => {
        console.error("[painter dashboard] Hak ediş bakiyesi okunamadı", error);
        return null;
      }),
    ]);

  const pendingEarnings = moneySummary?.claimableNet ?? null;
  const inPayoutKurus = moneySummary?.pendingPayoutNet ?? null;
  // "Bekleyen kazanç"tan DIŞARIDA kalan para: sebebi rakamın yanında yazsın.
  const refundedUnpayable =
    Number(pending?.refundedOpen ?? 0) + Number(pending?.refundedInPayout ?? 0);
  // Boyacı satırı yukarıda okundu, yani null pratikte imkânsız; yine de eksik
  // satır "bilinmiyor" diye okunmasın diye boş tezgâh satırına düşüyoruz.
  const capacity =
    capacityRow ?? emptyPainterCapacity(pid, painter.maxConcurrentOrders);

  const stats: Array<{ label: string; value: string | number }> = [
    { label: "Atanan işler", value: assigned?.c ?? 0 },
    { label: "Kabul edilen", value: accepted?.c ?? 0 },
    { label: "Boyanıyor", value: painting?.c ?? 0 },
    { label: "Bekleyen kazanç", value: pendingEarnings === null ? "Okunamadı" : formatCurrency(pendingEarnings, locale) },
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

      {moneySummary === null && (
        <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Hak ediş ve düzeltme kayıtları okunamadığı için bakiye gösterilemiyor. Bu durum bakiyenizin sıfır olduğu anlamına gelmez. Lütfen sayfayı yenileyin.
        </p>
      )}

      {refundedUnpayable > 0 && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          İade edilen siparişlerden kapanmamış{" "}
          {formatCurrency(refundedUnpayable, locale)} hakediş var. Bu tutar yukarıdaki
          &quot;Bekleyen kazanç&quot; rakamına dâhil değildir ve ödeme partisine girmez;
          kaydı yönetici kapatır.{" "}
          <Link href="/painter/earnings" className="font-medium underline">
            Kazançlar
          </Link>{" "}
          sayfasında sipariş sipariş görebilirsiniz.
        </p>
      )}

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Tezgâh yükü / Maks kapasite
        </p>
        <p className="mt-1 text-2xl font-bold text-gray-900">
          {capacity.loadUnits} / {capacity.maxConcurrentOrders}{" "}
          <span className="text-base font-medium text-gray-500">birim</span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {capacity.activeJobs} aktif iş · bir iş 1 birim sayılır, her 20 adet
          için 1 birim daha eklenir (60 adetlik tek iş = 4 birim). İade edilen
          siparişler bu yükü doldurmaz.
        </p>
        {/* Cümle, uçların uyguladığı boolean'dan gelir: eşik burada YENİDEN
            hesaplanmaz. "İş kabulü kapalı" ayrı bir gerçektir ve kapasiteyle
            karıştırılmaz — ikisi de doğru söylenmeli. */}
        <p
          className={`mt-1 text-xs font-medium ${
            !painter.acceptingOrders
              ? "text-gray-600"
              : capacity.hasRoom
                ? "text-emerald-700"
                : "text-amber-700"
          }`}
        >
          {!painter.acceptingOrders
            ? "Yeni iş kabulünü kapattınız: kapasiteniz uygun olsa da iş düşmez."
            : capacity.hasRoom
              ? "Yeni boyama işi düşebilir."
              : "Kapasiteniz dolu: yük limitin altına inene kadar yeni iş düşmez."}
        </p>
      </div>

      <Link
        href="/painter/earnings"
        className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:bg-gray-50"
      >
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Kazançlar ve ödemeler
          </p>
          <p className="mt-1 text-sm text-gray-700">
            {inPayoutKurus === null
              ? "Ödeme sürecindeki tutar okunamadı"
              : inPayoutKurus > 0
              ? `Ödeme sürecinde: ${formatCurrency(inPayoutKurus, locale)}`
              : "İş bazında kazanç, ödeme talebi ve ödeme geçmişi"}
          </p>
        </div>
        <span className="text-sm text-indigo-600">Görüntüle →</span>
      </Link>

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
                  <span className="flex items-center gap-1.5 text-xs text-gray-500">
                    {o.painterStatus
                      ? PAINTER_STATUS_LABELS[o.painterStatus] ?? o.painterStatus
                      : "—"}
                    {isRefunded(o) && (
                      <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        İade edildi
                      </span>
                    )}
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
