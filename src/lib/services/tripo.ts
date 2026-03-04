import { nanoid } from "nanoid";

interface TripoResult {
  glbUrl: string;
  taskId: string;
  durationMs: number;
}

export async function generateWithTripo(imageUrl: string): Promise<TripoResult> {
  const startTime = Date.now();

  const response = await fetch("https://queue.fal.run/fal-ai/tripo-sr/v2", {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      output_format: "glb",
      face_limit: 100000,
      texture: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Tripo API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const requestId = data.request_id;

  // Poll for completion
  let result: any = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const statusRes = await fetch(
      `https://queue.fal.run/fal-ai/tripo-sr/v2/requests/${requestId}/status`,
      {
        headers: { Authorization: `Key ${process.env.FAL_API_KEY}` },
      }
    );

    const statusData = await statusRes.json();

    if (statusData.status === "COMPLETED") {
      const resultRes = await fetch(
        `https://queue.fal.run/fal-ai/tripo-sr/v2/requests/${requestId}`,
        {
          headers: { Authorization: `Key ${process.env.FAL_API_KEY}` },
        }
      );
      result = await resultRes.json();
      break;
    }

    if (statusData.status === "FAILED") {
      throw new Error(`Tripo generation failed: ${statusData.error || "Unknown error"}`);
    }
  }

  if (!result) {
    throw new Error("Tripo generation timed out after 120 seconds");
  }

  const durationMs = Date.now() - startTime;
  const glbUrl = result.model_mesh?.url || result.output?.model_mesh?.url;

  if (!glbUrl) {
    throw new Error("Tripo returned no GLB URL in response");
  }

  return {
    glbUrl,
    taskId: requestId,
    durationMs,
  };
}
