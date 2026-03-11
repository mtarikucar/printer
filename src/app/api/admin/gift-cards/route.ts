import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { giftCards } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cards = await db
    .select()
    .from(giftCards)
    .orderBy(desc(giftCards.createdAt));

  return NextResponse.json({ giftCards: cards });
}
