import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { uploadedModels } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { sendEmail } from "@/lib/services/email";
import { notifyCustomer } from "@/lib/services/customer-notifications";

export const runtime = "nodejs";

// Admin sets/confirms a price for an uploaded model that couldn't be
// auto-priced, flips it to `quoted`, and notifies the customer (in-app for a
// known user + email with a /quote/[id] accept link).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const priceKurus = Math.round(Number(body.priceKurus));
  if (!Number.isFinite(priceKurus) || priceKurus < 100) {
    return NextResponse.json({ error: "invalid_price" }, { status: 400 });
  }

  const row = await db.query.uploadedModels.findFirst({
    where: eq(uploadedModels.id, id),
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db
    .update(uploadedModels)
    .set({
      quotedPriceKurus: priceKurus,
      quoteStatus: "quoted",
      quotedByEmail: admin.session.user.email,
      quotedAt: new Date(),
      quoteExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(uploadedModels.id, id));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const link = `${appUrl}/quote/${id}`;
  const priceTRY = (priceKurus / 100).toLocaleString("tr-TR");

  if (row.userId) {
    await notifyCustomer({
      userId: row.userId,
      type: "upload_quote_ready",
      title: "3D model baskı teklifin hazır",
      body: `Yüklediğin "${row.fileName}" modeli için fiyat: ₺${priceTRY}.`,
    });
  }
  if (row.contactEmail) {
    await sendEmail({
      type: "admin_custom",
      to: row.contactEmail,
      orderNumber: id.slice(0, 8),
      customerName: "",
      customSubject: "3D model baskı teklifin hazır",
      customBody: `Yüklediğin "${row.fileName}" modeli için baskı fiyatı: ₺${priceTRY}.\n\nSiparişe çevirmek ve ödemek için: ${link}\n\nTeklif ${expiresAt.toLocaleDateString("tr-TR")} tarihine kadar geçerlidir.`,
    }).catch((e) => console.error("quote email failed (non-fatal)", e));
  }

  return NextResponse.json({ ok: true, quotedPriceKurus: priceKurus });
}
