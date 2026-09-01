import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentOrderSpecs, orderDrafts, waConversations } from "@/lib/db/schema";
import { buildDraftReference } from "./order-draft";
import { resolveOrCreateGuestUser } from "./guest-user";
import {
  itemPriceKurus,
  calculateUpsellAmount,
  MAX_AMOUNT_KURUS,
  finishNeedsPainter,
  paintingPortionKurus,
} from "@/lib/config/prices";
import { orderNeedsPainting } from "@/lib/services/earning-base";
import { priceKindForStyle } from "@/lib/create/design-templates";
import { calculateHavaleDiscount } from "@/lib/config/payment";
import { CONTENT_CONSENT_VERSION } from "@/lib/config/content-consent";

type OrderFinish =
  | "paintable_kit"
  | "hand_painted"
  | "collector_raw"
  | "luxe_display"
  | "raw"
  | "smoothed"
  | "painted";

/**
 * Create the order draft for a WhatsApp conversation.
 *
 * This deliberately does NOT call POST /api/orders. That route's draft-insert
 * block cannot be lifted out: it reads attribution columns from
 * `@/lib/analytics/attribution-server`, which is the one real `import
 * "server-only"` module in this repo, and importing it from a BullMQ worker
 * crash-loops the standalone Node process (real incident, fix 470bf22). The
 * admin's own WhatsApp order tool is already a second draft writer, so this is
 * the established shape rather than a new one.
 *
 * The amount is computed HERE, from the stored spec, with the same
 * `itemPriceKurus` the web checkout uses. Nothing the model said is read. That
 * is the actual enforcement behind "the agent cannot set a price" — the
 * absence of an argument on `create_draft`, plus this recomputation.
 *
 * NOTE: no `import "server-only"` — this runs inside the BullMQ worker.
 */

export interface WhatsAppOrderSpec {
  style?: string;
  size?: string;
  material?: "resin" | "filament";
  finish?: string;
  upsells?: string[];
  photoKeys?: string[];
  previewId?: string;
  fullName?: string;
  email?: string;
  address?: {
    adres: string;
    mahalle: string;
    ilce: string;
    il: string;
    postaKodu: string;
    telefon: string;
  };
}

export type CreateDraftResult =
  | { ok: true; reference: string; payUrl: string; amountKurus: number; formatted: string }
  | { ok: false; error: "incomplete"; missing: string[] }
  | { ok: false; error: "unpriced" | "email_registered" | "no_conversation" };

function formatTl(kurus: number): string {
  return `₺${Math.round(kurus / 100).toLocaleString("tr-TR")}`;
}

function missingFields(spec: WhatsAppOrderSpec): string[] {
  const missing: string[] = [];
  if (!spec.style) missing.push("style");
  if (!spec.size) missing.push("size");
  if (!spec.previewId) missing.push("selected_variation");
  if (!spec.fullName) missing.push("fullName");
  if (!spec.email) missing.push("email");
  const a = spec.address;
  if (!a?.adres || !a?.ilce || !a?.il || !a?.postaKodu || !a?.telefon) missing.push("address");
  return missing;
}

export async function loadSpec(conversationId: string): Promise<WhatsAppOrderSpec> {
  const [row] = await db
    .select()
    .from(agentOrderSpecs)
    .where(eq(agentOrderSpecs.conversationId, conversationId))
    .limit(1);
  return (row?.spec as WhatsAppOrderSpec) ?? {};
}

export async function mergeSpec(
  conversationId: string,
  patch: Partial<WhatsAppOrderSpec>
): Promise<WhatsAppOrderSpec> {
  const current = await loadSpec(conversationId);
  const next = { ...current, ...patch };
  await db
    .insert(agentOrderSpecs)
    .values({ conversationId, spec: next })
    .onConflictDoUpdate({
      target: agentOrderSpecs.conversationId,
      set: { spec: next, updatedAt: new Date() },
    });
  return next;
}

export async function createWhatsAppDraft(
  conversationId: string
): Promise<CreateDraftResult> {
  const [specRow] = await db
    .select()
    .from(agentOrderSpecs)
    .where(eq(agentOrderSpecs.conversationId, conversationId))
    .limit(1);

  // Idempotent: a second call — a retried job, a model that asked twice, a
  // redelivered Meta webhook — gets the same link, not a second order.
  if (specRow?.draftReference) {
    const [draft] = await db
      .select({ amountKurus: orderDrafts.amountKurus })
      .from(orderDrafts)
      .where(eq(orderDrafts.reference, specRow.draftReference))
      .limit(1);
    const amount = draft?.amountKurus ?? 0;
    return {
      ok: true,
      reference: specRow.draftReference,
      payUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com"}/pay/${specRow.draftReference}`,
      amountKurus: amount,
      formatted: formatTl(amount),
    };
  }

  const spec = (specRow?.spec as WhatsAppOrderSpec) ?? {};
  const missing = missingFields(spec);
  if (missing.length > 0) return { ok: false, error: "incomplete", missing };

  const [conversation] = await db
    .select({ phoneE164: waConversations.phoneE164 })
    .from(waConversations)
    .where(eq(waConversations.id, conversationId))
    .limit(1);
  if (!conversation) return { ok: false, error: "no_conversation" };

  // Recomputed from the stored spec. The model's arithmetic never enters here.
  let itemAmount: number;
  try {
    itemAmount = itemPriceKurus({
      kind: priceKindForStyle(spec.style!),
      size: spec.size!,
      material: spec.material ?? "resin",
      finish: spec.finish ?? null,
    });
  } catch {
    // UnpricedSizeError — a bespoke size has no catalogue price and must NOT
    // fall through to zero. A human quotes it.
    return { ok: false, error: "unpriced" };
  }

  const amountKurus = Math.min(
    itemAmount + calculateUpsellAmount(spec.upsells ?? []),
    MAX_AMOUNT_KURUS
  );

  // The public checkout refuses to attach an order to an existing registered
  // account, and the agent gets the same refusal. `allowExistingAccount` is an
  // admin-only escape hatch and is deliberately not passed from here.
  const guest = await resolveOrCreateGuestUser({
    email: spec.email!,
    name: spec.fullName!,
    phone: spec.address!.telefon,
  });
  if (!guest.ok) return { ok: false, error: "email_registered" };
  const userId = guest.user.id;

  const reference = buildDraftReference();
  const havaleDiscountKurus = calculateHavaleDiscount(amountKurus);

  // Kalem tabanları. Bu kolonlar burada HİÇ yazılmıyordu: bir `hand_painted`
  // WhatsApp siparişi needsPainting=false ile promote oluyor, hiçbir boyacıya
  // atanamıyor (send-to-painter ve assign-painter bayrak olmadan reddediyor) ve
  // üretici tutarın TAMAMI üzerinden tahakkuk ederek boyacının payını yutuyordu.
  //
  // Fiyat türü kapısı /api/orders ile birebir aynı olmak ZORUNDA: sabit fiyatlı
  // Creative Lab ürünlerinde (anahtarlık ₺149) boyama payı tahsil edilmiyor.
  // `finish` varsayılanı "hand_painted" olduğu için bu kapı olmadan ₺149'luk bir
  // siparişe ₺1.000 boyama payı yazılır — iki taban toplamı sipariş tutarını
  // aşar ve boyacıya ₺600 ödenir.
  const finishValue = (spec.finish as OrderFinish | undefined) ?? "hand_painted";
  const needsPainting =
    finishNeedsPainter(finishValue) && priceKindForStyle(spec.style!) === "figure";
  const paintingPriceKurus = needsPainting
    ? Math.min(paintingPortionKurus(finishValue), amountKurus)
    : 0;
  const productionBaseKurus = Math.max(0, amountKurus - paintingPriceKurus);

  const [draft] = await db
    .insert(orderDrafts)
    .values({
      reference,
      userId,
      email: spec.email!,
      customerName: spec.fullName!,
      phone: spec.address!.telefon,
      shippingAddress: spec.address!,
      amountKurus,
      havaleDiscountKurus,
      paymentMethod: "card",
      orderType: "custom",
      style: spec.style!,
      figurineSize: spec.size!,
      material: spec.material ?? "resin",
      // The finish column is an enum; the spec holds free text from the model,
      // so anything unrecognised falls back to the catalogue default rather
      // than being written through.
      finish: finishValue,
      paintingPriceKurus,
      productionBaseKurus,
      needsPainting: orderNeedsPainting(paintingPriceKurus),
      upsells: spec.upsells ?? [],
      upsellAmountKurus: calculateUpsellAmount(spec.upsells ?? []),
      previewId: spec.previewId!,
      photoKeys: spec.photoKeys ?? [],
      attributionChannel: "whatsapp",
      channel: "whatsapp",
      locale: "tr",
      // Consent is NOT collected in chat. The customer ticks the two versioned,
      // IP-stamped boxes on /pay before payment can start — a model reading
      // "tamam" as açık rıza is not a consent record.
      contentConsentAt: null,
      contentConsentVersion: CONTENT_CONSENT_VERSION,
    })
    .returning({ id: orderDrafts.id });

  await db
    .update(agentOrderSpecs)
    .set({ draftId: draft.id, draftReference: reference, updatedAt: new Date() })
    .where(eq(agentOrderSpecs.conversationId, conversationId));

  return {
    ok: true,
    reference,
    payUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com"}/pay/${reference}`,
    amountKurus,
    formatted: formatTl(amountKurus),
  };
}
