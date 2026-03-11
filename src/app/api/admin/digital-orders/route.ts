import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { digitalOrders } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orders = await db
    .select()
    .from(digitalOrders)
    .orderBy(desc(digitalOrders.createdAt));

  return NextResponse.json({ digitalOrders: orders });
}
