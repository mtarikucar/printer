import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { painterNotifications } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";

export async function GET() {
  const session = await getPainterSession();
  if (!session) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const rows = await db.query.painterNotifications.findMany({
    where: eq(painterNotifications.painterId, session.painterId),
    orderBy: [desc(painterNotifications.createdAt)],
    limit: 100,
  });
  const unreadCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(painterNotifications)
    .where(
      and(
        eq(painterNotifications.painterId, session.painterId),
        sql`${painterNotifications.readAt} IS NULL`
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
  const session = await getPainterSession();
  if (!session) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const actionSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("mark_all_read") }),
    z.object({ action: z.literal("mark_read"), id: z.string().uuid() }),
  ]);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action or notification id" }, { status: 400 });
  }
  if (parsed.data.action === "mark_all_read") {
    await db
      .update(painterNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(painterNotifications.painterId, session.painterId),
          sql`${painterNotifications.readAt} IS NULL`
        )
      );
  } else {
    await db
      .update(painterNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(painterNotifications.id, parsed.data.id),
          eq(painterNotifications.painterId, session.painterId)
        )
      );
  }
  return NextResponse.json({ success: true });
}
