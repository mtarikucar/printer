// fal.ai nano-banana (Google Gemini image edit) — turns a customer photo into a
// stylized figure IMAGE. This REPLACES the old Meshy image-to-image step; there
// is no automatic 3D anymore. Same fal queue-API shape as tripo.ts (POST →
// poll /requests/{id}/status → GET /requests/{id}), authed with FAL_API_KEY.
//
// The endpoint accepts `image_urls` (multiple reference photos → multi-photo
// fusion) and a text `prompt`. It exposes no seed/n param, so multiple
// variations come from N calls with slightly nudged prompts (VARIATION_NUDGES).
const NANO_BANANA_EDIT_ENDPOINT =
  "https://queue.fal.run/fal-ai/nano-banana/edit";

// $0.039 per image ≈ 4 cents; tracked for parity with the old per-call cost.
const COST_CENTS = 4;

export interface FalImageResult {
  imageUrl: string;
  requestId: string;
  costCents: number;
}

// Per-variation prompt nudges. fal exposes no seed/n param, so we vary the
// prompt slightly per call to get DISTINCT variations rather than near-dupes.
// (Moved here from the deleted meshy-image.ts.)
export const VARIATION_NUDGES: string[] = [
  "Three-quarter front angle, warm soft studio lighting, gentle friendly smile.",
  "Straight-on front angle, brighter even lighting, slightly more playful expression.",
];

/**
 * Generate one stylized figure image from 1..N reference photos.
 * `imageUrls` must be publicly fetchable by fal (public URL, not base64 in prod).
 */
export async function falNanoBananaEdit(
  imageUrls: string[],
  prompt: string,
): Promise<FalImageResult> {
  const startTime = Date.now();
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("FAL_API_KEY is not set");
  if (imageUrls.length === 0) throw new Error("falNanoBananaEdit needs ≥1 image");

  const createRes = await fetch(NANO_BANANA_EDIT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, image_urls: imageUrls }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!createRes.ok) {
    throw new Error(
      `fal nano-banana error (${createRes.status}): ${await createRes.text()}`,
    );
  }

  const { request_id: requestId } = await createRes.json();
  if (!requestId) throw new Error("fal nano-banana returned no request id");

  const statusUrl = `${NANO_BANANA_EDIT_ENDPOINT}/requests/${requestId}/status`;
  const resultUrl = `${NANO_BANANA_EDIT_ENDPOINT}/requests/${requestId}`;

  // Image edits are fast (~10-20s). A 120s budget is generous.
  const WALL_BUDGET_MS = 120_000;
  for (let i = 0; i < 60; i++) {
    if (Date.now() - startTime > WALL_BUDGET_MS) break;
    await new Promise((r) => setTimeout(r, 2000));

    let statusRes: Response;
    try {
      statusRes = await fetch(statusUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      continue; // transient network error — retry next iteration
    }
    if (!statusRes.ok) continue;

    const statusData = await statusRes.json();
    if (statusData.status === "COMPLETED") {
      const resultRes = await fetch(resultUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resultRes.ok) {
        throw new Error(
          `fal nano-banana result fetch failed (${resultRes.status})`,
        );
      }
      const data = await resultRes.json();
      const url = data.images?.[0]?.url;
      if (!url) throw new Error("fal nano-banana returned no image URL");
      return { imageUrl: url, requestId, costCents: COST_CENTS };
    }
    if (statusData.status === "FAILED") {
      throw new Error(
        `fal nano-banana FAILED: ${JSON.stringify(statusData.error ?? statusData)}`,
      );
    }
  }

  throw new Error("fal nano-banana timed out");
}
