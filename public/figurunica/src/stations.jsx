/* global React */
const { useRef, useEffect, useState, useMemo } = React;

// ============= STATION 1: UPLOAD =============
function StationUpload({ progress }) {
  // progress 0..1 — local to this station
  const p = Math.max(0, Math.min(1, progress));
  const active = p > 0.15;
  const showPreview = p > 0.55;
  const uploadPct = Math.min(100, Math.max(0, (p - 0.25) * 180));

  return (
    <div className="upload-frame">
      <div className="upload-head">
        <div className="upload-dots"><span/><span/><span/></div>
        <span>figurunica.app / upload</span>
      </div>
      <div className={`upload-dropzone ${active ? 'active' : ''}`}>
        <div className="upload-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{color: active ? 'var(--accent)' : 'var(--ink-2)'}}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div className="upload-label">Drop a photo of yourself</div>
        <div className="upload-hint">JPG or PNG · up to 20MB · one person, good lighting</div>
        <div className={`upload-preview ${showPreview ? 'show' : ''}`}>
          <img src="assets/examples/realistic.png" alt="Uploaded"/>
        </div>
      </div>
      <div className="upload-progress"><div className="fill" style={{width: `${uploadPct}%`}}/></div>
      <div className="upload-files">
        <span>IMG_4482.jpg</span>
        <span>{uploadPct < 100 ? `${Math.floor(uploadPct)}%` : 'complete'}</span>
      </div>
    </div>
  );
}

// ============= STATION 2: AI SCAN =============
function StationScan({ progress }) {
  const p = Math.max(0, Math.min(1, progress));
  // scan beam travels top → bottom → top, looping
  const beamY = (Math.sin(p * Math.PI * 2 - Math.PI/2) * 0.5 + 0.5); // 0..1..0
  const beamTop = 40 + beamY * 400; // px within 520 stage
  const points = [
    { x: 48, y: 22, on: 0.15 },
    { x: 55, y: 23, on: 0.2 },
    { x: 42, y: 30, on: 0.28 },
    { x: 50, y: 35, on: 0.34 },
    { x: 48, y: 45, on: 0.42 },
    { x: 40, y: 52, on: 0.5 },
    { x: 58, y: 52, on: 0.58 },
    { x: 44, y: 62, on: 0.66 },
    { x: 52, y: 72, on: 0.74 },
    { x: 50, y: 82, on: 0.82 },
  ];
  const particles = Array.from({length: 14}, (_,i) => i);

  return (
    <div className="scan-stage">
      <div className="scan-corner tl"/><div className="scan-corner tr"/><div className="scan-corner bl"/><div className="scan-corner br"/>
      <div className="scan-hud">
        <div className="status"><span className="d"/>analyzing</div>
        <div>face.detected · 1</div>
      </div>
      <div className="scan-subject"><img src="assets/examples/realistic.png" alt="Subject"/></div>
      <div className="scan-beam on" style={{top: `${beamTop}px`}}/>
      <div className="scan-points">
        {points.map((pt, i) => (
          <div key={i} className="scan-point"
               style={{
                 left: `${pt.x}%`, top: `${pt.y}%`,
                 opacity: p > pt.on ? 1 : 0,
                 transform: `translate(-50%,-50%) scale(${p > pt.on ? 1 : 0.3})`,
                 transition: 'opacity 0.3s ease, transform 0.3s ease'
               }}/>
        ))}
      </div>
      <div className="scan-particles">
        {particles.map(i => {
          const angle = (i / particles.length) * Math.PI * 2 + p * 3;
          const r = 100 + (i % 3) * 20;
          const cx = 50 + Math.cos(angle) * (r / 7);
          const cy = 50 + Math.sin(angle) * (r / 7);
          return <div key={i} className="scan-particle" style={{
            left: `${cx}%`, top: `${cy}%`,
            opacity: 0.6 + Math.sin(angle * 2) * 0.3,
            transform: `translate(-50%,-50%)`,
          }}/>;
        })}
      </div>
    </div>
  );
}

// ============= STATION 3: WIREFRAME → 3D =============
function StationWire({ progress }) {
  const p = Math.max(0, Math.min(1, progress));
  // two phases: build wireframe (0..0.55), fill in (0.55..1)
  const drawn = Math.min(1, p / 0.55);
  const filled = Math.max(0, Math.min(1, (p - 0.55) / 0.45));
  const dashOffset = 2000 * (1 - drawn);
  const rot = -18 + p * 36;

  return (
    <div className="wire-stage">
      <div className="wire-tag"><span className="d"/>model.generate · v2</div>
      <svg className="wire-svg" viewBox="0 0 400 520" style={{transform: `rotateY(${rot * 0.3}deg)`}}>
        <g transform="translate(200,260)" style={{transform: `translate(200px,260px) rotateY(${rot}deg)`, transformOrigin: 'center'}}>
          {/* Simplified figure wireframe — head, torso, arms, legs */}
          {/* Body fill */}
          <g style={{opacity: filled}}>
            <ellipse cx="0" cy="-150" rx="38" ry="44" fill="rgba(11,12,15,0.06)"/>
            <path d="M -55 -90 Q -65 -30 -50 40 L -45 80 Q -20 90 0 90 Q 20 90 45 80 L 50 40 Q 65 -30 55 -90 Q 30 -110 0 -110 Q -30 -110 -55 -90 Z" fill="rgba(11,12,15,0.06)"/>
            <path d="M -45 80 L -40 180 Q -35 200 -20 200 L -5 200 L 0 90 Z" fill="rgba(11,12,15,0.05)"/>
            <path d="M 45 80 L 40 180 Q 35 200 20 200 L 5 200 L 0 90 Z" fill="rgba(11,12,15,0.05)"/>
          </g>
          {/* Wireframe strokes */}
          <g fill="none" strokeDasharray="2000" strokeDashoffset={dashOffset} style={{transition: 'stroke-dashoffset 0.05s linear'}}>
            {/* head */}
            <ellipse cx="0" cy="-150" rx="38" ry="44" stroke="var(--ink-2)" strokeWidth="0.8"/>
            <path d="M -38 -150 Q 0 -140 38 -150" stroke="var(--ink-2)" strokeWidth="0.6"/>
            <path d="M -38 -160 Q 0 -150 38 -160" stroke="var(--ink-2)" strokeWidth="0.6"/>
            <line x1="0" y1="-194" x2="0" y2="-106" stroke="var(--accent)" strokeWidth="0.8"/>
            {/* torso */}
            <path d="M -55 -90 Q -65 -30 -50 40 L -45 80 Q -20 90 0 90 Q 20 90 45 80 L 50 40 Q 65 -30 55 -90" stroke="var(--ink-2)" strokeWidth="0.8"/>
            <line x1="-55" y1="-90" x2="55" y2="-90" stroke="var(--ink-2)" strokeWidth="0.6"/>
            <line x1="-50" y1="40" x2="50" y2="40" stroke="var(--ink-2)" strokeWidth="0.6"/>
            <line x1="-45" y1="80" x2="45" y2="80" stroke="var(--ink-2)" strokeWidth="0.6"/>
            <line x1="0" y1="-90" x2="0" y2="80" stroke="var(--accent)" strokeWidth="0.8"/>
            {/* arms */}
            <path d="M -55 -80 Q -80 -30 -75 30 L -68 70" stroke="var(--ink-2)" strokeWidth="0.8"/>
            <path d="M 55 -80 Q 80 -30 75 30 L 68 70" stroke="var(--ink-2)" strokeWidth="0.8"/>
            {/* legs */}
            <path d="M -40 90 L -35 190 Q -30 210 -15 210 L 0 210 L 0 90 M 0 90 L 0 210 L 15 210 Q 30 210 35 190 L 40 90" stroke="var(--ink-2)" strokeWidth="0.8"/>
            {/* face cross */}
            <line x1="-38" y1="-150" x2="38" y2="-150" stroke="var(--ink-2)" strokeWidth="0.5"/>
          </g>
        </g>
      </svg>
      <div className="wire-pedestal"/>
      <div className="wire-stats">
        <span>verts <span className="v">{Math.floor(drawn * 12480)}</span></span>
        <span>mesh <span className="v">{filled > 0.5 ? 'solid' : 'wire'}</span></span>
        <span>ready <span className="v">{Math.floor(p * 100)}%</span></span>
      </div>
    </div>
  );
}

// ============= STATION 4: RESIN PRINTER =============
function StationPrinter({ progress }) {
  const p = Math.max(0, Math.min(1, progress));
  // Build up from bottom. progress 0 = empty, 1 = full figurine.
  const buildHeight = p; // 0..1
  const layer = Math.floor(p * 420);
  // layer lines — every ~5% create a visible scan line near the top of the building area
  const scanlineY = 280 - buildHeight * 280;

  // Droplets falling
  const droplets = Array.from({length: 6}, (_, i) => i);

  return (
    <div className="printer-stage">
      <div className="printer-glass">
        <div className="printer-rails"/>
        <div className="printer-head" style={{transform: `translateX(calc(-50% + ${Math.sin(p * 12) * 60}px))`}}/>
        {droplets.map(i => {
          const t = ((p * 4 + i * 0.17) % 1);
          return <div key={i} className="printer-droplet" style={{
            left: `calc(50% + ${Math.sin(p * 12 + i) * 60}px)`,
            top: `${40 + t * 140}px`,
            opacity: t < 0.8 ? 0.8 : 0,
          }}/>;
        })}
        <div className="printer-vat">
          <div className="printer-liquid"/>
          <div className="printer-uv"/>
          {/* Figurine silhouette, revealed bottom-up */}
          <div className="printer-figurine">
            <div className="printer-figurine-clip" style={{
              clipPath: `inset(${(1 - buildHeight) * 100}% 0 0 0)`,
              WebkitClipPath: `inset(${(1 - buildHeight) * 100}% 0 0 0)`,
            }}>
              <svg viewBox="0 0 140 280" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="figGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#F8F8F4"/>
                    <stop offset="100%" stopColor="#C9E8F0"/>
                  </linearGradient>
                  <linearGradient id="figAccent" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(0,212,255,0.6)"/>
                    <stop offset="100%" stopColor="rgba(0,212,255,0.1)"/>
                  </linearGradient>
                </defs>
                {/* pedestal */}
                <ellipse cx="70" cy="268" rx="48" ry="6" fill="#B8D8E0"/>
                <rect x="28" y="256" width="84" height="14" rx="2" fill="#D4E8EE"/>
                {/* feet/legs */}
                <path d="M 44 256 L 48 200 Q 50 180 58 170 L 66 170 L 70 256 Z" fill="url(#figGrad)"/>
                <path d="M 96 256 L 92 200 Q 90 180 82 170 L 74 170 L 70 256 Z" fill="url(#figGrad)"/>
                {/* skirt */}
                <path d="M 40 170 Q 38 178 40 185 L 100 185 Q 102 178 100 170 Z" fill="#D0E8F0"/>
                {/* torso / coat */}
                <path d="M 38 170 Q 30 130 36 95 Q 42 70 58 65 Q 70 62 82 65 Q 98 70 104 95 Q 110 130 102 170 Z" fill="url(#figGrad)"/>
                <path d="M 58 65 Q 70 80 82 65 L 82 170 L 58 170 Z" fill="#EDF6F8"/>
                {/* arms */}
                <path d="M 32 100 Q 22 130 26 160 L 36 168 Q 44 140 42 110 Z" fill="url(#figGrad)"/>
                <path d="M 108 100 Q 118 130 114 160 L 104 168 Q 96 140 98 110 Z" fill="url(#figGrad)"/>
                {/* head */}
                <ellipse cx="70" cy="40" rx="24" ry="26" fill="url(#figGrad)"/>
                {/* hair */}
                <path d="M 46 38 Q 44 16 58 8 Q 70 2 82 8 Q 96 16 94 38 Q 94 50 88 52 Q 92 30 82 24 Q 70 18 58 24 Q 48 30 52 52 Q 46 50 46 38 Z" fill="#8B9FA8"/>
                {/* shine layer line */}
                <rect x="0" y={scanlineY - 1} width="140" height="2" fill="url(#figAccent)" opacity="0.8"/>
              </svg>
            </div>
            {/* Active layer line */}
            {buildHeight > 0.02 && buildHeight < 0.98 && (
              <div className="printer-layer-line" style={{
                bottom: `${buildHeight * 280 - 14}px`,
              }}/>
            )}
          </div>
        </div>
        <div className="printer-tag">layer · <span className="v">{String(layer).padStart(3,'0')}/420</span></div>
        <div className="printer-layer-counter">
          build<br/><span className="v">{Math.floor(buildHeight * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

// ============= STATION 5: POLISH / DETAIL =============
function StationPolish({ progress }) {
  const p = Math.max(0, Math.min(1, progress));
  // 8 sparkles that appear in sequence as you scroll
  const sparkles = [
    { x: 30, y: 20, t: 0.1 }, { x: 70, y: 22, t: 0.2 },
    { x: 22, y: 42, t: 0.3 }, { x: 78, y: 44, t: 0.4 },
    { x: 48, y: 30, t: 0.5 }, { x: 20, y: 70, t: 0.6 },
    { x: 80, y: 72, t: 0.7 }, { x: 50, y: 88, t: 0.8 },
  ];

  return (
    <div className="polish-stage">
      <div className="polish-figure">
        <svg viewBox="0 0 220 420" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="polGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#FFFFFF"/>
              <stop offset="100%" stopColor="#C4E2EC"/>
            </linearGradient>
            <filter id="polGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation={2 + p * 2} result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <g filter="url(#polGlow)">
            <ellipse cx="110" cy="400" rx="70" ry="8" fill="#B8D8E0"/>
            <rect x="50" y="384" width="120" height="20" rx="3" fill="#D4E8EE"/>
            <path d="M 74 384 L 78 300 Q 80 270 92 260 L 106 260 L 110 384 Z" fill="url(#polGrad)"/>
            <path d="M 146 384 L 142 300 Q 140 270 128 260 L 114 260 L 110 384 Z" fill="url(#polGrad)"/>
            <path d="M 68 260 Q 66 272 68 280 L 152 280 Q 154 272 152 260 Z" fill="#D0E8F0"/>
            <path d="M 66 260 Q 56 200 62 150 Q 68 110 90 102 Q 110 98 130 102 Q 152 110 158 150 Q 164 200 154 260 Z" fill="url(#polGrad)"/>
            <path d="M 90 102 Q 110 120 130 102 L 130 260 L 90 260 Z" fill="#EDF6F8"/>
            <path d="M 56 148 Q 42 190 46 244 L 60 256 Q 72 210 70 166 Z" fill="url(#polGrad)"/>
            <path d="M 164 148 Q 178 190 174 244 L 160 256 Q 148 210 150 166 Z" fill="url(#polGrad)"/>
            <ellipse cx="110" cy="60" rx="38" ry="42" fill="url(#polGrad)"/>
            <path d="M 72 58 Q 70 22 92 10 Q 110 2 128 10 Q 150 22 148 58 Q 148 74 138 76 Q 146 42 128 32 Q 110 24 92 32 Q 74 42 82 76 Q 72 74 72 58 Z" fill="#8B9FA8"/>
            {/* face hints */}
            <circle cx="100" cy="58" r="2" fill="#3A5560"/>
            <circle cx="120" cy="58" r="2" fill="#3A5560"/>
            <path d="M 104 72 Q 110 76 116 72" stroke="#3A5560" strokeWidth="1" fill="none"/>
          </g>
        </svg>
        {sparkles.map((s, i) => (
          <div key={i} className="polish-sparkle" style={{
            left: `${s.x}%`, top: `${s.y}%`,
            opacity: p > s.t ? (0.7 + Math.sin(p * 20 + i) * 0.3) : 0,
            transform: `translate(-50%,-50%) rotate(${p * 180}deg) scale(${p > s.t ? 1 : 0.3})`,
            transition: 'opacity 0.4s ease'
          }}/>
        ))}
      </div>
    </div>
  );
}

// ============= STATION 6: SHIPPING =============
function StationShipping({ progress }) {
  const p = Math.max(0, Math.min(1, progress));
  // box enters → tape applied → wrapped label on top → glow
  const lift = p > 0.5;
  const tilt = Math.min(1, p / 0.4);
  const rot = tilt * 18;
  const scale = 0.7 + Math.min(1, p / 0.2) * 0.3;

  return (
    <div className="box-stage">
      <div className="pkg" style={{
        transform: `translateY(${(1-Math.min(1, p/0.15)) * 60}px) rotateX(${10 - rot * 0.3}deg) rotateY(${-12 + rot * 0.5}deg) scale(${scale})`,
      }}>
        <div className="pkg-shadow"/>
        <div className={`pkg-glow ${lift ? 'on' : ''}`}/>
        <div className="pkg-body">
          <div className="pkg-label">fig / 0482 · IST</div>
          <div className="pkg-tape">
            <span className="pkg-logo-mark"/> figurunica · handle with care
          </div>
        </div>
      </div>
    </div>
  );
}

// ============= STATION 7: REVEAL =============
function StationReveal({ progress }) {
  const p = Math.max(0, Math.min(1, progress));
  // Both cards rise in slightly offset
  return (
    <div className="reveal-stage">
      <div className="reveal-card before" style={{
        transform: `translateY(${(1 - Math.min(1, p / 0.4)) * 40}px)`,
        opacity: Math.min(1, p / 0.2),
      }}>
        <div className="label">Original photo</div>
        <img src="assets/examples/realistic.png" alt="Before"/>
      </div>
      <div className="reveal-arrow"><div className="line"/></div>
      <div className="reveal-card after" style={{
        transform: `translateY(${(1 - Math.min(1, (p - 0.2) / 0.4)) * 40}px)`,
        opacity: Math.min(1, Math.max(0, (p - 0.15) / 0.2)),
      }}>
        <div className="label">Your figurine</div>
        <img src="assets/examples/chibi.png" alt="After"/>
      </div>
    </div>
  );
}

window.Stations = {
  StationUpload, StationScan, StationWire, StationPrinter,
  StationPolish, StationShipping, StationReveal
};
