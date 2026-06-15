import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRedisConnection } from "@/lib/queue/connection";
import { resolveOrderLines } from "@/lib/services/product-options";

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
}

function lineKey(
  productId: string,
  optionChoiceIds: string[],
  addonIds: string[]
): string {
  return `${productId}|${[...optionChoiceIds].sort().join(",")}|${[...addonIds]
    .sort()
    .join(",")}`;
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
      return {
        id: l.id ?? lineKey(String(l.productId), optionChoiceIds, addonIds),
        productId: String(l.productId),
        quantity: Math.max(1, Math.min(20, Math.round(Number(l.quantity) || 1))),
        optionChoiceIds,
        addonIds,
      };
    });
  } catch {
    return [];
  }
}

async function setLines(key: string, lines: Line[]): Promise<void> {
  await getRedisConnection().set(key, JSON.stringify(lines), "EX", TTL_SECONDS);
}

async function hydrate(lines: Line[]) {
  if (lines.length === 0) return { items: [], totalKurus: 0, count: 0 };
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const rows = await db.query.products.findMany({
    where: inArray(products.id, productIds),
    with: { manufacturer: { columns: { companyName: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Server-authoritative price + selection snapshot + painted/unpainted image.
  const resolved = await resolveOrderLines(
    lines.map((l) => ({
      productId: l.productId,
      basePriceKurus: byId.get(l.productId)?.priceKurus ?? 0,
      optionChoiceIds: l.optionChoiceIds,
      addonIds: l.addonIds,
    }))
  );

  const items = lines
    .map((l, i) => {
      const p = byId.get(l.productId);
      if (!p || p.status !== "active") return null;
      const r = resolved[i];
      const imageKey = r.itemImageKey ?? p.primaryImageKey;
      return {
        id: l.id,
        productId: p.id,
        slug: p.slug,
        title: p.title,
        priceKurus: r.unitPriceKurus,
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
  Math.max(1, Math.min(20, Math.round(Number(n) || 1)));
const idArray = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => String(x)).slice(0, 50) : [];

export async function GET(req: NextRequest) {
  const { key, newCookie } = await resolveCartKey(req);
  return respond(await hydrate(await getLines(key)), newCookie);
}

// Add (merges into the existing line with the SAME product + selection).
export async function POST(req: NextRequest) {
  const { key, newCookie } = await resolveCartKey(req);
  const body = await req.json().catch(() => ({}));
  const productId = String(body.productId ?? "");
  if (!productId) return NextResponse.json({ error: "productId" }, { status: 400 });
  const qty = clampQty(body.quantity);
  const optionChoiceIds = idArray(body.optionChoiceIds);
  const addonIds = idArray(body.addonIds);
  const id = lineKey(productId, optionChoiceIds, addonIds);

  const lines = await getLines(key);
  const existing = lines.find((l) => l.id === id);
  if (existing) existing.quantity = Math.min(20, existing.quantity + qty);
  else lines.push({ id, productId, quantity: qty, optionChoiceIds, addonIds });
  await setLines(key, lines);
  return respond(await hydrate(lines), newCookie);
}

// Set an exact quantity for a line (0 removes it). Keyed by line id.
export async function PATCH(req: NextRequest) {
  const { key, newCookie } = await resolveCartKey(req);
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id" }, { status: 400 });
  const qty = Math.max(0, Math.min(20, Math.round(Number(body.quantity) || 0)));
  let lines = await getLines(key);
  if (qty === 0) lines = lines.filter((l) => l.id !== id);
  else {
    const existing = lines.find((l) => l.id === id);
    if (existing) existing.quantity = qty;
  }
  await setLines(key, lines);
  return respond(await hydrate(lines), newCookie);
}

export async function DELETE(req: NextRequest) {
  const { key, newCookie } = await resolveCartKey(req);
  await setLines(key, []);
  return respond({ items: [], totalKurus: 0, count: 0 }, newCookie);
}
