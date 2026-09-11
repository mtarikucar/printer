"use client";

import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { TURKEY_MAP_PROVINCES, TURKEY_MAP_VIEWBOX } from "@/lib/data/turkey-map";

/**
 * Stil-bağımsız, etkileşimli Türkiye il haritası.
 *
 * Görünüm tamamen çağıranın elindedir: her il için class/style çözümleyen
 * fonksiyonlar geçilir, işaretçiler `markers` ile verilir. Anasayfa (vitrin
 * tonları) ve admin editörü (panel tonları) aynı bileşeni farklı derilerle
 * kullanır; harita geometrisi tek yerde durur.
 *
 * KLAVYE: 81 ilin tamamını sekme durağı yapmak anasayfaya onlarca durak
 * eklerdi. Bunun yerine ROVING TABINDEX: `focusOrder` ile verilen iller tek bir
 * sekme durağı gibi davranır, ok tuşları aralarında gezer, Enter/Space seçer,
 * Escape temizler.
 *
 * PIN'LER: `pointer-events: none` ile çizilir — pin küçük bir ilin tamamını
 * kaplayabilir ve tıklamayı yutarsa o ile hiç tıklanamaz.
 */

export type PartnerKind = "manufacturer" | "painter";

export interface MapMarker {
  il: string;
  kind: PartnerKind;
  /** Aynı ilde aynı türden kaç partner var. */
  count?: number;
}

export interface ProvinceState {
  selected: boolean;
  hovered: boolean;
  interactive: boolean;
}

export interface TurkeyMapSvgProps {
  className?: string;
  style?: CSSProperties;
  provinceClassName?: (il: string, state: ProvinceState) => string | undefined;
  provinceStyle?: (il: string, state: ProvinceState) => CSSProperties | undefined;
  /** Tıklanabilir iller. Varsayılan: hepsi. */
  isInteractive?: (il: string) => boolean;
  /**
   * Klavyeyle gezilecek illerin SIRASI. Boş/verilmemişse klavye gezinmesi
   * kapalıdır (harita salt görsel bir katman olur).
   */
  focusOrder?: readonly string[];
  selected?: string | null;
  /**
   * Çoklu seçim yüzeyleri (admin etki alanı editörü) için: `selected` tek bir
   * ili işaret eder, burada ise HER il kendi basılı durumunu bildirir —
   * aria-pressed dolgu rengiyle aynı şeyi söylemek zorunda.
   */
  isSelected?: (il: string) => boolean;
  hovered?: string | null;
  onSelect?: (il: string) => void;
  /** null → imleç/odak haritadan çıktı. */
  onHover?: (il: string | null) => void;
  onEscape?: () => void;
  ariaLabelFor?: (il: string) => string;
  ariaLabel?: string;
  markers?: MapMarker[];
  markerColors?: Record<PartnerKind, string>;
  markerRadius?: number;
  /** Pin nabzı (indekse göre kaydırmalı). */
  pulse?: boolean;
  children?: ReactNode;
}

const DEFAULT_MARKER_COLORS: Record<PartnerKind, string> = {
  manufacturer: "#22E4FF",
  painter: "#F5B54B",
};

const [VB_X, VB_Y, VB_W, VB_H] = TURKEY_MAP_VIEWBOX.split(" ").map(Number);

/**
 * İl merkezinin viewBox içindeki yüzde konumu — tooltip/etiketleri HTML
 * katmanında konumlandırmak için. Fareye değil merkeze çapalanır: klavyeyle
 * gezerken imleç yoktur ve titremeyen bir konum gerekir.
 */
export function provinceCenterPercent(il: string): { left: number; top: number } | null {
  const p = TURKEY_MAP_PROVINCES.find((x) => x.il === il);
  if (!p) return null;
  return {
    left: ((p.cx - VB_X) / VB_W) * 100,
    top: ((p.cy - VB_Y) / VB_H) * 100,
  };
}

export function TurkeyMapSvg({
  className,
  style,
  provinceClassName,
  provinceStyle,
  isInteractive,
  focusOrder,
  selected = null,
  isSelected,
  hovered = null,
  onSelect,
  onHover,
  onEscape,
  ariaLabelFor,
  ariaLabel = "Türkiye üretim ağı haritası",
  markers = [],
  markerColors = DEFAULT_MARKER_COLORS,
  markerRadius = 5,
  pulse = false,
  children,
}: TurkeyMapSvgProps) {
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const order = useMemo(() => focusOrder ?? [], [focusOrder]);
  // Klavye tutamağının TERCİH edilen ili. Gerçek tutamak aşağıda TÜRETİLİR:
  // liste değişince (partner eklendi/çıktı) tercih artık listede olmayabilir ve
  // sekme durağı kaybolurdu. Effect'le senkronlamak yerine türetmek, bir render
  // turu ve cascading render uyarısı kazandırır.
  const [rovingPref, setRovingPref] = useState<string | null>(null);
  const rovingIl = rovingPref && order.includes(rovingPref) ? rovingPref : (order[0] ?? null);

  const markersByIl = useMemo(() => {
    const m = new Map<string, MapMarker[]>();
    for (const mk of markers) {
      const list = m.get(mk.il) ?? [];
      list.push(mk);
      m.set(mk.il, list);
    }
    return m;
  }, [markers]);

  const selectedProvince = selected
    ? TURKEY_MAP_PROVINCES.find((p) => p.il === selected)
    : undefined;

  function moveRoving(delta: number) {
    if (order.length === 0) return;
    const cur = rovingIl ? order.indexOf(rovingIl) : -1;
    const next = order[(cur + delta + order.length) % order.length];
    setRovingPref(next);
    onHover?.(next);
    pathRefs.current.get(next)?.focus();
  }

  function handleKey(e: KeyboardEvent<SVGPathElement>, il: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(il);
      return;
    }
    if (e.key === "Escape") {
      onEscape?.();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveRoving(1);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveRoving(-1);
    }
  }

  return (
    <svg
      viewBox={TURKEY_MAP_VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={style}
      role="group"
      // aria-label, aria-labelledby + <title> YERİNE: bileşen next/dynamic ile
      // yükleniyor ve useId() sunucu/istemci ağacında farklı konumda üretiliyor
      // → her yüklemede hydration uyuşmazlığı. Ayrıca <title> bazı tarayıcılarda
      // native tooltip çıkarır ve kendi tooltip'imizle çakışırdı.
      aria-label={ariaLabel}
      onMouseLeave={() => onHover?.(null)}
    >
      <g>
        {TURKEY_MAP_PROVINCES.map((p) => {
          const interactive = isInteractive ? isInteractive(p.il) : true;
          const inOrder = order.includes(p.il);
          const state: ProvinceState = {
            selected: isSelected ? isSelected(p.il) : selected === p.il,
            hovered: hovered === p.il,
            interactive,
          };
          return (
            <path
              key={p.il}
              ref={(el) => {
                if (el) pathRefs.current.set(p.il, el);
                else pathRefs.current.delete(p.il);
              }}
              d={p.d}
              data-il={p.il}
              vectorEffect="non-scaling-stroke"
              className={provinceClassName?.(p.il, state)}
              style={{ outline: "none", ...provinceStyle?.(p.il, state) }}
              role={interactive ? "button" : undefined}
              tabIndex={inOrder ? (rovingIl === p.il ? 0 : -1) : undefined}
              aria-label={interactive ? (ariaLabelFor?.(p.il) ?? p.il) : undefined}
              aria-pressed={interactive ? state.selected : undefined}
              onClick={interactive ? () => onSelect?.(p.il) : undefined}
              onKeyDown={inOrder ? (e) => handleKey(e, p.il) : undefined}
              onMouseEnter={() => onHover?.(p.il)}
              onFocus={() => {
                if (inOrder) setRovingPref(p.il);
                onHover?.(p.il);
              }}
              onBlur={() => onHover?.(null)}
            />
          );
        })}
      </g>

      {/* Seçili ilin konturu komşularının ÜSTÜNE çizilir; aynı katmanda kalsa
          komşu path'ler kenarın yarısını örterdi. */}
      {selectedProvince && (
        <path
          d={selectedProvince.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}

      <g pointerEvents="none">
        {[...markersByIl.entries()].map(([il, list]) => {
          const p = TURKEY_MAP_PROVINCES.find((x) => x.il === il);
          if (!p) return null;
          const spread = (list.length - 1) * markerRadius * 1.2;
          return list.map((mk, i) => {
            const offsetX = -spread + i * markerRadius * 2.4;
            return (
              <g key={`${il}-${mk.kind}`} transform={`translate(${p.cx + offsetX} ${p.cy})`}>
                {pulse && (
                  <circle
                    r={markerRadius}
                    fill={markerColors[mk.kind]}
                    className="turkey-map-pulse motion-reduce:hidden"
                    style={{ animationDelay: `${(i + p.plate) % 5 * 0.4}s` }}
                  />
                )}
                <circle r={markerRadius} fill={markerColors[mk.kind]} stroke="rgba(255,255,255,0.85)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                {mk.count && mk.count > 1 ? (
                  <text
                    y={markerRadius * 0.38}
                    textAnchor="middle"
                    fontSize={markerRadius * 1.15}
                    fontWeight={700}
                    fill="#0B0C0F"
                    fontFamily="var(--font-inter), system-ui, sans-serif"
                  >
                    {mk.count}
                  </text>
                ) : null}
              </g>
            );
          });
        })}
      </g>

      {children}
    </svg>
  );
}
