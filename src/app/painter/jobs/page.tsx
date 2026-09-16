export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq, and, desc, count, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderPhotos,
  previews,
  users,
  painters,
  painterActions,
  painterQcPhotos,
} from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { PainterJobsClient } from "./jobs-client";
import { normalizeFileUrl, getPublicUrl } from "@/lib/services/storage";
import type { TurkishAddress } from "@/lib/db/schema";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";
import { painterBaseKurus } from "@/lib/services/earning-base";
import { computeEarning } from "@/lib/services/finance";
import { modelAckState } from "@/lib/config/partner-model-ack";
import {
  isPartnerChatUnavailable,
  orderPartnerMessages,
} from "@/lib/services/order-partner-chat";
import { isUnread } from "@/lib/services/order-messages";

const PAGE_SIZE = 20;

/**
 * `adminStampNote` (services/on-behalf.ts) partnerin günlüğüne bu önekle yazar.
 * Sabit burada kopyalanıyor çünkü on-behalf.ts bir sunucu servisidir ve iş
 * kartı (client bileşeni) onu içe aktaramaz; buradan yalnızca bir boolean
 * geçirilir.
 */
const ADMIN_ON_BEHALF_PREFIX = "[Admin adına:";

type PainterJobStatus =
  | "assigned"
  | "accepted"
  | "painting"
  | "painted"
  | "qc_pending"
  | "qc_rejected"
  | "qc_approved"
  | "shipped";

const FILTERABLE: PainterJobStatus[] = [
  "assigned",
  "accepted",
  "painting",
  "painted",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
  "shipped",
];

/**
 * What the painter is paid for one job, computed on the server with the same
 * two functions the accrual uses: painterBaseKurus for the base and
 * computeEarning at the order's rate. The client only displays the result; it
 * used to redo the commission by hand, which drifts the moment the rounding or
 * the base rule changes.
 */
function jobEarning(o: {
  amountKurus: number;
  productionBaseKurus: number | null;
  paintingPriceKurus: number;
  commissionRateBps: number | null;
}): { commissionRateBps: number; grossKurus: number; commissionKurus: number; netKurus: number } {
  // The rate frozen on the order, not the live constant — the painter
  // agreement promises the rate is fixed at accept and that changes are
  // not retroactive. Showing the live rate silently repriced in-flight
  // jobs on screen. NULL only on pre-freeze rows (accruePainterEarning falls
  // back the same way).
  const rateBps = o.commissionRateBps ?? PLATFORM_COMMISSION_RATE_BPS;
  const e = computeEarning(painterBaseKurus(o), rateBps);
  return {
    commissionRateBps: rateBps,
    grossKurus: e.grossKurus,
    commissionKurus: e.commissionKurus,
    netKurus: e.netKurus,
  };
}

export default async function PainterJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await getPainterSession();
  if (!session) redirect("/painter/login");

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
  });
  if (!painter || painter.status !== "active") {
    redirect("/painter/dashboard");
  }

  const { status: filterStatus, page: pageParam } = await searchParams;
  const locale = await getLocale();
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);

  // Jobs = this painter's orders that carry the painting add-on.
  const conditions = [
    eq(orders.painterId, session.painterId),
    eq(orders.needsPainting, true),
  ];

  if (filterStatus && FILTERABLE.includes(filterStatus as PainterJobStatus)) {
    conditions.push(eq(orders.painterStatus, filterStatus as PainterJobStatus));
  }

  const whereClause = and(...conditions);

  const [countResult, orderRows] = await Promise.all([
    db.select({ total: count() }).from(orders).where(whereClause),
    db.query.orders.findMany({
      where: whereClause,
      orderBy: [desc(orders.assignedToPainterAt)],
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      columns: {
        id: true,
        orderNumber: true,
        orderType: true,
        productTitleSnapshot: true,
        customerName: true,
        figurineSize: true,
        style: true,
        finish: true,
        modifiers: true,
        painterStatus: true,
        // A refunded job is shown as cancelled, without action buttons.
        paymentStatus: true,
        // painterBaseKurus takes the whole kalem triple (see jobEarning).
        amountKurus: true,
        productionBaseKurus: true,
        paintingPriceKurus: true,
        commissionRateBps: true,
        assignedToPainterAt: true,
        // The painter holds the physical figure and ships it themselves, yet had
        // none of the brief: no colour spec, no reference image, no note, and no
        // address. Everything below is what they need to paint and post it.
        selectedOptions: true,
        customerNote: true,
        quantity: true,
        shippingAddress: true,
        modelGlbUrl: true,
        // Material decides the primer/adhesion the painter must use.
        material: true,
        painterQcRound: true,
        painterHandoffCarrier: true,
        painterHandoffTrackingNumber: true,
        receivedByPainterAt: true,
        // Yalnız GÖSTERİLEN ilişkiler artık AYRI okunuyor; kimlikleri burada
        // kalır ki o okumalar kime ait olduğunu bilsin.
        userId: true,
        previewId: true,
      },
      // `with:` BİLEREK YOK. Drizzle'ın ilişkisel sorgusu TEK ifadedir:
      // `order_photos` ya da `previews` okunamadığında SORGUNUN TAMAMI fırlar
      // ve boyacı, yalnızca GÖSTERİLEN bir tablo yüzünden İŞ LİSTESİNİ hiç
      // göremezdi. Aşağıdaki üç okuma ayrı ve korumalıdır.
    }),
  ]);

  // ─── Yalnız GÖSTERİLEN ilişkiler: ayrı ve korumalı ───────────────────────
  // Biri düşerse yalnız o alan "bilinmiyor" olur; iş kartları ve kapılar durur.
  const jobIdsForDisplay = orderRows.map((o) => o.id);
  const previewIds = [
    ...new Set(orderRows.map((o) => o.previewId).filter((x): x is string => !!x)),
  ];
  const userIds = [
    ...new Set(orderRows.map((o) => o.userId).filter((x): x is string => !!x)),
  ];
  const [photoRead, previewRead, customerRead] = await Promise.all([
    jobIdsForDisplay.length
      ? db
          .select({ orderId: orderPhotos.orderId, originalUrl: orderPhotos.originalUrl })
          .from(orderPhotos)
          .where(inArray(orderPhotos.orderId, jobIdsForDisplay))
          .catch((e) => {
            console.error("painter jobs: reference photo read failed", e);
            return null;
          })
      : [],
    previewIds.length
      ? db
          .select({ id: previews.id, selectedStyledImageUrl: previews.selectedStyledImageUrl })
          .from(previews)
          .where(inArray(previews.id, previewIds))
          .catch((e) => {
            console.error("painter jobs: approved image read failed", e);
            return null;
          })
      : [],
    userIds.length
      ? db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(inArray(users.id, userIds))
          .catch((e) => {
            console.error("painter jobs: customer name read failed", e);
            return null;
          })
      : [],
  ]);
  const referencePhotosUnreadable = photoRead === null;
  const photosByOrder = new Map<string, string[]>();
  for (const row of photoRead ?? []) {
    const list = photosByOrder.get(row.orderId) ?? [];
    // Kart en çok dört görsel gösterir (eski sorgudaki `limit: 4`).
    if (list.length < 4) list.push(row.originalUrl);
    photosByOrder.set(row.orderId, list);
  }
  const approvedImagesUnreadable = previewRead === null;
  const approvedImageById = new Map(
    (previewRead ?? []).map((p) => [p.id, p.selectedStyledImageUrl])
  );
  const customerNamesUnreadable = customerRead === null;
  const customerNameById = new Map((customerRead ?? []).map((u) => [u.id, u.fullName]));

  // QC photos already uploaded for the current round. Without this the submit
  // button re-locked after every page reload, because the count lived only in
  // client state.
  //
  // Okuma KORUMALI: bu select de çıplaktı ve painter_qc_photos okunamadığında
  // iş listesinin tamamı 500 veriyordu — boyacı, yalnızca GÖSTERİLEN bir tablo
  // yüzünden işlerini hiç göremiyordu. Arıza artık sayfayı düşürmez; sayı
  // BİLİNMEDİĞİ için kapı kapalı tarafa düşer (aşağıdaki uyarı sebebini söyler).
  const jobIds = orderRows.map((o) => o.id);
  const qcRead = jobIds.length
    ? await db
        .select({
          orderId: painterQcPhotos.orderId,
          round: painterQcPhotos.round,
          storageKey: painterQcPhotos.storageKey,
          thumbnailKey: painterQcPhotos.thumbnailKey,
        })
        .from(painterQcPhotos)
        .where(inArray(painterQcPhotos.orderId, jobIds))
        .catch((e) => {
          console.error("painter jobs: QC photo read failed", e);
          return null;
        })
    : [];
  const qcPhotosUnreadable = qcRead === null;
  const qcRows = qcRead ?? [];
  const qcByOrder = new Map<string, { count: number; urls: string[] }>();
  for (const row of orderRows) {
    const mine = qcRows.filter(
      (q) => q.orderId === row.id && q.round === row.painterQcRound
    );
    qcByOrder.set(row.id, {
      count: mine.length,
      urls: mine.map((q) => getPublicUrl(q.thumbnailKey ?? q.storageKey)),
    });
  }

  // Yeni model sürümü duyuru/onay satırları — TEK sorgu, iş başına değil.
  // Boyacının elindeki baskı, yeni bir sürüm yüklendiğinde eski sürüme ait
  // olabilir; dosyayı sessizce değiştirmek yerine iş kartında söylenir ve
  // onaylanana kadar QC/kargo kapatılır (partner-model-ack.ts).
  //
  // Okuma KORUMALI: bu select çıplaktı ve painter_actions okunamadığında
  // (geçici arıza) sayfanın tamamı 500 veriyordu — boyacı, uçların dürüst 503'ünü
  // okuyabileceği bir ekran bulamıyordu. Arıza artık sayfayı düşürmez.
  const actionRows = jobIds.length
    ? await db
        .select({
          id: painterActions.id,
          orderId: painterActions.orderId,
          action: painterActions.action,
          notes: painterActions.notes,
          createdAt: painterActions.createdAt,
        })
        .from(painterActions)
        .where(
          and(
            inArray(painterActions.orderId, jobIds),
            eq(painterActions.painterId, session.painterId)
          )
        )
        .catch((e) => {
          console.error("painter jobs: action log read failed", e);
          return null;
        })
    : [];
  // OKUNAMAYAN GÜNLÜK "ONAY GEREKMİYOR" DEMEK DEĞİLDİR.
  //
  // modelAckState boş listeye "duyuru yok → pending:false" der; hatayı yutup boş
  // liste geçmek QC ve kargo kapılarını bir veritabanı sarsıntısında SESSİZCE
  // açardı — oysa kapının tek işi, yeni sürüm yüklendikten sonra ESKİ modele ait
  // baskının ilerlemesini durdurmaktır. Sunucu uçları da aynı arızada 503 verir
  // (readPartnerModelAck · modelAckRefusal), yani ekranın açık görünmesi zaten
  // boşa tıklama olurdu. Kapı kapalı tarafa düşer; sebebi aşağıdaki uyarı söyler.
  const actionLogUnreadable = actionRows === null;
  const safeActionRows = actionRows ?? [];
  const ackByOrder = new Map(
    jobIds.map((jid) => [
      jid,
      actionLogUnreadable
        ? // Sürüm numaraları BİLİNMİYOR: uydurulmuş bir numara, boyacının
          // görmediği bir sürümü onaylamasına yol açardı.
          //
          // `readFailed` bayrağı iş kartına GEÇER. Kapı iki dalda da kapalı
          // (pending: true) ama anlatılan hikâye ayrı olmak zorunda: bayrak
          // olmadan kart, gerçek bir duyuru ile bu temkinli yedeği ayırt
          // edemiyor ve "Modelin yeni sürümü yüklendi (v)" diye OLMAMIŞ bir
          // olayı duyurup, sürüm numarası bilinmediği için hiçbir şey
          // yapmayan bir onay düğmesi gösteriyordu.
          {
            announcedRevision: null,
            acknowledgedRevision: null,
            pending: true,
            readFailed: true,
          }
        : {
            ...modelAckState(safeActionRows.filter((r) => r.orderId === jid)),
            readFailed: false,
          },
    ])
  );

  // Aynı satırlar iş kartındaki İŞLEM GEÇMİŞİ için de kullanılır — üretici
  // panelindeki "Action History" kartının boyacı karşılığı. Yönetici bir adımı
  // boyacı ADINA kaydedebiliyor (on-behalf); o kayıt painter_actions'a
  // düşüyordu ama boyacının panelinde görüneceği hiçbir yer yoktu, yani boyacı
  // ancak bildirim kutusunu okursa haberdar oluyordu.
  //
  // Sıralama BURADA yapılır, sorguda değil: modelAckState aynı diziyi okuyor ve
  // sorgunun sırasını değiştirmek onun girdisini de değiştirir.
  const actionsByOrder = new Map(
    jobIds.map((jid) => [
      jid,
      safeActionRows
        .filter((r) => r.orderId === jid)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({
          id: r.id,
          action: r.action,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
          // Admin damgası notun BAŞINDA durur (on-behalf.ts / adminStampNote:
          // "[Admin adına: <e-posta>] Gerekçe: …"). Boyacı, adımı kendisinin mi
          // yoksa yöneticinin mi kaydettiğini bu işaretten ayırt eder.
          byAdmin: (r.notes ?? "").startsWith(ADMIN_ON_BEHALF_PREFIX),
        })),
    ])
  );

  // Yöneticiden gelen okunmamış mesajlar. Tablo (order_partner_messages) henüz
  // uygulanmamış olabilir — o durumda kanal yokmuş gibi davranılır, sayfa
  // çökmez.
  let unreadByOrder = new Map<string, number>();
  // Sayacın OKUNAMADIĞI hâli ayrı tutulur: sıfır bir ÖLÇÜM değilse öyle
  // gösterilemez. Tablo hiç yoksa (henüz uygulanmamış migration) kanal yok
  // demektir — bu bir arıza değildir ve uyarı da doğurmaz.
  let unreadUnreadable = false;
  if (jobIds.length) {
    try {
      const msgRows = await db
        .select({
          orderId: orderPartnerMessages.orderId,
          sender: orderPartnerMessages.sender,
          readByAdminAt: orderPartnerMessages.readByAdminAt,
          readByPartnerAt: orderPartnerMessages.readByPartnerAt,
        })
        .from(orderPartnerMessages)
        .where(
          and(
            inArray(orderPartnerMessages.orderId, jobIds),
            eq(orderPartnerMessages.partnerType, "painter"),
            eq(orderPartnerMessages.partnerId, session.painterId)
          )
        );
      unreadByOrder = new Map(
        jobIds.map((jid) => [
          jid,
          msgRows.filter(
            (m) =>
              m.orderId === jid &&
              // Okundu kuralı tek yerden: order-messages.isUnread.
              isUnread("counterparty", {
                senderType: m.sender === "admin" ? "admin" : "manufacturer",
                readByAdminAt: m.readByAdminAt,
                readByCounterpartyAt: m.readByPartnerAt,
              })
          ).length,
        ])
      );
    } catch (err) {
      if (!isPartnerChatUnavailable(err)) {
        console.error("painter jobs: unread count failed", err);
        // Sessizlik de bir iddiadır: her kartta "0 okunmamış" göstermek,
        // yöneticiden gelmiş bir mesajı "mesaj yok" diye anlatırdı.
        unreadUnreadable = true;
      }
    }
  }

  const totalCount = countResult[0]?.total ?? 0;

  return (
    <div className="p-4 sm:p-8">
      {/* Onay günlüğü OKUNAMADI: kapı temkinle KAPALI (yukarıda pending:true),
          ama sebebi bir KARAR değil ARIZA. Uyarı sunucuda, iş kartlarının
          ÜSTÜNDE basılır; iş kartı da aynı arızayı kendi satırında söyler ve
          onay düğmesini hiç göstermez (modelAck.readFailed). Uçlar aynı
          arızada 503 + ack_log_unreadable veriyor; bu uyarı onların ekrandaki
          karşılığıdır. */}
      {actionLogUnreadable && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Model onay kaydınız şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            Yeni bir model sürümü yüklenip yüklenmediğini şu anda söyleyemiyoruz.
            Güvenlik gereği kalite kontrole gönderme ve kargolama adımları geçici
            olarak kapatıldı; iş kartlarındaki sürüm numaraları ve işlem geçmişi
            de bu yüzden boş görünüyor. Birkaç dakika sonra sayfayı yenileyin,
            sürerse yönetici ile mesajlaşmadan teyitleşin.
          </p>
        </div>
      )}
      {/* QC FOTOĞRAF KAYDI OKUNAMADI: yüklenmiş fotoğraf sayısı BİLİNMİYOR.
          Kartlarda sayı sıfır görünür ve "QC'ye gönder" düğmesi bu yüzden
          kapalı kalır (jobs-client: qcUploaded < QC_MIN_PHOTOS). Sıfır bir
          ÖLÇÜM değil, okunamayan bir kayıttır; boyacı bunu bilmeden fotoğrafları
          yeniden yükleyip aynı turu ikinci kez doldurabilirdi. */}
      {qcPhotosUnreadable && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Yüklediğiniz QC fotoğrafları şu anda okunamıyor (geçici sistem
            arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            Bu turda kaç fotoğraf yüklediğinizi şu anda göremiyoruz; kartlarda
            sıfır görünüyor ve kalite kontrole gönderme düğmesi bu yüzden kapalı.
            Daha önce yüklediğiniz fotoğraflar SİLİNMEDİ — lütfen yeniden
            yüklemeyin. Birkaç dakika sonra sayfayı yenileyin, sürerse yönetici
            ile mesajlaşmadan teyitleşin.
          </p>
        </div>
      )}
      {/* GÖSTERİM TABLOLARI OKUNAMADI: iş listesi açık, ama boş görünen bu
          alanlar "kayıt yok" demek değil. Kapılar bu üç alandan hiçbirine
          dayanmaz (boyama, QC ve kargo kararları yukarıdaki kendi
          kayıtlarından okunur), o yüzden burada kapatılan bir şey yok —
          söylenmesi gereken tek şey, boşluğun bir ÖLÇÜM olmadığı. */}
      {(referencePhotosUnreadable ||
        approvedImagesUnreadable ||
        customerNamesUnreadable ||
        unreadUnreadable) && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            İş kartlarının bazı bilgileri şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            Şu alanlar BOŞ DEĞİL, BİLİNMİYOR:{" "}
            {[
              referencePhotosUnreadable && "müşteri referans fotoğrafları",
              approvedImagesUnreadable && "onaylanan tasarım görseli",
              customerNamesUnreadable && "müşteri adı",
              unreadUnreadable &&
                "yöneticiden gelen okunmamış mesaj sayısı (kartlarda sıfır görünüyor; yeni mesaj olabilir, sohbeti açıp kontrol edin)",
            ]
              .filter(Boolean)
              .join(" · ")}
            . İşin kendisi, ödemeniz ve adımlar aşağıda gerçek kayıtlardır.
            Birkaç dakika sonra sayfayı yenileyin.
          </p>
        </div>
      )}
      <PainterJobsClient
        jobs={orderRows.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          orderType: o.orderType,
          productTitleSnapshot: o.productTitleSnapshot,
          customerName: customerNameById.get(o.userId ?? "") ?? o.customerName,
          figurineSize: o.figurineSize,
          style: o.style,
          finish: o.finish,
          modifiers: o.modifiers as string[] | null,
          painterStatus: o.painterStatus,
          paymentStatus: o.paymentStatus,
          assignedAt: o.assignedToPainterAt?.toISOString() ?? null,
          material: o.material,
          // Rate + gross / commission / net, computed here (see jobEarning).
          ...jobEarning(o),
          handoffCarrier: o.painterHandoffCarrier,
          handoffTrackingNumber: o.painterHandoffTrackingNumber,
          receivedAt: o.receivedByPainterAt?.toISOString() ?? null,
          modelAck: ackByOrder.get(o.id) ?? {
            announcedRevision: null,
            acknowledgedRevision: null,
            pending: false,
            readFailed: false,
          },
          adminUnreadCount: unreadByOrder.get(o.id) ?? 0,
          actions: actionsByOrder.get(o.id) ?? [],
          qcPhotoCount: qcByOrder.get(o.id)?.count ?? 0,
          qcPhotoUrls: qcByOrder.get(o.id)?.urls ?? [],
          glbUrl: normalizeFileUrl(o.modelGlbUrl),
          specRows: (o.selectedOptions ?? []).map((s) => ({
            label: s.groupName,
            value: s.choiceName,
          })),
          customerNote: o.customerNote,
          quantity: o.quantity,
          approvedImageUrl: normalizeFileUrl(
            approvedImageById.get(o.previewId ?? "") ?? null
          ),
          photoUrls: photosByOrder.get(o.id) ?? [],
          shippingAddress: o.shippingAddress as TurkishAddress | null,
        }))}
        total={totalCount}
        page={page}
        pageSize={PAGE_SIZE}
        filterStatus={filterStatus || null}
        locale={locale}
      />
    </div>
  );
}
