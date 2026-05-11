import { NextRequest, NextResponse } from "next/server";
import { extname } from "path";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getFileBuffer } from "@/lib/services/storage";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { bankTransferReceiptKey: true },
  });

  if (!order?.bankTransferReceiptKey) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  try {
    const buffer = await getFileBuffer(order.bankTransferReceiptKey);
    const ext = extname(order.bankTransferReceiptKey).toLowerCase();
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
