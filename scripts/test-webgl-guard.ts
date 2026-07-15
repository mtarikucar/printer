/**
 * Smoke test for the WebGL availability probe that guards <ModelViewer>.
 *
 *   npx tsx scripts/test-webgl-guard.ts
 *
 * Reproduces the four states that decide whether the 3D viewer mounts a
 * <Canvas> (which would throw "Error creating WebGL context" and blank the
 * whole page) or falls back to a static message.
 */
import { isWebGLAvailable } from "../src/components/webgl-support";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${name} — got ${actual}, expected ${expected}`);
  if (!ok) failures++;
}

const g = globalThis as any;

function withDom(
  getContext: (type: string) => unknown,
  hasWebGLGlobal = true,
  run: () => void = () => {}
) {
  const prevDoc = g.document;
  const prevGl = g.WebGLRenderingContext;
  g.document = { createElement: () => ({ getContext }) };
  g.WebGLRenderingContext = hasWebGLGlobal ? function () {} : undefined;
  try {
    run();
  } finally {
    g.document = prevDoc;
    g.WebGLRenderingContext = prevGl;
  }
}

// 1. No document (server / node) → never claim WebGL, never crash.
check("no document → false", isWebGLAvailable(), false);

// 2. getContext returns a real context object → available.
withDom(() => ({}), true, () =>
  check("context object → true", isWebGLAvailable(), true)
);

// 3. WebGL hard-disabled: getContext returns null → fallback.
withDom(() => null, true, () =>
  check("getContext null → false", isWebGLAvailable(), false)
);

// 4. WebGLRenderingContext global missing → fallback even if a context leaks.
withDom(() => ({}), false, () =>
  check("no WebGLRenderingContext → false", isWebGLAvailable(), false)
);

// 5. Some browsers throw from getContext when WebGL is blocked → must not
//    propagate; the whole point is that the probe itself never throws.
withDom(
  () => {
    throw new Error("WebGL blocked");
  },
  true,
  () => check("getContext throws → false (no throw)", isWebGLAvailable(), false)
);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll WebGL-guard checks passed.");
