import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";

const schema = z.object({ action: z.enum(["approve", "reject"]) });

// Admin approves/rejects a pending IBAN change. Approve promotes pendingIban to
// the live iban; reject discards it. Either way the review gate clears.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const mfr = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, id),
    columns: { pendingIban: true, ibanReviewStatus: true },
  });
  if (!mfr) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (mfr.ibanReviewStatus !== "pending") {
    return NextResponse.json({ error: "No pending IBAN change" }, { status: 400 });
  }

  if (parsed.data.action === "approve") {
    await db
      .update(manufacturers)
      .set({
        iban: mfr.pendingIban,
        pendingIban: null,
        ibanReviewStatus: "none",
        updatedAt: new Date(),
      })
      .where(eq(manufacturers.id, id));
  } else {
    await db
      .update(manufacturers)
      .set({ pendingIban: null, ibanReviewStatus: "none", updatedAt: new Date() })
      .where(eq(manufacturers.id, id));
  }

  return NextResponse.json({ success: true });
}
