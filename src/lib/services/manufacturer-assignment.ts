import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, orders, manufacturerActions } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { regionOf } from "@/lib/data/turkey-regions";
import {
  getAssignmentWeights,
  type ScoringProfile,
} from "@/lib/config/manufacturer-scoring";

const ACTIVE_MFG_STATUSES = ["assigned", "accepted", "printing"] as const;

// v2: thresholds for on-time-delivery scoring. A manufacturer shipping
// within these windows gets full credit; beyond them they lose points
// linearly until floor 0.
const OTD_PRINT_TARGET_MS = 7 * 24 * 60 * 60 * 1000; // 7 days assign → print
const OTD_SHIP_TARGET_MS = 3 * 24 * 60 * 60 * 1000; // 3 days print → ship
const OTD_LOOKBACK = 20;

export interface CandidateScore {
  manufacturerId: string;
  companyName: string;
  city: string | null;
  district: string | null;
  phone: string | null;
  email: string;
  iban: string | null;
  currentLoad: number;
  maxConcurrentOrders: number;
  acceptingOrders: boolean;
  scores: {
    distance: number;
    load: number;
    reliability: number;
    onTimeDelivery: number;
    compliance: number;
  };
  totalScore: number;
  reasons: string[];
  eligible: boolean;
  ineligibleReason?: string;
}

function distanceScore(orderCity: string | undefined, mfgCity: string | undefined): number {
  if (!orderCity || !mfgCity) return 30;
  if (orderCity === mfgCity) return 100;
  const orderRegion = regionOf(orderCity);
  const mfgRegion = regionOf(mfgCity);
  if (orderRegion && mfgRegion && orderRegion === mfgRegion) return 60;
  return 20;
}

function loadScore(currentLoad: number, max: number): number {
  if (max <= 0) return 0;
  if (currentLoad >= max) return 0;
  const ratio = currentLoad / max;
  return Math.max(0, Math.round((1 - ratio) * 100));
}

/**
 * On-time-delivery score (Q7 v2). Looks at the last 20 completed orders
 * for this manufacturer and measures actual assign→print and print→ship
 * windows against targets. Returns 0-100 where 100 = consistently
 * shipping within target windows. Defaults to 70 (same neutral floor as
 * reliability) when there aren't enough completed orders.
 *
 * v1 ignores this signal entirely (weight = 0); v2 gives it material
 * weight via getAssignmentWeights.
 */
async function onTimeDeliveryScoreFor(manufacturerId: string): Promise<number> {
  const rows = await db
    .select({
      assignedAt: orders.assignedToManufacturerAt,
      printedAt: orders.manufacturerPrintedAt,
      shippedAt: orders.shippedAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.manufacturerId, manufacturerId),
        isNotNull(orders.shippedAt),
        isNotNull(orders.assignedToManufacturerAt),
        isNotNull(orders.manufacturerPrintedAt)
      )
    )
    .orderBy(desc(orders.shippedAt))
    .limit(OTD_LOOKBACK);

  if (rows.length < 3) return 70; // not enough signal, neutral

  let totalPctSum = 0;
  for (const r of rows) {
    if (!r.assignedAt || !r.printedAt || !r.shippedAt) continue;
    const printDelta = r.printedAt.getTime() - r.assignedAt.getTime();
    const shipDelta = r.shippedAt.getTime() - r.printedAt.getTime();
    // Each segment scored linearly: 100 if at/under target, 0 at 2× target.
    const printScore = Math.max(
      0,
      Math.min(100, 100 * (2 - printDelta / OTD_PRINT_TARGET_MS))
    );
    const shipScore = Math.max(
      0,
      Math.min(100, 100 * (2 - shipDelta / OTD_SHIP_TARGET_MS))
    );
    totalPctSum += (printScore + shipScore) / 2;
  }
  return Math.round(totalPctSum / rows.length);
}

async function reliabilityScoreFor(manufacturerId: string): Promise<number> {
  // Look at the last 20 manufacturer actions; reward "shipped" / "printed" outcomes,
  // penalize "rejected" / "cancelled". Default to 70 for new manufacturers.
  const rows = await db
    .select({ action: manufacturerActions.action })
    .from(manufacturerActions)
    .where(eq(manufacturerActions.manufacturerId, manufacturerId))
    .orderBy(sql`${manufacturerActions.createdAt} DESC`)
    .limit(20);

  if (rows.length === 0) return 70;

  let good = 0;
  let bad = 0;
  for (const r of rows) {
    if (r.action === "shipped" || r.action === "printed" || r.action === "accepted") {
      good++;
    } else if (
      r.action === "rejected" ||
      r.action === "cancelled" ||
      r.action === "decline"
    ) {
      // N12: a manufacturer-initiated decline costs reliability score; the
      // score feeds back into ranking so chronic decliners drift down the
      // candidate list and eventually become ineligible by score weight.
      bad++;
    }
  }
  const total = good + bad;
  if (total === 0) return 70;
  return Math.round((good / total) * 100);
}

/**
 * Rank candidates for an order using either v1 (legacy) or v2 (Q7
 * rollout). Profile defaults to v1 so existing callers stay on the
 * authoritative algorithm during shadow phase; Q7 dual-write code calls
 * with `"v2"` explicitly to capture the parallel evaluation.
 */
export async function rankManufacturersForOrder(
  orderId: string,
  profile: ScoringProfile = "v1"
): Promise<CandidateScore[]> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { shippingAddress: true },
  });
  if (!order) return [];

  const weights = getAssignmentWeights(profile);

  const shipping = order.shippingAddress as TurkishAddress | null;
  const orderCity = shipping?.il;

  const mfgs = await db.query.manufacturers.findMany({
    where: inArray(manufacturers.status, ["active"]),
  });

  if (mfgs.length === 0) return [];

  // Bulk-compute current load for all active manufacturers.
  const loads = await db
    .select({
      manufacturerId: orders.manufacturerId,
      load: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.manufacturerStatus, [...ACTIVE_MFG_STATUSES]),
        sql`${orders.manufacturerId} IS NOT NULL`
      )
    )
    .groupBy(orders.manufacturerId);
  const loadMap = new Map<string, number>();
  for (const l of loads) {
    if (l.manufacturerId) loadMap.set(l.manufacturerId, l.load);
  }

  const candidates = await Promise.all(
    mfgs.map(async (m): Promise<CandidateScore> => {
      const addr = m.address as TurkishAddress | null;
      const city = addr?.il ?? null;
      const district = addr?.ilce ?? null;
      const currentLoad = loadMap.get(m.id) ?? 0;
      const max = m.maxConcurrentOrders;

      const [reliability, onTimeDelivery] = await Promise.all([
        reliabilityScoreFor(m.id),
        // v1 doesn't use OTD — skip the query to keep v1 ranking fast.
        weights.onTimeDelivery > 0
          ? onTimeDeliveryScoreFor(m.id)
          : Promise.resolve(70),
      ]);
      const scores = {
        distance: distanceScore(orderCity, city ?? undefined),
        load: loadScore(currentLoad, max),
        reliability,
        onTimeDelivery,
        compliance:
          (m.requiresManualTaxReview ? 60 : 100) +
          (m.iban ? 0 : -10) +
          (m.acceptingOrders ? 0 : -20),
      };
      scores.compliance = Math.max(0, Math.min(100, scores.compliance));

      const totalScore =
        scores.distance * weights.distance +
        scores.load * weights.load +
        scores.reliability * weights.reliability +
        scores.onTimeDelivery * weights.onTimeDelivery +
        scores.compliance * weights.compliance;

      let eligible = true;
      let ineligibleReason: string | undefined;
      if (!m.acceptingOrders) {
        eligible = false;
        ineligibleReason = "Sipariş almıyor";
      } else if (currentLoad >= max) {
        eligible = false;
        ineligibleReason = "Kapasite dolu";
      }
      // IBAN is required for payout but isn't a hard eligibility gate — pre-existing
      // manufacturers may not have filled it in yet, and blocking them entirely freezes
      // assignment. Surface the missing-IBAN warning via a reason chip instead and let
      // the admin decide. (Compliance score already penalizes missing IBAN.)

      const reasons: string[] = [];
      if (orderCity && city && orderCity === city) reasons.push("Aynı şehir");
      else if (scores.distance >= 60) reasons.push("Aynı bölge");
      if (scores.load >= 80) reasons.push("Düşük yük");
      else if (scores.load <= 30 && eligible) reasons.push("Yüksek yük");
      if (scores.reliability >= 85) reasons.push("Güvenilir");
      if (weights.onTimeDelivery > 0 && scores.onTimeDelivery >= 85)
        reasons.push("Hızlı teslimat");
      if (m.requiresManualTaxReview) reasons.push("Vergi incelemede");
      if (!m.iban) reasons.push("⚠ IBAN eksik");

      return {
        manufacturerId: m.id,
        companyName: m.companyName,
        city,
        district,
        phone: m.phone,
        email: m.email,
        iban: m.iban,
        currentLoad,
        maxConcurrentOrders: max,
        acceptingOrders: m.acceptingOrders,
        scores,
        totalScore: Math.round(totalScore),
        reasons,
        eligible,
        ineligibleReason,
      };
    })
  );

  // Sort eligible first (by score desc), ineligible at bottom.
  return candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.totalScore - a.totalScore;
  });
}
