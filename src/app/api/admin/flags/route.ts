import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { FLAG_KEYS, isFlagKey, killAllEngaged, type FlagKey } from "@/lib/config/flags";
import { getAllFlags, setFlag } from "@/lib/services/flags";

/**
 * Özellik bayraklarının TEK yazma ucu.
 *
 * Bugüne kadar `platform_flags` tablosuna yalnız `spend-guard.ts` yazıyordu;
 * bir anahtarı açmak için veritabanına elle girmek gerekiyordu. Anlık teklif
 * motorunun müşteriye açılması (`instant_quote_enabled`) bir DAĞITIM olayı
 * değil bir SAHİP kararıdır — o kararın bir düğmesi olmalı.
 *
 * `AI_KILL_ALL` cevabın içinde ayrıca bildirilir: kill switch açıkken harcama
 * anahtarları DB'de "açık" yazsa bile kapalı davranır, ve ekran bunu
 * söylemezse yönetici kapalı bir anahtarı boşuna açmaya çalışır.
 */
const updateSchema = z.object({
  key: z.string().refine(isFlagKey, "Bilinmeyen bayrak anahtarı."),
  enabled: z.boolean(),
});

export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    return NextResponse.json({
      flags: await getAllFlags(),
      keys: FLAG_KEYS,
      killAllEngaged: killAllEngaged(),
    });
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/flags", ADMIN_READ_FAILED_ERROR);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek.", code: "invalid_body" },
        { status: 400 }
      );
    }

    const key = parsed.data.key as FlagKey;
    await setFlag(key, parsed.data.enabled, a.session.user.email);

    return NextResponse.json({
      success: true,
      key,
      enabled: parsed.data.enabled,
      // Yazım geçti ama DAVRANIŞ değişmeyebilir: kill switch harcama
      // anahtarlarını çalışma anında kapatıyor. Ekran bunu söylemeli.
      killAllEngaged: killAllEngaged(),
    });
  } catch (e) {
    return handleRouteFailure(e, "PUT /api/admin/flags", ADMIN_ACTION_FAILED_ERROR);
  }
}
