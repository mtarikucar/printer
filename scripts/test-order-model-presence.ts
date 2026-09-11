/**
 * Order model presence: "has a model" counts every kind, and the legacy
 * generation-attempt fallback applies only to orders with no model of their own.
 * Multi-part revisions made STL-only / GLB-only valid — these lock in that an
 * STL-only order is not "model-less" and never resurrects the superseded mesh.
 */
import {
  currentModelUrl,
  orderHasOwnModel,
  type OrderOwnModelColumns,
} from "../src/lib/config/order-model-presence";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

const none: OrderOwnModelColumns = {
  modelUploadedAt: null,
  modelGlbKey: null,
  modelGlbUrl: null,
  modelStlKey: null,
  modelStlUrl: null,
};
const attempt = {
  outputGlbUrl: "/api/files/gen/old.glb",
  outputStlUrl: "/api/files/gen/old.stl",
};
const stlOnly: OrderOwnModelColumns = {
  ...none,
  modelUploadedAt: new Date(),
  modelStlKey: "models/o/kol.stl",
  modelStlUrl: "/api/files/models/o/kol.stl",
};
const glbOnly: OrderOwnModelColumns = {
  ...none,
  modelUploadedAt: new Date(),
  modelGlbKey: "models/o/preview.glb",
  modelGlbUrl: "/api/files/models/o/preview.glb",
};
const both: OrderOwnModelColumns = {
  modelUploadedAt: new Date(),
  modelGlbKey: glbOnly.modelGlbKey,
  modelGlbUrl: glbOnly.modelGlbUrl,
  modelStlKey: stlOnly.modelStlKey,
  modelStlUrl: stlOnly.modelStlUrl,
};

console.log("orderHasOwnModel");
ok("no columns set → no model", !orderHasOwnModel(none));
ok("STL-only revision counts as a model", orderHasOwnModel(stlOnly));
ok("GLB-only revision counts as a model", orderHasOwnModel(glbOnly));
ok("GLB+STL revision counts as a model", orderHasOwnModel(both));
ok(
  "upload stamp alone counts (serialised string form too)",
  orderHasOwnModel({ ...none, modelUploadedAt: "2026-09-10T08:00:00.000Z" })
);
ok(
  "a key without the stamp still counts",
  orderHasOwnModel({ ...none, modelStlKey: "models/o/x.stl" })
);

console.log("currentModelUrl — legacy order (no model of its own)");
ok("falls back to the attempt GLB", currentModelUrl(none, "glb", attempt) === attempt.outputGlbUrl);
ok("falls back to the attempt STL", currentModelUrl(none, "stl", attempt) === attempt.outputStlUrl);
ok("no attempt (null) → null", currentModelUrl(none, "glb", null) === null);
ok("no attempt (empty relation → undefined) → null", currentModelUrl(none, "stl", undefined) === null);
ok(
  "attempt selected with only one column still works",
  currentModelUrl(none, "stl", { outputGlbUrl: "/g.glb" }) === null
);

console.log("currentModelUrl — order with its own revision");
ok(
  "STL-only revision → NO GLB, never the superseded attempt GLB",
  currentModelUrl(stlOnly, "glb", attempt) === null
);
ok("STL-only revision → its own STL", currentModelUrl(stlOnly, "stl", attempt) === stlOnly.modelStlUrl);
ok(
  "GLB-only revision → NO STL, never the raw attempt STL",
  currentModelUrl(glbOnly, "stl", attempt) === null
);
ok("GLB-only revision → its own GLB", currentModelUrl(glbOnly, "glb", attempt) === glbOnly.modelGlbUrl);
ok(
  "GLB+STL revision → its own files",
  currentModelUrl(both, "glb", attempt) === both.modelGlbUrl &&
    currentModelUrl(both, "stl", attempt) === both.modelStlUrl
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
