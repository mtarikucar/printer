/**
 * WebGL availability probe.
 *
 * Mounting @react-three/fiber's <Canvas> constructs a THREE.WebGLRenderer,
 * which THROWS `Error: Error creating WebGL context` when the browser cannot
 * create a context — hardware acceleration off, GPU blocklisted, sandboxed /
 * headless environment, or an ancient browser. That throw is uncaught and
 * escapes to the root error boundary (`global-error.tsx`), blanking the whole
 * page with "Bir şeyler ters gitti".
 *
 * Call this (client-side, after mount) before rendering a canvas and show a
 * static fallback when it returns false. Returns false on the server (no
 * `document`), so callers must probe in an effect to avoid a hydration
 * mismatch — never during render.
 */
export function isWebGLAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(
      typeof WebGLRenderingContext !== "undefined" &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    // Some browsers throw from getContext when WebGL is hard-disabled.
    return false;
  }
}
