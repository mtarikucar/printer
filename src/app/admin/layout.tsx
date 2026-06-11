import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { orders, manufacturers, orderDrafts, products } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { AdminSidebar } from "./sidebar";
import { AdminRealtimeShell } from "./realtime-shell";
import { auth } from "@/lib/auth/config";

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

  // Count orders needing review
  const [reviewCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(sql`${orders.status} = 'review'`);

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

  // Count orders awaiting QC photo approval.
  const [qcPendingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(sql`${orders.manufacturerStatus} = 'qc_pending'`);

  // Count products awaiting moderation.
  const [pendingProductCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(sql`${products.status} = 'pending_review'`);

  return (
    <AdminRealtimeShell>
      <div className="min-h-screen bg-gray-50 flex">
        <AdminSidebar
          reviewCount={reviewCount.count}
          pendingManufacturerCount={pendingMfgCount.count}
          pendingProductCount={pendingProductCount.count}
          draftReviewCount={draftReviewCount.count}
          qcPendingCount={qcPendingCount.count}
        />
        <main className="flex-1 overflow-auto text-gray-900">{children}</main>
      </div>
    </AdminRealtimeShell>
  );
}
