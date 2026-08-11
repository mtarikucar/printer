"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { TransformSlider } from "@/components/journey/transform-slider";
import type { JourneyData } from "@/lib/services/order-journey";

// The viewer pulls in three.js. Loading it lazily keeps the first paint — the
// headline and the customer's own photo — fast on the phone they just scanned
// with, which is the only device this page is ever opened on.
const ModelViewer = dynamic(
  () => import("@/components/model-viewer").then((m) => m.ModelViewer),
  { ssr: false }
);

const SIZE_LABEL: Record<string, string> = {
  kucuk: "Küçük",
  orta: "Orta",
  buyuk: "Büyük",
};
const MATERIAL_LABEL: Record<string, string> = {
  resin: "Reçine",
  filament: "Filament",
};

/** Fade a section in the first time it comes into view. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Returned as a tuple rather than an object: bundling a ref and a state value
  // together makes the react-hooks lint rule treat reads of `shown` as reads of
  // a ref during render.
  return [ref, shown] as const;
}

export function JourneyClient({ data }: { data: JourneyData }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [transformRef, transformShown] = useReveal<HTMLElement>();
  const [figureRef, figureShown] = useReveal<HTMLElement>();
  const [copied, setCopied] = useState(false);

  // Drive the ambient hue from scroll depth: memory → idea → object. Content
  // decides the colour, so the page literally warms up as the thing becomes real.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const max = document.body.scrollHeight - window.innerHeight;
        const p = max > 0 ? window.scrollY / max : 0;
        const stage =
          p < 0.33
            ? "var(--j-glow-memory)"
            : p < 0.7
              ? "var(--j-glow-idea)"
              : "var(--j-glow-real)";
        root.style.setProperty("--j-stage", stage);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const share = async () => {
    const url = window.location.href;
    const text = `${data.firstName} için yapılan figürün hikâyesi`;
    if (navigator.share) {
      await navigator.share({ title: "Figurunica", text, url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const orderedAt = new Date(data.orderedAt).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div ref={rootRef} className="j-root">
      {/* ── Opening: type only. The first image on the page should be their
             own photograph, a screen later, not a stock hero. ── */}
      <header className="mx-auto flex min-h-[88vh] max-w-3xl flex-col justify-center px-6 py-20">
        <p className="j-label">Figurunica</p>
        <h1 className="j-display mt-6">
          {data.firstName},
          <br />
          bu figür bir
          <br />
          fotoğraftan doğdu.
        </h1>
        <p className="j-lede mt-7 max-w-md">
          Yolladığın kare önce bir karaktere dönüştü, sonra tek tek basılıp
          elinle tutabileceğin bir şeye. İşte aradaki yol.
        </p>
        <p className="j-hint mt-12" aria-hidden="true">
          ↓ Kaydır
        </p>
      </header>

      {/* ── The transformation. The one thing this page is remembered by. ── */}
      {data.photoUrl && data.designUrl && (
        <section
          ref={transformRef}
          data-shown={transformShown}
          className="j-reveal mx-auto max-w-3xl px-6 py-16"
        >
          <p className="j-label">Dönüşüm</p>
          <h2 className="j-display mt-4 text-[clamp(1.9rem,7vw,3rem)]">
            Kendi karene dokun.
          </h2>
          <div className="mt-8">
            <TransformSlider
              beforeUrl={data.photoUrl}
              afterUrl={data.designUrl}
              beforeLabel="Fotoğrafın"
              afterLabel="Tasarımın"
              hint="Parmağını sürükle"
            />
          </div>
        </section>
      )}

      {/* One stage missing (an old order, a purged photo) still deserves the
          other — show whichever exists rather than an empty page. */}
      {(!data.photoUrl || !data.designUrl) && (data.photoUrl || data.designUrl) && (
        <section className="mx-auto max-w-3xl px-6 py-16">
          <p className="j-label">
            {data.photoUrl ? "Fotoğrafın" : "Tasarımın"}
          </p>
          <div className="j-frame mt-6 overflow-hidden rounded-[28px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={(data.photoUrl ?? data.designUrl)!}
              alt=""
              className="aspect-square w-full object-cover"
            />
          </div>
        </section>
      )}

      {/* ── The object. ── */}
      <section
        ref={figureRef}
        data-shown={figureShown}
        className="j-reveal mx-auto max-w-3xl px-6 py-16"
      >
        <p className="j-label">Figürün</p>
        <h2 className="j-display mt-4 text-[clamp(1.9rem,7vw,3rem)]">
          Ve işte, elindeki.
        </h2>

        {data.glbUrl && (
          <div className="j-frame mt-8 overflow-hidden rounded-[28px]">
            <ModelViewer
              url={data.glbUrl}
              // Slow rotation: they are looking, not inspecting — and it makes
              // the object feel alive the moment the panel scrolls into view.
              autoRotate
              background="#241D30"
              className="h-[380px] w-full sm:h-[460px]"
            />
          </div>
        )}
        <p className="j-hint mt-3 text-center">Çevirmek için sürükle</p>

        <dl className="j-spec mt-10">
          <dt>Sipariş</dt>
          <dd>{data.orderNumber}</dd>
          <dt>Tarih</dt>
          <dd>{orderedAt}</dd>
          {data.figurineSize && (
            <>
              <dt>Boyut</dt>
              <dd>{SIZE_LABEL[data.figurineSize] ?? data.figurineSize}</dd>
            </>
          )}
          <dt>Malzeme</dt>
          <dd>{MATERIAL_LABEL[data.material] ?? data.material}</dd>
          {data.productionDays != null && (
            <>
              <dt>Üretim</dt>
              <dd>{data.productionDays} günde hazırlandı</dd>
            </>
          )}
        </dl>
      </section>

      {/* ── Pass it on. ── */}
      <footer className="mx-auto max-w-3xl px-6 pb-24 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={share} className="j-ghost">
            {copied ? "Bağlantı kopyalandı" : "Bu sayfayı paylaş"}
          </button>
          <Link href="/create" className="j-cta">
            Sen de bir tane yaptır
          </Link>
        </div>
        <p className="j-hint mt-8">
          Bu sayfa yalnızca bağlantıyı bilenlere açıktır.
        </p>
      </footer>
    </div>
  );
}
