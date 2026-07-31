import { UPLOAD_MODEL_FORMATS, type UploadModelFormat } from "@/lib/config/upload";

export interface ModelValidationResult {
  ok: boolean;
  format?: UploadModelFormat;
  error?: string;
}

/**
 * Validate an uploaded 3D model by CONTENT — never trust the client MIME/ext
 * alone. STL: binary (80-byte header + uint32 triangle count, payload must fit
 * the file with at most a small trailing-junk allowance) OR ascii ("solid" …
 * "facet" … "endsolid"). OBJ: text with at least one vertex (`v`) and one
 * face (`f`) line.
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
  // Binary STL: header(80) + uint32 count(4) + 50 bytes/triangle. Real-world
  // exporters (and ascii→binary converters) often append a few trailing bytes
  // (newline/EOF markers), so require the payload to FIT rather than match
  // exactly — but cap the slack so unrelated binaries can't slip through.
  if (buffer.length >= 84) {
    const count = buffer.readUInt32LE(80);
    const expected = 84 + count * 50;
    if (count > 0 && buffer.length >= expected && buffer.length - expected <= 1024) {
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

/**
 * Same checks for a file that is already on disk (chunk-staged upload), where
 * reading the whole thing back into a Buffer would undo the point of streaming
 * it. Works from a head sample, a tail sample and the real size.
 *
 * `head` should be at least 256 KB — enough to reach the first `f` line of an
 * OBJ — and `tail` the last few KB, which is where an ASCII STL's `endsolid`
 * lives.
 */
export function validateStagedModel(
  head: Buffer,
  tail: Buffer,
  fileSize: number,
  fileName: string
): ModelValidationResult {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (!UPLOAD_MODEL_FORMATS.includes(ext as UploadModelFormat)) {
    return { ok: false, error: "unsupported_format" };
  }
  if (fileSize < 16) return { ok: false, error: "too_small" };

  if (ext === "stl") {
    const start = head.subarray(0, Math.min(512, head.length)).toString("latin1").trimStart();
    if (start.toLowerCase().startsWith("solid")) {
      const headText = head.toString("latin1");
      const tailText = tail.toString("latin1");
      if (headText.includes("facet") && (tailText.includes("endsolid") || headText.includes("endsolid"))) {
        return { ok: true, format: "stl" };
      }
    }
    // Binary STL: the triangle count in the header must match the file length.
    if (head.length >= 84 && fileSize >= 84) {
      const count = head.readUInt32LE(80);
      const expected = 84 + count * 50;
      if (count > 0 && fileSize >= expected && fileSize - expected <= 1024) {
        return { ok: true, format: "stl" };
      }
    }
    return { ok: false, error: "invalid_stl" };
  }

  const text = head.toString("utf8") + "\n" + tail.toString("utf8");
  const hasVertex = /^v\s+-?\d/m.test(text);
  const hasFace = /^f\s+\d/m.test(text);
  if (hasVertex && hasFace) return { ok: true, format: "obj" };
  return { ok: false, error: "invalid_obj" };
}
