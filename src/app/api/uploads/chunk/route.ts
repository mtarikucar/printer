import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getPainterSession } from "@/lib/services/painter-auth";
import { getSessionUser } from "@/lib/services/customer-auth";
import {
  UPLOAD_CHUNK_SIZE_BYTES,
  appendChunk,
  createStagedUpload,
  isValidUploadId,
  stagedSize,
} from "@/lib/services/chunked-upload";

// Streaming route: never let Next try to buffer or cache the body.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Chunked upload endpoint. Any signed-in principal may stage bytes; staging on
 * its own does nothing — the file only becomes real when a feature endpoint
 * (model upload, product file, …) claims the id and validates it.
 */
async function isAuthenticated(): Promise<boolean> {
  const admin = await auth().catch(() => null);
  if ((admin?.user as { role?: string } | undefined)?.role === "admin") return true;
  if (await getManufacturerSession().catch(() => null)) return true;
  if (await getPainterSession().catch(() => null)) return true;
  if (await getSessionUser().catch(() => null)) return true;
  return false;
}

/** POST /api/uploads/chunk → { uploadId, chunkSize } */
export async function PUT() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uploadId = await createStagedUpload();
  return NextResponse.json({ uploadId, chunkSize: UPLOAD_CHUNK_SIZE_BYTES });
}

/**
 * POST /api/uploads/chunk?uploadId=…&offset=…
 * Body is the raw chunk (not multipart — multipart would defeat the point).
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uploadId = request.nextUrl.searchParams.get("uploadId") ?? "";
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "-1");
  if (!isValidUploadId(uploadId) || !Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Geçersiz yükleme isteği." }, { status: 400 });
  }

  const result = await appendChunk(uploadId, request.body, offset);
  if (!result.ok) {
    if (result.reason === "unknown_upload") {
      return NextResponse.json(
        { error: "Yükleme oturumu bulunamadı; baştan başlayın.", code: "unknown_upload" },
        { status: 404 }
      );
    }
    // Tell the client the real offset so it can resume rather than restart.
    return NextResponse.json(
      { error: "Parça sırası uyuşmadı.", code: result.reason, size: result.size },
      { status: 409 }
    );
  }
  return NextResponse.json({ size: result.size });
}

/** GET /api/uploads/chunk?uploadId=… → how many bytes we already hold. */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uploadId = request.nextUrl.searchParams.get("uploadId") ?? "";
  if (!isValidUploadId(uploadId)) {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  const size = await stagedSize(uploadId);
  if (size === null) {
    return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ size });
}
