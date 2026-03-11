import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getStlBuffer } from "@/lib/services/digital-order";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: d["api.auth.required"] }, { status: 401 });
    }

    const { id } = await params;
    const { buffer, filename } = await getStlBuffer(id, session.userId);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("STL download failed:", error);
    if (error.message === "Digital order not found") {
      return NextResponse.json({ error: d["api.digital.notFound"] }, { status: 404 });
    }
    if (error.message === "Digital order not ready") {
      return NextResponse.json({ error: d["api.digital.notReady"] }, { status: 400 });
    }
    return NextResponse.json({ error: d["api.digital.notFound"] }, { status: 500 });
  }
}
