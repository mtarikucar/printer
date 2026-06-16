import { env, pipeline } from "@huggingface/transformers";

// Local, CPU-only person counter built on the same transformers.js stack as
// background-removal (no external API, model cached in the Docker image). Used
// to SUGGEST a scene preset and warn on mismatch — never to block generation, so
// every failure path degrades to "unknown" (null) and the UI simply stays quiet.

const MODEL_ID = "Xenova/detr-resnet-50";
// DETR is noisy at low confidence; only count clearly-detected people.
const PERSON_SCORE_THRESHOLD = 0.7;

if (process.env.TRANSFORMERS_CACHE) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let detector: any = null;
let loadingPromise: Promise<void> | null = null;

export async function ensurePersonDetector(): Promise<void> {
  if (detector) return;
  if (loadingPromise) {
    await loadingPromise;
    return;
  }
  loadingPromise = (async () => {
    try {
      detector = await pipeline("object-detection", MODEL_ID);
    } catch (error) {
      loadingPromise = null;
      throw error;
    }
  })();
  await loadingPromise;
}

/**
 * Count people in an image. Returns the number of "person" detections above the
 * confidence threshold. Throws on model/inference failure — callers treat that
 * as "unknown" and skip the suggestion.
 */
export async function detectPersonCount(buffer: Buffer): Promise<number> {
  await ensurePersonDetector();

  // transformers.js accepts a data URL / Blob; use a data URL for the raw bytes.
  const base64 = buffer.toString("base64");
  const dataUrl = `data:image/png;base64,${base64}`;

  const detections: Array<{ label: string; score: number }> = await detector(
    dataUrl,
    { threshold: PERSON_SCORE_THRESHOLD }
  );

  return detections.filter(
    (d) => d.label === "person" && d.score >= PERSON_SCORE_THRESHOLD
  ).length;
}
