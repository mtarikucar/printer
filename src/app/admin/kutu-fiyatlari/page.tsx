export const dynamic = "force-dynamic";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { listBoxTiers } from "@/lib/services/box-tiers";
import { BoxTiersClient } from "./box-tiers-client";

export default async function AdminBoxTiersPage() {
  const [tiers, eligible] = await Promise.all([
    listBoxTiers(),
    db
      .select({
        id: products.id,
        title: products.title,
        priceKurus: products.priceKurus,
      })
      .from(products)
      .where(and(eq(products.boxEligible, true), eq(products.status, "active")))
      .orderBy(asc(products.priceKurus)),
  ]);

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">
        Anahtarlık kutusu fiyatları
      </h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Kutu fiyatı <strong>kutunun toplam adedinden</strong> hesaplanır, ürün
        bazındaki toplu kademelerden bağımsızdır. Müşteri 10 tasarımdan 10&apos;ar
        alırsa 100 adetlik kutu olur ve hepsi 100+ fiyatından satılır. En düşük
        kademe aynı zamanda kutunun alt sınırıdır — altında sipariş verilemez.
      </p>

      <BoxTiersClient initialTiers={tiers} eligible={eligible} />
    </div>
  );
}
