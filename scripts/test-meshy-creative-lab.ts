// scripts/test-meshy-creative-lab.ts — smoke the Creative Lab keychain flow
// (prototype → build) on our real key. run: npx tsx scripts/test-meshy-creative-lab.ts <photo>
// Costs ~36 credits (prototype 6 + build 30).
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://api.meshy.ai/openapi/creative-lab/keychain/v1";
const key = process.env.MESHY_API_KEY!;
const photoPath = process.argv[2] ?? "public/maskot-face.png";
const dataUri = `data:image/png;base64,${readFileSync(photoPath).toString("base64")}`;

async function poll(kind: "prototype" | "build", id: string): Promise<any> {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${BASE}/${kind}/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) { console.log(`${kind} poll ${res.status}`); continue; }
    const data = await res.json();
    console.log(`${kind} ${i}`, data.status, data.progress ?? "", "credits:", data.consumed_credits ?? "?");
    if (data.status === "SUCCEEDED") return data;
    if (data.status === "FAILED" || data.status === "CANCELED") throw new Error(JSON.stringify(data));
  }
  throw new Error(`${kind} timed out`);
}

async function main() {
  // 1) prototype
  const pRes = await fetch(`${BASE}/prototype`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: dataUri, name: "smoke keychain" }),
  });
  console.log("prototype create", pRes.status);
  const pBody = await pRes.json();
  console.log("prototype body", JSON.stringify(pBody));
  if (!pRes.ok || !pBody.result) throw new Error("prototype create failed");
  await poll("prototype", pBody.result);

  // 2) build
  const bRes = await fetch(`${BASE}/build`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input_task_id: pBody.result,
      options: { badge_shape: "circle", size_mm: 40, remove_background: true },
      output: { format: "glb" },
    }),
  });
  console.log("build create", bRes.status);
  const bBody = await bRes.json();
  console.log("build body", JSON.stringify(bBody));
  if (!bRes.ok || !bBody.result) throw new Error("build create failed");
  const done = await poll("build", bBody.result);
  console.log("model_urls", JSON.stringify(done.model_urls));
  const glb = done.model_urls?.glb;
  if (glb) {
    const r = await fetch(glb);
    writeFileSync("/tmp/keychain.glb", Buffer.from(await r.arrayBuffer()));
    console.log("saved /tmp/keychain.glb — CREATIVE LAB OK");
  }
}
main().catch((e) => { console.error("CREATIVE LAB FAILED:", e); process.exit(1); });
