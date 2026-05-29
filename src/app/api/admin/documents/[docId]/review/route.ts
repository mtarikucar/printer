import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturerDocuments } from "@/lib/db/schema";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { docId } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const [row] = await db
    .update(manufacturerDocuments)
    .set({
      status: parsed.data.action === "approve" ? "approved" : "rejected",
      reviewNote: parsed.data.note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(manufacturerDocuments.id, docId))
    .returning({ id: manufacturerDocuments.id });

  if (!row) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
