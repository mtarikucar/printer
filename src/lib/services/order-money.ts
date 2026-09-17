import { and, asc, desc, eq, like, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adminActions,
  manufacturerEarnings,
  manufacturers,
  orderItems,
  orders,
  painterEarnings,
  painterPayouts,
  partnerAdjustments,
  painters,
  payouts,
} from "@/lib/db/schema";
import {
  SHIP_REVERT_AUDIT_PREFIX,
  SHIP_REVERT_EARNING_REVERSED_MARKERS,
  deriveOrderMoneyBreakdown,
  type EarningMoneySnapshot,
  type AdjustmentMoneySnapshot,
  type MoneyReversalRecord,
  type MoneySiblingSnapshot,
  type OrderMoneyBreakdown,
  type OrderMoneySnapshot,
} from "@/lib/config/order-money";
import { loadCostLineBases } from "@/lib/services/product-cost-lines";
import { loadPartnerPayables } from "@/lib/services/partner-payables";

type MoneyReadTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Para dökümü yükleyicisi. Siparişin saklanan hâlini (order + order_items +
 * kardeş alt siparişler + hakediş/ödeme satırları) okur, hesabın TAMAMINI saf
 * `deriveOrderMoneyBreakdown`'a bırakır — burada para matematiği yoktur.
 *
 * `server-only` bilerek YOK: bu dosya zaten `@/lib/db`'yi import ettiği için
 * client paketine giremez, ve aynı konvansiyondaki payouts.ts gibi ileride bir
 * worker'ın da çağırabilmesi gerekir (worker zincirine `server-only` giremez).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Denetim kayıtlarından hakediş geri almanın sebebini OKUR (saf; DB yok).
 *
 * Kayıtta aranan şey, kargo geri almanın hakedişi GERÇEKTEN çevirdiğini söyleyen
 * TAM cümledir (SHIP_REVERT_EARNING_REVERSED_MARKERS, cümleyi yazan rotayla
 * paylaşılan sabit). Cümlenin parçasını aramak, devamı onu yalanlayan bir kaydı
 * ("…zaten geri çevrilmişti; bu geri alma para tarafında hiçbir şeyi
 * değiştirmedi") olmuş bir geri çevirme gibi okurdu.
 *
 * Satırlar EN YENİSİ ÖNCE beklenir: sipariş birkaç kez geri alındıysa satırın
 * bugünkü hâlini açıklayan sonuncusudur. Dokunmayan bir geri alma kaydı atlanır,
 * altındaki gerçek kayıt yine bulunur.
 */
export function shipRevertCauseFromAuditNotes(
  rows: ReadonlyArray<{ notes: string | null; createdAt: Date | string | null }>
): MoneyReversalRecord | null {
  for (const r of rows) {
    const notes = r.notes;
    if (!notes) continue;
    const hit = SHIP_REVERT_EARNING_REVERSED_MARKERS.find((m) => notes.includes(m.sentence));
    if (!hit) continue;
    return {
      cause: "ship_revert",
      party: hit.party,
      at: r.createdAt instanceof Date ? iso(r.createdAt) : r.createdAt ?? null,
    };
  }
  return null;
}

/**
 * Bir siparişin hakediş geri alma sebebi, denetim kaydından.
 *
 * Üç ayrı cevap: nesne = kayıtlı sebep; `null` = bakıldı, kayıt yok;
 * `undefined` = OKUNAMADI. Üçü farklı cümle üretir (earningReversalCause) —
 * okunamayan bir kayıt hakkında "kayıtlı değil" demek olumsuz bir iddia olurdu.
 */
export async function loadEarningReversalRecord(
  orderId: string
): Promise<MoneyReversalRecord | null | undefined> {
  try {
    const rows = await db
      .select({ notes: adminActions.notes, createdAt: adminActions.createdAt })
      .from(adminActions)
      .where(
        and(eq(adminActions.orderId, orderId), like(adminActions.notes, `${SHIP_REVERT_AUDIT_PREFIX}%`))
      )
      .orderBy(desc(adminActions.createdAt))
      .limit(20);
    return shipRevertCauseFromAuditNotes(rows);
  } catch (err) {
    console.error("[order-money] reversal cause could not be read", err);
    return undefined;
  }
}

export async function loadOrderMoneySnapshot(orderId: string): Promise<OrderMoneySnapshot | null> {
  // Geçersiz bir id Postgres'te "invalid input syntax for type uuid" 500'üne
  // dönüşür; bulunamayan sipariş gibi davranmak ekran için doğru olan.
  if (!UUID_RE.test(orderId)) return null;

  // Earnings, adjustment history and eligibility must describe one DB snapshot.
  // A failed financial read propagates to the page's existing unknown-money state.
  return db.transaction(tx => loadOrderMoneySnapshotTx(tx, orderId), {
    isolationLevel: "repeatable read", accessMode: "read only",
  });
}

async function loadOrderMoneySnapshotTx(tx: MoneyReadTx, orderId: string): Promise<OrderMoneySnapshot | null> {
  const order = await tx.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: {
      id: true,
      orderType: true,
      amountKurus: true,
      productionBaseKurus: true,
      paintingPriceKurus: true,
      giftCardAmountKurus: true,
      havaleDiscountKurus: true,
      upsells: true,
      upsellAmountKurus: true,
      quantity: true,
      productId: true,
      productTitleSnapshot: true,
      parentReference: true,
      workshopSessionId: true,
      selectedOptions: true,
      selectedAddons: true,
      paymentMethod: true,
      paymentStatus: true,
      commissionRateBps: true,
      manufacturerId: true,
      manufacturerStatus: true,
      painterId: true,
      painterStatus: true,
      shippedAt: true,
    },
    with: {
      manufacturer: { columns: { companyName: true, paintsInHouse: true } },
      painter: { columns: { companyName: true } },
      draft: { columns: { amountKurus: true } },
    },
  });
  if (!order) return null;

  // order_items ile siparişin arasında ORM ilişkisi yok (bkz. üretici sipariş
  // sayfası) — satırlar doğrudan sorgulanır. Hakediş satırları da düz join ile:
  // refund partnerleri siparişten koparır, ama hakedişin KİME yazıldığı
  // hakediş satırının kendisindedir.
  const [items, siblings, mfrRows, painterRows] = await Promise.all([
    tx
      .select({
        title: orderItems.productTitleSnapshot,
        quantity: orderItems.quantity,
        unitPriceKurus: orderItems.unitPriceKurus,
        lineTotalKurus: orderItems.lineTotalKurus,
        listUnitPriceKurus: orderItems.listUnitPriceKurus,
        appliedTierMinQuantity: orderItems.appliedTierMinQuantity,
        productionBaseKurus: orderItems.productionBaseKurus,
        isBoxItem: orderItems.isBoxItem,
        selectedOptions: orderItems.selectedOptions,
        selectedAddons: orderItems.selectedAddons,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.createdAt)),
    // Kardeşler kendi kolonlarından: sepet ödemesinde hediye çeki ve havale
    // indirimi alt siparişlere orantılı dağıtıldı (order-draft allocate), yani
    // her alt siparişin tahsilatı kendi satırında yazılı — burada paylaştırılmaz.
    order.parentReference
      ? tx
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            paymentStatus: orders.paymentStatus,
            amountKurus: orders.amountKurus,
            giftCardAmountKurus: orders.giftCardAmountKurus,
            havaleDiscountKurus: orders.havaleDiscountKurus,
          })
          .from(orders)
          .where(and(eq(orders.parentReference, order.parentReference), ne(orders.id, order.id)))
          .orderBy(asc(orders.orderNumber))
      : Promise.resolve([] as MoneySiblingSnapshot[]),
    tx
      .select({
        partnerId: manufacturerEarnings.manufacturerId,
        partnerName: manufacturers.companyName,
        grossKurus: manufacturerEarnings.grossKurus,
        commissionKurus: manufacturerEarnings.commissionKurus,
        netKurus: manufacturerEarnings.netKurus,
        rateBps: manufacturerEarnings.commissionRateBps,
        status: manufacturerEarnings.status,
        payoutId: payouts.id,
        payoutStatus: payouts.status,
        payoutReference: payouts.reference,
        payoutPaidAt: payouts.paidAt,
        payoutSettlementKind: payouts.settlementKind,
        payoutVoidedAt: payouts.voidedAt,
      })
      .from(manufacturerEarnings)
      .leftJoin(manufacturers, eq(manufacturers.id, manufacturerEarnings.manufacturerId))
      .leftJoin(payouts, eq(payouts.id, manufacturerEarnings.payoutId))
      .where(eq(manufacturerEarnings.orderId, order.id))
      .limit(1),
    tx
      .select({
        partnerId: painterEarnings.painterId,
        partnerName: painters.companyName,
        grossKurus: painterEarnings.grossKurus,
        commissionKurus: painterEarnings.commissionKurus,
        netKurus: painterEarnings.netKurus,
        rateBps: painterEarnings.commissionRateBps,
        status: painterEarnings.status,
        payoutId: painterPayouts.id,
        payoutStatus: painterPayouts.status,
        payoutReference: painterPayouts.reference,
        payoutPaidAt: painterPayouts.paidAt,
        payoutSettlementKind: painterPayouts.settlementKind,
        payoutVoidedAt: painterPayouts.voidedAt,
      })
      .from(painterEarnings)
      .leftJoin(painters, eq(painters.id, painterEarnings.painterId))
      .leftJoin(painterPayouts, eq(painterPayouts.id, painterEarnings.payoutId))
      .where(eq(painterEarnings.orderId, order.id))
      .limit(1),
  ]);

  const toEarning = (r: (typeof mfrRows)[number] | undefined): EarningMoneySnapshot | null =>
    r
      ? {
          partnerId: r.partnerId,
          partnerName: r.partnerName ?? null,
          grossKurus: r.grossKurus,
          commissionKurus: r.commissionKurus,
          netKurus: r.netKurus,
          rateBps: r.rateBps,
          status: r.status,
          payout: r.payoutId
            ? {
                id: r.payoutId,
                status: r.payoutStatus ?? "pending",
                reference: r.payoutReference ?? null,
                paidAt: iso(r.payoutPaidAt),
                settlementKind: r.payoutSettlementKind ?? "transfer",
                voidedAt: iso(r.payoutVoidedAt),
              }
            : null,
        }
      : null;

  const isCart = items.length > 0 || order.parentReference !== null;

  // Geri alınmış hakedişin SEBEBİ satırda yazmaz (hakediş tablolarında sebep
  // kolonu yok, bu faz migration açmıyor). Yalnızca geri alınmış satır varken
  // sorulur — başka her siparişte bu sorgu boşuna olurdu.
  let earningReversal: OrderMoneySnapshot["earningReversal"];
  if (mfrRows[0]?.status === "reversed" || painterRows[0]?.status === "reversed") {
    earningReversal = await loadEarningReversalRecord(order.id);
  }

  // Tek ürünlü siparişte ürünün BUGÜNKÜ kalem toplamları: yalnızca boyama
  // payının ürünün kendi kaleminden mi, yoksa sonradan admin "Boyama ekle"siyle
  // üretimden mi ayrıldığını ayırt etmek için (bkz.
  // OrderMoneySnapshot.productCostBases). Haritada ürün yoksa ürünün hiç kalemi
  // yok → null (boyama kalemi yok). Boyama tabanı olmayan siparişte ayrıma gerek
  // yok, sorgu atlanır; okuma hatası da "bilinmiyor" (undefined) sayılır ve kart
  // eski oranlı gösterime düşer — döküm bu yüzden hiç kaybolmaz.
  let productCostBases: OrderMoneySnapshot["productCostBases"];
  if (!isCart && order.productId && (order.paintingPriceKurus ?? 0) > 0) {
    try {
      const bases = (await loadCostLineBases([order.productId])).get(order.productId);
      productCostBases = bases
        ? { productionKurus: bases.productionKurus, paintingKurus: bases.paintingKurus }
        : null;
    } catch (err) {
      console.error("[order-money] product cost lines could not be read", err);
    }
  }

  return {
    orderType: order.orderType,
    amountKurus: order.amountKurus,
    productionBaseKurus: order.productionBaseKurus,
    paintingPriceKurus: order.paintingPriceKurus,
    giftCardAmountKurus: order.giftCardAmountKurus,
    havaleDiscountKurus: order.havaleDiscountKurus,
    upsells: order.upsells ?? null,
    upsellAmountKurus: order.upsellAmountKurus,
    quantity: order.quantity,
    productId: order.productId,
    productTitleSnapshot: order.productTitleSnapshot,
    productCostBases,
    parentReference: order.parentReference,
    workshopSessionId: order.workshopSessionId,
    selectedOptions: order.selectedOptions ?? null,
    selectedAddons: order.selectedAddons ?? null,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    commissionRateBps: order.commissionRateBps,
    manufacturerId: order.manufacturerId,
    manufacturerName: order.manufacturer?.companyName ?? null,
    paintsInHouse: order.manufacturer?.paintsInHouse ?? false,
    manufacturerStatus: order.manufacturerStatus,
    painterId: order.painterId,
    painterName: order.painter?.companyName ?? null,
    painterStatus: order.painterStatus,
    shippedAt: iso(order.shippedAt),
    earningReversal,
    items: items.map((it) => ({
      title: it.title,
      quantity: it.quantity,
      unitPriceKurus: it.unitPriceKurus,
      lineTotalKurus: it.lineTotalKurus,
      listUnitPriceKurus: it.listUnitPriceKurus,
      appliedTierMinQuantity: it.appliedTierMinQuantity,
      productionBaseKurus: it.productionBaseKurus,
      isBoxItem: it.isBoxItem,
      selectedOptions: it.selectedOptions ?? null,
      selectedAddons: it.selectedAddons ?? null,
    })),
    siblings,
    // Yalnızca sepet alt siparişinde anlamlı: taslak tutarı = tüm alt
    // siparişlerin toplamı olmalı.
    cartDraftAmountKurus: isCart ? order.draft?.amountKurus ?? null : null,
    manufacturerEarning: toEarning(mfrRows[0]),
    painterEarning: toEarning(painterRows[0]),
    adjustments: await loadOrderAdjustments(tx, order.id),
  };
}

/** Financial reads deliberately have no catch-to-empty fallback. */
async function loadOrderAdjustments(tx: MoneyReadTx, orderId: string): Promise<AdjustmentMoneySnapshot[]> {
  const rows = await tx.select({
    adjustment: partnerAdjustments,
    manufacturerName: manufacturers.companyName,
    painterName: painters.companyName,
  }).from(partnerAdjustments)
    .leftJoin(manufacturers, eq(manufacturers.id, partnerAdjustments.manufacturerId))
    .leftJoin(painters, eq(painters.id, partnerAdjustments.painterId))
    .where(eq(partnerAdjustments.orderId, orderId))
    .orderBy(asc(partnerAdjustments.createdAt), asc(partnerAdjustments.id));
  const owners = new Map<string, { kind: "manufacturer" | "painter"; id: string }>();
  for (const { adjustment: a } of rows) {
    const kind = a.manufacturerId !== null ? "manufacturer" : "painter";
    const id = a.manufacturerId ?? a.painterId!;
    owners.set(`${kind}:${id}`, { kind, id });
  }
  const active = new Set<string>();
  const blocked = new Map<string, string>();
  const settlements = new Map<string, "transfer" | "netting">();
  for (const { kind, id } of owners.values()) {
    const view = await loadPartnerPayables(tx, kind, id);
    const scopes = [view];
    // Ask the shared reader for each relevant held scope as well as open groups.
    // All calls share the transaction snapshot; no local offset eligibility rule.
    const heldIds = new Set(rows.filter(({ adjustment: a }) => a.status === "pending"
      && (kind === "manufacturer" ? a.manufacturerId === id : a.painterId === id))
      .map(({ adjustment: a }) => a.manufacturerPayoutId ?? a.painterPayoutId)
      .filter((payoutId): payoutId is string => payoutId !== null));
    for (const batch of view.payouts) {
      settlements.set(`${kind}:${batch.id}`, batch.settlementKind);
      if (batch.status === "pending" && batch.voidedAt === null && heldIds.has(batch.id)) {
        scopes.push(await loadPartnerPayables(tx, kind, id, { payoutId: batch.id }));
      }
    }
    for (const scope of scopes) {
      for (const group of scope.groups) {
        for (const member of group.members) if (member.sourceKind === "adjustment") active.add(member.id);
      }
      for (const group of scope.blockedGroups) {
        for (const member of group.members) if (member.sourceKind === "adjustment") blocked.set(member.id, group.reason);
      }
    }
  }
  return rows.map(({ adjustment: a, manufacturerName, painterName }) => {
    const partnerKind = a.manufacturerId !== null ? "manufacturer" : "painter";
    const payoutId = a.manufacturerPayoutId ?? a.painterPayoutId;
    return {
      id: a.id, partnerKind, partnerId: a.manufacturerId ?? a.painterId!,
      partnerName: partnerKind === "manufacturer" ? manufacturerName : painterName,
      kind: a.kind, netKurus: a.netKurus, status: a.status,
      activePending: a.status === "pending" && active.has(a.id),
      blockedReason: active.has(a.id) ? null : blocked.get(a.id) ?? null,
      sourceKind: a.sourceKind, sourceId: a.sourceId, reason: a.reason,
      createdAt: a.createdAt.toISOString(), settledAt: iso(a.settledAt), voidedAt: iso(a.voidedAt),
      payoutId, settlementKind: payoutId ? settlements.get(`${partnerKind}:${payoutId}`) ?? null : null,
    };
  });
}

/** Sözleşme C2: salt okunur döküm. Sipariş yoksa null; para okunamazsa hata. */
export async function buildOrderMoneyBreakdown(orderId: string): Promise<OrderMoneyBreakdown | null> {
  const snapshot = await loadOrderMoneySnapshot(orderId);
  return snapshot ? deriveOrderMoneyBreakdown(snapshot) : null;
}
