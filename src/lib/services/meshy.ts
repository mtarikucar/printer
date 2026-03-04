interface MeshyResult {
  glbUrl: string;
  taskId: string;
  durationMs: number;
}

export async function generateWithMeshy(imageUrl: string): Promise<MeshyResult> {
  const startTime = Date.now();

  // Create task — Meshy v1 API with Meshy-6 model
  const createRes = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MESHY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      ai_model: "meshy-6",
      enable_pbr: false,
      should_remesh: true,
      topology: "quad",
      target_polycount: 50000,
      should_texture: false,
    }),
  });

  if (!createRes.ok) {
    const error = await createRes.text();
    throw new Error(`Meshy API error (${createRes.status}): ${error}`);
  }

  const { result: taskId } = await createRes.json();

  // Poll for completion (max ~180s)
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const statusRes = await fetch(
      `https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`,
      {
        headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}` },
      }
    );

    if (!statusRes.ok) continue;

    const statusData = await statusRes.json();

    if (statusData.status === "SUCCEEDED") {
      const durationMs = Date.now() - startTime;
      const glbUrl = statusData.model_urls?.glb;

      if (!glbUrl) {
        throw new Error("Meshy returned no GLB URL");
      }

      return { glbUrl, taskId, durationMs };
    }

    if (statusData.status === "FAILED") {
      throw new Error(`Meshy generation failed: ${statusData.task_error?.message || "Unknown error"}`);
    }
  }

  throw new Error("Meshy generation timed out after 180 seconds");
}
