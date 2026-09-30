"use client";

/**
 * PARTİ PLANLAYICI: parça başına adet + planlanan sevk tarihi.
 *
 * ─── TUTAR ÖNİZLEMESİ SUNUCUDAN GELİR ──────────────────────────────────────
 *
 * Bu bileşen HİÇBİR tutarı hesaplamaz: "Ön izle" düğmesi ucu `dryRun: true`
 * ile çağırır, uç anlaşmanın DONMUŞ kataloğundan `computeQuote` ile brütü
 * hesaplar ve hiçbir satır yazmaz. Ekranın kendi çarpması olsaydı (adet ×
 * kilitli birim) ek hizmetleri ve asgari tamamlamayı görmez, admin'e
 * planladığından FARKLI bir rakam gösterirdi.
 *
 * ─── ADET HAM METİN TAŞIR ──────────────────────────────────────────────────
 *
 * Çevirim yalnız GÖNDERİM anında yapılır (`planRows`): her tuş vuruşunda
 * çevirmek ara hâlleri imkânsız kılar (katalog ve fiyat ekranlarında birebir
 * aynı hata düzeltildi). Okunamayan TEK alan bile isteği durdurur.
 */
import { useState } from "react";
import {
  planRows,
  type PlanPart,
} from "@/app/admin/cerceve/[id]/framework-values";
import { formatCurrency, formatDate } from "@/lib/i18n/format";

export interface PlanPreviewRow {
  position: number;
  plannedShipDate: string;
  units: number;
  amountKurus: number;
}

export function BatchPlanner({
  parts,
  busy,
  disabled,
  disabledReason,
  preview,
  onPreview,
  onPlan,
}: {
  parts: PlanPart[];
  busy: string | null;
  disabled: boolean;
  disabledReason?: string;
  /** Sunucudan gelen `dryRun` sonucu; `null` = henüz ön izlenmedi. */
  preview: PlanPreviewRow[] | null;
  onPreview: (args: {
    plannedShipDate: string;
    lines: Array<{ partId: string; quantity: number }>;
    reason: string;
    note: string;
  }) => void;
  onPlan: (args: {
    plannedShipDate: string;
    lines: Array<{ partId: string; quantity: number }>;
    reason: string;
    note: string;
  }) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [shipDate, setShipDate] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (run: typeof onPlan) => {
    const rows = planRows(parts, draft);
    if (typeof rows === "string") {
      setLocalError(rows);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shipDate)) {
      setLocalError("Planlanan sevk tarihini seçin.");
      return;
    }
    setLocalError(null);
    run({ plannedShipDate: shipDate, lines: rows, reason, note });
  };

  return (
    <div>
      {disabled && disabledReason && (
        <p className="mb-3 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {disabledReason}
        </p>
      )}

      <div className="space-y-2">
        {parts.map((p) => (
          <div key={p.partId} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="w-56 shrink-0 truncate text-gray-700">
              P{String(p.position).padStart(2, "0")} · {p.name}
            </span>
            <span className="text-xs text-gray-500">kalan taahhüt: {p.remaining}</span>
            <input
              inputMode="numeric"
              value={draft[p.partId] ?? ""}
              onChange={(e) => setDraft({ ...draft, [p.partId]: e.target.value })}
              placeholder="adet"
              disabled={disabled}
              className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-right disabled:bg-gray-100"
            />
          </div>
        ))}
        {parts.length === 0 && (
          <p className="text-sm text-gray-500">Bu anlaşmanın taahhüdünde parça yok.</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-500">Planlanan sevk tarihi</span>
          <input
            type="date"
            value={shipDate}
            onChange={(e) => setShipDate(e.target.value)}
            disabled={disabled}
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1 disabled:bg-gray-100"
          />
        </label>
        <label className="min-w-[14rem] flex-1 text-sm">
          <span className="block text-xs text-gray-500">Parti notu (isteğe bağlı)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={disabled}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 disabled:bg-gray-100"
          />
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className="block text-xs text-gray-500">
          Gerekçe (en az 10 karakter — denetim izine yazılır)
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          disabled={disabled}
          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 disabled:bg-gray-100"
        />
      </label>

      {localError && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {localError}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || busy !== null}
          onClick={() => submit(onPreview)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-40"
        >
          {busy === "plan-preview" ? "Hesaplanıyor…" : "Tutarı ön izle (yazmaz)"}
        </button>
        <button
          type="button"
          disabled={disabled || busy !== null}
          onClick={() => submit(onPlan)}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy === "plan" ? "Planlanıyor…" : "Partiyi planla"}
        </button>
      </div>

      {preview && preview.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-500">
            Sunucunun hesabı (hiçbir satır yazılmadı)
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {preview.map((row) => (
              <li key={row.position} className="flex flex-wrap items-center gap-3">
                <span className="text-gray-700">Parti {row.position}</span>
                <span className="text-gray-500">
                  planlanan sevk {formatDate(row.plannedShipDate, "tr")}
                </span>
                <span className="text-gray-500">{row.units} adet</span>
                <span className="ml-auto tabular-nums font-semibold text-gray-900">
                  {formatCurrency(row.amountKurus, "tr")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-gray-500">
            Tutar anlaşmanın DONMUŞ kataloğundan hesaplandı: kilitli birim fiyatlar +
            ek hizmetler. Sabit ve parça-başı ek hizmetler her partide yeniden
            tahsil edilir.
          </p>
        </div>
      )}
    </div>
  );
}
