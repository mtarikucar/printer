import { getLocale } from "@/lib/i18n/get-locale";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { db } from "@/lib/db";
import { orders, manufacturers } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { ManufacturerSidebar } from "./sidebar";
import { ManufacturerRealtimeShell } from "./realtime-shell";
import { PanelShell } from "@/components/panel-shell";
import { VerificationGate } from "./verification-gate";

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

  // Conditionally-approved manufacturers see only the printer-photo upload gate
  if (manufacturer.status === "conditionally_approved") {
    return (
      <LocaleProvider locale={locale}>
        <VerificationGate
          companyName={manufacturer.companyName}
          alreadyUploaded={manufacturer.printerPhotoUploadedAt != null}
        />
      </LocaleProvider>
    );
  }

  // Non-active manufacturers get layout without order count data
  if (manufacturer.status !== "active") {
    return (
      <LocaleProvider locale={locale}>
        <ManufacturerRealtimeShell>
          <PanelShell
            title="Figurunica Üretici"
            sidebar={<ManufacturerSidebar newAssignmentCount={0} />}
          >
            {children}
          </PanelShell>
        </ManufacturerRealtimeShell>
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
      <ManufacturerRealtimeShell>
        <PanelShell
          title="Figurunica Üretici"
          sidebar={
            <ManufacturerSidebar newAssignmentCount={assignedCount.count} />
          }
        >
          {children}
        </PanelShell>
      </ManufacturerRealtimeShell>
    </LocaleProvider>
  );
}
