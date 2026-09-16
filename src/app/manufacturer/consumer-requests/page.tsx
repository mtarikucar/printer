export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
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
    .where(eq(consumerRequests.sellerManufacturerId, session.manufacturerId))
    .orderBy(desc(consumerRequests.createdAt))
    .limit(200);

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
          Siparişlerinize ilişkin cayma, fesih, bedel iadesi, işlem kayıtları ve
          teslimat talepleri. Yasal süreler işlediği için en kısa sürede yanıt verin.
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
        endpoint="/api/manufacturer/consumer-requests"
      />
    </div>
  );
}
