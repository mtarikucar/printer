export const dynamic = "force-dynamic";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturerEarnings,
  manufacturers,
  orders,
  painterEarnings,
  painterPayouts,
  painters,
  payouts,
} from "@/lib/db/schema";
import {
  PayoutsClient,
  type BankInfo,
  type EarningLine,
  type OwedPartner,
  type PayoutRow,
  type PayoutTabData,
} from "./client";

// Partner ödemeleri — üretici VE boyacı için aynı iki adımlı akış:
//   1) "Ödeme oluştur": partnerin bekleyen, henüz bir ödemeye girmemiş
//      hakedişleri tek BEKLEYEN ödemede toplanır (partnerin kendi talebi de
//      buraya düşer);
//   2) banka transferi yapılınca "Ödendi işaretle" (referansla).
// Boyacı tarafının önceden hiç ekranı yoktu: boyacının kendi talep ettiği
// bekleyen ödemeler hiçbir yerde görünmüyordu ve tek yol, hakedişleri tek
// adımda "ödendi" yazan bir API'ydi. Tutarlar hakediş satırlarının kendisidir
// (tahakkukta computeEarning ile yazılmış) — burada yeniden hesaplanmaz.

interface BankColumns {
  iban: string | null;
  bankAccountHolder: string | null;
  bankName: string | null;
  pendingIban: string | null;
  ibanReviewStatus: string;
}

const BANK_COLUMNS = {
  iban: true,
  bankAccountHolder: true,
  bankName: true,
  pendingIban: true,
  ibanReviewStatus: true,
} as const;

// Partnerin kendi talebiyle açılan ödemeler bu adminEmail'lerle yazılır
// (/api/manufacturer/payout-request, /api/painter/payout-request).
const PARTNER_REQUEST_EMAILS = new Set(["manufacturer-request", "painter-request"]);

function bankOf(p: BankColumns | null | undefined): BankInfo {
  return {
    iban: p?.iban ?? null,
    accountHolder: p?.bankAccountHolder ?? null,
    bankName: p?.bankName ?? null,
    pendingIban: p?.pendingIban ?? null,
    ibanReviewPending: p?.ibanReviewStatus === "pending",
  };
}

interface EarningColumns {
  orderId: string;
  grossKurus: number;
  commissionKurus: number;
  netKurus: number;
  status: string;
  createdAt: Date;
}

function earningLine(e: EarningColumns, orderNumber: string | null | undefined): EarningLine {
  return {
    orderId: e.orderId,
    orderNumber: orderNumber ?? "—",
    grossKurus: e.grossKurus,
    commissionKurus: e.commissionKurus,
    netKurus: e.netKurus,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
  };
}

function groupOwed(
  rows: Array<EarningColumns & BankColumns & { partnerId: string; name: string; orderNumber: string }>
): OwedPartner[] {
  const byPartner = new Map<string, OwedPartner>();
  for (const r of rows) {
    let g = byPartner.get(r.partnerId);
    if (!g) {
      g = { partnerId: r.partnerId, name: r.name, owedKurus: 0, count: 0, bank: bankOf(r), earnings: [] };
      byPartner.set(r.partnerId, g);
    }
    g.owedKurus += r.netKurus;
    g.count += 1;
    g.earnings.push(earningLine(r, r.orderNumber));
  }
  return [...byPartner.values()].sort((a, b) => b.owedKurus - a.owedKurus);
}

const EARNING_COLUMNS = {
  orderId: true,
  grossKurus: true,
  commissionKurus: true,
  netKurus: true,
  status: true,
  createdAt: true,
} as const;

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;

  const [mOwedRows, mPayoutRows, pOwedRows, pPayoutRows] = await Promise.all([
    db
      .select({
        partnerId: manufacturerEarnings.manufacturerId,
        name: manufacturers.companyName,
        orderId: manufacturerEarnings.orderId,
        orderNumber: orders.orderNumber,
        grossKurus: manufacturerEarnings.grossKurus,
        commissionKurus: manufacturerEarnings.commissionKurus,
        netKurus: manufacturerEarnings.netKurus,
        status: manufacturerEarnings.status,
        createdAt: manufacturerEarnings.createdAt,
        iban: manufacturers.iban,
        bankAccountHolder: manufacturers.bankAccountHolder,
        bankName: manufacturers.bankName,
        pendingIban: manufacturers.pendingIban,
        ibanReviewStatus: manufacturers.ibanReviewStatus,
      })
      .from(manufacturerEarnings)
      .innerJoin(manufacturers, eq(manufacturers.id, manufacturerEarnings.manufacturerId))
      .innerJoin(orders, eq(orders.id, manufacturerEarnings.orderId))
      .where(and(eq(manufacturerEarnings.status, "pending"), isNull(manufacturerEarnings.payoutId)))
      .orderBy(asc(manufacturerEarnings.createdAt)),
    // Bekleyen ödemeler önce (enum sırası: pending, paid) — sınır yalnızca
    // geçmişi kırpsın, transfer bekleyen bir ödeme asla listeden düşmesin.
    db.query.payouts.findMany({
      with: {
        manufacturer: { columns: { companyName: true, ...BANK_COLUMNS } },
        earnings: {
          columns: EARNING_COLUMNS,
          with: { order: { columns: { orderNumber: true } } },
        },
      },
      orderBy: [asc(payouts.status), desc(payouts.createdAt)],
      limit: 100,
    }),
    db
      .select({
        partnerId: painterEarnings.painterId,
        name: painters.companyName,
        orderId: painterEarnings.orderId,
        orderNumber: orders.orderNumber,
        grossKurus: painterEarnings.grossKurus,
        commissionKurus: painterEarnings.commissionKurus,
        netKurus: painterEarnings.netKurus,
        status: painterEarnings.status,
        createdAt: painterEarnings.createdAt,
        iban: painters.iban,
        bankAccountHolder: painters.bankAccountHolder,
        bankName: painters.bankName,
        pendingIban: painters.pendingIban,
        ibanReviewStatus: painters.ibanReviewStatus,
      })
      .from(painterEarnings)
      .innerJoin(painters, eq(painters.id, painterEarnings.painterId))
      .innerJoin(orders, eq(orders.id, painterEarnings.orderId))
      .where(and(eq(painterEarnings.status, "pending"), isNull(painterEarnings.payoutId)))
      .orderBy(asc(painterEarnings.createdAt)),
    db.query.painterPayouts.findMany({
      with: {
        painter: { columns: { companyName: true, ...BANK_COLUMNS } },
        earnings: {
          columns: EARNING_COLUMNS,
          with: { order: { columns: { orderNumber: true } } },
        },
      },
      orderBy: [asc(painterPayouts.status), desc(painterPayouts.createdAt)],
      limit: 100,
    }),
  ]);

  const toPayoutRow = (
    p: {
      id: string;
      totalKurus: number;
      earningCount: number;
      status: string;
      reference: string | null;
      adminEmail: string;
      createdAt: Date;
      paidAt: Date | null;
      earnings: Array<EarningColumns & { order: { orderNumber: string } | null }>;
    },
    partnerId: string,
    partner: (BankColumns & { companyName: string }) | null | undefined
  ): PayoutRow => ({
    id: p.id,
    partnerId,
    name: partner?.companyName ?? "—",
    totalKurus: p.totalKurus,
    earningCount: p.earningCount,
    status: p.status,
    reference: p.reference,
    adminEmail: p.adminEmail,
    requestedByPartner: PARTNER_REQUEST_EMAILS.has(p.adminEmail),
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
    bank: bankOf(partner),
    earnings: p.earnings.map((e) => earningLine(e, e.order?.orderNumber)),
  });

  const data: Record<"manufacturer" | "painter", PayoutTabData> = {
    manufacturer: {
      owed: groupOwed(mOwedRows),
      payouts: mPayoutRows.map((p) => toPayoutRow(p, p.manufacturerId, p.manufacturer)),
    },
    painter: {
      owed: groupOwed(pOwedRows),
      payouts: pPayoutRows.map((p) => toPayoutRow(p, p.painterId, p.painter)),
    },
  };

  return <PayoutsClient initialTab={tab === "painter" ? "painter" : "manufacturer"} data={data} />;
}
