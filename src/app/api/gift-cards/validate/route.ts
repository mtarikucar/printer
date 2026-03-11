import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/services/customer-auth";
import { validateGiftCard } from "@/lib/services/gift-card";
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

    const { code } = await request.json();
    if (!code) {
      return NextResponse.json({ error: d["validator.giftCard.codeRequired"] }, { status: 400 });
    }

    const result = await validateGiftCard(code);

    if (!result.valid) {
      const errorKey = `giftCard.error.${result.error}` as keyof typeof d;
      return NextResponse.json({ error: d[errorKey] || d["common.error"] }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      card: result.card,
    });
  } catch (error) {
    console.error("Gift card validation failed:", error);
    return NextResponse.json(
      { error: d["common.error"] },
      { status: 500 }
    );
  }
}
