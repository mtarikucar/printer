import { NextRequest, NextResponse } from "next/server";
import { getFileBuffer, verifyFileSignature } from "@/lib/services/storage";
import { extname } from "path";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".stl": "application/octet-stream",
};

// When FILES_REQUIRE_SIGNATURE=1 every download must carry valid ?exp=&sig=
// query params. When unset (current default), we accept unsigned requests for
// backward compatibility with URLs already in the wild. Flip the flag once
// callers are migrated.
const REQUIRE_SIGNATURE = process.env.FILES_REQUIRE_SIGNATURE === "1";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const relativePath = segments.join("/");

  // Prevent path traversal — defence-in-depth on top of assertSafePath in storage.
  if (relativePath.includes("..")) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  const exp = Number(request.nextUrl.searchParams.get("exp"));
  const sig = request.nextUrl.searchParams.get("sig");
  const hasSignature = Number.isFinite(exp) && !!sig;
  const signatureValid =
    hasSignature && verifyFileSignature(relativePath, exp, sig);

  if (REQUIRE_SIGNATURE && !signatureValid) {
    return NextResponse.json(
      { error: "Missing or invalid signature" },
      { status: 401 }
    );
  }

  try {
    const buffer = await getFileBuffer(relativePath);
    const ext = extname(relativePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        // Never let the browser MIME-sniff a stored upload into an executable
        // type — defuses a polyglot (valid image header + HTML/JS body) being
        // served and run in our origin.
        "X-Content-Type-Options": "nosniff",
        // Signed URLs are unique per `exp` value, so we can still cache them
        // aggressively. Unsigned (legacy) URLs cache as before.
        "Cache-Control": signatureValid
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
