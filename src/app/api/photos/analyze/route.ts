import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getFileBuffer } from "@/lib/services/storage";
import { detectPersonCount } from "@/lib/services/person-detection";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";

// Best-effort person counter for the create flow's scene suggestion. Heavy
// (CPU inference), so it's IP rate-limited like /api/remove-background. Every
// failure returns { personCount: null } — the UI just skips the suggestion.
export const maxDuration = 300;

const schema = z.object({ photoKey: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    const ip = extractClientIp(request);
    const rl = await rateLimitAsync(`analyze:${ip}`, 20, 10 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json({ personCount: null }, { status: 429 });
    }

    const { photoKey } = schema.parse(await request.json());
    if (!photoKey.startsWith("photos/") || photoKey.includes("..")) {
      return NextResponse.json({ personCount: null }, { status: 400 });
    }

    const buffer = await getFileBuffer(photoKey);
    const personCount = await detectPersonCount(buffer);
    return NextResponse.json({ personCount });
  } catch {
    // Never surface as an error — the suggestion is optional.
    return NextResponse.json({ personCount: null });
  }
}
