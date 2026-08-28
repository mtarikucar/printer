/**
 * Print gate — pure verdict tests.
 *
 * The baseline is a REAL measured order: a meshy-7 figure at 150 mm after
 * print/repair and our own mesh pipeline (2026-08-28). Every failure case
 * mutates exactly one field off that baseline, so a test that trips proves the
 * rule it names and nothing else.
 */
import assert from "node:assert/strict";
import {
  evaluatePrintGate,
  requiresOverride,
  MIN_WALL_HARD_MM,
  MIN_WALL_SAFE_MM,
  PRINT_ENVELOPE_MM,
  type MeshReport,
  type MeshyPrintabilitySummary,
} from "../src/lib/services/print-gate";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

/** Measured on 2026-08-28 from a real meshy-7 + print/repair + process_mesh run. */
const MEASURED: MeshReport = {
  isWatertight: true,
  isVolume: true,
  vertexCount: 151804,
  faceCount: 303628,
  componentCount: 1,
  boundingBox: { size: [42.0, 50.9, 150.0] },
  volumeCm3: 54.39,
  fillRatio: 0.1699,
  baseAdded: true,
  repairsApplied: ["axis_rotated_y_up_to_z_up", "repair_skipped_already_clean", "base_added_boolean"],
  droppedSignificantComponent: false,
  mergedComponentCount: 1,
  minWallP1Mm: 0.644,
  minWallP5Mm: 1.265,
  targetHeightMm: 150,
  measuredHeightMm: 150,
  material: "resin",
};

const MEASURED_MESHY: MeshyPrintabilitySummary = {
  status: "warning",
  volume: 0.1124,
  degenerateFaces: 33260,
};

function report(patch: Partial<MeshReport>): MeshReport {
  return { ...MEASURED, ...patch };
}

console.log("baseline");
test("the real measured order is a warn, not a fail", () => {
  const res = evaluatePrintGate(MEASURED, MEASURED_MESHY);
  assert.equal(res.verdict, "warn", `beklenen warn, gelen ${res.verdict}: ${res.reasonsTr.join(" | ")}`);
  assert.deepEqual(res.failures, []);
  assert.ok(res.warnings.includes("wall_thin_warning"));
  assert.ok(res.warnings.includes("meshy_warning"));
});

test("a clean mesh with no meshy warning is a pass", () => {
  const res = evaluatePrintGate(report({ minWallP1Mm: 1.4, minWallP5Mm: 2.1 }), {
    status: "healthy",
    volume: 0.11,
    degenerateFaces: 0,
  });
  assert.equal(res.verdict, "pass", res.reasonsTr.join(" | "));
  assert.deepEqual(res.warnings, []);
});

console.log("hard failures");
const hardCases: Array<[string, Partial<MeshReport>, string]> = [
  ["not watertight", { isWatertight: false }, "not_watertight"],
  ["not a closed volume", { isVolume: false }, "not_volume"],
  ["a limb was silently amputated", { droppedSignificantComponent: true }, "dropped_significant_component"],
  ["mesh is still in pieces", { componentCount: 2 }, "multiple_components"],
  ["blob with almost no detail", { faceCount: 9_000 }, "too_few_faces"],
  ["mesh too dense for the slicer", { faceCount: 450_000 }, "too_many_faces"],
  ["taller than the print envelope", { boundingBox: { size: [42, 51, PRINT_ENVELOPE_MM.z + 1] } }, "exceeds_envelope"],
  ["wider than the print envelope", { boundingBox: { size: [PRINT_ENVELOPE_MM.x + 1, 51, 150] } }, "exceeds_envelope"],
  ["hollow shell", { fillRatio: 0.01 }, "hollow_shell"],
  ["no base", { baseAdded: false }, "no_base"],
  ["wall below the resin floor", { minWallP1Mm: MIN_WALL_HARD_MM.resin - 0.01 }, "wall_too_thin"],
  ["filament floor is stricter than resin", { material: "filament", minWallP1Mm: 0.7 }, "wall_too_thin"],
];
for (const [name, patch, code] of hardCases) {
  test(name, () => {
    const res = evaluatePrintGate(report(patch), MEASURED_MESHY);
    assert.equal(res.verdict, "fail", `beklenen fail, gelen ${res.verdict}`);
    assert.ok(res.failures.includes(code), `beklenen kod ${code}, gelen ${res.failures.join(",")}`);
  });
}

test("meshy reporting zero volume is a hard fail", () => {
  const res = evaluatePrintGate(MEASURED, { ...MEASURED_MESHY, volume: 0 });
  assert.equal(res.verdict, "fail");
  assert.ok(res.failures.includes("meshy_zero_volume"));
});

test("degenerate faces over 25% is a hard fail", () => {
  const res = evaluatePrintGate(MEASURED, { ...MEASURED_MESHY, degenerateFaces: 100_000 });
  assert.equal(res.verdict, "fail");
  assert.ok(res.failures.includes("too_many_degenerate"));
});

test("the measured 11% degenerate ratio does NOT fail", () => {
  const res = evaluatePrintGate(MEASURED, MEASURED_MESHY);
  assert.ok(!res.failures.includes("too_many_degenerate"));
});

console.log("warnings");
test("thin-but-printable is a warning, not a rejection", () => {
  const p1 = (MIN_WALL_HARD_MM.resin + MIN_WALL_SAFE_MM.resin) / 2;
  const res = evaluatePrintGate(report({ minWallP1Mm: p1 }), { status: "healthy", volume: 0.11, degenerateFaces: 0 });
  assert.equal(res.verdict, "warn");
  assert.ok(res.warnings.includes("wall_thin_warning"));
});
test("widespread thinness is flagged separately from a single splinter", () => {
  const res = evaluatePrintGate(report({ minWallP1Mm: 1.5, minWallP5Mm: 0.7 }), null);
  assert.equal(res.verdict, "warn");
  assert.ok(res.warnings.includes("wall_widespread_thin"));
});
test("a concatenated base is flagged", () => {
  const res = evaluatePrintGate(report({ minWallP1Mm: 1.4, minWallP5Mm: 2.0, repairsApplied: ["base_added_concatenate"] }), null);
  assert.ok(res.warnings.includes("base_concatenated"));
});
test("rescued accessories are reported so a human knows", () => {
  const res = evaluatePrintGate(report({ minWallP1Mm: 1.4, minWallP5Mm: 2.0, mergedComponentCount: 3 }), null);
  assert.ok(res.warnings.includes("components_merged"));
});
test("height drift beyond 5% is a warning", () => {
  const res = evaluatePrintGate(report({ minWallP1Mm: 1.4, minWallP5Mm: 2.0, measuredHeightMm: 160 }), null);
  assert.ok(res.warnings.includes("height_deviation"));
});
test("an unmeasurable wall warns instead of failing", () => {
  const res = evaluatePrintGate(report({ minWallP1Mm: null, minWallP5Mm: null }), null);
  assert.equal(res.verdict, "warn");
  assert.ok(res.warnings.includes("wall_unmeasured"));
});

console.log("gate mode");
test("shadow mode never blocks the admin's one-click approval", () => {
  const prev = process.env.PRINT_GATE_MODE;
  process.env.PRINT_GATE_MODE = "shadow";
  assert.equal(requiresOverride("fail"), false);
  assert.equal(requiresOverride("warn"), false);
  process.env.PRINT_GATE_MODE = prev;
});
test("enforce mode demands an override only for a fail", () => {
  const prev = process.env.PRINT_GATE_MODE;
  process.env.PRINT_GATE_MODE = "enforce";
  assert.equal(requiresOverride("fail"), true);
  assert.equal(requiresOverride("warn"), false);
  assert.equal(requiresOverride("pass"), false);
  process.env.PRINT_GATE_MODE = prev;
});

test("every failure carries a Turkish reason for the admin card", () => {
  const res = evaluatePrintGate(report({ isWatertight: false, faceCount: 9_000 }), MEASURED_MESHY);
  assert.ok(res.reasonsTr.length >= 2);
  for (const reason of res.reasonsTr) {
    assert.ok(reason.length > 3 && !/^[a-z_]+$/.test(reason), `ham kod sızmış: ${reason}`);
  }
});

console.log(
  failures === 0 ? "\n✅ print-gate: all checks passed" : `\n❌ print-gate: ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
