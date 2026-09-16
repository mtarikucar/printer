import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { orders, manufacturers, orderDrafts, products, workshopRequests, painters, waConversations } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { AdminSidebar, type AdminSidebarLabels } from "./sidebar";
import { AdminRealtimeShell } from "./realtime-shell";
import { PanelShell } from "@/components/panel-shell";
import { auth } from "@/lib/auth/config";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import {
  AWAITING_MANUFACTURER,
  NOT_REFUNDED,
} from "@/lib/services/admin-order-sql";

/**
 * GÖSTERİM amaçlı rozet okuması: sonuç yalnızca kenar çubuğunda GÖSTERİLİR, bir
 * kapıyı açıp kapatmaz. Arıza YUTULMAZ — null döner ve null "0" değil
 * "BİLİNMİYOR" demektir.
 */
async function displayRead<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[admin panel] ${label} sayısı okunamadı`, e);
    return null;
  }
}

/**
 * Panelin HER sayfasının en üstünde duran arıza şeridi.
 *
 * NEDEN İÇERİĞİN ÜSTÜNDE, kenar çubuğunda değil: admin oraya bakar ve mobilde
 * kenar çubuğu kapalı bir çekmecedir — orada yazan uyarı hiç görülmezdi. Rozetin
 * "?" işareti sebebi söylemez, yalnız sorar; cümle burada kurulur.
 */
function PanelReadNotice({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <div
      role="alert"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-8"
    >
      <p className="font-semibold">
        Menüdeki bazı sayılar şu anda okunamıyor (geçici sistem arızası)
      </p>
      <p className="mt-1 text-amber-900/80">
        Panel ve bu sayfadaki kayıtlar çalışıyor; ama menüde &quot;?&quot; yazan
        rozetler SIFIR DEĞİL, BİLİNMİYOR: {areas.join(" · ")}. Birkaç dakika sonra
        sayfayı yenileyin.
      </p>
    </div>
  );
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout wraps EVERY /admin/* route, including /admin/login. We must
  // NOT run the auth gate (or the sidebar's DB count queries) for the login
  // page: redirecting an unauthenticated /admin/login back to /admin/login
  // re-enters this layout and redirects again — an infinite loop that hides
  // the login form. Middleware forwards the path via x-pathname so we can
  // detect the login page and render it bare (no shell, no gate, no queries).
  // Sağlayıcıyı KÖK DÜZENDEN miras almayı bırakıyoruz.
  //
  // /admin/* altındaki istemci bileşenlerinin çoğu useDictionary/useLocale
  // kullanıyor ve panelde üç ayrı siparişte "useDictionary must be used within
  // LocaleProvider" ile HTML 500 alındı: sağlayıcı yalnız kök düzende
  // duruyordu, kenar çubuğu ise onu görmeden render edildi. Üretici ve boyacı
  // panelleri sağlayıcıyı ZATEN kendi düzenlerinde kuruyor (manufacturer/
  // layout.tsx, painter/layout.tsx) ve orada bu hata hiç görülmedi — admin tek
  // istisnaydı. Sağlayıcıyı buraya alınca kenar çubuğunun sağlayıcısı kendi
  // düzeninin ürettiği ağaçta, aynı render'da bulunur.
  const locale = await getLocale();
  const d = getDictionary(locale);

  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname === "/admin/login") {
    // Giriş sayfası da sözlük kullanır (useDictionary) — çıplak dal da sarılır.
    return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
  }

  // Defense-in-depth: middleware already gates /admin/*, but if it's ever
  // mis-configured the layout would otherwise run DB queries and leak counts
  // in HTML. Verify the role claim here too.
  // (We use `auth()` directly here rather than `requireAdmin()` because this
  // is an RSC layout, not an API route — `requireAdmin` returns a
  // NextResponse-or-session union shaped for API handlers.)
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") {
    redirect("/admin/login");
  }

  // ─── Kenar çubuğu rozetleri: HEPSİ KORUMALI ──────────────────────────────
  //
  // Bu sayımlar /admin/* altındaki HER sayfanın KABUĞUNDA çalışır: biri
  // fırladığında düşen tek bir kart değil, panelin TAMAMIdır. Ölçüm: `products`
  // okunamazken taranan 24 admin sayfasının 24'ü 500 verdi ve hiçbirinde hiçbir
  // uyarı görünmedi — sayfaların kendi "okunamadı" korumaları, kabuk onlardan
  // önce öldüğü için hiç çalışamadı bile. Yalnızca GÖSTERİLEN bir sayı, panelin
  // açılmasının ön şartı olamaz.
  //
  // Arıza YUTULMAZ: null "0" DEĞİL "BİLİNMİYOR" demektir; rozet sayı yerine "?"
  // gösterir ve şerit hangi sayının bilinmediğini, adminin fiilen BAKTIĞI yerde
  // (her sayfanın en üstünde) yazar.
  const [
    awaitingModelRead,
    awaitingManufacturerRead,
    pendingMfgRead,
    draftReviewRead,
    qcPendingRead,
    pendingProductRead,
    workshopPendingRead,
    pendingPainterRead,
    painterQcPendingRead,
    waAwaitingRead,
  ] = await Promise.all([
    // The Orders badge counts work waiting on the admin, in two disjoint parts.
    // Refunded orders are left out of both, because every forward action on a
    // refunded order is refused, the model upload included.
    //  1. awaiting_model: a 3D model for the admin to upload.
    //  2. AWAITING_MANUFACTURER: paid work with no manufacturer (approved
    //     custom/upload orders, and paid marketplace orders). This is the same
    //     definition as the dashboard's "Atanmamış" card, the manufacturing
    //     queue's first section and the "Üretici bekliyor" bucket.
    // awaiting_model is neither `approved` nor `paid`, so no order counts twice.
    displayRead(
      "model bekleyen siparişler",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(sql`${orders.status} = 'awaiting_model' AND ${NOT_REFUNDED}`)
    ),
    // The Toplu üretim badge is the bulk subset of part 2 (assignable bulk
    // orders). Both come from one scan.
    displayRead(
      "üretici bekleyen siparişler",
      db
        .select({
          all: sql<number>`count(*)::int`,
          bulk: sql<number>`count(*) FILTER (WHERE ${orders.isBulk})::int`,
        })
        .from(orders)
        .where(AWAITING_MANUFACTURER)
    ),
    // Count pending manufacturer approvals
    displayRead(
      "onay bekleyen üreticiler",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(manufacturers)
        .where(sql`${manufacturers.status} = 'pending_approval'`)
    ),
    // Count drafts awaiting manual receipt review.
    displayRead(
      "inceleme bekleyen taslaklar",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orderDrafts)
        .where(sql`${orderDrafts.status} = 'awaiting_review'`)
    ),
    // Orders awaiting QC photo approval. Same predicate as the dashboard's
    // "QC Bekleyen" card and the /admin/qc-queue list this badge opens: a
    // refunded order is frozen, so its QC decision is not work.
    displayRead(
      "QC bekleyen siparişler",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(sql`${orders.manufacturerStatus} = 'qc_pending' AND ${NOT_REFUNDED}`)
    ),
    // Count products awaiting moderation.
    displayRead(
      "onay bekleyen ürünler",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(sql`${products.status} = 'pending_review'`)
    ),
    // Count new (unprocessed) workshop requests.
    displayRead(
      "yeni atölye talepleri",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workshopRequests)
        .where(sql`${workshopRequests.status} = 'new'`)
    ),
    // Count painters awaiting approval.
    displayRead(
      "onay bekleyen boyacılar",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(painters)
        .where(sql`${painters.status} = 'pending_approval'`)
    ),
    // Painting jobs awaiting painter-QC review. Refunded orders are left out,
    // as in the /admin/painter-qc-queue list this badge opens.
    displayRead(
      "boyacı QC bekleyen işler",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(sql`${orders.painterStatus} = 'qc_pending' AND ${NOT_REFUNDED}`)
    ),
    // WhatsApp threads where the customer wrote after our last outbound message.
    // Nobody marks a thread read here, so "waiting on us" is the honest badge.
    displayRead(
      "yanıt bekleyen WhatsApp konuşmaları",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(waConversations)
        .where(
          sql`${waConversations.mode} <> 'blocked'
            AND ${waConversations.lastInboundAt} IS NOT NULL
            AND (${waConversations.lastOutboundAt} IS NULL
                 OR ${waConversations.lastInboundAt} > ${waConversations.lastOutboundAt})`
        )
    ),
  ]);

  // null = okunamadı (BİLİNMİYOR); sayı = gerçek sayım.
  const countOf = (rows: { count: number }[] | null): number | null =>
    rows === null ? null : rows[0]?.count ?? 0;
  const awaitingModelCount = countOf(awaitingModelRead);
  const awaitingManufacturerAll =
    awaitingManufacturerRead === null ? null : awaitingManufacturerRead[0]?.all ?? 0;
  const awaitingManufacturerBulk =
    awaitingManufacturerRead === null ? null : awaitingManufacturerRead[0]?.bulk ?? 0;
  const pendingMfgCount = countOf(pendingMfgRead);
  const draftReviewCount = countOf(draftReviewRead);
  const qcPendingCount = countOf(qcPendingRead);
  const pendingProductCount = countOf(pendingProductRead);
  const workshopPendingCount = countOf(workshopPendingRead);
  const pendingPainterCount = countOf(pendingPainterRead);
  const painterQcPendingCount = countOf(painterQcPendingRead);
  const waAwaitingCount = countOf(waAwaitingRead);

  // Hangi sayı BİLİNMİYOR: şerit her admin sayfasının en üstünde basılır.
  const unreadableAreas = [
    awaitingModelRead === null && "Model bekleyen siparişler",
    awaitingManufacturerRead === null &&
      "Üretici bekleyen siparişler (Siparişler ve Toplu üretim rozetleri)",
    pendingMfgRead === null && "Onay bekleyen üreticiler",
    draftReviewRead === null && "İnceleme bekleyen taslaklar",
    qcPendingRead === null && "QC bekleyen siparişler",
    pendingProductRead === null && "Onay bekleyen ürünler",
    workshopPendingRead === null && "Yeni atölye talepleri",
    pendingPainterRead === null && "Onay bekleyen boyacılar",
    painterQcPendingRead === null && "Boyacı QC bekleyen işler",
    waAwaitingRead === null && "Yanıt bekleyen WhatsApp konuşmaları",
  ].filter((x): x is string => typeof x === "string");

  // Kenar çubuğunun metinleri burada, SUNUCUDA çözülür ve prop olarak iner:
  // panelin kabuğu bir context'e bağlı kalmaz (bkz. sidebar.tsx).
  const sidebarLabels: AdminSidebarLabels = {
    groupGeneral: d["admin.nav.group.general"],
    groupOrders: d["admin.nav.group.orders"],
    groupManufacturers: d["admin.nav.group.manufacturers"],
    groupCustomer: d["admin.nav.group.customer"],
    groupContent: d["admin.nav.group.content"],
    groupAdvanced: d["admin.nav.group.advanced"],
    dashboard: d["admin.nav.dashboard"],
    orders: d["admin.nav.orders"],
    manufacturingQueue: d["admin.manufacturingQueue.title"],
    qcQueue: d["admin.nav.qcQueue"],
    manufacturers: d["admin.nav.manufacturers"],
    products: d["admin.nav.products"],
    giftCards: d["admin.nav.giftCards"],
    logout: d["common.logout"],
  };

  return (
    <LocaleProvider locale={locale}>
      <AdminRealtimeShell>
      <PanelShell
        title="Figurunica Admin"
        sidebar={
          <AdminSidebar
            labels={sidebarLabels}
            awaitingModelCount={awaitingModelCount}
            awaitingManufacturerCount={awaitingManufacturerAll}
            // Atama taraması ekranı tam olarak bu kümeyi listeler
            // (AWAITING_MANUFACTURER), o yüzden ikinci bir sorgu yok.
            assignmentSweepCount={awaitingManufacturerAll}
            awaitingManufacturerBulkCount={awaitingManufacturerBulk}
            pendingManufacturerCount={pendingMfgCount}
            pendingProductCount={pendingProductCount}
            draftReviewCount={draftReviewCount}
            qcPendingCount={qcPendingCount}
            workshopPendingCount={workshopPendingCount}
            pendingPainterCount={pendingPainterCount}
            painterQcPendingCount={painterQcPendingCount}
            waAwaitingReplyCount={waAwaitingCount}
          />
        }
      >
        <PanelReadNotice areas={unreadableAreas} />
        {children}
      </PanelShell>
      </AdminRealtimeShell>
    </LocaleProvider>
  );
}
