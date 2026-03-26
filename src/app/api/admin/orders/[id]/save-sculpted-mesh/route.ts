import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, generationAttempts, adminActions } from "@/lib/db/schema";
import { saveFile, getPublicUrl } from "@/lib/services/storage";
import { nanoid } from "nanoid";
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

  const { id: orderId } = await params;

  // Parse multipart form data
  const formData = await request.formData();
  const glbFile = formData.get("glb") as File | null;
  const generationId = formData.get("generationId") as string | null;

  if (!glbFile || !generationId) {
    return NextResponse.json(
      { error: "Missing glb file or generationId" },
      { status: 400 }
    );
  }

  // Verify order exists
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });
  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  // Only allow mesh editing on mutable statuses
  const editableStatuses = ["review", "approved"];
  if (!editableStatuses.includes(order.status)) {
    return NextResponse.json(
      { error: "Order is not in an editable state" },
      { status: 400 }
    );
  }

  // Verify generation belongs to this order
  const generation = await db.query.generationAttempts.findFirst({
    where: eq(generationAttempts.id, generationId),
  });
  if (!generation || generation.orderId !== orderId) {
    return NextResponse.json(
      { error: "Generation not found or does not belong to this order" },
      { status: 400 }
    );
  }

  // Enforce file size limit (50MB max for sculpted GLBs)
  const MAX_GLB_SIZE = 50 * 1024 * 1024;
  if (glbFile.size > MAX_GLB_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 50MB." },
      { status: 400 }
    );
  }

  // Save the sculpted GLB file
  const buffer = Buffer.from(await glbFile.arrayBuffer());

  // Validate GLB magic bytes (glTF = 0x67 0x6C 0x54 0x46)
  if (buffer.length < 4 || buffer[0] !== 0x67 || buffer[1] !== 0x6c || buffer[2] !== 0x54 || buffer[3] !== 0x46) {
    return NextResponse.json(
      { error: "Invalid GLB file" },
      { status: 400 }
    );
  }
  const filename = `sculpted-${nanoid()}.glb`;
  const fileKey = await saveFile(buffer, `models/${orderId}`, filename);
  const publicUrl = getPublicUrl(fileKey);

  // Update generation attempt with new GLB URL
  await db
    .update(generationAttempts)
    .set({
      outputGlbUrl: publicUrl,
      updatedAt: new Date(),
    })
    .where(eq(generationAttempts.id, generationId));

  // Log admin action
  await db.insert(adminActions).values({
    orderId,
    action: "edit",
    adminEmail: session.user.email,
    notes: "Mesh sculpted and saved via browser editor",
  });

  return NextResponse.json({ success: true, glbUrl: publicUrl });
}
