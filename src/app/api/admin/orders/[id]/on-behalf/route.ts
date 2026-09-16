import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isCarrier } from "@/lib/services/carriers";
import {
  isOnBehalfAction,
  onBehalfOfPartner,
  ON_BEHALF_ACTIONS,
} from "@/lib/services/on-behalf";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/** Bozuk bir [id] Postgres'te 22P02 fırlatır; kardeş rotalarla aynı kapı. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin, siparişi tutan partnerin (üretici ya da boyacı) KENDİ adımını onun
 * yerine yapar: kabul, üretimi bitir, QC'ye gönder, kargola.
 *
 * Rota hiçbir geçişi kendisi yazmaz — işi tek servise (P2-C4,
 * services/on-behalf.ts) devreder. Sebep: aynı geçişi burada yeniden yazmak
 * partnerin kendi rotasının bir kopyasını üretir ve kopya parada ayrışır.
 * Gerekçe zorunludur; denetim kaydına ve partnerin zaman çizelgesine yazılır.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      reason?: unknown;
      trackingNumber?: unknown;
      carrier?: unknown;
    };

    if (!isOnBehalfAction(body.action)) {
      return NextResponse.json(
        {
          error: `Geçersiz işlem. Seçenekler: ${ON_BEHALF_ACTIONS.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    // Firma DOĞRULAMASI burada, ZORUNLULUK serviste: partner adına kargolamanın
    // kuralları tek yerde (services/on-behalf.ts) durur, yoksa bu rota ile
    // admin'in kargo uçları aynı işi iki türlü kısıtlardı.
    const carrier =
      typeof body.carrier === "string" && isCarrier(body.carrier) ? body.carrier : undefined;
    if (body.action === "ship" && body.carrier !== undefined && !carrier) {
      return NextResponse.json({ error: "Geçersiz kargo firması." }, { status: 400 });
    }

    const result = await onBehalfOfPartner({
      orderId: id,
      action: body.action,
      adminEmail,
      // Gerekçe doğrulaması (zorunluluk + uzunluk) tek yerde, serviste durur.
      reason: typeof body.reason === "string" ? body.reason : "",
      trackingNumber: typeof body.trackingNumber === "string" ? body.trackingNumber : undefined,
      carrier,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.httpStatus }
      );
    }

    return NextResponse.json({
      success: true,
      partner: result.partner,
      action: result.action,
      status: result.status,
      partnerStatus: result.partnerStatus,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/on-behalf", ADMIN_ACTION_FAILED_ERROR);
  }
}
