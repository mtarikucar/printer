import { unzipSync } from "fflate";
import { UPLOAD_MODEL_FORMATS } from "@/lib/config/upload";

/**
 * Pull the printable-model entries (STL/OBJ) out of a ZIP archive. Pure and
 * client-safe (fflate runs in the browser) so the spec editor can expand a
 * dropped ZIP into individual files and upload each through the existing
 * single-file endpoint — no server-side ZIP handling, no large combined body.
 *
 * Skips directories, the macOS `__MACOSX/` sidecar tree, dotfiles, and any
 * entry whose extension isn't an allowed model format. Names are flattened to
 * their basename (the part name is derived from the filename, not the path).
 */
export interface ModelEntry {
  name: string; // basename, e.g. "body.stl"
  bytes: Uint8Array;
}

export function extractModelEntriesFromZip(zip: Uint8Array): ModelEntry[] {
  const files = unzipSync(zip);
  const out: ModelEntry[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    // Directories come back as zero-length entries with a trailing slash.
    if (path.endsWith("/")) continue;
    if (path.startsWith("__MACOSX/") || path.includes("/__MACOSX/")) continue;
    const base = path.split("/").pop() ?? path;
    if (!base || base.startsWith(".")) continue; // dotfiles / resource forks
    if (!isModelFile(base)) continue;
    if (bytes.length === 0) continue;
    out.push({ name: base, bytes });
  }
  return out;
}

export function isModelFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return (UPLOAD_MODEL_FORMATS as readonly string[]).includes(ext);
}

export function isZipFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".zip");
}

/** "body.stl" -> "body" (basename without extension), capped for the column. */
export function partNameFromFileName(fileName: string): string {
  const base = (fileName.split("/").pop() ?? fileName).trim();
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.slice(0, 120);
}
