import { NextRequest } from "next/server";
import { latestModelFiles } from "@/lib/services/order-model";
import { manufacturerOrderOrError } from "@/lib/services/manufacturer-order-access";
import { fileDownloadResponse } from "@/lib/services/model-file-download";
import { handleRouteFailure, PARTNER_READ_FAILED_ERROR } from "@/lib/api/route-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One part of the order's CURRENT model revision. Older revisions are not
 * served to the workshop on purpose: a superseded part printed by mistake is a
 * wasted print and a late order.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await params;
    if (!UUID.test(fileId)) return Response.json({ error: "File not found" }, { status: 404 });

    const gate = await manufacturerOrderOrError(id);
    if (!gate.ok) return gate.response;

    const { files } = await latestModelFiles(id);
    const file = files.find((f) => f.id === fileId);
    if (!file) {
      return Response.json(
        { error: "Bu dosya güncel model sürümünde değil. Sayfayı yenileyin." },
        { status: 404 }
      );
    }
    return fileDownloadResponse(
      { key: file.fileKey, name: `${gate.order.orderNumber}-${file.fileName}` },
      file.kind === "glb" ? "model/gltf-binary" : "model/stl"
    );
  } catch (e) {
    return handleRouteFailure(e, "GET /api/manufacturer/orders/[id]/model-files/[fileId]", PARTNER_READ_FAILED_ERROR);
  }
}
