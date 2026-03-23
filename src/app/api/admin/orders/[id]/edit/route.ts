import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions, TurkishAddress } from "@/lib/db/schema";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: d["api.auth.unauthorized"] }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as {
    adminNotes?: string;
    shippingAddress?: TurkishAddress;
  };

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
  });

  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const changedFields: string[] = [];

  if (body.adminNotes !== undefined) {
    updates.adminNotes = body.adminNotes;
    changedFields.push("adminNotes");
  }

  if (body.shippingAddress !== undefined) {
    updates.shippingAddress = body.shippingAddress;
    changedFields.push("shippingAddress");
  }

  if (changedFields.length > 0) {
    await db
      .update(orders)
      .set(updates)
      .where(eq(orders.id, id));
  }

  await db.insert(adminActions).values({
    orderId: id,
    action: "edit",
    adminEmail: session.user.email,
    notes: `Edited fields: ${changedFields.join(", ") || "none"}`,
  });

  return NextResponse.json({ success: true });
}
