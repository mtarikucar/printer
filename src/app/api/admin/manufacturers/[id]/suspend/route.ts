import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [manufacturer] = await db
    .update(manufacturers)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(
      and(
        eq(manufacturers.id, id),
        eq(manufacturers.status, "active")
      )
    )
    .returning();

  if (!manufacturer) {
    return NextResponse.json(
      { error: "Manufacturer not found or not active" },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}
