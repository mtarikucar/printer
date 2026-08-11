import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRedisConnection } from "@/lib/queue/connection";
import { resolveOrderLines } from "@/lib/services/product-options";
import { ABSOLUTE_MAX_LINE_QTY, effectiveMaxQty } from "@/lib/config/bulk";

export const runtime = "nodejs";

// Redis-backed server cart. Logged-in users key by userId; guests get an opaque
// httpOnly cookie. A line holds {productId, quantity, optionChoiceIds, addonIds}
// — titles/prices/images are always re-resolved server-side (never trust the
// client). The line id is derived from the product + selection, so the same
// product with different options is a SEPARATE line.
const CART_COOKIE = "cartId";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface Line {
  id: string;
  productId: string;
  quantity: number;
  optionChoiceIds: string[];
  addonIds: string[];
  /**
   * Part of an anahtarlık kutusu — priced off the box ladder, not the
   * product's. Always present (getLines defaults legacy rows to false) so the
   * flag can never be silently undefined inside a pricing path.
   */
  box: boolean;
}

// `box` is part of the identity: the same keychain bought inside a box and
// bought on its own are different offers at different prices, so they must not
// merge into one line.
function lineKey(
  productId: string,
  optionChoiceIds: string[],
  addonIds: string[],
  box: boolean
): string {
  return `${box ? "box|" : ""}${productId}|${[...optionChoiceIds]
    .sort()
    .join(",")}|${[...addonIds].sort().join(",")}`;
}

async function resolveCartKey(
  req: NextRequest
): Promise<{ key: string; newCookie?: string }> {
  const session = await getSessionUser();
  if (session) return { key: `cart:u:${session.userId}` };
  const existing = req.cookies.get(CART_COOKIE)?.value;
  if (existing) return { key: `cart:g:${existing}` };
  const id = nanoid();
  return { key: `cart:g:${id}`, newCookie: id };
}

async function getLines(key: string): Promise<Line[]> {
  const raw = await getRedisConnection().get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalize legacy lines (pre-options) that lack id/selection.
    return parsed.map((l) => {
      const optionChoiceIds = Array.isArray(l.optionChoiceIds)
        ? l.optionChoiceIds.map(String)
        : [];
      const addonIds = Array.isArray(l.addonIds) ? l.addonIds.map(String) : [];
      const box = l.box === true;
      return {
        id: l.id ?? lineKey(String(l.productId), optionChoiceIds, addonIds, box),
        productId: String(l.productId),
        // DB-free sanity bound only — this runs without knowing which product
        // the line points at. The authoritative, product-aware cap
        // (effectiveMaxQty) is applied in hydrate(), which already has the row.
        quantity: clampQty(l.quantity),
        optionChoiceIds,
        addonIds,
        box,
      };
    });
  } catch {
    return [];
  }
}

async function setLines(key: string, lines: Line[]): Promise<void> {
  await getRedisConnection().set(key, JSON.stringify(lines), "EX", TTL_SECONDS);
}

// Hydrates the stored lines into the client-facing view, HIDING (not deleting)
// any line that isn't currently purchasable — product not active, or its seller
// suspended. The checkout page builds its order strictly from these `items`, so a
// hidden line never blocks checkout of the healthy ones. Storage is left intact
// on purpose: a product in a TRANSIENT non-active state (pending_review after a
// seller edit, draft) or a temporarily-suspended seller must reappear when it
// goes active again — persisting a pruned cart would delete it permanently.
// Also returns `lines` — the stored lines with each quantity clamped to its
// product's real ceiling. POST/PATCH persist that back, so a line can never sit
// in Redis above a cap the customer has no UI to lower it to (which would make
// the cart display one quantity and /api/orders reject it: an uncheckoutable
// cart). GET intentionally does NOT persist; it only displays the clamp.
async function hydrate(lines: Line[]) {
  if (lines.length === 0) {
    return {
      items: [],
      totalKurus: 0,
      count: 0,
      bulkSavingsKurus: 0,
      boxQuantity: 0,
      lines: [] as Line[],
      clamped: false,
    };
  }
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const rows = await db.query.products.findMany({
    where: inArray(products.id, productIds),
    with: { manufacturer: { columns: { companyName: true, status: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const isPurchasable = (l: Line) => {
    const p = byId.get(l.productId);
    return (
      !!p &&
      p.status === "active" &&
      // A suspended seller's listing must not survive in the cart view.
      !(p.ownerType === "seller" && p.manufacturer?.status !== "active")
    );
  };

  // Authoritative per-product ceiling. Applied here (not in the Redis
  // normalizer) because only here do we know which product a line points at.
  let clamped = false;
  const clampedLines: Line[] = lines.map((l) => {
    const p = byId.get(l.productId);
    // Unknown product: leave the line untouched — it is hidden below anyway and
    // may become purchasable again (see the storage-preservation note above).
    if (!p) return l;
    const cap = effectiveMaxQty(p);
    if (l.quantity <= cap) return l;
    clamped = true;
    return { ...l, quantity: cap };
  });

  // Volume tiers are computed on the PER-PRODUCT total, so only purchasable
  // lines may contribute: checkout posts exactly the visible items, and a
  // hidden line inflating the tier here would advertise a discount that
  // /api/orders (which never sees that line) would refuse to honour.
  const priceable = clampedLines.filter(isPurchasable);
  const resolvedByLineId = new Map(
    (
      await resolveOrderLines(
        priceable.map((l) => ({
          productId: l.productId,
          basePriceKurus: byId.get(l.productId)?.priceKurus ?? 0,
          optionChoiceIds: l.optionChoiceIds,
          addonIds: l.addonIds,
          quantity: l.quantity,
          // Same guard as /api/orders: a stored box flag only counts while the
          // product is actually box-eligible, so un-flagging a product silently
          // reprices it at list instead of leaving a phantom box discount that
          // checkout would refuse to honour.
          box: l.box && byId.get(l.productId)?.boxEligible,
        }))
      )
    ).map((r, i) => [priceable[i].id, r] as const)
  );

  const items = clampedLines
    .map((l) => {
      const p = byId.get(l.productId);
      const r = resolvedByLineId.get(l.id);
      if (!p || !r) return null;
      const imageKey = r.itemImageKey ?? p.primaryImageKey;
      const cap = effectiveMaxQty(p);
      return {
        id: l.id,
        productId: p.id,
        slug: p.slug,
        title: p.title,
        priceKurus: r.unitPriceKurus,
        // Display-only: what this unit would cost without the volume tier.
        listPriceKurus: r.listUnitPriceKurus,
        appliedTierMinQuantity: r.appliedTierMinQuantity,
        // Total units of this product across the cart — the tier basis, and
        // what the grouped cart UI shows so the price change is explainable.
        productQuantity: r.productQuantity,
        maxQuantity: cap,
        bulkEnabled: p.bulkEnabled,
        isBoxItem: r.isBoxItem,
        imageUrl: imageKey ? getPublicUrl(imageKey) : null,
        sellerName: p.manufacturer?.companyName ?? null,
        quantity: l.quantity,
        lineTotalKurus: r.unitPriceKurus * l.quantity,
        selectedOptions: r.selectedOptions,
        selectedAddons: r.selectedAddons,
        // Echoed so the checkout can forward the exact selection to /api/orders.
        optionChoiceIds: l.optionChoiceIds,
        addonIds: l.addonIds,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return {
    items,
    totalKurus: items.reduce((s, i) => s + i.lineTotalKurus, 0),
    count: items.reduce((s, i) => s + i.quantity, 0),
    // Derived from the display-only list price; never subtracted from a total.
    bulkSavingsKurus: items.reduce(
      (s, i) => s + (i.listPriceKurus - i.priceKurus) * i.quantity,
      0
    ),
    // Total pieces in the anahtarlık kutusu, so the cart can render it as one
    // block ("Anahtarlık kutusu — 100 adet") above its per-design lines. 0 when
    // there is no box.
    boxQuantity: items.reduce(
      (s, i) => s + (i.isBoxItem ? i.quantity : 0),
      0
    ),
    lines: clampedLines,
    clamped,
  };
}

function respond(data: unknown, newCookie?: string) {
  const res = NextResponse.json(data);
  if (newCookie) {
    res.cookies.set(CART_COOKIE, newCookie, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: TTL_SECONDS,
      path: "/",
    });
  }
  return res;
}

const clampQty = (n: unknown) =>
  Math.max(1, Math.min(ABSOLUTE_MAX_LINE_QTY, Math.round(Number(n) || 1)));
const idArray = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => String(x)).slice(0, 50) : [];

// Strip the internal `lines` from the hydrate result — the client gets the
// rendered view, never the raw storage shape.
function publicView(h: Awaited<ReturnType<typeof hydrate>>) {
  const { lines: _lines, ...rest } = h;
  void _lines;
  return rest;
}

// Persist the product-aware clamp hydrate computed, then respond. Sharing this
// between POST and PATCH is what guarantees storage and display agree: whatever
// the customer is shown is what is actually in the cart.
async function persistAndRespond(
  key: string,
  lines: Line[],
  newCookie?: string
) {
  const h = await hydrate(lines);
  await setLines(key, h.lines);
  return respond(publicView(h), newCookie);
}

export async function GET(req: NextRequest) {
  const { key, newCookie } = await resolveCartKey(req);
  return respond(publicView(await hydrate(await getLines(key))), newCookie);
}

// Add (merges into the existing line with the SAME product + selection).
// Accepts either a single {productId, quantity, …} or a batch {items:[…]} —
// the batch form is what /toplu-siparis uses, so adding N products costs one
// hydrate round trip instead of N.
export async function POST(req: NextRequest) {
  const { key, newCookie } = await resolveCartKey(req);
  const body = await req.json().catch(() => ({}));

  const rawItems: unknown[] = Array.isArray(body.items)
    ? body.items.slice(0, 50)
    : [body];
  const additions = rawItems
    .map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const productId = String(item.productId ?? "");
      if (!productId) return null;
      const optionChoiceIds = idArray(item.optionChoiceIds);
      const addonIds = idArray(item.addonIds);
      const box = item.box === true;
      return {
        id: lineKey(productId, optionChoiceIds, addonIds, box),
        productId,
        quantity: clampQty(item.quantity),
        optionChoiceIds,
        addonIds,
        box,
      };
    })
    .filter((x): x is Line => x !== null);

  if (additions.length === 0) {
    return NextResponse.json({ error: "productId" }, { status: 400 });
  }

  const lines = await getLines(key);
  for (const add of additions) {
    const existing = lines.find((l) => l.id === add.id);
    if (existing) {
      existing.quantity = Math.min(
        ABSOLUTE_MAX_LINE_QTY,
        existing.quantity + add.quantity
      );
    } else {
      lines.push(add);
    }
  }
  return persistAndRespond(key, lines, newCookie);
}

// Set an exact quantity for a line (0 removes it). Keyed by line id.
export async function PATCH(req: NextRequest) {
  const { key, newCookie } = await resolveCartKey(req);
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id" }, { status: 400 });
  const qty = Math.max(
    0,
    Math.min(ABSOLUTE_MAX_LINE_QTY, Math.round(Number(body.quantity) || 0))
  );
  let lines = await getLines(key);
  if (qty === 0) lines = lines.filter((l) => l.id !== id);
  else {
    const existing = lines.find((l) => l.id === id);
    if (existing) existing.quantity = qty;
  }
  return persistAndRespond(key, lines, newCookie);
}

export async function DELETE(req: NextRequest) {
  const { key, newCookie } = await resolveCartKey(req);
  await setLines(key, []);
  return respond(
    { items: [], totalKurus: 0, count: 0, bulkSavingsKurus: 0, clamped: false },
    newCookie
  );
}
