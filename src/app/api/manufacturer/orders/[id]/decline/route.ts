import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { declineOrder } from "@/lib/services/manufacturer-decline";
import { rateLimitAsync } from "@/lib/services/rate-limit";

const declineSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

async function handleDecline(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json(
      { error: "Your account is not active" },
      { status: 403 }
    );
  }

  // Per-manufacturer rate limit. A misbehaving client shouldn't be able to
  // hammer the decline endpoint and storm-reassign a fleet of orders.
  const rl = await rateLimitAsync(
    `manufacturer:decline:${session.manufacturerId}`,
    20,
    60 * 60 * 1000
  );
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = declineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await declineOrder({
    orderId: id,
    manufacturerId: session.manufacturerId,
    reason: parsed.data.reason,
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "not_yours"
          ? 403
          : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({
    success: true,
    action: result.action,
    ...(result.action === "reassigned"
      ? {}
      : { reason: result.reason }),
    // `released` = sipariş iade edilmişti, ret yalnız koparma oldu. Üreticiye
    // "başka bir üreticiye yönlendirilecek" ya da "admin atayacak" demek burada
    // yalan olurdu; ceza da yazılmadığı için onu da söylüyoruz
    // (manufacturer-decline.ts, iade dalı).
    ...(result.action === "released"
      ? {
          message:
            "Bu sipariş iade edilmiş. İşi reddettiniz ve sipariş panelinizden düştü; " +
            "başka bir üreticiye yönlendirilmeyecek ve bu ret güvenilirlik puanınıza işlenmedi.",
        }
      : {}),
  });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap.
 *
 * Kabul/iptal ikizlerinde ölçülen hâl burada da açıktı: bir okuma ya da ret
 * işlemi fırlarsa Next'in varsayılan 500'üne düşülüyor ve atölye paneline SIFIR
 * BAYT gidiyordu — panel o zaman kendi yedek cümlesini ("İşlem tamamlanamadı
 * (HTTP 500)") gösterir, yani ekranda ne olduğuna dair tek kelime yoktur.
 *
 * Cümle İKİYE BÖLÜNMÜYOR, çünkü bu uçta iki hâli dürüstçe ayıramayız: ret,
 * servisin (manufacturer-decline.ts) kilitli işleminde yazılır ve rota,
 * fırlayan hatanın o işlemden ÖNCE mi sonra mı geldiğini bilemez. Bu yüzden
 * cümle atölyeye BAKILACAK YERİ söyler: listede duruyorsa ret yazılmamıştır ve
 * tekrar denenebilir, düşmüşse ret alınmıştır. Uydurulmuş bir kesinlik
 * ("işleminiz alınamadı"), olmuş bir reddi ikinci kez denettirirdi.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    return await handleDecline(request, ctx);
  } catch (e) {
    console.error("üretici reddi: beklenmeyen hata", e);
    return NextResponse.json(
      {
        error:
          "Beklenmeyen bir hata nedeniyle ret işlemi tamamlanamadı. Sipariş listenizi yenileyin: sipariş hâlâ listenizdeyse ret kaydedilmemiştir ve birkaç dakika sonra tekrar deneyebilirsiniz; listeden düştüyse ret alınmıştır ve yapmanız gereken bir şey yok.",
        reason: "unexpected_error",
      },
      { status: 500 }
    );
  }
}
