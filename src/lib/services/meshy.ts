import { poseModeForStyle, type FigurineStyle } from "../create/design-templates";

// Pose-mode hint is derived from the design-template registry (T-pose for
// templates whose proportions need arm separation). Re-exported for callers.
export { poseModeForStyle };

interface MeshyResult {
  glbUrl: string;
  // Meshy returns several export formats in `model_urls`. We keep the GLB
  // (used by the viewer and the STL print pipeline) and also surface OBJ/STL
  // so callers can offer them as direct downloads without a conversion step.
  // Either may be absent on older tasks / API changes, hence nullable.
  objUrl: string | null;
  stlUrl: string | null;
  taskId: string;
  durationMs: number;
}

// Meshy exposes two image-to-3D endpoints with an identical body/response
// contract; the only differences are the image field (`image_url` vs the
// 1-4 element `image_urls`) and the path. Multi-image fusion produces a more
// detailed mesh from several reference angles at the same credit cost.
const SINGLE_IMAGE_ENDPOINT = "https://api.meshy.ai/openapi/v1/image-to-3d";
const MULTI_IMAGE_ENDPOINT = "https://api.meshy.ai/openapi/v1/multi-image-to-3d";

export function buildMeshyBody(
  imageInput: string | string[],
  style: FigurineStyle,
) {
  const base = {
    ai_model: "meshy-6",
    enable_pbr: false,
    // We KEEP remesh on (not Meshy's meshy-6 default of false) because our print
    // pipeline's keep_largest_component (process_mesh.py) would drop the raw
    // mesh's separate detail shells (a bell, a bow); remesh fuses them into one
    // watertight piece. The detail-loss culprit was the polycount BUDGET, not
    // remesh itself — see target_polycount below.
    should_remesh: true,
    // triangle topology: slicers consume triangles directly; quad meshes are
    // intended for animation rigs and add ambiguity for our STL pipeline.
    topology: "triangle",
    // Remesh decimates toward this budget; 50k smoothed facial features flat.
    // Raised to the meshy-6 max (300k) so fine detail (eyes, seams, accessories)
    // survives the retopology — close to Meshy's web-UI (remesh-off) detail while
    // staying single-piece + watertight. Trade-off: larger STL / slower slicing.
    target_polycount: 300000,
    should_texture: false,
    pose_mode: poseModeForStyle(style),
    // Enhance the input image (Meshy/web-UI default) — improves detail capture.
    // Re-evaluate if it reintroduces thin/fragile details that hurt printability.
    image_enhancement: true,
    // Strip baked lighting so geometry inference focuses on form, not shadow.
    remove_lighting: true,
    moderation: true,
  };
  // The multi-image endpoint takes an `image_urls` array (1-4); the single
  // endpoint takes a scalar `image_url`. Same params otherwise.
  return Array.isArray(imageInput)
    ? { ...base, image_urls: imageInput }
    : { ...base, image_url: imageInput };
}

export async function generateWithMeshy(
  imageInput: string | string[],
  style: FigurineStyle,
): Promise<MeshyResult> {
  const startTime = Date.now();
  const isMulti = Array.isArray(imageInput);
  const endpoint = isMulti ? MULTI_IMAGE_ENDPOINT : SINGLE_IMAGE_ENDPOINT;

  // Create task — Meshy v1 API with Meshy-6 model (base64 or URL image(s)).
  // The per-request timeout caps any hung-connection scenario; the outer
  // 180s loop budget is enforced by the iteration counter below.
  const createRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MESHY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildMeshyBody(imageInput, style)),
    signal: AbortSignal.timeout(30_000),
  });

  if (!createRes.ok) {
    const error = await createRes.text();
    throw new Error(`Meshy API error (${createRes.status}): ${error}`);
  }

  const { result: taskId } = await createRes.json();

  // Poll for completion with a hard wall-clock budget. The previous loop ran
  // 90 iterations × (2s sleep + up to 10s fetch timeout) which could exceed
  // 18 minutes — well past anyone's expected budget. Enforce 180s real time.
  const WALL_BUDGET_MS = 180_000;
  for (let i = 0; i < 90; i++) {
    if (Date.now() - startTime > WALL_BUDGET_MS) break;
    await new Promise((r) => setTimeout(r, 2000));

    let statusRes: Response;
    try {
      statusRes = await fetch(
        `${endpoint}/${taskId}`,
        {
          headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}` },
          signal: AbortSignal.timeout(10_000),
        }
      );
    } catch {
      // Transient network error / per-request timeout — retry on next iteration.
      continue;
    }

    if (!statusRes.ok) continue;

    const statusData = await statusRes.json();

    if (statusData.status === "SUCCEEDED") {
      const durationMs = Date.now() - startTime;
      const modelUrls = statusData.model_urls ?? {};
      const glbUrl = modelUrls.glb;

      if (!glbUrl) {
        throw new Error("Meshy returned no GLB URL");
      }

      return {
        glbUrl,
        objUrl: modelUrls.obj ?? null,
        stlUrl: modelUrls.stl ?? null,
        taskId,
        durationMs,
      };
    }

    if (statusData.status === "FAILED") {
      throw new Error(`Meshy generation failed: ${statusData.task_error?.message || "Unknown error"}`);
    }
  }

  throw new Error("Meshy generation timed out after 180 seconds");
}
