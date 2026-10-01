/**
 * `GET /api/customer/team/orders` — takımın siparişleri, SALT OKUNUR (0072).
 *
 * YÖNTEM KÜMESİ SÖZLEŞMEDİR: yalnız **GET**. POST/PATCH/DELETE YOKTUR ve
 * olmayacak — sebebi bir üslup tercihi değil, mesafeli satış sözleşmesi:
 * sözleşmenin TARAFI ödeyen gerçek kişidir (takım hukuki bir kişi değildir),
 * yani anlaşmazlık, iade talebi, yeniden sipariş, fatura/dekont indirme, not ve
 * sipariş sohbeti ÖDEYENİN hakkıdır. Takım yalnız OKUR.
 * (`scripts/test-customer-team-api.ts` bunu uçtan çiviliyor.)
 *
 * ─── NEDEN AYRI BİR UÇ (`/api/customer/orders` VARKEN) ─────────────────────
 *
 * O ailenin on iki ucu `orders.userId` ile kilitli ve `dispute-resolution.ts` /
 * `order-refund.ts` üzerinden ortak hakedişine dokunuyor. Oraya bir "takım da
 * görebilir" dalı eklemek, EYLEM uçlarını da aynı dala açma baskısı üretirdi.
 * Ayrı uç, o kapıyı hiç açmamanın tek yolu: bu dosya `/api/customer/orders`
 * altındaki hiçbir şeyi import etmiyor, onlar da bunu.
 *
 * ─── GÖRÜNÜRLÜK TÜRETİLİR, KOLON EKLENMEZ ─────────────────────────────────
 *
 * `orders` ve `order_drafts` tanımlarına HİÇBİR kolon eklenmedi (tasarım §0):
 * bağ `quotes.order_id` ⋈ `quotes.team_id` üzerinden kurulur. Bu, 36 tablonun
 * en sıcak tablosunun hiç açılmaması demek.
 *
 * ─── CEVAPTA KİŞİSEL VERİ YOK ─────────────────────────────────────────────
 *
 * Ödeyenin adı, e-postası, telefonu ve TESLİMAT ADRESİ gönderilmez (tasarım
 * değişmezi: üye listesinde bile yalnız ad + e-posta + rol var). Takımın
 * göreceği şey işin DURUMU ve TUTARIDIR; meslektaşının evine gönderdiği bir
 * siparişin adresi değil. `/pay/<ref>` sayfasının aynı disiplini.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { db } from "@/lib/db";
import { orders, quotes } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { loadMembership } from "@/lib/services/customer-team";
import { teamsEnabled } from "@/lib/services/quote-access";
import { TEAM_NOT_FOUND, teamRouteBody, teamUnauthorized } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * Bir ekrana sığan ve "daha fazla" düğmesi gerektirmeyen bir tavan. Takımın
 * sipariş sayısı teklif sayısından küçüktür (her teklif siparişe dönmez), bu
 * yüzden sayfalama YOK: olmayan bir sorunun çözümü ekranda bir düğme olurdu.
 */
const MAX_ROWS = 100;

async function handleGET(request: NextRequest): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);

  const membership = await loadMembership(session.userId);
  // Takımı OLMAYAN müşteri bir hata değil: ekran boş liste gösterir. 403,
  // "takımın var ama yetkin yok" demek olurdu — oysa takım hiç yok.
  if (!membership) return NextResponse.json({ orders: [] });

  // ROL AYRIMI YOK ve bu KASITLI: takım yalnız okur, ama DÖRT rolü de okur.
  // `viewer` rolünün ayrımı YAZMA yolundadır (tasarım §4) ve bu uçta yazma yok.
  const rows = await db
    .select({
      orderNumber: orders.orderNumber,
      status: orders.status,
      amountKurus: orders.amountKurus,
      paidAt: orders.paidAt,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
      trackingNumber: orders.trackingNumber,
      carrier: orders.carrier,
      quoteNumber: quotes.number,
      quoteTitle: quotes.title,
    })
    .from(quotes)
    .innerJoin(orders, eq(orders.id, quotes.orderId))
    .where(and(eq(quotes.teamId, membership.teamId), isNotNull(quotes.orderId)))
    .orderBy(desc(orders.paidAt))
    .limit(MAX_ROWS);

  // Parça LİSTESİ bu uçta YOK: onu isteyen ekran detay ucuna gider ve orada
  // `quote_checkouts.parts_snapshot` BİR sipariş için okunur. Listede okumak,
  // yüz siparişlik bir jsonb yığınını hiçbir kolonun göstermediği bir alan
  // için taşımak olurdu.
  return NextResponse.json({ orders: rows });
}

export async function GET(request: NextRequest) {
  try {
    return await teamRouteBody(() => handleGET(request));
  } catch (e) {
    return handleRouteFailure(e, "GET /api/customer/team/orders", CUSTOMER_READ_FAILED_ERROR);
  }
}
