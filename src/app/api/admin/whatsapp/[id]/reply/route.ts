import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { waConversations } from "@/lib/db/schema";
import { isWindowOpen } from "@/lib/services/whatsapp-conversation";
import { getWaOutboundQueue } from "@/lib/queue/queues";
import { MAX_TEXT_LENGTH, WA_TEMPLATES } from "@/lib/config/whatsapp";

const APPROVED_TEMPLATES = new Set<string>(Object.values(WA_TEMPLATES));

const schema = z
  .object({
    body: z.string().trim().min(1).max(MAX_TEXT_LENGTH).optional(),
    templateName: z.string().trim().min(1).max(200).optional(),
    templateParams: z.array(z.string().max(500)).max(10).optional(),
  })
  .refine((v) => !!v.body !== !!v.templateName, {
    message: "Ya serbest metin ya da bir şablon gönderin",
  });

/**
 * An admin's own reply into a WhatsApp thread.
 *
 * `senderKind: "admin"` is load-bearing: it is the only sender the outbound
 * worker still delivers once a human holds the conversation (mode 'human'),
 * where every machine message is suppressed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  const [conversation] = await db
    .select({
      phoneE164: waConversations.phoneE164,
      mode: waConversations.mode,
    })
    .from(waConversations)
    .where(eq(waConversations.id, id))
    .limit(1);
  if (!conversation) {
    return NextResponse.json({ error: "Konuşma bulunamadı" }, { status: 404 });
  }
  if (conversation.mode === "blocked") {
    return NextResponse.json(
      { error: "Bu konuşma engelli; mesaj gönderilemez." },
      { status: 409 }
    );
  }

  if (parsed.data.templateName) {
    // Only templates Meta has approved for this WABA can leave the building.
    // A MARKETING template would also be a ticari elektronik ileti under ETK
    // 6563, which this platform has no İYS record to send.
    if (!APPROVED_TEMPLATES.has(parsed.data.templateName)) {
      return NextResponse.json(
        { error: "Onaylı olmayan şablon" },
        { status: 400 }
      );
    }
    await getWaOutboundQueue().add("admin-template", {
      conversationId: id,
      to: conversation.phoneE164,
      kind: "template",
      templateName: parsed.data.templateName,
      templateParams: parsed.data.templateParams ?? [],
      senderKind: "admin",
    });
    return NextResponse.json({ ok: true, kind: "template" });
  }

  // Free-form outside the 24-hour service window is refused by Meta with
  // 131047 and the customer gets nothing. The worker would fall back to a
  // template — but an admin reply has none, so it would be dropped silently.
  // Refuse here instead, where the admin can still see it and pick a template.
  if (!(await isWindowOpen(id))) {
    return NextResponse.json(
      {
        error:
          "24 saatlik hizmet penceresi kapalı. Serbest metin Meta tarafından " +
          "reddedilir (131047); onaylı bir şablon gönderin.",
      },
      { status: 409 }
    );
  }

  await getWaOutboundQueue().add("admin-reply", {
    conversationId: id,
    to: conversation.phoneE164,
    kind: "text",
    body: parsed.data.body!,
    senderKind: "admin",
  });

  return NextResponse.json({ ok: true, kind: "text" });
}
