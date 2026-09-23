import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import {
  catalogOutcome,
  createTechnology,
  listCatalogForAdmin,
} from "@/lib/services/quote-catalog-admin";
import { technologyCreateSchema } from "@/lib/validators/print-catalog";
import { catalogRefusal, invalidBody, revalidateCatalogSurfaces } from "../_shared";

/**
 * Baskı teknolojileri (FDM, SLA, …).
 *
 * DELETE YOKTUR ve olmayacak: `quote_parts.technology_key` bu anahtara metin
 * olarak bakar, FK'ler `restrict`tir. Kullanımdan kaldırma `PATCH { active:
 * false }` ile yapılır — eski teklifler kendi anlık görüntüsüyle okunmaya
 * devam eder.
 */
export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const outcome = await catalogOutcome(() => listCatalogForAdmin());
    if (!outcome.ok) return catalogRefusal(outcome);
    return NextResponse.json({ technologies: outcome.value.technologies });
  } catch (e) {
    return handleRouteFailure(
      e,
      "GET /api/admin/print-catalog/technologies",
      ADMIN_READ_FAILED_ERROR
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = technologyCreateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return invalidBody(parsed.error);

    const outcome = await catalogOutcome(() =>
      createTechnology(parsed.data, a.session.user.email)
    );
    if (!outcome.ok) return catalogRefusal(outcome);

    revalidateCatalogSurfaces();
    return NextResponse.json({ success: true, technology: outcome.value }, { status: 201 });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/print-catalog/technologies",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
