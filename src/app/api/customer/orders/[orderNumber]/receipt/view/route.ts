import { NextRequest, NextResponse } from "next/server";
import { extname } from "path";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts, orders } from "@/lib/db/schema";
import { getFileBuffer } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

/**
 * View the dekont uploaded for a customer's draft / order.
 * The `orderNumber` param matches either an active draft reference (pre-payment) or a
 * confirmed order number (post-payment; same string).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const { orderNumber } = await params;

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Try the active draft first (uploads happen against drafts).
  let receiptKey: string | null = null;

  const draft = await db.query.orderDrafts.findFirst({
    where: and(
      eq(orderDrafts.reference, orderNumber),
      eq(orderDrafts.userId, session.userId)
    ),
    columns: { bankTransferReceiptKey: true },
  });
  if (draft?.bankTransferReceiptKey) {
    receiptKey = draft.bankTransferReceiptKey;
  } else {
    // Confirmed order — look up the linked draft for the receipt.
    const order = await db.query.orders.findFirst({
      where: and(
        eq(orders.orderNumber, orderNumber),
        eq(orders.userId, session.userId)
      ),
      columns: { draftId: true },
    });
    if (order?.draftId) {
      const linked = await db.query.orderDrafts.findFirst({
        where: eq(orderDrafts.id, order.draftId),
        columns: { bankTransferReceiptKey: true },
      });
      if (linked?.bankTransferReceiptKey) {
        receiptKey = linked.bankTransferReceiptKey;
      }
    }
  }

  if (!receiptKey) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  try {
    const buffer = await getFileBuffer(receiptKey);
    const ext = extname(receiptKey).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
}
