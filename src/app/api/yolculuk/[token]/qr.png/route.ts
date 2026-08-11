import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { journeyUrl, loadJourney } from "@/lib/services/order-journey";

export const runtime = "nodejs";

/**
 * The journey QR as a hosted PNG.
 *
 * Email clients (Gmail above all) refuse inline `data:` images, so the QR in
 * the shipping mail has to come from a URL. Generating it on request rather
 * than storing a file keeps it consistent if a token is ever rotated, and
 * costs nothing worth caching in storage.
 *
 * Public by design: the PNG only encodes a URL the recipient already holds, and
 * it is the same capability as the link itself. The token is still validated so
 * this can't be used to mint QR codes for arbitrary strings.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const journey = await loadJourney(token);
  if (!journey) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const png = await QRCode.toBuffer(journeyUrl(token), {
    type: "png",
    // Printed on a small card and scanned in poor light; the higher correction
    // level survives a smudge or a crease.
    errorCorrectionLevel: "H",
    margin: 2,
    width: 600,
    color: { dark: "#1E1726", light: "#FFFFFF" },
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // The token is stable for the life of the order, so this is safe to cache
      // hard — which matters because every open of the shipping email refetches it.
      "Cache-Control": "public, max-age=31536000, immutable",
      // Never let a search engine index an image whose URL is the capability.
      "X-Robots-Tag": "noindex, noimageindex",
    },
  });
}
