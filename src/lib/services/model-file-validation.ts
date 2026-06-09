import { UPLOAD_MODEL_FORMATS, type UploadModelFormat } from "@/lib/config/upload";

export interface ModelValidationResult {
  ok: boolean;
  format?: UploadModelFormat;
  error?: string;
}

/**
 * Validate an uploaded 3D model by CONTENT — never trust the client MIME/ext
 * alone. STL: binary (80-byte header + uint32 triangle count, file size must be
 * exactly 84 + 50*count) OR ascii ("solid" … "facet" … "endsolid"). OBJ: text
 * with at least one vertex (`v`) and one face (`f`) line.
 */
export function validateModelFile(buffer: Buffer, fileName: string): ModelValidationResult {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (!UPLOAD_MODEL_FORMATS.includes(ext as UploadModelFormat)) {
    return { ok: false, error: "unsupported_format" };
  }
  if (buffer.length < 16) return { ok: false, error: "too_small" };
  if (ext === "stl") return validateStl(buffer);
  return validateObj(buffer);
}

function validateStl(buffer: Buffer): ModelValidationResult {
  // ASCII STL: "solid" prefix with real facet/endsolid markers.
  const head = buffer.subarray(0, Math.min(512, buffer.length)).toString("latin1").trimStart();
  if (head.toLowerCase().startsWith("solid")) {
    const text = buffer.toString("latin1");
    if (text.includes("facet") && text.includes("endsolid")) {
      return { ok: true, format: "stl" };
    }
    // "solid" prefix but no facets → likely a mislabeled binary; fall through.
  }
  // Binary STL: header(80) + uint32 count(4) + 50 bytes/triangle.
  if (buffer.length >= 84) {
    const count = buffer.readUInt32LE(80);
    if (count > 0 && buffer.length === 84 + count * 50) {
      return { ok: true, format: "stl" };
    }
  }
  return { ok: false, error: "invalid_stl" };
}

function validateObj(buffer: Buffer): ModelValidationResult {
  const text = buffer.toString("utf8");
  const hasVertex = /^v\s+-?\d/m.test(text);
  const hasFace = /^f\s+\d/m.test(text);
  if (hasVertex && hasFace) return { ok: true, format: "obj" };
  return { ok: false, error: "invalid_obj" };
}
