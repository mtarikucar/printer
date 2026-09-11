/**
 * Vitrinin ortak ızgara dokusu. PromoBanner'ın içinde module-private duruyordu;
 * üretim ağı haritası da aynı koyu yüzeye ihtiyaç duyunca ikinci bir kopya
 * yerine buraya çıkarıldı — iki bölüm aynı dokuyu paylaşmalı, ayrı ayrı
 * kaymamalı.
 */
export function PixelGrid({ light }: { light?: boolean }) {
  const line = light ? "rgba(255,255,255,0.07)" : "rgba(8,145,178,0.07)";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        backgroundSize: "22px 22px",
        maskImage: "radial-gradient(120% 120% at 70% 40%, black 30%, transparent 75%)",
        WebkitMaskImage: "radial-gradient(120% 120% at 70% 40%, black 30%, transparent 75%)",
      }}
    />
  );
}
