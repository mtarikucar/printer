export const dynamic = "force-dynamic";

import { asc, desc, eq, sql } from "drizzle-orm";
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
import { isRefunded } from "@/lib/config/order-status-policy";
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

const EARNING_COLUMNS = {
  orderId: true,
  grossKurus: true,
  commissionKurus: true,
  netKurus: true,
  status: true,
  createdAt: true,
} as const;

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
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;

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
    // Bekleyen ödemeler önce (enum sırası: pending, paid) — sınır yalnızca
    // geçmişi kırpsın, transfer bekleyen bir ödeme asla listeden düşmesin.
    displayRead(
      "üreticilerin ödeme partileri",
      db.query.payouts.findMany({
      with: {
        manufacturer: { columns: { companyName: true, ...BANK_COLUMNS } },
        earnings: {
          columns: EARNING_COLUMNS,
          // paymentStatus: partiye girmiş bir iade hakedişi partide de işaretli
          // kalsın. Uyarının kaybolduğu an, tam da riskin gerçekleştiği andı.
          with: { order: { columns: { orderNumber: true, paymentStatus: true } } },
        },
      },
      orderBy: [asc(payouts.status), desc(payouts.createdAt)],
      limit: 100,
      })
    ),
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
    displayRead(
      "boyacıların ödeme partileri",
      db.query.painterPayouts.findMany({
      with: {
        painter: { columns: { companyName: true, ...BANK_COLUMNS } },
        earnings: {
          columns: EARNING_COLUMNS,
          // paymentStatus: partiye girmiş bir iade hakedişi partide de işaretli
          // kalsın. Uyarının kaybolduğu an, tam da riskin gerçekleştiği andı.
          with: { order: { columns: { orderNumber: true, paymentStatus: true } } },
        },
      },
      orderBy: [asc(painterPayouts.status), desc(painterPayouts.createdAt)],
      limit: 100,
      })
    ),
  ]);

  // null = okunamadı: liste BOŞ değil, BİLİNMİYOR. Ödenecek hakedişi bilinmeyen
  // bir partner için "Ödeme oluştur" düğmesi HİÇ sunulmaz (satır render
  // edilmediği için) — kapı kapalı tarafta kalır, sebebini de şerit söyler.
  const manufacturerOwedUnreadable = mOwedRead === null;
  const manufacturerPayoutsUnreadable = mPayoutRead === null;
  const painterOwedUnreadable = pOwedRead === null;
  const painterPayoutsUnreadable = pPayoutRead === null;
  const mOwedRows = mOwedRead ?? [];
  const mPayoutRows = mPayoutRead ?? [];
  const pOwedRows = pOwedRead ?? [];
  const pPayoutRows = pPayoutRead ?? [];

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
      earnings: Array<
        EarningColumns & { order: { orderNumber: string; paymentStatus: string } | null }
      >;
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
    earnings: p.earnings.map((e) =>
      earningLine(e, e.order?.orderNumber, isRefunded({ paymentStatus: e.order?.paymentStatus ?? null }))
    ),
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

  return (
    <>
      <PayoutReadNotice areas={unreadableAreas} />
      <PayoutsClient initialTab={tab === "painter" ? "painter" : "manufacturer"} data={data} />
    </>
  );
}
