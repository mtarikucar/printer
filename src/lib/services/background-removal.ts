import { env, AutoModel, AutoProcessor, RawImage, type Tensor } from "@huggingface/transformers";
import sharp from "sharp";

const MODEL_ID = "briaai/RMBG-1.4";

// Use pre-downloaded model cache in Docker (set via TRANSFORMERS_CACHE env)
if (process.env.TRANSFORMERS_CACHE) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE;
}

let model: any = null;
let processor: any = null;
let loadingPromise: Promise<void> | null = null;

export async function ensureModel(): Promise<void> {
  if (model && processor) return;

  if (loadingPromise) {
    await loadingPromise;
    return;
  }

  loadingPromise = (async () => {
    try {
      model = await AutoModel.from_pretrained(MODEL_ID, { device: "cpu" });
      processor = await AutoProcessor.from_pretrained(MODEL_ID);
    } catch (error) {
      loadingPromise = null;
      throw error;
    }
  })();

  await loadingPromise;
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

export async function removeBackground(buffer: Buffer): Promise<Buffer> {
  await ensureModel();

  // Get original dimensions
  const metadata = await sharp(buffer).metadata();
  const origWidth = metadata.width!;
  const origHeight = metadata.height!;

  // Resize to max 1024px for faster inference (preserve aspect ratio)
  const MAX_DIM = 1024;
  let inferenceBuffer = buffer;
  if (origWidth > MAX_DIM || origHeight > MAX_DIM) {
    inferenceBuffer = await sharp(buffer)
      .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
      .toBuffer();
  }

  const image = await RawImage.fromBlob(new Blob([new Uint8Array(inferenceBuffer)]));

  const { pixel_values } = await processor(image);
  const { output } = await model({ input: pixel_values });

  // Extract mask scaled to original resolution (extractAlphaMask handles scaling)
  const mask = extractAlphaMask(output, origWidth, origHeight);

  // Compose: take RGB from original, use mask as alpha channel
  const maskBuffer = Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength);

  const rgb = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer();

  const result = await sharp(rgb, {
    raw: { width: origWidth, height: origHeight, channels: 3 },
  })
    .joinChannel(maskBuffer, {
      raw: { width: image.width, height: image.height, channels: 1 },
    })
    .png()
    .toBuffer();

  return result;
}
