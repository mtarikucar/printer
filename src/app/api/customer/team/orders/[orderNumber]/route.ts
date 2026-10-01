/**
 * `GET /api/customer/team/orders/[orderNumber]` — takım siparişinin DETAYI,
 * salt okunur (0072).
 *
 * YALNIZ **GET** DIŞA AÇILIR. POST/PATCH/DELETE YOKTUR ve olmayacak: mesafeli
 * satış sözleşmesinin TARAFI ödeyen gerçek kişidir, yani anlaşmazlık, iade
 * talebi, yeniden sipariş, fatura/dekont indirme ve not o kişinin hakkıdır
 * (`/api/customer/orders/**` ailesi, `orders.userId` ile kilitli). Bu uç o
 * ailenin hiçbir parçasını import etmez; takım yalnız OKUR.
 *
 * ─── PARÇA LİSTESİ SİPARİŞİN KENDİ TASLAĞINDAN OKUNUR ─────────────────────
 *
 * Kaynak `quote_checkouts.parts_snapshot` — ödeme anında donan liste. Teklifin
 * BUGÜNKÜ parçaları değil: sipariş o anın işidir ve teklif sonradan
 * düzenlenmiş olabilir. (Teklif siparişe dönünce kilitlenir, ama kaynağın
 * donmuş olması bir varsayıma değil kolona dayanmalı.)
 *
 * SATIR `orders.draft_id` ⋈ `quote_checkouts.draft_id` ile seçilir, "teklifin
 * EN YENİ dondurması" ile DEĞİL. Bir teklifte birden çok dondurma GERÇEK bir
 * hâldir: taslak süresi dolup müşteri yeniden ödemeye başladığında yeni bir
 * taslak + yeni bir dondurma yazılır. `created_at DESC` ile seçmek, siparişe
 * dönMEYEN bir denemenin satır fiyatlarını bu siparişin yanında göstermek
 * olurdu (Σ `lineKurus` ≠ `orders.amount_kurus`). `draft_id` üzerinde TEKİL
 * indeks var (`quote_checkouts_draft_id_uq`), yani eşleşme tam ve tek.
 *
 * ─── CEVAPTA KİŞİSEL VERİ, ÖDEME ARACI VE DOSYA ANAHTARI YOK ──────────────
 *
 * Ödeyenin adı / e-postası / telefonu ve TESLİMAT ADRESİ gönderilmez: takımın
 * işi siparişin DURUMU, TUTARI ve parçalarıdır, meslektaşının adresi değil.
 * `orders.payment_method` de gönderilmez: `card | bank_transfer |
 * gift_card_full` kümesi, meslektaşının siparişini HEDİYE KARTI bakiyesiyle
 * ödediğini söyler ve bu `/privacy` §5.1'in "ödeme araçlarınız, kart
 * bilgileri ve hediye kartı bakiyeniz paylaşılmaz" cümlesinin tam karşıtıdır.
 * Liste ucu da göndermiyor. Parça satırlarından depolama ANAHTARLARI
 * (`canonicalStlKey`, `thumbnailKey`, `drawingKey`) ayıklanır — imzalı dosya
 * adresi yalnız `getPublicUrl` ile, yalnız dosyayı indirecek yüzeyde üretilir
 * (global kısıt).
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { db } from "@/lib/db";
import { orders, quoteCheckouts, quotes } from "@/lib/db/schema";
import type { FrozenQuotePart } from "@/lib/config/quote-types";
import { getSessionUser } from "@/lib/services/customer-auth";
import { loadMembership } from "@/lib/services/customer-team";
import { teamsEnabled } from "@/lib/services/quote-access";
import { TEAM_NOT_FOUND, teamRouteBody, teamUnauthorized } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ orderNumber: string }> };

/**
 * Sipariş bulunamadı — ya yok, ya BU TAKIMIN değil. İki hâl AYRILMAZ ve bu
 * kasıtlı: ayırmak, numarasını bilen birine "böyle bir sipariş var ama senin
 * takımının değil" demek olurdu. Çıkarılmış üye de buraya düşer (üyelik satırı
 * silinir, önbellek yok).
 */
function orderNotFound(): NextResponse {
  return NextResponse.json(
    { error: "Sipariş bulunamadı.", code: "quote_not_found" },
    { status: 404 }
  );
}

/** Takıma giden parça satırı: depolama anahtarı ve dosya adı YOK. */
function publicPart(part: FrozenQuotePart) {
  return {
    position: part.position,
    name: part.name,
    quantity: part.quantity,
    technologyName: part.technologyName,
    materialName: part.materialName,
    colorName: part.colorName,
    finishName: part.finishName,
    dimensionsMm: part.dimensionsMm,
    unitKurus: part.unitKurus,
    lineKurus: part.lineKurus,
  };
}

async function handleGET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);

  const membership = await loadMembership(session.userId);
  if (!membership) return orderNotFound();

  const { orderNumber } = await ctx.params;
  // GÖRÜNÜRLÜK TEK `WHERE`DE: sipariş numarası VE takım kimliği birlikte. Önce
  // siparişi okuyup sonra takımı karşılaştıran bir ifade, karşılaştırmayı
  // unutabilen bir satır uzaklıkta olurdu.
  const [row] = await db
    .select({
      orderNumber: orders.orderNumber,
      status: orders.status,
      amountKurus: orders.amountKurus,
      // `orders.payment_method` SEÇİLMİYOR: seçilmeyen kolon gövdeye giremez
      // (dosya başı, `/privacy` §5.1).
      paidAt: orders.paidAt,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
      trackingNumber: orders.trackingNumber,
      carrier: orders.carrier,
      quoteNumber: quotes.number,
      quoteTitle: quotes.title,
      // Parça listesinin ANAHTARI: dondurma siparişin KENDİ taslağından
      // okunacak (dosya başı).
      draftId: orders.draftId,
    })
    .from(quotes)
    .innerJoin(orders, eq(orders.id, quotes.orderId))
    .where(and(eq(quotes.teamId, membership.teamId), eq(orders.orderNumber, orderNumber)))
    .limit(1);
  if (!row) return orderNotFound();

  // Aynı teklifte birden çok tahsilat denemesi olabilir (süresi dolan taslak,
  // yöntem değişimi): dondurma SİPARİŞİN TASLAĞIYLA eşleştirilir, teklifin en
  // yeni satırıyla değil. `orders.draft_id` boşsa (teklif hattının dışında
  // kurulmuş bir sipariş) sorgu HİÇ açılmaz: `draft_id = NULL` zaten satır
  // döndürmezdi, ama sormamak niyeti de yazıyor.
  const [checkout] = row.draftId
    ? await db
        .select({ partsSnapshot: quoteCheckouts.partsSnapshot, leadDays: quoteCheckouts.leadDays })
        .from(quoteCheckouts)
        .where(eq(quoteCheckouts.draftId, row.draftId))
        .limit(1)
    : [];

  return NextResponse.json({
    order: {
      orderNumber: row.orderNumber,
      status: row.status,
      amountKurus: row.amountKurus,
      paidAt: row.paidAt,
      shippedAt: row.shippedAt,
      deliveredAt: row.deliveredAt,
      trackingNumber: row.trackingNumber,
      carrier: row.carrier,
      quoteNumber: row.quoteNumber,
      quoteTitle: row.quoteTitle,
      leadDays: checkout?.leadDays ?? null,
      parts: (checkout?.partsSnapshot ?? []).map(publicPart),
    },
  });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    return await teamRouteBody(() => handleGET(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "GET /api/customer/team/orders/[orderNumber]",
      CUSTOMER_READ_FAILED_ERROR
    );
  }
}
