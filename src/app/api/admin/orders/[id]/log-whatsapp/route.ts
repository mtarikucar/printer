import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions, adminMessages } from "@/lib/db/schema";
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
    body: string;
    templateKey?: string;
  };

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
  });

  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  if (!body.body || !body.body.trim()) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  await db.insert(adminMessages).values({
    orderId: id,
    channel: "whatsapp",
    body: body.body,
    templateKey: body.templateKey,
    adminEmail: session.user.email,
  });

  await db.insert(adminActions).values({
    orderId: id,
    action: "message_whatsapp",
    adminEmail: session.user.email,
  });

  return NextResponse.json({ success: true });
}
