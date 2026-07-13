/**
 * docs/pazarlama/.build/*.html → docs/pazarlama/*.pdf
 *
 * Önce `python3 scripts/marketing-docs/build.py` çalıştırın, sonra:
 *   node scripts/marketing-docs/render_pdf.mjs
 */
import { chromium } from "playwright";
import { readdir, mkdir } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Playwright'ın beklediği chromium sürümü kurulu olmayabilir (bu makinede 1223
 * bekleniyor, 1228 kurulu). 150 MB'lık yeni indirme yerine cache'teki herhangi
 * bir chromium'u kullan; CDP uyumlu olduğu için sürüm farkı sorun çıkarmaz.
 */
function resolveChromium() {
  if (existsSync(chromium.executablePath())) return undefined; // beklenen sürüm var
  const found = globSync(
    path.join(os.homedir(), ".cache/ms-playwright/chromium-*/chrome-linux*/chrome")
  ).sort();
  if (!found.length) {
    throw new Error("Chromium bulunamadı. Kurmak için: npx playwright install chromium");
  }
  console.log(`  · cache'teki chromium kullanılıyor: ${path.basename(path.dirname(path.dirname(found.at(-1))))}`);
  return found.at(-1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "docs", "pazarlama");
const BUILD = path.join(OUT, ".build");

const footer = `
<div style="width:100%;font-size:7.5pt;color:#8A8C93;padding:0 16mm;
            font-family:Inter,'Liberation Sans',Arial,sans-serif;display:flex;
            justify-content:space-between;">
  <span>Figurunica · Pazarlama Kiti · v1.0 · 13 Temmuz 2026 · iç kullanım</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

await mkdir(OUT, { recursive: true });
const files = (await readdir(BUILD)).filter((f) => f.endsWith(".html")).sort();
if (!files.length) throw new Error("HTML yok — önce build.py çalıştırın.");

const browser = await chromium.launch({ executablePath: resolveChromium() });
const page = await browser.newPage();

for (const f of files) {
  const pdf = path.join(OUT, f.replace(/\.html$/, ".pdf"));
  await page.goto(pathToFileURL(path.join(BUILD, f)).href, { waitUntil: "load" });
  await page.pdf({
    path: pdf,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: footer,
    margin: { top: "14mm", bottom: "16mm", left: "16mm", right: "16mm" },
  });
  console.log(`  ✓ ${path.basename(pdf)}  (${Math.round(statSync(pdf).size / 1024)} KB)`);
}

await browser.close();
console.log(`\nPDF → ${OUT}`);
