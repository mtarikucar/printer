export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { manufacturers, orders, painters } from "@/lib/db/schema";
import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import { PrintQueueClient } from "./client";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  IS_REFUNDED,
  NOT_REFUNDED,
  REFUNDED_OPEN,
} from "@/lib/services/admin-order-sql";

// Statuses an order passes through while a manufacturer, or the painter after
// it, holds it: approved → printing → quality_check (printed, QC photos, admin
// QC) → painting (painted orders only). The queue used to read only approved
// and printing, so every order in QC or with a painter dropped off it.
// Marketplace orders are assigned while still at `paid`: platform products wait
// there for a manufacturer, and a seller's own product goes to that seller at
// payment. So paid marketplace orders are in scope too.
const IN_QUEUE = or(
  inArray(orders.status, ["approved", "printing", "quality_check", "painting"]),
  and(eq(orders.orderType, "marketplace"), eq(orders.status, "paid"))
);

export default async function PrintQueuePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const [queueOrders, [{ refundedHidden }], [{ refundedOpen }]] = await Promise.all([
    // Refunded orders keep their status but every forward action on them is
    // refused, so they are not queue work. They are counted separately below
    // so the desk knows they exist.
    // `with:` BİLEREK YOK: atölye/boyacı KAYDI yalnızca gösteriliyor (ad +
    // "kendi boyar mı" ipucu), ama ilişkisel sorgu TEK ifadedir — biri
    // okunamadığında ÜRETİM KUYRUĞUNUN TAMAMI 500 verirdi. Kuyruk çekirdek
    // okumadır; partner adları değil.
    db.query.orders.findMany({
      where: and(NOT_REFUNDED, IN_QUEUE),
      orderBy: [desc(orders.updatedAt)],
    }),
    db
      .select({ refundedHidden: count() })
      .from(orders)
      .where(and(IS_REFUNDED, IN_QUEUE)),
    // The banner links to the orders list's refunded_open bucket (every open
    // refund), a superset of the hidden ones: it also holds refunds that
    // stopped outside this queue (model or review stage, shipped, ...). Its
    // own count goes on the link, so the number there matches the list.
    db.select({ refundedOpen: count() }).from(orders).where(REFUNDED_OPEN),
  ]);

  // ─── Partner adları: ayrı ve korumalı ────────────────────────────────────
  const mfgIds = [
    ...new Set(queueOrders.map((o) => o.manufacturerId).filter((x): x is string => !!x)),
  ];
  const painterIds = [
    ...new Set(queueOrders.map((o) => o.painterId).filter((x): x is string => !!x)),
  ];
  const [mfgRead, painterRead] = await Promise.all([
    mfgIds.length
      ? db
          .select({
            id: manufacturers.id,
            companyName: manufacturers.companyName,
            paintsInHouse: manufacturers.paintsInHouse,
          })
          .from(manufacturers)
          .where(inArray(manufacturers.id, mfgIds))
          .catch((e) => {
            console.error("print-queue: atölye kayıtları okunamadı", e);
            return null;
          })
      : [],
    painterIds.length
      ? db
          .select({ id: painters.id, companyName: painters.companyName })
          .from(painters)
          .where(inArray(painters.id, painterIds))
          .catch((e) => {
            console.error("print-queue: boyacı kayıtları okunamadı", e);
            return null;
          })
      : [],
  ]);
  const manufacturersUnreadable = mfgRead === null;
  const mfgById = new Map((mfgRead ?? []).map((m) => [m.id, m]));
  const paintersUnreadable = painterRead === null;
  const painterById = new Map((painterRead ?? []).map((x) => [x.id, x]));

  const queueItems = queueOrders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    status: order.status,
    manufacturerStatus: order.manufacturerStatus,
    manufacturerName: mfgById.get(order.manufacturerId ?? "")?.companyName ?? null,
    // The ship gate for painted orders depends on it: a shop that paints in
    // house ships the job itself instead of handing it to a painter.
    manufacturerPaintsInHouse:
      mfgById.get(order.manufacturerId ?? "")?.paintsInHouse ?? false,
    needsPainting: order.needsPainting,
    painterId: order.painterId,
    painterName: painterById.get(order.painterId ?? "")?.companyName ?? null,
    painterStatus: order.painterStatus,
    // A workshop-session order never ships one by one (the admin ships the
    // batch to the venue), so the classifier needs it. findMany above reads
    // every column, so this is already on the row.
    workshopSessionId: order.workshopSessionId,
    updatedAt: order.updatedAt.toISOString(),
  }));

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">{d["admin.manufacturingQueue.title"]}</h1>
      <p className="text-gray-500 mt-1">
        {d["admin.manufacturingQueue.subtitle"]}
      </p>

      {(manufacturersUnreadable || paintersUnreadable) && (
        <div
          role="alert"
          className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Partner kayıtları şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            {[
              manufacturersUnreadable &&
                "atölye adları (ve atölyenin kendi boyayıp boyamadığı bilgisi — kargo ipucu bu yüzden yanıltıcı olabilir)",
              paintersUnreadable && "boyacı adları",
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            okunamadı: adı görünmeyen işler ATANMAMIŞ DEĞİL, partneri bilinmiyor.
            Kuyruğun kendisi ve sipariş durumları gerçektir.
          </p>
        </div>
      )}
      <PrintQueueClient
        items={queueItems}
        refundedHidden={refundedHidden}
        refundedOpen={refundedOpen}
      />
    </div>
  );
}
