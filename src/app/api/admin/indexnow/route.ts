import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  announceStaticPages,
  loadIndexNowPageStatus,
  type AnnounceScope,
} from "@/lib/services/indexnow-pages";

/**
 * IndexNow duyurusunun tek operatör ucu: `GET` durumu okur, `POST` ŞİMDİ
 * gönderir.
 *
 * `POST` KUYRUĞA DOKUNMAZ, `announceStaticPages()`i doğrudan çağırır — emsal
 * `/api/admin/fx-rates` ve gerekçe aynı: operatör sonucu AYNI istekte görmeli
 * ("kaç sayfa gönderildi", "anahtar yok"). Kuyruk yolu seçilseydi ekran
 * "başladı" der, sonuç ise bir worker günlüğünde kalırdı. Tur kısa (tek HTTP
 * çağrısı, 8 sn zaman aşımı) ve bu yüzden bir istek içinde beklenebilir.
 *
 * `POST` bir bayrağa bakmaz: bu bir satış yüzeyi değil, bir operasyon aracı.
 * Anahtar yoksa gönderim yapılmaz ve cevap bunu AÇIKÇA söyler (`reason`),
 * çünkü sessiz bir `no_key` operatörü iş yaptığına inandırırdı.
 */
function isScope(value: unknown): value is AnnounceScope {
  return value === "changed" || value === "all";
}

export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    return NextResponse.json(await loadIndexNowPageStatus());
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/indexnow", ADMIN_READ_FAILED_ERROR);
  }
}

export async function POST(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const body = (await request.json().catch(() => ({}))) as { scope?: unknown };
    // Varsayılan "all": düğmeden gelen gövdesiz bir istek ELLE tetiktir ve elle
    // tetiğin işi kümenin tamamını duyurmaktır (ilk kayıt / içerik turu).
    const scope: AnnounceScope = body.scope === undefined ? "all" : body.scope as AnnounceScope;
    if (!isScope(scope)) {
      return NextResponse.json(
        { error: "Geçersiz kapsam (beklenen: \"changed\" ya da \"all\")", code: "bad_scope" },
        { status: 400 }
      );
    }

    const outcome = await announceStaticPages({ scope });
    // Durum HER İKİ durumda da yeniden okunur: başarısız bir gönderimden sonra
    // da ekran gerçeği göstermeli (bekleyen sayfa listesi değişmemiş olacak).
    return NextResponse.json({
      outcome,
      status: await loadIndexNowPageStatus(),
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/indexnow", ADMIN_ACTION_FAILED_ERROR);
  }
}
