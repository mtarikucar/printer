/**
 * Pre-flight for the Meshy integration. Run before enabling `meshy_enabled`.
 *
 *   npm run check:meshy          # balance + model entitlement only (free)
 *   npm run check:meshy -- --full <image-path>   # spends ~30 credits end to end
 *
 * The docs mark meshy-7 as "requires account entitlement" without saying which
 * plan grants it or what an unentitled key gets back. That belongs in a
 * throwaway check, not in a customer's order.
 *
 * Behind a TLS-intercepting proxy (some corporate/dev machines) Node rejects
 * the chain with "unable to verify the first certificate". Prefix with
 * `NODE_OPTIONS=--use-system-ca`. Production is unaffected.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  getCreditBalance,
  createImageTo3dTask,
  getImageTo3dTask,
  analyzePrintability,
  getPrintAnalysis,
  MESHY_AI_MODEL,
  MESHY_CREDITS_PER_ORDER,
  isTerminal,
} from "../src/lib/services/meshy";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const full = process.argv.includes("--full");
  const imagePath = process.argv[process.argv.indexOf("--full") + 1];

  console.log(`model: ${MESHY_AI_MODEL}   budget/order: ${MESHY_CREDITS_PER_ORDER} credits`);

  const balance = await getCreditBalance();
  console.log(`balance: ${balance} credits (~${Math.floor(balance / MESHY_CREDITS_PER_ORDER)} orders)`);
  if (balance < MESHY_CREDITS_PER_ORDER) {
    console.error("⚠️  balance is below one order's budget");
  }

  if (!full) {
    console.log("\nfree checks passed. Re-run with `-- --full <image.png>` to spend ~30 credits on a real task.");
    return;
  }
  if (!imagePath) {
    console.error("--full needs an image path");
    process.exit(2);
  }

  const bytes = await readFile(imagePath);
  const dataUri = `data:image/png;base64,${bytes.toString("base64")}`;
  console.log(`\nsubmitting ${imagePath} (${Math.round(bytes.length / 1024)} KB) as a data URI…`);

  const started = Date.now();
  const taskId = await createImageTo3dTask(dataUri);
  console.log(`task ${taskId} accepted — meshy-7 entitlement OK`);

  let task = await getImageTo3dTask(taskId);
  while (!isTerminal(task.status)) {
    await sleep(10_000);
    task = await getImageTo3dTask(taskId);
    console.log(`  ${task.status} ${task.progress}%`);
  }
  console.log(
    `image-to-3d ${task.status} in ${Math.round((Date.now() - started) / 1000)}s, ` +
      `${task.consumedCredits} credits, glb=${task.modelUrls.glb ? "yes" : "no"}, ` +
      `video_url=${task.thumbnailUrl ? "thumbnail only" : "none"}`
  );
  if (task.status !== "SUCCEEDED") process.exit(1);

  const analyzeId = await analyzePrintability({ taskId });
  let analysis = await getPrintAnalysis(analyzeId);
  while (!isTerminal(analysis.status)) {
    await sleep(1500);
    analysis = await getPrintAnalysis(analyzeId);
  }
  console.log("print/analyze (free):", JSON.stringify(analysis.printability, null, 2));
}

main().catch((err) => {
  console.error("check-meshy failed:", err.message);
  process.exit(1);
});
