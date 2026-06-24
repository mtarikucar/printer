// scripts/test-meshy-pipeline.ts — end-to-end smoke of the image-first pipeline
// using the REAL service functions: image-to-image ×2 → back view → multi-image-to-3d.
// run: npx tsx scripts/test-meshy-pipeline.ts <photo.png>   (costs ~29 Meshy credits)
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import {
  meshyImageToImage,
  backViewPrompt,
  VARIATION_NUDGES,
  DEFAULT_IMAGE_MODEL,
} from "../src/lib/services/meshy-image";
import { generateWithMeshy } from "../src/lib/services/meshy";
import { buildTemplatePrompt } from "../src/lib/create/design-templates";

const photoPath = process.argv[2] ?? "public/maskot-face.png";
const dataUri = `data:image/png;base64,${readFileSync(photoPath).toString("base64")}`;

async function main() {
  const basePrompt = buildTemplatePrompt("storybook", [])!;
  console.log("photo:", photoPath, "model:", DEFAULT_IMAGE_MODEL);

  // Stage A — 2 stylized variations
  const variations: string[] = [];
  for (let i = 0; i < 2; i++) {
    const t = Date.now();
    const r = await meshyImageToImage([dataUri], `${basePrompt} ${VARIATION_NUDGES[i]}`, DEFAULT_IMAGE_MODEL);
    variations.push(r.imageUrl);
    console.log(`variation ${i}: ${((Date.now() - t) / 1000).toFixed(0)}s, ${r.consumedCredits}cr`);
    const img = await fetch(r.imageUrl);
    writeFileSync(`/tmp/pipeline-var-${i}.png`, Buffer.from(await img.arrayBuffer()));
  }

  // Customer "selects" variation 0 → Stage B
  const selected = variations[0];

  // Back view of the selected character
  let backUrl: string | null = null;
  try {
    const t = Date.now();
    const back = await meshyImageToImage([selected], backViewPrompt(), DEFAULT_IMAGE_MODEL);
    backUrl = back.imageUrl;
    console.log(`back view: ${((Date.now() - t) / 1000).toFixed(0)}s, ${back.consumedCredits}cr`);
    const img = await fetch(backUrl);
    writeFileSync("/tmp/pipeline-back.png", Buffer.from(await img.arrayBuffer()));
  } catch (e) {
    console.log("back view failed (would fall back to single image):", e instanceof Error ? e.message : e);
  }

  // multi-image-to-3d with [front, back]
  const inputs = backUrl ? [selected, backUrl] : selected;
  console.log("building 3D from", Array.isArray(inputs) ? `${inputs.length} images` : "1 image", "...");
  const t = Date.now();
  const result = await generateWithMeshy(inputs, "storybook");
  console.log(`3D build: ${((Date.now() - t) / 1000).toFixed(0)}s, task ${result.taskId}`);
  const glb = await fetch(result.glbUrl);
  writeFileSync("/tmp/pipeline.glb", Buffer.from(await glb.arrayBuffer()));
  console.log("GLB saved /tmp/pipeline.glb — pipeline OK (obj:", !!result.objUrl, "stl:", !!result.stlUrl, ")");
}
main().catch((e) => { console.error("PIPELINE FAILED:", e); process.exit(1); });
