import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";
import { applyDraftAction, DraftActionError } from "./_actions";
import { DRAFT_INPUT_ERROR, draftActionSchema } from "./_policy";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    if ("response" in admin) return admin.response;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Taslak bulunamadı." }, { status: 404 });
    const parsed = draftActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: DRAFT_INPUT_ERROR }, { status: 400 });
    try {
      return NextResponse.json(await applyDraftAction(id, parsed.data, admin.session.user.email));
    } catch (error) {
      if (error instanceof DraftActionError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  } catch (error) {
    return handleRouteFailure(error, "PATCH /api/admin/drafts/[id]", ADMIN_ACTION_FAILED_ERROR);
  }
}
