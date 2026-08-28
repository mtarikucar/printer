import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, previews } from "@/lib/db/schema";
import { DESIGN_TEMPLATES, priceKindForStyle } from "@/lib/create/design-templates";
import { SIZE_PRESETS } from "@/lib/config/sizes";
import {
  FINISH_SURCHARGES_KURUS,
  UPSELL_PRICES_KURUS,
  calculateUpsellAmount,
  itemPriceKurus,
} from "@/lib/config/prices";
import { FAQ_ANSWERS } from "@/lib/config/wa-flow";
import { downloadInboundImage } from "@/lib/services/whatsapp-media";
import { normalizePhone } from "@/lib/phone";
import { getPublicUrl } from "@/lib/services/storage";
import { loadSpec, mergeSpec, createWhatsAppDraft } from "@/lib/services/wa-order";
import { getPreviewGenerationQueue } from "@/lib/queue/queues";
import { setMode } from "@/lib/services/whatsapp-conversation";
import { reserveSpend } from "@/lib/services/spend-guard";
import { isFlagEnabled } from "@/lib/services/flags";

/**
 * Tool execution. Everything the agent can actually cause happens here, behind
 * argument schemas that make the dangerous shapes unrepresentable.
 *
 * `conversationId` arrives in the CONTEXT, never in a tool argument, so the
 * model cannot address another person's conversation no matter what it emits.
 *
 * NOTE: no `import "server-only"` — this runs inside the BullMQ worker.
 */

export interface ToolContext {
  conversationId: string;
  phoneE164: string;
  /** Message history for this turn, already trimmed by the worker. */
  history: Anthropic.Beta.BetaMessageParam[];
  /** Media ids the customer sent in the message being handled. */
  pendingMediaIds: string[];
}

export type ToolOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

const MAX_PHOTOS = 4;
/** One preview round is VARIATION_COUNT fal calls at ~4 US cents each. */
const PREVIEW_COST_CENTS = 8;

function formatTl(kurus: number): string {
  return `₺${Math.round(kurus / 100).toLocaleString("tr-TR")}`;
}

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<ToolOutcome> {
  // Tool inputs are parsed JSON from the model; never string-match them.
  const input = (rawInput ?? {}) as Record<string, unknown>;

  switch (name) {
    case "emit_reply": {
      const text = String(input.text ?? "");
      if (!text.trim()) return { ok: false, error: "empty_reply" };
      return { ok: true, value: { sent: true } };
    }

    case "get_catalog": {
      return {
        ok: true,
        value: {
          templates: DESIGN_TEMPLATES.filter((t) => t.enabled)
            .sort((a, b) => a.order - b.order)
            .map((t) => ({
              slug: t.slug,
              priceKind: t.priceKind,
              allowMultiPhoto: t.allowMultiPhoto,
              subject: t.subject,
            })),
          sizes: SIZE_PRESETS.map((s) => ({ key: s.key, heightMm: s.heightMm, label: s.labelTr })),
          materials: ["resin"],
          finishes: Object.keys(FINISH_SURCHARGES_KURUS),
          upsells: Object.keys(UPSELL_PRICES_KURUS),
        },
      };
    }

    case "quote_item": {
      const style = String(input.style ?? "");
      const size = String(input.size ?? "");
      const material = input.material === "filament" ? "filament" : "resin";
      const finish = input.finish ? String(input.finish) : null;
      const upsells = Array.isArray(input.upsells) ? input.upsells.map(String) : [];

      let base: number;
      try {
        base = itemPriceKurus({ kind: priceKindForStyle(style), size, material, finish });
      } catch {
        // A bespoke size has no catalogue price. Refusing here — rather than
        // returning zero — is what stops a free figurine.
        return { ok: false, error: "needs_admin_quote" };
      }
      const upsellAmount = calculateUpsellAmount(upsells);
      const total = base + upsellAmount;

      await mergeSpec(ctx.conversationId, {
        style,
        size,
        material,
        finish: finish ?? undefined,
        upsells,
      });

      return {
        ok: true,
        value: {
          amountKurus: total,
          formatted: formatTl(total),
          breakdown: [
            { label: "Figür", kurus: base },
            ...(upsellAmount > 0 ? [{ label: "Ek seçenekler", kurus: upsellAmount }] : []),
          ],
        },
      };
    }

    case "save_photo": {
      const mediaId = String(input.waMediaId ?? "");
      // Only media the customer actually sent in this turn can be stored — a
      // model-invented id must not become a fetch against Meta.
      if (!ctx.pendingMediaIds.includes(mediaId)) {
        return { ok: false, error: "unknown_media" };
      }
      const spec = await loadSpec(ctx.conversationId);
      const existing = spec.photoKeys ?? [];
      if (existing.length >= MAX_PHOTOS) return { ok: false, error: "too_many_photos" };

      const media = await downloadInboundImage(mediaId, ctx.conversationId);
      if (!media.ok) return { ok: false, error: media.reason };

      await mergeSpec(ctx.conversationId, { photoKeys: [...existing, media.key] });
      // Deliberately returns an index, not a key or a URL: there is no way for
      // the agent to hand anybody a readable link to a customer's photo.
      return { ok: true, value: { ok: true, photoIndex: existing.length } };
    }

    case "start_preview": {
      if (process.env.WHATSAPP_FREE_PREVIEW_ENABLED !== "1") {
        // The web path is behind login + e-mail verification + Turnstile + free
        // caps precisely because it is abused. A WhatsApp number is not an
        // identity: a new number is a new conversation and three more free
        // generations. Off by default.
        return { ok: false, error: "preview_requires_payment" };
      }
      if (!(await isFlagEnabled("fal_enabled"))) return { ok: false, error: "generation_disabled" };

      const spec = await loadSpec(ctx.conversationId);
      const photoKeys = spec.photoKeys ?? [];
      if (photoKeys.length === 0) return { ok: false, error: "no_photo" };

      const reservation = await reserveSpend("fal", PREVIEW_COST_CENTS, {
        kind: "conversation",
        id: ctx.conversationId,
      });
      if (!reservation.ok) return { ok: false, error: reservation.reason };

      const styleSlug = String(input.styleSlug ?? "");
      const [preview] = await db
        .insert(previews)
        .values({
          photoKey: photoKeys[0],
          photoKeys,
          photoUrl: getPublicUrl(photoKeys[0]),
          figurineSize: spec.size ?? SIZE_PRESETS[0].key,
          style: styleSlug,
          status: "generating",
        })
        .returning({ id: previews.id });

      const queue = getPreviewGenerationQueue();
      const counts = await queue.getJobCounts("waiting", "active").catch(() => null);
      const depth = counts ? (counts.waiting ?? 0) + (counts.active ?? 0) : 0;

      await queue.add("generate-variations", {
        previewId: preview.id,
        imageUrl: getPublicUrl(photoKeys[0]),
        photoKey: photoKeys[0],
        photoKeys,
        style: styleSlug,
        modifiers: [],
      });

      await mergeSpec(ctx.conversationId, { previewId: preview.id, style: styleSlug });
      // Real queue depth, not a comforting constant: an ETA the system cannot
      // keep is worse than a longer honest one.
      return { ok: true, value: { previewId: preview.id, etaSeconds: 60 + depth * 45 } };
    }

    case "select_variation": {
      const index = Number(input.index);
      if (index !== 0 && index !== 1) return { ok: false, error: "bad_index" };

      const spec = await loadSpec(ctx.conversationId);
      if (!spec.previewId) return { ok: false, error: "no_preview" };

      const [preview] = await db
        .select()
        .from(previews)
        .where(eq(previews.id, spec.previewId))
        .limit(1);
      if (!preview || preview.status !== "styled") return { ok: false, error: "not_ready" };

      const urls = preview.styledImageUrls ?? [];
      const chosen = urls[index];
      if (!chosen) return { ok: false, error: "bad_index" };

      await db
        .update(previews)
        .set({ selectedStyledImageUrl: chosen, status: "approved", updatedAt: new Date() })
        .where(eq(previews.id, preview.id));
      return { ok: true, value: { ok: true } };
    }

    case "parse_address": {
      const raw = String(input.raw ?? "").slice(0, 1000);
      // Deterministic first; the model only helps with the street/neighbourhood
      // split, and this tool writes nothing either way.
      const postCode = raw.match(/\b(\d{5})\b/)?.[1] ?? null;
      const phoneMatch = raw.match(/(?:\+?90)?[\s(]*5\d{2}[\s)]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/);
      const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : null;

      const missing: string[] = [];
      if (!postCode) missing.push("postaKodu");
      if (!phone) missing.push("telefon");

      return {
        ok: true,
        value: {
          ok: missing.length === 0,
          parsed: { postaKodu: postCode, telefon: phone },
          missing,
          confidence: missing.length === 0 ? "high" : "partial",
        },
      };
    }

    case "save_customer": {
      const address = input.address as Record<string, string> | undefined;
      if (!address) return { ok: false, error: "no_address" };
      const phone = normalizePhone(String(address.telefon ?? ""));
      if (!phone) return { ok: false, error: "bad_phone" };
      if (!/^\d{5}$/.test(String(address.postaKodu ?? ""))) {
        return { ok: false, error: "bad_post_code" };
      }
      const email = String(input.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "bad_email" };

      await mergeSpec(ctx.conversationId, {
        fullName: String(input.fullName ?? "").slice(0, 120),
        email,
        address: {
          adres: String(address.adres ?? "").slice(0, 400),
          mahalle: String(address.mahalle ?? "").slice(0, 120),
          ilce: String(address.ilce ?? "").slice(0, 120),
          il: String(address.il ?? "").slice(0, 120),
          postaKodu: String(address.postaKodu),
          telefon: phone,
        },
      });
      return { ok: true, value: { ok: true } };
    }

    case "create_draft": {
      const result = await createWhatsAppDraft(ctx.conversationId);
      if (!result.ok) {
        return {
          ok: false,
          error: result.error === "incomplete" ? `incomplete:${result.missing.join(",")}` : result.error,
        };
      }
      return {
        ok: true,
        value: {
          reference: result.reference,
          payUrl: result.payUrl,
          formatted: result.formatted,
        },
      };
    }

    case "get_order_status": {
      const reference = String(input.reference ?? "").trim().toUpperCase();
      const [order] = await db
        .select({
          status: orders.status,
          trackingNumber: orders.trackingNumber,
          carrier: orders.carrier,
        })
        .from(orders)
        .where(
          and(
            eq(orders.orderNumber, reference),
            eq(orders.waConversationId, ctx.conversationId)
          )
        )
        .limit(1);

      // Not "you are not allowed" — that would confirm the order exists. The
      // FIG- reference space is only 8 characters; leaking existence turns it
      // into an enumeration oracle over other people's orders.
      if (!order) return { ok: false, error: "not_found" };

      const labels: Record<string, string> = {
        paid: "Ödemeniz alındı, hazırlığa başlıyoruz",
        generating: "3D modeliniz hazırlanıyor",
        processing_mesh: "3D modeliniz hazırlanıyor",
        review: "Modeliniz son kontrolde",
        awaiting_customer_approval: "Onayınızı bekliyoruz",
        awaiting_model: "Modeliniz hazırlanıyor",
        approved: "Onaylandı, üretime giriyor",
        printing: "Baskıda",
        quality_check: "Kalite kontrolde",
        painting: "Boyanıyor",
        shipped: "Kargoya verildi",
        delivered: "Teslim edildi",
      };
      return {
        ok: true,
        value: {
          status: order.status,
          statusLabelTr: labels[order.status] ?? "Hazırlanıyor",
          ...(order.trackingNumber ? { trackingNumber: order.trackingNumber } : {}),
          ...(order.carrier ? { carrier: order.carrier } : {}),
        },
      };
    }

    case "send_faq": {
      const topic = String(input.topic ?? "");
      const answer = FAQ_ANSWERS[topic];
      if (!answer) return { ok: false, error: "unknown_topic" };
      return { ok: true, value: { text: answer.text, sourcePage: answer.sourcePage } };
    }

    case "request_human_handoff": {
      await setMode(ctx.conversationId, "human");
      console.warn(
        `[agent] handoff conversation=${ctx.conversationId} reason=${String(input.reason)}: ${String(input.summary ?? "")}`
      );
      return { ok: true, value: { ok: true } };
    }

    default:
      return { ok: false, error: "unknown_tool" };
  }
}
