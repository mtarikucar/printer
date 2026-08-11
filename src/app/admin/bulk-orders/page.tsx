export const dynamic = "force-dynamic";

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturers,
  orderItems,
  orders,
  products,
} from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { BulkOrdersClient, type BulkProductGroup } from "./bulk-orders-client";

// Toplu üretim kuyruğu — bulk orders aggregated BY PRODUCT rather than by
// order, because that is the unit production actually cares about: "340
// keychains across 9 orders" is one print run, and the whole point of the
// feature is to place that run with one workshop instead of nine.
//
// "Open" = paid and not yet shipped/delivered. Terminal and failed states drop
// out so the queue only shows work someone still has to do.
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
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .leftJoin(manufacturers, eq(orders.manufacturerId, manufacturers.id))
    .where(
      and(
        eq(orders.isBulk, true),
        inArray(orders.status, [...OPEN_STATUSES]),
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
    })
    .from(orders)
    .innerJoin(products, eq(orders.productId, products.id))
    .leftJoin(manufacturers, eq(orders.manufacturerId, manufacturers.id))
    .where(
      and(eq(orders.isBulk, true), inArray(orders.status, [...OPEN_STATUSES]))
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
        unassignedUnits: 0,
        orders: [],
        byManufacturer: [],
      };
      groups.set(row.productId, g);
    }
    const unassigned =
      !row.manufacturerId ||
      row.manufacturerStatus === null ||
      row.manufacturerStatus === "unassigned";
    g.totalUnits += row.units;
    if (unassigned) g.unassignedUnits += row.units;
    g.orders.push({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      units: row.units,
      createdAt: row.createdAt.toISOString(),
      manufacturerName: row.manufacturerName ?? null,
      unassigned,
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
    (a, b) => b.unassignedUnits - a.unassignedUnits || b.totalUnits - a.totalUnits
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

  // Sanity counter for the header: bulk orders with nobody on them at all.
  const [{ count: unassignedOrderCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.isBulk, true),
        inArray(orders.status, [...OPEN_STATUSES]),
        or(
          isNull(orders.manufacturerStatus),
          eq(orders.manufacturerStatus, "unassigned")
        )
      )
    );

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Toplu üretim kuyruğu</h1>
      <p className="mt-1 text-sm text-gray-600">
        Açık toplu siparişler ürün bazında toplanmıştır. Aynı ürünün siparişlerini
        tek üreticiye vererek kalıp/tezgâh kurulumunu bir kez yaptırabilirsiniz.
        {unassignedOrderCount > 0 && (
          <>
            {" "}
            <strong className="text-orange-700">
              {unassignedOrderCount} sipariş üretici bekliyor.
            </strong>
          </>
        )}
      </p>

      <BulkOrdersClient
        groups={productGroups}
        manufacturers={activeManufacturers}
      />
    </div>
  );
}
