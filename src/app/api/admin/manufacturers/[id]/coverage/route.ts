import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { coverageBodySchema, normalizeCoverage } from "@/lib/validators/network-map";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Üreticinin etki alanı (sorumlu olduğu iller) ve harita görünürlüğü.
 *
 * Gövde KISMİDİR: listedeki göz düğmesi yalnız `mapVisible` gönderir. Kapsama
 * zorunlu olsaydı görünürlüğü değiştiren istek o partnerin tüm il dizisini geri
 * yollamak zorunda kalır, başka bir sekmede kaydedilmemiş bir düzenleme varsa
 * sessizce ezerdi.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    const parsed = coverageBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }

    const existing = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, id),
      columns: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Üretici bulunamadı" }, { status: 404 });
    }

    // Yalnız gönderilen alanlar yazılır — kısmi gövdenin karşılığı.
    const patch: Partial<typeof manufacturers.$inferInsert> = { updatedAt: new Date() };
    let coverage: string[] | undefined;
    if (parsed.data.coverageProvinces !== undefined) {
      // Sunucu, istemcinin gönderdiğine güvenmez: aynı normalizasyon burada da
      // çalışır (bilinmeyen il elenir, tekrar temizlenir, sıra sabitlenir).
      coverage = normalizeCoverage(parsed.data.coverageProvinces);
      patch.coverageProvinces = coverage;
    }
    if (parsed.data.mapVisible !== undefined) patch.mapVisible = parsed.data.mapVisible;

    await db.update(manufacturers).set(patch).where(eq(manufacturers.id, id));

    // Anasayfa ISR'li (revalidate = 60); bunu çağırmazsak admin kaydettikten
    // sonra değişikliği bir dakikaya kadar göremez.
    revalidatePath("/");

    return NextResponse.json({ success: true, coverageProvinces: coverage });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/admin/manufacturers/[id]/coverage", ADMIN_ACTION_FAILED_ERROR);
  }
}
