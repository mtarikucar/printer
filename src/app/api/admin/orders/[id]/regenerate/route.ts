import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, orderPhotos, adminActions } from "@/lib/db/schema";
import { getAiGenerationQueue } from "@/lib/queue/queues";
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

  const photo = await db.query.orderPhotos.findFirst({
    where: eq(orderPhotos.orderId, id),
  });

  if (!photo) {
    return NextResponse.json({ error: d["api.order.noPhoto"] }, { status: 400 });
  }

  // Reset order status and increment retry count
  await db
    .update(orders)
    .set({
      status: "paid",
      failureReason: null,
      retryCount: order.retryCount + 1,
      adminNotes: body.notes,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, id));

  await db.insert(adminActions).values({
    orderId: id,
    action: "regenerate",
    adminEmail: session.user.email,
    notes: body.notes,
  });

  // Re-enqueue AI generation
  await getAiGenerationQueue().add("regenerate", {
    orderId: id,
    imageUrl: photo.originalUrl,
  });

  return NextResponse.json({ success: true });
}
