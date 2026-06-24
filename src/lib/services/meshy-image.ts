// Meshy Image-to-Image — AI image generation on the SAME OpenAPI host/key as our
// 3D endpoints. We use it with the `nano-banana` model (Google Gemini 2.5 Flash
// Image, identity-preserving) to turn a customer photo into stylized 2D
// variations before the 3D build. The API has no seed/n parameter, so multiple
// variations come from N calls with slightly nudged prompts.
const IMAGE_TO_IMAGE_ENDPOINT = "https://api.meshy.ai/openapi/v1/image-to-image";

export type MeshyImageModel =
  | "nano-banana"
  | "nano-banana-2"
  | "nano-banana-pro"
  | "gpt-image-2";

// nano-banana: cheapest (3 credits) and strongest at identity hold across a
// restyle — validated on a real face (kept hat/hair/coat). Switch to
// "nano-banana-pro" here if a future QA shows likeness slipping.
export const DEFAULT_IMAGE_MODEL: MeshyImageModel = "nano-banana";

export interface MeshyImageResult {
  imageUrl: string;
  taskId: string;
  consumedCredits: number;
}

// Per-variation prompt nudges. The API exposes no seed/n param, so we vary the
// prompt slightly per call to get DISTINCT variations rather than near-dupes.
export const VARIATION_NUDGES: string[] = [
  "Three-quarter front angle, warm soft studio lighting, gentle friendly smile.",
  "Straight-on front angle, brighter even lighting, slightly more playful expression.",
];

// Asks nano-banana for the rear view of the SAME character it just produced, so
// multi-image-to-3d gets real back coverage instead of a guessed backside.
export function backViewPrompt(): string {
  return (
    "Show the exact same character from directly behind — full rear view of the figure. " +
    "Keep the identical outfit, colors, hairstyle, proportions and art style. " +
    "Plain solid white background. No text."
  );
}

export async function meshyImageToImage(
  referenceInputs: string[], // public URL(s) or base64 data URI(s), 1-5
  prompt: string,
  model: MeshyImageModel = DEFAULT_IMAGE_MODEL,
): Promise<MeshyImageResult> {
  const startTime = Date.now();

  const createRes = await fetch(IMAGE_TO_IMAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MESHY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ai_model: model,
      prompt,
      reference_image_urls: referenceInputs,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!createRes.ok) {
    throw new Error(
      `Meshy image-to-image error (${createRes.status}): ${await createRes.text()}`,
    );
  }

  const { result: taskId } = await createRes.json();
  if (!taskId) throw new Error("Meshy image-to-image returned no task id");

  // Image generation is fast (~10s observed) — a 120s budget is generous.
  const WALL_BUDGET_MS = 120_000;
  for (let i = 0; i < 60; i++) {
    if (Date.now() - startTime > WALL_BUDGET_MS) break;
    await new Promise((r) => setTimeout(r, 2000));

    let statusRes: Response;
    try {
      statusRes = await fetch(`${IMAGE_TO_IMAGE_ENDPOINT}/${taskId}`, {
        headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      continue; // transient network error — retry next iteration
    }
    if (!statusRes.ok) continue;

    const data = await statusRes.json();
    if (data.status === "SUCCEEDED") {
      const url = data.image_urls?.[0];
      if (!url) throw new Error("Meshy image-to-image returned no image URL");
      return {
        imageUrl: url,
        taskId,
        consumedCredits: data.consumed_credits ?? 0,
      };
    }
    if (data.status === "FAILED" || data.status === "CANCELED") {
      throw new Error(
        `Meshy image-to-image ${data.status}: ${data.task_error?.message || "unknown"}`,
      );
    }
  }

  throw new Error("Meshy image-to-image timed out");
}
