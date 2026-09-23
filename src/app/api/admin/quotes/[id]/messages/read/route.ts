/**
 * `POST /api/admin/quotes/[id]/messages/read` — sohbeti okundu işaretler.
 *
 * Yalnız MÜŞTERİ mesajları işaretlenir; kural `quote-chat.ts` içindedir. Uç
 * adının `…/messages/read` olması `useOrderChat`in sözleşmesidir
 * (`${basePath}/read`), bileşen ikinci bir adres bilmez.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { markQuoteMessagesRead } from "@/lib/services/quote-chat";
import { adminQuoteExists } from "@/lib/services/quote-admin";
import { adminQuoteContext, adminQuoteNotFound } from "../../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, ctx: Ctx) {
  try {
    const a = await adminQuoteContext(ctx);
    if ("response" in a) return a.response;
    if (!(await adminQuoteExists(a.quoteId))) return adminQuoteNotFound();

    await markQuoteMessagesRead(a.quoteId, "admin");
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/quotes/[id]/messages/read",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
