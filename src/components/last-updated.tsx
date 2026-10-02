import { pageUpdatedAt } from "@/lib/config/page-updated";
import { formatDateLong } from "@/lib/i18n/format";
import { defaultLocale, type Locale } from "@/lib/i18n/types";

/**
 * Ticari bir sayfanın GÖRÜNÜR "son güncelleme" satırı.
 *
 * Tarih `PAGE_UPDATED_AT`ten gelir, `new Date()`ten GELMEZ — gerekçesi
 * `src/lib/config/page-updated.ts` başlığında. Etiketin kendisi sözlüğe
 * girmedi: aynı cümle on hukuki sayfada zaten `isTr ? "Son güncelleme: …"`
 * kalıbıyla yazılı (`kargo`, `iade`, `privacy`, …) ve o kalıba uymak, tek
 * cümle için yeni bir sözlük anahtarı açmaktan tutarlı.
 *
 * `<time dateTime>` bilerek var: insana Türkçe uzun tarihi, makineye ISO
 * tarihi aynı düğümden vermek bu satırın bütün amacı.
 *
 * Saf bileşen — hook yok, `"use client"` yok: sunucu sayfaları (`/figur`,
 * `/shop`, `/nasil-calisir`) ve istemci sayfaları (`/urunler`) aynı düğümü
 * çizsin.
 */
export function LastUpdated({
  path,
  locale = defaultLocale,
  className,
}: {
  /** Sitemap yazımıyla aynı yol ("" ya da "/" anasayfa). */
  path: string;
  /**
   * Dili ÇAĞIRAN verir ve vermeyebilir. Sebebi somut: `/` ve `/3d-baski`
   * `revalidate` ile koşuyor ve ikisinin de başlığı "bu sayfa çerez OKUMAZ"
   * diyor (`/3d-baski`: admin oturumu yalnız bayrak kapalıyken sorulur).
   * `getLocale()` bir `cookies()` okumasıdır; bu satır için oraya ikinci bir
   * okuma eklemek, o sayfaların statik üretilebilirliğini kalıcı olarak
   * kapatırdı. Dili zaten okuyan sayfalar (`/figur`, `/nasil-calisir`,
   * `/shop`) prop'u geçer; geçmeyenler varsayılan dili alır — bugün tek etkin
   * dil Türkçe olduğu için çıktı da aynı (`enabledLocales = ["tr"]`).
   */
  locale?: Locale;
  className?: string;
}) {
  const iso = pageUpdatedAt(path);
  // Listede olmayan bir yol satırı hiç çizmez: boş ya da uydurma bir tarih
  // yazmak, tarih yazmamaktan kötüdür.
  if (!iso) return null;

  // Günün ortası UTC: `formatDateLong` Europe/Istanbul'a çeviriyor (bkz.
  // APP_TIME_ZONE) ve gece yarısı UTC alınsaydı tarih kayma riski taşırdı.
  const label = formatDateLong(new Date(`${iso}T12:00:00Z`), locale);

  return (
    <p
      className={
        className ??
        "mx-auto max-w-6xl px-4 pb-10 text-center text-xs text-text-muted"
      }
    >
      {locale === "tr" ? "Son güncelleme: " : "Last updated: "}
      <time dateTime={iso}>{label}</time>
    </p>
  );
}
