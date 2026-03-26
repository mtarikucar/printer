import { getLocale } from "@/lib/i18n/get-locale";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { db } from "@/lib/db";
import { orders, manufacturers } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { ManufacturerSidebar } from "./sidebar";

export default async function ManufacturerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const session = await getManufacturerSession();

  // If no session, render children without sidebar (login/register pages)
  // Middleware handles redirecting unauthenticated users away from protected routes
  if (!session) {
    return (
      <LocaleProvider locale={locale}>
        {children}
      </LocaleProvider>
    );
  }

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });

  if (!manufacturer) {
    return (
      <LocaleProvider locale={locale}>
        {children}
      </LocaleProvider>
    );
  }

  // Non-active manufacturers get layout without order count data
  if (manufacturer.status !== "active") {
    return (
      <LocaleProvider locale={locale}>
        <div className="min-h-screen bg-gray-50 flex">
          <ManufacturerSidebar newAssignmentCount={0} />
          <main className="flex-1 overflow-auto text-gray-900">
            {children}
          </main>
        </div>
      </LocaleProvider>
    );
  }

  // Count orders with status 'assigned' for this manufacturer
  const [assignedCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      sql`${orders.manufacturerId} = ${session.manufacturerId} AND ${orders.manufacturerStatus} = 'assigned'`
    );

  return (
    <LocaleProvider locale={locale}>
      <div className="min-h-screen bg-gray-50 flex">
        <ManufacturerSidebar
          newAssignmentCount={assignedCount.count}
        />
        <main className="flex-1 overflow-auto text-gray-900">
          {children}
        </main>
      </div>
    </LocaleProvider>
  );
}
