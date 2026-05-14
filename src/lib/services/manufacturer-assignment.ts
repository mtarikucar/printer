import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, orders, manufacturerActions } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { regionOf } from "@/lib/data/turkey-regions";

const WEIGHTS = {
  distance: 0.4,
  load: 0.35,
  reliability: 0.2,
  compliance: 0.05,
} as const;

const ACTIVE_MFG_STATUSES = ["assigned", "accepted", "printing"] as const;

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
    } else if (r.action === "rejected" || r.action === "cancelled") {
      bad++;
    }
  }
  const total = good + bad;
  if (total === 0) return 70;
  return Math.round((good / total) * 100);
}

export async function rankManufacturersForOrder(
  orderId: string
): Promise<CandidateScore[]> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { shippingAddress: true },
  });
  if (!order) return [];

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

      const scores = {
        distance: distanceScore(orderCity, city ?? undefined),
        load: loadScore(currentLoad, max),
        reliability: await reliabilityScoreFor(m.id),
        compliance:
          (m.requiresManualTaxReview ? 60 : 100) +
          (m.iban ? 0 : -10) +
          (m.acceptingOrders ? 0 : -20),
      };
      scores.compliance = Math.max(0, Math.min(100, scores.compliance));

      const totalScore =
        scores.distance * WEIGHTS.distance +
        scores.load * WEIGHTS.load +
        scores.reliability * WEIGHTS.reliability +
        scores.compliance * WEIGHTS.compliance;

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
