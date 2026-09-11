import { NextRequest } from "next/server";
import { latestModelFiles } from "@/lib/services/order-model";
import { manufacturerOrderOrError } from "@/lib/services/manufacturer-order-access";
import { modelFilesZipResponse } from "@/lib/services/model-file-download";

/**
 * Every part of the CURRENT revision as one ZIP. `?kind=stl` narrows it to the
 * print files — what the slicer actually needs.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await manufacturerOrderOrError(id);
  if (!gate.ok) return gate.response;

  const kind = request.nextUrl.searchParams.get("kind");
  const { revision, files } = await latestModelFiles(id);
  const picked = kind === "stl" || kind === "glb" ? files.filter((f) => f.kind === kind) : files;
  const suffix = kind === "stl" || kind === "glb" ? `-${kind}` : "";
  return modelFilesZipResponse(
    picked.map((f) => ({ key: f.fileKey, name: f.fileName })),
    `${gate.order.orderNumber}-model-v${revision ?? 0}${suffix}.zip`
  );
}
