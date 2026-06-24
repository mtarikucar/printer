// Meshy Creative Lab — turn a customer photo into a physical product (keychain,
// fridge magnet, lamp) via the two-stage prototype → build flow. Same OpenAPI
// host/key as our other Meshy calls. Contract smoke-tested (prototype 6cr +
// build 30cr) — see scripts/test-meshy-creative-lab.ts.

export type CreativeLabProduct = "keychain" | "fridge_magnet" | "lamp";

export const CREATIVE_LAB_PRODUCTS: CreativeLabProduct[] = [
  "keychain",
  "fridge_magnet",
  "lamp",
];

export function isCreativeLabProduct(v: string): v is CreativeLabProduct {
  return (CREATIVE_LAB_PRODUCTS as string[]).includes(v);
}

// URL slug per Meshy's API (fridge_magnet → fridge-magnet).
const PRODUCT_SLUG: Record<CreativeLabProduct, string> = {
  keychain: "keychain",
  fridge_magnet: "fridge-magnet",
  lamp: "lamp",
};

// Geometry-only build options + output format per product (defaults from docs).
// keychain/magnet → GLB (previewable); lamp → STL (two parts).
function buildPayload(product: CreativeLabProduct, prototypeTaskId: string) {
  switch (product) {
    case "keychain":
      return {
        input_task_id: prototypeTaskId,
        options: { badge_shape: "circle", size_mm: 40, remove_background: true },
        output: { format: "glb" },
      };
    case "fridge_magnet":
      return {
        input_task_id: prototypeTaskId,
        options: { badge_shape: "rounded-rect", size_mm: 60, remove_background: true },
        output: { format: "glb" },
      };
    case "lamp":
      return {
        input_task_id: prototypeTaskId,
        options: { diameter_mm: 120, light_source_preset: "none" },
        output: { format: "stl" },
      };
  }
}

export interface CreativeLabResult {
  glbUrl: string | null;
  stlUrl: string | null;
  prototypeTaskId: string;
  buildTaskId: string;
}

async function pollTask(
  base: string,
  kind: "prototype" | "build",
  id: string,
  startTime: number,
): Promise<Record<string, unknown>> {
  const WALL_BUDGET_MS = 240_000;
  for (let i = 0; i < 120; i++) {
    if (Date.now() - startTime > WALL_BUDGET_MS) break;
    await new Promise((r) => setTimeout(r, 2000));
    let res: Response;
    try {
      res = await fetch(`${base}/${kind}/${id}`, {
        headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const data = await res.json();
    if (data.status === "SUCCEEDED") return data;
    if (data.status === "FAILED" || data.status === "CANCELED") {
      throw new Error(
        `Creative Lab ${kind} ${data.status}: ${data.task_error?.message || "unknown"}`,
      );
    }
  }
  throw new Error(`Creative Lab ${kind} timed out`);
}

export async function generateCreativeLabProduct(
  product: CreativeLabProduct,
  imageInput: string, // public URL or base64 data URI
): Promise<CreativeLabResult> {
  const startTime = Date.now();
  const base = `https://api.meshy.ai/openapi/creative-lab/${PRODUCT_SLUG[product]}/v1`;
  const auth = { Authorization: `Bearer ${process.env.MESHY_API_KEY}` };

  // 1) prototype
  const pRes = await fetch(`${base}/prototype`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageInput }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!pRes.ok) {
    throw new Error(`Creative Lab prototype error (${pRes.status}): ${await pRes.text()}`);
  }
  const { result: prototypeTaskId } = await pRes.json();
  if (!prototypeTaskId) throw new Error("Creative Lab prototype returned no task id");
  await pollTask(base, "prototype", prototypeTaskId, startTime);

  // 2) build (chained via input_task_id)
  const bRes = await fetch(`${base}/build`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload(product, prototypeTaskId)),
    signal: AbortSignal.timeout(30_000),
  });
  if (!bRes.ok) {
    throw new Error(`Creative Lab build error (${bRes.status}): ${await bRes.text()}`);
  }
  const { result: buildTaskId } = await bRes.json();
  if (!buildTaskId) throw new Error("Creative Lab build returned no task id");
  const done = await pollTask(base, "build", buildTaskId, startTime);

  const urls = (done.model_urls ?? {}) as Record<string, string>;
  return {
    glbUrl: urls.glb ?? null,
    stlUrl: urls.lamp_stl ?? urls.stl ?? null,
    prototypeTaskId,
    buildTaskId,
  };
}
