import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BUSINESS_LEGAL_NAME } from "@/lib/config/business-identity";

/**
 * Site-wide link preview card.
 *
 * The root metadata declared `openGraph` but carried no image, so every link
 * shared on WhatsApp — the channel this business actually sells through —
 * unfurled without one.
 *
 * Generated rather than a static file because there is no real logo asset in
 * the repo (the maskot PNGs are illustrations and the SVGs are framework
 * boilerplate); inventing one would be worse than a clean typographic card.
 *
 * The fonts are LOCAL on purpose. satori falls back to fetching a font from a
 * third party for any glyph it does not have, and Turkish `ğ`/`ş` trigger
 * exactly that — which fails on a restricted network and makes an image route
 * depend on someone else's uptime. See public/og/README.md.
 */
export const alt = "Figurunica — fotoğraftan kişiye özel figür";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  // Read from `public/`, not via `fetch(new URL(..., import.meta.url))`: a
  // file: fetch is not implemented in this runtime, and `public/` is the one
  // directory the Dockerfile explicitly copies into the standalone output.
  const fontDir = join(process.cwd(), "public", "og");
  const [regular, bold] = await Promise.all([
    readFile(join(fontDir, "og-regular.ttf")),
    readFile(join(fontDir, "og-bold.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #1a1a1a 0%, #2d2a26 100%)",
          color: "#f5f3ef",
          fontFamily: "OG",
        }}
      >
        <div style={{ fontSize: 32, letterSpacing: 6, opacity: 0.65 }}>
          {BUSINESS_LEGAL_NAME.toUpperCase()}
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            marginTop: 28,
            lineHeight: 1.15,
            fontFamily: "OG Bold",
          }}
        >
          Fotoğrafından kişiye özel figür
        </div>
        <div style={{ fontSize: 34, marginTop: 32, opacity: 0.8 }}>
          15 cm · SLA reçine baskı · profesyonel el boyaması
        </div>
        <div style={{ fontSize: 26, marginTop: 44, opacity: 0.6 }}>figurunica.com</div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "OG", data: regular, style: "normal", weight: 400 },
        { name: "OG Bold", data: bold, style: "normal", weight: 700 },
      ],
    }
  );
}
