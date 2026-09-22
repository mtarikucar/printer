/**
 * `POST /api/quotes/[id]/share` — paylaşım bağlantısını üretir / yeniler /
 * iptal eder (`{action: "create" | "rotate" | "revoke"}`).
 *
 * Token'ın KENDİSİ cevapta ayrıca dönmez: taze gövdedeki `shareUrl` zaten
 * yalnız sahibe gider ve bağlantının tamamını taşır. Böylece token'ın
 * göründüğü tek yer, sunucunun sahiplik kapısından geçmiş tek serileştiricisi
 * olur.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { QuoteServiceError, setShareToken } from "@/lib/services/quote-service";
import { accessOr404, jsonBody, presentedResponse, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

const ACTIONS = ["create", "rotate", "revoke"] as const;

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  const body = (await jsonBody(request)) as { action?: unknown };
  if (!ACTIONS.includes(body?.action as (typeof ACTIONS)[number])) {
    throw new QuoteServiceError("Geçersiz seçenek.", 400, "invalid_option");
  }

  await setShareToken(found.access, body.action as (typeof ACTIONS)[number]);
  return presentedResponse(request, id);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes/[id]/share", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
