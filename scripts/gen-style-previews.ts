// scripts/gen-style-previews.ts — generate representative style preview images
// for the create-page style picker via Meshy text-to-image (nano-banana).
// Privacy-safe: no real customer photo used. run: npx tsx scripts/gen-style-previews.ts
import "dotenv/config";
import { writeFileSync } from "node:fs";

const ENDPOINT = "https://api.meshy.ai/openapi/v1/text-to-image";
const key = process.env.MESHY_API_KEY!;

const WHITE_BG = "Full body, centered, plain solid white background, soft studio lighting, collectible figurine product photo.";

const JOBS: { file: string; prompt: string }[] = [
  {
    file: "public/examples/vinyl.png",
    prompt: `A designer vinyl collectible figure (Funko-pop style) of a cheerful young woman: oversized rounded head on a small simplified body, smooth matte vinyl surface, minimal facial detail with large solid dark eyes, simplified colorful outfit in flat bold colors. ${WHITE_BG}`,
  },
  {
    file: "public/examples/claymation.png",
    prompt: `A handmade claymation stop-motion clay figure of a cheerful young boy: soft matte modeling-clay surface with gentle fingerprint texture, chunky simple shapes, warm rounded features, slightly imperfect handcrafted proportions, colorful clothes. ${WHITE_BG}`,
  },
  {
    file: "public/examples/pixel-vinyl.png",
    prompt: `A retro 16-bit voxel pixel-art 3D figure of a cheerful young woman with visible blocky pixels, limited bold color palette, nostalgic video-game aesthetic, thick voxel-style limbs. ${WHITE_BG}`,
  },
  {
    file: "public/examples/pixel-claymation.png",
    prompt: `A retro 16-bit voxel pixel-art 3D figure of a cheerful young boy with visible blocky pixels, limited warm color palette, nostalgic video-game aesthetic, thick voxel-style limbs. ${WHITE_BG}`,
  },
];

async function genOne(prompt: string): Promise<string> {
  const create = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ai_model: "nano-banana", prompt, aspect_ratio: "3:4" }),
  });
  if (!create.ok) throw new Error(`create ${create.status}: ${await create.text()}`);
  const { result: taskId } = await create.json();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${ENDPOINT}/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
    const data = await res.json();
    if (data.status === "SUCCEEDED") return data.image_urls[0];
    if (data.status === "FAILED" || data.status === "CANCELED") throw new Error(JSON.stringify(data));
  }
  throw new Error("timed out");
}

async function main() {
  for (const job of JOBS) {
    const t = Date.now();
    const url = await genOne(job.prompt);
    const img = await fetch(url);
    writeFileSync(job.file, Buffer.from(await img.arrayBuffer()));
    console.log(`${job.file}  (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  }
  console.log("all previews generated");
}
main().catch((e) => { console.error(e); process.exit(1); });
