// Tek seferlik: Türkiye il haritası path verisini üretir.
//
// Kaynak: turkey-map-react@2.0.6 (MIT, © 2020 Erdi Gökçe) — 81 ilin SVG path'i
// (1050×585 viewBox, ağırlıkla kübik Bézier). Ham veri ~183 KB; anasayfada
// istemciye gitmesin diye burada:
//   1. Bézier'ler düzleştirilir (8 örnek / eğri),
//   2. Douglas–Peucker ile sadeleştirilir (tolerans 0.6 birim — 1050 genişlikte
//      görünmez),
//   3. 1 ondalığa yuvarlanır,
//   4. en büyük halkanın alan ağırlıklı merkezi (pin/etiket çapası) hesaplanır.
// Sonuç ~41 KB path verisi olarak src/lib/data/turkey-map.ts'e yazılır.
//
// İl adları src/lib/data/turkey-address.ts PROVINCES ile birebir eşlenir
// (kaynaktaki "Hakkâri" → "Hakkari"); eşleşmeyen bir ad çıkarsa script hata
// verir — sessizce eksik il üretmez.
//
// Çalıştırma (tekrar üretmek gerekirse):
//   npx tsx scripts/build-turkey-map.ts            # npm pack ile kaynağı indirir
//   npx tsx scripts/build-turkey-map.ts <lib/data/index.js yolu>

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROVINCES } from "../src/lib/data/turkey-address";

type Pt = [number, number];
const TOLERANCE = 0.6;
const CURVE_SAMPLES = 8;
const NAME_FIXES: Record<string, string> = { "Hakkâri": "Hakkari" };

function loadSource(argPath?: string): { id: string; plateNumber: number; name: string; path: string }[] {
  let file = argPath;
  if (!file) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "turkey-map-"));
    execSync("npm pack turkey-map-react@2.0.6 --silent", { cwd: tmp, stdio: "inherit" });
    const tgz = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error("npm pack çıktısı bulunamadı");
    execSync(`tar xzf ${tgz}`, { cwd: tmp });
    file = path.join(tmp, "package/lib/data/index.js");
  }
  const src = fs.readFileSync(file, "utf8").replace("export var cities", "module.exports.cities");
  const mod: { exports: { cities?: unknown } } = { exports: {} };
  new Function("module", "exports", src)(mod, mod.exports);
  const cities = mod.exports.cities;
  if (!Array.isArray(cities)) throw new Error("cities dizisi okunamadı");
  return cities;
}

// M/C/L/z alt kümesi — kaynak veri yalnızca bunları kullanıyor (doğrulandı).
function flatten(d: string): Pt[][] {
  const tokens = d.match(/[MCLz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const rings: Pt[][] = [];
  let ring: Pt[] | null = null;
  let cmd: string | null = null;
  let cur: Pt = [0, 0];
  let i = 0;
  const num = () => Number(tokens[i++]);
  const closeRing = () => {
    if (ring && ring.length) rings.push(ring);
    ring = null;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[MCLz]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "z") closeRing();
      continue;
    }
    if (cmd === "M") {
      closeRing();
      ring = [];
      cur = [num(), num()];
      ring.push(cur);
      cmd = "L";
    } else if (cmd === "L") {
      cur = [num(), num()];
      ring!.push(cur);
    } else if (cmd === "C") {
      const p0 = cur;
      const p1: Pt = [num(), num()];
      const p2: Pt = [num(), num()];
      const p3: Pt = [num(), num()];
      for (let k = 1; k <= CURVE_SAMPLES; k++) {
        const s = k / CURVE_SAMPLES;
        const ms = 1 - s;
        ring!.push([
          ms * ms * ms * p0[0] + 3 * ms * ms * s * p1[0] + 3 * ms * s * s * p2[0] + s * s * s * p3[0],
          ms * ms * ms * p0[1] + 3 * ms * ms * s * p1[1] + 3 * ms * s * s * p2[1] + s * s * s * p3[1],
        ]);
      }
      cur = p3;
    } else {
      throw new Error(`Beklenmeyen path komutu: ${cmd}`);
    }
  }
  closeRing();
  return rings;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function douglasPeucker(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let k = s + 1; k < e; k++) {
      const dist = perpDist(points[k], points[s], points[e]);
      if (dist > maxD) {
        maxD = dist;
        idx = k;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, k) => keep[k] === 1);
}

function signedArea(r: Pt[]): number {
  let a = 0;
  for (let k = 0; k < r.length; k++) {
    const p = r[k];
    const q = r[(k + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function centroid(r: Pt[]): Pt {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let k = 0; k < r.length; k++) {
    const p = r[k];
    const q = r[(k + 1) % r.length];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
    a += f;
  }
  a /= 2;
  return [cx / (6 * a), cy / (6 * a)];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

const cities = loadSource(process.argv[2]);
const provinceSet = new Set(PROVINCES);
const out: { il: string; plate: number; d: string; cx: number; cy: number }[] = [];
let minx = Infinity;
let miny = Infinity;
let maxx = -Infinity;
let maxy = -Infinity;

for (const c of cities) {
  const il = NAME_FIXES[c.name] ?? c.name;
  if (!provinceSet.has(il)) throw new Error(`PROVINCES'ta olmayan il: ${c.name}`);
  const rings = flatten(c.path)
    .map((r) => douglasPeucker(r, TOLERANCE))
    .filter((r) => r.length >= 3);
  const largest = rings.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const [cx, cy] = centroid(largest);
  for (const r of rings) {
    for (const p of r) {
      minx = Math.min(minx, p[0]);
      maxx = Math.max(maxx, p[0]);
      miny = Math.min(miny, p[1]);
      maxy = Math.max(maxy, p[1]);
    }
  }
  const d = rings.map((r) => "M" + r.map((p) => `${r1(p[0])} ${r1(p[1])}`).join("L") + "Z").join("");
  out.push({ il, plate: c.plateNumber, d, cx: r1(cx), cy: r1(cy) });
}

if (out.length !== 81) throw new Error(`81 il bekleniyordu, ${out.length} üretildi`);
const seen = new Set(out.map((o) => o.il));
for (const il of PROVINCES) if (!seen.has(il)) throw new Error(`Haritada eksik il: ${il}`);

out.sort((a, b) => a.plate - b.plate);
const pad = 4;
const viewBox = `${r1(minx - pad)} ${r1(miny - pad)} ${r1(maxx - minx + 2 * pad)} ${r1(maxy - miny + 2 * pad)}`;

const header = `// ÜRETİLMİŞ DOSYA — elle düzenlemeyin. Yeniden üretmek için:
//   npx tsx scripts/build-turkey-map.ts
//
// Türkiye'nin 81 ilinin sadeleştirilmiş SVG path'leri (Douglas–Peucker, 1 ondalık)
// ve her ilin pin/etiket çapası (en büyük halkanın alan ağırlıklı merkezi).
//
// Kaynak veri: turkey-map-react@2.0.6 — MIT License, Copyright (c) 2020 Erdi Gökçe
// (https://www.npmjs.com/package/turkey-map-react). İl adları
// src/lib/data/turkey-address.ts PROVINCES ile birebirdir.

export interface TurkeyProvincePath {
  /** İl adı — PROVINCES ile birebir (ör. "İstanbul", "Hakkari"). */
  il: string;
  /** Plaka kodu (1–81). */
  plate: number;
  /** SVG path (yalnız M/L/Z, mutlak koordinat). */
  d: string;
  /** Pin/etiket çapası (viewBox koordinatı). */
  cx: number;
  cy: number;
}

export const TURKEY_MAP_VIEWBOX = ${JSON.stringify(viewBox)};

export const TURKEY_MAP_PROVINCES: readonly TurkeyProvincePath[] = [
`;

const body = out
  .map((o) => `  { il: ${JSON.stringify(o.il)}, plate: ${o.plate}, cx: ${o.cx}, cy: ${o.cy}, d: ${JSON.stringify(o.d)} },`)
  .join("\n");

const footer = `
];

const BY_IL = new Map(TURKEY_MAP_PROVINCES.map((p) => [p.il, p] as const));

/** İl adından harita kaydı; bilinmeyen ad için undefined. */
export function provincePath(il: string): TurkeyProvincePath | undefined {
  return BY_IL.get(il);
}
`;

const target = path.join(__dirname, "../src/lib/data/turkey-map.ts");
fs.writeFileSync(target, header + body + footer);
const bytes = fs.statSync(target).size;
console.log(`✓ ${path.relative(process.cwd(), target)} yazıldı — ${out.length} il, viewBox "${viewBox}", ${Math.round(bytes / 1024)} KB`);
