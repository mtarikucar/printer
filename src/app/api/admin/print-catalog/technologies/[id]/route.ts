import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import {
  activeMaterialCount,
  catalogOutcome,
  otherActiveTechnologyCount,
  updateTechnology,
} from "@/lib/services/quote-catalog-admin";
import { technologyPatchSchema } from "@/lib/validators/print-catalog";
import {
  catalogRefusal,
  invalidBody,
  NOT_FOUND_RESPONSE,
  parseCatalogId,
  revalidateCatalogSurfaces,
} from "../../_shared";

/**
 * Teknolojinin güncellenmesi (pasifleştirme dahil).
 *
 * Pasifleştirme ENGELLENMEZ ama SESSİZ de kalmaz: aktif malzemesi olan bir
 * teknolojiyi kapatmak, o malzemeleri `loadActiveSnapshot`tan düşürür — yönetici
 * ekranında malzeme hâlâ "açık" görünür ama müşteri onu asla göremez. Son aktif
 * teknolojiyi kapatmak ise kataloğu tamamen boşaltır ve hiçbir teklif açılamaz.
 * Uyarı cevabın içinde döner; kararı sahibi verir.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const params = await context.params;
    const id = parseCatalogId(params.id);
    if (!id) return NOT_FOUND_RESPONSE();

    const parsed = technologyPatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return invalidBody(parsed.error);

    const outcome = await catalogOutcome(() =>
      updateTechnology(id, parsed.data, a.session.user.email)
    );
    if (!outcome.ok) return catalogRefusal(outcome);
    const technology = outcome.value;

    const warnings: string[] = [];
    if (!technology.active) {
      const [materials, others] = await Promise.all([
        activeMaterialCount(id),
        otherActiveTechnologyCount(id),
      ]);
      if (materials > 0) {
        warnings.push(
          `Bu teknolojiye bağlı ${materials} aktif malzeme artık müşteriye görünmüyor.`
        );
      }
      if (others === 0) {
        warnings.push("Aktif başka teknoloji kalmadı: katalog boş, yeni teklif açılamaz.");
      }
    }

    revalidateCatalogSurfaces();
    return NextResponse.json({ success: true, technology, warnings });
  } catch (e) {
    return handleRouteFailure(
      e,
      "PATCH /api/admin/print-catalog/technologies/[id]",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
