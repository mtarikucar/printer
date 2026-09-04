import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listVenues, createVenue } from "@/lib/services/workshop-venue";
import { createVenueSchema } from "@/lib/validators/workshop";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";

export async function GET() {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  return NextResponse.json({ venues: await listVenues() });
}

/** Talepsiz, doğrudan mekan yaratma (telefonla anlaşılmış kafe). */
export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const parsed = createVenueSchema(getRequestLocale(request)).safeParse(
    await request.json().catch(() => ({}))
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }
  return NextResponse.json(await createVenue(parsed.data));
}
