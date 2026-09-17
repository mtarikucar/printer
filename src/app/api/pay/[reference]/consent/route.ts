import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { recordDraftCommercialConsent, DraftConsentInputError } from "@/lib/services/draft-commercial-consent";
import { rateLimitAsync } from "@/lib/services/rate-limit";
import { getClientIp } from "@/lib/utils/request";
import { handleRouteFailure, CUSTOMER_PAYMENT_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Record the customer's image/likeness + KVKK consent on a WhatsApp order draft.
 *
 * The /pay/<ref> gate calls this the moment BOTH consent boxes are ticked, so the
 * consent is captured before payment (card OR havale) and carried onto the order
 * at draft→order promotion. On-site orders capture the same stamp inline in
 * POST /api/orders; this is the WhatsApp equivalent, where the draft was created
 * by an admin who cannot consent on the customer's behalf.
 *
 * Keyed only by reference — same trust model as the paytr token route: the
 * reference is the unguessable secret in the WhatsApp link. Rate-limited so the
 * endpoint can't be used to probe which references exist.
 */
async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params;
  const ip = await getClientIp();

  const perIp = await rateLimitAsync(`payconsent:${reference}:${ip}`, 10, 60_000);
  const perRef = await rateLimitAsync(`payconsent:ref:${reference}`, 20, 60_000);
  if (!perIp.success || !perRef.success) {
    return NextResponse.json(
      { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." },
      { status: 429 }
    );
  }

  const parsed = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ödeme bilgileri doğrulanamadı. Sayfayı yenileyip tekrar onaylayın." }, { status: 400 });
  try {
    await recordDraftCommercialConsent({ reference, fingerprint: parsed.data.fingerprint, ip, userAgent: request.headers.get("user-agent") });
  } catch (error) {
    if (error instanceof DraftConsentInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  return NextResponse.json({ ok: true });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePOST` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ reference: string }> }) {
  try {
    return await handlePOST(request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/pay/[reference]/consent", CUSTOMER_PAYMENT_FAILED_ERROR);
  }
}
