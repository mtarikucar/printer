import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { confirmGiftCard } from "@/lib/services/gift-card";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: d["api.auth.unauthorized"] }, { status: 401 });
  }

  const { id } = await params;

  try {
    await confirmGiftCard(id, locale);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Gift card confirmation failed:", error);
    return NextResponse.json(
      { error: d["api.giftCard.confirmFailed"] },
      { status: 500 }
    );
  }
}
