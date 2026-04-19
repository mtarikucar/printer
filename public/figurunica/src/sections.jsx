/* global React */
const { useEffect, useRef, useState } = React;

function StyleGallery() {
  const items = [
    { src: 'assets/examples/realistic.png', name: 'Realistic', tag: 'R-01' },
    { src: 'assets/examples/chibi.png', name: 'Chibi', tag: 'C-02' },
    { src: 'assets/examples/anime.png', name: 'Anime', tag: 'A-03' },
    { src: 'assets/examples/disney.png', name: 'Disney', tag: 'D-04' },
  ];
  return (
    <section className="section" id="styles">
      <div className="section-head">
        <div className="section-eyebrow">Styles · four flavors of you</div>
        <h2 className="section-title">Choose how you want <span className="italic">to be remembered.</span></h2>
        <p className="section-sub">From a near-perfect likeness to big-eyed chibi charm. Every style is hand-tuned, printed in cream resin, and finished by hand.</p>
      </div>
      <div className="styles-grid">
        {items.map((it, i) => (
          <div className="style-card" key={i}>
            <img src={it.src} alt={it.name}/>
            <div className="style-card-cap">
              <span className="name">{it.name}</span>
              <span className="tag">{it.tag}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: '01', t: 'Upload', d: 'One clear photo. Front-facing, good light. That is all we need.', time: '30 sec' },
    { n: '02', t: 'We scan', d: 'Facial geometry, clothing, posture, hair — our model reads it all in seconds.', time: '2 min' },
    { n: '03', t: 'We sculpt', d: 'A watertight 3D mesh is generated, then refined by a human sculptor.', time: '24 hrs' },
    { n: '04', t: 'We print & ship', d: 'Cream-resin SLA print, hand-finished, boxed and shipped to your door.', time: '5 days' },
  ];
  return (
    <section className="section" id="how">
      <div className="section-head">
        <div className="section-eyebrow">Process · four steps, one week</div>
        <h2 className="section-title">A photo in. <span className="italic">A figurine out.</span></h2>
      </div>
      <div className="steps">
        {steps.map(s => (
          <div className="step" key={s.n}>
            <div className="step-num">{s.n}</div>
            <div className="step-title">{s.t}</div>
            <div className="step-desc">{s.d}</div>
            <div className="step-time">⏱ {s.time}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CtaBand() {
  return (
    <section className="cta-band">
      <h2>Turn your photo<br/><span className="italic">into a </span><span className="accent">figurine.</span></h2>
      <p>From pixels to a pocket-sized piece of you. Gift-ready in a week.</p>
      <button className="btn-primary">
        Start your figurine
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </button>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <span>© 2026 Figurunica</span>
      <span>Handmade in Istanbul · shipped worldwide</span>
    </footer>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="nav-brand">
        <span className="nav-logo"/>
        <span>Figurunica</span>
      </div>
      <div className="nav-links">
        <a href="#how">How it works</a>
        <a href="#styles">Styles</a>
        <a href="#gallery">Gallery</a>
        <a href="#pricing">Pricing</a>
      </div>
      <button className="nav-cta">Start your figurine →</button>
    </nav>
  );
}

function HeroIntro() {
  const [t, setT] = useState(0); // 0..1 looping build
  const [layer, setLayer] = useState(0);
  const [mouse, setMouse] = useState({x: 0, y: 0});
  const heroRef = useRef(null);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const elapsed = ((now - start) / 14000) % 1; // 14s loop
      setT(elapsed);
      setLayer(Math.floor(elapsed * 420));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!heroRef.current) return;
      const r = heroRef.current.getBoundingClientRect();
      setMouse({ x: ((e.clientX - r.left) / r.width) - 0.5, y: ((e.clientY - r.top) / r.height) - 0.5 });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Printhead x movement
  const headX = Math.sin(t * Math.PI * 6) * 120;
  const buildH = t; // figurine build %

  return (
    <section className="hero" ref={heroRef}>
      {/* Ambient background grid + halo */}
      <div className="hero-bg">
        <div className="hero-grid"/>
        <div className="hero-halo" style={{transform: `translate(${mouse.x * 40}px, ${mouse.y * 40}px)`}}/>
        <div className="hero-vignette"/>
      </div>

      {/* THE BIG PRINTER — fills the hero */}
      <div className="hero-printer" aria-hidden="true"
           style={{transform: `translate(-50%, -50%) rotateX(${mouse.y * -3}deg) rotateY(${mouse.x * 4}deg)`}}>

        {/* Gantry — top crossbar with horizontal rails */}
        <div className="gantry">
          <div className="gantry-rail"/>
          <div className="gantry-rail bottom"/>
          <div className="gantry-strut left"/>
          <div className="gantry-strut right"/>
          <div className="printhead" style={{transform: `translateX(calc(-50% + ${headX}px))`}}>
            <div className="printhead-body"/>
            <div className="printhead-nozzle"/>
            <div className="printhead-laser"/>
          </div>
        </div>

        {/* Vertical Z-column */}
        <div className="z-column left"/>
        <div className="z-column right"/>

        {/* Main vat — the big centerpiece */}
        <div className="vat">
          <div className="vat-liquid"/>
          <div className="vat-uv"/>
          <div className="vat-ring top"/>
          <div className="vat-ring bottom"/>

          {/* Concentric scan rings on the build plate */}
          <div className="build-plate">
            <div className="plate-ring r1"/>
            <div className="plate-ring r2"/>
            <div className="plate-ring r3"/>
          </div>

          {/* The figurine emerging */}
          <div className="hero-figurine">
            <div className="hero-figurine-clip" style={{
              clipPath: `inset(${(1-buildH)*100}% 0 0 0)`,
              WebkitClipPath: `inset(${(1-buildH)*100}% 0 0 0)`
            }}>
              <svg viewBox="0 0 140 280" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="heroFig" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#FFFFFF"/>
                    <stop offset="100%" stopColor="#B9DDE8"/>
                  </linearGradient>
                </defs>
                <ellipse cx="70" cy="268" rx="48" ry="6" fill="#9FC7D2"/>
                <rect x="28" y="256" width="84" height="14" rx="2" fill="#D4E8EE"/>
                <path d="M 44 256 L 48 200 Q 50 180 58 170 L 66 170 L 70 256 Z" fill="url(#heroFig)"/>
                <path d="M 96 256 L 92 200 Q 90 180 82 170 L 74 170 L 70 256 Z" fill="url(#heroFig)"/>
                <path d="M 40 170 Q 38 178 40 185 L 100 185 Q 102 178 100 170 Z" fill="#C8E2E8"/>
                <path d="M 38 170 Q 30 130 36 95 Q 42 70 58 65 Q 70 62 82 65 Q 98 70 104 95 Q 110 130 102 170 Z" fill="url(#heroFig)"/>
                <path d="M 58 65 Q 70 80 82 65 L 82 170 L 58 170 Z" fill="#EDF6F8"/>
                <path d="M 32 100 Q 22 130 26 160 L 36 168 Q 44 140 42 110 Z" fill="url(#heroFig)"/>
                <path d="M 108 100 Q 118 130 114 160 L 104 168 Q 96 140 98 110 Z" fill="url(#heroFig)"/>
                <ellipse cx="70" cy="40" rx="24" ry="26" fill="url(#heroFig)"/>
                <path d="M 46 38 Q 44 16 58 8 Q 70 2 82 8 Q 96 16 94 38 Q 94 50 88 52 Q 92 30 82 24 Q 70 18 58 24 Q 48 30 52 52 Q 46 50 46 38 Z" fill="#89A4AD"/>
              </svg>
            </div>
            {buildH > 0.02 && buildH < 0.98 && (
              <div className="hero-scanline" style={{bottom: `${buildH * 280 - 8}px`}}/>
            )}
          </div>

          {/* Droplets from printhead */}
          {Array.from({length: 5}).map((_, i) => {
            const dt = ((t * 6 + i * 0.18) % 1);
            return <div key={i} className="hero-droplet" style={{
              left: `calc(50% + ${Math.sin(t * Math.PI * 6 + i * 0.9) * 120}px)`,
              top: `${60 + dt * 240}px`,
              opacity: dt < 0.85 ? 0.7 - dt * 0.3 : 0,
            }}/>;
          })}
        </div>

        {/* Base console */}
        <div className="printer-base">
          <div className="base-screen">
            <div className="base-screen-row"><span className="k">layer</span><span className="v">{String(layer).padStart(3,'0')}/420</span></div>
            <div className="base-screen-row"><span className="k">temp</span><span className="v">27.4°C</span></div>
            <div className="base-screen-row"><span className="k">uv</span><span className="v">405nm</span></div>
            <div className="base-bar"><div className="base-bar-fill" style={{width: `${buildH*100}%`}}/></div>
          </div>
          <div className="base-leds">
            <span className="led on"/><span className="led on"/><span className="led"/>
          </div>
        </div>

        {/* Floating HUD chips — tracking the figurine */}
        <div className="hud-chip chip-1" style={{transform: `translate(${mouse.x * -10}px, ${mouse.y * -10}px)`}}>
          <span className="chip-dot"/>
          <div>
            <div className="chip-k">subject</div>
            <div className="chip-v">1 person · female · ident.</div>
          </div>
        </div>
        <div className="hud-chip chip-2" style={{transform: `translate(${mouse.x * 14}px, ${mouse.y * -6}px)`}}>
          <div className="chip-mini-bars">
            <span style={{height: '40%'}}/><span style={{height: '70%'}}/><span style={{height: '55%'}}/><span style={{height: '85%'}}/><span style={{height: '60%'}}/>
          </div>
          <div>
            <div className="chip-k">verts</div>
            <div className="chip-v">12,480</div>
          </div>
        </div>
        <div className="hud-chip chip-3" style={{transform: `translate(${mouse.x * 10}px, ${mouse.y * 12}px)`}}>
          <span className="chip-ring">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="var(--rule-strong)" strokeWidth="2"/>
              <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" strokeWidth="2"
                      strokeDasharray={`${buildH * 62.8} 62.8`}
                      transform="rotate(-90 12 12)"/>
            </svg>
          </span>
          <div>
            <div className="chip-k">build</div>
            <div className="chip-v">{Math.floor(buildH*100)}%</div>
          </div>
        </div>
        <div className="hud-chip chip-4" style={{transform: `translate(${mouse.x * -14}px, ${mouse.y * 8}px)`}}>
          <span className="chip-dot green"/>
          <div>
            <div className="chip-k">queue</div>
            <div className="chip-v">412 printing now</div>
          </div>
        </div>
      </div>

      {/* Foreground copy — sits inside the printer */}
      <div className="hero-content">
        <div className="eyebrow"><span className="dot"/>Now printing · batch 04·26</div>
        <h1 className="hero-title">
          Turn your photo<br/>
          <span className="italic">into a </span><span className="accent">figurine.</span>
        </h1>
        <p className="hero-sub">
          Upload a picture. We sculpt a 3D model of you, print it in cream resin, and ship it to your door. <em>It feels like magic — because it is.</em>
        </p>
        <div className="hero-ctas">
          <button className="btn-primary">
            Turn your photo into a figurine
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
          <button className="btn-ghost">Watch a 30-sec demo</button>
        </div>

        {/* Live stat strip */}
        <div className="hero-stats">
          <div className="stat">
            <div className="stat-v">25<span className="u">µm</span></div>
            <div className="stat-k">Layer height</div>
          </div>
          <div className="stat">
            <div className="stat-v">7<span className="u">days</span></div>
            <div className="stat-k">Photo to doorstep</div>
          </div>
          <div className="stat">
            <div className="stat-v">4<span className="u">styles</span></div>
            <div className="stat-k">Realistic · Chibi · Anime · Disney</div>
          </div>
          <div className="stat">
            <div className="stat-v">12k+<span className="u"></span></div>
            <div className="stat-k">Figurines printed</div>
          </div>
        </div>
      </div>

      {/* Ticker */}
      <div className="hero-ticker">
        <div className="ticker-track">
          {Array.from({length: 2}).map((_, k) => (
            <span key={k} className="ticker-chunk">
              <span className="t-dot"/> printing · ege, istanbul · chibi ·
              <span className="t-dot"/> shipped · mei, singapore · realistic ·
              <span className="t-dot"/> sculpting · juno, berlin · anime ·
              <span className="t-dot"/> packed · raúl, madrid · disney ·
              <span className="t-dot"/> printing · ana, lisbon · chibi ·
              <span className="t-dot"/> printing · theo, paris · realistic ·
            </span>
          ))}
        </div>
      </div>

      <div className="hero-scroll-cue">
        <span>Scroll to follow the journey</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </section>
  );
}

function FloatingCta({ show }) {
  return (
    <div className={`floating-cta ${show ? 'show' : ''}`}>
      <span className="dot"/>
      <span>Ready when you are.</span>
      <button className="btn">Turn photo into figurine →</button>
    </div>
  );
}

function Tweaks() {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(window.__TWEAKS__.accent);
  const swatches = ['#00D4FF', '#10B981', '#FF6B6B', '#FFB547', '#B586FF', '#0B0C0F'];

  useEffect(() => {
    const onMsg = (e) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === '__activate_edit_mode') setOpen(true);
      if (e.data.type === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', color);
    // derive a slightly brighter accent-2
    document.documentElement.style.setProperty('--accent-2', lighten(color, 0.15));
    document.documentElement.style.setProperty('--accent-soft', hexToRgba(color, 0.12));
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { accent: color } }, '*');
  }, [color]);

  return (
    <div className={`tweaks ${open ? 'open' : ''}`}>
      <h4>Accent color</h4>
      <div className="tweaks-swatches">
        {swatches.map(s => (
          <div key={s} className={`tweaks-swatch ${s === color ? 'active' : ''}`}
               style={{ background: s }}
               onClick={() => setColor(s)}/>
        ))}
      </div>
      <div className="tweaks-input">
        <input type="color" value={color} onChange={e => setColor(e.target.value)}/>
        <span>{color.toUpperCase()}</span>
      </div>
    </div>
  );
}

function hexToRgba(hex, a) {
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2), 16);
  const g = parseInt(h.substring(2,4), 16);
  const b = parseInt(h.substring(4,6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function lighten(hex, amt) {
  const h = hex.replace('#','');
  const r = Math.min(255, parseInt(h.substring(0,2),16) + Math.round(255 * amt));
  const g = Math.min(255, parseInt(h.substring(2,4),16) + Math.round(255 * amt));
  const b = Math.min(255, parseInt(h.substring(4,6),16) + Math.round(255 * amt));
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

window.Sections = { Nav, HeroIntro, StyleGallery, HowItWorks, CtaBand, Footer, FloatingCta, Tweaks };
