import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";

const messageSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  orderId: z.string().uuid().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let parsed: z.infer<typeof messageSchema>;
  try {
    parsed = messageSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Validation failed" },
        { status: 400 }
      );
    }
    throw err;
  }

  try {
    const notificationId = await notifyManufacturer({
      manufacturerId: id,
      type: "admin_message",
      subject: parsed.subject,
      body: parsed.body,
      orderId: parsed.orderId,
    });
    return NextResponse.json({ success: true, notificationId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send failed";
    if (msg === "MANUFACTURER_NOT_FOUND") {
      return NextResponse.json({ error: "Manufacturer not found" }, { status: 404 });
    }
    console.error("Admin → manufacturer message failed:", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
