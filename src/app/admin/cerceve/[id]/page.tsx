export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { manufacturers } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { buildOrderMoneyBreakdown } from "@/lib/services/order-money";
import {
  loadManufacturerCapacities,
  manufacturerLoadLabel,
} from "@/lib/services/manufacturer-capacity";
import { frameworkSurfacesEnabled } from "@/lib/services/quote-access";
import {
  loadFrameworkAudit,
  loadFrameworkDetail,
  loadFrameworkForwardLoad,
} from "@/lib/services/quote-framework";
import type { BatchRow } from "@/components/framework/batch-timeline";
import { FrameworkDetailClient } from "./client";

/**
 * `/admin/cerceve/[id]` — anlaşmanın karar ekranı.
 *
 * BAYRAK KAPALIYKEN 404 (`quoteApiEnabled` deseni); admin oturumu iç test için
 * geçer. Anlaşmanın KENDİSİ sayfanın çekirdek verisidir: okunamazsa
 * gösterilecek bir şey de yoktur, bu yüzden o okuma korumasızdır (ev kuralı,
 * `CORE_READS`). GÖSTERİM okumaları (para dökümü, tezgâh yükü, denetim izi)
 * korumalıdır ve arıza `null` döner — `null` "boş" değil "BİLİNMİYOR"dur.
 *
 * ─── PARA DÖKÜMÜ TEK KAYNAKTAN ─────────────────────────────────────────────
 *
 * Her partinin siparişinin dökümü `deriveOrderMoneyBreakdown`tan gelir
 * (`buildOrderMoneyBreakdown`, `src/lib/config/order-money.ts`); bu sayfa
 * komisyon ya da partner net için KENDİ çıkarmasını yapmaz, yalnız
 * serileştirir.
 *
 * ─── İLERİYE DÖNÜK YÜK GÖSTERİMDİR, KAPI DEĞİL ─────────────────────────────
 *
 * Tezgâh etiketi SUNUCUDA `manufacturerLoadLabel` ile üretilir ve hazır dize
 * olarak iner: istemci bileşeni `services/manufacturer-capacity`i IMPORT
 * EDEMEZ (`pg`yi paketine sürükler ve depo geneli tarayıcı bunu düşürür).
 */
const FORWARD_LOAD_WINDOW_DAYS = 30;

async function displayRead<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[admin/cerceve] ${label} okunamadı`, e);
    return null;
  }
}

export default async function AdminFrameworkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await frameworkSurfacesEnabled())) notFound();

  const { id } = await params;
  const detail = await loadFrameworkDetail(id);
  if (!detail) notFound();

  // Parti başına para dökümü: yalnız SİPARİŞİ olan partiler için.
  const moneyByBatch = new Map<string, Awaited<ReturnType<typeof buildOrderMoneyBreakdown>>>();
  const moneyUnreadable = new Set<string>();
  for (const batch of detail.batches) {
    if (!batch.orderId) continue;
    const breakdown = await displayRead(
      `parti ${batch.position} para dökümü`,
      buildOrderMoneyBreakdown(batch.orderId)
    );
    if (breakdown === null) moneyUnreadable.add(batch.id);
    else moneyByBatch.set(batch.id, breakdown);
  }

  const batches: BatchRow[] = detail.batches.map((b) => {
    const breakdown = moneyByBatch.get(b.id) ?? null;
    return {
      id: b.id,
      position: b.position,
      status: b.status,
      plannedShipDate: b.plannedShipDate,
      units: b.units,
      amountKurus: b.amountKurus,
      quoteId: b.quoteId,
      quoteNumber: b.quoteNumber,
      orderId: b.orderId,
      orderNumber: b.orderNumber,
      commissionRateBps: b.commissionRateBps,
      releasedAt: b.releasedAt,
      cancelledAt: b.cancelledAt,
      cancelReason: b.cancelReason,
      note: b.note,
      releaseWindowOpen: b.releaseWindowOpen,
      lines: b.lines.map((l) => ({
        partId: l.partId,
        quantity: l.quantity,
        unitKurus: l.unitKurus,
        lineKurus: l.lineKurus,
      })),
      money: breakdown
        ? {
            amountKurus: breakdown.totals.amountKurus,
            cashCollectedKurus: breakdown.collection.cashCollectedKurus,
            revenueKurus: breakdown.collection.revenueKurus,
            paymentStatus: breakdown.collection.paymentStatus,
            cancelled: breakdown.collection.cancelled === true,
            platformCommissionKurus: breakdown.platform.commissionKurus,
            platformNetKurus: breakdown.platform.netKurus,
            shares: breakdown.shares.map((s) => ({
              party: s.party,
              partnerName: s.partnerName,
              // Tahakkuk etmiş satır varsa GERÇEK rakamlar, yoksa BEKLENEN:
              // seçim `deriveOrderMoneyBreakdown`ın kendi sözleşmesidir ve
              // burada yeniden yorumlanmaz, yalnız hangisinin gösterildiği
              // `accrued` ile söylenir.
              baseKurus: s.earning?.grossKurus ?? s.baseKurus,
              commissionKurus: s.earning?.commissionKurus ?? s.expectedCommissionKurus,
              netKurus: s.earning?.netKurus ?? s.expectedNetKurus,
              rateBps: s.earning?.rateBps ?? s.rateBps,
              rateIsEstimate: s.earning === null && s.rateIsEstimate,
              accrued: s.earning !== null,
            })),
            warnings: breakdown.warnings,
          }
        : null,
      moneyUnreadable: moneyUnreadable.has(b.id),
    };
  });

  // Çapa seçicisinin listesi + çapalı atölyenin tezgâh etiketi ve ileriye
  // dönük yükü. Üçü de GÖSTERİMDİR.
  const shopsRead = await displayRead(
    "aktif atölyeler",
    db
      .select({ id: manufacturers.id, companyName: manufacturers.companyName })
      .from(manufacturers)
      .where(eq(manufacturers.status, "active"))
      .orderBy(asc(manufacturers.companyName))
  );

  let benchLabel: string | null = null;
  let forwardLoad: Awaited<ReturnType<typeof loadFrameworkForwardLoad>> | null = null;
  let benchUnreadable = false;
  if (detail.preferredManufacturerId) {
    const capsRead = await displayRead(
      "çapalı atölyenin tezgâhı",
      loadManufacturerCapacities([detail.preferredManufacturerId])
    );
    if (capsRead === null) benchUnreadable = true;
    else {
      const cap = capsRead.get(detail.preferredManufacturerId);
      benchLabel = cap ? manufacturerLoadLabel(cap) : null;
    }
    forwardLoad = await displayRead(
      "ileriye dönük yük",
      loadFrameworkForwardLoad({
        manufacturerId: detail.preferredManufacturerId,
        windowDays: FORWARD_LOAD_WINDOW_DAYS,
      })
    );
  }

  // Denetim izi kaynak teklifin altında duruyor (`quote_admin_actions.quote_id`).
  const auditRead = await displayRead(
    "denetim izi",
    loadFrameworkAudit(detail.quoteId)
  );

  return (
    <FrameworkDetailClient
      framework={{
        id: detail.id,
        number: detail.number,
        status: detail.status,
        title: detail.title,
        quoteId: detail.quoteId,
        quoteNumber: detail.quoteNumber,
        leadTier: detail.leadTier,
        leadDays: detail.leadDays,
        committedUnits: detail.committedUnits,
        committedTotalKurus: detail.committedTotalKurus,
        batchesTotalKurus: detail.batchesTotalKurus,
        priceLockedUntil: detail.priceLockedUntil,
        lockExpired: detail.lockExpired,
        preferredManufacturerId: detail.preferredManufacturerId,
        preferredManufacturerName: detail.preferredManufacturerName,
        shippingAddress: detail.shippingAddress,
        termsVersion: detail.termsVersion,
        termsAcceptedAt: detail.termsAcceptedAt,
        customerNote: detail.customerNote,
        adminNote: detail.adminNote,
        activatedAt: detail.activatedAt,
        activatedByEmail: detail.activatedByEmail,
        cancelledAt: detail.cancelledAt,
        cancelReason: detail.cancelReason,
        createdAt: detail.createdAt,
        parts: detail.partsSnapshot.map((p) => ({
          partId: p.partId,
          position: p.position,
          name: p.name,
          technologyName: p.technologyName,
          materialName: p.materialName,
          finishName: p.finishName,
          quantity: p.quantity,
          unitKurus: p.unitKurus,
          lineKurus: p.lineKurus,
        })),
        addons: detail.addonsSnapshot,
        progress: detail.progress,
      }}
      batches={batches}
      shops={shopsRead ?? []}
      shopsUnreadable={shopsRead === null}
      benchLabel={benchLabel}
      benchUnreadable={benchUnreadable}
      forwardLoad={forwardLoad}
      audit={auditRead ?? []}
      auditUnreadable={auditRead === null}
    />
  );
}
