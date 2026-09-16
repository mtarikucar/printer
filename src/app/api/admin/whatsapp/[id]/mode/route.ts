import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { waConversations } from "@/lib/db/schema";
import { setMode } from "@/lib/services/whatsapp-conversation";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const schema = z.object({ mode: z.enum(["bot", "human", "blocked"]) });

/**
 * Hand a conversation to a human, give it back to the bot, or block it.
 *
 * 'human' silences every machine message on the thread; only `senderKind:
 * "admin"` still goes out. Handing it back to 'bot' is the transition that has
 * to be deliberate — the UI confirms it explicitly.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Geçersiz mod" }, { status: 400 });
    }

    const [conversation] = await db
      .select({ id: waConversations.id })
      .from(waConversations)
      .where(eq(waConversations.id, id))
      .limit(1);
    if (!conversation) {
      return NextResponse.json({ error: "Konuşma bulunamadı" }, { status: 404 });
    }

    await setMode(id, parsed.data.mode);
    return NextResponse.json({ ok: true, mode: parsed.data.mode });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/whatsapp/[id]/mode", ADMIN_ACTION_FAILED_ERROR);
  }
}
