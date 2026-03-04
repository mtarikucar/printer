import { writeFile, readFile, mkdir } from "fs/promises";
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

export async function getFileBuffer(relativePath: string): Promise<Buffer> {
  const fullPath = resolve(UPLOAD_DIR, relativePath);
  // Prevent path traversal
  if (!fullPath.startsWith(UPLOAD_DIR)) {
    throw new Error("Invalid file path");
  }
  return readFile(fullPath);
}

export function getPublicUrl(relativePath: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${appUrl}/api/files/${relativePath}`;
}
