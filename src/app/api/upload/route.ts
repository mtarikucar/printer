import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { saveFile } from "@/lib/services/storage";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { verifyTurnstileToken } from "@/lib/services/turnstile";
import { validateImageMagicBytes } from "@/lib/services/file-validation";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    const formData = await request.formData();

    // Turnstile verification
    const turnstileToken = formData.get("turnstileToken") as string | null;
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for") ??
      "unknown";

    if (!(await verifyTurnstileToken(turnstileToken ?? "", ip))) {
      return NextResponse.json(
        { error: d["api.turnstile.failed"] },
        { status: 403 }
      );
    }

    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: d["api.upload.noFile"] }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: d["api.upload.tooLarge"] },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate actual file content via magic bytes (not client-supplied MIME)
    const detectedType = validateImageMagicBytes(buffer);
    if (!detectedType || !["image/jpeg", "image/png"].includes(detectedType)) {
      return NextResponse.json(
        { error: d["api.upload.invalidFormat"] },
        { status: 400 }
      );
    }

    const ext = detectedType === "image/png" ? "png" : "jpg";
    const filename = `${nanoid()}.${ext}`;
    const key = await saveFile(buffer, "photos", filename);

    return NextResponse.json({ key });
  } catch (error: any) {
    console.error("Upload failed:", error);
    return NextResponse.json(
      { error: d["api.upload.failed"] },
      { status: 500 }
    );
  }
}
