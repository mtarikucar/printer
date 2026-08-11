import "dotenv/config";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { db } from "../src/lib/db";
import { orders, manufacturers } from "../src/lib/db/schema";

async function main() {
  const mfg = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.email, "atolye3d@demo.local"),
    columns: { id: true },
  });
  const o = await db.query.orders.findFirst({
    where: and(eq(orders.manufacturerId, mfg!.id), isNotNull(orders.parentReference)),
    orderBy: [desc(orders.createdAt)],
    columns: { id: true },
  });
  console.log(o?.id ?? "");
  process.exit(0);
}
main();
