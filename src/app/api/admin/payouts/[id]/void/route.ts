import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { voidPayout } from "@/lib/services/payouts";
import { voidPainterPayout } from "@/lib/services/painter-payouts";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";
import { payoutVoidSchema, payoutFailure } from "../../_contract";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Ödeme partisi bulunamadı." }, { status: 404 });
    const parsed = payoutVoidSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "İptal için güncel parti onayı, işlem anahtarı ve en az 10 karakterlik gerekçe gereklidir." }, { status: 400 });
    const { kind, ...fields } = parsed.data;
    const input = { ...fields, adminEmail: a.session.user.email };
    const result = kind === "manufacturer" ? await voidPayout(id, input) : await voidPainterPayout(id, input);
    if (!result.ok) {
      const failure = payoutFailure(result);
      return NextResponse.json(failure.body, { status: failure.status });
    }
    return NextResponse.json({ ok: true, replayed: result.replayed, message: "Bekleyen parti iptal edildi; kayıt ve gerekçe korundu. Bağlı bekleyen satırlar partiden çıkarıldı, yeniden ödenebilirlik kontrolüne tabidir." });
  } catch (error) {
    return handleRouteFailure(error, "POST /api/admin/payouts/[id]/void", ADMIN_ACTION_FAILED_ERROR);
  }
}
