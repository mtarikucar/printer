import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import { getPreviewGenerationQueue } from "@/lib/queue/queues";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const generateSchema = z.object({
  photoKey: z.string().min(1),
  figurineSize: z.enum(["kucuk", "orta", "buyuk"]),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    const session = await getSessionUser();

    const body = await request.json();
    const validated = generateSchema.parse(body);
    const photoUrl = getPublicUrl(validated.photoKey);

    const [preview] = await db
      .insert(previews)
      .values({
        userId: session?.userId ?? null,
        photoKey: validated.photoKey,
        photoUrl,
        figurineSize: validated.figurineSize,
        status: "generating",
      })
      .returning();

    await getPreviewGenerationQueue().add("generate-preview", {
      previewId: preview.id,
      imageUrl: photoUrl,
      photoKey: validated.photoKey,
    });

    return NextResponse.json({ previewId: preview.id });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("Preview generation request failed:", error);
    return NextResponse.json(
      { error: d["api.order.createFailed"] },
      { status: 500 }
    );
  }
}
