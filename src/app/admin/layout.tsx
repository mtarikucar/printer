import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LanguageSwitcher } from "@/components/language-switcher";
import { db } from "@/lib/db";
import { orders, manufacturers, orderDrafts } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { AdminSidebar } from "./sidebar";
import { auth } from "@/lib/auth/config";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  const locale = await getLocale();
  const d = getDictionary(locale);

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

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <AdminSidebar
        reviewCount={reviewCount.count}
        pendingManufacturerCount={pendingMfgCount.count}
        draftReviewCount={draftReviewCount.count}
        qcPendingCount={qcPendingCount.count}
      />
      <main className="flex-1 overflow-auto text-gray-900">{children}</main>
    </div>
  );
}
