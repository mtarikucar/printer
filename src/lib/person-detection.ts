import { pipeline, env, type ObjectDetectionPipeline } from "@huggingface/transformers";

// Run single-threaded to avoid SharedArrayBuffer requirement
// (SharedArrayBuffer needs COOP/COEP headers which we don't set)
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

const MODEL_ID = "Xenova/detr-resnet-50";
const DEVICE = "wasm";
const PADDING_RATIO = 0.15;

let detector: ObjectDetectionPipeline | null = null;
let isInitializing = false;

export interface BoundingBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface DetectionResult {
  found: boolean;
  box?: BoundingBox;
}

export async function initializeDetector(
  onProgress?: (progress: number) => void
): Promise<void> {
  if (detector) return;

  if (isInitializing) {
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  isInitializing = true;

  try {
    onProgress?.(0);
    detector = (await (pipeline as Function)("object-detection", MODEL_ID, {
      device: DEVICE,
    })) as ObjectDetectionPipeline;
    onProgress?.(100);
  } catch (error) {
    isInitializing = false;
    throw new Error(
      `Failed to initialize detector: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  isInitializing = false;
}

export async function detectPerson(file: File): Promise<DetectionResult> {
  if (!detector) {
    throw new Error("Detector not initialized. Call initializeDetector() first.");
  }

  const imageUrl = URL.createObjectURL(file);

  try {
    const results = await detector(imageUrl);
    URL.revokeObjectURL(imageUrl);

    // Find the person detection with highest score
    const personDetections = (results as any[]).filter(
      (r: any) => r.label === "person" && r.score > 0.5
    );

    if (personDetections.length === 0) {
      return { found: false };
    }

    // Sort by score descending and take the best one
    personDetections.sort((a: any, b: any) => b.score - a.score);
    const best = personDetections[0];
    const box = best.box as BoundingBox;

    // Load image to get dimensions for padding
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
    URL.revokeObjectURL(img.src);

    const w = box.xmax - box.xmin;
    const h = box.ymax - box.ymin;
    const padX = w * PADDING_RATIO;
    const padY = h * PADDING_RATIO;

    return {
      found: true,
      box: {
        xmin: Math.max(0, box.xmin - padX),
        ymin: Math.max(0, box.ymin - padY),
        xmax: Math.min(img.width, box.xmax + padX),
        ymax: Math.min(img.height, box.ymax + padY),
      },
    };
  } catch (error) {
    URL.revokeObjectURL(imageUrl);
    throw new Error(
      `Person detection failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export function disposeDetector(): void {
  if (detector) {
    try {
      (detector as any).dispose?.();
    } catch (error) {
      console.warn("Error disposing detector:", error);
    }
    detector = null;
  }
  isInitializing = false;
}
