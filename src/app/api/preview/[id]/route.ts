import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { id } = await params;

  // Preview ID is a UUID — unguessable, so no auth required for polling
  const preview = await db.query.previews.findFirst({
    where: eq(previews.id, id),
  });

  if (!preview) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  // Stale "generating" detection — if older than 5 minutes, mark as failed
  if (preview.status === "generating") {
    const ageMs = Date.now() - new Date(preview.createdAt).getTime();
    if (ageMs > 5 * 60 * 1000) {
      const timedOutMessage = d["create.preview.timedOut"];
      await db
        .update(previews)
        .set({
          status: "failed",
          errorMessage: timedOutMessage,
          updatedAt: new Date(),
        })
        .where(eq(previews.id, id));

      return NextResponse.json({
        status: "failed",
        glbUrl: preview.glbUrl,
        errorMessage: timedOutMessage,
        createdAt: preview.createdAt,
        photoKey: preview.photoKey,
      });
    }
  }

  return NextResponse.json({
    status: preview.status,
    glbUrl: preview.glbUrl,
    errorMessage: preview.errorMessage,
    createdAt: preview.createdAt,
    photoKey: preview.photoKey,
  });
}
