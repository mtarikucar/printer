"use client";

import { useState, type JSX } from "react";
import { Button, Select } from "@/components/ui";
import type { PresentedCatalog } from "@/lib/config/quote-types";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { PartPatch } from "@/lib/quote/client-api";
import { fill } from "./format";

/**
 * Toplu işlem çubuğu: "yirmi parçanın hepsi PETG olsun".
 *
 * Seçim boşken HİÇ çizilmez — sürekli duran, çoğu zaman anlamsız bir araç
 * çubuğu listeyi kısaltır ve ekranda gürültü yapar.
 *
 * Boş bırakılan alan "değiştirme" demektir; yalnız DOLDURULAN alanlar yamaya
 * girer. Malzeme seçilince renk de zorunlu olarak yamaya girer: renk yeni
 * malzemede yoksa uç isteği tümden reddeder (`resolveConfig`), yani sessiz
 * bir yarım uygulama olmaz.
 */

interface BulkDraft {
  technologyKey: string;
  materialKey: string;
  colorKey: string;
  finishKey: string;
  quantity: string;
}

const EMPTY: BulkDraft = {
  technologyKey: "",
  materialKey: "",
  colorKey: "",
  finishKey: "",
  quantity: "",
};

export interface QuoteBulkBarProps {
  selectedIds: string[];
  catalog: PresentedCatalog;
  busy?: boolean;
  onApply: (patch: PartPatch) => void;
  onDelete: () => void;
  onClear: () => void;
}

export function QuoteBulkBar({
  selectedIds,
  catalog,
  busy,
  onApply,
  onDelete,
  onClear,
}: QuoteBulkBarProps): JSX.Element | null {
  const d = useDictionary();
  const [draft, setDraft] = useState<BulkDraft>(EMPTY);

  if (selectedIds.length === 0) return null;

  const materials = draft.technologyKey
    ? catalog.materials.filter((m) => m.technologyKey === draft.technologyKey)
    : catalog.materials;
  const material = materials.find((m) => m.key === draft.materialKey);
  const finishes = draft.technologyKey
    ? catalog.finishes.filter(
        (f) => f.technologyKey === null || f.technologyKey === draft.technologyKey
      )
    : catalog.finishes;

  const quantity = Number(draft.quantity);
  const patch: PartPatch = {
    ...(draft.technologyKey ? { technologyKey: draft.technologyKey } : {}),
    ...(draft.materialKey ? { materialKey: draft.materialKey } : {}),
    ...(draft.colorKey ? { colorKey: draft.colorKey } : {}),
    ...(draft.finishKey ? { finishKey: draft.finishKey } : {}),
    ...(draft.quantity && Number.isFinite(quantity) && quantity >= 1
      ? { quantity: Math.round(quantity) }
      : {}),
  };
  const hasPatch = Object.keys(patch).length > 0;

  const field = (label: string, node: JSX.Element) => (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] text-white/60">{label}</span>
      {node}
    </label>
  );

  return (
    <div className="sticky bottom-3 z-30 rounded-2xl bg-ink p-3 text-white shadow-elevated">
      <div className="flex flex-wrap items-end gap-3">
        <p className="mr-auto text-sm font-medium">
          {fill(d["instantQuote.bulk.selected"], { count: selectedIds.length })}
        </p>

        {field(
          d["instantQuote.bulk.technology"],
          <Select
            className="!w-32 !py-1.5 !text-xs !text-text-primary"
            value={draft.technologyKey}
            disabled={busy}
            onChange={(e) =>
              setDraft({ ...EMPTY, technologyKey: e.target.value })
            }
          >
            <option value="">{d["instantQuote.bulk.keep"]}</option>
            {catalog.technologies.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </Select>
        )}

        {field(
          d["instantQuote.bulk.material"],
          <Select
            className="!w-36 !py-1.5 !text-xs !text-text-primary"
            value={draft.materialKey}
            disabled={busy}
            onChange={(e) => {
              const next = materials.find((m) => m.key === e.target.value);
              setDraft({
                ...draft,
                materialKey: e.target.value,
                colorKey: next?.colors[0]?.key ?? "",
              });
            }}
          >
            <option value="">{d["instantQuote.bulk.keep"]}</option>
            {materials.map((m) => (
              <option key={`${m.technologyKey}-${m.key}`} value={m.key}>
                {m.name}
              </option>
            ))}
          </Select>
        )}

        {material &&
          field(
            d["instantQuote.bulk.color"],
            <Select
              className="!w-28 !py-1.5 !text-xs !text-text-primary"
              value={draft.colorKey}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, colorKey: e.target.value })}
            >
              {material.colors.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}

        {field(
          d["instantQuote.bulk.finish"],
          <Select
            className="!w-36 !py-1.5 !text-xs !text-text-primary"
            value={draft.finishKey}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, finishKey: e.target.value })}
          >
            <option value="">{d["instantQuote.bulk.keep"]}</option>
            {finishes.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </Select>
        )}

        {field(
          d["instantQuote.bulk.quantity"],
          <input
            type="number"
            min={1}
            max={100000}
            value={draft.quantity}
            disabled={busy}
            placeholder="—"
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
            className="input-base !w-20 !py-1.5 !text-xs !text-text-primary"
          />
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy || !hasPatch}
            onClick={() => {
              onApply(patch);
              setDraft(EMPTY);
            }}
            className="!bg-white !text-ink"
          >
            {d["instantQuote.bulk.apply"]}
          </Button>
          {/* Yıkıcı düğme, yanındaki "Seçimi temizle" ile aynı ağırlıkta
              olamaz: ikisi de aynı satırda, aynı ölçüde ve yalnız metin
              saydamlığıyla ayrılıyordu — mobilde ~28 px'lik iki komşu hedef,
              Türkçe adları da birbirine yakın. Renk ve çerçeve, onay
              diyaloğundan ÖNCE gelen ilk uyarıdır. */}
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="rounded-lg border border-rose-300/50 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/25 hover:text-white disabled:opacity-40"
          >
            {d["instantQuote.bulk.delete"]}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-3 py-2 text-xs text-white/60 hover:text-white"
          >
            {d["instantQuote.bulk.clear"]}
          </button>
        </div>
      </div>
    </div>
  );
}
