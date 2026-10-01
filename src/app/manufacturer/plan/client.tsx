"use client";

/**
 * `/manufacturer/plan` — atölyeye İLERİYE DÖNÜK planlanmış partiler.
 *
 * ─── YALNIZ GÖSTERİM, KAPI DEĞİL ───────────────────────────────────────────
 *
 * Bu ekran hiçbir yerde atama reddetmez ve hiçbir düğmesi yok. Planlanmış bir
 * parti tezgâhta yer KAPLAMAZ, çünkü ortada sipariş yoktur: yük ancak parti
 * serbest bırakılıp ödendiğinde doğar. Kapasitenin tek ölçüsü
 * `manufacturer-capacity.ts`in `loadUnits` KAPISIdır
 * (`boyaci-kapasite-olcusu.md` kararı: bir ekran, ucun uygulamadığı bir ölçüyle
 * kimseyi kapatamaz) — buradaki `loadUnits` okunabilir bir SAYIdır, eşik değil.
 *
 * ─── KAPASİTE SERVİSİ IMPORT EDİLMEZ ──────────────────────────────────────
 *
 * `manufacturer-capacity.ts` `@/lib/db`yi çekiyor, yani `pg`yi istemci
 * paketine sürüklerdi; depo geneli tarayıcı
 * (`scripts/test-manufacturer-capacity.ts`) bir istemci bileşeninde o modülün
 * ADINI bile görürse haklı olarak düşürür. Gösterilecek her sayı SUNUCUDAN
 * hazır iner.
 *
 * ─── FİYAT VE MÜŞTERİ KİMLİĞİ YOK ──────────────────────────────────────────
 *
 * Satırlar yalnız tarih, birim ve anlaşma numarası taşır. `…Kurus` ile biten
 * hiçbir alan yoktur, çünkü burada hiç tutar yok.
 */
import type { JSX } from "react";
import { formatDate } from "@/lib/i18n/format";
import type {
  FrameworkForwardLoad,
  ManufacturerPlannedBatch,
} from "@/lib/services/quote-framework";

export function ManufacturerPlanClient({
  batches,
  forwardLoad,
  unreadable,
}: {
  batches: ManufacturerPlannedBatch[];
  /** Pencere özeti; `null` = okunamadı (sıfır DEĞİL). */
  forwardLoad: FrameworkForwardLoad | null;
  /** Parti listesi okunamadı mı — "liste boş" ile AYNI ekran olamaz. */
  unreadable: boolean;
}): JSX.Element {
  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900">Çerçeve parti planı</h1>
      <p className="mt-2 max-w-2xl text-sm text-gray-600">
        Size çapalanmış çerçeve anlaşmalarda İLERİYE DÖNÜK planlanmış partiler.
        Bu bir iş listesi DEĞİLDİR: planlanmış parti tezgâhınızda yer kaplamaz ve
        hiçbir adım beklemez. Her parti serbest bırakılıp ödendiğinde size KENDİ
        siparişi olarak düşer ve &quot;Siparişler&quot; sayfasında görünür.
      </p>

      {unreadable && (
        <p
          role="alert"
          className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          Parti planı şu anda okunamıyor (geçici sistem arızası). Liste boş olarak
          DOĞRULANMADI; birkaç dakika sonra sayfayı yenileyin.
        </p>
      )}

      {forwardLoad && (
        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          <Figure
            label={`Pencere · ${formatDate(forwardLoad.fromDate, "tr")} – ${formatDate(forwardLoad.toDate, "tr")}`}
            value={`${forwardLoad.batchCount} parti`}
          />
          <Figure label="Planlanan birim" value={`${forwardLoad.units} birim`} />
          <Figure
            label="Ağırlıklı yük (gösterim)"
            value={`${forwardLoad.loadUnits} birim`}
          />
        </dl>
      )}

      {!unreadable && batches.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">
          Size çapalanmış bir çerçeve anlaşmada planlı parti yok.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                <th className="py-2 pr-3">Planlanan sevk</th>
                <th className="py-2 pr-3">Anlaşma</th>
                <th className="py-2 pr-3">Parti</th>
                <th className="py-2 pr-3 text-right">Birim</th>
                <th className="py-2 text-right">Ağırlıklı yük</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batches.map((batch) => (
                <tr key={batch.batchId}>
                  <td className="py-2 pr-3 text-gray-900">
                    {formatDate(batch.plannedShipDate, "tr")}
                  </td>
                  <td className="py-2 pr-3 font-mono text-gray-700">
                    {batch.frameworkNumber}
                  </td>
                  <td className="py-2 pr-3 text-gray-700">{batch.position}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-gray-900">
                    {batch.units}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-500">
                    {batch.loadUnits}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        &quot;Ağırlıklı yük&quot; bir okuma kolaylığıdır, bir EŞİK değil: işin
        tezgâha düşüp düşmeyeceğine kapasite kapısı karar verir ve o kapı yalnız
        ÖDENMİŞ siparişleri sayar.
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{value}</dd>
    </div>
  );
}
