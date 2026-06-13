// Voxel mascot generator — renders a beveled-cube pixel map to PNG via sharp.
// Each cell is a "voxel": base fill + lighter top/left bevel + darker
// bottom/right bevel + per-cell shade jitter for the handmade toy feel.
const sharp = require("sharp");

// ── palette ──────────────────────────────────────────────────────────────
const P = {
  G: "#3e7d32", // cap green
  g: "#2e5d24", // cap green dark (brim underside)
  W: "#f3efe6", // white (F, soles, glints)
  S: "#f0a44b", // skin
  s: "#d98c35", // skin shadow
  H: "#e8b04f", // hair
  K: "#19140f", // black (hoodie, glasses)
  k: "#2a221b", // black soft (hoodie light)
  R: "#d22f27", // tongue red
  B: "#5a3a22", // brown (pants patch, shoe)
  b: "#3c2a18", // dark brown (pants)
  D: "#241b12", // pants dark
  o: "#7a4f2c", // shoe brown light
};

// ── pixel map (26 wide × 34 tall, rows auto-padded) ─────────────────────
// space = empty. Reads as: green F-cap, hair tufts, shades w/ glints, smile
// w/ tongue, black F-hoodie w/ drawstrings, CONNECTED raised peace-sign arm,
// hand-in-pocket left arm, patched dark pants, chunky sneakers.
const ROWS = [
  "",
  "        GGGGGGG",
  "      GGGGGGGGGGG",
  "     GGGGGWWGGGGGG",
  "     GGGGGWGGGGGGG",
  "     GGGGGWWGGGGGG",
  "     GGGGGWGGGGGGG",
  "     gggggggggggggg",
  "    HHSSSSSSSSSSHH",
  "   HHSSSSSSSSSSSSHH  S S",
  "   HSKKKWKSSKKKWKSH  S S",
  "   HSKKKKKSSKKKKKSH  SSS",
  "   HSSSSSSSSSSSSSSH  SSS",
  "   HSSSSSSSSSSSSSSH  SS",
  "    SSSSKKKKKKSSSS  KKK",
  "    SSSSKRRRRKSSSS  KKK",
  "     SSSSKKKKSSSS   KK",
  "     SSSSSSSSSSSS   KK",
  "      SSSSSSSSSS   KKK",
  "     KKKKKKKKKKKK KKKK",
  "    KKKKKKKKKKKKKKKKKK",
  "   KKKKKKKKKKKKKKKKKK",
  "   KKKWKWKKKWWWKKKKK",
  "   KKKWKWKKKWKKKKKKK",
  "  KKKKKKKKKKWWKKKKKKK",
  "  KKKKKKKKKKWKKKKKKKK",
  "  KKKKKKKKKKKKKKKKKKK",
  "   bbbbbbbbb bbbbbbb",
  "   bbBbbbbbb bbbbBbb",
  "   bbBBbbbbb bbbBBbb",
  "   bbbbbbbb   bbbbbb",
  "   bbbbbbbb   bbbbbb",
  "  obbbbbbbb   bbbbbbo",
  "  oooooooo     ooooooo",
  "  WWWWWWWW     WWWWWWW",
];
const WIDTH = 26;
const MAP = ROWS.map((r) => r.padEnd(WIDTH, " "));

// deterministic per-cell jitter (no Math.random — reproducible builds)
function jitter(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (n - Math.floor(n)) * 0.16 - 0.08; // -0.08 .. +0.08
}
function shade(hex, f) {
  const v = parseInt(hex.slice(1), 16);
  const ch = (sh) => {
    const c = (v >> sh) & 255;
    return Math.max(0, Math.min(255, Math.round(c * (1 + f))));
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const C = 26; // cell px
const BEV = 5; // bevel thickness
const W = WIDTH * C;
const H = MAP.length * C;

let rects = "";
MAP.forEach((row, y) => {
  [...row].forEach((ch, x) => {
    if (ch === " " || !P[ch]) return;
    const base = P[ch];
    const j = jitter(x, y);
    const px = x * C, py = y * C;
    const w = C - 1.5, h = C - 1.5;
    // base
    rects += `<rect x="${px}" y="${py}" width="${w}" height="${h}" rx="2.5" fill="${shade(base, j)}"/>`;
    // top + left bevel (light)
    rects += `<path d="M${px + 2} ${py + 2} h${w - 4} v${BEV} h-${w - 4 - BEV} v${h - 4 - BEV} h-${BEV} z" fill="${shade(base, 0.22 + j)}" opacity="0.85"/>`;
    // bottom + right bevel (dark)
    rects += `<path d="M${px + w - 2} ${py + h - 2} h-${w - 4} v-${BEV} h${w - 4 - BEV} v-${h - 4 - BEV} h${BEV} z" fill="${shade(base, -0.25 + j)}" opacity="0.8"/>`;
  });
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${rects}</svg>`;

sharp(Buffer.from(svg))
  .resize(768, null, { fit: "inside" })
  .png()
  .toFile(process.argv[2] || "/tmp/maskot-draft.png")
  .then(() => console.log("written", process.argv[2] || "/tmp/maskot-draft.png", `${W}x${H}`));
