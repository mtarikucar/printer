import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import { normalizeFileUrl } from "@/lib/services/storage";
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
        // Only the GLB (the 3D preview viewer) is exposed. The print-ready
        // STL/OBJ are the PAID deliverable and must never be handed out here —
        // they're sold via the `digital_files` add-on and served through the
        // entitlement-gated /api/customer/orders/.../download endpoint.
        glbUrl: normalizeFileUrl(preview.glbUrl),
        errorMessage: timedOutMessage,
        createdAt: preview.createdAt,
        photoKey: preview.photoKey,
      });
    }
  }

  return NextResponse.json({
    status: preview.status,
    // GLB only — see note above; STL/OBJ are gated behind a paid order.
    glbUrl: normalizeFileUrl(preview.glbUrl),
    // Image-first flow: the 2D variations to choose from (status="styled") and
    // the chosen one. Normalized so the host is correct behind the proxy.
    styledImageUrls: (preview.styledImageUrls ?? []).map((u) => normalizeFileUrl(u)),
    selectedStyledImageUrl: normalizeFileUrl(preview.selectedStyledImageUrl),
    variationRounds: preview.variationRounds ?? 1,
    errorMessage: preview.errorMessage,
    createdAt: preview.createdAt,
    photoKey: preview.photoKey,
  });
}
