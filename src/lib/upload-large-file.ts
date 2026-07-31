import {
  UploadError,
  type UploadProgress,
  type UploadOptions,
} from "./upload-with-progress";

/**
 * Uploads a file of any size by slicing it into chunks.
 *
 * A single multipart POST cannot carry a 350 MB model: the server would have to
 * buffer the whole body in memory, and every reverse proxy in the path enforces
 * its own body-size ceiling. Chunks sidestep both — the proxy only ever sees an
 * 8 MB request, and the server appends each chunk to disk as it arrives.
 *
 * It also survives a dropped chunk: the server answers with the byte offset it
 * actually holds, and the upload resumes from there instead of starting over.
 */

const MAX_CHUNK_ATTEMPTS = 4;
/** Never go below this; at some point the proxy is simply broken. */
const MIN_CHUNK_SIZE = 256 * 1024;

export interface LargeUploadResult {
  /** Hand this to the feature endpoint instead of the file itself. */
  uploadId: string;
  fileName: string;
  size: number;
}

export async function uploadLargeFile(
  file: File,
  opts: Omit<UploadOptions, "timeoutMs"> = {}
): Promise<LargeUploadResult> {
  const { onProgress, signal } = opts;

  const initRes = await fetch("/api/uploads/chunk", { method: "PUT", signal });
  if (!initRes.ok) {
    throw new UploadError(
      (await initRes.json().catch(() => ({}))).error || "Yükleme başlatılamadı.",
      initRes.status
    );
  }
  const init = (await initRes.json()) as { uploadId: string; chunkSize: number };
  const uploadId = init.uploadId;
  // Adaptive: a reverse proxy with a small `client_max_body_size` answers 413,
  // and we simply use smaller chunks rather than failing the upload.
  let chunkSize = init.chunkSize;

  let offset = 0;
  const report = (loaded: number) =>
    onProgress?.({
      phase: "uploading",
      percent: Math.min(99, Math.round((loaded / file.size) * 100)),
      loadedBytes: loaded,
      totalBytes: file.size,
    } as UploadProgress);

  report(0);

  while (offset < file.size) {
    if (signal?.aborted) throw new UploadError("Yükleme iptal edildi.", 0, true);
    const startOffset = offset;
    // Set when a 413 makes us re-slice the SAME offset with a smaller chunk;
    // that is deliberate, not a stalled upload.
    let reslice = false;
    const end = Math.min(offset + chunkSize, file.size);
    const blob = file.slice(offset, end);

    let attempt = 0;
    for (;;) {
      attempt++;
      const res = await fetch(
        `/api/uploads/chunk?uploadId=${encodeURIComponent(uploadId)}&offset=${offset}`,
        { method: "POST", body: blob, signal }
      ).catch((e) => {
        if (signal?.aborted) throw new UploadError("Yükleme iptal edildi.", 0, true);
        return e as null;
      });

      if (res && res.ok) {
        const { size } = (await res.json()) as { size: number };
        offset = size;
        report(offset);
        break;
      }

      // The server knows the truth about how much it holds; resync and retry.
      if (res && res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { size?: number };
        if (typeof data.size === "number") {
          offset = data.size;
          report(offset);
          break;
        }
      }
      if (res && res.status === 413 && chunkSize > MIN_CHUNK_SIZE) {
        chunkSize = Math.max(MIN_CHUNK_SIZE, Math.floor(chunkSize / 2));
        reslice = true;
        break; // retry this offset with the smaller chunk
      }
      if (res && res.status === 404) {
        throw new UploadError(
          "Yükleme oturumu düştü; lütfen tekrar deneyin.",
          404
        );
      }
      if (attempt >= MAX_CHUNK_ATTEMPTS) {
        const message =
          (res && (await res.json().catch(() => ({}))).error) ||
          "Parça gönderilemedi — bağlantı koptu.";
        throw new UploadError(String(message), res?.status ?? 0);
      }
      // Back off a little before retrying the same chunk.
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    // Guard against a server that accepts a chunk but reports no growth.
    if (!reslice && offset === startOffset) {
      throw new UploadError("Yükleme ilerlemiyor — sunucu parçayı kabul etmedi.", 0);
    }
  }

  onProgress?.({
    phase: "processing",
    percent: 100,
    loadedBytes: file.size,
    totalBytes: file.size,
  });

  return { uploadId, fileName: file.name, size: file.size };
}
