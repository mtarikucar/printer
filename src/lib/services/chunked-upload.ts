import { createWriteStream } from "fs";
import { mkdir, rm, rename, stat, readdir } from "fs/promises";
import { join, resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { nanoid } from "nanoid";

/**
 * Chunked upload staging.
 *
 * A 350 MB print model cannot go through `request.formData()`: Next buffers the
 * whole multipart body in memory and `file.arrayBuffer()` then makes a second
 * copy, so one upload costs ~2× the file in RAM and takes the container down.
 * It also has to survive whatever `client_max_body_size` the reverse proxy in
 * front of us happens to carry.
 *
 * So the client slices the file and posts one chunk at a time; each chunk is
 * streamed straight to disk and appended. Memory stays flat regardless of file
 * size, and the proxy only ever sees a chunk-sized request.
 */

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || "./uploads");
const STAGING_DIR = join(UPLOAD_DIR, "staging");

/** Chunk size the client should use. Small enough for a modest proxy limit. */
export const UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

/** Staged uploads older than this are abandoned and swept. */
export const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

function stagingPathFor(uploadId: string): string {
  // uploadId is minted server-side (nanoid), never taken from the client, so it
  // cannot walk out of the staging directory.
  return join(STAGING_DIR, uploadId);
}

/** A staged upload id is an opaque nanoid — reject anything else outright. */
export function isValidUploadId(id: string): boolean {
  return /^[A-Za-z0-9_-]{16,32}$/.test(id);
}

export async function createStagedUpload(): Promise<string> {
  await mkdir(STAGING_DIR, { recursive: true });
  const id = nanoid(24);
  // Create the file up front so appends have something to open.
  await pipeline(Readable.from([]), createWriteStream(stagingPathFor(id)));
  return id;
}

/**
 * Appends one chunk. `expectedOffset` is the byte position the client believes
 * it is writing at; if it disagrees with the file on disk the chunk is refused,
 * which is what makes a retried or out-of-order chunk safe.
 */
export async function appendChunk(
  uploadId: string,
  body: ReadableStream<Uint8Array> | null,
  expectedOffset: number
): Promise<{ ok: true; size: number } | { ok: false; reason: string; size: number }> {
  const path = stagingPathFor(uploadId);
  let current: number;
  try {
    current = (await stat(path)).size;
  } catch {
    return { ok: false, reason: "unknown_upload", size: 0 };
  }
  if (current !== expectedOffset) {
    // Idempotent retry of an already-written chunk, or a lost one. Tell the
    // client where we actually are and let it resume from there.
    return { ok: false, reason: "offset_mismatch", size: current };
  }
  if (!body) return { ok: false, reason: "empty_body", size: current };

  // Stream straight to disk; the chunk never lands in a Buffer.
  await pipeline(
    Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path, { flags: "a" })
  );
  const size = (await stat(path)).size;
  return { ok: true, size };
}

export async function stagedSize(uploadId: string): Promise<number | null> {
  try {
    return (await stat(stagingPathFor(uploadId))).size;
  } catch {
    return null;
  }
}

/**
 * Moves a completed staged file into its final place under UPLOAD_DIR and
 * returns the storage key. A rename inside the same volume is instant and
 * never reads the bytes.
 */
export async function promoteStagedUpload(
  uploadId: string,
  subdir: string,
  filename: string
): Promise<string> {
  const dir = join(UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, filename);
  await rename(stagingPathFor(uploadId), dest);
  return `${subdir}/${filename}`;
}

export async function discardStagedUpload(uploadId: string): Promise<void> {
  await rm(stagingPathFor(uploadId), { force: true });
}

/** Reads the first N bytes of a staged file — enough for magic-byte checks. */
export async function readStagedHead(
  uploadId: string,
  bytes: number
): Promise<Buffer> {
  const { open } = await import("fs/promises");
  const fh = await open(stagingPathFor(uploadId), "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Reads the last N bytes of a staged file (ASCII STL's `endsolid` lives there). */
export async function readStagedTail(
  uploadId: string,
  bytes: number
): Promise<Buffer> {
  const { open } = await import("fs/promises");
  const path = stagingPathFor(uploadId);
  const size = (await stat(path)).size;
  const start = Math.max(0, size - bytes);
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(Math.min(bytes, size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Drops staged files nobody completed. Called by the cleanup worker. */
export async function sweepStagedUploads(): Promise<number> {
  let names: string[];
  try {
    names = await readdir(STAGING_DIR);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - STAGING_TTL_MS;
  let removed = 0;
  for (const name of names) {
    const p = join(STAGING_DIR, name);
    try {
      const st = await stat(p);
      if (st.mtimeMs < cutoff) {
        await rm(p, { force: true });
        removed++;
      }
    } catch {
      // raced with another sweep; nothing to do
    }
  }
  return removed;
}
