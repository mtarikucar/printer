import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers, orders, painters } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import {
  emptyPainterCapacity,
  loadPainterCapacities,
  painterLoadLabel,
} from "@/lib/services/painter-capacity";
import {
  rankPaintersForOrder,
  type PainterCandidate,
} from "@/lib/services/painter-assignment";
import { isRefunded } from "@/lib/config/order-status-policy";
import { handleRouteFailure, PARTNER_READ_FAILED_ERROR } from "@/lib/api/route-error";

const orderIdSchema = z.string().uuid();

// List painters a manufacturer can hand a painting job to: active + accepting.
// Used to populate the "Boyacıya gönder" picker on the manufacturer order page.
//
// With `?orderId=` the list is RANKED by the same scorer that places painters
// automatically (P4-C1, services/painter-assignment.ts), and each painter
// carries its live load and score parts. Before this, the picker was an
// alphabetical directory with no load and no order: the manufacturer picked the
// first familiar name, while the platform pays for both courier legs and the
// job may sit behind a full workshop's queue. Showing the same ranking the
// automatic assignment uses also means a manual pick and an automatic one can
// be compared — they come from one source, not two.
//
// Each painter also carries `declined`: true when they already refused THIS job
// (orders.declinedPainterIds). The picker greys them out and send-to-painter
// refuses them, instead of the manufacturer finding out from a 409. Only the
// manufacturer's own order is read; any other id marks nobody.
//
// GİZLİLİK: boyacı kimliği yalnız işi DEVREDEN üreticiye açılır (boyacı
// sözleşmesi). Bu uç oturum sahibinin KENDİ siparişini okur; sıralama ve
// boyacı adları hiçbir müşteri yüzeyine çıkmaz.
export async function GET(request: NextRequest) {
  try {
    const session = await getManufacturerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Match every other manufacturer action route: a suspended/rejected account
    // holding a still-valid JWT must not read the painter directory.
    const manufacturer = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, session.manufacturerId),
    });
    if (!manufacturer || manufacturer.status !== "active") {
      return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
    }

    let declined = new Set<string>();
    let rankableOrderId: string | null = null;
    // Validated first: a non-uuid compared with a uuid column is a Postgres
    // error, which would turn a bad query string into a 500.
    const orderId = orderIdSchema.safeParse(request.nextUrl.searchParams.get("orderId"));
    if (orderId.success) {
      const order = await db.query.orders.findFirst({
        where: and(
          eq(orders.id, orderId.data),
          eq(orders.manufacturerId, session.manufacturerId)
        ),
        columns: { declinedPainterIds: true, paymentStatus: true },
      });
      if (order) {
        // İADE EDİLMİŞ SİPARİŞ HİÇBİR ŞEY SUNMAZ. Devir ucu iadeyi 409 ile
        // reddediyor (send-to-painter · notRefundedGuard); dolu bir boyacı
        // listesi göstermek, yapılamayacak bir işlemi vaat etmek olurdu.
        if (isRefunded(order)) {
          return NextResponse.json({
            painters: [],
            rankingUnavailable: false,
            refunded: true,
          });
        }
        const ids = order.declinedPainterIds;
        if (Array.isArray(ids)) declined = new Set(ids);
        rankableOrderId = orderId.data;
      }
    }

    const rows = await db
      .select({
        id: painters.id,
        companyName: painters.companyName,
        city: painters.address,
        contactPerson: painters.contactPerson,
        phone: painters.phone,
        maxConcurrentOrders: painters.maxConcurrentOrders,
        capabilities: painters.capabilities,
      })
      .from(painters)
      .where(and(eq(painters.status, "active"), eq(painters.acceptingOrders, true)));

    // CANLI YÜK, TEK ÖLÇÜDEN (services/painter-capacity.ts).
    //
    // Bu uç kendi sayımını yapıyordu ve iş SAYISI sayıyordu; devir ucu da aynı
    // ölçüyü kullandığı için ikisi birbiriyle uyumluydu ama SIRALAYICIYLA
    // değildi: bir PARTİ işi tutan boyacı (100 adet = 6 birim) seçicide
    // "Kapasite dolu" diye kilitliyken uç onu KABUL ediyordu (ölçüm: P4F-2).
    // Kapı artık ağırlıklı yüktür ve ekranla uç aynı fonksiyonu okur.
    const caps = await loadPainterCapacities(rows.map((p) => p.id));

    // SIRALAMA BİR TAVSİYEDİR, KAPI DEĞİL: üretilemediğinde picker alfabetik
    // listeyle çalışmaya devam eder ve ekran sırasız olduğunu söyler. Sıralama
    // yüzünden 500 dönmek, üreticinin işi devretmesini tamamen engellerdi.
    let ranking: PainterCandidate[] = [];
    let rankingUnavailable = false;
    if (rankableOrderId) {
      try {
        ranking = await rankPaintersForOrder(rankableOrderId);
      } catch (e) {
        console.error("[manufacturer/painters] boyacı sıralaması üretilemedi", e);
        rankingUnavailable = true;
      }
    }
    const rankById = new Map(
      ranking.map((c, i) => [c.painterId, { ...c, rank: i + 1 }])
    );

    const list = rows.map((p) => {
      const addr = p.city as {
        adres?: string;
        mahalle?: string;
        ilce?: string;
        il?: string;
        postaKodu?: string;
      } | null;
      const ranked = rankById.get(p.id);
      // Eksik anahtar "bilinmiyor" değil "boş tezgâh" demektir.
      const cap =
        caps.get(p.id) ?? emptyPainterCapacity(p.id, p.maxConcurrentOrders);
      // Etiket TEK KEZ kurulur: aynı satırın yük yazısı ile ret gerekçesi iki
      // ayrı çağrıdan doğarsa biri güncellenip öbürü unutulabilir.
      const loadLabel = painterLoadLabel(cap);
      const isDeclined = declined.has(p.id);
      return {
        id: p.id,
        companyName: p.companyName,
        il: addr?.il ?? null,
        capabilities: p.capabilities ?? [],
        // The manufacturer physically ships the base print to the painter, so
        // they need the address and a phone for the courier — previously they
        // got only a company name and a city.
        contactPerson: p.contactPerson,
        phone: p.phone,
        address: addr
          ? {
              adres: addr.adres ?? "",
              mahalle: addr.mahalle ?? "",
              ilce: addr.ilce ?? "",
              il: addr.il ?? "",
              postaKodu: addr.postaKodu ?? "",
            }
          : null,
        declined: isDeclined,
        // GÖSTERİM: tezgâhtaki ayrı kutu sayısı. Alan adı korunuyor (panel bunu
        // okuyor) ama artık KAPI DEĞİL — kapı `loadUnits`tir.
        currentLoad: cap.activeJobs,
        maxConcurrentOrders: cap.maxConcurrentOrders,
        // Sıralamadan gelenler: sırası yoksa null kalır (sıfır DEĞİL — sıfır
        // "en kötü aday" diye okunurdu, oysa bilinmiyor demektir).
        rank: ranked?.rank ?? null,
        score: ranked?.score ?? null,
        parts: ranked?.parts ?? null,
        // KAPI: ağırlıklı yük (parti işinde bir sipariş birden çok birim
        // sayar). Sıralamadan DEĞİL kapasite ölçüsünden gelir: sıralama
        // hesaplanamadığında bile kapının ölçüsü ekranda görünmeli.
        loadUnits: cap.loadUnits,
        // Tek yük etiketi: "6/2 birim · 1 iş".
        loadLabel,
        reasons: ranked?.reasons ?? [],
        // EKRAN NEYİ KAPATIRSA UÇ ONU REDDEDER: seçici ve devir ucu artık AYNI
        // `painterHasRoom` cevabını okuyor, yani sunulan satır gerçekten kabul
        // edilir, kilitlenen satır gerçekten kapalı bir kapıdır.
        eligible: cap.hasRoom && !isDeclined && (ranked ? ranked.eligible : true),
        // Gerekçe GERÇEK ölçüyü adıyla söyler: "1 iş" tutan bir boyacının neden
        // dolu olduğu ancak birim yazılınca anlaşılır.
        ineligibleReason: isDeclined
          ? "Bu işi daha önce reddetti"
          : !cap.hasRoom
            ? `Kapasitesi dolu (${loadLabel})`
            : (ranked?.ineligibleReason ?? null),
      };
    });

    // Sıralanmışlar önce (sıralayıcının sırasıyla), sıralanmamışlar sonda
    // alfabetik: sıralamaya hiç girmemiş bir boyacıyı sona koymak, onu
    // "en kötü" ilan etmek değil; sırasının BİLİNMEDİĞİNİ söylemektir.
    list.sort((a, b) => {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.companyName.localeCompare(b.companyName, "tr");
    });

    return NextResponse.json({ painters: list, rankingUnavailable, refunded: false });
  } catch (e) {
    return handleRouteFailure(e, "GET /api/manufacturer/painters", PARTNER_READ_FAILED_ERROR);
  }
}
