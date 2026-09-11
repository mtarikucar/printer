import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { latestModelFiles, revisionModelFiles } from "@/lib/services/order-model";
import { modelFilesZipResponse } from "@/lib/services/model-file-download";

/** All parts of one revision (default: the newest) as a ZIP. `?revision=N&kind=stl|glb`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { id: true, orderNumber: true },
  });
  if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const revParam = Number(sp.get("revision"));
  let revision: number | null;
  let files;
  if (Number.isInteger(revParam) && revParam > 0) {
    revision = revParam;
    files = await revisionModelFiles(id, revParam);
  } else {
    ({ revision, files } = await latestModelFiles(id));
  }
  const kind = sp.get("kind");
  const picked = kind === "stl" || kind === "glb" ? files.filter((f) => f.kind === kind) : files;
  return modelFilesZipResponse(
    picked.map((f) => ({ key: f.fileKey, name: f.fileName })),
    `${order.orderNumber}-model-v${revision ?? 0}${kind === "stl" || kind === "glb" ? `-${kind}` : ""}.zip`
  );
}
