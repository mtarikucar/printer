import { NextRequest, NextResponse } from "next/server";
import { removeBackground } from "@/lib/services/background-removal";
import { rateLimit, extractClientIp } from "@/lib/services/rate-limit";
import { verifyTurnstileToken } from "@/lib/services/turnstile";
import { validateImageMagicBytes } from "@/lib/services/file-validation";

// Allow up to 5 minutes for model loading + inference on CPU
export const maxDuration = 300;

const MAX_SIZE = 15 * 1024 * 1024; // 15MB

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP to prevent DoS
    const ip = extractClientIp(request);
    const rl = rateLimit(`rmbg:${ip}`, 5, 10 * 60 * 1000); // 5 per 10 min
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const formData = await request.formData();

    // Turnstile verification
    const turnstileToken = formData.get("turnstileToken") as string | null;
    if (!(await verifyTurnstileToken(turnstileToken ?? "", ip))) {
      return NextResponse.json(
        { error: "Verification failed" },
        { status: 403 }
      );
    }

    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size: 15MB" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate actual file content via magic bytes
    const detectedType = validateImageMagicBytes(buffer);
    if (!detectedType) {
      return NextResponse.json(
        { error: "Invalid file type. Accepted: JPEG, PNG, WebP" },
        { status: 400 }
      );
    }

    const resultBuffer = await removeBackground(buffer);

    return new NextResponse(new Uint8Array(resultBuffer), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(resultBuffer.length),
      },
    });
  } catch (error) {
    console.error("Background removal failed:", error);
    return NextResponse.json(
      { error: "Background removal failed" },
      { status: 500 }
    );
  }
}
