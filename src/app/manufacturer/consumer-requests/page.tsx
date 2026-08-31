export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { consumerRequests, orders } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import {
  ConsumerRequestsTable,
  type ConsumerRequestRow,
} from "@/components/consumer/consumer-requests-table";
import type { ConsumerRequestType } from "@/lib/config/consumer-requests";

/**
 * Tüketici talepleri — satıcı görünümü.
 *
 * Aracı hizmet sağlayıcı olarak talebi satıcıya derhal iletiyoruz (e-posta +
 * panel bildirimi); bu sayfa satıcının o talebi görüp yanıtladığı yerdir.
 * Yalnızca kendi siparişlerine ait talepler listelenir.
 */
export default async function ManufacturerConsumerRequestsPage() {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

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
    .where(eq(consumerRequests.sellerManufacturerId, session.manufacturerId))
    .orderBy(desc(consumerRequests.createdAt))
    .limit(200);

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
          Siparişlerinize ilişkin cayma, fesih, bedel iadesi, işlem kayıtları ve
          teslimat talepleri. Yasal süreler işlediği için en kısa sürede yanıt verin.
        </p>
      </div>
      <ConsumerRequestsTable
        requests={requests}
        endpoint="/api/manufacturer/consumer-requests"
      />
    </div>
  );
}
