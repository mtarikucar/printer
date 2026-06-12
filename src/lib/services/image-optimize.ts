import sharp from "sharp";

/**
 * Downsize + re-encode a display image (product/listing photos) so storefront
 * grids load a small file instead of the multi-MB original. Output is WebP:
 * universally supported, ~30% smaller than JPEG at equal quality, and handles
 * alpha (so PNG sources don't need a separate path).
 *
 * NOT for the customer's AI source photo or QC/dekont evidence — those keep
 * full resolution for correctness. Use this only for images that exist solely
 * to be displayed.
 */
export const DISPLAY_IMAGE_MAX_EDGE = 1600;

export async function optimizeDisplayImage(
  buffer: Buffer
): Promise<{ buffer: Buffer; ext: "webp"; contentType: "image/webp" }> {
  const out = await sharp(buffer)
    // Bake in EXIF orientation, then drop metadata (sharp strips it by default
    // on re-encode) so phone photos aren't served sideways and carry no GPS.
    .rotate()
    .resize(DISPLAY_IMAGE_MAX_EDGE, DISPLAY_IMAGE_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
  // Normalize to Buffer<ArrayBuffer> so it matches saveFile's signature
  // (sharp's toBuffer is typed Buffer<ArrayBufferLike>).
  return { buffer: Buffer.from(out), ext: "webp", contentType: "image/webp" };
}
