"use client";

import Link from "next/link";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import { PAINTER_BADGE } from "@/app/admin/orders/orders-client";
import { queueSection, type QueueSectionKey } from "./sections";

interface QueueItem {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  manufacturerStatus: string | null;
  manufacturerName: string | null;
  manufacturerPaintsInHouse: boolean;
  needsPainting: boolean;
  painterId: string | null;
  painterName: string | null;
  painterStatus: string | null;
  workshopSessionId: string | null;
  updatedAt: string;
}

type Stage = { label: string; cls: string };

// The QC section spans three manufacturer steps. The chip says whose move it
// is: the manufacturer's (photos, or a resubmission) or the admin's (a decision).
const QC_STAGE: Record<string, Stage> = {
  printed: { label: "QC fotoğrafı bekleniyor", cls: "bg-amber-100 text-amber-800" },
  qc_pending: { label: "QC kararınızı bekliyor", cls: "bg-yellow-100 text-yellow-800" },
  qc_rejected: { label: "QC reddedildi · yeniden gönderim", cls: "bg-red-100 text-red-700" },
};

interface SectionDef {
  key: QueueSectionKey;
  title: string;
  hint?: string;
  link?: { href: string; label: string };
  showManufacturer: boolean;
  showPainter?: boolean;
  /** A column linking to the order's workshop session page. */
  showWorkshopSession?: boolean;
  stage?: (item: QueueItem) => Stage | null;
  /** Only rendered when it has orders (the catch-all). */
  hideWhenEmpty?: boolean;
}

function QueueTable({
  items,
  section,
  d,
  locale,
}: {
  items: QueueItem[];
  section: SectionDef;
  d: Record<string, string>;
  locale: Locale;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4 text-center">
        {d["admin.manufacturingQueue.noOrders"]}
      </p>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
              {d["admin.printQueue.table.order"]}
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
              {d["admin.printQueue.table.customer"]}
            </th>
            {section.showManufacturer && (
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {d["admin.manufacturingQueue.manufacturer"]}
              </th>
            )}
            {section.showPainter && (
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                Boyacı
              </th>
            )}
            {section.showWorkshopSession && (
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                Atölye seansı
              </th>
            )}
            {section.stage && (
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                Aşama
              </th>
            )}
            {/* This column is updatedAt, the last change of any kind. It was
                labelled "Onay Tarihi", which it never was. */}
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
              Son güncelleme
            </th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const stage = section.stage?.(item) ?? null;
            return (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-sm">{item.orderNumber}</td>
                <td className="px-4 py-3 text-sm">{item.customerName}</td>
                {section.showManufacturer && (
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {item.manufacturerName || "-"}
                  </td>
                )}
                {section.showPainter && (
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {item.painterName || "-"}
                  </td>
                )}
                {section.showWorkshopSession && (
                  <td className="px-4 py-3 text-sm">
                    {item.workshopSessionId ? (
                      <Link
                        href={`/admin/workshops/sessions/${item.workshopSessionId}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Seansı aç
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                )}
                {section.stage && (
                  <td className="px-4 py-3">
                    {stage ? (
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${stage.cls}`}
                      >
                        {stage.label}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 text-sm text-gray-500">
                  {formatDate(item.updatedAt, locale)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/orders/${item.id}`}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    {d["admin.printQueue.view"]}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PrintQueueClient({
  items,
  refundedHidden,
  refundedOpen,
}: {
  items: QueueItem[];
  /** Refunded orders at a queue status, left out of the sections below. */
  refundedHidden: number;
  /** Every open refund (REFUNDED_OPEN): the length of the list the banner links to. */
  refundedOpen: number;
}) {
  const d = useDictionary();
  const locale = useLocale();

  // One pass, one section per order (see sections.ts).
  const bySection = new Map<QueueSectionKey, QueueItem[]>();
  for (const item of items) {
    const key = queueSection(item);
    const list = bySection.get(key);
    if (list) list.push(item);
    else bySection.set(key, [item]);
  }

  const sections: SectionDef[] = [
    {
      key: "unassigned",
      title: d["admin.manufacturingQueue.unassigned"],
      showManufacturer: false,
    },
    {
      key: "awaitingAcceptance",
      title: d["admin.manufacturingQueue.assigned"],
      showManufacturer: true,
    },
    {
      key: "inProduction",
      title: d["admin.manufacturingQueue.inProduction"],
      showManufacturer: true,
    },
    {
      key: "qualityCheck",
      title: d["admin.status.quality_check"],
      hint: "Baskı bitti. Üreticinin QC fotoğrafı, sizin QC kararınız ya da reddedilen işin yeniden gönderimi bekleniyor.",
      link: { href: "/admin/qc-queue", label: "QC kuyruğu" },
      showManufacturer: true,
      stage: (i) => QC_STAGE[i.manufacturerStatus ?? ""] ?? null,
    },
    {
      key: "toPainter",
      title: "Boyacıya gönderilecek",
      hint: "QC onaylı ve boyama isteniyor, ama henüz bir boyacıya teslim edilmedi.",
      showManufacturer: true,
    },
    {
      key: "withPainter",
      title: "Boyacıda",
      showManufacturer: true,
      showPainter: true,
      stage: (i) => PAINTER_BADGE[i.painterStatus ?? ""] ?? null,
    },
    {
      // The dictionary key is still called "printed" but the section now means
      // what its label says: QC-approved and shippable by the manufacturer.
      key: "readyToShip",
      title: d["admin.manufacturingQueue.printed"],
      hint: "QC onaylı; üretici kargoya verebilir.",
      showManufacturer: true,
    },
    {
      // QC-approved workshop orders. The manufacturer ship route refuses them;
      // the admin ships the session's batch to the venue from the session page.
      key: "workshopBatch",
      title: "Atölye partisi — mekâna toplu gönderim",
      hint: "QC onaylı; üretici tek tek kargolayamaz. Parti, seans sayfasından mekâna tek sevkiyatla gönderilir.",
      showManufacturer: true,
      showWorkshopSession: true,
    },
    {
      key: "other",
      title: "Diğer",
      hint: "Beklenmeyen bir durum bileşimi. Siparişi açıp kontrol edin.",
      showManufacturer: true,
      showPainter: true,
      hideWhenEmpty: true,
    },
  ];

  return (
    <div className="mt-6 space-y-8">
      {refundedHidden > 0 && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          İade edilmiş {refundedHidden} sipariş bu kuyrukta gösterilmiyor: iade
          edilen siparişte ileri işlemler kapalı.{" "}
          {/* The link opens every open refund, not only the ones hidden here.
              All hidden ones are in it (the queue has no rejected or delivered
              status), plus refunds that stopped outside the queue. So the link
              shows that list's own count, and the difference is spelled out:
              the banner count alone did not match the list it opened. */}
          <Link
            href="/admin/orders?bucket=refunded_open"
            className="font-medium underline hover:text-red-900"
          >
            Tüm açık iadeleri gör ({refundedOpen})
          </Link>
          {refundedOpen > refundedHidden && (
            <>
              {" "}
              Bu liste, kuyruk dışındaki aşamalarda duran{" "}
              {refundedOpen - refundedHidden} iadeyi de içerir (ör. model
              bekleyen, incelemedeki ya da kargolanmış).
            </>
          )}
        </p>
      )}

      {sections.map((section) => {
        const sectionItems = bySection.get(section.key) ?? [];
        if (section.hideWhenEmpty && sectionItems.length === 0) return null;
        return (
          <div key={section.key}>
            <h2 className="text-lg font-semibold text-gray-900">
              {section.title} ({sectionItems.length})
            </h2>
            {(section.hint || section.link) && (
              <p className="mt-0.5 text-sm text-gray-500">
                {section.hint}
                {section.link && (
                  <>
                    {" "}
                    <Link
                      href={section.link.href}
                      className="font-medium text-blue-600 hover:text-blue-800"
                    >
                      {section.link.label}
                    </Link>
                  </>
                )}
              </p>
            )}
            <div className="mt-3">
              <QueueTable items={sectionItems} section={section} d={d} locale={locale} />
            </div>
          </div>
        );
      })}

      {items.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">{d["admin.printQueue.empty"]}</p>
          <p className="text-sm mt-1">{d["admin.printQueue.emptySubtitle"]}</p>
        </div>
      )}
    </div>
  );
}
