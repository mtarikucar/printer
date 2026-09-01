import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { productCostLines } from "@/lib/db/schema";
import {
  allocateBases,
  costLinesTotalKurus,
  splitCostLines,
  type CostLine,
  type CostLineKind,
} from "@/lib/config/cost-lines";

/**
 * Kalem kırılımı — bir ürünün fiyatının neyden oluştuğu ve dolayısıyla kimin
 * ne kadar hakedeceği.
 *
 * Kırılım ORAN taşır, mutlak tutar değil: siparişteki satır tutarı ürünün liste
 * fiyatına eşit olmak zorunda değil (adet, opsiyon farkı, add-on, toplu sipariş
 * kademesi). `basesForLineTotal` bu yüzden oranı gerçekleşen tutara ölçekler ve
 * iki tabanın toplamı her zaman satır tutarına eşitlenir.
 */

export interface CostLineInput {
  kind: CostLineKind;
  label?: string | null;
  amountKurus: number;
}

export interface CostLineBases {
  productionKurus: number;
  paintingKurus: number;
}

/**
 * Kalemlerin toplamı ürünün fiyatına eşit mi? Eşit değilse hata mesajı döner.
 * Fiyat formda kalemlerden hesaplandığı için bu duruma düşmek zordur; yine de
 * sunucu tarafında zorunludur — aksi hâlde iki taban tutarı tutmaz ve
 * "hakediş toplamı fiyatı geçiyor" hatası kırılım üzerinden geri gelir.
 */
export function validateCostLines(
  lines: readonly CostLineInput[],
  priceKurus: number
): string | null {
  if (lines.length === 0) return null; // kırılımsız ürün serbest (eski davranış)
  for (const l of lines) {
    if (!Number.isInteger(l.amountKurus) || l.amountKurus < 0) {
      return "Kalem tutarı sıfır veya pozitif bir tam sayı olmalı.";
    }
  }
  const total = costLinesTotalKurus(lines);
  if (total !== priceKurus) {
    return `Kalemlerin toplamı (₺${(total / 100).toLocaleString(
      "tr-TR"
    )}) ürün fiyatına (₺${(priceKurus / 100).toLocaleString(
      "tr-TR"
    )}) eşit olmalı.`;
  }
  return null;
}

/**
 * Bir ürünün kalemlerini atomik olarak değiştirir (sil + yaz). Ürün formu
 * kırılımı bir bütün olarak gönderir; parça parça güncelleme yok.
 *
 * `tx` verilirse çağıranın transaction'ında çalışır — ürün fiyatı ve kalemleri
 * aynı anda değişmeli, yoksa arada fiyatla kırılımın uyuşmadığı bir pencere
 * kalır.
 */
export async function replaceCostLines(
  productId: string,
  lines: readonly CostLineInput[],
  tx: Pick<typeof db, "delete" | "insert"> = db
): Promise<void> {
  await tx.delete(productCostLines).where(eq(productCostLines.productId, productId));
  if (lines.length === 0) return;
  await tx.insert(productCostLines).values(
    lines.map((l, i) => ({
      productId,
      kind: l.kind,
      label: l.label?.trim() || null,
      amountKurus: l.amountKurus,
      sortOrder: i,
    }))
  );
}

/** Tek bir ürünün kalemleri, sıralı. */
export async function getCostLines(productId: string): Promise<
  Array<{ kind: CostLineKind; label: string | null; amountKurus: number }>
> {
  const rows = await db
    .select({
      kind: productCostLines.kind,
      label: productCostLines.label,
      amountKurus: productCostLines.amountKurus,
    })
    .from(productCostLines)
    .where(eq(productCostLines.productId, productId))
    .orderBy(asc(productCostLines.sortOrder));
  return rows.map((r) => ({
    kind: (r.kind === "painting" ? "painting" : "production") as CostLineKind,
    label: r.label,
    amountKurus: r.amountKurus,
  }));
}

/**
 * Birden çok ürünün kırılımını tek sorguda yükler (sepet siparişi N+1 yapmasın).
 * Kırılımı olmayan ürün haritada YER ALMAZ — çağıran bunu "eski davranış"
 * olarak ayırt edebilsin diye (0/0 ile karıştırmamak önemli).
 */
export async function loadCostLineBases(
  productIds: readonly string[]
): Promise<Map<string, CostLineBases>> {
  const out = new Map<string, CostLineBases>();
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const rows = await db
    .select({
      productId: productCostLines.productId,
      kind: productCostLines.kind,
      amountKurus: productCostLines.amountKurus,
    })
    .from(productCostLines)
    .where(inArray(productCostLines.productId, ids));

  const byProduct = new Map<string, CostLine[]>();
  for (const r of rows) {
    const list = byProduct.get(r.productId) ?? [];
    list.push({
      kind: r.kind === "painting" ? "painting" : "production",
      amountKurus: r.amountKurus,
    });
    byProduct.set(r.productId, list);
  }
  for (const [productId, lines] of byProduct) {
    out.set(productId, splitCostLines(lines));
  }
  return out;
}

/**
 * Ürünün kırılımını siparişte gerçekleşen satır tutarına ölçekler.
 * `bases` yoksa (kırılımsız ürün) `null` döner — çağıran o siparişe
 * `productionBaseKurus = NULL` yazar ve eski hakediş kuralı sürer.
 */
export function basesForLineTotal(
  bases: CostLineBases | undefined,
  lineTotalKurus: number
): CostLineBases | null {
  if (!bases) return null;
  return allocateBases({
    productionKurus: bases.productionKurus,
    paintingKurus: bases.paintingKurus,
    totalKurus: lineTotalKurus,
  });
}
