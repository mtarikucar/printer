import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { setVenueStatus } from "@/lib/services/workshop-venue";
import { updateVenueStatusSchema } from "@/lib/validators/workshop";

/** Mekan durumu: active | paused | archived. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const parsed = updateVenueStatusSchema.safeParse(
    await request.json().catch(() => ({}))
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  const ok = await setVenueStatus(id, parsed.data.status);
  if (!ok) {
    return NextResponse.json({ error: "Mekan bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
