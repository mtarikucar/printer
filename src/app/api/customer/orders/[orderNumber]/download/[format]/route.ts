import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getFileBuffer, normalizeFileUrl } from "@/lib/services/storage";
import { latestModelFiles } from "@/lib/services/order-model";
import { modelFilesZipResponse } from "@/lib/services/model-file-download";
import { currentModelUrl } from "@/lib/config/order-model-presence";

/**
 * Customer download of the print-ready STL/OBJ for an order — the paid
 * `digital_files` deliverable. Gated like the manufacturer download route but
 * by CUSTOMER session + order ownership + payment + entitlement:
 *   1. logged-in customer (401)
 *   2. owns the order by orderNumber (404)
 *   3. payment succeeded AND order carries the `digital_files` upsell (403)
 * The bytes stream from the ADMIN-uploaded model (orders.model*), falling back
 * to a legacy succeeded generation attempt for historical orders, never via a
 * public URL. Note: the image-first flow produces STL only (no OBJ) — OBJ is
 * legacy-attempt-only.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string; format: string }> }
) {
  const { orderNumber, format } = await params;
  if (format !== "stl" && format !== "obj") {
    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  }

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.orderNumber, orderNumber),
      eq(orders.userId, session.userId)
    ),
    columns: {
      id: true,
      orderNumber: true,
      paymentStatus: true,
      upsells: true,
      modelUploadedAt: true,
      modelGlbKey: true,
      modelGlbUrl: true,
      modelStlKey: true,
      modelStlUrl: true,
    },
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputStlUrl: true, outputObjUrl: true },
        orderBy: desc(generationAttempts.createdAt),
        limit: 1,
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Entitlement: must have paid and bought the digital_files add-on.
  const entitled =
    order.paymentStatus === "succeeded" &&
    (order.upsells ?? []).includes("digital_files");
  if (!entitled) {
    return NextResponse.json(
      { error: "not_entitled", code: "not_entitled" },
      { status: 403 }
    );
  }

  // Multi-part model: when the current revision carries several STL parts the
  // customer gets them all in one ZIP. The single-file path below still serves
  // one-part and legacy orders exactly as before.
  if (format === "stl") {
    const { files } = await latestModelFiles(order.id);
    const stls = files.filter((f) => f.kind === "stl");
    if (stls.length > 1) {
      return modelFilesZipResponse(
        stls.map((f) => ({ key: f.fileKey, name: f.fileName })),
        `${order.orderNumber}-stl.zip`
      );
    }
  }

  const attempt = order.generationAttempts[0];
  // The legacy attempt's STL stands in only for an order with no model of its
  // own: after a GLB-only revision it is the superseded generated mesh, not the
  // print-ready file the customer paid for. The track page's stlReady applies
  // the same rule, so it never offers a download this then refuses.
  const rawUrl =
    format === "stl"
      ? currentModelUrl(order, "stl", attempt)
      : attempt?.outputObjUrl;
  const fileUrl = normalizeFileUrl(rawUrl ?? null);
  if (!fileUrl) {
    // Paid but the final file isn't ready yet (generation still running) or
    // this format wasn't produced.
    return NextResponse.json(
      { error: "not_ready", code: "not_ready" },
      { status: 409 }
    );
  }

  const keyMatch = fileUrl.match(/\/api\/files\/(.+)$/);
  if (!keyMatch) {
    return NextResponse.json({ error: "Invalid file reference" }, { status: 500 });
  }
  const fileKey = decodeURIComponent(keyMatch[1].split("?")[0]);

  try {
    const buffer = await getFileBuffer(fileKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${order.orderNumber}.${format}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    console.error("Customer digital download failed:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
