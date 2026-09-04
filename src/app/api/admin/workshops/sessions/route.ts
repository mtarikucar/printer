import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSessionSchema } from "@/lib/validators/workshop";
import { createSession, sessionJoinUrl } from "@/lib/services/workshop-session";

/** Bir mekanda yeni seans (gün+saat) açar. Başlangıçta `draft` durumundadır. */
export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const parsed = createSessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  const result = await createSession({
    ...parsed.data,
    startsAt: new Date(parsed.data.startsAt),
    manufacturerId: parsed.data.manufacturerId ?? null,
    adminNotes: parsed.data.adminNotes ?? null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    sessionId: result.sessionId,
    joinUrl: sessionJoinUrl(result.joinToken),
  });
}
