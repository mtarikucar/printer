import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { confirmDigitalOrder } from "@/lib/services/digital-order";
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
    await confirmDigitalOrder(id, locale);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Digital order confirmation failed:", error);
    return NextResponse.json(
      { error: d["api.digital.confirmFailed"] },
      { status: 500 }
    );
  }
}
