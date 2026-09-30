"use client";

import { useState, type JSX } from "react";
import { QUOTE_UNITS } from "@/lib/config/quote-types";
import type {
  FrozenFxRate,
  PresentedCatalog,
  PresentedPart,
  QuoteUnits,
  QuoteViewer,
} from "@/lib/config/quote-types";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { PartPatch } from "@/lib/quote/client-api";
import { QuoteDfmList } from "./dfm-list";
import { fill, decimal2, lineMoney, mm, money } from "./format";
import { QuotePriceBreakTable } from "./price-break-table";
import { useSyncedField } from "./synced-field";

/**
 * Teklifteki tek bir parça.
 *
 * Kartın üç işi var ve üçü de aynı anda görünür durmalı: parçanın NE OLDUĞU
 * (görsel, ad, ölçü), NASIL BASILACAĞI (konfig özeti + uyarılar) ve NE
 * TUTACAĞI (fiyat ya da fiyat kapısı). Bunlardan biri tıklamanın arkasına
 * saklanırsa müşteri yirmi parçalık bir teklifte hangi parçanın sorunlu
 * olduğunu bulamaz.
 *
 * Analiz sürerken ölçü ve fiyat alanı SİLİNMEZ, bulanıklaştırılır: kutu
 * yerinde kalır, ekran zıplamaz ve "burada birazdan bir sayı olacak" bilgisi
 * görünür.
 */

export interface QuotePartCardProps {
  part: PresentedPart;
  catalog: PresentedCatalog;
  viewer: QuoteViewer;
  /** Seçili gösterim biriminin DONMUŞ kuru; `null` = bağlayıcı ₺. */
  rate?: FrozenFxRate | null;
  /**
   * Satır tutarının, teklifin parça ara toplamına AYRILMIŞ döviz değeri
   * (`fxSurface().partLineMinor`). Kartın kendi bağımsız çevrimi yerine bunu
   * basmasının sebebi somut: aynı parça belgenin ikinci kolonunda da duruyor
   * ve iki yüzeyde bir cent ayrışması "tek dikiş" sözünü bozardı.
   */
  lineMinor?: number | null;
  selected: boolean;
  busy?: boolean;
  onSelectChange: (partId: string, selected: boolean) => void;
  onPatch: (partId: string, patch: PartPatch) => void;
  onDuplicate: (partId: string) => void;
  onDelete: (partId: string) => void;
  onOpenViewer: (partId: string) => void;
  onEditConfig: (partId: string) => void;
  /** Fiyat kapısı modalını açar (yalnız `canSeePrices` kapalıyken). */
  onRequestPrices: () => void;
}

function Chip({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="rounded-full bg-bg-muted px-2 py-0.5 text-[11px] text-text-secondary">
      {children}
    </span>
  );
}

export function QuotePartCard({
  part,
  catalog,
  viewer,
  rate = null,
  lineMinor = null,
  selected,
  busy,
  onSelectChange,
  onPatch,
  onDuplicate,
  onDelete,
  onOpenViewer,
  onEditConfig,
  onRequestPrices,
}: QuotePartCardProps): JSX.Element {
  const d = useDictionary();
  const [renaming, setRenaming] = useState(false);
  const config = part.config;
  const disabled = !viewer.canEdit || busy;
  // Kontrollü alanlar: sunucunun yeni değeri gelince eşitlenir, müşteri
  // yazarken ÜZERİNE YAZILMAZ (bkz. `synced-field.ts`).
  const name = useSyncedField(part.name);
  const scale = useSyncedField(String(config.scale));

  const analyzing = part.analysisStatus === "queued" || part.analysisStatus === "analyzing";
  const failed = part.analysisStatus === "failed";
  // STEP'in ölçü birimi DOSYADAN okunur (birim ISO 10303 gereği dosyanın
  // kendisinde yazılıdır ve CAD çekirdeği onu uygular), bu yüzden burada
  // değiştirilemez: "cm" seçmek parçayı 10× büyütür, hacmi 1000× şişirir ve
  // fiyatı 1000× yanlışlardı. Kilit yalnız ekranda değil, uçta ve
  // veritabanında da duruyor (`quote_parts_step_units_chk`) — savunma derinliği.
  const unitsLocked = part.sourceFormat === "step";

  const material = catalog.materials.find(
    (m) => m.key === config.materialKey && m.technologyKey === config.technologyKey
  );
  const color = material?.colors.find((c) => c.key === config.colorKey);
  const finish = catalog.finishes.find((f) => f.key === config.finishKey);

  // Analiz sürerken "birkaç saniye bekleyin" cümlesi iskeletin üstünde zaten
  // yazıyor; aynı şeyi bir de uyarı listesinde tekrarlamak yer kaybı.
  const issues = part.dfm.filter((i) => !(analyzing && i.code === "analysis_pending"));

  const patch = (next: PartPatch) => onPatch(part.id, next);

  return (
    <article
      className={`card overflow-hidden ${selected ? "ring-2 ring-[var(--color-accent)]" : ""}`}
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[auto_104px_minmax(0,1fr)] sm:items-start">
        {viewer.canEdit && (
          <label className="flex items-center gap-2 text-xs text-text-muted sm:pt-1">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-accent)]"
              checked={selected}
              disabled={busy}
              onChange={(e) => onSelectChange(part.id, e.target.checked)}
              aria-label={`${d["instantQuote.part.select"]}: ${part.name}`}
            />
            <span className="sm:hidden">{d["instantQuote.part.select"]}</span>
          </label>
        )}

        {/* Görsel: "fotoğraf" müşterinin dosyayı tanıdığı tek işaret. */}
        <button
          type="button"
          onClick={() => onOpenViewer(part.id)}
          disabled={!part.thumbnailUrl && !part.previewGlbUrl}
          title={d["instantQuote.part.viewModel"]}
          className="group relative h-[104px] w-[104px] overflow-hidden rounded-xl border border-border-default bg-bg-muted disabled:cursor-default"
        >
          {part.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={part.thumbnailUrl}
              alt={part.name}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <span
                className={`h-10 w-10 rounded-lg bg-black/5 ${analyzing ? "animate-pulse" : ""}`}
              />
            </span>
          )}
        </button>

        <div className="min-w-0 space-y-3">
          {/* Ad + eylemler */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              {renaming ? (
                <input
                  autoFocus
                  value={name.value}
                  aria-label={d["instantQuote.part.nameLabel"]}
                  className="input-base !py-1.5 text-sm"
                  onChange={(e) => name.edit(e.target.value)}
                  onBlur={() => {
                    const value = name.value.trim();
                    setRenaming(false);
                    // Boş ad kabul edilmez: alan sunucudaki ada döner.
                    if (!value) {
                      name.discard();
                      return;
                    }
                    name.commit(value);
                    if (value !== part.name) patch({ name: value });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      name.discard();
                      setRenaming(false);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setRenaming(true)}
                  title={d["instantQuote.part.rename"]}
                  className="max-w-full truncate text-left text-sm font-semibold text-text-primary underline-offset-4 hover:underline disabled:no-underline"
                >
                  {part.name}
                </button>
              )}
              <p className="truncate font-mono text-[11px] text-text-muted">{part.fileName}</p>
            </div>

            {viewer.canEdit && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onDuplicate(part.id)}
                  className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-40"
                >
                  {d["instantQuote.part.duplicate"]}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onDelete(part.id)}
                  className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-error-50 hover:text-error disabled:opacity-40"
                >
                  {d["instantQuote.part.delete"]}
                </button>
              </div>
            )}
          </div>

          {/* Ölçüler — analiz sürerken bulanık, yer kaybolmaz */}
          <div className={analyzing ? "select-none opacity-60 blur-[3px]" : undefined}>
            <div className="flex flex-wrap items-center gap-1.5">
              {part.dimensionsMm ? (
                <span className="font-mono text-xs text-text-primary">
                  {fill(d["instantQuote.part.dimensions"], {
                    x: mm(part.dimensionsMm.x),
                    y: mm(part.dimensionsMm.y),
                    z: mm(part.dimensionsMm.z),
                  })}
                </span>
              ) : (
                <span className="font-mono text-xs text-text-muted">— × — × — mm</span>
              )}
              {part.volumeCm3 !== null && (
                <Chip>
                  {fill(d["instantQuote.part.volume"], { cm3: decimal2(part.volumeCm3) })}
                </Chip>
              )}
              {part.bodyCount !== null && part.bodyCount > 1 && (
                <Chip>{fill(d["instantQuote.part.bodyCount"], { count: part.bodyCount })}</Chip>
              )}
            </div>
          </div>

          {analyzing && (
            <p className="text-xs text-text-secondary">{d["instantQuote.part.analyzing"]}</p>
          )}

          {/* Üçgenleme sapması satılan şeyin NİTELİĞİdir, bir fiyat değil:
              fiyat kapısı kapalı izleyici de, paylaşım bağlantısını açan da
              görür (aynı cümle teklif belgesinde de yazılı). Koşul DEĞERE
              bakar, biçime değil: üçgenleri dosyadan gelen bir parçada alan
              null'dır ve satır hiç çizilmez. */}
          {part.tessellationMm !== null && (
            <p className="text-[11px] text-text-muted">
              {fill(d["instantQuote.part.stepTessellation"], {
                mm: decimal2(part.tessellationMm),
              })}
            </p>
          )}

          {/* Birim + ölçek: dosyanın birimi yanlışsa her sayı yanlıştır, bu
              yüzden konfig panelinin içine gömülmez, kartta durur. */}
          {viewer.canEdit && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-text-muted">
                    {d["instantQuote.part.units"]}
                  </span>
                  <select
                    className="input-base !w-20 !py-1.5 text-xs"
                    value={config.units}
                    disabled={disabled || unitsLocked}
                    onChange={(e) => patch({ units: e.target.value as QuoteUnits })}
                  >
                    {QUOTE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-text-muted">
                    {d["instantQuote.part.scale"]}
                  </span>
                  <input
                    type="number"
                    min={0.01}
                    max={100}
                    step={0.01}
                    value={scale.value}
                    disabled={disabled}
                    className="input-base !w-24 !py-1.5 text-xs tabular-nums"
                    onChange={(e) => scale.edit(e.target.value)}
                    onBlur={() => {
                      const next = Number(scale.value);
                      // Aralık dışı ya da okunamayan giriş sunucuya GİTMEZ; alan
                      // geçerli değere döner.
                      if (!Number.isFinite(next) || next < 0.01 || next > 100) {
                        scale.discard();
                        return;
                      }
                      // `String(next)` yazımı normalleştirir ("1,50" değil "1.5"),
                      // yani inen prop ile karşılaştırma tutar.
                      scale.commit(String(next));
                      if (next !== config.scale) patch({ scale: next });
                    }}
                  />
                </label>
                {/* Birim ÖNERİSİ çipi STEP parçasında kendiliğinden susar ve bu
                    bir KURALDIR, tesadüf değil: `suggestUnits` ilk satırda
                    `sourceUnits`i döndürüyor (`quote-units.ts`), STEP'te o daima
                    "mm" ve seçili birim de mm'ye kilitli — koşul asla tutmaz.
                    Mesh dosyaları birimsizdir (`sourceUnits = null`) ve orada
                    "sayılar şüpheli derecede küçük" sezgisi çalışmaya devam
                    eder. Yani burada eklenecek bir kod yok, korunacak bir
                    değişmez var. */}
                {part.suggestedUnits && part.suggestedUnits !== config.units && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => patch({ units: part.suggestedUnits as QuoteUnits })}
                    className="rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 text-[11px] text-ink-2 disabled:opacity-40"
                  >
                    {fill(d["instantQuote.part.unitsSuggestion"], { units: part.suggestedUnits })}
                  </button>
                )}
              </div>
              {unitsLocked && (
                <p className="text-[11px] text-text-muted">
                  {d["instantQuote.part.stepUnitsLocked"]}
                </p>
              )}
            </div>
          )}

          {/* Konfig özeti */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <Spec label={d["instantQuote.part.config.material"]}>
              {material?.name ?? (
                <span className="text-error">
                  {d["instantQuote.part.config.materialPlaceholder"]}
                </span>
              )}
            </Spec>
            <Spec label={d["instantQuote.part.config.color"]}>{color?.name ?? "—"}</Spec>
            <Spec label={d["instantQuote.part.config.finish"]}>{finish?.name ?? "—"}</Spec>
            {config.layerUm !== null && (
              <Spec label={d["instantQuote.part.config.layer"]}>
                {fill(d["instantQuote.part.config.layerValue"], { um: config.layerUm })}
              </Spec>
            )}
            {config.infillPct !== null && (
              <Spec label={d["instantQuote.part.config.infill"]}>
                {fill(d["instantQuote.part.config.infillValue"], { pct: config.infillPct })}
              </Spec>
            )}
            <Spec label={d["instantQuote.part.config.quantity"]}>{config.quantity}</Spec>
          </dl>

          {part.note && <p className="text-xs text-text-secondary">{part.note}</p>}

          {viewer.canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onEditConfig(part.id)}
              className="btn-secondary !px-4 !py-2 text-xs"
            >
              {d["instantQuote.part.config.edit"]}
            </button>
          )}

          <QuoteDfmList
            issues={issues}
            catalog={catalog}
            rate={rate}
            warningKey={part.dfmWarningKey}
            acknowledged={part.dfmAcknowledged}
            disabled={disabled}
            onAcknowledge={
              viewer.canEdit
                ? (next) => patch({ dfmAckKey: next ? part.dfmWarningKey : null })
                : undefined
            }
            onEditConfig={viewer.canEdit ? () => onEditConfig(part.id) : undefined}
          />
        </div>
      </div>

      {/* Fiyat şeridi: kartın altında, her parçada aynı yerde. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-default bg-bg-surface px-4 py-3">
        <PriceBlock
          part={part}
          rate={rate}
          lineMinor={lineMinor}
          canSeePrices={viewer.canSeePrices}
          analyzing={analyzing}
          failed={failed}
          onRequestPrices={onRequestPrices}
        />
      </div>
    </article>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-text-muted">{label}</dt>
      <dd className="truncate text-text-primary">{children}</dd>
    </div>
  );
}

function PriceBlock({
  part,
  rate,
  lineMinor,
  canSeePrices,
  analyzing,
  failed,
  onRequestPrices,
}: {
  part: PresentedPart;
  rate: FrozenFxRate | null;
  lineMinor: number | null;
  canSeePrices: boolean;
  analyzing: boolean;
  failed: boolean;
  onRequestPrices: () => void;
}): JSX.Element {
  const d = useDictionary();

  if (!canSeePrices) {
    // Fiyat kapısı: sunucu zaten hiçbir fiyat alanı göndermedi. Yer tutucu
    // RAKAM İÇERMEZ (`instantQuote.price.hidden`), yoksa "tahmin" gibi okunur.
    return (
      <>
        <span className="font-mono text-lg text-text-muted">
          {d["instantQuote.price.hidden"]}
        </span>
        <button type="button" onClick={onRequestPrices} className="btn-primary !px-4 !py-2 text-xs">
          {d["instantQuote.price.see"]}
        </button>
      </>
    );
  }

  if (part.price) {
    return (
      <>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span>
            <span className="mr-1.5 text-[11px] text-text-muted">
              {d["instantQuote.price.unit"]}
            </span>
            <span className="text-base font-semibold tabular-nums text-text-primary">
              {money(part.price.unitKurus, rate)}
            </span>
          </span>
          <span>
            <span className="mr-1.5 text-[11px] text-text-muted">
              {d["instantQuote.price.line"]}
            </span>
            <span className="text-base font-semibold tabular-nums text-text-primary">
              {lineMoney(part.price.lineKurus, lineMinor, rate)}
            </span>
          </span>
          {part.price.source === "manual" && (
            <span className="rounded-full bg-bg-muted px-2 py-0.5 text-[11px] text-text-secondary">
              {d["instantQuote.part.badge.manualPriced"]}
            </span>
          )}
        </div>
        {part.price.priceBreaks.length > 1 && (
          <details className="w-full sm:w-auto">
            <summary className="cursor-pointer text-xs text-text-secondary underline-offset-2 hover:underline">
              {d["instantQuote.price.breaks"]}
            </summary>
            <div className="mt-2 sm:w-64">
              <QuotePriceBreakTable
                breaks={part.price.priceBreaks}
                quantity={part.config.quantity}
                rate={rate}
              />
            </div>
          </details>
        )}
      </>
    );
  }

  // Fiyat görebiliyor ama parçanın fiyatı YOK: sebebi hâline göre değişir ve
  // "manuel fiyat bekliyor" rozetini yalnız gerçekten bekleyen parça alır
  // (analizi süren ya da okunamayan dosya beklemiyor; birinin çözümü sabır,
  // diğerininki dosyayı yeniden yüklemek).
  if (analyzing) {
    return (
      <span className="text-xs text-text-secondary">
        {d["instantQuote.part.badge.analyzing"]}
      </span>
    );
  }
  if (failed) {
    return (
      <span className="text-xs text-error">{d["instantQuote.part.badge.failed"]}</span>
    );
  }
  // Ne fiyatı var ne de bekleyen bir manuel fiyat: nadir bir ara hâl (yeniden
  // hesaplanıyor). Boş bir şerit "bozuk" görünürdü, nötr bir çizgi görünmez.
  if (!part.needsManualPrice) {
    return <span className="font-mono text-sm text-text-muted">—</span>;
  }
  return (
    <span className="rounded-full bg-warning-50 px-2.5 py-1 text-xs text-ink-2">
      {d["instantQuote.part.badge.manualPrice"]}
    </span>
  );
}
