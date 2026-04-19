/* global React, ReactDOM */
const { useEffect, useRef, useState } = React;
const { StationUpload, StationScan, StationWire, StationPrinter, StationPolish, StationShipping, StationReveal } = window.Stations;
const { Nav, HeroIntro, StyleGallery, HowItWorks, CtaBand, Footer, FloatingCta, Tweaks } = window.Sections;

const STATION_COUNT = 7;

const COPY = [
  { idx: '01', title: <>Drop a <span className="italic">photo.</span></>, desc: 'One clear shot is all it takes. Front-facing, good light, full body or half — we handle the rest.', caption: 'IMG.jpeg · 1 upload' },
  { idx: '02', title: <>We <span className="italic">see</span> you.</>, desc: 'Our model maps your face, clothing, posture, and hair geometry down to the millimeter.', caption: 'scan · 1,248 points' },
  { idx: '03', title: <>Sculpt in <span className="italic">3D.</span></>, desc: 'A watertight mesh is generated, then refined by a human sculptor until every detail reads.', caption: 'mesh · 12,480 verts' },
  { idx: '04', title: <>Print in <span className="italic">resin.</span></>, desc: 'Layer by luminous layer, your figurine is cured from UV resin on a precision SLA printer.', caption: 'sla · 25µm layers' },
  { idx: '05', title: <>Finished <span className="italic">by hand.</span></>, desc: 'Supports removed, surfaces sanded, features hand-painted. Not mass-produced — made for you.', caption: 'qc · hand finish' },
  { idx: '06', title: <>Boxed with <span className="italic">care.</span></>, desc: 'Padded, wrapped, and sealed in a kraft display box. Gift-ready out of the mailer.', caption: 'pkg · 240g · IST' },
  { idx: '07', title: <>Meet <span className="italic">you.</span></>, desc: 'Pocket-sized. Unmistakably you. A piece of a moment you can hold in your hand.', caption: 'delivered · day 7' },
];

function Journey() {
  const wrapRef = useRef(null);
  const trackRef = useRef(null);
  const [scene, setScene] = useState(0);
  const [sceneProg, setSceneProg] = useState(0);
  const [tx, setTx] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      const scrolled = Math.max(0, Math.min(total, -rect.top));
      const p = total > 0 ? scrolled / total : 0; // 0..1 across whole journey
      const sceneIdx = Math.min(STATION_COUNT - 1, Math.floor(p * STATION_COUNT));
      const withinScene = (p * STATION_COUNT) - sceneIdx; // 0..1 inside current scene
      setScene(sceneIdx);
      setSceneProg(withinScene);
      setTx(-p * (STATION_COUNT - 1) * window.innerWidth);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const stations = [
    StationUpload, StationScan, StationWire, StationPrinter,
    StationPolish, StationShipping, StationReveal
  ];

  return (
    <section className="journey" ref={wrapRef}>
      <div className="journey-stage">
        <div className="stage-bg"/>
        <div className="stage-grid"/>
        <div className="stations-track" ref={trackRef}
             style={{ width: `${STATION_COUNT * 100}vw`, transform: `translateX(${tx}px)` }}>
          {stations.map((Comp, i) => {
            const active = i === scene;
            const prog = active ? sceneProg : (i < scene ? 1 : 0);
            const copy = COPY[i];
            return (
              <div className="station" key={i} data-screen-label={`${copy.idx} ${typeof copy.title === 'string' ? copy.title : copy.idx}`}>
                <div className="station-visual">
                  <Comp progress={prog}/>
                </div>
                <div className="station-copy">
                  <div className="station-index">
                    <span className="bar"/><span className="num">{copy.idx}</span><span>· of 07</span>
                  </div>
                  <h2 className="station-title">{copy.title}</h2>
                  <p className="station-desc">{copy.desc}</p>
                  <div className="station-caption"><span className="dot"/>{copy.caption}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="scene-counter">
          {Array.from({length: STATION_COUNT}).map((_, i) => (
            <div key={i} className={`tick ${i === scene ? 'active' : i < scene ? 'past' : ''}`}/>
          ))}
        </div>
        <div className="scene-label">
          chapter <span className="val">{COPY[scene].idx}</span>
        </div>
      </div>
    </section>
  );
}

function App() {
  const [showFloat, setShowFloat] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowFloat(window.scrollY > window.innerHeight * 0.6 && window.scrollY < document.body.scrollHeight - window.innerHeight * 1.2);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <Nav/>
      <HeroIntro/>
      <Journey/>
      <StyleGallery/>
      <HowItWorks/>
      <CtaBand/>
      <Footer/>
      <FloatingCta show={showFloat}/>
      <Tweaks/>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App/>);
