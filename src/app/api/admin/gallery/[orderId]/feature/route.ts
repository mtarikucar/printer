import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { setGalleryFeatured } from "@/lib/services/gallery-review";

const schema = z.object({ featured: z.boolean() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 }
    );
  }

  const result = await setGalleryFeatured({
    orderId,
    adminEmail: a.session.user.email,
    featured: parsed.data.featured,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ success: true, featured: parsed.data.featured });
}
