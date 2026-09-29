export const dynamic = "force-dynamic";

import { ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";
import { listCatalogForAdmin, PrintCatalogError } from "@/lib/services/quote-catalog-admin";
import { CatalogClient } from "./catalog-client";

/**
 * `/admin/baski-katalogu` — anlık teklif motorunun BÜTÜN sayıları.
 *
 * Motorun fiyatladığı her değer buradan düzenlenir: teknoloji (makine saati,
 * kurulum, taban fiyat), malzeme (yoğunluk, gram fiyatı, renkler), yüzey işlemi,
 * ek hizmet ve tek satırlık fiyat/teslim politikası. Sahibin kalıcı yönü gereği
 * hiçbiri koda gömülü değildir; kodda olan tek şey ALGORİTMADIR.
 *
 * Okuma başarısız olursa sayfa ÇÖKMEZ, sebebini yazar: katalog okunamıyorsa
 * (migration uygulanmamış, ayar satırı yok) yöneticinin görmesi gereken şey
 * boş bir ekran değil, o cümledir.
 *
 * Arıza YUTULMAZ ve HAM HÂLİYLE DE YAZILMAZ — panel kabuğundaki `displayRead`
 * deseni (src/app/admin/layout.tsx): hata her hâlükârda etiketiyle günlüğe
 * geçer; ekrana çıkan cümle ise yalnız BEKLENEN retlerin metnidir (kataloğun
 * kendi `PrintCatalogError` cümlesi, örn. "ayar satırı yok — migration
 * uygulanmamış olabilir"). Beklenmeyen bir arızanın ham `message`ı (bağlantı
 * dizgisi, SQL parçası, İngilizce sürücü metni) yöneticinin ekranına ait
 * değildir; onun yerine evin tek cümlesi yazılır.
 */
export default async function AdminPrintCatalogPage() {
  let catalog: Awaited<ReturnType<typeof listCatalogForAdmin>> | null = null;
  let readError: string | null = null;
  try {
    catalog = await listCatalogForAdmin();
  } catch (e) {
    console.error("[admin panel] baskı kataloğu okunamadı", e);
    readError = e instanceof PrintCatalogError ? e.message : ADMIN_READ_FAILED_ERROR;
  }

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Baskı kataloğu ve fiyat ayarları</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Anlık teklif motorunun fiyatladığı <strong>her sayı</strong> burada. Kayıtlar
        silinmez, <strong>pasifleştirilir</strong>: açık teklifler kendi anlık
        görüntüsüyle bağlayıcı kalır, yeni teklifler yalnız aktif satırları görür.
        Her kayıt denetim izine yazılır.
      </p>

      {readError ? (
        <div className="mt-6 max-w-3xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {readError}
        </div>
      ) : catalog ? (
        <CatalogClient
          technologies={catalog.technologies.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }))}
          materials={catalog.materials.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }))}
          finishes={catalog.finishes.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }))}
          addons={catalog.addons.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }))}
          settings={{ ...catalog.settings, updatedAt: catalog.settings.updatedAt.toISOString() }}
          changes={catalog.changes.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
          }))}
        />
      ) : null}
    </div>
  );
}
