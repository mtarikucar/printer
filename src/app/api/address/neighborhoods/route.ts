import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { handleRouteFailure, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

let cachedData: Record<string, Record<string, string[]>> | null = null;

async function getNeighborhoodData() {
  if (cachedData) return cachedData;
  const filePath = join(process.cwd(), "src/lib/data/turkey-neighborhoods.json");
  const raw = await readFile(filePath, "utf-8");
  cachedData = JSON.parse(raw);
  return cachedData!;
}

async function handleGET(request: NextRequest) {
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

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(request: NextRequest) {
  try {
    return await handleGET(request);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/address/neighborhoods", CUSTOMER_READ_FAILED_ERROR);
  }
}
