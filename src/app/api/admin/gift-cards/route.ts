import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { giftCards } from "@/lib/db/schema";
import { desc, eq, and, inArray } from "drizzle-orm";
import { createAdminGiftCardSchema } from "@/lib/validators/gift-card";
import { createGiftCard } from "@/lib/services/gift-card";

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

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const validated = createAdminGiftCardSchema().parse(body);

    const amountKurus = Math.round(validated.amountTL * 100);

    const { card } = await createGiftCard({
      code: validated.code || undefined,
      amountKurus,
      note: validated.note || undefined,
      recipientName: validated.recipientName || undefined,
      recipientEmail: validated.recipientEmail || undefined,
      expirationDays: validated.expirationDays,
      maxRedemptions: validated.maxRedemptions,
    });

    return NextResponse.json({ card });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    if (error?.code === "23505" && error?.constraint_name?.includes("code")) {
      return NextResponse.json({ error: "Bu kod zaten kullanılıyor" }, { status: 409 });
    }
    console.error("Gift card creation failed:", error);
    return NextResponse.json(
      { error: "Gift card creation failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const patchSchema = z.object({ id: z.string().uuid(), action: z.enum(["deactivate"]) });
    const { id, action } = patchSchema.parse(await request.json());

    if (action === "deactivate") {
      const [updated] = await db
        .update(giftCards)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(giftCards.id, id),
            inArray(giftCards.status, ["active", "partially_used"])
          )
        )
        .returning();

      if (!updated) {
        return NextResponse.json({ error: "Not found or already inactive" }, { status: 404 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Gift card update failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
