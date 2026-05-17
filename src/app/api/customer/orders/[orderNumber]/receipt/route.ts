import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { saveFile, deleteFile } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getDekontOcrQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { RECEIPT_MAX_SIZE_BYTES } from "@/lib/config/payment";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

function detectReceiptType(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null {
  const img = validateImageMagicBytes(buffer);
  if (img) return img;
  if (
    buffer.length >= PDF_MAGIC.length &&
    PDF_MAGIC.every((b, i) => buffer[i] === b)
  ) {
    return "application/pdf";
  }
  return null;
}

function extForType(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

/**
 * `orderNumber` here is actually the draft reference (same string format pre- and post-promotion).
 * Receipts can only be uploaded against pending bank_transfer drafts.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { orderNumber } = await params;

  // Multipart/form-data is a "simple" content type, so sameSite=lax cookies
  // can be sent on cross-site form submissions — an attacker site could host
  // a hidden <form action="…/receipt"> and trick the customer into uploading
  // attacker-chosen content as their dekont. Enforce same-origin via Origin
  // (preferred) or Referer header.
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const expectedHost = request.headers.get("host");
  const isSameOrigin = (() => {
    if (origin) {
      try {
        return new URL(origin).host === expectedHost;
      } catch {
        return false;
      }
    }
    if (referer) {
      try {
        return new URL(referer).host === expectedHost;
      } catch {
        return false;
      }
    }
    return false;
  })();
  if (!isSameOrigin) {
    return NextResponse.json(
      { error: d["api.receipt.crossOrigin"] },
      { status: 403 }
    );
  }

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  const draft = await db.query.orderDrafts.findFirst({
    where: and(
      eq(orderDrafts.reference, orderNumber),
      eq(orderDrafts.userId, session.userId)
    ),
  });
  if (!draft) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }
  if (draft.paymentMethod !== "bank_transfer") {
    return NextResponse.json(
      { error: d["api.receipt.notBankTransfer"] },
      { status: 400 }
    );
  }
  if (draft.status !== "pending" && draft.status !== "awaiting_review") {
    return NextResponse.json(
      { error: d["api.receipt.notUploadable"] },
      { status: 400 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: d["api.upload.noFile"] }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: d["api.upload.noFile"] }, { status: 400 });
  }
  if (file.size > RECEIPT_MAX_SIZE_BYTES) {
    return NextResponse.json({ error: d["api.upload.tooLarge"] }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectReceiptType(buffer);
  if (!detected) {
    return NextResponse.json(
      { error: d["api.upload.invalidFormat"] },
      { status: 400 }
    );
  }

  const filename = `${nanoid()}.${extForType(detected)}`;
  const key = await saveFile(buffer, `receipts/${draft.id}`, filename);

  // If the customer is replacing an earlier receipt, delete the stale file
  // from disk so we don't accumulate orphans. Best-effort — a failure here
  // doesn't block the upload.
  const previousKey = draft.bankTransferReceiptKey;
  if (previousKey && previousKey !== key) {
    deleteFile(previousKey).catch((err) => {
      console.warn(
        `receipt: failed to delete previous file ${previousKey} for draft ${draft.id}`,
        err
      );
    });
  }

  await db
    .update(orderDrafts)
    .set({
      bankTransferReceiptKey: key,
      bankTransferReceiptUploadedAt: new Date(),
      receiptOcrText: null,
      receiptOcrParsed: null,
      receiptOcrConfidence: null,
      receiptOcrFailureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(orderDrafts.id, draft.id));

  // Hand off to the OCR worker — keeps the customer's response fast (Tesseract is CPU-bound).
  await getDekontOcrQueue().add(
    "ocr-receipt",
    { draftId: draft.id, receiptKey: key },
    { jobId: `ocr-${draft.id}-${Date.now()}` }
  );

  return NextResponse.json({
    success: true,
    receiptUrl: `/api/customer/orders/${draft.reference}/receipt/view`,
    status: "scanning",
  });
}
