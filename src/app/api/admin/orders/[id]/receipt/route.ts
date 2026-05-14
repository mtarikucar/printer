import { NextRequest, NextResponse } from "next/server";
import { extname } from "path";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orderDrafts, orders } from "@/lib/db/schema";
import { getFileBuffer } from "@/lib/services/storage";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

/**
 * `id` here is either an order id (post-payment) or a draft id (pre-payment review).
 * Admin can view either.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Try draft first (admins review unpaid dekonts there).
  let receiptKey: string | null = null;
  const draft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.id, id),
    columns: { bankTransferReceiptKey: true },
  });
  if (draft?.bankTransferReceiptKey) {
    receiptKey = draft.bankTransferReceiptKey;
  } else {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
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
