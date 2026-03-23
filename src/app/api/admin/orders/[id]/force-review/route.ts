import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
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
  const body = await request.json().catch(() => ({}));

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
  });

  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  if (!["paid", "generating", "processing_mesh"].includes(order.status)) {
    return NextResponse.json(
      { error: d["api.order.invalidStatusForRegenerate"] },
      { status: 400 }
    );
  }

  await db
    .update(orders)
    .set({ status: "review", updatedAt: new Date() })
    .where(eq(orders.id, id));

  await db.insert(adminActions).values({
    orderId: id,
    action: "edit",
    adminEmail: session.user.email,
    notes: body.notes || "Manually moved to review",
  });

  return NextResponse.json({ success: true });
}
