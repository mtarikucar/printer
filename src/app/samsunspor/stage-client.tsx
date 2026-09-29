"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import s from "./stage.module.css";

/**
 * Video bitince son karede dursun mu, başa mı sarsın?
 *
 * `false`: son kare (kızın yazdığı söz) ekranda kalır, "tekrar izle" düğmesi
 * öne çıkar. Videonun sonu kararıyorsa ya da döngü isteniyorsa `true` yap.
 */
const LOOP = false;

/**
 * Videoyu ekrana `cover` ile yaymanın bedeli kırpmadır. Görüntünün en az bu
 * kadarı görünür kalıyorsa kırparak TÜM ekranı videoyla kaplarız; altına
 * düşüyorsa (dikey video + yatay ekran gibi) video kırpılmadan sığdırılır ve
 * boşta kalan şeritleri videonun kendi renklerinden üretilen ışık ile süsleme
 * doldurur. Böylece ekran her durumda dolu kalır ama videodaki yazı kesilmez.
 *
 * Her koşulda kırparak kaplamak için `0` yap.
 */
const COVER_MIN_VISIBLE = 0.75;

/** Yan/üst şeritte süs yazısı göstermek için gereken en küçük boşluk (px). */
const MIN_RAIL_GUTTER = 96;
/** Kayan yazı, başlık ve düğmelerden artan kulvara sığmalı; dar boşlukta çıkmaz. */
const MIN_MARQUEE_GUTTER = 180;

/**
 * Yatay video + dik telefon: kırpmadan sığdırınca video ekranın ortasında ince
 * bir şerit kalır. Karekodu okutan herkes telefonu dik tutar, yani asıl durum
 * budur. O yüzden çerçeve en az ekran yüksekliğinin bu oranı kadar tutulur ve
 * video yanlardan kırpılarak büyütülür. Görüntünün ortası (figür, kalkan)
 * korunur. Hiç kırpılmasın istenirse `0` yap.
 *
 * Değer CSS'e `--letter-min` olarak buradan aktarılır; tek kaynak burası.
 */
const LETTER_MIN_HEIGHT = 0.52;

type Phase = "loading" | "playing" | "paused" | "ended" | "blocked" | "missing";
type Fit = "cover" | "pillar" | "letter";

/** Tarayıcıların ses izini ele veren, standart dışı alanları. */
type AudioProbe = HTMLVideoElement & {
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
  audioTracks?: { length: number };
};

/** `true`/`false`: kesin bilgi. `null`: tarayıcı söylemiyor. */
function probeAudio(video: HTMLVideoElement): boolean | null {
  const v = video as AudioProbe;
  if (typeof v.mozHasAudio === "boolean") return v.mozHasAudio;
  if (v.audioTracks && typeof v.audioTracks.length === "number") {
    return v.audioTracks.length > 0;
  }
  if (typeof v.webkitAudioDecodedByteCount === "number") {
    return v.webkitAudioDecodedByteCount > 0;
  }
  return null;
}

function pickFit(ar: number | null, w: number, h: number): Fit {
  if (!ar || !w || !h) return "cover";
  const stageAr = w / h;
  const visible = Math.min(ar / stageAr, stageAr / ar);
  if (visible >= COVER_MIN_VISIBLE) return "cover";
  return ar < stageAr ? "pillar" : "letter";
}

/**
 * Konfeti parçaları. Math.random DEĞİL, sabit tablo: sunucu ile istemci aynı
 * HTML'i üretmeli, yoksa hydration uyuşmazlığı çıkar.
 * [sol %, süre sn, gecikme sn, boyut px, salınım px, krem mi]
 */
const CONFETTI: ReadonlyArray<
  readonly [number, number, number, number, number, boolean]
> = [
  [4, 13, -2, 9, 40, false],
  [11, 17, -9, 6, -30, true],
  [19, 12, -5, 8, 24, false],
  [27, 19, -14, 5, -44, true],
  [36, 15, -1, 7, 36, false],
  [44, 21, -11, 6, -20, false],
  [52, 14, -7, 9, 30, true],
  [61, 18, -3, 5, -38, false],
  [69, 13, -12, 8, 22, true],
  [77, 20, -6, 6, -28, false],
  [85, 16, -15, 7, 42, true],
  [92, 12, -8, 9, -34, false],
  [97, 22, -4, 5, 18, false],
];

const MARQUEE_TOP = "KIRMIZI ŞİMŞEKLER";
const MARQUEE_BOTTOM = "SAMSUN 1965";

export function StageClient({
  videoSrc,
  posterSrc,
  fontClassName,
}: {
  videoSrc: string;
  posterSrc: string;
  fontClassName: string;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Video ilk karesini ışığa boyadıysa poster onu ezmesin. */
  const paintedByVideo = useRef(false);

  const [phase, setPhase] = useState<Phase>("loading");
  /**
   * "missing" son duraktır. Oynatma sırasında ağ koparsa tarayıcı `error`un
   * hemen ardından bir de `pause` yollar; o pause hatayı ezerse sahne bozuk
   * bir videoda takılı kalır. Bu yüzden diğer tüm geçişler buradan geçer.
   */
  const advance = useCallback((next: Phase) => {
    setPhase((p) => (p === "missing" ? p : next));
  }, []);
  const [muted, setMuted] = useState(true);
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const [videoAr, setVideoAr] = useState<number | null>(null);
  const [posterAr, setPosterAr] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const missing = phase === "missing";
  // Video yoksa sahneyi poster taşır; oran da posterden gelir.
  const ar = missing ? posterAr : (videoAr ?? posterAr);
  const fit = pickFit(ar, size.w, size.h);

  // Boşta kalan şeritlerin genişliği: süslemeler buna göre ölçeklenir.
  const gutterX =
    fit === "pillar" && ar ? Math.max(0, (size.w - size.h * ar) / 2) : 0;
  const letterFrameH =
    fit === "letter" && ar
      ? Math.max(size.w / ar, size.h * LETTER_MIN_HEIGHT)
      : 0;
  const gutterY = fit === "letter" ? Math.max(0, (size.h - letterFrameH) / 2) : 0;
  // Dik tutulan telefonda yatay video: çevirince ekranın tamamını kaplar.
  const suggestRotate = fit === "letter" && size.h > size.w;
  const showRails = gutterX >= MIN_RAIL_GUTTER;
  const showMarquee = gutterY >= MIN_MARQUEE_GUTTER;

  // --- Sayfa kaydırılmasın -------------------------------------------------
  // Sahne zaten `fixed`, ama iOS'un lastik kaydırması ve gövdenin krem zemini
  // kenardan sızmasın diye kök elemanları da kilitliyoruz. Sayfadan çıkınca
  // eski değerler geri yazılır: client-side geçişte diğer sayfalar bozulmaz.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyBackground: body.style.background,
    };
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.background = "#12060a";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      body.style.overflow = prev.bodyOverflow;
      body.style.background = prev.bodyBackground;
    };
  }, []);

  // --- Sahne ölçüsü --------------------------------------------------------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Poster: oran + ışığın ilk boyası ------------------------------------
  useEffect(() => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setPosterAr(img.naturalWidth / img.naturalHeight);
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx && !paintedByVideo.current) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
    };
    img.src = posterSrc;
    return () => {
      img.onload = null;
    };
  }, [posterSrc]);

  // --- Otomatik oynatma ----------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // React `muted`'ı özellik olarak yazar, nitelik olarak değil; tarayıcının
    // otomatik oynatma izni ise sessizliğe bakar. Burada kesinleştiriyoruz.
    video.muted = true;

    // Olaylar React bağlanmadan ÖNCE yaşanmış olabilir (hızlı ağ, önbellek):
    // o yüzden dinleyicilere güvenmeden mevcut durumu da okuruz. Okuma bir
    // sonraki karede yapılır; effect gövdesinde doğrudan state yazılmaz.
    const boot = requestAnimationFrame(() => {
      if (
        video.error ||
        video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
      ) {
        setPhase("missing");
        return;
      }
      if (
        video.readyState >= HTMLMediaElement.HAVE_METADATA &&
        video.videoHeight
      ) {
        setVideoAr(video.videoWidth / video.videoHeight);
      }

      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      if (reduce) {
        // Hareket istemeyen ziyaretçiye video dayatılmaz; kendisi başlatır.
        advance("blocked");
        return;
      }
      video.play().catch(() => advance("blocked"));
    });
    return () => cancelAnimationFrame(boot);
  }, [advance]);

  // --- Ortam ışığı: videonun renkleri arka plana yayılır --------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 120) return; // ~8 kare/sn yeter: bulanık ışık bu.
      last = t;
      const video = videoRef.current;
      if (
        !video ||
        video.paused ||
        document.hidden ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        paintedByVideo.current = true;
      } catch {
        // Kare henüz hazır değil; bir sonraki turda yeniden denenir.
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended) video.currentTime = 0;
    video.play().catch(() => advance("blocked"));
  }, [advance]);

  const replay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.play().catch(() => advance("blocked"));
  }, [advance]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) play();
    else video.pause();
  }, [play]);

  const toggleSound = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setMuted(next);
    // Ses açma bir kullanıcı hareketidir; durmuş videoyu da yürütür.
    if (!next && video.paused && !video.ended) play();
  }, [play]);

  const stageStyle = {
    "--ar": ar ?? 1,
    "--gx": `${gutterX}px`,
    "--gy": `${gutterY}px`,
    "--letter-min": LETTER_MIN_HEIGHT,
  } as CSSProperties;

  const showBigPlay = phase === "blocked" || phase === "paused";
  const showControls = !missing;

  return (
    <main
      ref={stageRef}
      className={`${s.stage} ${fontClassName}`}
      style={stageStyle}
      data-fit={fit}
      data-phase={phase}
      aria-label="Kırmızı Şimşekler'in Kalkanı"
    >
      <h1 className="sr-only">Kırmızı Şimşekler&apos;in Kalkanı</h1>

      {/* ---- Arka plan katmanları ---- */}
      <canvas
        ref={canvasRef}
        className={s.ambient}
        width={24}
        height={24}
        aria-hidden="true"
      />
      <div className={s.stripes} aria-hidden="true" />
      <div className={s.vignette} aria-hidden="true" />

      {/* ---- Video ---- */}
      <div className={s.mediaWrap}>
        <div className={s.frame} data-ready={ar ? "true" : "false"}>
          {missing ? (
            // Düz <img>: dosya zaten optimize edilmiş bir webp ve oranını
            // kendimiz ölçüyoruz; next/image'in sarmalayıcısı burada yük olur.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={`${s.media} ${s.posterFloat}`}
              src={posterSrc}
              alt="Kırmızı beyaz kalkan taşıyan, örgü saçlı savaşçı figürü"
              draggable={false}
            />
          ) : (
            <video
              ref={videoRef}
              className={s.media}
              src={videoSrc}
              poster={posterSrc}
              muted
              playsInline
              preload="auto"
              loop={LOOP}
              disablePictureInPicture
              onClick={togglePlay}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) {
                  setVideoAr(v.videoWidth / v.videoHeight);
                }
              }}
              onPlaying={() => advance("playing")}
              onPause={(e) => {
                // `ended` de bir pause üretir; onu "bitti" olarak bırak.
                if (!e.currentTarget.ended) advance("paused");
              }}
              onEnded={() => advance("ended")}
              onTimeUpdate={(e) => {
                if (hasAudio !== null) return;
                const v = e.currentTarget;
                if (v.currentTime > 1) setHasAudio(probeAudio(v) ?? true);
              }}
              onError={() => setPhase("missing")}
              aria-label="Figür kalkanını yerden alıyor"
            />
          )}
        </div>
      </div>

      {/* ---- Okunurluk perdeleri ---- */}
      <div className={`${s.scrim} ${s.scrimTop}`} aria-hidden="true" />
      <div className={`${s.scrim} ${s.scrimBottom}`} aria-hidden="true" />

      {/* ---- Süslemeler ---- */}
      <div className={s.decor} aria-hidden="true">
        {showRails && (
          <>
            <div className={`${s.rail} ${s.railLeft}`}>
              <span className={s.railSolid}>KIRMIZI</span>
              <span className={s.railOutline}>ŞİMŞEKLER</span>
            </div>
            <div className={`${s.rail} ${s.railRight}`}>
              <span className={s.railOutline}>SAMSUN</span>
              <span className={s.railSolid}>1965</span>
            </div>
          </>
        )}

        {showMarquee && (
          <>
            <div className={`${s.marquee} ${s.marqueeTop}`}>
              <div className={s.marqueeTrack}>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={i % 2 ? s.marqueeSolid : s.marqueeOutline}
                  >
                    {MARQUEE_TOP}
                    <i className={s.marqueeStar} />
                  </span>
                ))}
              </div>
            </div>
            <div className={`${s.marquee} ${s.marqueeBottom}`}>
              <div className={`${s.marqueeTrack} ${s.marqueeReverse}`}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    className={i % 2 ? s.marqueeOutline : s.marqueeSolid}
                  >
                    {MARQUEE_BOTTOM}
                    <i className={s.marqueeStar} />
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        <svg className={`${s.bolt} ${s.boltA}`} viewBox="0 0 64 120">
          <path d="M38 0 6 66h22L18 120 58 46H34z" />
        </svg>
        <svg className={`${s.bolt} ${s.boltB}`} viewBox="0 0 64 120">
          <path d="M38 0 6 66h22L18 120 58 46H34z" />
        </svg>

        <div className={s.confetti}>
          {CONFETTI.map(([x, dur, delay, px, sway, cream], i) => (
            <span
              key={i}
              className={cream ? s.bitCream : s.bitRed}
              style={
                {
                  left: `${x}%`,
                  width: `${px}px`,
                  height: `${Math.round(px * 1.7)}px`,
                  animationDuration: `${dur}s`,
                  animationDelay: `${delay}s`,
                  "--sway": `${sway}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>

        {/* Kilim bordürü: figürün başlığındaki ve eteğindeki motif. */}
        <div className={`${s.band} ${s.bandTop}`} />
        <div className={`${s.band} ${s.bandBottom}`} />
        <div className={`${s.band} ${s.bandLeft}`} />
        <div className={`${s.band} ${s.bandRight}`} />
        {/* Kalkanın tunç perçinleri köşelerde. */}
        <span className={`${s.rivet} ${s.rivetTL}`} />
        <span className={`${s.rivet} ${s.rivetTR}`} />
        <span className={`${s.rivet} ${s.rivetBL}`} />
        <span className={`${s.rivet} ${s.rivetBR}`} />
      </div>

      {/* ---- Büyük oynat düğmesi ---- */}
      {showBigPlay && (
        <button
          type="button"
          className={s.bigPlay}
          onClick={play}
          aria-label="Videoyu oynat"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </button>
      )}

      {/* ---- Üst şerit ---- */}
      <header className={s.top}>
        <Link href="/" className={s.brand} aria-label="Figurunica ana sayfa">
          Figurunica
        </Link>
        <span className={s.chip}>
          <i className={s.chipDot} aria-hidden="true" />
          SAMSUN · 1965
        </span>
      </header>

      {/* ---- Alt şerit ---- */}
      <footer className={s.bottom}>
        <div className={s.pitch}>
          <p className={s.eyebrow}>
            {suggestRotate
              ? "TAM EKRAN İÇİN TELEFONU YAN ÇEVİR"
              : "FOTOĞRAFINDAN EL BOYAMASI FİGÜR"}
          </p>
          <Link href="/create" className={s.cta}>
            <span>KENDİ FİGÜRÜNÜ YAPTIR</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>

        {showControls && (
          <div className={s.controls}>
            {hasAudio !== false && (
              <button
                type="button"
                className={s.ctl}
                onClick={toggleSound}
                aria-pressed={!muted}
                aria-label={muted ? "Sesi aç" : "Sesi kapat"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"
                    className={s.ctlFill}
                  />
                  {muted ? (
                    <path d="m16 9.5 5 5m0-5-5 5" />
                  ) : (
                    <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" />
                  )}
                </svg>
              </button>
            )}
            <button
              type="button"
              className={`${s.ctl} ${phase === "ended" ? s.ctlHot : ""}`}
              onClick={replay}
              aria-label="Baştan oynat"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v3.2h3.2" />
              </svg>
            </button>
          </div>
        )}
      </footer>

      {missing && process.env.NODE_ENV !== "production" && (
        <p className={s.hint}>
          Video bekleniyor: <code>public{videoSrc}</code>
        </p>
      )}
    </main>
  );
}
