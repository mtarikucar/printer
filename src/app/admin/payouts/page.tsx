export const dynamic = "force-dynamic";

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturerEarnings,
  manufacturers,
  orders,
  painterEarnings,
  painters,
  partnerAdjustments,
} from "@/lib/db/schema";
import {
  PayoutsClient,
  type BankInfo,
  type EarningLine,
  type OwedPartner,
  type PayoutTabData,
  type AdjustmentLine,
} from "./client";
import { readPartnerPayables, type PartnerPayables } from "@/lib/services/partner-payables";
import { readPayoutPage } from "@/lib/services/payout-list";
import { parsePayoutListQuery, type AdminPayoutListScope, type PayoutListQuery } from "@/lib/config/payout-list";
import {
  claimableEarningWhere,
  openEarningWhere,
} from "@/lib/services/earning-claimable";

// Partner ödemeleri — üretici VE boyacı için aynı iki adımlı akış:
//   1) "Ödeme oluştur": partnerin bekleyen, henüz bir ödemeye girmemiş
//      hakedişleri tek BEKLEYEN ödemede toplanır (partnerin kendi talebi de
//      buraya düşer);
//   2) banka transferi yapılınca "Ödendi işaretle" (referansla).
// Boyacı tarafının önceden hiç ekranı yoktu: boyacının kendi talep ettiği
// bekleyen ödemeler hiçbir yerde görünmüyordu ve tek yol, hakedişleri tek
// adımda "ödendi" yazan bir API'ydi. Tutarlar hakediş satırlarının kendisidir
// (tahakkukta computeEarning ile yazılmış) — burada yeniden hesaplanmaz.
//
// ÖDENEBİLİRLİK KURALI BU EKRANIN DEĞİL: kuyruk, açık (partilenmemiş) hakediş
// satırlarının TAMAMINI okur ama ödenebilir olanı ödenmeyenden SQL'de, ortak
// kuralla ayırır (earning-claimable.ts). Ekran eskiden yalnız
// `status='pending' + payout_id is null` filtreliyordu: iade edilmiş siparişin
// hakedişi "ödeme bekleyen hak ediş" diye, hiçbir işaret olmadan listeleniyordu.
// Sonucu üç ayrı yanlıştı — (1) admin toplamı partnerin kendi ekranından tam
// iade tutarı kadar fazla görünüyordu, (2) üretici sekmesinde sunulan düğme ölü
// idi (servis haklı olarak 400 dönüyordu), (3) boyacı sekmesinde aynı düğme
// çalışıyor ve iade parasını ödüyordu. Artık `owedKurus` düğmenin yaratacağı
// partinin TA KENDİSİDİR; iade satırları ayrı, "ödenmez" diye yazılı durur.

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

function earningLine(
  e: EarningColumns,
  orderNumber: string | null | undefined,
  refunded: boolean
): EarningLine {
  return {
    orderId: e.orderId,
    orderNumber: orderNumber ?? "—",
    grossKurus: e.grossKurus,
    commissionKurus: e.commissionKurus,
    netKurus: e.netKurus,
    status: e.status,
    refunded,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * Açık hakedişleri partnere göre toplar ve ÖDENEBİLİRİ ÖDENMEYENDEN AYIRIR.
 *
 * `claimable` bayrağı SQL'de, ortak kuraldan gelir: `owedKurus`/`count` böylece
 * "Ödeme oluştur"un yaratacağı partiyle aynı satır kümesidir — onay kutusunda
 * yazan rakam ile oluşan parti arasında fark kalmaz. İade satırları listeden
 * DÜŞMEZ (para gözden kaybolmasın); ayrı toplanır ve ekranda "ödenmez" diye
 * yazılır.
 */
function groupOwed(
  rows: Array<
    EarningColumns &
      BankColumns & { partnerId: string; name: string; orderNumber: string; claimable: boolean }
  >
): OwedPartner[] {
  const byPartner = new Map<string, OwedPartner>();
  for (const r of rows) {
    let g = byPartner.get(r.partnerId);
    if (!g) {
      g = {
        partnerId: r.partnerId,
        name: r.name,
        owedKurus: 0,
        count: 0,
        refundedKurus: 0,
        refundedCount: 0,
        bank: bankOf(r),
        earnings: [],
        refundedEarnings: [],
        adjustments: [],
        blockedRecords: [],
      };
      byPartner.set(r.partnerId, g);
    }
    if (r.claimable) {
      g.owedKurus += r.netKurus;
      g.count += 1;
      g.earnings.push(earningLine(r, r.orderNumber, false));
    } else {
      // Açık ama ödenebilir değil: siparişi iade edilmiş. Tek sebep bu, çünkü
      // sorgunun WHERE'i zaten açık satırları seçiyor.
      g.refundedKurus += r.netKurus;
      g.refundedCount += 1;
      g.refundedEarnings.push(earningLine(r, r.orderNumber, true));
    }
  }
  return [...byPartner.values()].sort(
    (a, b) => b.owedKurus - a.owedKurus || b.refundedKurus - a.refundedKurus
  );
}

/**
 * GÖSTERİM amaçlı okuma: sonuç ekranda GÖSTERİLİR; ödenebilirlik kuralını bu
 * okuma değil earning-claimable.ts belirler. Arıza YUTULMAZ — null döner ve null
 * "kayıt yok" değil "BİLİNMİYOR" demektir.
 *
 * NEDEN: dört okumanın dördü de ilişki taşıyor (partner adı + banka bilgisi,
 * partinin hakediş satırları ve onların siparişi). Drizzle'ın ilişkisel sorgusu
 * TEK ifadedir: `manufacturers`, `painters` ya da `orders` okunamadığında ödeme
 * ekranının TAMAMI 500 verirdi — tam da paranın kime, ne zaman gönderileceğine
 * bakılan yerde.
 *
 * İlişkiler sorgunun İÇİNDE BIRAKILDI (ayrı okunup birleştirilmedi): partnerin
 * adı ve IBAN'ı, para satırından ayrılabilir bir süs değil; eksik bir banka
 * kaydı ekranda "IBAN yok — transfer yapılamaz" diye, yapılmamış bir okumanın
 * iddiası olarak görünürdü. Bu yüzden okuma tek parçadır: ya tamamı bilinir, ya
 * da o sekme "bilinmiyor" der ve "Ödeme oluştur" düğmesi hiç sunulmaz.
 */
async function displayRead<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[admin payouts] ${label} okunamadı`, e);
    return null;
  }
}

/** Sayfanın en üstünde duran arıza şeridi. */
function PayoutReadNotice({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <div
      role="alert"
      className="m-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:m-6"
    >
      <p className="font-semibold">
        Ödeme kuyruğunun bazı bölümleri şu anda okunamıyor (geçici sistem arızası)
      </p>
      <p className="mt-1 text-amber-900/80">
        Aşağıda görünenler gerçek kayıtlardır; ama şu bölümler BOŞ DEĞİL,
        BİLİNMİYOR: {areas.join(" · ")}. Boş görünen bir kuyruğa bakıp
        &quot;ödenecek bir şey yok&quot; sonucunu çıkarmayın; birkaç dakika sonra
        sayfayı yenileyin.
      </p>
    </div>
  );
}

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const tab = raw.tab === "painter" ? "painter" : "manufacturer";
  const historyScopes: Record<"manufacturer" | "painter", AdminPayoutListScope> = {
    manufacturer: { audience: "admin", kind: "manufacturer" },
    painter: { audience: "admin", kind: "painter" },
  };
  const historyQueries: Record<"manufacturer" | "painter", PayoutListQuery> = {
    manufacturer: { status: "pending", limit: 50 }, painter: { status: "pending", limit: 50 },
  };
  try {
    if (raw.partnerId !== undefined && typeof raw.partnerId !== "string") throw new Error("Invalid owner");
    if (typeof raw.partnerId === "string" && raw.partnerId) historyScopes[tab].partnerId = raw.partnerId;
    const params = new URLSearchParams();
    for (const key of ["status", "limit", "cursor"]) {
      const value = raw[key];
      if (Array.isArray(value)) value.forEach(item => params.append(key, item));
      else if (value !== undefined) params.set(key, value);
    }
    historyQueries[tab] = parsePayoutListQuery(params, historyScopes[tab]);
  } catch {
    return <div role="alert" className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Ödeme geçmişi filtresi veya sayfa bağlantısı geçersiz. <a href="/admin/payouts" className="underline">Listeyi yeniden açın</a>.</div>;
  }

  const [mOwedRead, mPayoutRead, pOwedRead, pPayoutRead] = await Promise.all([
    displayRead(
      "üreticilerin ödeme bekleyen hakedişleri",
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
        // Ödenebilirlik SQL'de, ortak kuraldan: ekranın "ödeme bekleyen"
        // dediği küme ile düğmenin partilediği küme tanım gereği aynı olsun.
        claimable: sql<boolean>`${claimableEarningWhere(manufacturerEarnings)}`,
        iban: manufacturers.iban,
        bankAccountHolder: manufacturers.bankAccountHolder,
        bankName: manufacturers.bankName,
        pendingIban: manufacturers.pendingIban,
        ibanReviewStatus: manufacturers.ibanReviewStatus,
      })
      .from(manufacturerEarnings)
      .innerJoin(manufacturers, eq(manufacturers.id, manufacturerEarnings.manufacturerId))
      .innerJoin(orders, eq(orders.id, manufacturerEarnings.orderId))
      .where(openEarningWhere(manufacturerEarnings))
      .orderBy(asc(manufacturerEarnings.createdAt))
    ),
    // Geçmiş ortak filtre ve değişmeyen tarih/id sırasıyla sayfalanır.
    displayRead("üreticilerin ödeme partileri", readPayoutPage(historyScopes.manufacturer, historyQueries.manufacturer)),
    displayRead(
      "boyacıların ödeme bekleyen hakedişleri",
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
        claimable: sql<boolean>`${claimableEarningWhere(painterEarnings)}`,
        iban: painters.iban,
        bankAccountHolder: painters.bankAccountHolder,
        bankName: painters.bankName,
        pendingIban: painters.pendingIban,
        ibanReviewStatus: painters.ibanReviewStatus,
      })
      .from(painterEarnings)
      .innerJoin(painters, eq(painters.id, painterEarnings.painterId))
      .innerJoin(orders, eq(orders.id, painterEarnings.orderId))
      .where(openEarningWhere(painterEarnings))
      .orderBy(asc(painterEarnings.createdAt))
    ),
    displayRead("boyacıların ödeme partileri", readPayoutPage(historyScopes.painter, historyQueries.painter)),
  ]);

  // null = okunamadı: liste BOŞ değil, BİLİNMİYOR. Ödenecek hakedişi bilinmeyen
  // bir partner için "Ödeme oluştur" düğmesi HİÇ sunulmaz (satır render
  // edilmediği için) — kapı kapalı tarafta kalır, sebebini de şerit söyler.
  const manufacturerOwedUnreadable = mOwedRead === null;
  const manufacturerPayoutsUnreadable = mPayoutRead === null;
  const painterOwedUnreadable = pOwedRead === null;
  const painterPayoutsUnreadable = pPayoutRead === null;
  const mOwedRows = mOwedRead ?? [];
  const mPayoutRows = mPayoutRead?.rows ?? [];
  const pOwedRows = pOwedRead ?? [];
  const pPayoutRows = pPayoutRead?.rows ?? [];

  const unreadableAreas = [
    manufacturerOwedUnreadable &&
      "Üreticilerin ödeme bekleyen hakedişleri (Üreticiler sekmesindeki kuyruk BOŞ görünüyor ve \"Ödeme oluştur\" düğmesi bu yüzden görünmüyor)",
    manufacturerPayoutsUnreadable &&
      "Üreticilerin ödeme partileri (transfer bekleyen ödemeler görünmüyor olabilir)",
    painterOwedUnreadable &&
      "Boyacıların ödeme bekleyen hakedişleri (Boyacılar sekmesindeki kuyruk BOŞ görünüyor ve \"Ödeme oluştur\" düğmesi bu yüzden görünmüyor)",
    painterPayoutsUnreadable &&
      "Boyacıların ödeme partileri (transfer bekleyen ödemeler görünmüyor olabilir)",
  ].filter((x): x is string => typeof x === "string");

  const data: Record<"manufacturer" | "painter", PayoutTabData> = {
    manufacturer: {
      owed: groupOwed(mOwedRows),
      payouts: mPayoutRows,
    },
    painter: {
      owed: groupOwed(pOwedRows),
      payouts: pPayoutRows,
    },
  };

  const [mOptions, pOptions] = await Promise.all([
    displayRead("üretici filtre seçenekleri", db.select({ id: manufacturers.id, name: manufacturers.companyName }).from(manufacturers).orderBy(manufacturers.companyName)),
    displayRead("boyacı filtre seçenekleri", db.select({ id: painters.id, name: painters.companyName }).from(painters).orderBy(painters.companyName)),
  ]);
  for (const kind of ["manufacturer", "painter"] as const) {
    const page = kind === "manufacturer" ? mPayoutRead : pPayoutRead;
    const options = kind === "manufacturer" ? mOptions : pOptions;
    const scope = historyScopes[kind], query = historyQueries[kind];
    const exportParams = new URLSearchParams({ kind, status: query.status });
    if (scope.partnerId) exportParams.set("partnerId", scope.partnerId);
    data[kind].history = {
      ...query, nextCursor: page?.nextCursor ?? null, rowCount: page?.rows.length ?? 0,
      unavailable: page === null, exportHref: `/api/admin/payouts/export?${exportParams}`,
      partnerFilter: { value: scope.partnerId ?? "", options: options ?? [], unavailable: options === null },
    };
    if (options === null) unreadableAreas.push(`${kind === "manufacturer" ? "Üretici" : "Boyacı"} filtre seçenekleri`);
  }

  const adjustmentLine = (a: PartnerPayables["adjustmentHistory"][number]): AdjustmentLine => ({
    id: a.id, orderId: a.orderId, netKurus: a.netKurus, kind: a.kind, reason: a.reason, status: a.status,
  });
  const pendingAdjustments = await displayRead("ek hak ediş sahipleri", db.select({
    manufacturerId: partnerAdjustments.manufacturerId, painterId: partnerAdjustments.painterId,
  }).from(partnerAdjustments).where(eq(partnerAdjustments.status, "pending")));
  if (pendingAdjustments === null) {
    unreadableAreas.push("Ek hak edişler okunamadı; ödeme oluşturma kuyrukları kapalı tutuldu.");
    data.manufacturer.owed = []; data.painter.owed = [];
  }
  for (const kind of ["manufacturer", "painter"] as const) {
    if (pendingAdjustments !== null) {
      const existing = new Map(data[kind].owed.map(o => [o.partnerId, o]));
      const ids = new Set([...existing.keys(), ...pendingAdjustments.map(a => kind === "manufacturer" ? a.manufacturerId : a.painterId).filter((id): id is string => !!id)]);
      const updated = await Promise.all([...ids].map(async partnerId => {
        try {
          const summary = await readPartnerPayables(kind, partnerId);
          let entry = existing.get(partnerId);
          if (!entry) {
            const partner = kind === "manufacturer"
              ? await db.query.manufacturers.findFirst({ where: eq(manufacturers.id, partnerId), columns: { companyName: true, ...BANK_COLUMNS } })
              : await db.query.painters.findFirst({ where: eq(painters.id, partnerId), columns: { companyName: true, ...BANK_COLUMNS } });
            if (!partner) throw new Error("Partner missing");
            entry = { partnerId, name: partner.companyName, bank: bankOf(partner), owedKurus: 0, count: 0,
              refundedKurus: 0, refundedCount: 0, earnings: [], refundedEarnings: [], adjustments: [], blockedRecords: [] };
          }
          const eligibleOrders = new Set(summary.groups.filter(g => g.sourceKind !== "adjustment").map(g => g.orderId));
          const adjustmentIds = new Set(summary.groups.flatMap(g => g.members.filter(m => m.sourceKind === "adjustment").map(m => m.id)));
          return { ...entry, owedKurus: summary.claimableNet, count: summary.claimableCount,
            earnings: entry.earnings.filter(e => eligibleOrders.has(e.orderId)),
            adjustments: summary.adjustmentHistory.filter(a => adjustmentIds.has(a.id)).map(adjustmentLine),
            blockedRecords: summary.blockedGroups.map(g => ({ orderId: g.orderId, reason:
              g.reason === "offset_exceeds_source" ? "Kesinti kaynağın güncel tutarını aşıyor; düzeltmeyi iptal edip yeniden düzenleyin."
              : g.reason === "missing" || g.reason === "reversed" ? "Düzeltmenin kaynağı yok veya geri alınmış; başka siparişten kesinti yapılamaz."
              : g.reason === "source_ineligible" ? "Kaynak hak ediş ödenebilir değil; iade ve hak ediş kayıtlarını inceleyin."
              : "Kaynak ve düzeltmeler birlikte ödemeye alınamıyor; kayıtları inceleyin." })),
          };
        } catch (error) {
          console.error("admin payout balance", kind, partnerId, error);
          unreadableAreas.push(`${kind === "manufacturer" ? "Üretici" : "Boyacı"} ${existing.get(partnerId)?.name ?? partnerId}: güncel bakiye okunamadı; ödeme oluşturma kapalı.`);
          return null;
        }
      }));
      data[kind].owed = updated.filter((o): o is OwedPartner => o !== null).sort((a, b) => b.owedKurus - a.owedKurus);
    }

  }

  return (
    <>
      <PayoutReadNotice areas={unreadableAreas} />
      <PayoutsClient initialTab={tab === "painter" ? "painter" : "manufacturer"} data={data} />
    </>
  );
}
