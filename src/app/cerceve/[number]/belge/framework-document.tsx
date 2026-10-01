import type { JSX } from "react";
import { fill } from "@/components/quote/format";
import {
  BUSINESS_ADDRESS_FULL,
  BUSINESS_LEGAL_NAME,
  BUSINESS_TAX_ID,
} from "@/lib/config/business-identity";
import { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY } from "@/lib/config/contact";
import { FRAMEWORK_TERMS_VERSION } from "@/lib/config/quote-framework";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency, formatDateLong } from "@/lib/i18n/format";
import type { PresentedFramework } from "@/lib/services/quote-framework-present";
import { BATCH_STATUS_DICT_KEYS } from "../framework-values";

/**
 * Yazdırılabilir ÇERÇEVE ANLAŞMA BELGESİ / proforması.
 *
 * `/teklif/[number]/belge/quote-document.tsx`in KARDEŞİDİR, kopyası değil:
 * biçim (A4 kâğıt, `.quote-doc*` sınıfları, `belge.css`) paylaşılır, içerik
 * paylaşılmaz. O dosyaya DOKUNULMADI — bir teklif ile bir çerçeve anlaşmanın
 * zorunlu içerikleri AYRIDIR (tasarım §10 madde 2) ve tek bileşene iki hukukî
 * metin sığdırmak, ikisini de yarım anlatmaktı.
 *
 * ─── KÂĞIT, EKRAN DEĞİL ────────────────────────────────────────────────────
 *
 * Uygulamanın kart gölgeleri ve tema renkleri buraya girmez: belge koyu temada
 * da beyaz kâğıt üstünde siyah mürekkeptir (renkler `belge.css` içinde
 * `.quote-doc` kapsamında sabit). Müşteri bunu satın alma birimine iletecek.
 *
 * ─── ZORUNLU İÇERİK (tasarım §10 madde 2, hukuk) ───────────────────────────
 *
 * Taahhüt edilen adet · birim fiyatlar KDV DAHİL (KDV hariç taban da yazılı) ·
 * fiyat geçerlilik tarihi · parti planı ve her partinin AYRI faturalandırılıp
 * AYRI ödendiği · serbest bırakılmamış partilerin ücretsiz iptal edilebileceği
 * ve bu durumda fiyat kilidinin DÜŞTÜĞÜ · serbest bırakılmış partinin siparişe
 * özel üretim olduğu ve CAYMA HAKKI İSTİSNASINA girdiği · teslim tarihlerinin
 * İŞ GÜNÜ üzerinden hesaplandığı · şartların sürümü ve kabul tarihi.
 *
 * ─── EKRANIN SÖYLEDİĞİ = TESTİN KANITLADIĞI ────────────────────────────────
 *
 * Beş cümle AYNEN kodun bir kuralına karşılık gelir ve sözlükten gelir:
 * `.priceLockedUntil` / `.lockExpired` (fiyat kilidi), `.tryBindingFxApprox`
 * (₺ donar, kur donmaz), `.perBatchBilling` (`addonLines` çarpanı parti
 * başına), `.warningsPerBatch` (`dfm_ack_key` klona kopyalanmaz).
 * `scripts/test-quote-ui.ts` hem bu belgeyi render edip cümleleri arar hem
 * cümlelerin sözlükte AYNEN durduğunu pinler.
 *
 * ─── SÖZLÜK BİR PROP, KANCA DEĞİL ──────────────────────────────────────────
 *
 * `"use client"` YOK ve `useDictionary` kullanılmaz: belge etkileşimsizdir
 * (tek "uygulama" parçası yazdır düğmesi, o ayrı bir istemci bileşeni). Sözlüğü
 * prop olarak almak hem istemci paketini büyütmez hem testin bu bileşeni
 * doğrudan render etmesini sağlar.
 *
 * ─── HAVALE BLOĞU YOK (bilerek) ────────────────────────────────────────────
 *
 * Teklif belgesi banka bilgilerini yazar, çünkü ödenecek TEK bir tutar var.
 * Çerçevede ödeme PARTİ BAŞINADIR: anlaşma toplamı için IBAN yazmak, müşteriyi
 * hiçbir zaman istenmeyecek bir tutarı havale etmeye çağırmak olurdu. Her
 * partinin kendi ödeme sayfası ve kendi referansı var.
 */
export function FrameworkDocument({
  framework,
  d,
}: {
  framework: PresentedFramework;
  d: Dictionary;
}): JSX.Element {
  const showPrices = framework.viewer.canSeePrices;
  const lockDate = formatDateLong(framework.priceLockedUntil, "tr");

  return (
    <article className="quote-doc">
      {/* ── Kimlik ────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-[95mm]">
          <p className="text-lg font-semibold tracking-tight">{BUSINESS_LEGAL_NAME}</p>
          <p className="quote-doc__muted mt-1 text-xs leading-relaxed">
            {BUSINESS_ADDRESS_FULL}
            <br />
            {d["instantQuote.document.taxId"]} {BUSINESS_TAX_ID}
            <br />
            {CONTACT_EMAIL} · {CONTACT_PHONE_DISPLAY}
          </p>
        </div>

        <div className="text-right">
          <p className="quote-doc__muted text-xs">
            {d["instantQuote.framework.documentTitle"]}
          </p>
          <p className="font-mono text-xl font-semibold tracking-tight">
            <span className="quote-doc__muted mr-1.5 font-sans text-xs font-normal">
              {d["instantQuote.framework.doc.number"]}
            </span>
            {framework.number}
          </p>
          <dl className="mt-2 space-y-0.5 text-xs">
            <div className="flex justify-end gap-2">
              <dt className="quote-doc__muted">{d["instantQuote.document.issuedAt"]}</dt>
              <dd>{formatDateLong(framework.createdAt, "tr")}</dd>
            </div>
            <div className="flex justify-end gap-2">
              <dt className="quote-doc__muted">
                {d["instantQuote.framework.sourceQuote"]}
              </dt>
              <dd className="font-mono">{framework.quoteNumber}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="quote-doc__rule my-5" />

      {/* ── Taraf ve anlaşma bilgileri ────────────────────────────────── */}
      <section className="grid gap-6 text-xs sm:grid-cols-2">
        <div>
          <h2 className="mb-1.5 text-sm font-semibold">
            {d["instantQuote.document.customer"]}
          </h2>
          <dl className="space-y-0.5">
            <Field
              label={d["instantQuote.framework.shippingAddress"]}
              // TELEFON BASILMAZ: belge satın alma birimine iletilen bir
              // çıktıdır ve teslim adresinin kendisi yeterli — bir irtibat
              // numarasını kâğıda basmak gereksiz bir kişisel veri yayılımı.
              value={[
                framework.shippingAddress.adres,
                framework.shippingAddress.mahalle,
                framework.shippingAddress.ilce,
                framework.shippingAddress.il,
                framework.shippingAddress.postaKodu,
              ]
                .filter((v): v is string => Boolean(v))
                .join(" · ")}
            />
          </dl>
        </div>

        <div>
          {framework.title && (
            <h2 className="mb-1.5 text-sm font-semibold">{framework.title}</h2>
          )}
          <dl className="space-y-0.5">
            {framework.leadDays !== null && (
              <Field
                label={d["instantQuote.framework.leadDays"]}
                value={fill(d["instantQuote.lead.days"], { days: framework.leadDays })}
              />
            )}
            <Field
              label={d["instantQuote.framework.committed"]}
              value={fill(d["instantQuote.framework.units"], {
                units: framework.committedUnits,
              })}
            />
          </dl>
          {/* FİYAT GEÇERLİLİK TARİHİ — zorunlu içerik. Kilidi dolmuş bir
              anlaşmada tarih YİNE yazılır (belge bir kayıttır) ve yanına
              geçerliliğin dolduğu AYRICA yazılır: tarihi silmek, belgenin ne
              söylediğini sonradan bulanıklaştırmak olurdu. */}
          <p className="mt-1.5 font-medium">
            {fill(d["instantQuote.framework.priceLockedUntil"], { date: lockDate })}
          </p>
          {framework.lockExpired && (
            <p className="quote-doc__muted mt-0.5">
              {d["instantQuote.framework.lockExpired"]}
            </p>
          )}
        </div>
      </section>

      {/* ── Taahhüt satırları ─────────────────────────────────────────── */}
      <h2 className="mt-6 text-sm font-semibold">
        {d["instantQuote.framework.doc.commitment"]}
      </h2>
      <table className="quote-doc__table mt-2 w-full text-xs">
        <thead>
          <tr>
            <th scope="col" className="w-8 text-left">
              #
            </th>
            <th scope="col" className="text-left">
              {d["instantQuote.framework.column.part"]}
            </th>
            <th scope="col" className="text-left">
              {d["instantQuote.framework.column.config"]}
            </th>
            <th scope="col" className="w-12 text-right">
              {d["instantQuote.framework.column.committed"]}
            </th>
            {showPrices && (
              <>
                <th scope="col" className="w-24 text-right">
                  {d["instantQuote.framework.column.unit"]}
                </th>
                <th scope="col" className="w-24 text-right">
                  {d["instantQuote.framework.column.line"]}
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {framework.parts.map((part) => (
            <tr key={part.partId}>
              <td className="text-left tabular-nums">
                {String(part.position).padStart(2, "0")}
              </td>
              <td className="text-left">
                {part.name}
                <span className="quote-doc__muted ml-1.5">{part.fileName}</span>
              </td>
              <td className="quote-doc__muted text-left">
                {[part.technologyName, part.materialName, part.colorName, part.finishName]
                  .filter((v): v is string => Boolean(v))
                  .join(" · ")}
              </td>
              <td className="text-right tabular-nums">{part.quantity}</td>
              {showPrices && (
                <>
                  <td className="text-right tabular-nums">
                    {formatCurrency(part.unitKurus!, "tr")}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatCurrency(part.lineKurus!, "tr")}
                  </td>
                </>
              )}
            </tr>
          ))}
          {framework.addons.map((addon) => (
            <tr key={addon.key}>
              <td />
              <td className="text-left" colSpan={showPrices ? 3 : 2}>
                {addon.name}
                <span className="quote-doc__muted ml-1.5">
                  {d["instantQuote.framework.addon"]}
                </span>
              </td>
              {showPrices && (
                <td className="text-right tabular-nums" colSpan={2}>
                  {formatCurrency(addon.kurus!, "tr")}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── İKİ TOPLAM, AYRI AYRI ─────────────────────────────────────── */}
      {showPrices && (
        <section className="mt-4 ml-auto w-full max-w-[90mm] text-xs">
          <dl className="space-y-0.5">
            <MoneyRow
              label={d["instantQuote.summary.kdvExcluded"]}
              kurus={framework.committedKdvExcludedKurus!}
            />
            <MoneyRow
              label={fill(d["instantQuote.summary.kdv"], {
                rate: framework.kdvRatePercent!,
              })}
              kurus={framework.committedKdvKurus!}
            />
            <MoneyRow
              label={d["instantQuote.framework.committedTotal"]}
              kurus={framework.committedTotalKurus!}
              emphasis
            />
            <MoneyRow
              label={d["instantQuote.framework.batchesTotal"]}
              kurus={framework.batchesTotalKurus!}
            />
          </dl>
          <p className="quote-doc__muted mt-1.5">
            {fill(d["instantQuote.framework.committedTotalNote"], {
              units: framework.committedUnits,
            })}{" "}
            {d["instantQuote.framework.batchesTotalNote"]}
          </p>
        </section>
      )}

      {/* ── Parti planı ───────────────────────────────────────────────── */}
      <h2 className="mt-6 text-sm font-semibold">
        {d["instantQuote.framework.doc.batchPlan"]}
      </h2>
      {framework.batches.length === 0 ? (
        <p className="quote-doc__muted mt-1.5 text-xs">
          {d["instantQuote.framework.batchesEmpty"]}
        </p>
      ) : (
        <table className="quote-doc__table mt-2 w-full text-xs">
          <thead>
            <tr>
              <th scope="col" className="text-left">
                {d["instantQuote.framework.batches"]}
              </th>
              <th scope="col" className="text-left">
                {d["instantQuote.framework.plannedShipDate"]}
              </th>
              <th scope="col" className="w-16 text-right">
                {d["instantQuote.framework.column.committed"]}
              </th>
              <th scope="col" className="text-left">
                {d["instantQuote.framework.account.column.status"]}
              </th>
              {showPrices && (
                <th scope="col" className="w-24 text-right">
                  {d["instantQuote.framework.column.line"]}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {framework.batches.map((batch) => (
              <tr key={batch.id}>
                <td className="text-left">
                  {fill(d["instantQuote.framework.batch"], {
                    n: batch.position,
                    total: framework.batchCount,
                  })}
                </td>
                <td className="text-left">{formatDateLong(batch.plannedShipDate, "tr")}</td>
                <td className="text-right tabular-nums">{batch.units}</td>
                <td className="text-left">{d[BATCH_STATUS_DICT_KEYS[batch.status]]}</td>
                {showPrices && (
                  <td className="text-right tabular-nums">
                    {formatCurrency(batch.amountKurus!, "tr")}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Şartlar: HUKUKÎ ZORUNLU METİN ─────────────────────────────── */}
      <section className="mt-6 text-xs">
        <h2 className="text-sm font-semibold">{d["instantQuote.framework.doc.terms"]}</h2>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          {/* Birim fiyatlar KDV DAHİL — yukarıdaki KDV hariç taban bunun
              karşılığıdır (`computeKdv`, tek türetme yeri). */}
          <li>{d["instantQuote.summary.kdvLineNote"]}</li>
          <li>{d["instantQuote.framework.tryBindingFxApprox"]}</li>
          <li>{d["instantQuote.framework.perBatchBilling"]}</li>
          <li>{d["instantQuote.framework.doc.separateInvoice"]}</li>
          <li>{d["instantQuote.framework.doc.freeCancel"]}</li>
          <li>{d["instantQuote.framework.doc.madeToOrder"]}</li>
          <li>{d["instantQuote.framework.doc.businessDays"]}</li>
          <li>{d["instantQuote.framework.warningsPerBatch"]}</li>
        </ul>
        <dl className="mt-2 space-y-0.5">
          <Field
            label={d["instantQuote.framework.doc.termsVersion"]}
            value={framework.termsVersion ?? FRAMEWORK_TERMS_VERSION}
          />
          {framework.termsAcceptedAt ? (
            <Field
              label={d["instantQuote.framework.doc.termsAcceptedAt"]}
              value={formatDateLong(framework.termsAcceptedAt, "tr")}
            />
          ) : (
            <p className="quote-doc__muted">
              {d["instantQuote.framework.doc.termsNotAccepted"]}
            </p>
          )}
        </dl>
      </section>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="quote-doc__muted shrink-0">{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </div>
  );
}

/**
 * Para satırı. Tutar HAZIR gelir; bu bileşen toplama/çıkarma YAPMAZ — KDV
 * hariç taban da `computeKdv` ile sunucuda türetildi.
 */
function MoneyRow({
  label,
  kurus,
  emphasis = false,
}: {
  label: string;
  kurus: number;
  emphasis?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex gap-4 ${emphasis ? "quote-doc__total pt-1.5 text-sm font-semibold" : ""}`}
    >
      <dt className={emphasis ? "flex-1" : "quote-doc__muted flex-1"}>{label}</dt>
      <dd className="w-[24mm] shrink-0 text-right tabular-nums">
        {formatCurrency(kurus, "tr")}
      </dd>
    </div>
  );
}
