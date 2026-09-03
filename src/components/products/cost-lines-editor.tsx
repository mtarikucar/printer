"use client";

import { Button, Input, Select } from "@/components/ui";
import {
  COST_LINE_OPTIONS,
  COST_LINE_LABELS_TR,
  splitCostLines,
  parseTryToKurus,
  type CostLineKind,
} from "@/lib/config/cost-lines";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";

/**
 * Kalem kırılımı editörü — ürünün fiyatının neyden oluştuğunu ve dolayısıyla
 * kimin ne kadar hakedeceğini girer.
 *
 * Fiyat alanı ayrı bir giriş DEĞİL: kalemlerin toplamı ürünün fiyatıdır. Böylece
 * "toplam ≠ fiyat" durumu formda hiç oluşmaz ve iki hakediş tabanı her zaman
 * tutarı tam olarak böler.
 *
 * Admin ürün formu, satıcı ürün formu ve her ikisinin düzenleme ekranı aynı
 * bileşeni kullanır — kalem türü listesi ve pay hesabı tek yerde kalsın diye.
 */

export interface CostLineRow {
  kind: CostLineKind;
  label: string;
  /** Serbest metin: kullanıcı "1.250,50" da yazabilir, "1250.5" da. */
  amountTry: string;
  /**
   * Kararlı React anahtarı. Satırları indeksle anahtarlamak, ortadan bir satır
   * silindiğinde alttaki satırların girdi durumunu yukarı kaydırıyordu.
   */
  uid: string;
}

// Moved to lib/config/cost-line-row.ts
import { emptyCostLineRow, costLineRowFromKurus, type CostLineRow } from "@/lib/config/cost-line-row";
// let uidSeq = 0;
// const nextUid = () => `cl-${uidSeq++}`;

export const emptyCostLine = (kind: CostLineKind = "production"): CostLineRow => ({
  kind,
  label: "",
  amountTry: "",
  uid: nextUid(),
});

/** Kayıtlı bir kalemi (kuruş) forma yüklenebilir satıra çevirir. */
// export const costLineRowFromKurus = (line: {
//   kind: CostLineKind;
//   label?: string | null;
//   amountKurus: number;
// }): CostLineRow => ({
//   kind: line.kind,
//   label: line.label ?? "",
//   amountTry: (line.amountKurus / 100).toFixed(2).replace(".", ","),
//   uid: nextUid(),
// });

/**
 * "1.250,50" → 125050. Geçersizse NaN.
 * Ayrıştırma saf modüldedir (config/cost-lines.ts) — bunu yanlış yapmak
 * doğrudan DB'ye yanlış fiyat yazar, o yüzden birim testi var.
 */
export const costLineKurus = parseTryToKurus;

/** Toplam kuruş; herhangi bir satır geçersizse NaN. */
export function costLinesTotal(rows: readonly CostLineRow[]): number {
  let total = 0;
  for (const r of rows) {
    const k = costLineKurus(r.amountTry);
    if (Number.isNaN(k)) return NaN;
    total += k;
  }
  return total;
}

/** API gövdesine giren şekil. Geçersiz satır varsa null. */
export function toCostLinePayload(
  rows: readonly CostLineRow[]
): Array<{ kind: CostLineKind; label?: string; amountKurus: number }> | null {
  const out: Array<{ kind: CostLineKind; label?: string; amountKurus: number }> = [];
  for (const r of rows) {
    const amountKurus = costLineKurus(r.amountTry);
    if (Number.isNaN(amountKurus)) return null;
    out.push({
      kind: r.kind,
      ...(r.label.trim() ? { label: r.label.trim() } : {}),
      amountKurus,
    });
  }
  return out;
}

/** Sunucudaki `costLineSchema` üst sınırı (validators/product.ts). */
export const MAX_COST_LINES = 20;

const fmt = (kurus: number) =>
  (kurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

export function CostLinesEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: CostLineRow[];
  onChange: (rows: CostLineRow[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<CostLineRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const atLimit = rows.length >= MAX_COST_LINES;
  const add = (kind: CostLineKind) => {
    if (atLimit) return;
    onChange([...rows, emptyCostLine(kind)]);
  };

  // Henüz yazılmamış (boş) bir satır özeti kırmızıya çevirmemeli — kullanıcı
  // "+ Boyama"ya bastığı anda tüm pay dökümünün hataya dönüşmesi kafa karıştırır.
  // Yalnızca DOLU ama GEÇERSİZ satır hata sayılır.
  const filled = rows.filter((r) => r.amountTry.trim() !== "");
  const invalidRows = filled.filter((r) => Number.isNaN(costLineKurus(r.amountTry)));
  const valid = invalidRows.length === 0;
  const total = valid
    ? filled.reduce((sum, r) => sum + costLineKurus(r.amountTry), 0)
    : NaN;
  const bases = valid
    ? splitCostLines(
        filled.map((r) => ({ kind: r.kind, amountKurus: costLineKurus(r.amountTry) }))
      )
    : null;

  const netBps = 10000 - PLATFORM_COMMISSION_RATE_BPS;
  const partnerNet = (grossKurus: number) =>
    grossKurus - Math.round((grossKurus * PLATFORM_COMMISSION_RATE_BPS) / 10000);

  const hasPainting = (bases?.paintingKurus ?? 0) > 0;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div
            key={r.uid}
            className="rounded-xl border border-gray-200 bg-white p-3 space-y-2"
          >
            <div className="grid grid-cols-12 gap-2">
              {/* Kalem türü — hakediş tabanını BU belirler. */}
              <div className="col-span-5 sm:col-span-4">
                <Select
                  aria-label={`Kalem ${i + 1} türü`}
                  value={r.kind}
                  disabled={disabled}
                  onChange={(e) =>
                    update(i, { kind: e.target.value as CostLineKind })
                  }
                >
                  {COST_LINE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-5 sm:col-span-6">
                <Input
                  placeholder="Açıklama (isteğe bağlı)"
                  aria-label={`Kalem ${i + 1} açıklaması`}
                  value={r.label}
                  disabled={disabled}
                  maxLength={120}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </div>
              <div className="col-span-2 flex items-center justify-end">
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={disabled}
                    className="text-sm font-medium text-gray-400 hover:text-red-600 disabled:opacity-40"
                    aria-label={`Kalem ${i + 1}'i sil`}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-5 sm:col-span-4">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  aria-label={`Kalem ${i + 1} tutarı (₺)`}
                  value={r.amountTry}
                  disabled={disabled}
                  onChange={(e) => update(i, { amountTry: e.target.value })}
                />
              </div>
              <p className="col-span-7 sm:col-span-8 text-xs text-gray-500">
                {COST_LINE_OPTIONS.find((o) => o.value === r.kind)?.payee}
                {Number.isNaN(costLineKurus(r.amountTry)) ? null : (
                  <>
                    {" · net "}
                    <strong className="text-gray-700">
                      ₺{fmt(partnerNet(costLineKurus(r.amountTry)))}
                    </strong>
                  </>
                )}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => add("production")}
          disabled={disabled || atLimit}
        >
          + {COST_LINE_LABELS_TR.production}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => add("painting")}
          disabled={disabled || atLimit}
        >
          + {COST_LINE_LABELS_TR.painting}
        </Button>
        {atLimit && (
          <span className="text-xs text-gray-500">
            En fazla {MAX_COST_LINES} kalem eklenebilir.
          </span>
        )}
      </div>

      {/* Kırılımın özeti: fiyat, iki taban ve platformun payı. */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
        {!valid ? (
          <p className="text-red-600">
            Geçersiz tutar. Fiyatı <strong>2400</strong> ya da{" "}
            <strong>2.400,00</strong> biçiminde yazın.
          </p>
        ) : (
          <dl className="space-y-1">
            <div className="flex justify-between font-semibold text-gray-900">
              <dt>Ürün fiyatı (kalemlerin toplamı)</dt>
              <dd>₺{fmt(total)}</dd>
            </div>
            <div className="flex justify-between text-gray-600">
              <dt>Üretici net payı (%{netBps / 100})</dt>
              <dd>₺{fmt(partnerNet(bases!.productionKurus))}</dd>
            </div>
            <div className="flex justify-between text-gray-600">
              <dt>Boyacı net payı (%{netBps / 100})</dt>
              <dd>₺{fmt(partnerNet(bases!.paintingKurus))}</dd>
            </div>
            <div className="flex justify-between text-gray-600">
              <dt>Platform hizmet bedeli (%{PLATFORM_COMMISSION_RATE_BPS / 100})</dt>
              <dd>
                ₺
                {fmt(
                  total -
                    partnerNet(bases!.productionKurus) -
                    partnerNet(bases!.paintingKurus)
                )}
              </dd>
            </div>
          </dl>
        )}
        {valid && !hasPainting && (
          <p className="mt-2 text-xs text-gray-500">
            Boyama kalemi yok — bu ürün bir boyacıya yönlendirilmez, tutarın
            tamamı üretim payıdır.
          </p>
        )}
      </div>
    </div>
  );
}
export { emptyCostLineRow, costLineRowFromKurus, type CostLineRow } from "@/lib/config/cost-line-row";
