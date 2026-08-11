import "dotenv/config";
import { eq, desc } from "drizzle-orm";
import { db } from "../src/lib/db";
import { products, orders } from "../src/lib/db/schema";

async function main() {
  const p = await db.query.products.findFirst({
    where: eq(products.title, "E2E Masa Lambası"),
    orderBy: [desc(products.createdAt)],
    columns: { id: true, slug: true },
  });
  const o = p
    ? await db.query.orders.findFirst({
        where: eq(orders.productId, p.id),
        orderBy: [desc(orders.createdAt)],
        columns: { id: true },
      })
    : null;
  console.log(`${p?.id ?? ""} ${p?.slug ?? ""} ${o?.id ?? ""}`);
  process.exit(0);
}
main();
