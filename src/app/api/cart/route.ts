import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRedisConnection } from "@/lib/queue/connection";

export const runtime = "nodejs";

// Redis-backed server cart. Logged-in users key by userId; guests get an opaque
// httpOnly cookie. The cart holds only {productId, quantity} — titles/prices are
// always re-resolved server-side (never trust the client).
const CART_COOKIE = "cartId";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface Line {
  productId: string;
  quantity: number;
}

async function resolveKey(
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
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function setLines(key: string, lines: Line[]): Promise<void> {
  await getRedisConnection().set(key, JSON.stringify(lines), "EX", TTL_SECONDS);
}

async function hydrate(lines: Line[]) {
  if (lines.length === 0) return { items: [], totalKurus: 0, count: 0 };
  const rows = await db.query.products.findMany({
    where: inArray(
      products.id,
      lines.map((l) => l.productId)
    ),
    with: { manufacturer: { columns: { companyName: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = lines
    .map((l) => {
      const p = byId.get(l.productId);
      if (!p || p.status !== "active") return null;
      return {
        productId: p.id,
        slug: p.slug,
        title: p.title,
        priceKurus: p.priceKurus,
        imageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
        sellerName: p.manufacturer?.companyName ?? null,
        quantity: l.quantity,
        lineTotalKurus: p.priceKurus * l.quantity,
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

export async function GET(req: NextRequest) {
  const { key, newCookie } = await resolveKey(req);
  return respond(await hydrate(await getLines(key)), newCookie);
}

// Add (merges into existing quantity).
export async function POST(req: NextRequest) {
  const { key, newCookie } = await resolveKey(req);
  const body = await req.json().catch(() => ({}));
  const productId = String(body.productId ?? "");
  if (!productId) return NextResponse.json({ error: "productId" }, { status: 400 });
  const qty = clampQty(body.quantity);
  const lines = await getLines(key);
  const existing = lines.find((l) => l.productId === productId);
  if (existing) existing.quantity = Math.min(20, existing.quantity + qty);
  else lines.push({ productId, quantity: qty });
  await setLines(key, lines);
  return respond(await hydrate(lines), newCookie);
}

// Set an exact quantity (0 removes the line).
export async function PATCH(req: NextRequest) {
  const { key, newCookie } = await resolveKey(req);
  const body = await req.json().catch(() => ({}));
  const productId = String(body.productId ?? "");
  if (!productId) return NextResponse.json({ error: "productId" }, { status: 400 });
  const qty = Math.max(0, Math.min(20, Math.round(Number(body.quantity) || 0)));
  let lines = await getLines(key);
  if (qty === 0) lines = lines.filter((l) => l.productId !== productId);
  else {
    const existing = lines.find((l) => l.productId === productId);
    if (existing) existing.quantity = qty;
    else lines.push({ productId, quantity: qty });
  }
  await setLines(key, lines);
  return respond(await hydrate(lines), newCookie);
}

// Clear the whole cart.
export async function DELETE(req: NextRequest) {
  const { key, newCookie } = await resolveKey(req);
  await setLines(key, []);
  return respond({ items: [], totalKurus: 0, count: 0 }, newCookie);
}
