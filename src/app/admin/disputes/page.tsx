export const dynamic = "force-dynamic";

import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { disputes, orders } from "@/lib/db/schema";
import { DisputesClient } from "./client";

export default async function AdminDisputesPage() {
  const open = await db.query.disputes.findMany({
    where: eq(disputes.status, "open"),
    // `with:` BİLEREK YOK: sipariş NUMARASI yalnızca gösteriliyor, ama
    // ilişkisel sorguda `orders` okunamadığında itiraz listesinin tamamı
    // kaybolurdu — oysa itirazın kendisi okunabiliyordu.
    orderBy: [desc(disputes.createdAt)],
    limit: 200,
  });

  const orderIds = [...new Set(open.map((x) => x.orderId))];
  const numberRead = orderIds.length
    ? await db
        .select({ id: orders.id, orderNumber: orders.orderNumber })
        .from(orders)
        .where(inArray(orders.id, orderIds))
        .catch((e) => {
          console.error("disputes: sipariş numaraları okunamadı", e);
          return null;
        })
    : [];
  const numbersUnreadable = numberRead === null;
  const numberById = new Map((numberRead ?? []).map((o) => [o.id, o.orderNumber]));

  return (
    <>
      {numbersUnreadable && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Bu listenin bazı bilgileri şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            İtirazların bağlı olduğu sipariş numaraları okunamadı; kartlarda
            &quot;Sipariş numarası okunamadı&quot; yazıyor. İtirazların kendisi
            gerçektir.
          </p>
        </div>
      )}
    <DisputesClient
      disputes={open.map((x) => ({
        id: x.id,
        orderNumber:
          numberById.get(x.orderId) ??
          (numbersUnreadable ? "Sipariş numarası okunamadı" : "—"),
        category: x.category,
        description: x.description,
        createdAt: x.createdAt.toISOString(),
      }))}
    />
    </>
  );
}
