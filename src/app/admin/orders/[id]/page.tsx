export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts, meshReports, adminActions } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { OrderDetailClient } from "./client";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/i18n/format";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const d = getDictionary(locale);

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      photos: true,
      generationAttempts: {
        orderBy: [desc(generationAttempts.createdAt)],
        with: {
          meshReports: true,
        },
      },
      adminActions: {
        orderBy: [desc(adminActions.createdAt)],
      },
    },
  });

  if (!order) notFound();

  const latestGeneration = order.generationAttempts.find(
    (g) => g.status === "succeeded"
  );
  const latestReport = latestGeneration?.meshReports?.[0];
  const addr = order.shippingAddress as TurkishAddress | null;

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {d["admin.orderDetail.order"]} {order.orderNumber}
          </h1>
          <p className="text-gray-500">
            {order.customerName} &middot; {order.email}
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-lg text-sm font-medium ${
            order.status === "review"
              ? "bg-yellow-100 text-yellow-700"
              : order.status === "approved"
                ? "bg-green-100 text-green-700"
                : order.status.startsWith("failed") || order.status === "rejected"
                  ? "bg-red-100 text-red-700"
                  : "bg-blue-100 text-blue-700"
          }`}
        >
          {order.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: Photo + 3D Model */}
        <div className="space-y-6">
          {/* Original Photo */}
          {order.photos[0] && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                {d["admin.orderDetail.originalPhoto"]}
              </h2>
              <img
                src={order.photos[0].originalUrl}
                alt={d["admin.orderDetail.customerPhoto"]}
                className="w-full max-h-64 object-contain rounded-lg"
              />
            </div>
          )}

          {/* 3D Model Viewer / Actions */}
          {(latestGeneration?.outputGlbUrl || order.status === "pending_payment") && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              {latestGeneration?.outputGlbUrl && (
                <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                  {d["admin.orderDetail.modelPreview"]}
                </h2>
              )}
              <OrderDetailClient
                glbUrl={latestGeneration?.outputGlbUrl}
                stlUrl={latestGeneration?.outputStlUrl}
                orderId={order.id}
                orderStatus={order.status}
              />
            </div>
          )}
        </div>

        {/* Right: Info + Actions */}
        <div className="space-y-6">
          {/* Order Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">
              {d["admin.orderDetail.orderDetails"]}
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.size"]}</dt>
                <dd className="font-medium">{d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.amount"]}</dt>
                <dd className="font-medium">
                  {formatCurrency(order.amountKurus, locale)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.payment"]}</dt>
                <dd>{order.paidAt ? formatDateTime(order.paidAt, locale) : d["admin.orderDetail.notPaid"]}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.retryCount"]}</dt>
                <dd>{order.retryCount}</dd>
              </div>
              {order.trackingNumber && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.trackingNumber"]}</dt>
                  <dd className="font-mono">{order.trackingNumber}</dd>
                </div>
              )}
              {order.failureReason && (
                <div className="pt-2 border-t">
                  <dt className="text-red-600 font-medium">{d["admin.orderDetail.failureReason"]}</dt>
                  <dd className="text-red-700 mt-1 text-xs break-all">
                    {order.failureReason}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">
              {d["admin.orderDetail.shippingAddress"]}
            </h2>
            {addr && (
              <div className="text-sm text-gray-700">
                {addr.mahalle && <p>{addr.mahalle}</p>}
                <p>{addr.adres}</p>
                <p>{addr.ilce} / {addr.il}</p>
                <p>{addr.postaKodu}</p>
                <p className="mt-1">Tel: {addr.telefon}</p>
              </div>
            )}
          </div>

          {/* Mesh Report */}
          {latestReport && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                {d["admin.orderDetail.meshReport"]}
              </h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.watertight"]}</dt>
                  <dd className={latestReport.isWatertight ? "text-green-600" : "text-red-600"}>
                    {latestReport.isWatertight ? d["common.yes"] : d["common.no"]}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.solidVolume"]}</dt>
                  <dd className={latestReport.isVolume ? "text-green-600" : "text-red-600"}>
                    {latestReport.isVolume ? d["common.yes"] : d["common.no"]}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.vertex"]}</dt>
                  <dd>{formatNumber(latestReport.vertexCount, locale)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.face"]}</dt>
                  <dd>{formatNumber(latestReport.faceCount, locale)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.component"]}</dt>
                  <dd>{latestReport.componentCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.baseAdded"]}</dt>
                  <dd>{latestReport.baseAdded ? d["common.yes"] : d["common.no"]}</dd>
                </div>
                {latestReport.boundingBox && typeof latestReport.boundingBox === "object" && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">{d["admin.orderDetail.dimensions"]}</dt>
                    <dd className="font-mono text-xs">
                      {(latestReport.boundingBox as any).size?.map((v: number) => v.toFixed(1)).join(" x ")}
                    </dd>
                  </div>
                )}
                {latestReport.repairsApplied && Array.isArray(latestReport.repairsApplied) && (latestReport.repairsApplied as string[]).length > 0 && (
                  <div className="pt-2 border-t">
                    <dt className="text-gray-500 mb-1">{d["admin.orderDetail.repairsApplied"]}</dt>
                    <dd className="flex flex-wrap gap-1">
                      {(latestReport.repairsApplied as string[]).map((r: string) => (
                        <span key={r} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">
                          {r}
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Generation History */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">
              {d["admin.orderDetail.generationHistory"]}
            </h2>
            <div className="space-y-2">
              {order.generationAttempts.map((attempt) => (
                <div key={attempt.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                  <div>
                    <span className="font-medium capitalize">{attempt.provider}</span>
                    <span className={`ml-2 text-xs ${attempt.status === "succeeded" ? "text-green-600" : attempt.status === "failed" ? "text-red-600" : "text-yellow-600"}`}>
                      {attempt.status === "succeeded" ? d["admin.orderDetail.succeeded"] : attempt.status === "failed" ? d["admin.orderDetail.generationFailed"] : attempt.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {attempt.durationMs ? `${(attempt.durationMs / 1000).toFixed(1)}s` : ""}
                    {attempt.costCents ? ` · $${(attempt.costCents / 100).toFixed(2)}` : ""}
                  </div>
                </div>
              ))}
              {order.generationAttempts.length === 0 && (
                <p className="text-sm text-gray-500">{d["admin.orderDetail.noAttempts"]}</p>
              )}
            </div>
          </div>

          {/* Admin Action History */}
          {order.adminActions.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                {d["admin.orderDetail.adminActions"]}
              </h2>
              <div className="space-y-2">
                {order.adminActions.map((action) => (
                  <div key={action.id} className="text-sm border-b border-gray-100 pb-2 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize">{action.action}</span>
                      <span className="text-xs text-gray-500">
                        {formatDateTime(action.createdAt, locale)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{action.adminEmail}</p>
                    {action.notes && <p className="text-xs text-gray-600 mt-1">{action.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
