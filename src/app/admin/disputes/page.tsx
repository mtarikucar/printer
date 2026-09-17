export const dynamic = "force-dynamic";

import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { disputes, orders, orderRefundRecords, orderRefundAllocations } from "@/lib/db/schema";
import { DISPUTE_STATUS_LABELS_TR, type DisputeStatus } from "@/lib/config/dispute-resolution";
import { DisputesClient } from "./client";

export default async function AdminDisputesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.status ?? "open";
  if (typeof raw !== "string" || !Object.hasOwn(DISPUTE_STATUS_LABELS_TR, raw)) {
    return <DisputesClient disputes={[]} readError="Anlaşmazlık durum filtresi geçersiz." />;
  }
  const status = raw as DisputeStatus;
  const pageValue = params.page ?? "1";
  const page = typeof pageValue === "string" && /^[1-9]\d*$/.test(pageValue) ? Number(pageValue) : NaN;
  const pageSize = 50;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(page * pageSize)) {
    return <DisputesClient disputes={[]} status={status} readError="Anlaşmazlık sayfa numarası geçersiz." />;
  }
  const rows = await db.query.disputes.findMany({
    where: eq(disputes.status, status),
    columns: { id: true, orderId: true, category: true, description: true, status: true,
      resolution: true, createdAt: true, resolvedAt: true, decisionOperationKey: true, refundRecordId: true },
    orderBy: [desc(disputes.createdAt), desc(disputes.id)],
    limit: pageSize + 1,
    offset: (page - 1) * pageSize,
  }).catch(e => {
    console.error("disputes: anlaşmazlık listesi okunamadı", e);
    return null;
  });
  if (!rows) return <DisputesClient disputes={[]} status={status} page={page} readError="Anlaşmazlık kayıtları şu anda okunamıyor. Liste boş olarak doğrulanmadı; yeniden deneyin." />;

  const visible = rows.slice(0, pageSize);
  const hasNext = rows.length > pageSize;
  const orderIds = [...new Set(visible.map(row => row.orderId))];
  const refundIds = visible.flatMap(row => row.refundRecordId ? [row.refundRecordId] : []);
  // A missing order number or unavailable financial read must not hide decisions.
  const [numberRead, refundRead] = await Promise.all([
    orderIds.length ? db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders)
      .where(inArray(orders.id, orderIds)).catch(e => {
        console.error("disputes: sipariş numaraları okunamadı", e); return null;
      }) : [],
    refundIds.length ? db.select({ refundId: orderRefundRecords.id, operationKey: orderRefundRecords.operationKey,
      orderId: orderRefundAllocations.orderId, cashKurus: orderRefundAllocations.cashKurus, giftKurus: orderRefundAllocations.giftKurus })
      .from(orderRefundRecords).innerJoin(orderRefundAllocations, eq(orderRefundAllocations.refundId, orderRefundRecords.id))
      .where(and(inArray(orderRefundRecords.id, refundIds), eq(orderRefundRecords.kind, "refund"), eq(orderRefundAllocations.kind, "refund")))
      .catch(e => { console.error("disputes: bağlı iade tutarları okunamadı", e); return null; }) : [],
  ]);
  const numbers = new Map((numberRead ?? []).map(row => [row.id, row.orderNumber]));
  const warnings = [numberRead === null ? "Sipariş numaraları okunamadı; sipariş bağlantıları kullanılabilir." : null,
    refundRead === null ? "Kararlara bağlı iade tutarları okunamadı; bilinmeyen tutarlar sıfır olarak gösterilmiyor." : null].filter(Boolean);
  return <DisputesClient status={status} page={page} hasNext={hasNext} warning={warnings.join(" ") || undefined} disputes={visible.map(row => {
    const allocation = row.status === "resolved" && row.decisionOperationKey
      ? refundRead?.find(r => r.refundId === row.refundRecordId && r.operationKey === row.decisionOperationKey && r.orderId === row.orderId)
      : null;
    return { ...row, orderNumber: numbers.get(row.orderId) ?? null,
      createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null,
      refund: allocation ? { cashKurus: allocation.cashKurus, giftKurus: allocation.giftKurus } : null };
  })} />;
}
