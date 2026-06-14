import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getPublicUrl } from "@/lib/services/storage";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const PHOTO_KEY_REGEX = /\/(photos\/[^?#]+)$/;

/**
 * Owner-only snapshot of a confirmed order's creative choices — used by the
 * "modify and reorder" flow on the track page. The customer is sent through
 * `/create?fromOrder=<orderNumber>`; the create page calls this endpoint to
 * prefill photoKey / size / style / modifiers, then lets the customer
 * change anything before checkout.
 *
 * Does NOT include shipping address (filled by saved-addresses or fresh
 * form) or gift card code (intentionally not carried over — must be
 * re-applied to validate balance).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { orderNumber } = await params;

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.orderNumber, orderNumber),
      eq(orders.userId, session.userId)
    ),
    with: { photos: true },
  });

  if (!order) {
    return NextResponse.json(
      { error: d["api.order.notFound"] },
      { status: 404 }
    );
  }

  // Extract photoKey from the stored URL. Same defence-in-depth as in the
  // reorder route — reject anything that doesn't sit under `photos/`.
  const firstPhoto = order.photos[0];
  const photoMatch = firstPhoto?.originalUrl?.match(PHOTO_KEY_REGEX);
  const photoKey = photoMatch?.[1];
  if (
    !photoKey ||
    !photoKey.startsWith("photos/") ||
    photoKey.includes("..")
  ) {
    return NextResponse.json(
      { error: d["api.order.notReorderable"] },
      { status: 400 }
    );
  }

  return NextResponse.json({
    photoKey,
    // Ready-signed preview URL so the reorder UI never has to build an unsigned
    // /api/files URL (keeps it working once FILES_REQUIRE_SIGNATURE is on).
    photoPreviewUrl: getPublicUrl(photoKey),
    figurineSize: order.figurineSize,
    material: order.material,
    style: order.style,
    modifiers: order.modifiers ?? [],
  });
}
