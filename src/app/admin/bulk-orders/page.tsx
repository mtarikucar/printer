export const dynamic = "force-dynamic";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturers,
  orderItems,
  orders,
  products,
} from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { AWAITING_MANUFACTURER, NOT_REFUNDED } from "@/lib/services/admin-order-sql";
import { BulkOrdersClient, type BulkProductGroup } from "./bulk-orders-client";

// Toplu üretim kuyruğu — bulk orders aggregated BY PRODUCT rather than by
// order, because that is the unit production actually cares about: "340
// keychains across 9 orders" is one print run, and the whole point of the
// feature is to place that run with one workshop instead of nine.
//
// "Open" = paid and not yet shipped/delivered. Terminal and failed states drop
// out so the queue only shows work someone still has to do. Refunded orders
// drop out too (NOT_REFUNDED): a refund keeps the order's status but detaches
// the manufacturer and freezes it, so it looks unassigned yet can never be
// assigned. The "Toplu üretim" nav badge (AWAITING_MANUFACTURER in
// admin-order-sql.ts) already leaves them out; without the same filter here
// the header count and the badge disagreed.
//
// Per order, `assignable` is AWAITING_MANUFACTURER: approved (or a paid
// marketplace order), no manufacturer, not refunded. That is the header's
// "üretici bekliyor" set, the nav badge's set, and exactly what the assign
// service's status guard accepts. An open order with no manufacturer outside
// it is "henüz atanamaz". Bulk orders are marketplace orders: they wait at
// `paid` (assignable) and never pass through review or awaiting_model, which
// belong to custom orders. So that set can only hold an order that went into
// production (printing, quality_check, painting) with no manufacturer.
// It is never NULL (every column it reads is NOT NULL or null-checked), so
// NOT ASSIGNABLE below is its exact complement.
const ASSIGNABLE = sql<boolean>`${AWAITING_MANUFACTURER}`;

const OPEN_STATUSES = [
  "paid",
  "awaiting_model",
  "approved",
  "printing",
  "quality_check",
  "painting",
] as const;

/**
 * Sayfanın en üstünde duran arıza şeridi.
 *
 * NEDEN: yalnızca GÖSTERİLEN bir tablo (ürün adı, üretici adı) okunamadığında
 * kuyruk ekranı artık açılıyor — ama sessizce eksik bir kuyruk, dolu bir kuyruktan
 * ayırt edilemez. Şerit, adminin fiilen baktığı yerde neyin BİLİNMEDİĞİNİ söyler.
 */
function QueueReadNotice({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <div
      role="alert"
      className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">
        Bu kuyruğun bazı kayıtları şu anda okunamıyor (geçici sistem arızası)
      </p>
      <p className="mt-1 text-amber-900/80">
        Aşağıdakiler gerçek kayıtlardır; ama şu bölümler BOŞ DEĞİL, BİLİNMİYOR:{" "}
        {areas.join(" · ")}. Eksik görünen bir kuyruğa göre atama yapmayın; birkaç
        dakika sonra sayfayı yenileyin.
      </p>
    </div>
  );
}

export default async function AdminBulkOrdersPage() {
  // One row per (product, order) so we can aggregate units per product and
  // still know which orders are unassigned. Covers both order shapes: cart
  // sub-orders carry products on order_items, single-product orders on the
  // orders row itself.
  // ─── Kuyruk: yalnız orders/order_items ───────────────────────────────────
  //
  // Ürün adı/görseli ve üretici adı YALNIZCA GÖSTERİLİYOR, ama innerJoin/leftJoin
  // TEK ifadedir: `products` ya da `manufacturers` okunamadığında toplu üretim
  // kuyruğunun TAMAMI 500 veriyordu — oysa kuyruğun kendisi (hangi sipariş, kaç
  // adet, atanabilir mi) orders/order_items'ta duruyor. Adlar artık AYRI ve
  // KORUMALI okunur; okunamazsa satır KAYBOLMAZ, yalnız adı "okunamadı" der.
  //
  // innerJoin(products) aynı zamanda SÜZÜYORDU (ürün satırı olmayan kalem
  // düşerdi). Süzgeç korunuyor: kalemlerde `productId` boş olan satır zaten
  // atlanıyor, tekil siparişlere de `product_id IS NOT NULL` koşulu eklendi.
  // Ürün satırı gerçekten yoksa iş artık "Ürün bulunamadı" diye GÖRÜNÜR — bir
  // toplu siparişi kuyruktan sessizce düşürmek, üretime hiç girmemesi demekti.
  const [lineRead, scalarRead] = await Promise.all([
    db
      .select({
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        createdAt: orders.createdAt,
        manufacturerId: orders.manufacturerId,
        manufacturerStatus: orders.manufacturerStatus,
        productId: orderItems.productId,
        units: orderItems.quantity,
        assignable: ASSIGNABLE,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.isBulk, true),
          inArray(orders.status, [...OPEN_STATUSES]),
          NOT_REFUNDED,
          sql`${orderItems.appliedTierMinQuantity} IS NOT NULL`
        )
      )
      .catch((e) => {
        console.error("toplu üretim: sipariş kalemleri okunamadı", e);
        return null;
      }),
    db
      .select({
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        createdAt: orders.createdAt,
        manufacturerId: orders.manufacturerId,
        manufacturerStatus: orders.manufacturerStatus,
        productId: orders.productId,
        units: orders.quantity,
        assignable: ASSIGNABLE,
      })
      .from(orders)
      .where(
        and(
          eq(orders.isBulk, true),
          inArray(orders.status, [...OPEN_STATUSES]),
          NOT_REFUNDED,
          sql`${orders.productId} IS NOT NULL`
        )
      )
      .catch((e) => {
        console.error("toplu üretim: tekil ürünlü siparişler okunamadı", e);
        return null;
      }),
  ]);
  const lineRowsUnreadable = lineRead === null;
  const scalarRowsUnreadable = scalarRead === null;
  const lineRows = lineRead ?? [];
  const scalarRows = scalarRead ?? [];

  const productIds = [
    ...new Set(
      [...lineRows, ...scalarRows]
        .map((r) => r.productId)
        .filter((x): x is string => !!x)
    ),
  ];
  const assignedManufacturerIds = [
    ...new Set(
      [...lineRows, ...scalarRows]
        .map((r) => r.manufacturerId)
        .filter((x): x is string => !!x)
    ),
  ];
  const [productRead, manufacturerNameRead] = await Promise.all([
    productIds.length
      ? db
          .select({
            id: products.id,
            title: products.title,
            primaryImageKey: products.primaryImageKey,
          })
          .from(products)
          .where(inArray(products.id, productIds))
          .catch((e) => {
            console.error("toplu üretim: ürün adları okunamadı", e);
            return null;
          })
      : [],
    assignedManufacturerIds.length
      ? db
          .select({ id: manufacturers.id, companyName: manufacturers.companyName })
          .from(manufacturers)
          .where(inArray(manufacturers.id, assignedManufacturerIds))
          .catch((e) => {
            console.error("toplu üretim: atanmış üretici adları okunamadı", e);
            return null;
          })
      : [],
  ]);
  const productNamesUnreadable = productRead === null;
  const productById = new Map((productRead ?? []).map((pr) => [pr.id, pr]));
  const manufacturerNamesUnreadable = manufacturerNameRead === null;
  const manufacturerNameById = new Map(
    (manufacturerNameRead ?? []).map((m) => [m.id, m.companyName])
  );

  const groups = new Map<string, BulkProductGroup>();
  for (const row of [...lineRows, ...scalarRows]) {
    if (!row.productId) continue;
    let g = groups.get(row.productId);
    if (!g) {
      const product = productById.get(row.productId);
      g = {
        productId: row.productId,
        // Ad okunamadıysa "bilinmiyor" denir: boş bir başlık, ürünün adı yokmuş
        // gibi okunurdu.
        title:
          product?.title ??
          (productNamesUnreadable ? "Ürün adı okunamadı" : "Ürün bulunamadı"),
        imageUrl: product?.primaryImageKey
          ? getPublicUrl(product.primaryImageKey)
          : null,
        totalUnits: 0,
        assignableUnits: 0,
        notYetAssignableUnits: 0,
        orders: [],
        byManufacturer: [],
      };
      groups.set(row.productId, g);
    }
    const unassigned =
      !row.manufacturerId ||
      row.manufacturerStatus === null ||
      row.manufacturerStatus === "unassigned";
    const assignable = row.assignable === true;
    g.totalUnits += row.units;
    if (assignable) g.assignableUnits += row.units;
    else if (unassigned) g.notYetAssignableUnits += row.units;
    g.orders.push({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      units: row.units,
      createdAt: row.createdAt.toISOString(),
      manufacturerName: row.manufacturerId
        ? manufacturerNameById.get(row.manufacturerId) ??
          (manufacturerNamesUnreadable ? "Üretici adı okunamadı" : null)
        : null,
      unassigned,
      assignable,
    });
  }

  // Per-product manufacturer split, so the admin can see where a run already
  // lives before deciding where to put the rest of it.
  for (const g of groups.values()) {
    const split = new Map<string, number>();
    for (const o of g.orders) {
      const key = o.manufacturerName ?? "—";
      if (o.unassigned) continue;
      split.set(key, (split.get(key) ?? 0) + o.units);
    }
    g.byManufacturer = [...split.entries()]
      .map(([name, units]) => ({ name, units }))
      .sort((a, b) => b.units - a.units);
    g.orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Unassigned work first — that is what the page exists to clear.
  const productGroups = [...groups.values()].sort(
    (a, b) => b.assignableUnits - a.assignableUnits || b.totalUnits - a.totalUnits
  );

  // Atama kutusunun listesi: okunamazsa kutu BOŞ kalır ve "ata" düğmesi seçim
  // yapılamadığı için pasif durur — kapı kapalı tarafta. Sebebini şerit yazar,
  // yoksa admin boş bir açılır listeye bakıp "üretici kalmamış" sanırdı.
  const activeManufacturerRead = await db
    .select({
      id: manufacturers.id,
      companyName: manufacturers.companyName,
      acceptingOrders: manufacturers.acceptingOrders,
    })
    .from(manufacturers)
    .where(eq(manufacturers.status, "active"))
    .orderBy(manufacturers.companyName)
    .catch((e) => {
      console.error("toplu üretim: aktif üretici listesi okunamadı", e);
      return null;
    });
  const manufacturerListUnreadable = activeManufacturerRead === null;
  const activeManufacturers = activeManufacturerRead ?? [];

  // Header figures, one scan over the bulk orders.
  //  - awaiting: AWAITING_MANUFACTURER ∧ isBulk, exactly the set the
  //    "Toplu üretim" nav badge counts (admin/layout.tsx).
  //  - notYet: the rest of that old figure (open, not refunded, no
  //    manufacturer, not assignable yet), shown apart so it is not lost.
  const headerRead = await db
    .select({
      awaiting: sql<number>`(count(*) FILTER (WHERE ${AWAITING_MANUFACTURER}))::int`,
      notYet: sql<number>`(count(*) FILTER (WHERE NOT ${ASSIGNABLE}
        AND ${NOT_REFUNDED}
        AND ${inArray(orders.status, [...OPEN_STATUSES])}
        AND (${orders.manufacturerStatus} IS NULL OR ${orders.manufacturerStatus} = 'unassigned')))::int`,
    })
    .from(orders)
    .where(eq(orders.isBulk, true))
    .catch((e) => {
      console.error("toplu üretim: başlık sayıları okunamadı", e);
      return null;
    });
  const headerUnreadable = headerRead === null;
  const awaitingCount = headerRead?.[0]?.awaiting ?? 0;
  const notYetAssignableCount = headerRead?.[0]?.notYet ?? 0;

  // Hangi bölüm BİLİNMİYOR: şerit sayfanın en üstünde, başlığın hemen altında.
  const unreadableAreas = [
    lineRowsUnreadable &&
      "Sepet kalemli toplu siparişler (kuyruk EKSİK görünüyor; okunamayan satırlar \"sipariş yok\" demek değildir)",
    scalarRowsUnreadable &&
      "Tekil ürünlü toplu siparişler (kuyruk EKSİK görünüyor)",
    productNamesUnreadable && "Ürün adları ve görselleri",
    manufacturerNamesUnreadable && "Atanmış üretici adları",
    manufacturerListUnreadable &&
      "Aktif üretici listesi (atama kutusu boş kaldı; bu yüzden şu an atama yapılamıyor)",
    headerUnreadable &&
      "Başlıktaki sayılar (\"üretici bekliyor\" ve \"henüz atanamaz\" sayıları gösterilemiyor)",
  ].filter((x): x is string => typeof x === "string");

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Toplu üretim kuyruğu</h1>
      <QueueReadNotice areas={unreadableAreas} />
      <p className="mt-1 text-sm text-gray-600">
        Açık toplu siparişler ürün bazında toplanmıştır. Aynı ürünün siparişlerini
        tek üreticiye vererek kalıp/tezgâh kurulumunu bir kez yaptırabilirsiniz.
        {awaitingCount > 0 && (
          <>
            {" "}
            <strong className="text-orange-700">
              {awaitingCount} sipariş üretici bekliyor.
            </strong>
          </>
        )}
        {notYetAssignableCount > 0 && (
          <> {notYetAssignableCount} sipariş daha üreticisiz ama henüz atanamaz.</>
        )}
      </p>
      {/* What each figure on this page counts, so none is read as another. */}
      <p className="mt-1 text-xs text-gray-500">
        “Adet” ve “sipariş”: açık toplu siparişler (kargolanmamış, reddedilmemiş,
        iade edilmemiş). “Üretici bekliyor”: onaylı, şu an atanabilir ve henüz
        üreticisi olmayan siparişler; kenar çubuğundaki Toplu üretim sayısıyla
        aynı küme. “Henüz atanamaz”: üreticisi yok ama durumu atamaya uygun
        değil (ör. üretici atanmadan baskıya ya da kalite kontrole geçmiş).
      </p>

      <BulkOrdersClient
        groups={productGroups}
        manufacturers={activeManufacturers}
      />
    </div>
  );
}
