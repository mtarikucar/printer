import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, orderPhotos, adminActions } from "@/lib/db/schema";
import { fileKeyFromUrl, getPublicUrl } from "@/lib/services/storage";
import {
  PHOTO_FILE_GRACE_DAYS,
  pendingDeletionMark,
  sweepExpiredPhotoFiles,
} from "@/lib/services/photo-file-retention";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Admin add/remove reference photos on an existing order. Photos are uploaded
 * first via /api/admin/orders/upload-photo (which returns storage keys); this
 * route attaches them as order_photos rows (POST) or detaches one (DELETE).
 * Used for WhatsApp / admin-fulfilled orders whose reference photos change after
 * the order was created.
 *
 * Her iki işlem de DENETİM KAYDINA yazılır. Referans fotoğrafı, siparişin ne
 * olduğunun kanıtıdır: kimin hangi fotoğrafı eklediği ya da kaldırdığı
 * kaydedilmezse, "üretici yanlış figürü bastı" tartışmasında kimse neyin ne
 * zaman değiştiğini gösteremez.
 *
 * Dosyanın kendisi hemen silinmez; bekleme süresi, işaretler ve referans
 * sayımı photo-file-retention.ts'te (aynı süpürme saatlik worker'dan da
 * koşar, bu uca trafik gelmese bile).
 */
const addSchema = z.object({
  photoKeys: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;
    const { id } = await params;

    const parsed = addSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
    }

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }

    const rows = await db
      .insert(orderPhotos)
      .values(
        parsed.data.photoKeys.map((key) => ({
          orderId: id,
          originalUrl: getPublicUrl(key),
        }))
      )
      .returning({ id: orderPhotos.id, originalUrl: orderPhotos.originalUrl });

    await db
      .insert(adminActions)
      .values({
        orderId: id,
        // admin_action_type bir pg enum'u; bu faz migration açmadığı için nötr
        // "edit" kullanılır ve gerçek anlam notta durur.
        action: "edit",
        adminEmail,
        notes: `${rows.length} referans fotoğrafı eklendi: ${parsed.data.photoKeys.join(", ")}`,
      })
      .catch((e) => console.error("photos add: adminActions insert failed", e));

    await sweepExpiredPhotoFiles().catch((e) => console.error("photo sweep failed", e));

    return NextResponse.json({ ok: true, photos: rows });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/photos", ADMIN_ACTION_FAILED_ERROR);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const photoId = body?.photoId;
    if (typeof photoId !== "string") {
      return NextResponse.json({ error: "photoId gerekli." }, { status: 400 });
    }

    // Satır önce okunur: URL gidince dosyanın anahtarı da giderdi ve dosya
    // sonsuza kadar diskte kalırdı. Küçük görsel (thumbnail) de okunur —
    // AYNI FOTOĞRAFIN ikinci dosyasıdır ve daha önce hiç işaretlenmiyordu, yani
    // "silindi" denen yüz küçük boyutta diskte kalmaya devam ediyordu (KVKK
    // süpürmesinin var oluş sebebi tam olarak buydu).
    const [removed] = await db
      .delete(orderPhotos)
      .where(and(eq(orderPhotos.id, photoId), eq(orderPhotos.orderId, id)))
      .returning({
        id: orderPhotos.id,
        originalUrl: orderPhotos.originalUrl,
        thumbnailUrl: orderPhotos.thumbnailUrl,
      });

    if (!removed) {
      return NextResponse.json({ error: "Fotoğraf bulunamadı." }, { status: 404 });
    }

    const urls = [removed.originalUrl, removed.thumbnailUrl].filter(
      (u): u is string => !!u
    );
    // Aynı anahtar iki kez işaretlenmemeli: süpürme her işareti ayrı ayrı
    // sonuçlandırır ve yinelenen anahtar sayacı şişirirdi.
    const keys = [...new Set(urls.map((u) => fileKeyFromUrl(u)).filter((k): k is string => !!k))];
    const unresolved = urls.filter((u) => !fileKeyFromUrl(u));

    const notes =
      `Referans fotoğrafı kaldırıldı (${photoId}). ` +
      (keys.length > 0
        ? `${keys.length} dosya (asıl görsel + varsa küçük görsel) ${PHOTO_FILE_GRACE_DAYS} gün ` +
          `sonra silinecek. ${keys.map(pendingDeletionMark).join(" ")}`
        : "") +
      (unresolved.length > 0
        ? ` Şu adreslerin dosya anahtarı çözülemedi, dosya diskte kaldı: ${unresolved.join(", ")}`
        : "");

    await db
      .insert(adminActions)
      .values({ orderId: id, action: "edit", adminEmail, notes })
      .catch((e) => console.error("photos delete: adminActions insert failed", e));

    await sweepExpiredPhotoFiles().catch((e) => console.error("photo sweep failed", e));

    return NextResponse.json({ ok: true, fileDeletionAfterDays: PHOTO_FILE_GRACE_DAYS });
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/admin/orders/[id]/photos", ADMIN_ACTION_FAILED_ERROR);
  }
}
