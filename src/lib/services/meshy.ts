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

export function buildMeshyBody(imageBase64: string, style: FigurineStyle) {
  return {
    image_url: imageBase64,
    ai_model: "meshy-6",
    enable_pbr: false,
    should_remesh: true,
    // triangle topology: slicers consume triangles directly; quad meshes are
    // intended for animation rigs and add ambiguity for our STL pipeline.
    topology: "triangle",
    target_polycount: 50000,
    should_texture: false,
    pose_mode: poseModeForStyle(style),
    // Keep the style-transferred image verbatim; Meshy's "enhance" pass can
    // re-interpret the silhouette and reintroduce thin or floating details.
    image_enhancement: false,
    // Strip baked lighting so geometry inference focuses on form, not shadow.
    remove_lighting: true,
    moderation: true,
  };
}

export async function generateWithMeshy(
  imageBase64: string,
  style: FigurineStyle,
): Promise<MeshyResult> {
  const startTime = Date.now();

  // Create task — Meshy v1 API with Meshy-6 model (base64 image).
  // The per-request timeout caps any hung-connection scenario; the outer
  // 180s loop budget is enforced by the iteration counter below.
  const createRes = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MESHY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildMeshyBody(imageBase64, style)),
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
        `https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`,
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
