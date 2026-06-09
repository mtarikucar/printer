import assert from "node:assert/strict";
import { validateModelFile } from "../src/lib/services/model-file-validation";
import {
  uploadModelPriceKurus,
  uploadModelNeedsQuote,
  UPLOAD_MODEL_MIN_KURUS,
} from "../src/lib/config/prices";

// ── validateModelFile ──────────────────────────────────────────────────────
// Binary STL: 80-byte header + uint32 count + 50*count bytes.
function binaryStl(triangles: number): Buffer {
  const buf = Buffer.alloc(84 + triangles * 50);
  buf.writeUInt32LE(triangles, 80);
  return buf;
}
assert.equal(validateModelFile(binaryStl(1), "model.stl").ok, true, "valid binary STL");
assert.equal(validateModelFile(binaryStl(12), "m.STL").format, "stl", "ext case-insensitive");
// Truncated binary STL (claims 10 tris but is short) → invalid.
const truncated = binaryStl(10).subarray(0, 100);
assert.equal(validateModelFile(truncated, "bad.stl").ok, false, "truncated binary STL rejected");

const asciiStl = Buffer.from(
  "solid cube\n facet normal 0 0 0\n  outer loop\n   vertex 0 0 0\n  endloop\n endfacet\nendsolid cube\n"
);
assert.equal(validateModelFile(asciiStl, "a.stl").ok, true, "valid ascii STL");

const obj = Buffer.from("# obj\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
assert.equal(validateModelFile(obj, "m.obj").ok, true, "valid OBJ");
assert.equal(validateModelFile(Buffer.from("v 0 0 0\n"), "noface.obj").ok, false, "OBJ without faces rejected");

assert.equal(validateModelFile(Buffer.from("hello world this is junk"), "x.stl").ok, false, "junk STL rejected");
assert.equal(validateModelFile(binaryStl(1), "model.gltf").ok, false, "unsupported ext rejected");
assert.equal(validateModelFile(Buffer.alloc(4), "tiny.stl").ok, false, "too-small rejected");

// ── uploadModelPriceKurus ──────────────────────────────────────────────────
// 10 cm³ = 10_000 mm³ resin → base 9900 + 10*1500 = 24900.
assert.equal(uploadModelPriceKurus(10_000, "resin"), 24900, "resin 10cm³");
// 10 cm³ filament → 6900 + 10*900 = 15900.
assert.equal(uploadModelPriceKurus(10_000, "filament"), 15900, "filament 10cm³");
// Tiny volume floors at the per-material minimum.
assert.equal(uploadModelPriceKurus(1, "resin"), UPLOAD_MODEL_MIN_KURUS.resin, "resin floor");
assert.equal(uploadModelPriceKurus(0, "filament"), UPLOAD_MODEL_MIN_KURUS.filament, "filament floor at 0");
// Unknown material → resin.
assert.equal(uploadModelPriceKurus(10_000, "titanium"), 24900, "unknown material → resin");
// Monotonic in volume.
assert.ok(uploadModelPriceKurus(50_000, "resin") > uploadModelPriceKurus(10_000, "resin"), "monotonic");

// ── uploadModelNeedsQuote ──────────────────────────────────────────────────
const clean = { isVolume: true, volumeMm3: 20_000, boundingBoxMm: { x: 50, y: 50, z: 80 }, material: "resin" };
assert.equal(uploadModelNeedsQuote(clean), false, "clean geometry → auto price");
assert.equal(uploadModelNeedsQuote({ ...clean, isVolume: false }), true, "non-volume → quote");
assert.equal(uploadModelNeedsQuote({ ...clean, volumeMm3: null }), true, "no volume → quote");
assert.equal(
  uploadModelNeedsQuote({ ...clean, boundingBoxMm: { x: 300, y: 50, z: 80 } }),
  true,
  "oversized bbox → quote"
);
// Huge volume blows the auto-price cap → quote.
assert.equal(uploadModelNeedsQuote({ ...clean, volumeMm3: 5_000_000 }), true, "huge volume → quote");

console.log("✓ test-upload-model: all assertions passed");
