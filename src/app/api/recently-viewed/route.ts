import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRedisConnection } from "@/lib/queue/connection";
import type { ProductListItem } from "@/components/product-card";

export const runtime = "nodejs";

// Redis-backed "recently viewed" list (mirrors the server cart). Logged-in users
// key by userId; guests get an opaque httpOnly cookie. Stores only ordered
// product ids — titles/prices/images are always re-resolved server-side.
const RV_COOKIE = "rvId";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_ITEMS = 12;

async function resolveKey(
  req: NextRequest
): Promise<{ key: string; newCookie?: string }> {
  const session = await getSessionUser();
  if (session) return { key: `rv:u:${session.userId}` };
  const existing = req.cookies.get(RV_COOKIE)?.value;
  if (existing) return { key: `rv:g:${existing}` };
  const id = nanoid();
  return { key: `rv:g:${id}`, newCookie: id };
}

async function getIds(key: string): Promise<string[]> {
  const raw = await getRedisConnection().get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function setIds(key: string, ids: string[]): Promise<void> {
  await getRedisConnection().set(key, JSON.stringify(ids), "EX", TTL_SECONDS);
}

function respond(data: unknown, newCookie?: string) {
  const res = NextResponse.json(data);
  if (newCookie) {
    res.cookies.set(RV_COOKIE, newCookie, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: TTL_SECONDS,
      path: "/",
    });
  }
  return res;
}

export async function GET(req: NextRequest) {
  const { key, newCookie } = await resolveKey(req);
  const ids = await getIds(key);
  if (ids.length === 0) return respond({ items: [] }, newCookie);

  const rows = await db.query.products.findMany({
    where: inArray(products.id, ids),
    with: {
      manufacturer: { columns: { companyName: true } },
      categoryNode: { columns: { path: true, name: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Preserve recency order (ids are newest-first); only surface active products.
  const items: ProductListItem[] = ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p && p.status === "active")
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      priceKurus: p.priceKurus,
      material: p.material,
      categoryPath: p.categoryNode?.path ?? null,
      categoryName: p.categoryNode?.name ?? null,
      leadTimeDays: p.leadTimeDays,
      imageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
      sellerName: p.manufacturer?.companyName ?? null,
      ratingAvgX100: p.ratingAvgX100,
      ratingCount: p.ratingCount,
    }));
  return respond({ items }, newCookie);
}

// Record a product view — prepend (dedup), cap at MAX_ITEMS. Fire-and-forget
// from the product detail page.
export async function POST(req: NextRequest) {
  const { key, newCookie } = await resolveKey(req);
  const body = await req.json().catch(() => ({}));
  const productId = String(body?.productId ?? "");
  if (!productId) return respond({ ok: false }, newCookie);
  const ids = await getIds(key);
  const next = [productId, ...ids.filter((i) => i !== productId)].slice(
    0,
    MAX_ITEMS
  );
  await setIds(key, next);
  return respond({ ok: true }, newCookie);
}
