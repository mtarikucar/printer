import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/services/customer-auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createPurchaseGiftCardSchema } from "@/lib/validators/gift-card";
import { purchaseGiftCard } from "@/lib/services/gift-card";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: d["api.auth.required"] }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    if (!user) {
      return NextResponse.json({ error: d["api.auth.userNotFound"] }, { status: 401 });
    }

    const body = await request.json();
    const validated = createPurchaseGiftCardSchema(locale).parse(body);

    const { card, whatsappUrl } = await purchaseGiftCard({
      theme: validated.theme,
      amountKurus: validated.amountKurus,
      buyerUserId: user.id,
      buyerEmail: user.email,
      buyerName: user.fullName,
      recipientEmail: validated.recipientEmail || undefined,
      recipientName: validated.recipientName || undefined,
      recipientMessage: validated.recipientMessage || undefined,
    });

    return NextResponse.json({
      code: card.code,
      whatsappUrl,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("Gift card creation failed:", error);
    return NextResponse.json(
      { error: d["api.giftCard.createFailed"] },
      { status: 500 }
    );
  }
}
