export const dynamic = "force-dynamic";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerEarnings, manufacturers, payouts } from "@/lib/db/schema";
import { PayoutsClient } from "./client";

export default async function AdminPayoutsPage() {
  const owedRows = await db
    .select({
      manufacturerId: manufacturerEarnings.manufacturerId,
      companyName: manufacturers.companyName,
      owed: sql<number>`coalesce(sum(${manufacturerEarnings.netKurus}),0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(manufacturerEarnings)
    .innerJoin(manufacturers, eq(manufacturers.id, manufacturerEarnings.manufacturerId))
    .where(
      and(
        eq(manufacturerEarnings.status, "pending"),
        isNull(manufacturerEarnings.payoutId)
      )
    )
    .groupBy(manufacturerEarnings.manufacturerId, manufacturers.companyName);

  const payoutRows = await db.query.payouts.findMany({
    with: { manufacturer: { columns: { companyName: true } } },
    orderBy: [desc(payouts.createdAt)],
    limit: 100,
  });

  return (
    <PayoutsClient
      owed={owedRows.map((r) => ({
        manufacturerId: r.manufacturerId,
        companyName: r.companyName,
        owed: Number(r.owed),
        count: Number(r.count),
      }))}
      payouts={payoutRows.map((p) => ({
        id: p.id,
        companyName: p.manufacturer?.companyName ?? "—",
        totalKurus: p.totalKurus,
        earningCount: p.earningCount,
        status: p.status,
        reference: p.reference,
        createdAt: p.createdAt.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
      }))}
    />
  );
}
