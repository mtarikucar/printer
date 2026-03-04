import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { id } = await params;

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: d["api.auth.required"] }, { status: 401 });
  }

  const preview = await db.query.previews.findFirst({
    where: and(eq(previews.id, id), eq(previews.userId, session.userId)),
  });

  if (!preview) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  return NextResponse.json({
    status: preview.status,
    glbUrl: preview.glbUrl,
    errorMessage: preview.errorMessage,
    createdAt: preview.createdAt,
  });
}
