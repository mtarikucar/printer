import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

let cachedData: Record<string, Record<string, string[]>> | null = null;

async function getNeighborhoodData() {
  if (cachedData) return cachedData;
  const filePath = join(process.cwd(), "src/lib/data/turkey-neighborhoods.json");
  const raw = await readFile(filePath, "utf-8");
  cachedData = JSON.parse(raw);
  return cachedData!;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const il = searchParams.get("il");
  const ilce = searchParams.get("ilce");

  if (!il || !ilce) {
    return NextResponse.json({ neighborhoods: [] });
  }

  try {
    const data = await getNeighborhoodData();
    // Strip "(Merkez)" suffix — our dropdown uses it but the JSON data doesn't
    const ilceClean = ilce.replace(" (Merkez)", "");
    const neighborhoods = data[il]?.[ilce] ?? data[il]?.[ilceClean] ?? [];
    return NextResponse.json({ neighborhoods });
  } catch {
    return NextResponse.json({ neighborhoods: [] });
  }
}
