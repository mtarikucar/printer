import Link from "next/link";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LanguageSwitcher } from "@/components/language-switcher";
import { db } from "@/lib/db";
import { orders, manufacturers, orderDrafts } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { AdminSidebar } from "./sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <AdminSidebar
        reviewCount={reviewCount.count}
        pendingManufacturerCount={pendingMfgCount.count}
        draftReviewCount={draftReviewCount.count}
      />
      <main className="flex-1 overflow-auto text-gray-900">{children}</main>
    </div>
  );
}
