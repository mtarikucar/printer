import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { adminActions, orderModelRevisions, orders } from "@/lib/db/schema";
import { createModelRevisionNoteSchema } from "@/lib/validators/order";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bir model sürümünün NOTUNU düzelt.
 *
 * Not, "bu sürüm neden yüklendi" sorusunun tek cevabıdır ve yükleme anında
 * yazılır; yanlış yazıldığında ya da hiç yazılmadığında düzeltmenin yolu yoktu.
 * Bu bir KAYIT düzeltmesidir: dosya kümesine, geçerli sürüme, partner onayına
 * ve paraya dokunmaz — o işler yükleme ucunun PATCH/DELETE yöntemlerinde durur.
 *
 * Bu yüzden burada partnerlere yeni bir duyuru YAPILMAZ: duyuru "yeni bir model
 * var, indir" demektir; not düzeltmesi öyle bir şey söylemez ve her yazım
 * düzeltmesinde üreticinin onay kapısını yeniden kapatırdı.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; revision: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;

    const { id, revision: revisionParam } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }
    const revision = Number(revisionParam);
    if (!Number.isInteger(revision) || revision <= 0) {
      return NextResponse.json({ error: "Geçersiz sürüm numarası." }, { status: 400 });
    }

    const parsed = createModelRevisionNoteSchema().safeParse(
      await request.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." },
        { status: 400 }
      );
    }
    // Boş dize "notu temizle" demektir; `undefined` ile aynı şey değildir.
    const next = parsed.data.note?.trim() ? parsed.data.note.trim() : null;

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }

    const [updated] = await db
      .update(orderModelRevisions)
      .set({ note: next })
      .where(
        and(eq(orderModelRevisions.orderId, id), eq(orderModelRevisions.revision, revision))
      )
      .returning({
        revision: orderModelRevisions.revision,
        note: orderModelRevisions.note,
      });

    if (!updated) {
      return NextResponse.json(
        { error: `Bu siparişte ${revision}. sürüm bulunamadı.` },
        { status: 404 }
      );
    }

    await db
      .insert(adminActions)
      .values({
        orderId: id,
        // admin_action_type bir pg enum'u ve bu faz ona değer eklemez; nötr
        // "edit" kullanılır, gerçek anlam notta durur.
        action: "edit",
        adminEmail,
        notes: next
          ? `Sürüm ${revision} notu güncellendi: ${next}`
          : `Sürüm ${revision} notu temizlendi.`,
      })
      .catch((e) => console.error("revision note: adminActions insert failed", e));

    return NextResponse.json({ success: true, revision: updated.revision, note: updated.note });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/admin/orders/[id]/model-revisions/[revision]", ADMIN_ACTION_FAILED_ERROR);
  }
}
