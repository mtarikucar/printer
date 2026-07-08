import { getLocale } from "@/lib/i18n/get-locale";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { db } from "@/lib/db";
import { orders, painters, painterNotifications } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getPainterSession } from "@/lib/services/painter-auth";
import { PainterSidebar } from "./sidebar";
import { PanelShell } from "@/components/panel-shell";

export default async function PainterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const session = await getPainterSession();

  // If no session, render children without sidebar (login/register pages).
  // Middleware handles redirecting unauthenticated users away from protected
  // routes.
  if (!session) {
    return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
  }

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
  });

  if (!painter) {
    return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
  }

  // Non-active painters (pending_approval, conditionally_approved, suspended,
  // rejected) get the shell without job/notification counts — their dashboard
  // page renders the appropriate status message.
  if (painter.status !== "active") {
    return (
      <LocaleProvider locale={locale}>
        <PanelShell
          title="Figurunica Boyama"
          sidebar={
            <PainterSidebar newJobCount={0} unreadNotificationCount={0} />
          }
        >
          {children}
        </PanelShell>
      </LocaleProvider>
    );
  }

  // New jobs: orders handed off to this painter but not yet accepted.
  const [assignedCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      sql`${orders.painterId} = ${session.painterId} AND ${orders.painterStatus} = 'assigned'`
    );

  // Unread admin/system notifications for this painter.
  const [unreadCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(painterNotifications)
    .where(
      sql`${painterNotifications.painterId} = ${session.painterId} AND ${painterNotifications.readAt} IS NULL`
    );

  return (
    <LocaleProvider locale={locale}>
      <PanelShell
        title="Figurunica Boyama"
        sidebar={
          <PainterSidebar
            newJobCount={assignedCount.count}
            unreadNotificationCount={unreadCount.count}
          />
        }
      >
        {children}
      </PanelShell>
    </LocaleProvider>
  );
}
