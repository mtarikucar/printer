import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers, orders } from "@/lib/db/schema";
import {
  ASSIGN_FAILURE_MESSAGES,
  assignManufacturerToOrder,
} from "@/lib/services/manufacturer-assign";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// Hand a batch of orders for ONE product to a single manufacturer.
//
// This is the deterministic half of production batching: the ranker's
// batchAffinity signal nudges repeat orders toward the same workshop, but an
// admin looking at "340 units of this keychain across 9 orders" needs to be
// able to just place them all at once. Bounded to keep one request from turning
// into an unbounded fan-out of notifications.
const MAX_BULK_ASSIGN = 50;

// Every message is Turkish: the bulk-orders page shows the first issue's text
// as-is, and zod's defaults are English.
const schema = z.object(
  {
    manufacturerId: z
      .string({ error: "Üretici seçin." })
      .uuid({ error: "Geçerli bir üretici seçin." }),
    orderIds: z
      .array(
        z
          .string({ error: "Geçersiz sipariş kimliği." })
          .uuid({ error: "Geçersiz sipariş kimliği." }),
        { error: "Sipariş listesi geçersiz." }
      )
      .min(1, { error: "En az bir sipariş seçin." })
      .max(MAX_BULK_ASSIGN, {
        error: `Tek seferde en fazla ${MAX_BULK_ASSIGN} sipariş atanabilir.`,
      }),
  },
  { error: "Geçersiz istek." }
);

export async function POST(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." },
        { status: 400 }
      );
    }
    const { manufacturerId, orderIds } = parsed.data;

    // PAZARYERİ KURALI: satıcının kendi kataloğundan çıkan sipariş YALNIZ satıcının
    // kendi atölyesine verilebilir. Toplu ekran tek bir üretici seçtirir, yani
    // "bu üründen 9 siparişi şu atölyeye ver" tek tıkla satıcının ürününü
    // rakibine bastırabilirdi.
    //
    // Kuralı UYGULAYAN yer artık atama kapısının kendisi (E-C1,
    // assignManufacturerToOrder → `seller_owned`), bu yüzden burada ikinci bir
    // kopyası YOK: döngü kapının cevabını okur. Toplu uçta AŞMA DA YOKTUR (kapıya
    // `allowSellerOverride` geçilmez) — sahibin kararı: mülkiyet ancak tek
    // siparişte, gerekçeli ve denetlenmiş bir kararla aşılabilir; elli siparişte
    // tek tıkla aşılabilen bir kural, kural değildir.
    //
    // Satıcı adı sipariş başına ayrı sorgu ile değil, tek toplu okumayla alınır:
    // atlama gerekçesi satıcıyı ADIYLA söylemeli, yoksa admin hangi siparişin
    // neden kaldığını ekrandan anlayamaz.
    const ownershipRows = await db
      .select({
        orderId: orders.id,
        sellerManufacturerId: orders.sellerManufacturerId,
        sellerName: manufacturers.companyName,
      })
      .from(orders)
      .leftJoin(manufacturers, eq(manufacturers.id, orders.sellerManufacturerId))
      .where(inArray(orders.id, orderIds));
    const ownership = new Map(ownershipRows.map((r) => [r.orderId, r]));

    // Sequential on purpose: each assignment writes an audit row and fires a
    // partner notification, and the shared service already guards each update on
    // the order still being unassigned. Racing 50 of these at one manufacturer
    // buys nothing and makes the failure report harder to read.
    const assigned: string[] = [];
    // `message` is the same Turkish copy the single assign route returns, so a
    // skipped refunded order is named as such rather than left as a bare key.
    const skipped: Array<{ orderId: string; reason: string; message: string }> = [];
    for (const orderId of orderIds) {
      const result = await assignManufacturerToOrder({
        orderId,
        manufacturerId,
        adminEmail: a.session.user.email,
      });
      if (result.ok) {
        assigned.push(orderId);
        continue;
      }
      if (result.reason === "seller_owned") {
        // Atlanır, aşılmaz. Ad önce kapının cevabından, o çözemediyse toplu
        // okumadan alınır; ikisi de yoksa cümle adsız da doğru kalır.
        const sellerName =
          result.sellerName ?? ownership.get(orderId)?.sellerName ?? null;
        const seller = sellerName ? `${sellerName} atölyesinin` : "bir satıcının";
        skipped.push({
          orderId,
          reason: result.reason,
          message:
            `Bu sipariş ${seller} kendi kataloğundan çıktı: yalnız o atölyeye atanabilir. ` +
            `Toplu atamada bu kural aşılamaz; gerekiyorsa siparişin kendi sayfasından gerekçeli olarak devredin.`,
        });
        continue;
      }
      skipped.push({
        orderId,
        reason: result.reason,
        message: ASSIGN_FAILURE_MESSAGES[result.reason],
      });
    }

    // A partially-applied batch is the normal outcome when someone else grabbed
    // an order in the meantime — report it rather than failing the whole call.
    return NextResponse.json({
      success: true,
      assignedCount: assigned.length,
      skipped,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/bulk-orders/assign", ADMIN_ACTION_FAILED_ERROR);
  }
}
