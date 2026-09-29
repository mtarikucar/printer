#!/usr/bin/env node
/**
 * /samsunspor sahnesinin videosunu değiştirir.
 *
 *   node scripts/samsunspor-video.mjs "C:/yol/kaynak-video.mp4"
 *
 * Kaynak videodan cihazlara göre birkaç çözünürlük üretir, poster ile
 * paylaşım görselini aynı videodan çıkarır ve sayfanın okuduğu listeyi
 * (src/app/samsunspor/video-manifest.ts) yeniden yazar. Sonrası: commit + push.
 *
 * Neden birden çok çözünürlük: 4K dosya telefonda hem gereksiz veri harcar hem
 * de bazı cihazlarda hiç oynamaz. Sayfa, ekranın gerçek piksel yüksekliğine
 * bakıp yeten en küçük dosyayı seçer.
 *
 * Neden dosya adında özet (hash): ad içerikle birlikte değişir, böylece
 * tarayıcı ve Cloudflare bir yıl önbelleğe alabilir ama eski videoyu asla
 * göstermez.
 *
 * Gereken: PATH üzerinde ffmpeg ve ffprobe.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "samsunspor");
const MANIFEST = join(ROOT, "src", "app", "samsunspor", "video-manifest.ts");
const PUBLIC_PREFIX = "/samsunspor";

/** Hedef yükseklikler. Kaynaktan büyüğü üretilmez: büyütmek kalite katmaz. */
const LADDER = [480, 720, 1080, 2160];

/** Yüksekliğe göre kalite (crf) ve bit hızı tavanı. */
const ENCODE = {
  480: { crf: 22, maxrate: "2500k", level: "3.1" },
  720: { crf: 22, maxrate: "5M", level: "4.0" },
  1080: { crf: 21, maxrate: "9M", level: "4.2" },
  2160: { crf: 21, maxrate: "28M", level: "5.2" },
};

function run(bin, args) {
  return execFileSync(bin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function probe(file) {
  const json = JSON.parse(
    run("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      file,
    ])
  );
  const video = json.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("Dosyada video izi yok.");
  const audio = json.streams.find((s) => s.codec_type === "audio");

  // Telefonla çekilmiş videolar döndürme bilgisi taşır; gerçek boy odur.
  const rotation = Math.abs(
    Number(
      video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
        video.tags?.rotate ??
        0
    )
  );
  const swapped = rotation === 90 || rotation === 270;
  return {
    width: swapped ? video.height : video.width,
    height: swapped ? video.width : video.height,
    duration: Number(json.format.duration),
    hasAudio: Boolean(audio),
  };
}

function hashOf(file) {
  return createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 8);
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

function main() {
  const source = process.argv[2];
  if (!source) {
    console.error('Kullanım: node scripts/samsunspor-video.mjs "kaynak.mp4"');
    process.exit(1);
  }
  const src = resolve(source);
  if (!existsSync(src)) {
    console.error(`Dosya bulunamadı: ${src}`);
    process.exit(1);
  }

  const info = probe(src);
  console.log(
    `Kaynak: ${info.width}x${info.height}, ${info.duration.toFixed(2)} sn, ` +
      `${info.hasAudio ? "sesli" : "sessiz"}`
  );

  // Basamak "kısa kenar"a göre seçilir: 1080p demek kısa kenar 1080 demek,
  // video dikey de olsa yatay da olsa.
  const shortEdge = Math.min(info.width, info.height);
  let heights = LADDER.filter((h) => h <= shortEdge);
  // Kaynak hiçbir basamağa denk gelmiyorsa (örn. 1440) kendisi de eklensin ki
  // elimizdeki en iyi kalite kaybolmasın. Küçük kaynakta tek basamak kendisidir.
  if (!heights.includes(shortEdge) && shortEdge < LADDER[0]) heights = [shortEdge];
  else if (!heights.includes(shortEdge) && shortEdge - Math.max(...heights) > 200) {
    heights.push(shortEdge);
  }
  heights.sort((a, b) => a - b);

  mkdirSync(OUT_DIR, { recursive: true });

  // Önce hepsini geçici adla üret; biri bile patlarsa eski dosyalar yerinde kalır.
  const built = [];
  for (const edge of heights) {
    const scale = edge / shortEdge;
    const w = even(info.width * scale);
    const h = even(info.height * scale);
    const cfg = ENCODE[edge] ?? ENCODE[LADDER.find((l) => l >= edge) ?? 2160];
    const tmp = join(OUT_DIR, `.tmp-${edge}.mp4`);
    console.log(`Kodlanıyor: ${w}x${h} ...`);
    run("ffmpeg", [
      "-y", "-loglevel", "error",
      "-i", src,
      "-map", "0:v:0",
      ...(info.hasAudio ? ["-map", "0:a:0"] : []),
      // setsar=1: kare piksel. Bazı kaynaklar piksel oranı taşır ve tarayıcı
      // videoyu birkaç piksel geniş gösterir.
      "-vf", `scale=${w}:${h}:flags=lanczos,setsar=1`,
      "-c:v", "libx264",
      "-profile:v", "high",
      "-level", cfg.level,
      // 8 bit 4:2:0: her tarayıcı ve her telefon çözebilsin.
      "-pix_fmt", "yuv420p",
      "-crf", String(cfg.crf),
      "-maxrate", cfg.maxrate,
      "-bufsize", cfg.maxrate.replace(/(\d+)/, (m) => String(Number(m) * 2)),
      "-preset", "slow",
      ...(info.hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2"] : ["-an"]),
      // Başlık bilgisi dosyanın başında: video indirilirken oynamaya başlar.
      "-movflags", "+faststart",
      tmp,
    ]);
    built.push({ edge, width: w, height: h, tmp });
  }

  const best = built[built.length - 1];
  const posterTmp = join(OUT_DIR, ".tmp-poster.webp");
  const ogTmp = join(OUT_DIR, ".tmp-og.jpg");
  const posterW = Math.min(best.width, 1920);
  // Poster ilk karedir: video başlarken görüntü sıçramasın.
  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", best.tmp,
    "-frames:v", "1",
    "-vf", `scale=${even(posterW)}:-2:flags=lanczos`,
    "-c:v", "libwebp", "-quality", "82",
    posterTmp,
  ]);
  // Paylaşım görseli son karelerden: figürün kalkanla durduğu an.
  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", String(Math.max(0, info.duration * 0.95)),
    "-i", best.tmp,
    "-frames:v", "1",
    "-vf",
    "scale=1200:630:force_original_aspect_ratio=increase:flags=lanczos,crop=1200:630",
    "-q:v", "3",
    ogTmp,
  ]);

  // Artık her şey hazır: eskileri sil, yenileri yerine koy.
  for (const f of readdirSync(OUT_DIR)) {
    if (/^kalkan.*\.mp4$/.test(f) || /^poster.*\.webp$/.test(f)) {
      unlinkSync(join(OUT_DIR, f));
    }
  }

  const renditions = built.map((b) => {
    const name = `kalkan-${b.edge}.${hashOf(b.tmp)}.mp4`;
    renameSync(b.tmp, join(OUT_DIR, name));
    const bytes = statSync(join(OUT_DIR, name)).size;
    console.log(`  ${name}  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
    return {
      width: b.width,
      height: b.height,
      src: `${PUBLIC_PREFIX}/${name}`,
      bytes,
    };
  });

  const posterName = `poster.${hashOf(posterTmp)}.webp`;
  renameSync(posterTmp, join(OUT_DIR, posterName));
  // og.jpg adı sabit kalır: sosyal ağlar adresi zaten kendileri önbellekler.
  renameSync(ogTmp, join(OUT_DIR, "og.jpg"));

  const manifest = `// BU DOSYA ELLE DÜZENLENMEZ.
// Üreten: node scripts/samsunspor-video.mjs "kaynak.mp4"

export type VideoRendition = {
  /** Piksel boyutu. */
  width: number;
  height: number;
  /** public/ altındaki yol; adındaki özet içerikle birlikte değişir. */
  src: string;
  /** Dosya boyutu (bayt). */
  bytes: number;
};

export const SAMSUNSPOR_VIDEO = {
  /** Genişlik / yükseklik. */
  aspect: ${best.width} / ${best.height},
  durationSeconds: ${Number(info.duration.toFixed(2))},
  hasAudio: ${info.hasAudio},
  poster: "${PUBLIC_PREFIX}/${posterName}",
  /** Küçükten büyüğe sıralı. */
  renditions: ${JSON.stringify(renditions, null, 4).replace(/\n/g, "\n  ")} satisfies VideoRendition[],
};
`;
  writeFileSync(MANIFEST, manifest, "utf8");
  console.log(`Liste yazıldı: ${MANIFEST}`);
  console.log("Tamam. Şimdi commit edip main'e push et.");
}

main();
