export const dynamic = "force-dynamic";

import Link from "next/link";
import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, orders, qcPhotos } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { sizeDisplayTr } from "@/lib/config/sizes";
import { APP_TIME_ZONE } from "@/lib/config/timezone";
import { NOT_REFUNDED } from "@/lib/services/admin-order-sql";

/**
 * Admin QC queue — orders whose manufacturer has uploaded finished-product
 * photos and submitted them for review (manufacturerStatus = 'qc_pending').
 * Each card links to the order detail where the admin approves/rejects.
 * Mirrors /admin/gallery-queue styling + the admin-sidebar layout.
 *
 * Refunded orders are left out (NOT_REFUNDED), the same predicate as the
 * dashboard's "QC Bekleyen" card and the sidebar badge that open this list:
 * a refunded order is frozen, so its QC decision is not work.
 */
export default async function AdminQcQueuePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const items = await db.query.orders.findMany({
    where: and(eq(orders.manufacturerStatus, "qc_pending"), NOT_REFUNDED),
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      figurineSize: true,
      style: true,
      qcRound: true,
      updatedAt: true,
      // Atölye ADI ayrı okunuyor; siparişin hangi atölyede olduğu kolonda.
      manufacturerId: true,
    },
    // `with:` BİLEREK YOK: ilişkisel sorgu TEK ifadedir, `manufacturers` ya da
    // `qc_photos` okunamadığında SORGUNUN TAMAMI fırlar ve kuyruk ekranı
    // tamamen kaybolurdu — oysa ikisi de yalnızca GÖSTERİLİYOR (atölye adı ve
    // fotoğraf sayısı). Kuyruğun kendisi çekirdek okumadır, yandakiler değil.
    orderBy: [desc(orders.updatedAt)],
    limit: 200,
  });

  // ─── Yalnız GÖSTERİLEN yan okumalar: ayrı ve korumalı ────────────────────
  const orderIds = items.map((i) => i.id);
  const mfgIds = [
    ...new Set(items.map((i) => i.manufacturerId).filter((x): x is string => !!x)),
  ];
  const [nameRead, qcRead] = await Promise.all([
    mfgIds.length
      ? db
          .select({ id: manufacturers.id, companyName: manufacturers.companyName })
          .from(manufacturers)
          .where(inArray(manufacturers.id, mfgIds))
          .catch((e) => {
            console.error("qc-queue: atölye adları okunamadı", e);
            return null;
          })
      : [],
    orderIds.length
      ? db
          .select({ orderId: qcPhotos.orderId, round: qcPhotos.round })
          .from(qcPhotos)
          .where(inArray(qcPhotos.orderId, orderIds))
          .catch((e) => {
            console.error("qc-queue: QC fotoğraf sayıları okunamadı", e);
            return null;
          })
      : [],
  ]);
  const namesUnreadable = nameRead === null;
  const nameById = new Map((nameRead ?? []).map((m) => [m.id, m.companyName]));
  const photoCountsUnreadable = qcRead === null;
  const photoCountByOrder = new Map<string, number>();
  for (const it of items) {
    photoCountByOrder.set(
      it.id,
      (qcRead ?? []).filter((q) => q.orderId === it.id && q.round === it.qcRound).length
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{d["admin.qcQueue.title"]}</h1>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
          {items.length}
        </span>
      </div>

      {(namesUnreadable || photoCountsUnreadable) && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Bu listenin bazı bilgileri şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            {[
              namesUnreadable && "atölye adları",
              photoCountsUnreadable &&
                "yüklenen QC fotoğraf sayıları (rozetlerde ? görünüyor)",
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            okunamadı: bu alanlar BOŞ DEĞİL, bilinmiyor. Kuyruğun kendisi
            gerçektir; siparişe girip kararınızı verebilirsiniz.
          </p>
        </div>
      )}
      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500">{d["admin.qcQueue.empty"]}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((it) => {
            const photoCount = photoCountByOrder.get(it.id) ?? 0;
            return (
              <Link
                key={it.id}
                href={`/admin/orders/${it.id}`}
                className="bg-white rounded-xl border border-gray-200 p-5 hover:border-amber-400 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="font-mono text-sm text-amber-600">{it.orderNumber}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(it.updatedAt).toLocaleDateString(
                      locale === "tr" ? "tr-TR" : "en-US",
                      { timeZone: APP_TIME_ZONE }
                    )}
                  </span>
                </div>
                <p className="text-sm text-gray-900 mb-1">{it.customerName}</p>
                {it.manufacturerId && (
                  <p className="text-xs text-gray-500 mb-2">
                    {nameById.get(it.manufacturerId) ??
                      (namesUnreadable ? "Atölye adı okunamadı" : "—")}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {sizeDisplayTr(it.figurineSize, { short: true })}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {it.style}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    {photoCountsUnreadable ? "?" : photoCount} {d["admin.qcQueue.photos"]}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
