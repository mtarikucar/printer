import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import {
  getPreviewGenerationQueue,
  type PreviewGenerationJobData,
} from "@/lib/queue/queues";

// Bound regenerate cost: each round is N image-to-image calls. Customer gets the
// initial round + up to 3 retries.
const MAX_VARIATION_ROUNDS = 4;

// Customer disliked both variations → re-run Stage A with a fresh round.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const preview = await db.query.previews.findFirst({
    where: eq(previews.id, id),
  });
  if (!preview) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (preview.status !== "styled") {
    return NextResponse.json({ error: "not regenerable" }, { status: 409 });
  }
  if ((preview.variationRounds ?? 1) >= MAX_VARIATION_ROUNDS) {
    return NextResponse.json(
      { error: "limit reached", code: "regenerate_cap" },
      { status: 429 },
    );
  }

  await db
    .update(previews)
    .set({
      status: "generating",
      styledImageUrls: null,
      variationRounds: (preview.variationRounds ?? 1) + 1,
      updatedAt: new Date(),
    })
    .where(eq(previews.id, id));

  await getPreviewGenerationQueue().add("generate-variations", {
    previewId: id,
    imageUrl: preview.photoUrl,
    photoKey: preview.photoKey,
    photoKeys: preview.photoKeys ?? undefined,
    style: preview.style,
    modifiers: preview.modifiers ?? [],
  } satisfies PreviewGenerationJobData);

  return NextResponse.json({ status: "generating" });
}
