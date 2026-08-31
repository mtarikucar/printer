import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { findDraftByReference } from "@/lib/services/order-draft";
import { CONTENT_CONSENT_VERSION } from "@/lib/config/content-consent";
import {
  PRELIMINARY_INFO_VERSION,
  DISTANCE_CONTRACT_VERSION,
} from "@/lib/config/distance-contract";
import { rateLimitAsync } from "@/lib/services/rate-limit";
import { getClientIp } from "@/lib/utils/request";

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
export async function POST(
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

  const draft = await findDraftByReference(reference);
  if (!draft) {
    return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
  }
  if (draft.status !== "pending" && draft.status !== "awaiting_review") {
    return NextResponse.json(
      { error: "Bu sipariş için onay alınamaz." },
      { status: 400 }
    );
  }

  // Idempotent: the first consent wins so the original timestamp survives
  // re-ticks / page refreshes (the stamp is an audit trail, not a toggle).
  if (!draft.contentConsentAt) {
    await db
      .update(orderDrafts)
      .set({
        contentConsentAt: new Date(),
        contentConsentVersion: CONTENT_CONSENT_VERSION,
      })
      .where(eq(orderDrafts.id, draft.id));
  }

  // Mesafeli sözleşme ön bilgilendirme onayı (MSY m.6/2-a) — ayrı ve bağımsız
  // damga. WhatsApp akışında sohbette ön bilgilendirme YAPILAMAZ (m.6 yazılı
  // ortam ve bütünlük ister); tek geçerli an ödeme sayfasıdır. İçerik onayından
  // ayrı tutulur ki hangisinin ne zaman alındığı ayrı ayrı ispatlanabilsin.
  if (!draft.preliminaryInfoAcceptedAt) {
    await db
      .update(orderDrafts)
      .set({
        preliminaryInfoAcceptedAt: new Date(),
        preliminaryInfoVersion: PRELIMINARY_INFO_VERSION,
        distanceContractVersion: DISTANCE_CONTRACT_VERSION,
        consentIp: ip,
        consentUserAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      })
      .where(eq(orderDrafts.id, draft.id));
  }

  return NextResponse.json({ ok: true });
}
