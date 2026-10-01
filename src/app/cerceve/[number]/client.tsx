"use client";

/**
 * `/cerceve/[number]` — müşterinin çerçeve anlaşma ekranı.
 *
 * ─── EKRANDA PARA ARİTMETİĞİ YOKTUR ────────────────────────────────────────
 *
 * Bu dosyada tutar ÇARPILMAZ, BÖLÜNMEZ, ORANLANMAZ, TOPLANMAZ. Her rakam uçtan
 * hazır iner (`presentFramework`): KDV hariç taban da, partinin beklenen sevk
 * günü de, kova oranları da. Satırları ekranda toplamak, ek hizmetleri ve
 * asgari tamamlamayı görmeyen bir toplam üretirdi.
 *
 * ─── İKİ TOPLAM AYRI DURUR ─────────────────────────────────────────────────
 *
 * `committedTotalKurus` TEK-SEVKİYAT projeksiyonudur, `batchesTotalKurus` ise
 * iptal edilmemiş partilerin toplamı. İkisi genelde EŞİT DEĞİLDİR (sabit ve
 * parça başı ek hizmetler her partide yeniden tahsil edilir) ve bu ekran
 * hiçbirini ötekinin yerine yazmaz; farkını da hesaplamaz — bir çıkarma, "kayıp
 * para" gibi okunacak üçüncü bir sayı üretirdi.
 *
 * ─── ADLANDIRILMIŞ ENGEL: ÖDEME SAYFASI PARTİYİ GÖSTEREMEZ ─────────────────
 *
 * "Bu partiyi öde" düğmesi müşteriyi klon teklifin ödeme sayfasına
 * (`/teklif/<no>/odeme`) düşürüyor ve ORADA "Parti 3/8" bağlamı YOKTUR:
 * `src/app/pay/**`, `src/app/api/pay/**` ve `src/app/havale/**` bu turda
 * DEĞİŞTİRİLMEZ (başka oturumun commit'lenmemiş işi). Telafi burada: düğme
 * doğrudan gitmez, parti numarasını ve TUTARI bir onay adımında yazar ve
 * müşteri onayladıktan sonra yönlendirir. Bağlamın ödeme sayfasında da
 * görünmesi ayrı bir turun işi.
 *
 * ─── CANLI ─────────────────────────────────────────────────────────────────
 *
 * `emitFrameworkChanged` olayı `topics.customer(userId)`ye de düşüyor, yani
 * sayfa MÜŞTERİ akışına abone olur (`/api/realtime/customer`) ve `kind:
 * "framework"` haberinde anlaşmayı KENDİ YETKİSİYLE yeniden çeker. Kanal fiyat
 * taşımaz; tazelemeyi uç yapar.
 */
import { useCallback, useState, type JSX } from "react";
import Link from "next/link";
import { fill } from "@/components/quote/format";
import { FRAMEWORK_STATUS_TONES } from "@/app/admin/cerceve/[id]/framework-values";
import { BATCH_STATUS_DICT_KEYS, FRAMEWORK_STATUS_DICT_KEYS, customerProgressSegments } from "./framework-values";
import type {
  PresentedFramework,
  PresentedFrameworkBatch,
} from "@/lib/services/quote-framework-present";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";

/** Tutar gövdede YOKSA tire yazılır: uydurma bir "₺0,00" bedava sözü verirdi. */
function money(kurus: number | undefined): string {
  return kurus === undefined ? "—" : formatCurrency(kurus, "tr");
}

function ProgressBar({ framework }: { framework: PresentedFramework }): JSX.Element {
  const d = useDictionary();
  const segments = customerProgressSegments(framework.progress.total, d);
  const drawn = segments.filter((s) => s.units > 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-bg-muted">
        {drawn.map((s) => (
          <div
            key={s.key}
            className={s.tone}
            style={{ width: `${s.pct}%` }}
            title={`${s.label}: ${s.units}`}
          />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${s.tone}`} aria-hidden />
            <dt className="text-text-muted">{s.label}</dt>
            <dd className="ml-auto tabular-nums text-text-primary">{s.units}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PartBucketTable({ framework }: { framework: PresentedFramework }): JSX.Element {
  const d = useDictionary();
  const columns = customerProgressSegments(framework.progress.total, d);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border-default text-xs text-text-muted">
            <th scope="col" className="py-3 pr-4 font-medium">
              {d["instantQuote.framework.column.part"]}
            </th>
            <th scope="col" className="py-3 pr-4 text-right font-medium">
              {d["instantQuote.framework.column.committed"]}
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="py-3 pr-4 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {framework.progress.byPart.map((row) => (
            <tr key={row.partId} className="border-b border-bg-subtle">
              <td className="py-2 pr-4 text-text-primary">
                {framework.partNames[row.partId] ?? row.partId}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-text-primary">
                {row.committedUnits}
              </td>
              {customerProgressSegments(row, d).map((c) => (
                <td key={c.key} className="py-2 pr-4 text-right tabular-nums text-text-secondary">
                  {c.units}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchCard({
  framework,
  batch,
  onPay,
}: {
  framework: PresentedFramework;
  batch: PresentedFrameworkBatch;
  onPay: (batch: PresentedFrameworkBatch) => void;
}): JSX.Element {
  const d = useDictionary();
  return (
    <li className="rounded-2xl border border-border-default p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-text-primary">
          {fill(d["instantQuote.framework.batch"], {
            n: batch.position,
            total: framework.batchCount,
          })}
        </span>
        <span className="rounded-full bg-bg-muted px-2.5 py-0.5 text-xs text-text-secondary">
          {d[BATCH_STATUS_DICT_KEYS[batch.status]]}
        </span>
        <span className="text-sm text-text-secondary">
          {d["instantQuote.framework.plannedShipDate"]}:{" "}
          {formatDate(batch.plannedShipDate, "tr")}
        </span>
        <span className="text-sm text-text-secondary">
          {fill(d["instantQuote.framework.units"], { units: batch.units })}
        </span>
        <span className="ml-auto font-mono text-sm tabular-nums text-text-primary">
          {money(batch.amountKurus)}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {batch.shipByDate && (
          <div className="flex gap-2">
            <dt className="text-text-muted">{d["instantQuote.lead.title"]}</dt>
            <dd className="text-text-secondary">
              {fill(d["instantQuote.lead.shipBy"], {
                date: formatDate(batch.shipByDate, "tr"),
              })}
            </dd>
          </div>
        )}
        {batch.trackingNumber && (
          <div className="flex gap-2">
            <dt className="text-text-muted">
              {d["instantQuote.framework.trackingNumber"]}
            </dt>
            <dd className="font-mono text-text-secondary">{batch.trackingNumber}</dd>
          </div>
        )}
        {batch.orderNumber && (
          <div className="flex gap-2">
            <dt className="text-text-muted">{d["instantQuote.framework.order"]}</dt>
            <dd>
              <Link
                href={`/track/${encodeURIComponent(batch.orderNumber)}`}
                className="font-mono text-green-600 underline-offset-4 hover:underline"
              >
                {batch.orderNumber}
              </Link>
            </dd>
          </div>
        )}
        {batch.quoteNumber && !batch.payable && (
          <div className="flex gap-2">
            <dt className="text-text-muted">{d["instantQuote.framework.batchQuote"]}</dt>
            <dd>
              <Link
                href={`/teklif/${encodeURIComponent(batch.quoteNumber)}`}
                className="font-mono text-green-600 underline-offset-4 hover:underline"
              >
                {batch.quoteNumber}
              </Link>
            </dd>
          </div>
        )}
      </dl>

      {batch.payable && (
        <button
          type="button"
          onClick={() => onPay(batch)}
          className="btn-primary mt-3 !px-4 !py-2 text-sm"
        >
          {d["instantQuote.framework.payBatch"]}
        </button>
      )}
    </li>
  );
}

/**
 * Ödeme ONAY adımı — adlandırılmış engelin telafisi.
 *
 * Ödeme sayfası hangi parti olduğunu göstermiyor, bu yüzden parti numarası ve
 * TUTAR ödeme başlamadan ÖNCE burada yazılır ve müşteri onaylar. Tutar gövdeden
 * gelir; bu bileşen onu yeniden hesaplamaz.
 */
function PayConfirm({
  framework,
  batch,
  onCancel,
}: {
  framework: PresentedFramework;
  batch: PresentedFrameworkBatch;
  onCancel: () => void;
}): JSX.Element {
  const d = useDictionary();
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-bg-base p-6 shadow-xl">
        <h2 className="text-lg text-text-primary">{d["instantQuote.framework.payBatch"]}</h2>
        <p className="mt-3 font-medium text-text-primary">
          {fill(d["instantQuote.framework.payConfirm"], {
            n: batch.position,
            total: framework.batchCount,
            amount: money(batch.amountKurus),
          })}
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          {d["instantQuote.framework.payConfirmNote"]}
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          {d["instantQuote.framework.perBatchBilling"]}
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          {d["instantQuote.framework.warningsPerBatch"]}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {batch.quoteNumber && (
            <Link
              href={`/teklif/${encodeURIComponent(batch.quoteNumber)}/odeme`}
              className="btn-primary !px-4 !py-2 text-sm"
            >
              {d["instantQuote.framework.payConfirmCta"]}
            </Link>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary !px-4 !py-2 text-sm"
          >
            {d["instantQuote.framework.payConfirmCancel"]}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FrameworkClient({
  initial,
}: {
  initial: PresentedFramework;
}): JSX.Element {
  const d = useDictionary();
  const [framework, setFramework] = useState(initial);
  const [paying, setPaying] = useState<PresentedFrameworkBatch | null>(null);
  const [staleRead, setStaleRead] = useState(false);

  // Sunucu gövdesi yalnız BAŞLANGIÇ değeridir; tazeleme SSE haberiyle uçtan
  // gelir. `initial`i bir effect'le state'e geri yazmak (prop → state eşitleme)
  // her sunucu render'ında zincirleme bir yeniden çizim üretirdi ve kazancı
  // yok: sayfa `force-dynamic` ve bu ekranın gövdeyi tazeleyen tek yolu
  // `refresh`.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/customer/frameworks/${encodeURIComponent(initial.number)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        setStaleRead(true);
        return;
      }
      setFramework((await res.json()) as PresentedFramework);
      setStaleRead(false);
    } catch {
      // Okuma düşerse ekranda DURAN gövde korunur ve bir şerit "bu sayfa
      // tazelenemedi" der: boş bir ekran, "anlaşmanız yok" diye okunurdu.
      setStaleRead(true);
    }
  }, [initial.number]);

  useRealtimeEvent((event) => {
    if (event.kind === "framework" && event.frameworkId === framework.id) void refresh();
  });

  const lockSentence = framework.lockExpired
    ? d["instantQuote.framework.lockExpired"]
    : fill(d["instantQuote.framework.priceLockedUntil"], {
        date: formatDate(framework.priceLockedUntil, "tr"),
      });

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-text-muted">
          {d["instantQuote.framework.title"]}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl text-text-primary" style={{ fontFamily: "var(--font-display)" }}>
            {framework.number}
          </h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${FRAMEWORK_STATUS_TONES[framework.status]}`}
          >
            {d[FRAMEWORK_STATUS_DICT_KEYS[framework.status]]}
          </span>
        </div>
        <p className="mt-2 text-sm text-text-secondary">
          {framework.title ?? d["instantQuote.framework.subtitle"]}
        </p>
        <p
          className={`mt-2 text-sm ${framework.lockExpired ? "text-warning-500" : "text-text-secondary"}`}
        >
          {lockSentence}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <Link
            href={`/cerceve/${encodeURIComponent(framework.number)}/belge`}
            className="font-medium text-green-600 underline-offset-4 hover:underline"
          >
            {d["instantQuote.framework.document"]}
          </Link>
          <Link
            href={`/teklif/${encodeURIComponent(framework.quoteNumber)}`}
            className="text-text-secondary underline-offset-4 hover:underline"
          >
            {d["instantQuote.framework.sourceQuote"]}: {framework.quoteNumber}
          </Link>
          {framework.leadDays !== null && (
            <span className="text-text-secondary">
              {d["instantQuote.framework.leadDays"]}:{" "}
              {fill(d["instantQuote.lead.days"], { days: framework.leadDays })}
            </span>
          )}
        </div>
        {staleRead && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-warning-500/40 bg-warning-50 px-3 py-2 text-sm text-warning-500"
          >
            {d["instantQuote.framework.loadFailed"]}
          </p>
        )}
      </header>

      <section>
        <ProgressBar framework={framework} />
        <p className="mt-2 text-xs text-text-muted">
          {d["instantQuote.framework.committed"]}:{" "}
          <strong className="tabular-nums">{framework.committedUnits}</strong>
        </p>
        <div className="mt-4">
          <PartBucketTable framework={framework} />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border-default bg-bg-subtle p-4">
          <div className="text-xs font-medium text-text-muted">
            {d["instantQuote.framework.committedTotal"]}
          </div>
          <div className="mt-1 font-mono text-lg tabular-nums text-text-primary">
            {money(framework.committedTotalKurus)}
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            {fill(d["instantQuote.framework.committedTotalNote"], {
              units: framework.committedUnits,
            })}{" "}
            {d["instantQuote.summary.kdvIncluded"]}
          </p>
        </div>
        <div className="rounded-2xl border border-border-default bg-bg-subtle p-4">
          <div className="text-xs font-medium text-text-muted">
            {d["instantQuote.framework.batchesTotal"]}
          </div>
          <div className="mt-1 font-mono text-lg tabular-nums text-text-primary">
            {money(framework.batchesTotalKurus)}
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            {d["instantQuote.framework.batchesTotalNote"]}
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-lg text-text-primary">{d["instantQuote.framework.batches"]}</h2>
        {framework.batches.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">
            {d["instantQuote.framework.batchesEmpty"]}
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {framework.batches.map((batch) => (
              <BatchCard
                key={batch.id}
                framework={framework}
                batch={batch}
                onPay={setPaying}
              />
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-text-muted">
          {d["instantQuote.framework.perBatchBilling"]}
        </p>
      </section>

      {paying && (
        <PayConfirm
          framework={framework}
          batch={paying}
          onCancel={() => setPaying(null)}
        />
      )}
    </div>
  );
}
