const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function startsWith(buffer: Buffer, magic: number[]): boolean {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}

export function validateImageMagicBytes(
  buffer: Buffer
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (startsWith(buffer, JPEG_MAGIC)) return "image/jpeg";
  if (startsWith(buffer, PNG_MAGIC)) return "image/png";
  if (
    buffer.length >= 12 &&
    startsWith(buffer, WEBP_RIFF) &&
    startsWith(buffer.subarray(8), WEBP_WEBP)
  ) {
    return "image/webp";
  }
  return null;
}
