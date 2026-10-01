/**
 * `POST /api/quotes/[id]/messages/read` — sohbeti okundu işaretler.
 *
 * Yalnız ADMIN mesajları işaretlenir (müşterinin kendi mesajını okumuş
 * sayılması anlamsız); kural `quote-chat.ts` içindedir, uç yalnız yetkiyi
 * doğrular.
 *
 * KAPI OKUMA KAPISIDIR (`canSeeOwnerFields`), yazma kapısı DEĞİL: okundu
 * damgası bir okuma eylemidir ve GET'i geçen takımın `viewer` rolü burada da
 * geçer — aksi hâlde panel her açılışta okunmamış rozetini geri getirirdi.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { canSeeOwnerFields } from "@/lib/config/quote-team";
import { markQuoteMessagesRead } from "@/lib/services/quote-chat";
import { accessOr404, quoteNotFound, quoteRouteBody } from "../../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id);
  if ("response" in found) return found.response;
  if (!canSeeOwnerFields(found.access.viewer)) return quoteNotFound();

  await markQuoteMessagesRead(found.access.quote.id, "customer");
  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/quotes/[id]/messages/read",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}
