import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { join, resolve, relative, dirname } from "path";

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || "./uploads");

export async function saveFile(
  buffer: Buffer,
  subdir: string,
  filename: string
): Promise<string> {
  const dir = join(UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);
  await writeFile(filePath, buffer);
  return `${subdir}/${filename}`;
}

function assertSafePath(fullPath: string): void {
  // Ensure path is strictly within UPLOAD_DIR (prevent prefix ambiguity like /uploads-evil)
  if (!fullPath.startsWith(UPLOAD_DIR + "/") && fullPath !== UPLOAD_DIR) {
    throw new Error("Invalid file path");
  }
}

export async function getFileBuffer(relativePath: string): Promise<Buffer> {
  const fullPath = resolve(UPLOAD_DIR, relativePath);
  assertSafePath(fullPath);
  return readFile(fullPath);
}

export async function deleteFile(relativePath: string): Promise<void> {
  const fullPath = resolve(UPLOAD_DIR, relativePath);
  assertSafePath(fullPath);
  await rm(fullPath, { force: true });
}

export function getPublicUrl(relativePath: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${appUrl}/api/files/${relativePath}`;
}
