import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { requireAdmin } from "@/lib/auth/require-admin";
import { saveFile, getPublicUrl } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import { UPLOAD_MAX_SIZE_BYTES } from "@/lib/config/upload";

/**
 * Admin photo upload for WhatsApp orders. The customer sends reference photos
 * over WhatsApp; the admin attaches them here while building the order. Mirrors
 * the public /api/upload (magic-byte validation, size cap, "photos" prefix,
 * signed URL) but gated by requireAdmin instead of Turnstile — the admin is
 * authenticated, so there is no bot-protection concern.
 */
export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Dosya bulunamadı." }, { status: 400 });
    }
    if (file.size > UPLOAD_MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: "Dosya boyutu en fazla 20MB olmalıdır." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedType = validateImageMagicBytes(buffer);
    if (!detectedType || !["image/jpeg", "image/png"].includes(detectedType)) {
      return NextResponse.json(
        { error: "Geçersiz görsel formatı (yalnızca JPG/PNG)." },
        { status: 400 }
      );
    }

    const ext = detectedType === "image/png" ? "png" : "jpg";
    const key = await saveFile(buffer, "photos", `${nanoid()}.${ext}`);
    return NextResponse.json({ key, previewUrl: getPublicUrl(key) });
  } catch (error) {
    console.error("Admin photo upload failed:", error);
    return NextResponse.json({ error: "Yükleme başarısız." }, { status: 500 });
  }
}
