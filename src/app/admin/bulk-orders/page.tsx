export const dynamic = "force-dynamic";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturers,
  orderItems,
  orders,
  products,
} from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { AWAITING_MANUFACTURER, NOT_REFUNDED } from "@/lib/services/admin-order-sql";
import { BulkOrdersClient, type BulkProductGroup } from "./bulk-orders-client";

// Toplu üretim kuyruğu — bulk orders aggregated BY PRODUCT rather than by
// order, because that is the unit production actually cares about: "340
// keychains across 9 orders" is one print run, and the whole point of the
// feature is to place that run with one workshop instead of nine.
//
// "Open" = paid and not yet shipped/delivered. Terminal and failed states drop
// out so the queue only shows work someone still has to do. Refunded orders
// drop out too (NOT_REFUNDED): a refund keeps the order's status but detaches
// the manufacturer and freezes it, so it looks unassigned yet can never be
// assigned. The "Toplu üretim" nav badge (AWAITING_MANUFACTURER in
// admin-order-sql.ts) already leaves them out; without the same filter here
// the header count and the badge disagreed.
//
// Per order, `assignable` is AWAITING_MANUFACTURER: approved (or a paid
// marketplace order), no manufacturer, not refunded. That is the header's
// "üretici bekliyor" set, the nav badge's set, and exactly what the assign
// service's status guard accepts. An open order with no manufacturer outside
// it is "henüz atanamaz". Bulk orders are marketplace orders: they wait at
// `paid` (assignable) and never pass through review or awaiting_model, which
// belong to custom orders. So that set can only hold an order that went into
// production (printing, quality_check, painting) with no manufacturer.
// It is never NULL (every column it reads is NOT NULL or null-checked), so
// NOT ASSIGNABLE below is its exact complement.
const ASSIGNABLE = sql<boolean>`${AWAITING_MANUFACTURER}`;

const OPEN_STATUSES = [
  "paid",
  "awaiting_model",
  "approved",
  "printing",
  "quality_check",
  "painting",
] as const;

export default async function AdminBulkOrdersPage() {
  // One row per (product, order) so we can aggregate units per product and
  // still know which orders are unassigned. Covers both order shapes: cart
  // sub-orders carry products on order_items, single-product orders on the
  // orders row itself.
  const lineRows = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      createdAt: orders.createdAt,
      manufacturerId: orders.manufacturerId,
      manufacturerName: manufacturers.companyName,
      manufacturerStatus: orders.manufacturerStatus,
      productId: orderItems.productId,
      productTitle: products.title,
      productImageKey: products.primaryImageKey,
      units: orderItems.quantity,
      assignable: ASSIGNABLE,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .leftJoin(manufacturers, eq(orders.manufacturerId, manufacturers.id))
    .where(
      and(
        eq(orders.isBulk, true),
        inArray(orders.status, [...OPEN_STATUSES]),
        NOT_REFUNDED,
        sql`${orderItems.appliedTierMinQuantity} IS NOT NULL`
      )
    );

  const scalarRows = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      createdAt: orders.createdAt,
      manufacturerId: orders.manufacturerId,
      manufacturerName: manufacturers.companyName,
      manufacturerStatus: orders.manufacturerStatus,
      productId: orders.productId,
      productTitle: products.title,
      productImageKey: products.primaryImageKey,
      units: orders.quantity,
      assignable: ASSIGNABLE,
    })
    .from(orders)
    .innerJoin(products, eq(orders.productId, products.id))
    .leftJoin(manufacturers, eq(orders.manufacturerId, manufacturers.id))
    .where(
      and(
        eq(orders.isBulk, true),
        inArray(orders.status, [...OPEN_STATUSES]),
        NOT_REFUNDED
      )
    );

  const groups = new Map<string, BulkProductGroup>();
  for (const row of [...lineRows, ...scalarRows]) {
    if (!row.productId) continue;
    let g = groups.get(row.productId);
    if (!g) {
      g = {
        productId: row.productId,
        title: row.productTitle,
        imageUrl: row.productImageKey ? getPublicUrl(row.productImageKey) : null,
        totalUnits: 0,
        assignableUnits: 0,
        notYetAssignableUnits: 0,
        orders: [],
        byManufacturer: [],
      };
      groups.set(row.productId, g);
    }
    const unassigned =
      !row.manufacturerId ||
      row.manufacturerStatus === null ||
      row.manufacturerStatus === "unassigned";
    const assignable = row.assignable === true;
    g.totalUnits += row.units;
    if (assignable) g.assignableUnits += row.units;
    else if (unassigned) g.notYetAssignableUnits += row.units;
    g.orders.push({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      units: row.units,
      createdAt: row.createdAt.toISOString(),
      manufacturerName: row.manufacturerName ?? null,
      unassigned,
      assignable,
    });
  }

  // Per-product manufacturer split, so the admin can see where a run already
  // lives before deciding where to put the rest of it.
  for (const g of groups.values()) {
    const split = new Map<string, number>();
    for (const o of g.orders) {
      const key = o.manufacturerName ?? "—";
      if (o.unassigned) continue;
      split.set(key, (split.get(key) ?? 0) + o.units);
    }
    g.byManufacturer = [...split.entries()]
      .map(([name, units]) => ({ name, units }))
      .sort((a, b) => b.units - a.units);
    g.orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Unassigned work first — that is what the page exists to clear.
  const productGroups = [...groups.values()].sort(
    (a, b) => b.assignableUnits - a.assignableUnits || b.totalUnits - a.totalUnits
  );

  const activeManufacturers = await db
    .select({
      id: manufacturers.id,
      companyName: manufacturers.companyName,
      acceptingOrders: manufacturers.acceptingOrders,
    })
    .from(manufacturers)
    .where(eq(manufacturers.status, "active"))
    .orderBy(manufacturers.companyName);

  // Header figures, one scan over the bulk orders.
  //  - awaiting: AWAITING_MANUFACTURER ∧ isBulk, exactly the set the
  //    "Toplu üretim" nav badge counts (admin/layout.tsx). The header used to
  //    count every open bulk order with no manufacturer, awaiting_model and
  //    unapproved ones included, so it read higher than the badge linking here.
  //  - notYet: the rest of that old figure (open, not refunded, no
  //    manufacturer, not assignable yet), shown apart so it is not lost.
  const [{ awaiting: awaitingCount, notYet: notYetAssignableCount }] = await db
    .select({
      awaiting: sql<number>`(count(*) FILTER (WHERE ${AWAITING_MANUFACTURER}))::int`,
      notYet: sql<number>`(count(*) FILTER (WHERE NOT ${ASSIGNABLE}
        AND ${NOT_REFUNDED}
        AND ${inArray(orders.status, [...OPEN_STATUSES])}
        AND (${orders.manufacturerStatus} IS NULL OR ${orders.manufacturerStatus} = 'unassigned')))::int`,
    })
    .from(orders)
    .where(eq(orders.isBulk, true));

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Toplu üretim kuyruğu</h1>
      <p className="mt-1 text-sm text-gray-600">
        Açık toplu siparişler ürün bazında toplanmıştır. Aynı ürünün siparişlerini
        tek üreticiye vererek kalıp/tezgâh kurulumunu bir kez yaptırabilirsiniz.
        {awaitingCount > 0 && (
          <>
            {" "}
            <strong className="text-orange-700">
              {awaitingCount} sipariş üretici bekliyor.
            </strong>
          </>
        )}
        {notYetAssignableCount > 0 && (
          <> {notYetAssignableCount} sipariş daha üreticisiz ama henüz atanamaz.</>
        )}
      </p>
      {/* What each figure on this page counts, so none is read as another. */}
      <p className="mt-1 text-xs text-gray-500">
        “Adet” ve “sipariş”: açık toplu siparişler (kargolanmamış, reddedilmemiş,
        iade edilmemiş). “Üretici bekliyor”: onaylı, şu an atanabilir ve henüz
        üreticisi olmayan siparişler; kenar çubuğundaki Toplu üretim sayısıyla
        aynı küme. “Henüz atanamaz”: üreticisi yok ama durumu atamaya uygun
        değil (ör. üretici atanmadan baskıya ya da kalite kontrole geçmiş).
      </p>

      <BulkOrdersClient
        groups={productGroups}
        manufacturers={activeManufacturers}
      />
    </div>
  );
}
