import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  ASSIGN_FAILURE_MESSAGES,
  SELLER_OVERRIDE_REASON_MIN_LENGTH,
  assignManufacturerToOrder,
} from "@/lib/services/manufacturer-assign";

/**
 * Admin'in tek siparişe elle üretici ataması.
 *
 * PAZARYERİ KURALI burada YENİDEN YAZILMAZ. Satıcının kendi kataloğundan çıkan
 * siparişin yalnız o atölyeye verilebilmesi kuralı, siparişe üretici yazan TEK
 * NOKTADA (assignManufacturerToOrder — E-C1) durur; bu rotanın işi yalnızca
 * reddi admin'in üzerinde işlem yapabileceği bir cevaba çevirmektir. Kural rota
 * başına kopyalandığı sürece bir sonraki yazıcı onu unutabiliyordu.
 *
 * AŞMA (sahibin kararı): kural kazara delinmemeli, ama satıcının atölyesi
 * temelli kapandığında admin'in elinde bir çıkış kalmalı. Bu yüzden ret
 * varsayılandır ve aşma üç şeyi birden ister: açık onay (`allowSellerOverride`),
 * işlemi yapan admin ve yazılı bir GEREKÇE. Denetim satırını ve satıcıya giden
 * bildirimi de aynı kapı yazar, yani aşma hiçbir yoldan sessiz kalamaz.
 * Toplu atama ucunda (api/admin/bulk-orders/assign) aşma YOKTUR: tek tıkla elli
 * siparişte mülkiyet aşmak kuralı kaldırmak olurdu.
 */
const schema = z.object(
  {
    manufacturerId: z
      .string({ error: "Üretici seçin." })
      .uuid({ error: "Geçerli bir üretici seçin." }),
    /** Satıcının kendi ürününü başka bir atölyeye vermek için AÇIK onay. */
    allowSellerOverride: z.boolean().optional(),
    /**
     * Aşmanın gerekçesi — denetim satırına aynen yazılır. Kısa bir "ok" işlemi
     * denetlenebilir kılmaz, o yüzden bir alt sınır vardır.
     *
     * Sayı BURADA YAZILMAZ, kapıdan içe aktarılır
     * (SELLER_OVERRIDE_REASON_MIN_LENGTH): baraj her rotada elle yazıldığı
     * sürece rotalar birbirinden ayrı düştü — bu uç 10 isterken geri alma ucu
     * 3 karakterlik "sebep"i gerekçe yerine geçiriyordu. Buradaki kontrol
     * yalnızca admin'e ERKEN haber vermek içindir; son sözü yine kapı söyler.
     */
    overrideReason: z
      .string({ error: "Mülkiyet devri için gerekçe zorunludur." })
      .trim()
      .min(SELLER_OVERRIDE_REASON_MIN_LENGTH, {
        error: `Mülkiyet devri gerekçesi en az ${SELLER_OVERRIDE_REASON_MIN_LENGTH} karakter olmalıdır.`,
      })
      .max(500, { error: "Gerekçe en fazla 500 karakter olabilir." })
      .optional(),
  },
  { error: "Geçersiz istek." }
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;

  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Üretici seçin." },
        { status: 400 }
      );
    }
    const { manufacturerId, overrideReason } = parsed.data;
    const wantsOverride = parsed.data.allowSellerOverride === true;

    // Onay var ama gerekçe yok: kapı bunu zaten reddeder (denetlenemeyen aşma
    // aşma değildir); admin'e sebebini burada söylemek, sessiz bir
    // "seller_owned" reddinden anlaşılırdır.
    if (wantsOverride && !overrideReason) {
      return NextResponse.json(
        {
          error:
            `Mülkiyet devri için gerekçe zorunludur (en az ${SELLER_OVERRIDE_REASON_MIN_LENGTH} karakter); ` +
            "gerekçe denetim kaydına yazılır.",
        },
        { status: 400 }
      );
    }

    // Validation, the atomic unassigned-guarded update, the ownership rule, the
    // audit row, the partner notification and the SSE emit all live in the
    // shared service — the automatic (platform-product) and decline-reassign
    // paths use the same one, so they can't drift apart.
    const result = await assignManufacturerToOrder({
      orderId: id,
      manufacturerId,
      adminEmail: a.session.user.email,
      allowSellerOverride: wantsOverride,
      ...(wantsOverride && overrideReason
        ? { sellerOverrideReason: overrideReason }
        : {}),
    });

    if (!result.ok) {
      if (result.reason === "seller_owned") {
        // Bu bir YARIŞ KAYBI değil: aynı isteği tekrar denemek hiçbir zaman
        // işe yaramaz, admin'in KARAR vermesi gerekir. O yüzden 409 ve ekranın
        // onay adımını açan açık bir işaret; satıcı da ADIYLA söylenir.
        const sellerLabel = result.sellerName
          ? `${result.sellerName} atölyesinin`
          : "bir satıcının";
        return NextResponse.json(
          {
            error:
              `Bu sipariş ${sellerLabel} kendi kataloğundan çıktı: normalde yalnız o atölyeye atanabilir. ` +
              `Yine de başka bir atölyeye vermek için onaylamanız ve gerekçe yazmanız gerekir; ` +
              `gerekçe denetim kaydına geçer ve satıcıya bildirim gider.`,
            reason: "seller_owned",
            requiresSellerOverride: true,
            sellerName: result.sellerName ?? null,
          },
          { status: 409 }
        );
      }
      // Same copy as the bulk assign route (ASSIGN_FAILURE_MESSAGES). Every
      // other reason is a 400, as before; a refunded order arrives as
      // not_assignable.
      return NextResponse.json(
        { error: ASSIGN_FAILURE_MESSAGES[result.reason] },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Assign manufacturer failed:", error);
    return NextResponse.json(
      { error: "Üretici atanamadı. Tekrar deneyin." },
      { status: 500 }
    );
  }
}
