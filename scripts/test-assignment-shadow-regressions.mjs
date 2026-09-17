// Run: node scripts/test-assignment-shadow-regressions.mjs
// Executes production modules with in-memory I/O; no DB, Redis, or timers.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const nodeRequire = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
function load(relative, mocks = {}, globals = {}, expose = "", cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const loaded = { exports: {} };
  cache.set(filename, loaded.exports);
  const source = fs.readFileSync(filename, "utf8") + expose;
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: loaded, exports: loaded.exports, console, process,
    require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      // Only pure config modules may load recursively. Unexpected I/O imports fail.
      if (id.startsWith("@/lib/config/")) {
        return load(`src/${id.slice(2)}.ts`, mocks, globals, "", cache);
      }
      if (id.startsWith(".") && relative.startsWith("src/lib/config/")) {
        return load(path.join(path.dirname(relative), `${id}.ts`), mocks, globals, "", cache);
      }
      if (id.startsWith("@/") || id.startsWith(".")) {
        throw new Error(`Unstubbed dependency: ${id}`);
      }
      return nodeRequire(id);
    },
    ...globals,
  }, { filename });
  return loaded.exports;
}

const scoring = load("src/lib/config/scoring.ts");
const savedEnv = { ...process.env };
function resetSignals() {
  for (const keys of Object.values(scoring.PHASE5_SIGNAL_ENV)) {
    delete process.env[keys.live];
    delete process.env[keys.shadow];
  }
  delete process.env.MFG_PHASE5_SHADOW;
}

function fixture() {
  const state = { revision: 1, reads: 0, fail: false, now: 100000, calls: [] };
  const mocks = {
    "@/lib/db": { db: { select: () => ({ from: () => ({ where: async () => {
      state.reads++;
      if (state.fail) throw new Error("context unavailable");
      return [{ id: "shop" }];
    } }) }) } },
    "@/lib/db/schema": { manufacturers: { id: "id", status: "status" } },
    "drizzle-orm": { eq: () => true },
    "@/lib/services/manufacturer-capacity": {
      loadManufacturerCapacities: async () => new Map([["shop", { loadUnits: state.revision }]]),
    },
    "@/lib/services/coverage-plan": {
      loadCoveragePlan: async () => state.revision,
      coveragePlanResolver: revision => () => [`province-${revision}`],
    },
    "@/lib/services/manufacturer-assign": { largeFormatPlacementBlocked: () => false },
    "@/lib/services/manufacturer-assignment": {
      rankManufacturersDetailed: async (_id, profiles, opts) => {
        state.calls.push(opts);
        return { byProfile: new Map(profiles.map(p => [p, []])), phase5: opts.phase5Shadow ? [] : null,
          phase5Signals: scoring.signalsForProfile("shadow") };
      },
      rankManufacturersForOrder: async () => { throw new Error("unexpected fallback"); },
    },
  };
  const service = load("src/lib/services/manufacturer-assignment-shadow.ts", mocks, {
    Date: class extends Date { static now() { return state.now; } },
    setTimeout: () => ({ unref() {} }),
    console: { ...console, warn() {} },
  });
  return { state, service };
}

const { ShadowCompare } = load("src/app/admin/assignment-sweep/client.tsx", {
  "next/link": {}, "next/navigation": {}, "@/lib/i18n/format": {},
  "@/lib/i18n/locale-context": {}, "./types": {},
}, {}, "\nexport { ShadowCompare };\n");
function headline(shadow) {
  const html = renderToStaticMarkup(React.createElement(ShadowCompare, { shadow }));
  return /<summary[^>]*>(.*?)<\/summary>/.exec(html)?.[1] ?? html;
}
const comparison = { liveWinnerId: "live", shadowWinnerId: "live", differs: false,
  summaryTr: "comparison", deltas: [], signals: [] };

let passed = 0;
let failed = 0;
async function test(name, run) {
  resetSignals();
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

async function main() {
  await test("missing shadow winner is explicit, even when differs is false", () => {
    const text = headline({ ...comparison, shadowWinnerId: null });
    assert.match(text, /aday yok/i);
    assert.doesNotMatch(text, /fark yok|BAŞKA üretici/);
  });
  await test("both sides without a winner show no candidate", () => {
    assert.match(headline({ ...comparison, liveWinnerId: null, shadowWinnerId: null }), /aday yok/i);
  });
  await test("same, different and unavailable comparisons stay distinct", () => {
    assert.match(headline(comparison), /fark yok/);
    assert.match(headline({ ...comparison, shadowWinnerId: "other", differs: true }), /BAŞKA üretici/);
    assert.match(headline(null), /çalışmadı/);
  });
  await test("default rollout keeps live signals off and caches shadow context for 60s", async () => {
    assert.equal(scoring.anySignalOn(scoring.signalsForProfile("live")), false);
    const { state, service } = fixture();
    await service.rankForOrderShadowPreview("order");
    state.revision = 2;
    await service.rankForOrderShadowPreview("order");
    assert.equal(state.reads, 1);
    assert.equal(state.calls.at(-1).capacities.get("shop").loadUnits, 1);
    state.now += 60001;
    await service.rankForOrderShadowPreview("order");
    assert.equal(state.calls.at(-1).capacities.get("shop").loadUnits, 2);
  });
  for (const entry of ["rankForOrderShadowPreview", "rankForOrderWithShadow"]) {
    for (const signal of ["weightedLoad", "computedCoverage"]) {
      for (const shadowOn of [true, false]) {
        await test(`${entry}: fresh ${signal} live inputs, shadow=${shadowOn}`, async () => {
          const { state, service } = fixture();
          await service[entry]("order"); // warm the shadow-only cache
          process.env[scoring.PHASE5_SIGNAL_ENV[signal].live] = "1";
          process.env.MFG_PHASE5_SHADOW = shadowOn ? "1" : "0";
          for (const revision of [2, 3]) {
            state.revision = revision;
            await service[entry]("order");
            const opts = state.calls.at(-1);
            assert.equal(opts.capacities?.get("shop").loadUnits, revision);
            assert.equal(opts.coverageOf?.({ manufacturerId: "shop", il: null, coverageProvinces: null })[0], `province-${revision}`);
            assert.equal(opts.phase5Shadow, shadowOn);
          }
          assert.equal(state.reads, 3);
        });
      }
    }
    await test(`${entry}: a failed live context read cannot reuse cached telemetry`, async () => {
      const { state, service } = fixture();
      await service[entry]("order");
      process.env[scoring.PHASE5_SIGNAL_ENV.weightedLoad.live] = "1";
      state.fail = true;
      await assert.rejects(service[entry]("order"), /context unavailable/);
      assert.equal(state.calls.length, 1);
    });
  }
  await test("failed shadow-only context remains non-blocking", async () => {
    const { state, service } = fixture();
    state.fail = true;
    await service.rankForOrderWithShadow("order");
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].capacities, undefined);
  });
  await test("no context query when shadow and live context signals are disabled", async () => {
    process.env.MFG_PHASE5_SHADOW = "0";
    const { state, service } = fixture();
    await service.rankForOrderShadowPreview("order");
    assert.equal(state.reads, 0);
  });
}
main().finally(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
});
