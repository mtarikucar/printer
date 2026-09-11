"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import type { NetworkMapData, PublicPartner } from "@/lib/config/network-map";
import { PixelGrid } from "@/components/marketplace/pixel-grid";
import {
  TurkeyMapSvg,
  provinceCenterPercent,
  type MapMarker,
} from "@/components/turkey-map/turkey-map-svg";

/**
 * Anasayfanın üretim ağı bölümü: Türkiye haritası + yanında partner paneli.
 *
 * Metinler sözlükten gelir (`network.*`), vitrinin geri kalanı gibi. Site şu an
 * yalnız Türkçe, ama İngilizce `enabledLocales`'e geri eklendiğinde bu bölüm
 * Türkçe kalmamalı.
 *
 * Renk rampası BEYAZ tabanlıdır, `ink-2` değil: koyu kartta #2A2B30 kontur
 * 1.4:1 kontrastla görünmez kalıyordu, ülke silueti kayboluyordu.
 *
 * Etkileşim sözleşmesi (belirsizlik bırakmadan):
 * - hover = GEÇİCİ önizleme, imleç çıkınca geri alınır.
 * - tık/dokunuş = KALICI seçim; Escape ya da "Temizle" siler.
 * - pin tıklaması = il tıklaması (pinler pointer-events: none).
 * - panelde partner satırı → o partnerin etki alanı haritada vurgulanır.
 * - Hiçbir şey seçili değilken panel BOŞ DEĞİL: lejant + istatistik + ipucu.
 */

const FILL = {
  /** Ağın ulaşmadığı il. Rampanın tabanı — hiçbir durum bunun altına inmez.
      Sıfıra yakın bir dolgu ülkenin siluetini yok ediyordu: kapsanan iller koyu
      bir boşlukta yüzen lekelere dönüşüyor, Türkiye Türkiye gibi okunmuyordu. */
  idle: "rgba(255,255,255,0.08)",
  covered1: "rgba(34,228,255,0.22)",
  covered2: "rgba(34,228,255,0.42)",
  focus: "rgba(34,228,255,0.58)",
} as const;

const STROKE = {
  idle: "rgba(255,255,255,0.24)",
  active: "rgba(34,228,255,0.85)",
  home: "rgba(255,255,255,0.55)",
} as const;

const KIND_COLOR = { manufacturer: "#22E4FF", painter: "#F5B54B" } as const;

/** Sözlük şablonundaki `{n}` gibi yer tutucuları doldurur. */
function fmt(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), template);
}

// Public payload KİMLİK İÇERMEZ (bkz. lib/config/network-map.ts) — partnerler
// türleriyle anılır. Harita "kim" sorusunu değil, "nerede üretim var ve buraya
// kim hizmet veriyor" sorusunu yanıtlar.
function partnerLabel(p: PublicPartner, d: Dictionary): string {
  return p.kind === "manufacturer" ? d["network.kind.manufacturer"] : d["network.kind.painter"];
}

function materialLabel(m: string, d: Dictionary): string {
  if (m === "resin") return d["network.material.resin"];
  if (m === "filament") return d["network.material.filament"];
  return m;
}

export function NetworkMapSection({ data }: { data: NetworkMapData }) {
  const d = useDictionary();
  const { partners, provinces, stats } = data;

  const [selectedIl, setSelectedIl] = useState<string | null>(null);
  const [pinnedPartner, setPinnedPartner] = useState<number | null>(null);
  const [hoverIl, setHoverIl] = useState<string | null>(null);
  const [hoverPartner, setHoverPartner] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const didSelect = useRef(false);

  // HARİTA vurgusu geçici önizlemeyi de dinler; PANEL yalnız kalıcı seçimi.
  //
  // Panel de hover'a bağlanınca şu tuzağa düşülüyordu: satırın üzerine gelmek
  // ProvinceCard'ı söküp yerine PartnerCard'ı koyuyor, sökülen düğüm artık
  // mouseleave/blur ALAMADIĞI için önizleme sonsuza dek kilitleniyordu (liste
  // bir daha geri gelmiyordu). Klavyede daha da kötüsü: odak <body>'ye
  // düşüyordu. Vurguyu haritada bırakıp paneli tıklamaya bağlamak bu sınıf
  // hatayı yapısal olarak imkânsız kılar.
  const highlightPartner = hoverPartner ?? pinnedPartner;
  const focusCoverage = useMemo(
    () => (highlightPartner === null ? null : new Set(partners[highlightPartner]?.coverage ?? [])),
    [highlightPartner, partners]
  );

  // Ağın DOKUNDUĞU her il: atölyesi olan + yalnızca hizmet verilen. Klavye
  // gezinmesi ve mobil seçici bunu kullanır — fareyle tıklanabilen ama klavyeyle
  // ulaşılamayan il kalmamalı (roving tabindex olduğu için liste uzasa da sekme
  // durağı yine tektir).
  const networkProvinces = useMemo(
    () =>
      Object.keys(provinces)
        .filter((il) => provinces[il].located.length > 0 || provinces[il].covered.length > 0)
        .sort((a, b) => a.localeCompare(b, "tr")),
    [provinces]
  );

  // Yalnız atölyesi olan iller — pinler buraya konur.
  const locatedProvinces = useMemo(
    () =>
      Object.keys(provinces)
        .filter((il) => provinces[il].located.length > 0)
        .sort((a, b) => a.localeCompare(b, "tr")),
    [provinces]
  );

  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    for (const il of locatedProvinces) {
      for (const kind of ["manufacturer", "painter"] as const) {
        const count = provinces[il].located.filter((i) => partners[i].kind === kind).length;
        if (count > 0) out.push({ il, kind, count });
      }
    }
    return out;
  }, [locatedProvinces, provinces, partners]);

  // Seçim mobilde haritanın ALTINDAKİ paneli değiştirir; ekranı kaydırmazsak
  // kullanıcı dokunur ve hiçbir şey olmamış gibi görünür.
  useEffect(() => {
    if (!didSelect.current) return;
    didSelect.current = false;
    if (selectedIl || pinnedPartner !== null) {
      panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIl, pinnedPartner]);

  function selectIl(il: string) {
    didSelect.current = true;
    setPinnedPartner(null);
    setSelectedIl((cur) => (cur === il ? null : il));
  }

  function clearAll() {
    setSelectedIl(null);
    setPinnedPartner(null);
    setHoverPartner(null);
  }

  function fillFor(il: string): string {
    if (focusCoverage) return focusCoverage.has(il) ? FILL.focus : FILL.idle;
    const covered = provinces[il]?.covered.length ?? 0;
    if (covered === 0) return FILL.idle;
    return covered === 1 ? FILL.covered1 : FILL.covered2;
  }

  function strokeFor(il: string, hovered: boolean, selected: boolean): string {
    if (selected || hovered) return STROKE.active;
    if (focusCoverage && partners[highlightPartner!]?.il === il) return STROKE.home;
    if ((provinces[il]?.located.length ?? 0) > 0) return STROKE.home;
    return STROKE.idle;
  }

  const tooltipIl = hoverIl;
  const tooltipPos = tooltipIl ? provinceCenterPercent(tooltipIl) : null;

  // Sıfır olan segment hiç yazılmaz: küçük bir ağda "0 boyacı" başlıkla çelişir.
  const statSegments = [
    stats.coveredProvinces > 0 ? fmt(d["network.stat.covered"], { n: stats.coveredProvinces }) : null,
    stats.homeProvinces > 0 ? fmt(d["network.stat.home"], { n: stats.homeProvinces }) : null,
    d["network.stat.shipping"],
  ].filter(Boolean) as string[];

  return (
    <section className="mx-auto max-w-6xl px-0 pt-10 sm:px-4">
      <div className="relative overflow-hidden border-y border-white/10 bg-ink sm:rounded-3xl sm:border-x sm:shadow-[0_28px_70px_-28px_rgba(6,38,47,0.55)]">
        <PixelGrid light />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/3 h-64 w-[36rem] max-w-full rounded-full bg-accent/20 blur-[90px]"
        />

        <div className="relative px-5 pt-8 sm:px-8 sm:pt-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-green-300">
            {fmt(d["network.eyebrow"], { n: stats.coveredProvinces })}
          </p>
          <h2
            className="mt-2 max-w-xl text-3xl leading-tight text-white md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {d["network.title"]}
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/70">{d["network.sub"]}</p>
        </div>

        <div className="relative mt-6 grid gap-6 px-3 pb-8 sm:px-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,20rem)] lg:gap-8">
          {/* ── Harita ── */}
          <div>
            {/* Tooltip yüzdesi SVG kutusuna göre hesaplanır; konumlandırma
                bağlamı bu yüzden SADECE haritayı sarmalı. Mobil il seçici de bu
                kutunun içinde olsaydı (lg altında ~54px daha uzun) her tooltip
                y-oranıyla orantılı olarak aşağı kayardı. */}
            <div className="relative">
              <TurkeyMapSvg
                className="w-full"
                ariaLabel={d["network.mapLabel"]}
                markers={markers}
                pulse
                focusOrder={networkProvinces}
                selected={selectedIl}
                hovered={hoverIl}
                onSelect={selectIl}
                onHover={setHoverIl}
                onEscape={clearAll}
                isInteractive={(il) => networkProvinces.includes(il)}
                ariaLabelFor={(il) =>
                  fmt(d["network.provinceAria"], {
                    il,
                    located: provinces[il]?.located.length ?? 0,
                    covering: provinces[il]?.covered.length ?? 0,
                  })
                }
                provinceStyle={(il, s) => ({
                  fill: fillFor(il),
                  stroke: strokeFor(il, s.hovered, s.selected),
                  strokeWidth: s.selected || s.hovered ? 1.4 : 0.75,
                  cursor: s.interactive ? "pointer" : "default",
                  transition: "fill 180ms ease, stroke 180ms ease",
                })}
                style={{ color: STROKE.active }}
              />

              {tooltipIl && tooltipPos && (
                <div
                  className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded-lg border border-white/15 bg-black/90 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg backdrop-blur-sm"
                  style={{ left: `${tooltipPos.left}%`, top: `${tooltipPos.top}%` }}
                >
                  <span className="font-semibold">{tooltipIl}</span>
                  <span className="ml-1.5 text-white/60">
                    {(provinces[tooltipIl]?.located.length ?? 0) > 0
                      ? fmt(d["network.tooltip.located"], { n: provinces[tooltipIl].located.length })
                      : fmt(d["network.tooltip.covering"], {
                          n: provinces[tooltipIl]?.covered.length ?? 0,
                        })}
                  </span>
                </div>
              )}
            </div>

            {/* Mobilde harita bir GÖSTERGE değil görseldir: 360px'te Yalova
                birkaç piksel, İstanbul çevresindeki pinler üst üste biner.
                Birincil kontrol bu seçici. */}
            <div className="mt-3 px-2 lg:hidden">
              <label className="sr-only" htmlFor="network-map-il">
                {d["network.selectLabel"]}
              </label>
              <select
                id="network-map-il"
                value={selectedIl ?? ""}
                onChange={(e) => (e.target.value ? selectIl(e.target.value) : clearAll())}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus-visible:border-accent"
              >
                <option value="">{d["network.selectPlaceholder"]}</option>
                {networkProvinces.map((il) => (
                  <option key={il} value={il} className="text-black">
                    {il}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Panel ── */}
          <div ref={panelRef} className="px-2 pb-20 sm:px-0 lg:pb-0">
            <div aria-live="polite">
              {pinnedPartner !== null && partners[pinnedPartner] ? (
                <PartnerCard
                  partner={partners[pinnedPartner]}
                  onBack={() => {
                    setPinnedPartner(null);
                    setHoverPartner(null);
                  }}
                />
              ) : selectedIl ? (
                <ProvinceCard
                  il={selectedIl}
                  data={data}
                  onPick={(i) => {
                    didSelect.current = true;
                    setPinnedPartner(i);
                  }}
                  onPreview={setHoverPartner}
                  onClear={clearAll}
                />
              ) : (
                <IdleCard stats={statSegments} />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Boşta: lejant + istatistik. Panel ilk boyamada boş bir sütun olmamalı. ── */
function IdleCard({ stats }: { stats: string[] }) {
  const d = useDictionary();
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <ul className="space-y-2.5 text-sm text-white/80">
        {stats.map((s) => (
          <li key={s} className="flex items-center gap-2.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
            {s}
          </li>
        ))}
      </ul>

      <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-xs text-white/60">
        <p className="flex items-center gap-2">
          <Dot color={KIND_COLOR.manufacturer} /> {d["network.kind.manufacturer"]}
        </p>
        <p className="flex items-center gap-2">
          <Dot color={KIND_COLOR.painter} /> {d["network.kind.painter"]}
        </p>
        <p className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-3 w-5 rounded-sm border border-white/20"
            style={{ background: FILL.covered2 }}
          />
          {d["network.legend.covered"]}
        </p>
      </div>

      <p className="mt-5 text-xs text-white/45">{d["network.hint"]}</p>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70"
      style={{ background: color }}
    />
  );
}

/* ── Bir il seçili: burada üretenler + buraya hizmet verenler ── */
function ProvinceCard({
  il,
  data,
  onPick,
  onPreview,
  onClear,
}: {
  il: string;
  data: NetworkMapData;
  onPick: (index: number) => void;
  onPreview: (index: number | null) => void;
  onClear: () => void;
}) {
  const d = useDictionary();
  const bucket = data.provinces[il] ?? { located: [], covered: [] };
  const locatedSet = new Set(bucket.located);
  const servingOnly = bucket.covered.filter((i) => !locatedSet.has(i));

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-white">{il}</h3>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {d["network.clear"]}
        </button>
      </div>

      <PartnerGroup
        title={d["network.group.located"]}
        indexes={bucket.located}
        data={data}
        onPick={onPick}
        onPreview={onPreview}
        empty={d["network.empty.located"]}
      />
      <PartnerGroup
        title={d["network.group.serving"]}
        indexes={servingOnly}
        data={data}
        onPick={onPick}
        onPreview={onPreview}
        empty={d["network.empty.serving"]}
      />
    </div>
  );
}

function PartnerGroup({
  title,
  indexes,
  data,
  onPick,
  onPreview,
  empty,
}: {
  title: string;
  indexes: number[];
  data: NetworkMapData;
  onPick: (index: number) => void;
  onPreview: (index: number | null) => void;
  empty: string;
}) {
  const d = useDictionary();
  return (
    <div className="mt-4">
      <p className="text-[11px] uppercase tracking-wider text-white/45">{title}</p>
      {indexes.length === 0 ? (
        <p className="mt-2 text-sm text-white/50">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {indexes.map((i) => {
            const p = data.partners[i];
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  onMouseEnter={() => onPreview(i)}
                  onMouseLeave={() => onPreview(null)}
                  onFocus={() => onPreview(i)}
                  onBlur={() => onPreview(null)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2.5 text-left transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium text-white">
                      <Dot color={KIND_COLOR[p.kind]} />
                      <span className="truncate">{partnerLabel(p, d)}</span>
                    </span>
                    {p.il && <span className="mt-0.5 block pl-[18px] text-xs text-white/50">{p.il}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-white/45">
                    {fmt(d["network.provinceCount"], { n: p.coverage.length })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── Bir partner seçili: etki alanı haritada vurgulu, burada listeli ── */
function PartnerCard({ partner, onBack }: { partner: PublicPartner; onBack: () => void }) {
  const d = useDictionary();
  return (
    <div className="rounded-2xl border border-accent/30 bg-white/[0.06] p-5">
      <button
        type="button"
        onClick={onBack}
        className="text-[11px] text-white/60 transition-colors hover:text-white"
      >
        {d["network.back"]}
      </button>

      <h3 className="mt-2 flex items-center gap-2 text-lg font-semibold text-white">
        <Dot color={KIND_COLOR[partner.kind]} />
        <span className="min-w-0 truncate">{partnerLabel(partner, d)}</span>
      </h3>
      {partner.il && <p className="mt-0.5 pl-[18px] text-xs text-white/55">{partner.il}</p>}

      {partner.materials.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {partner.materials.map((m) => (
            <span
              key={m}
              className="rounded-full border border-white/15 px-2.5 py-0.5 text-[11px] text-white/80"
            >
              {materialLabel(m, d)}
            </span>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] uppercase tracking-wider text-white/45">
        {fmt(d["network.coverageTitle"], { n: partner.coverage.length })}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {partner.coverage.map((il) => (
          <span
            key={il}
            className={`rounded-md px-2 py-0.5 text-[11px] ${
              il === partner.il ? "bg-accent/25 text-white" : "bg-white/8 text-white/70"
            }`}
          >
            {il}
          </span>
        ))}
      </div>
    </div>
  );
}
