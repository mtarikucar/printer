export const dynamic = "force-dynamic";

import { desc, eq } from "drizzle-orm";
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
      orderNumber: orders.orderNumber,
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
    .leftJoin(orders, eq(consumerRequests.orderId, orders.id))
    .orderBy(desc(consumerRequests.createdAt))
    .limit(500);

  const requests: ConsumerRequestRow[] = rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    orderNumber: r.orderNumber,
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
      <ConsumerRequestsTable
        requests={requests}
        endpoint="/api/admin/consumer-requests"
      />
    </div>
  );
}
