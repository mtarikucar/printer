import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerNotifications } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";

// Mark all of the customer's unread notifications read.
export async function POST() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db
    .update(customerNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(customerNotifications.userId, session.userId),
        isNull(customerNotifications.readAt)
      )
    );
  return NextResponse.json({ success: true });
}
