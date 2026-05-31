import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();

  if ("response" in a) return a.response;

  const { id } = await params;

  const [manufacturer] = await db
    .update(manufacturers)
    .set({ status: "active", updatedAt: new Date() })
    .where(
      and(
        eq(manufacturers.id, id),
        inArray(manufacturers.status, ["pending_approval", "suspended"])
      )
    )
    .returning();

  if (!manufacturer) {
    return NextResponse.json(
      { error: "Manufacturer not found or already active" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  return NextResponse.json({ success: true });
}
