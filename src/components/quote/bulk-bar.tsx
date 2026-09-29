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
 *
 * **Telefonda yükseklik bir bütçedir.** Çubuk yapışkandır: kapladığı her piksel
 * parça listesinden kalıcı olarak düşer. Sayaç, beş alan ve üç düğme TEK bir
 * `flex-wrap` sırasındayken 390×844 görünümde 261,5 px (ekranın %31'i)
 * ölçüldü. Bu yüzden düzen ikiye ayrıldı: üstte sarmalamayan TEK satırlık
 * eylem şeridi (sayaç + uygula + iki simge düğme), altında yatay KAYAN alan
 * dizisi. Alan sayısı artsa bile yükseklik sabit kalır — sarmalama yok.
 * Simgeye inen düğmeler adlarını `aria-label` ile korur ve `sm:`den itibaren
 * yazıyı da gösterir.
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
    <label className="block shrink-0">
      <span className="mb-1 block text-[11px] leading-4 text-white/60">{label}</span>
      {node}
    </label>
  );

  return (
    <div className="sticky bottom-3 z-30 rounded-2xl bg-ink p-3 text-white shadow-elevated">
      {/* Eylem şeridi: sayaç ve üç düğme TEK satırda; sayaç `truncate` ile
          büzülür, düğmeler `shrink-0` ile bozulmaz. */}
      <div className="flex items-center gap-2">
        <p className="mr-auto min-w-0 truncate text-xs font-medium sm:text-sm">
          {fill(d["instantQuote.bulk.selected"], { count: selectedIds.length })}
        </p>

        <Button
          type="button"
          size="sm"
          disabled={busy || !hasPatch}
          onClick={() => {
            onApply(patch);
            setDraft(EMPTY);
          }}
          className="shrink-0 !bg-white !px-3 !text-ink"
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
          aria-label={d["instantQuote.bulk.delete"]}
          title={d["instantQuote.bulk.delete"]}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-300/50 px-2.5 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/25 hover:text-white disabled:opacity-40"
        >
          <TrashIcon />
          <span className="hidden sm:inline">{d["instantQuote.bulk.delete"]}</span>
        </button>

        <button
          type="button"
          onClick={onClear}
          aria-label={d["instantQuote.bulk.clear"]}
          title={d["instantQuote.bulk.clear"]}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-white/60 hover:text-white"
        >
          <CloseIcon />
          <span className="hidden sm:inline">{d["instantQuote.bulk.clear"]}</span>
        </button>
      </div>

      {/* Alan dizisi: sarmalamaz, KAYAR. Yükseklik alan sayısından bağımsız
          kalır; telefonda tek alan sırası yüksekliğindedir. */}
      <div className="mt-2 flex items-end gap-2 overflow-x-auto pb-1">
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
      </div>
    </div>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v5M14 11v5" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
