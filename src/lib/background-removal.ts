import { AutoModel, AutoProcessor, RawImage, type Tensor } from "@huggingface/transformers";

const MODEL_ID = "briaai/RMBG-1.4";
const DEVICE = "wasm";

let model: any = null;
let processor: any = null;
let isInitializing = false;

export interface BackgroundRemovalProgress {
  stage: "loading" | "processing" | "compositing" | "complete";
  progress: number;
  message: string;
}

export type ProgressCallback = (progress: BackgroundRemovalProgress) => void;

export async function initializeModel(onProgress?: ProgressCallback): Promise<void> {
  if (model && processor) return;

  if (isInitializing) {
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  isInitializing = true;

  try {
    onProgress?.({ stage: "loading", progress: 0, message: "Loading AI model..." });

    model = await AutoModel.from_pretrained(MODEL_ID, { device: DEVICE });

    onProgress?.({ stage: "loading", progress: 50, message: "Loading image processor..." });

    processor = await AutoProcessor.from_pretrained(MODEL_ID);

    onProgress?.({ stage: "loading", progress: 100, message: "Model ready!" });
  } catch (error) {
    isInitializing = false;
    throw new Error(
      `Failed to initialize model: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  isInitializing = false;
}

export async function removeBackground(
  file: File,
  onProgress?: ProgressCallback
): Promise<File> {
  if (!model || !processor) {
    throw new Error("Model not initialized. Call initializeModel() first.");
  }

  try {
    onProgress?.({ stage: "processing", progress: 10, message: "Loading image..." });

    const imageUrl = URL.createObjectURL(file);
    const image = await RawImage.fromURL(imageUrl);
    URL.revokeObjectURL(imageUrl);

    onProgress?.({ stage: "processing", progress: 30, message: "Preprocessing image..." });

    const { pixel_values } = await processor(image);

    onProgress?.({ stage: "processing", progress: 50, message: "Running AI model..." });

    const { output } = await model({ input: pixel_values });

    onProgress?.({ stage: "compositing", progress: 70, message: "Creating transparent image..." });

    const mask = extractAlphaMask(output, image.width, image.height);

    onProgress?.({ stage: "compositing", progress: 85, message: "Finalizing image..." });

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;

    const imageBitmap = await createImageBitmap(file);
    ctx.drawImage(imageBitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < mask.length; i++) {
      data[i * 4 + 3] = mask[i];
    }

    ctx.putImageData(imageData, 0, 0);

    onProgress?.({ stage: "compositing", progress: 95, message: "Converting to PNG..." });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Failed to create blob"));
      }, "image/png");
    });

    onProgress?.({ stage: "complete", progress: 100, message: "Background removed!" });

    const originalName = file.name.replace(/\.[^/.]+$/, "");
    return new File([blob], `${originalName}_nobg.png`, { type: "image/png" });
  } catch (error) {
    throw new Error(
      `Failed to remove background: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function extractAlphaMask(output: Tensor, width: number, height: number): Uint8ClampedArray {
  const outputData = output.data as Float32Array;
  const [, , h, w] = output.dims;
  const mask = new Uint8ClampedArray(width * height);

  if (h !== height || w !== width) {
    const scaleX = w / width;
    const scaleY = h / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);
        const srcIdx = srcY * w + srcX;
        mask[y * width + x] = Math.max(0, Math.min(255, Math.round(outputData[srcIdx] * 255)));
      }
    }
  } else {
    for (let i = 0; i < outputData.length; i++) {
      mask[i] = Math.max(0, Math.min(255, Math.round(outputData[i] * 255)));
    }
  }

  return mask;
}

export function isBackgroundRemovalSupported(): boolean {
  try {
    const hasCanvas =
      typeof document !== "undefined" && !!document.createElement("canvas").getContext("2d");
    const hasCreateImageBitmap = typeof createImageBitmap !== "undefined";
    const hasBlob = typeof Blob !== "undefined";
    return hasCanvas && hasCreateImageBitmap && hasBlob;
  } catch {
    return false;
  }
}

export function disposeModel(): void {
  if (model) {
    try {
      model.dispose?.();
    } catch (error) {
      console.warn("Error disposing model:", error);
    }
    model = null;
  }
  processor = null;
  isInitializing = false;
}
