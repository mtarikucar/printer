import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerNotifications } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";

export async function GET() {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const rows = await db.query.manufacturerNotifications.findMany({
    where: eq(manufacturerNotifications.manufacturerId, session.manufacturerId),
    orderBy: [desc(manufacturerNotifications.createdAt)],
    limit: 100,
  });

  const unreadCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(manufacturerNotifications)
    .where(
      and(
        eq(manufacturerNotifications.manufacturerId, session.manufacturerId),
        sql`${manufacturerNotifications.readAt} IS NULL`
      )
    );

  return NextResponse.json({
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      subject: n.subject,
      body: n.body,
      orderId: n.orderId,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount: unreadCountRow[0]?.count ?? 0,
  });
}

export async function POST(request: NextRequest) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (body.action === "mark_all_read") {
    await db
      .update(manufacturerNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(manufacturerNotifications.manufacturerId, session.manufacturerId),
          sql`${manufacturerNotifications.readAt} IS NULL`
        )
      );
  } else if (body.action === "mark_read" && typeof body.id === "string") {
    await db
      .update(manufacturerNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(manufacturerNotifications.id, body.id),
          eq(manufacturerNotifications.manufacturerId, session.manufacturerId)
        )
      );
  }
  return NextResponse.json({ success: true });
}
