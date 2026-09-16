export const dynamic = "force-dynamic";

import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { consumerRequests, orders } from "@/lib/db/schema";
import {
  ConsumerRequestsTable,
  type ConsumerRequestRow,
} from "@/components/consumer/consumer-requests-table";
import type { ConsumerRequestType } from "@/lib/config/consumer-requests";

/**
 * Tüketici talepleri (MSY m.12/A) — admin görünümü.
 *
 * Platform ürünlerinde muhatap doğrudan biziz (satıcı yok), üçüncü kişi
 * satıcı ürünlerinde ise aracıyız ve talebin iletildiğini burada denetleriz.
 * `forwardedAt` boş bir satır, iletme yükümlülüğünün karşılanmadığı anlamına
 * gelir ve tabloda kırmızı görünür.
 */
export default async function AdminConsumerRequestsPage() {
  const rows = await db
    .select({
      id: consumerRequests.id,
      reference: consumerRequests.reference,
      orderId: consumerRequests.orderId,
      type: consumerRequests.type,
      status: consumerRequests.status,
      message: consumerRequests.message,
      contactEmail: consumerRequests.contactEmail,
      forwardedAt: consumerRequests.forwardedAt,
      forwardFailedReason: consumerRequests.forwardFailedReason,
      resolutionNote: consumerRequests.resolutionNote,
      createdAt: consumerRequests.createdAt,
    })
    .from(consumerRequests)
    .orderBy(desc(consumerRequests.createdAt))
    .limit(500);

  // `leftJoin(orders)` KALDIRILDI: sipariş NUMARASI yalnızca gösteriliyor, ama
  // join TEK ifadedir — `orders` okunamadığında tüketici talepleri masasının
  // tamamı 500 verirdi. Oysa taleplerin kendisi okunabiliyordu ve bu ekran
  // yasal süreli bir masadır (Mesafeli Sözleşmeler Yönetmeliği m.12/A).
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
  const numberRead = orderIds.length
    ? await db
        .select({ id: orders.id, orderNumber: orders.orderNumber })
        .from(orders)
        .where(inArray(orders.id, orderIds))
        .catch((e) => {
          console.error("tüketici talepleri: sipariş numaraları okunamadı", e);
          return null;
        })
    : [];
  const orderNumbersUnreadable = numberRead === null;
  const numberById = new Map((numberRead ?? []).map((o) => [o.id, o.orderNumber]));

  const requests: ConsumerRequestRow[] = rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    orderNumber:
      numberById.get(r.orderId ?? "") ??
      (orderNumbersUnreadable ? "Sipariş numarası okunamadı" : null),
    type: r.type as ConsumerRequestType,
    status: r.status,
    message: r.message,
    contactEmail: r.contactEmail,
    forwardedAt: r.forwardedAt ? r.forwardedAt.toISOString() : null,
    forwardFailedReason: r.forwardFailedReason,
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-text-primary">Tüketici talepleri</h1>
        <p className="text-sm text-text-secondary mt-1">
          Mesafeli Sözleşmeler Yönetmeliği m.12/A kapsamındaki cayma, fesih,
          bedel iadesi, işlem kayıtları ve teslimat talepleri.
        </p>
      </div>
      {orderNumbersUnreadable && (
        <div
          role="alert"
          className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Sipariş numaraları şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            Taleplerin bağlı olduğu sipariş numaraları BOŞ DEĞİL, bilinmiyor —
            numarasız görünen bir talep &quot;siparişsiz talep&quot; demek değildir.
            Taleplerin kendisi, süreleri ve durumları gerçek kayıtlardır.
          </p>
        </div>
      )}
      <ConsumerRequestsTable
        requests={requests}
        endpoint="/api/admin/consumer-requests"
      />
    </div>
  );
}
