import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { asc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────────────────
export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  sortOrder: number;
  isActive: boolean;
}

export interface CategoryNode extends CategoryRow {
  children: CategoryNode[];
}

type DbCategory = typeof categories.$inferSelect;
function toRow(r: DbCategory): CategoryRow {
  return {
    id: r.id,
    parentId: r.parentId,
    name: r.name,
    slug: r.slug,
    path: r.path,
    depth: r.depth,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  };
}

// ─── Slug ───────────────────────────────────────────────────────────────────
// Turkish-aware: transliterate ç/ğ/ı/İ/ö/ş/ü before lowercasing so "Takı" →
// "taki", not "tak". Falls back to "kategori" for all-symbol names.
export function slugifyCategory(name: string): string {
  return (
    name
      .trim()
      .replace(/ç/gi, "c")
      .replace(/ğ/gi, "g")
      .replace(/ı/g, "i")
      .replace(/İ/g, "i")
      .replace(/ö/gi, "o")
      .replace(/ş/gi, "s")
      .replace(/ü/gi, "u")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "kategori"
  );
}

// ─── Reads ──────────────────────────────────────────────────────────────────
export async function listCategories(): Promise<CategoryRow[]> {
  const rows = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.depth), asc(categories.sortOrder), asc(categories.name));
  return rows.map(toRow);
}

/** Nest a flat list into a tree, sorted by sortOrder then name (tr collation). */
export function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: CategoryNode[]) => {
    nodes.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr")
    );
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export async function getCategoryTree(): Promise<CategoryNode[]> {
  return buildCategoryTree(await listCategories());
}

/** Direct children of a node (roots when parentId is null), display-ordered. */
export async function getChildCategories(
  parentId: string | null
): Promise<CategoryRow[]> {
  const rows = await db
    .select()
    .from(categories)
    .where(parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows.map(toRow);
}

export async function getCategoryByPath(path: string): Promise<CategoryRow | null> {
  const [row] = await db
    .select()
    .from(categories)
    .where(eq(categories.path, path))
    .limit(1);
  return row ? toRow(row) : null;
}

export async function getCategoryById(id: string): Promise<CategoryRow | null> {
  const [row] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  return row ? toRow(row) : null;
}

/**
 * Validate an optional categoryId coming from product create/update input.
 * Returns the id when it resolves to a real node, null when omitted; throws
 * "INVALID_CATEGORY" for a non-existent id so the route can answer 400.
 */
export async function resolveProductCategoryId(
  categoryId?: string | null
): Promise<string | null> {
  if (!categoryId) return null;
  const cat = await getCategoryById(categoryId);
  if (!cat) throw new Error("INVALID_CATEGORY");
  return cat.id;
}

/** ids of a node + every descendant (the subtree), via path prefix match. */
export async function getSubtreeIds(path: string): Promise<string[]> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(or(eq(categories.path, path), like(categories.path, `${path}/%`)));
  return rows.map((r) => r.id);
}

/** Ancestors root→…→self, derived from the path segments (one query). */
export async function getBreadcrumb(path: string): Promise<CategoryRow[]> {
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 0) return [];
  const paths = segs.map((_, i) => segs.slice(0, i + 1).join("/"));
  const rows = await db
    .select()
    .from(categories)
    .where(inArray(categories.path, paths));
  const byPath = new Map(rows.map((r) => [r.path, toRow(r)]));
  return paths.map((p) => byPath.get(p)).filter((x): x is CategoryRow => !!x);
}

// ─── Mutations (admin) ──────────────────────────────────────────────────────
async function uniqueSiblingSlug(
  parentId: string | null,
  base: string,
  excludeId?: string
): Promise<string> {
  const siblings = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId));
  const taken = new Set(
    siblings.filter((s) => s.id !== excludeId).map((s) => s.slug)
  );
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export async function createCategory(input: {
  parentId: string | null;
  name: string;
}): Promise<CategoryRow> {
  const name = input.name.trim();
  if (!name) throw new Error("EMPTY_NAME");
  const parent = input.parentId ? await getCategoryById(input.parentId) : null;
  if (input.parentId && !parent) throw new Error("PARENT_NOT_FOUND");

  const slug = await uniqueSiblingSlug(input.parentId, slugifyCategory(name));
  const path = parent ? `${parent.path}/${slug}` : slug;
  const depth = parent ? parent.depth + 1 : 0;
  const [{ maxOrder }] = await db
    .select({
      maxOrder: sql<number>`coalesce(max(${categories.sortOrder}), -1)`,
    })
    .from(categories)
    .where(
      input.parentId
        ? eq(categories.parentId, input.parentId)
        : isNull(categories.parentId)
    );

  const [row] = await db
    .insert(categories)
    .values({
      parentId: input.parentId,
      name,
      slug,
      path,
      depth,
      sortOrder: Number(maxOrder) + 1,
    })
    .returning();
  return toRow(row);
}

/** Rename only — slug/path stay stable so existing URLs don't break. */
export async function renameCategory(id: string, name: string): Promise<CategoryRow> {
  const n = name.trim();
  if (!n) throw new Error("EMPTY_NAME");
  const [row] = await db
    .update(categories)
    .set({ name: n, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();
  if (!row) throw new Error("NOT_FOUND");
  return toRow(row);
}

/** Delete a node; ON DELETE CASCADE removes its subtree, products → SET NULL. */
export async function deleteCategory(id: string): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id));
}

/** Swap sortOrder with the adjacent sibling in the given direction. */
export async function reorderCategory(
  id: string,
  direction: "up" | "down"
): Promise<void> {
  const node = await getCategoryById(id);
  if (!node) throw new Error("NOT_FOUND");
  const siblings = await db
    .select()
    .from(categories)
    .where(
      node.parentId
        ? eq(categories.parentId, node.parentId)
        : isNull(categories.parentId)
    )
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  const idx = siblings.findIndex((s) => s.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;
  const a = siblings[idx];
  const b = siblings[swapIdx];
  await db.transaction(async (tx) => {
    await tx
      .update(categories)
      .set({ sortOrder: b.sortOrder })
      .where(eq(categories.id, a.id));
    await tx
      .update(categories)
      .set({ sortOrder: a.sortOrder })
      .where(eq(categories.id, b.id));
  });
}

/**
 * Reparent a node (and rewrite its whole subtree's path/depth). Rejects moving
 * a node into itself or its own descendant (cycle).
 */
export async function moveCategory(
  id: string,
  newParentId: string | null
): Promise<void> {
  if (id === newParentId) throw new Error("CYCLE");
  const node = await getCategoryById(id);
  if (!node) throw new Error("NOT_FOUND");
  const newParent = newParentId ? await getCategoryById(newParentId) : null;
  if (newParentId && !newParent) throw new Error("PARENT_NOT_FOUND");
  if (
    newParent &&
    (newParent.path === node.path || newParent.path.startsWith(node.path + "/"))
  ) {
    throw new Error("CYCLE");
  }

  const slug = await uniqueSiblingSlug(newParentId, node.slug, id);
  const newPath = newParent ? `${newParent.path}/${slug}` : slug;
  const newDepth = newParent ? newParent.depth + 1 : 0;
  const oldPath = node.path;
  const depthDelta = newDepth - node.depth;

  await db.transaction(async (tx) => {
    const descendants = await tx
      .select()
      .from(categories)
      .where(like(categories.path, `${oldPath}/%`));
    await tx
      .update(categories)
      .set({
        parentId: newParentId,
        slug,
        path: newPath,
        depth: newDepth,
        updatedAt: new Date(),
      })
      .where(eq(categories.id, id));
    for (const d of descendants) {
      const rest = d.path.slice(oldPath.length); // leading "/..."
      await tx
        .update(categories)
        .set({
          path: newPath + rest,
          depth: d.depth + depthDelta,
          updatedAt: new Date(),
        })
        .where(eq(categories.id, d.id));
    }
  });
}
