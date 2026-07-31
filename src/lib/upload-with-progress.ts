/**
 * Upload with real progress.
 *
 * `fetch` cannot report upload progress — the spec has no upload-side stream —
 * so a 50 MB STL going through fetch() looks frozen from the moment you press
 * the button until the server answers. XMLHttpRequest still exposes
 * `upload.onprogress`, which is why this exists.
 *
 * The phases matter as much as the bytes: several of our endpoints keep working
 * after the last byte arrives (the model upload runs the geometry analysis in
 * the same request), so the UI must stop showing a bar stuck at 100% and say
 * "processing" instead.
 */

export type UploadPhase = "uploading" | "processing";

export interface UploadProgress {
  phase: UploadPhase;
  /** 0–100 for the upload phase; 100 once processing starts. */
  percent: number;
  loadedBytes: number;
  totalBytes: number;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly aborted = false,
    /** Parsed JSON error body, when the server sent one (e.g. `{ code }`). */
    public readonly body: unknown = null
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export interface UploadOptions {
  onProgress?: (p: UploadProgress) => void;
  /** Abort the request (wire to a "cancel" button). */
  signal?: AbortSignal;
  /** Milliseconds with no activity before giving up. 0 disables. */
  timeoutMs?: number;
  /**
   * Give up if not a single byte moves for this long. A reverse proxy whose
   * `client_max_body_size` is below the file simply stops reading the body:
   * the browser reports 0% forever and no error ever arrives. Without this the
   * UI just sits there. 0 disables.
   */
  stallTimeoutMs?: number;
}

/** Message used when an upload makes no progress at all. */
export const UPLOAD_STALLED_MESSAGE =
  "Yükleme ilerlemiyor. Dosya sunucuya ulaşamıyor — büyük ihtimalle sunucu " +
  "önündeki ara katmanın dosya boyutu sınırı bu dosyadan küçük. Yöneticinize " +
  "bildirin veya daha küçük bir dosya deneyin.";

/**
 * POSTs a FormData body and resolves with the parsed JSON response.
 * Rejects with an UploadError carrying the server's message when it has one.
 */
export function uploadWithProgress<T = unknown>(
  url: string,
  body: FormData,
  opts: UploadOptions = {}
): Promise<T> {
  const { onProgress, signal, timeoutMs = 0, stallTimeoutMs = 30000 } = opts;

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError("Yükleme iptal edildi.", 0, true));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.responseType = "text";
    if (timeoutMs > 0) xhr.timeout = timeoutMs;

    let total = 0;
    let lastLoaded = -1;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stalled = false;

    const clearStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };
    const armStall = () => {
      if (stallTimeoutMs <= 0) return;
      clearStall();
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, stallTimeoutMs);
    };
    armStall();

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      // Only a real byte movement resets the stall clock; browsers keep firing
      // progress events with an unchanged `loaded` while a connection hangs.
      if (e.loaded > lastLoaded) {
        lastLoaded = e.loaded;
        armStall();
      }
      total = e.total;
      onProgress?.({
        phase: "uploading",
        percent: Math.min(99, Math.round((e.loaded / e.total) * 100)),
        loadedBytes: e.loaded,
        totalBytes: e.total,
      });
    };

    // Every byte is out; whatever happens now is the server's work, which can
    // legitimately take a while (geometry analysis), so stop the stall clock.
    xhr.upload.onload = () => {
      clearStall();
      onProgress?.({
        phase: "processing",
        percent: 100,
        loadedBytes: total,
        totalBytes: total,
      });
    };

    const fail = (
      message: string,
      status = 0,
      aborted = false,
      body: unknown = null
    ) => {
      clearStall();
      reject(new UploadError(message, status, aborted, body));
    };

    xhr.onerror = () => fail("Bağlantı hatası — yükleme tamamlanamadı.");
    xhr.ontimeout = () => fail("Yükleme zaman aşımına uğradı.");
    // A stall aborts the request too — report it as a diagnosis, not a cancel,
    // so the caller shows it instead of silently swallowing it.
    xhr.onabort = () =>
      stalled
        ? fail(UPLOAD_STALLED_MESSAGE, 0, false)
        : fail("Yükleme iptal edildi.", 0, true);

    xhr.onload = () => {
      clearStall();
      const raw = xhr.responseText;
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T);
        return;
      }
      const serverMessage =
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : null;
      // 413 never reaches the route handler — it is the reverse proxy refusing
      // the body — so it has no JSON message of its own.
      const fallback =
        xhr.status === 413
          ? "Dosya sunucu limitini aşıyor."
          : `Yükleme başarısız (HTTP ${xhr.status}).`;
      fail(serverMessage || fallback, xhr.status, false, parsed);
    };

    if (signal) {
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(body);
  });
}

/** "12,4 MB" — for the byte counter next to the bar. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString("tr-TR", {
    maximumFractionDigits: 1,
  })} MB`;
}
