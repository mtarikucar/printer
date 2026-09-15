import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { orders, manufacturers, orderDrafts, products, workshopRequests, painters, waConversations } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { AdminSidebar } from "./sidebar";
import { AdminRealtimeShell } from "./realtime-shell";
import { PanelShell } from "@/components/panel-shell";
import { auth } from "@/lib/auth/config";
import {
  AWAITING_MANUFACTURER,
  NOT_REFUNDED,
} from "@/lib/services/admin-order-sql";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout wraps EVERY /admin/* route, including /admin/login. We must
  // NOT run the auth gate (or the sidebar's DB count queries) for the login
  // page: redirecting an unauthenticated /admin/login back to /admin/login
  // re-enters this layout and redirects again — an infinite loop that hides
  // the login form. Middleware forwards the path via x-pathname so we can
  // detect the login page and render it bare (no shell, no gate, no queries).
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  // Defense-in-depth: middleware already gates /admin/*, but if it's ever
  // mis-configured the layout would otherwise run DB queries and leak counts
  // in HTML. Verify the role claim here too.
  // (We use `auth()` directly here rather than `requireAdmin()` because this
  // is an RSC layout, not an API route — `requireAdmin` returns a
  // NextResponse-or-session union shaped for API handlers.)
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") {
    redirect("/admin/login");
  }

  // The Orders badge counts work waiting on the admin, in two disjoint parts.
  // Refunded orders are left out of both, because every forward action on a
  // refunded order is refused, the model upload included.
  //  1. awaiting_model: a 3D model for the admin to upload.
  //  2. AWAITING_MANUFACTURER: paid work with no manufacturer (approved
  //     custom/upload orders, and paid marketplace orders). This is the same
  //     definition as the dashboard's "Atanmamış" card, the manufacturing
  //     queue's first section and the "Üretici bekliyor" bucket. The badge
  //     used to count only the marketplace half, refunds included, so the
  //     four numbers disagreed.
  // awaiting_model is neither `approved` nor `paid`, so no order counts twice.
  const [awaitingModelCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(sql`${orders.status} = 'awaiting_model' AND ${NOT_REFUNDED}`);

  // The Toplu üretim badge is the bulk subset of part 2 (assignable bulk
  // orders). Both come from one scan.
  const [awaitingManufacturerCounts] = await db
    .select({
      all: sql<number>`count(*)::int`,
      bulk: sql<number>`count(*) FILTER (WHERE ${orders.isBulk})::int`,
    })
    .from(orders)
    .where(AWAITING_MANUFACTURER);

  // Count pending manufacturer approvals
  const [pendingMfgCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(manufacturers)
    .where(sql`${manufacturers.status} = 'pending_approval'`);

  // Count drafts awaiting manual receipt review.
  const [draftReviewCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orderDrafts)
    .where(sql`${orderDrafts.status} = 'awaiting_review'`);

  // Orders awaiting QC photo approval. Same predicate as the dashboard's
  // "QC Bekleyen" card and the /admin/qc-queue list this badge opens: a
  // refunded order is frozen, so its QC decision is not work. The refund
  // resets manufacturerStatus today, so only stale or legacy rows differ, but
  // the three numbers must not be able to disagree.
  const [qcPendingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(sql`${orders.manufacturerStatus} = 'qc_pending' AND ${NOT_REFUNDED}`);

  // Count products awaiting moderation.
  const [pendingProductCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(sql`${products.status} = 'pending_review'`);

  // Count new (unprocessed) workshop requests.
  const [workshopPendingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workshopRequests)
    .where(sql`${workshopRequests.status} = 'new'`);

  // Count painters awaiting approval.
  const [pendingPainterCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(painters)
    .where(sql`${painters.status} = 'pending_approval'`);

  // Painting jobs awaiting painter-QC review. Refunded orders are left out,
  // as in the /admin/painter-qc-queue list this badge opens (same reason as
  // the QC badge above).
  const [painterQcPendingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(sql`${orders.painterStatus} = 'qc_pending' AND ${NOT_REFUNDED}`);

  // WhatsApp threads where the customer wrote after our last outbound message.
  // Nobody marks a thread read here, so "waiting on us" is the honest badge.
  const [waAwaitingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(waConversations)
    .where(
      sql`${waConversations.mode} <> 'blocked'
        AND ${waConversations.lastInboundAt} IS NOT NULL
        AND (${waConversations.lastOutboundAt} IS NULL
             OR ${waConversations.lastInboundAt} > ${waConversations.lastOutboundAt})`
    );

  return (
    <AdminRealtimeShell>
      <PanelShell
        title="Figurunica Admin"
        sidebar={
          <AdminSidebar
            awaitingModelCount={awaitingModelCount.count}
            awaitingManufacturerCount={awaitingManufacturerCounts.all}
            // Atama taraması ekranı tam olarak bu kümeyi listeler
            // (AWAITING_MANUFACTURER), o yüzden ikinci bir sorgu yok.
            assignmentSweepCount={awaitingManufacturerCounts.all}
            awaitingManufacturerBulkCount={awaitingManufacturerCounts.bulk}
            pendingManufacturerCount={pendingMfgCount.count}
            pendingProductCount={pendingProductCount.count}
            draftReviewCount={draftReviewCount.count}
            qcPendingCount={qcPendingCount.count}
            workshopPendingCount={workshopPendingCount.count}
            pendingPainterCount={pendingPainterCount.count}
            painterQcPendingCount={painterQcPendingCount.count}
            waAwaitingReplyCount={waAwaitingCount.count}
          />
        }
      >
        {children}
      </PanelShell>
    </AdminRealtimeShell>
  );
}
