import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { coverageOverrides, manufacturers } from "@/lib/db/schema";
import { isKnownProvince } from "@/lib/validators/network-map";
import { COVERAGE_MATERIALS } from "@/lib/services/coverage-plan";
import {
  handleRouteFailure,
  ADMIN_ACTION_FAILED_ERROR,
} from "@/lib/api/route-error";

/**
 * ETKİ ALANI MÜDAHALELERİ — yöneticinin hesaba koyduğu PİN ve DIŞLAMA.
 *
 * Bu uç PLANI YAZMAZ, yalnızca müdahaleyi kaydeder: plan her okumada
 * `services/coverage-plan.ts` içinde YENİDEN hesaplanır. Hesabın çıktısını
 * tabloya yazmak, saatler içinde gerçekle ayrışan ikinci bir kopya demekti
 * (atölye kapasitesi dolduğunda ya da adresi değiştiğinde donmuş kalırdı).
 *
 * PUT    = hücreyi (il + malzeme) pinle ya da dışla — varsa ÜSTÜNE yazar.
 * DELETE = müdahaleyi kaldır, hücre hesaba geri döner.
 *
 * Hücre başına tek satır kuralı DB'de (`coverage_overrides_il_material_idx`):
 * uygulama katmanı "önce sil sonra yaz" yapsaydı iki eşzamanlı istek aynı
 * hücrede iki satır bırakabilirdi ve hesap hangisini okuyacağını bilemezdi.
 */

const overrideBodySchema = z.object({
  il: z.string(),
  material: z.string(),
  kind: z.enum(["pin", "exclude"]),
  /** Yalnız pin için; dışlamada yok sayılır. */
  manufacturerId: z.string().uuid().nullish(),
  note: z.string().max(200).nullish(),
});

const clearBodySchema = z.object({
  il: z.string(),
  material: z.string(),
});

/** İl + malzeme doğrulaması — iki uç da aynı cümleleri kullanır. */
function validateCell(
  il: string,
  material: string
): { ok: true } | { ok: false; error: string } {
  if (!isKnownProvince(il)) return { ok: false, error: "Bilinmeyen il." };
  if (!(COVERAGE_MATERIALS as readonly string[]).includes(material)) {
    return { ok: false, error: "Bilinmeyen malzeme." };
  }
  return { ok: true };
}

export async function PUT(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = overrideBodySchema.safeParse(
      await request.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }
    const { il, material, kind, note } = parsed.data;
    const cell = validateCell(il, material);
    if (!cell.ok) return NextResponse.json({ error: cell.error }, { status: 400 });

    // Pin bir ATÖLYEYE yapılır: id'siz bir pin, hesabı kimseye bağlamadan
    // devre dışı bırakırdı (il ne pinli ne hesaplanmış olurdu).
    let manufacturerId: string | null = null;
    if (kind === "pin") {
      if (!parsed.data.manufacturerId) {
        return NextResponse.json(
          { error: "Pin için üretici seçilmeli." },
          { status: 400 }
        );
      }
      const shop = await db.query.manufacturers.findFirst({
        where: eq(manufacturers.id, parsed.data.manufacturerId),
        columns: { id: true, status: true },
      });
      if (!shop) {
        return NextResponse.json({ error: "Üretici bulunamadı." }, { status: 404 });
      }
      // Aktif olmayan atölyeye pin, var olmayan bir sorumludur: plan onu
      // listesinde bulamaz ve il sessizce hesaba düşer. Baştan reddetmek,
      // yöneticiye kaydettiği şeyin çalışmadığını SONRA fark ettirmekten iyidir.
      if (shop.status !== "active") {
        return NextResponse.json(
          { error: "Yalnız aktif üretici pinlenebilir." },
          { status: 400 }
        );
      }
      manufacturerId = shop.id;
    }

    const now = new Date();
    await db
      .insert(coverageOverrides)
      .values({
        il,
        material,
        kind,
        manufacturerId,
        note: note ?? null,
        createdBy: a.session.user.email,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [coverageOverrides.il, coverageOverrides.material],
        set: {
          kind,
          manufacturerId,
          note: note ?? null,
          // `created_by` DEĞİŞİR: satır "bu hücrede şu an geçerli karar"dır ve
          // o kararın sahibi son yazandır. İlk yazanı korumak, kararı değiştiren
          // kişiyi denetim dışında bırakırdı.
          createdBy: a.session.user.email,
          updatedAt: now,
        },
      });

    // Ekran planı yeniden hesaplatmak için sunucuya döner (istemci planı ASLA
    // kendi hesaplamaz — ikinci kopya bu fazın kapattığı kusurdur).
    revalidatePath("/admin/coverage");
    // Anasayfa haritası da AYNI planı okur (`services/network-map.ts`) ve
    // `app/page.tsx` onu `revalidate = 60` ile önbellekler: bu satır olmasa
    // yöneticinin pini/dışlaması public haritaya bir dakikaya kadar gecikmeyle
    // düşer ve "kaydettim ama hiçbir şey olmadı" diye görünürdü.
    revalidatePath("/");

    return NextResponse.json({ success: true, il, material, kind, manufacturerId });
  } catch (e) {
    return handleRouteFailure(e, "PUT /api/admin/coverage", ADMIN_ACTION_FAILED_ERROR);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = clearBodySchema.safeParse(
      await request.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }
    const { il, material } = parsed.data;
    const cell = validateCell(il, material);
    if (!cell.ok) return NextResponse.json({ error: cell.error }, { status: 400 });

    // Silinecek satır yoksa bu bir HATA DEĞİL: hücre zaten hesapta demektir ve
    // istenen son durum sağlanmıştır (tekrar çalıştırılabilir).
    await db
      .delete(coverageOverrides)
      .where(
        and(eq(coverageOverrides.il, il), eq(coverageOverrides.material, material))
      );

    revalidatePath("/admin/coverage");
    // Müdahaleyi KALDIRMAK da planı değiştirir; anasayfa aynı sebeple tazelenir.
    revalidatePath("/");

    return NextResponse.json({ success: true, il, material });
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/admin/coverage", ADMIN_ACTION_FAILED_ERROR);
  }
}
