import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";

const bodySchema = z.object({ url: z.string().min(1) });

// Customer picked + APPROVED one of the fal.ai image variations. This is the
// image the order is placed against; there is no automatic 3D — the admin
// sculpts and uploads the model after payment. The preview id is an unguessable
// UUID, so no extra auth (matches the poll GET).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { url } = bodySchema.parse(await request.json());

  const preview = await db.query.previews.findFirst({
    where: eq(previews.id, id),
  });
  if (!preview) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (preview.status !== "styled") {
    return NextResponse.json({ error: "not selectable" }, { status: 409 });
  }
  if (!preview.styledImageUrls?.includes(url)) {
    return NextResponse.json({ error: "invalid selection" }, { status: 400 });
  }

  await db
    .update(previews)
    .set({
      selectedStyledImageUrl: url,
      status: "approved",
      updatedAt: new Date(),
    })
    .where(eq(previews.id, id));

  return NextResponse.json({ status: "approved", selectedStyledImageUrl: url });
}
