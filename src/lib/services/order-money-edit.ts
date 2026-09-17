import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminActions, manufacturerEarnings, orders, painterEarnings } from "@/lib/db/schema";
import { moneySplitEditBlock, validateMoneySplit, type MoneySplitEditView } from "@/lib/config/order-money-edit";
import { effectiveProductionBaseKurus } from "@/lib/services/earning-base";
import { finishNeedsPainter } from "@/lib/config/prices";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function viewOf(tx: Tx | typeof db, order: typeof orders.$inferSelect): Promise<MoneySplitEditView> {
  const [manufacturer, painter] = await Promise.all([
    tx.select({ id: manufacturerEarnings.id }).from(manufacturerEarnings).where(eq(manufacturerEarnings.orderId, order.id)).limit(1),
    tx.select({ id: painterEarnings.id }).from(painterEarnings).where(eq(painterEarnings.orderId, order.id)).limit(1),
  ]);
  return {
    amountKurus: order.amountKurus,
    productionKurus: effectiveProductionBaseKurus(order),
    paintingKurus: order.paintingPriceKurus,
    blockedReason: moneySplitEditBlock({ ...order, manufacturerEarningExists: manufacturer.length > 0, painterEarningExists: painter.length > 0 }),
  };
}

export async function loadMoneySplitEdit(orderId: string): Promise<MoneySplitEditView | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  return order ? viewOf(db, order) : null;
}

export async function editOrderMoneySplit(args: {
  orderId: string;
  productionKurus: number;
  paintingKurus: number;
  expectedProductionKurus: number;
  expectedPaintingKurus: number;
  reason: string;
  adminEmail: string;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    // Tahakkuk servisleri aynı siparişi FOR SHARE kilitler. Önce tahakkuk
    // geldiyse aşağıdaki okuma kaydı görür; önce bu yazma geldiyse tahakkuk bekler.
    const [order] = await tx.select().from(orders).where(eq(orders.id, args.orderId)).for("update");
    if (!order) return { ok: false as const, status: 404, error: "Sipariş bulunamadı." };
    const before = await viewOf(tx, order);
    if (before.blockedReason) return { ok: false as const, status: 409, error: before.blockedReason };
    const error = validateMoneySplit(order.amountKurus, args.productionKurus, args.paintingKurus);
    if (error) return { ok: false as const, status: 400, error };
    if (before.productionKurus !== args.expectedProductionKurus || before.paintingKurus !== args.expectedPaintingKurus) {
      return { ok: false as const, status: 409, error: "Kalemler başka bir işlemde değişti. Güncel tutarları yükleyip tekrar deneyin." };
    }
    if (args.reason.trim().length < 10) return { ok: false as const, status: 400, error: "Değişiklik gerekçesi en az 10 karakter olmalıdır." };
    if (args.productionKurus === before.productionKurus && args.paintingKurus === before.paintingKurus) {
      return { ok: true as const, changed: false, order, before };
    }
    const finish = args.paintingKurus > 0
      ? (finishNeedsPainter(order.finish) ? order.finish : "hand_painted")
      : (finishNeedsPainter(order.finish) ? "paintable_kit" : order.finish);
    const [updated] = await tx.update(orders).set({
      productionBaseKurus: args.productionKurus,
      paintingPriceKurus: args.paintingKurus,
      needsPainting: args.paintingKurus > 0,
      finish,
      updatedAt: new Date(),
    }).where(and(
      eq(orders.id, order.id), notRefundedGuard(),
      sql`NOT EXISTS (SELECT 1 FROM ${manufacturerEarnings} WHERE ${manufacturerEarnings.orderId} = ${orders.id})`,
      sql`NOT EXISTS (SELECT 1 FROM ${painterEarnings} WHERE ${painterEarnings.orderId} = ${orders.id})`,
    )).returning();
    if (!updated) throw new Error("Kalemler kaydedilemedi; sipariş değişti.");
    // Bölüşüm ile gerekçesi birlikte commit olur: kayıtsız para değişikliği yok.
    await tx.insert(adminActions).values({
      orderId: order.id, action: "edit", adminEmail: args.adminEmail,
      notes: `Kalem bölüşümü değiştirildi (kuruş): üretim ${before.productionKurus} → ${args.productionKurus}, boyama ${before.paintingKurus} → ${args.paintingKurus}. Toplam ${order.amountKurus} değişmedi. Gerekçe: ${args.reason.trim()}`,
    });
    return { ok: true as const, changed: true, order: updated, before };
  });
}
