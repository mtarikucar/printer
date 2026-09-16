import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { deleteEmptyPayout } from "@/lib/services/payouts";
import { deleteEmptyPainterPayout } from "@/lib/services/painter-payouts";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * HİÇBİR HAK EDİŞ TUTMAYAN bekleyen ödeme partisini kuyruktan siler.
 *
 * NEDEN VAR: "Ödendi işaretle" artık tuttuğu parayı söylemeyen partiyi
 * reddediyor (mark-paid). Ret tek başına bırakılırsa, yarışın geride bıraktığı
 * hayalet parti kuyrukta ÇIKIŞSIZ kalırdı: ekran onu listeler, tek denetimi de
 * onu reddeder. Ekranın sunduğu her denetimin cevap veren bir ucu olmalı —
 * silme o cevaptır.
 *
 * KAPSAM BİLEREK DAR: yalnız `pending` ve ARKASINDA TEK SATIR OLMAYAN parti
 * silinir. Para tutan bir parti asla silinmez (hakedişler partisiz kalmasın,
 * geçmiş kaybolmasın); ödenmiş parti hiç silinmez. Silme iki kaynağı temizler:
 * (1) düzeltmeden önceki yarışın bıraktığı hayalet partiler, (2) bütün
 * hakedişleri iade yüzünden geri alınmış, içi boşalmış partiler.
 */
const schema = z.object(
  {
    kind: z
      .enum(["manufacturer", "painter"], {
        error: "Ödeme türü üretici ya da boyacı olmalı.",
      })
      .optional(),
  },
  { error: "Geçersiz istek." }
);
const NOT_FOUND = "Ödeme bulunamadı ya da zaten silinmiş.";
const ALREADY_PAID = "Bu ödeme partisi ödendi olarak işaretlenmiş; silinemez.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hasEarningsMessage = (heldCount: number) =>
  `Bu parti ${heldCount} hak ediş tutuyor; silinemez. Yalnızca arkasında tek bir hak ediş kalmamış parti kuyruktan kaldırılabilir.`;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." },
        { status: 400 }
      );
    }
    const kind = parsed.data.kind;

    // Aynı id uzayı iki tabloyu kapsar; `kind` gelmezse önce üretici, sonra
    // boyacı tablosuna bakılır (mark-paid ile aynı kalıp).
    if (kind !== "painter") {
      const result = await deleteEmptyPayout(id);
      if (result.ok) return NextResponse.json({ success: true });
      if (result.reason === "has_earnings") {
        return NextResponse.json({ error: hasEarningsMessage(result.heldCount) }, { status: 409 });
      }
      if (result.reason === "already_paid") {
        return NextResponse.json({ error: ALREADY_PAID }, { status: 409 });
      }
    }

    if (kind !== "manufacturer") {
      const painterResult = await deleteEmptyPainterPayout(id);
      if (painterResult.ok) return NextResponse.json({ success: true });
      if (painterResult.reason === "has_earnings") {
        return NextResponse.json(
          { error: hasEarningsMessage(painterResult.heldCount) },
          { status: 409 }
        );
      }
      if (painterResult.reason === "already_paid") {
        return NextResponse.json({ error: ALREADY_PAID }, { status: 409 });
      }
    }

    return NextResponse.json({ error: NOT_FOUND }, { status: 400 });
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/admin/payouts/[id]", ADMIN_ACTION_FAILED_ERROR);
  }
}
