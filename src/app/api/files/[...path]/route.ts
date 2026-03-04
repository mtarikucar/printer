import { NextRequest, NextResponse } from "next/server";
import { getFileBuffer } from "@/lib/services/storage";
import { extname } from "path";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".stl": "application/octet-stream",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const relativePath = segments.join("/");

  // Prevent path traversal
  if (relativePath.includes("..")) {
    return NextResponse.json({ error: "Geçersiz dosya yolu" }, { status: 400 });
  }

  try {
    const buffer = await getFileBuffer(relativePath);
    const ext = extname(relativePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
  }
}
