"use client";

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useDictionary } from "@/lib/i18n/locale-context";
import { isWebGLAvailable } from "./webgl-support";

// Camera framing is fixed because every model is normalized to a unit bounding
// sphere below — so these numbers hold for a 15 mm keychain and a 300 mm
// figurine alike. Previously the camera sat at a hard-coded distance with hard
// -coded min/max clamps while <Stage> tried to fit the camera to the raw model:
// for anything not authored at ~1 unit, drei wanted a distance far outside the
// clamps and OrbitControls yanked it back every frame — the "zooms in then
// moves around weirdly" symptom.
const CAM_POS: [number, number, number] = [0, 0.55, 3.1];
const MIN_DISTANCE = 1.35;
const MAX_DISTANCE = 8;

/**
 * Loads the GLB and normalizes it: re-centered on its bounding-sphere centre
 * and scaled to radius 1. The scene is cloned because useGLTF caches one
 * object3d per URL — mutating it directly would corrupt every other viewer
 * showing the same model (and re-apply the scaling on each mount).
 */
function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  const object = useMemo(() => {
    const clone = scene.clone(true);
    const sphere = new THREE.Box3()
      .setFromObject(clone)
      .getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius > 0 ? sphere.radius : 1;
    clone.position.sub(sphere.center);
    const holder = new THREE.Group();
    holder.add(clone);
    holder.scale.setScalar(1 / radius);
    return holder;
  }, [scene]);

  return <primitive object={object} />;
}

function LoadingSpinner() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.x += delta * 0.5;
      ref.current.rotation.y += delta * 0.8;
    }
  });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#00D4FF" wireframe />
    </mesh>
  );
}

/**
 * Görüntüleyici iki ayrı sebeple düşer ve ikisine AYNI cümleyi yazmak yanlış
 * teşhistir:
 *
 *  - WebGL yok: <Canvas> rendererı kurarken "Error creating WebGL context"
 *    fırlatır. Sorun TARAYICIDADIR, dosya sağlamdır.
 *  - Model okunamadı: sunucu yüklemede yalnız GLB İMZASINI doğrular (dosyalar
 *    yüz MB'ye çıkabildiği için tamamı ayrıştırılmaz), bu yüzden bozuk ya da
 *    yarım bir dosya görüntüleyiciye kadar gelir ve ayrıştırma/klonlama
 *    sırasında hata fırlatır. Sorun DOSYADADIR, tarayıcı sağlamdır.
 *
 * R3F'in <Canvas> içindeki kendi sınırı, yakaladığı hatayı DOM ağacında yeniden
 * fırlatır (fiber: `if (error) throw error`), yani her ikisi de buraya düşer;
 * hangisi olduğu mesajdan ayrılır.
 */
type ViewerFailure = "webgl" | "model";

function classifyViewerFailure(error: unknown): ViewerFailure {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // three.js'in tarayıcı hatası tek bir cümledir: "Error creating WebGL
  // context". Yükleyici/ayrıştırıcı hataları dosyayı anlatır ("Could not load
  // …", "Unsupported asset…"). Varsayılan bilerek "model": bilinmeyen bir
  // hatada tarayıcıyı suçlamak, kullanıcıyı olmayan bir sorunu aramaya yollar.
  return /webgl|context/i.test(message) ? "webgl" : "model";
}

class CanvasBoundary extends Component<
  {
    renderFallback: (kind: ViewerFailure) => ReactNode;
    onFail?: (kind: ViewerFailure) => void;
    children: ReactNode;
  },
  { failed: ViewerFailure | null }
> {
  state: { failed: ViewerFailure | null } = { failed: null };

  static getDerivedStateFromError(error: unknown) {
    return { failed: classifyViewerFailure(error) };
  }

  componentDidCatch(error: unknown) {
    // Hata KONSOLDA kalır: sayfayı düşürmemek, hatayı gizlemek değildir.
    console.warn("[ModelViewer] 3D önizleme düştü:", error);
    // Fallback'i sınırın kendisi basar (boş kare görünmesin); üstteki bileşen de
    // haber alır ki artık işlemeyen döndür/sıfırla düğmelerini göstermesin.
    this.props.onFail?.(classifyViewerFailure(error));
  }

  render() {
    return this.state.failed
      ? this.props.renderFallback(this.state.failed)
      : this.props.children;
  }
}

export function ModelViewer({
  url,
  className,
  autoRotate,
  previewMode = false,
  errorFallback,
  background = "#F3F2EC",
}: {
  url: string;
  className?: string;
  autoRotate?: boolean;
  previewMode?: boolean;
  /**
   * Model dosyası okunamadığında (eksik, bozuk, ayrıştırılamaz) basılacak kutu.
   * Verilmezse nötr bir Türkçe cümle basılır. Çağıranın kendi cümlesini
   * geçebilmesi şart: yönetici sipariş ekranı burada "dosyayı indir" bağlantısı
   * da veriyor ve o bilgi bu bileşende yok. WebGL cümlesi bunun yerine
   * geçemez — bozuk bir dosya için tarayıcıyı suçlamış olurduk.
   */
  errorFallback?: ReactNode;
  /**
   * Scene + placeholder colour. Defaults to the warm light the storefront and
   * admin surfaces use; the journey page passes its own ink so the viewer sits
   * inside a dark composition instead of punching a white hole through it.
   */
  background?: string;
}) {
  const d = useDictionary();
  const controlsRef = useRef<any>(null);
  const [, setKey] = useState(0);
  // Auto-rotation is a marketing flourish. On the inspection surfaces
  // (manufacturer, admin, /track) it fights whoever is trying to look at a
  // detail, so it is opt-in there and on by default only for previews.
  const rotate = autoRotate ?? previewMode;

  // Probe WebGL after mount only — running it during render would return
  // false on the server and mismatch hydration. `null` = not yet probed.
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => {
    setWebgl(isWebGLAvailable());
  }, []);

  // Dosyanın KENDİSİ orada mı? Eksik bir GLB'de three.js yükleyicisi
  // "Could not load …" ile reddediyor; bu ret React'in renderının dışında,
  // YAKALANMAMIŞ bir sayfa hatası olarak düşüyor (sayfa çalışmaya devam etse de
  // hata izlemede gürültü). Gövdesiz tek bir HEAD isteği bunu yükleyici hiç
  // başlamadan ayırır. Yalnız AÇIK bir HTTP reddi "dosya yok" sayılır:
  // HEAD'i yanıtlamayan bir sunucu (405/501) ya da ağ/CORS hatası dosya
  // hakkında bir şey söylemez — o hallerde yükleyici yine denenir ve hata
  // sınırda yakalanır.
  //
  // Hem yoklamanın hem düşmenin sonucu ADRESİYLE birlikte tutulur ve okurken
  // adres karşılaştırılır. Adres değişince durumu bir efektte sıfırlamak, her
  // model değişiminde fazladan bir render turu açardı; bu haliyle yeni bir
  // adres zaten "ölçülmedi" demektir.
  const [probe, setProbe] = useState<{ url: string; reachable: boolean } | null>(null);
  const reachable = probe && probe.url === url ? probe.reachable : null;
  const [failed, setFailed] = useState<{ url: string; kind: ViewerFailure } | null>(null);
  const failure = failed && failed.url === url ? failed.kind : null;
  useEffect(() => {
    let cancelled = false;
    fetch(url, { method: "HEAD" })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 405 || res.status === 501) {
          setProbe({ url, reachable: true });
          return;
        }
        if (!res.ok) {
          console.warn(
            `[ModelViewer] model dosyası okunamadı (HTTP ${res.status}):`,
            url
          );
        }
        setProbe({ url, reachable: res.ok });
      })
      .catch(() => {
        if (!cancelled) setProbe({ url, reachable: true });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const resetView = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
      setKey((k) => k + 1);
    }
  };

  const defaultClass = previewMode
    ? "w-full h-[300px] sm:h-[400px] md:h-[500px] rounded-2xl overflow-hidden"
    : "w-full h-96 rounded-lg";

  const webglFallback = (
    <div
      className="flex h-full w-full items-center justify-center p-6 text-center"
      style={{ background }}
    >
      <p className="text-sm text-gray-500">
        {d["model.viewer.webglUnavailable"]}
      </p>
    </div>
  );

  // Dosya kaynaklı başarısızlık: metin sözlükten DEĞİL çağrıandan ya da
  // buradan gelir (uygulama yalnız Türkçe; sözlük dosyaları bu değişikliğin
  // kapsamı dışında).
  const modelFallback = errorFallback ?? (
    <div
      className="flex h-full w-full items-center justify-center p-6 text-center"
      style={{ background }}
    >
      <p className="text-sm text-gray-500">
        3D önizleme oluşturulamadı: model dosyası okunamadı ya da bozuk.
      </p>
    </div>
  );

  const fallbackFor = (kind: ViewerFailure) =>
    kind === "webgl" ? webglFallback : modelFallback;

  // Sahne gerçekten çalışıyor mu? Yalnız o zaman döndür/sıfırla düğmeleri
  // anlamlıdır; fallback kutusunun üstünde duran bir "Görünümü sıfırla"
  // düğmesi hiçbir şey yapmıyordu.
  const canvasLive = webgl === true && reachable === true && failure === null;

  return (
    <div className="relative h-full">
      {previewMode && (
        <div className="h-1 bg-gradient-to-r from-green-500 to-green-800 rounded-t-2xl" />
      )}
      <div className={className || defaultClass}>
        {webgl === null || (webgl && reachable === null) ? (
          // Pre-probe placeholder — identical on server + first client render.
          <div className="h-full w-full" style={{ background }} />
        ) : !webgl ? (
          webglFallback
        ) : reachable === false ? (
          modelFallback
        ) : (
          <CanvasBoundary
            key={url}
            renderFallback={fallbackFor}
            onFail={(kind) => setFailed({ url, kind })}
          >
            <Canvas
              camera={{ position: CAM_POS, fov: 45, near: 0.05, far: 100 }}
            >
              <color attach="background" args={[background]} />
              <ambientLight intensity={previewMode ? 0.4 : 0.3} />
              {/* Emerald key light */}
              <directionalLight position={[5, 5, 5]} intensity={1} color="#00D4FF" />
              {/* Cool fill light */}
              <directionalLight position={[-5, 3, -5]} intensity={0.5} color="#1E293B" />
              {previewMode && (
                <directionalLight position={[0, -3, 5]} intensity={0.3} color="#0A0A0B" />
              )}
              {/* No <Stage>: it fitted the camera on its own (fighting
                  OrbitControls' distance clamps) and its environment map is a
                  cross-origin HDR that this app's CSP blocks, so it only ever
                  contributed the camera fight. The lights above are the ones
                  that were actually lighting the scene. */}
              <Suspense fallback={<LoadingSpinner />}>
                <Model url={url} />
              </Suspense>
              <OrbitControls
                ref={controlsRef}
                autoRotate={rotate}
                autoRotateSpeed={1.2}
                enablePan={false}
                minDistance={MIN_DISTANCE}
                maxDistance={MAX_DISTANCE}
              />
            </Canvas>
          </CanvasBoundary>
        )}
      </div>
      {!previewMode && canvasLive && (
        // Inspection surfaces get a reset affordance too — after zooming into a
        // detail there was previously no way back to the framed view.
        <button
          type="button"
          onClick={resetView}
          className="absolute bottom-3 right-3 rounded-lg bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/70"
        >
          {d["model.viewer.resetView"]}
        </button>
      )}
      {previewMode && canvasLive && (
        <>
          {/* Hint overlay */}
          <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-sm text-white rounded-full px-3 py-1 text-xs">
            {d["create.preview.dragToRotate"]}
          </div>
          {/* Reset button */}
          <div className="absolute bottom-4 right-4 flex gap-2">
            <button
              type="button"
              onClick={resetView}
              className="bg-black/50 backdrop-blur-sm text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-black/70 transition-colors"
            >
              {d["model.viewer.resetView"]}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
