"use client";

import { useRef, useState, type JSX } from "react";
import { Button, Select, Textarea } from "@/components/ui";
import type {
  MaterialProperties,
  PresentedCatalog,
  PresentedPart,
  PresentedQuote,
} from "@/lib/config/quote-types";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useDictionary } from "@/lib/i18n/locale-context";
import {
  partDrawingUrl,
  removePartDrawing,
  uploadPartDrawing,
  QuoteApiError,
} from "@/lib/quote/client-api";
import type { PartPatch } from "@/lib/quote/client-api";
import { fill } from "./format";
import { QuoteModal } from "./modal-shell";

/**
 * "Özellikleri düzenle" paneli: parçanın teknoloji / malzeme / renk / yüzey /
 * katman / doluluk / adet / not / teknik çizim / kritik tolerans seçimleri.
 *
 * Her seçim ANINDA yazılır (`PATCH …/parts/[partId]`), çünkü fiyat her
 * değişiklikte yenilenir — "Kaydet" düğmesi bekleyen bir panel, müşteriye
 * seçiminin fiyata etkisini ancak paneli kapattıktan sonra gösterirdi.
 *
 * Teknoloji değişince malzeme/renk/yüzey/katman/doluluk varsayılanlarını
 * SUNUCU atar (`resolveConfig`); panel yalnız `technologyKey` gönderir.
 * Malzeme değişiminde ise renk ELDE KONTROL EDİLİR: yeni malzemede o renk
 * yoksa uç 400 verirdi, bu yüzden ikisi tek istekte gider.
 */

function propertyLines(d: Dictionary, props: MaterialProperties): string[] {
  const lines: string[] = [];
  if (props.tensileMpa !== undefined) {
    lines.push(`${d["instantQuote.part.config.prop.tensile"]}: ${props.tensileMpa} MPa`);
  }
  if (props.elongationPct !== undefined) {
    lines.push(`${d["instantQuote.part.config.prop.elongation"]}: %${props.elongationPct}`);
  }
  if (props.heatDeflectionC !== undefined) {
    lines.push(`${d["instantQuote.part.config.prop.heat"]}: ${props.heatDeflectionC} °C`);
  }
  if (props.flexible) lines.push(d["instantQuote.part.config.prop.flexible"]);
  if (props.transparent) lines.push(d["instantQuote.part.config.prop.transparent"]);
  if (props.uses?.length) {
    lines.push(`${d["instantQuote.part.config.prop.uses"]}: ${props.uses.join(", ")}`);
  }
  return lines;
}

export interface QuotePartConfigPanelProps {
  quoteId: string;
  /** null = panel kapalı. */
  part: PresentedPart | null;
  catalog: PresentedCatalog;
  canEdit: boolean;
  shareToken?: string | null;
  busy?: boolean;
  onClose: () => void;
  onPatch: (partId: string, patch: PartPatch) => void;
  /** Çizim yüklemesi/silmesi teklifin taze gövdesini döndürür. */
  onQuoteChanged: (quote: PresentedQuote) => void;
}

export function QuotePartConfigPanel({
  quoteId,
  part,
  catalog,
  canEdit,
  shareToken,
  busy,
  onClose,
  onPatch,
  onQuoteChanged,
}: QuotePartConfigPanelProps): JSX.Element | null {
  const d = useDictionary();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drawingBusy, setDrawingBusy] = useState(false);
  const [drawingError, setDrawingError] = useState<string | null>(null);

  if (!part) return null;

  const config = part.config;
  const technology = catalog.technologies.find((t) => t.key === config.technologyKey);
  const materials = catalog.materials.filter((m) => m.technologyKey === config.technologyKey);
  const material = materials.find((m) => m.key === config.materialKey);
  const finishes = catalog.finishes.filter(
    (f) => f.technologyKey === null || f.technologyKey === config.technologyKey
  );
  const disabled = !canEdit || busy;

  const patch = (next: PartPatch) => onPatch(part.id, next);

  async function handleDrawing(file: File | null) {
    if (!part) return;
    setDrawingError(null);
    setDrawingBusy(true);
    try {
      const fresh = file
        ? await uploadPartDrawing(quoteId, part.id, file, { shareToken })
        : await removePartDrawing(quoteId, part.id, { shareToken });
      onQuoteChanged(fresh);
    } catch (e) {
      setDrawingError(e instanceof QuoteApiError ? e.message : d["common.error"]);
    } finally {
      setDrawingBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <QuoteModal
      open
      onClose={onClose}
      title={`${part.name} · ${d["instantQuote.part.config.title"]}`}
      widthClass="max-w-3xl"
    >
      <div className="space-y-6 p-5">
        {/* Teknoloji: sekme değil SEÇİM — malzeme, katman ve doluluk listesini
            komple değiştirdiği için en üstte ve en görünür yerde durur. */}
        <fieldset>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            {d["instantQuote.part.config.technology"]}
          </legend>
          <div className="flex flex-wrap gap-2">
            {catalog.technologies.map((tech) => {
              const active = tech.key === config.technologyKey;
              return (
                <button
                  key={tech.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => patch({ technologyKey: tech.key })}
                  aria-pressed={active}
                  className={`rounded-xl border px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                    active
                      ? "border-ink bg-ink text-white"
                      : "border-border-default bg-bg-base hover:border-ink/40"
                  }`}
                >
                  <span className="block font-medium">{tech.name}</span>
                  <span
                    className={`block text-xs ${active ? "text-white/70" : "text-text-muted"}`}
                  >
                    {tech.buildMm.x} × {tech.buildMm.y} × {tech.buildMm.z} mm
                  </span>
                </button>
              );
            })}
          </div>
          {technology && (
            <p className="mt-2 text-xs text-text-muted">{technology.toleranceText}</p>
          )}
        </fieldset>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Malzeme + renk */}
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                {d["instantQuote.part.config.material"]}
              </legend>
              <div className="space-y-2">
                {materials.map((m) => {
                  const active = m.key === config.materialKey;
                  const lines = propertyLines(d, m.properties);
                  return (
                    <div
                      key={m.key}
                      className={`rounded-xl border p-3 transition-colors ${
                        active ? "border-ink bg-bg-elevated" : "border-border-default"
                      }`}
                    >
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="radio"
                          name={`material-${part.id}`}
                          className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                          checked={active}
                          disabled={disabled}
                          onChange={() => {
                            // Renk yeni malzemede yoksa ilk rengine geçilir:
                            // uç geçersiz rengi 400 ile reddeder.
                            const keepColor = m.colors.some((c) => c.key === config.colorKey);
                            patch({
                              materialKey: m.key,
                              ...(keepColor ? {} : { colorKey: m.colors[0]?.key }),
                            });
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-text-primary">
                            {m.name}
                          </span>
                          <span className="block text-xs text-text-secondary">
                            {m.description}
                          </span>
                        </span>
                      </label>
                      {lines.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-text-muted underline-offset-2 hover:underline">
                            {d["instantQuote.part.config.materialProperties"]}
                          </summary>
                          <ul className="mt-1.5 space-y-0.5 text-xs text-text-secondary">
                            {lines.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  );
                })}
                {!material && (
                  <p className="rounded-lg border border-error/40 bg-error-50 px-3 py-2 text-xs text-error-700">
                    {d["instantQuote.dfm.config_invalid"]}
                  </p>
                )}
              </div>
            </fieldset>

            {material && (
              <fieldset>
                <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                  {d["instantQuote.part.config.color"]}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {material.colors.map((c) => {
                    const active = c.key === config.colorKey;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        disabled={disabled}
                        aria-pressed={active}
                        title={c.name}
                        onClick={() => patch({ colorKey: c.key })}
                        className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition-colors disabled:opacity-50 ${
                          active ? "border-ink bg-bg-elevated" : "border-border-default"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="h-5 w-5 rounded-full border border-black/10"
                          style={{ backgroundColor: c.hex }}
                        />
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>

          {/* Yüzey, katman, doluluk, adet */}
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                {d["instantQuote.part.config.finish"]}
              </legend>
              <div className="space-y-1.5">
                {finishes.map((f) => (
                  <label
                    key={f.key}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
                      f.key === config.finishKey
                        ? "border-ink bg-bg-elevated"
                        : "border-border-default"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`finish-${part.id}`}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                      checked={f.key === config.finishKey}
                      disabled={disabled}
                      onChange={() => patch({ finishKey: f.key })}
                    />
                    <span className="min-w-0 flex-1">{f.name}</span>
                    {f.requiresManual && (
                      <span className="shrink-0 rounded-full bg-warning-50 px-2 py-0.5 text-[11px] text-ink-2">
                        {d["instantQuote.part.config.finishManualBadge"]}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              {/* Katman/doluluk listesi TEKNOLOJİDEN gelir; SLA'da doluluk
                  seçeneği yoktur ve alan hiç çizilmez. */}
              {technology && technology.layerOptionsUm.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-secondary">
                    {d["instantQuote.part.config.layer"]}
                  </span>
                  <Select
                    value={config.layerUm ?? ""}
                    disabled={disabled}
                    onChange={(e) => patch({ layerUm: Number(e.target.value) })}
                  >
                    {technology.layerOptionsUm.map((um) => (
                      <option key={um} value={um}>
                        {fill(d["instantQuote.part.config.layerValue"], { um })}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {technology?.infillOptionsPct && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-secondary">
                    {d["instantQuote.part.config.infill"]}
                  </span>
                  <Select
                    value={config.infillPct ?? ""}
                    disabled={disabled}
                    onChange={(e) => patch({ infillPct: Number(e.target.value) })}
                  >
                    {technology.infillOptionsPct.map((pct) => (
                      <option key={pct} value={pct}>
                        {fill(d["instantQuote.part.config.infillValue"], { pct })}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">
                {d["instantQuote.part.config.quantity"]}
              </span>
              <QuantityStepper
                value={config.quantity}
                disabled={disabled}
                onChange={(quantity) => patch({ quantity })}
              />
            </label>
          </div>
        </div>

        {/* Not, çizim, kritik tolerans */}
        <div className="space-y-4 border-t border-border-default pt-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-secondary">
              {d["instantQuote.part.config.note"]}
            </span>
            <Textarea
              rows={2}
              defaultValue={part.note ?? ""}
              disabled={disabled}
              placeholder={d["instantQuote.part.config.notePlaceholder"]}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== (part.note ?? "")) patch({ note: value || null });
              }}
            />
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-text-secondary">
              {d["instantQuote.part.config.drawing"]}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (file) void handleDrawing(file);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled || drawingBusy}
                onClick={() => fileRef.current?.click()}
              >
                {d["instantQuote.part.config.drawingUpload"]}
              </Button>
              {part.drawingName && (
                <>
                  {/* Yüklenen çizim AÇILABİLİR olmalı: müşteri doğru dosyayı
                      gönderdiğini ancak açarak doğrular (uç yalnız sahibe ve
                      admine verir). */}
                  <a
                    href={partDrawingUrl(quoteId, part.id, shareToken)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-text-secondary underline underline-offset-2"
                  >
                    {part.drawingName}
                  </a>
                  <button
                    type="button"
                    disabled={disabled || drawingBusy}
                    onClick={() => void handleDrawing(null)}
                    className="text-xs text-text-muted underline underline-offset-2 hover:text-error"
                  >
                    {d["instantQuote.part.config.drawingRemove"]}
                  </button>
                </>
              )}
            </div>
            {drawingError && <p className="mt-1.5 text-xs text-error">{drawingError}</p>}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              checked={config.criticalTolerance}
              disabled={disabled}
              onChange={(e) => patch({ criticalTolerance: e.target.checked })}
            />
            <span className="text-text-secondary">
              {d["instantQuote.part.config.criticalTolerance"]}
            </span>
          </label>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={onClose} size="sm">
            {d["instantQuote.part.config.done"]}
          </Button>
        </div>
      </div>
    </QuoteModal>
  );
}

/**
 * Adet: artı/eksi + serbest yazım. Yazarken değil BLUR'da gönderilir —
 * "1" silinip "25" yazılırken her tuşta bir fiyat isteği çıkmasın.
 */
export function QuantityStepper({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  // Dışarıdan gelen değer değişince (uç yuvarladı, toplu işlem uyguladı)
  // taslak metin onunla eşitlenir; ayrı bir efekte gerek yok.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  const commit = (next: number) => {
    const clamped = Math.min(100000, Math.max(1, Math.round(next)));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-lg border border-border-default">
      <button
        type="button"
        aria-label="−"
        disabled={disabled || value <= 1}
        onClick={() => commit(value - 1)}
        className="px-3 text-lg leading-none text-text-secondary disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        min={1}
        max={100000}
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(Number(draft) || value)}
        className="w-16 border-x border-border-default bg-transparent py-2 text-center text-sm tabular-nums outline-none"
      />
      <button
        type="button"
        aria-label="+"
        disabled={disabled}
        onClick={() => commit(value + 1)}
        className="px-3 text-lg leading-none text-text-secondary disabled:opacity-40"
      >
        +
      </button>
    </span>
  );
}
