export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq, sql, and, desc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { ManufacturerDashboardClient } from "./dashboard-client";

export default async function ManufacturerDashboardPage() {
  const session = await getManufacturerSession();
  if (!session) {
    redirect("/manufacturer/login");
  }

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });

  if (!manufacturer) {
    redirect("/manufacturer/login");
  }

  const locale = await getLocale();

  // If pending approval, just show the pending banner
  if (manufacturer.status === "pending_approval") {
    return (
      <ManufacturerDashboardClient
        status="pending_approval"
        companyName={manufacturer.companyName}
        metrics={null}
        recentOrders={[]}
        locale={locale}
      />
    );
  }

  // Get metrics for active manufacturers
  const mfrId = session.manufacturerId;

  const [
    [totalOrders],
    [newAssignments],
    [currentlyPrinting],
    [shippedThisMonth],
    [accepted],
    [printed],
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(orders)
      .where(eq(orders.manufacturerId, mfrId)),
    db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          eq(orders.manufacturerId, mfrId),
          eq(orders.manufacturerStatus, "assigned")
        )
      ),
    db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          eq(orders.manufacturerId, mfrId),
          eq(orders.manufacturerStatus, "printing")
        )
      ),
    db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          eq(orders.manufacturerId, mfrId),
          eq(orders.manufacturerStatus, "shipped"),
          sql`${orders.shippedAt} >= date_trunc('month', CURRENT_DATE)`
        )
      ),
    db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          eq(orders.manufacturerId, mfrId),
          eq(orders.manufacturerStatus, "accepted")
        )
      ),
    db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          eq(orders.manufacturerId, mfrId),
          eq(orders.manufacturerStatus, "printed")
        )
      ),
  ]);

  // Recent orders (last 5)
  const recentOrderRows = await db.query.orders.findMany({
    where: eq(orders.manufacturerId, mfrId),
    orderBy: [desc(orders.assignedToManufacturerAt)],
    limit: 5,
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      figurineSize: true,
      style: true,
      manufacturerStatus: true,
      assignedToManufacturerAt: true,
    },
  });

  return (
    <ManufacturerDashboardClient
      status={manufacturer.status}
      companyName={manufacturer.companyName}
      metrics={{
        totalOrders: totalOrders.count,
        newAssignments: newAssignments.count,
        accepted: accepted.count,
        currentlyPrinting: currentlyPrinting.count,
        printed: printed.count,
        shippedThisMonth: shippedThisMonth.count,
      }}
      recentOrders={recentOrderRows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        figurineSize: o.figurineSize,
        style: o.style,
        manufacturerStatus: o.manufacturerStatus,
        assignedAt: o.assignedToManufacturerAt?.toISOString() ?? null,
      }))}
      locale={locale}
    />
  );
}
