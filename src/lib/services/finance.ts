// Pure financial math for manufacturer earnings + customer invoices.
// Dependency-free and unit-tested (scripts/test-finance.ts). Amounts are in
// kuruş (integer); rates are basis points (10000 = 100%).

export interface Earning {
  grossKurus: number;
  commissionKurus: number;
  netKurus: number;
  commissionRateBps: number;
}

// Platform keeps `commissionRateBps`; the manufacturer is paid the remainder.
// Commission is rounded; net is the exact remainder so the two always sum to gross.
export function computeEarning(
  grossKurus: number,
  commissionRateBps: number
): Earning {
  const commissionKurus = Math.round((grossKurus * commissionRateBps) / 10000);
  const netKurus = grossKurus - commissionKurus;
  return { grossKurus, commissionKurus, netKurus, commissionRateBps };
}

export interface KdvBreakdown {
  subtotalKurus: number;
  kdvKurus: number;
  totalKurus: number;
  kdvRateBps: number;
}

// Prices are KDV-inclusive (TR retail). subtotal is the pre-tax base; kdv is the
// exact remainder so the two always sum to total.
export function computeKdv(totalKurus: number, kdvRateBps: number): KdvBreakdown {
  const subtotalKurus = Math.round(totalKurus / (1 + kdvRateBps / 10000));
  const kdvKurus = totalKurus - subtotalKurus;
  return { subtotalKurus, kdvKurus, totalKurus, kdvRateBps };
}
