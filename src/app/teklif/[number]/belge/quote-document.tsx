"use client";

import type { JSX } from "react";
import { decimal2, displayRate, fill, mm, money, rateText } from "@/components/quote/format";
import type { BankDetails } from "@/lib/config/payment";
import { KDV_RATE_BPS } from "@/lib/config/prices";
import { convertReceipt } from "@/lib/config/quote-currency";
import type {
  DisplayCurrency,
  FrozenFxRate,
  PresentedCatalog,
  PresentedPart,
  PresentedQuote,
} from "@/lib/config/quote-types";
import {
  BUSINESS_ADDRESS_FULL,
  BUSINESS_LEGAL_NAME,
  BUSINESS_TAX_ID,
} from "@/lib/config/business-identity";
import { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY } from "@/lib/config/contact";
import { formatCurrency, formatDateLong, formatMoneyMinor } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Yazdırılabilir teklif belgesi / proforma.
 *
 * Bu ekran değil, KÂĞITTIR. Bu yüzden uygulamanın kart gölgeleri, yuvarlak
 * köşeleri ve tema renkleri buraya girmez: belge, tarayıcı koyu temadayken de
 * beyaz kâğıt üstünde siyah mürekkeptir (renkler `belge.css` içinde `.quote-doc`
 * kapsamında sabitlenmiştir). Müşteri bunu satın alma birimine iletecek.
 *
 * İki kural belgenin şeklini belirliyor:
 *  - **Fiyat kapısı aynen geçerli.** Fiyat alanları gövdede yoksa fiyat
 *    SÜTUNLARI HİÇ ÇİZİLMEZ; bir proformada her satırda "–₺–,––" görmek
 *    belgeyi anlamsız kılardı. Bunun yerine tek cümle: nasıl görüleceği.
 *  - **İmzalı model adresi yok.** Belge paylaşılan bir çıktıdır; `previewGlbUrl`
 *    ve kaynak dosya adresleri buraya (ve paylaşım görünümüne, e-postalara)
 *    asla girmez. Küçük resim bunun istisnasıdır: belgenin okunabilmesi için
 *    parçanın neye benzediği görünmeli.
 *
 * Döviz seçildiğinde kâğıtta İKİ KOLON durur: BAĞLAYICI ₺ kolonu ve onun
 * YANINDA "≈ <döviz>". Tek kolonluk bir döviz proforması 32 Sayılı Karar
 * m.4/g + 2008-32/34 Tebliğ m.8 tartışmasına davetiyedir (Türkiye'de
 * yerleşikler arası satış sözleşmesinde bedel TL olmak ZORUNDA). Alt bilgi
 * hangisinin bağlayıcı olduğunu, kurun kaynağını (TCMB) ve BÜLTEN TARİHİNİ
 * yazar — TCMB verisi kamuya açık ve ücretsizdir ama ATIFLA kullanılır, ve
 * aynı cümle "bana €100 dendi" iddiasını belge üzerinde kapatan azaltmadır.
 */

/** Parçanın tek satırlık üretim tarifi: teknoloji · malzeme · renk · yüzey. */
function describeConfig(part: PresentedPart, catalog: PresentedCatalog): string {
  const { config } = part;
  const technology = catalog.technologies.find((t) => t.key === config.technologyKey);
  const material = catalog.materials.find(
    (m) => m.key === config.materialKey && m.technologyKey === config.technologyKey
  );
  const color = material?.colors.find((c) => c.key === config.colorKey);
  const finish = catalog.finishes.find((f) => f.key === config.finishKey);
  return [technology?.name, material?.name, color?.name, finish?.name]
    .filter((v): v is string => Boolean(v))
    .join(" · ");
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
 * Toplam bloğunun bir satırı: etiket · BAĞLAYICI ₺ · (varsa) ≈ döviz.
 *
 * Tek yerde kurulur ki altı satırın hiçbiri bir gün ikinci kolonu unutmasın —
 * kolonu eksik bir satır, okuyucunun toplayamadığı bir proforma demektir.
 * `rate` yokken işaretleme eskisiyle aynıdır: üçüncü hücre hiç doğmaz.
 */
function TotalRow({
  label,
  kurus,
  rate,
  emphasis,
}: {
  label: JSX.Element | string;
  kurus: number;
  rate: FrozenFxRate | null;
  emphasis?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex gap-4 ${emphasis ? "quote-doc__total pt-1.5 text-sm font-semibold" : ""}`}
    >
      <dt className={emphasis ? "flex-1" : "quote-doc__muted flex-1"}>{label}</dt>
      <dd className="w-[24mm] shrink-0 text-right tabular-nums">{formatCurrency(kurus, "tr")}</dd>
      {rate && (
        <dd className="quote-doc__muted w-[24mm] shrink-0 text-right tabular-nums">
          {money(kurus, rate)}
        </dd>
      )}
    </div>
  );
}

export function QuoteDocument({
  quote,
  bank,
  currency = "TRY",
}: {
  quote: PresentedQuote;
  bank: BankDetails;
  /**
   * `?kur=` ile gelen gösterim birimi. Belge AYRI bir sunucu render'ıdır ve
   * tarayıcıdaki tercihi okuyamaz; seçim adreste taşınır (`quote-header.tsx`).
   */
  currency?: DisplayCurrency;
}): JSX.Element {
  const d = useDictionary();
  const { totals, catalog } = quote;
  const showPrices = quote.viewer.canSeePrices && totals != null;
  const invoice = quote.invoice ?? null;
  const leadTier = quote.leadOptions.find((o) => o.key === quote.leadTier) ?? null;
  const rate = showPrices ? displayRate(quote.display?.snapshot, currency) : null;
  const receipt = rate && totals ? convertReceipt(totals, rate) : null;
  // Müşteri `?kur=EUR` ile geldi ama karşılanamadı (bayrak kapalı, kur bayat
  // ya da o birim donmuş snapshot'ta yok). Sessiz kalmak "istediğim kolon
  // nerede" sorusunu cevapsız bırakırdı; ₺ isteyene ise hiçbir şey yazılmaz.
  const fxUnavailable = currency !== "TRY" && rate === null;

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
          <p className="quote-doc__muted text-xs">{d["instantQuote.document.title"]}</p>
          {/* Numara ETİKETLİ yazılır. Etiketsiz bırakıldığında proformadaki
              "Açıklama" satırıyla birlikte okunup havale açıklaması sanılıyordu;
              oysa parayı eşleştiren referans bu değil (bkz. proforma bloğu). */}
          <p className="font-mono text-xl font-semibold tracking-tight">
            <span className="quote-doc__muted mr-1.5 font-sans text-xs font-normal">
              {d["instantQuote.document.quoteNumber"]}
            </span>
            {quote.number}
          </p>
          <dl className="mt-2 space-y-0.5 text-xs">
            <div className="flex justify-end gap-2">
              <dt className="quote-doc__muted">{d["instantQuote.document.issuedAt"]}</dt>
              <dd>{formatDateLong(quote.createdAt, "tr")}</dd>
            </div>
            <div className="flex justify-end gap-2">
              <dt className="quote-doc__muted">{d["instantQuote.workspace.expiresAt"]}</dt>
              <dd>{formatDateLong(quote.expiresAt, "tr")}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="quote-doc__rule my-5" />

      {/* ── Taraflar ve teklif bilgileri ──────────────────────────────── */}
      <section className="grid gap-6 text-xs sm:grid-cols-2">
        <div>
          <h2 className="mb-1.5 text-sm font-semibold">{d["instantQuote.document.customer"]}</h2>
          <dl className="space-y-0.5">
            {invoice?.companyName && (
              <Field label={d["instantQuote.document.company"]} value={invoice.companyName} />
            )}
            {invoice?.taxId && (
              <Field label={d["instantQuote.document.taxId"]} value={invoice.taxId} />
            )}
            {invoice?.taxOffice && (
              <Field label={d["instantQuote.document.taxOffice"]} value={invoice.taxOffice} />
            )}
            {quote.poNumber && (
              <Field label={d["instantQuote.document.poNumber"]} value={quote.poNumber} />
            )}
          </dl>
        </div>

        <div>
          {/* Proje adı varsa başlıktır; yoksa başlık HİÇ basılmaz — "Teklif no"
              gibi bir etiketi başlık yerine koymak boş bir satır üretirdi. */}
          {quote.title && <h2 className="mb-1.5 text-sm font-semibold">{quote.title}</h2>}
          <dl className="space-y-0.5">
            {leadTier && (
              <Field
                label={d["instantQuote.document.leadTime"]}
                value={
                  leadTier.leadDays === null
                    ? leadTier.name
                    : `${leadTier.name} · ${fill(d["instantQuote.lead.days"], {
                        days: leadTier.leadDays,
                      })}`
                }
              />
            )}
            {quote.shipByDate && (
              <Field
                label={d["instantQuote.lead.title"]}
                value={fill(d["instantQuote.lead.shipBy"], {
                  date: formatDateLong(quote.shipByDate, "tr"),
                })}
              />
            )}
          </dl>
          <p className="quote-doc__muted mt-0.5">
            {fill(d["instantQuote.summary.parts"], {
              parts: quote.partCount,
              units: quote.unitCount,
            })}
          </p>
        </div>
      </section>

      {/* ── Parçalar ──────────────────────────────────────────────────── */}
      <table className="quote-doc__table mt-6 w-full text-xs">
        <thead>
          <tr>
            <th scope="col" className="w-8 text-left">
              #
            </th>
            <th scope="col" className="text-left">
              {d["instantQuote.document.column.part"]}
            </th>
            <th scope="col" className="text-left">
              {d["instantQuote.document.column.spec"]}
            </th>
            <th scope="col" className="w-12 text-right">
              {d["instantQuote.document.column.quantity"]}
            </th>
            {showPrices && (
              <>
                <th scope="col" className="w-24 text-right">
                  {d["instantQuote.document.column.unit"]}
                </th>
                <th scope="col" className="w-24 text-right">
                  {d["instantQuote.document.column.line"]}
                </th>
                {rate && (
                  <th scope="col" className="w-24 text-right">
                    {fill(d["instantQuote.document.fxColumn"], { currency: rate.currency })}
                  </th>
                )}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {quote.parts.map((part, index) => (
            <tr key={part.id}>
              <td className="align-top tabular-nums">{index + 1}</td>
              <td className="align-top">
                <div className="flex items-start gap-2">
                  {part.thumbnailUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={part.thumbnailUrl}
                      alt=""
                      className="quote-doc__thumb"
                      width={48}
                      height={48}
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block font-medium">{part.name}</span>
                    <span className="quote-doc__muted block break-all">{part.fileName}</span>
                  </span>
                </div>
              </td>
              <td className="align-top">
                {describeConfig(part, catalog)}
                {part.dimensionsMm && (
                  <span className="quote-doc__muted block">
                    {fill(d["instantQuote.part.dimensions"], {
                      x: mm(part.dimensionsMm.x),
                      y: mm(part.dimensionsMm.y),
                      z: mm(part.dimensionsMm.z),
                    })}
                  </span>
                )}
                {/* Üçgenleme sapması satılan şeyin NİTELİĞİdir (CAD yüzeyi
                    üçgen ağa çevrilir), bu yüzden kâğıtta yazılı durur:
                    "parça CAD'ime göre köşeli geldi" tartışmasında dayanak
                    budur. Değer parçadan gelir, burada hesaplanmaz. */}
                {part.tessellationMm !== null && (
                  <span className="quote-doc__muted block">
                    {fill(d["instantQuote.document.stepTessellation"], {
                      mm: decimal2(part.tessellationMm),
                    })}
                  </span>
                )}
              </td>
              <td className="align-top text-right tabular-nums">{part.config.quantity}</td>
              {showPrices && (
                <>
                  <td className="align-top text-right tabular-nums">
                    {part.price ? formatCurrency(part.price.unitKurus, "tr") : "—"}
                  </td>
                  <td className="align-top text-right tabular-nums">
                    {part.price ? formatCurrency(part.price.lineKurus, "tr") : "—"}
                  </td>
                  {/* Kâğıtta ikinci kolon SATIR TUTARINI taşır: birim fiyatın
                      da yaklaşığını basmak dört fiyat kolonu demek olurdu ve
                      okuyucunun topladığı sayı satır tutarıdır. */}
                  {rate && (
                    <td className="quote-doc__muted align-top text-right tabular-nums">
                      {part.price ? money(part.price.lineKurus, rate) : "—"}
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Toplam ────────────────────────────────────────────────────── */}
      {showPrices ? (
        <section className="mt-5 flex justify-end">
          <dl className={`w-full space-y-1 text-xs ${rate ? "max-w-[110mm]" : "max-w-[80mm]"}`}>
            <TotalRow
              label={d["instantQuote.summary.partsSubtotal"]}
              kurus={totals.partsKurus}
              rate={rate}
            />
            {totals.addonLines.map((line) => (
              <TotalRow key={line.key} label={line.name} kurus={line.kurus} rate={rate} />
            ))}
            {totals.minOrderTopUpKurus > 0 && (
              <TotalRow
                label={d["instantQuote.summary.minOrderTopUp"]}
                kurus={totals.minOrderTopUpKurus}
                rate={rate}
              />
            )}
            {/* Satırlar ayrı ayrı yuvarlandığı için toplamları çevrilmiş
                toplamdan sapabilir. Kâğıtta bunu GİZLEMEK olmaz: proformayı
                satır satır toplayan okuyucu farkı bulmak zorunda. ₺ kolonunda
                fark YOKTUR (sunucu hesabı), o yüzden yalnız döviz kolonu
                yazılır. */}
            {receipt && receipt.roundingMinor !== 0 && (
              <div className="flex gap-4">
                <dt className="quote-doc__muted flex-1">{d["instantQuote.fx.rounding"]}</dt>
                <dd className="w-[24mm] shrink-0" />
                <dd className="quote-doc__muted w-[24mm] shrink-0 text-right tabular-nums">
                  {formatMoneyMinor(receipt.roundingMinor, receipt.currency, "tr")}
                </dd>
              </div>
            )}
            <TotalRow
              emphasis
              label={
                <>
                  {d["instantQuote.summary.total"]}{" "}
                  <span className="quote-doc__muted text-xs font-normal">
                    {d["instantQuote.summary.kdvIncluded"]}
                  </span>
                </>
              }
              kurus={totals.totalKurus}
              rate={rate}
            />
            <TotalRow
              label={d["instantQuote.summary.kdvExcluded"]}
              kurus={totals.kdvExcludedKurus}
              rate={rate}
            />
            <TotalRow
              label={fill(d["instantQuote.summary.kdv"], { rate: KDV_RATE_BPS / 100 })}
              kurus={totals.kdvKurus}
              rate={rate}
            />
            <div className="flex gap-4">
              <dt className="quote-doc__muted flex-1">
                {d["instantQuote.summary.freeShipping"]}
              </dt>
              <dd />
            </div>
          </dl>
        </section>
      ) : (
        <p className="quote-doc__muted mt-5 text-xs">{d["instantQuote.summary.priceHidden"]}</p>
      )}

      {/* ── Proforma / havale ─────────────────────────────────────────── */}
      {showPrices && bank.iban && (
        <section className="quote-doc__box mt-6 text-xs">
          <h2 className="mb-1.5 text-sm font-semibold">{d["instantQuote.document.proforma"]}</h2>
          <dl className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {bank.bankName && (
              <Field label={d["instantQuote.document.bank"]} value={bank.bankName} />
            )}
            {bank.accountHolder && (
              <Field
                label={d["instantQuote.document.accountHolder"]}
                value={bank.accountHolder}
              />
            )}
            <div className="flex gap-2">
              <dt className="quote-doc__muted shrink-0">{d["instantQuote.document.iban"]}</dt>
              <dd className="font-mono">{bank.iban}</dd>
            </div>
            {bank.branch && (
              <Field label={d["instantQuote.document.branch"]} value={bank.branch} />
            )}
            {/*
              Havale açıklaması GERÇEK ödeme referansıdır — teklif numarası
              değil. `/havale/<referans>` yalnız taslak referansını (`FIG-…`)
              çözer, dekont OCR'ı onu puanlar, hatırlatma/süre işleri ve %3
              havale indirimi ona bağlıdır. Buraya `T-000123` yazmak müşteriyi
              hiçbir şeyin eşleştirmediği bir havaleye yollardı: ne sipariş, ne
              dekont yükleme sayfası, ne indirim — sipariş verdiğini sanırken
              teklifin süresi dolardı. Referans henüz yoksa (ödeme adımına
              girilmemiş) blok bilgilendirici kalır ve referansı nereden
              alacağını söyler.
            */}
            {quote.liveDraftReference ? (
              <Field
                label={d["instantQuote.document.reference"]}
                value={quote.liveDraftReference}
              />
            ) : (
              <p className="quote-doc__muted sm:col-span-2">
                {d["instantQuote.document.referencePending"]}
              </p>
            )}
          </dl>
        </section>
      )}

      <p className="quote-doc__muted mt-6 text-xs">
        {fill(d["instantQuote.document.validUntil"], {
          date: formatDateLong(quote.expiresAt, "tr"),
        })}
      </p>

      {/* Kaynak (TCMB), BÜLTEN TARİHİ, kur ve hangi kolonun BAĞLAYICI olduğu
          kâğıtta HER ZAMAN yazılı durur. */}
      {rate && quote.display && (
        <p className="quote-doc__muted mt-1 text-xs">
          {fill(d["instantQuote.document.fxFooter"], {
            date: formatDateLong(quote.display.snapshot.bulletinDate, "tr"),
            currency: rate.currency,
            rate: rateText(rate),
          })}
        </p>
      )}
      {fxUnavailable && (
        <p className="quote-doc__muted mt-1 text-xs">{d["instantQuote.fx.unavailable"]}</p>
      )}
    </article>
  );
}
