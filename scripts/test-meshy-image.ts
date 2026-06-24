// scripts/test-meshy-image.ts — run: npx tsx scripts/test-meshy-image.ts <path-to-photo.png>
// Smoke-tests the Meshy Image-to-Image API contract (params + nano-banana output)
// before we build the pipeline against it. Costs ~3 Meshy credits.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";

const ENDPOINT = "https://api.meshy.ai/openapi/v1/image-to-image";
const key = process.env.MESHY_API_KEY!;
const photoPath = process.argv[2] ?? "public/examples/realistic.png";
const dataUri = `data:image/png;base64,${readFileSync(photoPath).toString("base64")}`;

const prompt =
  "Reimagine the subject as an adorable storybook-animation 3D collectible " +
  "figurine: cute rounded proportions, big warm eyes, soft studio lighting. " +
  "Plain solid white background, single connected figure.";

async function main() {
  console.log("photo:", photoPath, "model: nano-banana");
  const create = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ai_model: "nano-banana", prompt, reference_image_urls: [dataUri] }),
  });
  console.log("create status", create.status);
  const created = await create.json();
  console.log("create body", JSON.stringify(created));
  const taskId = created.result;
  if (!taskId) throw new Error("no task id in create response");

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${ENDPOINT}/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
    const data = await res.json();
    console.log(i, data.status, data.progress ?? "", "credits:", data.consumed_credits ?? "?");
    if (data.status === "SUCCEEDED") {
      console.log("image_urls", JSON.stringify(data.image_urls));
      const img = await fetch(data.image_urls[0]);
      writeFileSync("/tmp/meshy-i2i-out.png", Buffer.from(await img.arrayBuffer()));
      console.log("saved /tmp/meshy-i2i-out.png — INSPECT identity + style");
      return;
    }
    if (data.status === "FAILED" || data.status === "CANCELED") throw new Error(JSON.stringify(data));
  }
  throw new Error("timed out");
}
main().catch((e) => { console.error(e); process.exit(1); });
