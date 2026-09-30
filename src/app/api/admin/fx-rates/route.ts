import { NextResponse } from "next/server";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  FX_FAILURE_LABELS_TR,
  loadFxAdminOverview,
  refreshFxRates,
} from "@/lib/services/fx-rates";
import { loadActiveSnapshot } from "@/lib/services/quote-catalog";

/**
 * TCMB kurunun tek operatör ucu: `GET` son kurları + bülten tarihini + bayat
 * olup olmadığını okur, `POST` bülteni ŞİMDİ çeker.
 *
 * `POST` KUYRUĞA DOKUNMAZ, `refreshFxRates()`i doğrudan çağırır — ve bu bir
 * incelik değil, bir tuzağın kapatılmasıdır. Otomatik turun iş kimliği GÜN
 * anahtarıdır (`fx-refresh-<YYYY-AA-GG>`, `quote-queues.ts`), bullmq ise
 * SAKLANAN bir işin kimliğiyle gelen ikinci eklemeyi hata vermeden YUTAR ve
 * `removeOnComplete: { count: 500 }` yüzünden günün işi saatlerce saklanır.
 * Kuyruk yolu seçilseydi aynı gün ikinci "Şimdi çek" SESSİZCE hiçbir şey
 * yapmaz, ekran ise "başladı" derdi. Doğrudan çağrının ikinci faydası:
 * operatör sonucu AYNI istekte görür.
 *
 * `POST` bayrağa BAKMAZ (işçi bakar): operatör `quote_fx_display_enabled`i
 * açmadan önce TCMB erişimini doğrulayabilmeli.
 *
 * Tatil listesi `quote_pricing_settings.holidays`ten gelir (aktif katalog
 * snapshot'ı); bayatlık ölçüsü İŞ GÜNÜ cinsindendir ve ikinci bir takvim
 * yoktur. Bu yalnız bir OKUMADIR — hiçbir `updated_at`e dokunmaz, yani açık
 * tekliflerde "Katalog güncellendi" bandını yakmaz.
 */
async function overview() {
  const snapshot = await loadActiveSnapshot();
  return loadFxAdminOverview(snapshot.settings.holidays);
}

export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    return NextResponse.json(await overview());
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/fx-rates", ADMIN_READ_FAILED_ERROR);
  }
}

export async function POST() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    // Gövde YOK: tur parametresizdir (hangi bülten çekileceğini TCMB belirler).
    // Bu yüzden doğrulanacak bir şema da yok.
    const outcome = await refreshFxRates();
    if (!outcome.ok) {
      // Beklenen bir ret: TCMB erişilemedi ya da bülten reddedildi. Satır
      // YAZILMADI, son geçerli kur yerinde kaldı — cevap bunu söyler.
      return NextResponse.json(
        {
          error: `${FX_FAILURE_LABELS_TR[outcome.reason]} Son geçerli kur yerinde kaldı.`,
          code: `fx_${outcome.reason}`,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      success: true,
      bulletinDate: outcome.bulletinDate,
      insertedRows: outcome.insertedRows,
      ...(await overview()),
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/fx-rates", ADMIN_ACTION_FAILED_ERROR);
  }
}
