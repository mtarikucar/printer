import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const messageSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  orderId: z.string().uuid().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

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
      return NextResponse.json({ error: "Mesaj gönderilemedi. Sayfayı yenileyip tekrar deneyin; sorun sürerse sunucu günlüklerine bakın." }, { status: 500 });
    }
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/manufacturers/[id]/message", ADMIN_ACTION_FAILED_ERROR);
  }
}
