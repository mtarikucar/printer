# Image-First Create Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Müşteri 3D'ye gitmeden önce **2 stilize 2D varyasyon** arasından seçsin; seçilenin **arka görünümü** otomatik üretilip **ön+arka** ile `multi-image-to-3d` çalışsın — tüm görsel+3D Meshy kredisinde, Replicate kaldırılarak.

**Architecture:** `preview-generation` kuyruğu iki job adıyla çalışır: `generate-variations` (Stage A — Meshy image-to-image × 2, `status="styled"`, DUR) ve `build-from-selection` (Stage B — arka görünüm + `multi-image-to-3d`, `status="ready"`). Stilize olmayan şablonlar (realistic/object) varyasyon kapısını atlar, ham fotoğrafla doğrudan build edilir. Stilize motoru Replicate `flux-kontext-pro` yerine Meshy Image-to-Image (`nano-banana`).

**Tech Stack:** Next.js 16, Drizzle/Postgres, BullMQ/Redis, Meshy OpenAPI (image-to-image v1 + image-to-3d v2). Test deseni codebase'e uygun: `tsx` smoke scriptleri + `tsc --noEmit` + Playwright e2e (TDD-per-fonksiyon değil — bkz. memory: testing).

Spec: `docs/superpowers/specs/2026-06-24-image-first-create-flow-design.md`

---

### Task 1: Meshy image-to-image sözleşmesini canlı doğrula (smoke-test)

**Files:**
- Create: `scripts/test-meshy-image.ts`

Araştırmada firecrawl kredisi bitti; param adlarını (`ai_model`, `reference_image_urls`) ve nano-banana çıktısını byte-doğrulamadan kod yazma.

- [ ] **Step 1: Smoke script yaz**

```ts
// scripts/test-meshy-image.ts — run: npx tsx scripts/test-meshy-image.ts <path-to-photo.png>
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
  const create = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ai_model: "nano-banana", prompt, reference_image_urls: [dataUri] }),
  });
  console.log("create status", create.status);
  const created = await create.json();
  console.log("create body", JSON.stringify(created));
  const taskId = created.result;
  if (!taskId) throw new Error("no task id");

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
```

- [ ] **Step 2: Çalıştır + çıktıyı GÖZLE**

Run: `npx tsx scripts/test-meshy-image.ts <gerçek bir yüz fotoğrafı>`
Expected: `create status 200`, `{"result":"<uuid>"}`; poll `SUCCEEDED`; `/tmp/meshy-i2i-out.png` oluşur. **Param adları doğrulandıysa** (`reference_image_urls`/`ai_model`) Task 3'e geç; çıktı kimliği koruyorsa nano-banana ile devam, korumuyorsa `nano-banana-pro` dene.

- [ ] **Step 3: Bulguları nota geç** (model seçimi + prompt ayarı). Commit:

```bash
git add scripts/test-meshy-image.ts && git commit -m "test(meshy): image-to-image contract smoke script"
```

---

### Task 2: Şema — enum değerleri + previews kolonları + migration

**Files:**
- Modify: `src/lib/db/schema.ts:192-199` (previewStatusEnum), `:328-357` (previews table)
- Create: `drizzle/<generated>.sql` (drizzle-kit generate çıktısı)

- [ ] **Step 1: previewStatusEnum'a değer ekle**

`schema.ts` enum'a `"styled"` ve `"building"` ekle (varolanları koru):
```ts
export const previewStatusEnum = pgEnum("preview_status", [
  "generating",
  "styled",      // 2D varyasyonlar hazır, seçim bekliyor
  "building",    // seçim yapıldı, arka görünüm + 3D üretiliyor
  "ready",
  "failed",
  "approved",
  "revision_requested",
  "expired",
]);
```

- [ ] **Step 2: previews tablosuna kolon ekle**

`meshyTaskId` satırından önce/sonra (örn. `revisionNote`'tan önce):
```ts
  // 2D varyasyon URL'leri (Meshy image-to-image çıktıları, ./uploads'a indirilmiş).
  styledImageUrls: jsonb("styled_image_urls").$type<string[]>(),
  // Müşterinin seçtiği ön görsel + otomatik üretilen arka görsel.
  selectedStyledImageUrl: text("selected_styled_image_url"),
  backImageUrl: text("back_image_url"),
  // Stage A kaç kez koştu (regenerate sınırı için). 1'den başlar.
  variationRounds: integer("variation_rounds").notNull().default(1),
```

- [ ] **Step 3: Migration üret + incele**

Run: `npx drizzle-kit generate`
Beklenen SQL: `ALTER TYPE "preview_status" ADD VALUE 'styled'` (+building) ve `ALTER TABLE "previews" ADD COLUMN ...`. (PG12+ ADD VALUE'yi transaction'da kabul eder; yeni değer aynı tx'te DATA olarak KULLANILMIYOR — güvenli.) Migration'ı oku, mantıklıysa devam.

- [ ] **Step 4: tsc + commit**

Run: `npx tsc --noEmit` → temiz.
```bash
git add src/lib/db/schema.ts drizzle/ && git commit -m "feat(db): preview styled/building states + variation columns"
```
(Migration deploy.sh ile uygulanır — memory: migration pipeline. Dev'de uygula: `npx drizzle-kit migrate`.)

---

### Task 3: Meshy Image-to-Image servisi

**Files:**
- Create: `src/lib/services/meshy-image.ts`

- [ ] **Step 1: Servisi yaz** (meshy.ts poll desenini birebir izler)

```ts
// Meshy Image-to-Image — bizim 3D uçlarımızla AYNI host/key. nano-banana
// (Google Gemini 2.5 Flash Image, kimlik-koruyan) ile müşteri fotosunu stilize
// 2D varyasyonlara çevirir. API'de seed/n YOK → varyasyon prompt nüansıyla.
const IMAGE_TO_IMAGE_ENDPOINT = "https://api.meshy.ai/openapi/v1/image-to-image";

export type MeshyImageModel = "nano-banana" | "nano-banana-2" | "nano-banana-pro" | "gpt-image-2";
export const DEFAULT_IMAGE_MODEL: MeshyImageModel = "nano-banana";

export interface MeshyImageResult {
  imageUrl: string;
  taskId: string;
  consumedCredits: number;
}

// Her varyasyon çağrısına eklenen küçük nüanslar → near-dupe yerine farklı 2 görsel.
export const VARIATION_NUDGES: string[] = [
  "Three-quarter front angle, warm soft studio lighting, gentle friendly smile.",
  "Straight-on front angle, brighter even lighting, slightly more playful expression.",
];

// nano-banana'dan AYNI karakterin arka görünümü — multi-image-to-3d gerçek arka
// kapsama alsın (tek ön görselin arkası hep tahmin oluyordu).
export function backViewPrompt(): string {
  return (
    "Show the exact same character from directly behind — full rear view of the figure. " +
    "Keep the identical outfit, colors, hairstyle, proportions and art style. " +
    "Plain solid white background. No text."
  );
}

export async function meshyImageToImage(
  referenceInputs: string[],            // public URL veya base64 data URI (1-5)
  prompt: string,
  model: MeshyImageModel = DEFAULT_IMAGE_MODEL,
): Promise<MeshyImageResult> {
  const startTime = Date.now();
  const createRes = await fetch(IMAGE_TO_IMAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MESHY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ai_model: model, prompt, reference_image_urls: referenceInputs }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!createRes.ok) {
    throw new Error(`Meshy image-to-image error (${createRes.status}): ${await createRes.text()}`);
  }
  const { result: taskId } = await createRes.json();

  const WALL_BUDGET_MS = 120_000;
  for (let i = 0; i < 60; i++) {
    if (Date.now() - startTime > WALL_BUDGET_MS) break;
    await new Promise((r) => setTimeout(r, 2000));
    let statusRes: Response;
    try {
      statusRes = await fetch(`${IMAGE_TO_IMAGE_ENDPOINT}/${taskId}`, {
        headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch { continue; }
    if (!statusRes.ok) continue;
    const data = await statusRes.json();
    if (data.status === "SUCCEEDED") {
      const url = data.image_urls?.[0];
      if (!url) throw new Error("Meshy image-to-image returned no image URL");
      return { imageUrl: url, taskId, consumedCredits: data.consumed_credits ?? 0 };
    }
    if (data.status === "FAILED" || data.status === "CANCELED") {
      throw new Error(`Meshy image-to-image ${data.status}: ${data.task_error?.message || "unknown"}`);
    }
  }
  throw new Error("Meshy image-to-image timed out");
}
```

- [ ] **Step 2: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/lib/services/meshy-image.ts && git commit -m "feat(meshy): image-to-image service (nano-banana)"
```

---

### Task 4: Kuyruk tipi — Stage B job data

**Files:**
- Modify: `src/lib/queue/queues.ts:18-33` (after PreviewGenerationJobData)

- [ ] **Step 1: PreviewBuildJobData ekle**

```ts
// Stage B — seçimden sonra 3D build. Stilize: selectedUrl (worker arka görünüm
// üretip [front, back] ile multi-image-to-3d). Non-stilize: rawPhotoKeys (ham
// fotoğraflarla doğrudan, arka görünüm yok).
export interface PreviewBuildJobData {
  previewId: string;
  style: string;
  selectedUrl?: string;
  rawPhotoKeys?: string[];
  modifiers?: string[];
}
```
(Yeni kuyruk YOK — mevcut `preview-generation` kuyruğu iki job adıyla kullanılır: `generate-variations`, `build-from-selection`.)

- [ ] **Step 2: tsc + commit**

```bash
git add src/lib/queue/queues.ts && git commit -m "feat(queue): PreviewBuildJobData for stage B"
```

---

### Task 5: Worker'ı ikiye böl (Stage A / Stage B), Replicate'i çıkar

**Files:**
- Rewrite: `src/lib/queue/workers/preview-generation.worker.ts`

- [ ] **Step 1: Worker'ı yeniden yaz** — `job.name` ile dispatch; `applyStyleTransfer` import'unu kaldır.

İskelet (tam kod, mevcut helper'ları koru):
```ts
import { Worker, Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { getPreviewGenerationQueue, type PreviewGenerationJobData, type PreviewBuildJobData } from "../queues";
import { generateWithMeshy } from "../../services/meshy";
import { meshyImageToImage, backViewPrompt, VARIATION_NUDGES, DEFAULT_IMAGE_MODEL } from "../../services/meshy-image";
import { saveFile, getPublicUrl, getFileBuffer } from "../../services/storage";
import { buildTemplatePrompt, getTemplate, type FigurineStyle, type StyleModifier } from "../../create/design-templates";
import { db } from "../../db";
import { previews } from "../../db/schema";
import { nanoid } from "nanoid";

const VARIATION_COUNT = 2;

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Meshy prod'da public URL'leri çeker; lokalde base64 (localhost'a erişemez).
function toMeshyInput(buffer: Buffer, url: string): string {
  return url.includes("localhost") || url.includes("127.0.0.1")
    ? `data:image/png;base64,${buffer.toString("base64")}`
    : url;
}

// ── Stage A: 2 stilize varyasyon (veya non-stilize → doğrudan build'e geç) ──
async function generateVariations(job: Job<PreviewGenerationJobData>) {
  const { previewId, photoKey } = job.data;
  const style = (job.data.style || "realistic") as FigurineStyle;
  const modifiers = (job.data.modifiers ?? []) as StyleModifier[];
  const scene = { sceneFragment: job.data.sceneFragment ?? null, customText: job.data.sceneCustomText ?? null };
  const photoKeys = job.data.photoKeys && job.data.photoKeys.length > 0 ? job.data.photoKeys : [photoKey];
  const tpl = getTemplate(style);

  try {
    // Non-stilize (realistic/object): varyasyon yok → doğrudan Stage B (ham foto).
    if (!tpl || !tpl.stylize) {
      await db.update(previews).set({ status: "building", updatedAt: new Date() })
        .where(and(eq(previews.id, previewId), eq(previews.status, "generating")));
      await getPreviewGenerationQueue().add("build-from-selection", {
        previewId, style, rawPhotoKeys: photoKeys, modifiers,
      } satisfies PreviewBuildJobData);
      return;
    }

    // Stilize: PRIMARY fotoyu N kez image-to-image'tan geçir (prompt nüansıyla).
    const basePrompt = buildTemplatePrompt(style, modifiers, scene)!;
    const photoBuf = await getFileBuffer(photoKey);
    const ref = toMeshyInput(photoBuf, getPublicUrl(photoKey));
    const urls: string[] = [];
    for (let i = 0; i < VARIATION_COUNT; i++) {
      const r = await meshyImageToImage([ref], `${basePrompt} ${VARIATION_NUDGES[i % VARIATION_NUDGES.length]}`, DEFAULT_IMAGE_MODEL);
      const buf = await downloadFile(r.imageUrl);
      const key = await saveFile(buf, `previews/${previewId}`, `var-${i}-${nanoid()}.png`);
      urls.push(getPublicUrl(key));
      job.log(`variation ${i} ok (credits ${r.consumedCredits})`);
    }

    const [flipped] = await db.update(previews)
      .set({ status: "styled", styledImageUrls: urls, updatedAt: new Date() })
      .where(and(eq(previews.id, previewId), eq(previews.status, "generating")))
      .returning({ id: previews.id });
    if (!flipped) job.log("preview no longer 'generating' — skipping");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unknown";
    await db.update(previews).set({ status: "failed", errorMessage: msg, updatedAt: new Date() }).where(eq(previews.id, previewId));
    throw new Error(`Stage A failed: ${msg}`);
  }
}

// ── Stage B: arka görünüm (stilize) + multi-image-to-3d ──
async function buildFromSelection(job: Job<PreviewBuildJobData>) {
  const { previewId, selectedUrl, rawPhotoKeys, modifiers } = job.data;
  const style = (job.data.style || "realistic") as FigurineStyle;
  try {
    let meshyInputs: string | string[];

    if (selectedUrl) {
      // Stilize yol: seçilen ön görsel referansla arka görünüm üret → [ön, arka].
      const frontBuf = await downloadFile(selectedUrl);
      const frontInput = toMeshyInput(frontBuf, selectedUrl);
      let backUrl: string | null = null;
      try {
        const back = await meshyImageToImage([frontInput], backViewPrompt(), DEFAULT_IMAGE_MODEL);
        const backBuf = await downloadFile(back.imageUrl);
        const backKey = await saveFile(backBuf, `previews/${previewId}`, `back-${nanoid()}.png`);
        backUrl = getPublicUrl(backKey);
        await db.update(previews).set({ backImageUrl: backUrl }).where(eq(previews.id, previewId));
      } catch (e) {
        job.log(`back-view failed (non-fatal, falling back to single image): ${e instanceof Error ? e.message : "?"}`);
      }
      meshyInputs = backUrl
        ? [frontInput, toMeshyInput(await downloadFile(backUrl), backUrl)]
        : frontInput;
    } else {
      // Non-stilize yol: ham fotoğraf(lar)la doğrudan.
      const keys = rawPhotoKeys && rawPhotoKeys.length > 0 ? rawPhotoKeys : [];
      const inputs = await Promise.all(keys.map(async (k) => toMeshyInput(await getFileBuffer(k), getPublicUrl(k))));
      meshyInputs = inputs.length > 1 ? inputs : inputs[0];
    }

    const result = await generateWithMeshy(meshyInputs, style);
    const glbBuffer = await downloadFile(result.glbUrl);
    const glbKey = await saveFile(glbBuffer, `previews/${previewId}`, `${nanoid()}.glb`);
    const localGlbUrl = getPublicUrl(glbKey);

    const persistOptional = async (url: string | null, ext: "obj" | "stl") => {
      if (!url) return null;
      try {
        const buffer = await downloadFile(url);
        const key = await saveFile(buffer, `previews/${previewId}`, `${nanoid()}.${ext}`);
        return { url: getPublicUrl(key), key };
      } catch { return null; }
    };
    const obj = await persistOptional(result.objUrl, "obj");
    const stl = await persistOptional(result.stlUrl, "stl");

    const [flipped] = await db.update(previews)
      .set({
        status: "ready", glbUrl: localGlbUrl, glbKey,
        objUrl: obj?.url ?? null, objKey: obj?.key ?? null,
        stlUrl: stl?.url ?? null, stlKey: stl?.key ?? null,
        meshyTaskId: result.taskId, durationMs: result.durationMs, updatedAt: new Date(),
      })
      .where(and(eq(previews.id, previewId), eq(previews.status, "building")))
      .returning({ id: previews.id });
    if (!flipped) job.log("preview no longer 'building' — skipping");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unknown";
    await db.update(previews).set({ status: "failed", errorMessage: msg, updatedAt: new Date() }).where(eq(previews.id, previewId));
    throw new Error(`Stage B failed: ${msg}`);
  }
}

export function startPreviewGenerationWorker() {
  const worker = new Worker<PreviewGenerationJobData | PreviewBuildJobData>(
    "preview-generation",
    async (job) => {
      if (job.name === "build-from-selection") return buildFromSelection(job as Job<PreviewBuildJobData>);
      return generateVariations(job as Job<PreviewGenerationJobData>);
    },
    { connection: getRedisConnection(), concurrency: 3, limiter: { max: 5, duration: 60000 } }
  );
  worker.on("failed", (job, error) => console.error(`preview ${job?.data.previewId} failed:`, error.message));
  return worker;
}
```

> Not: `getTemplate` `design-templates`'ten export ediliyor (mevcut). `buildTemplatePrompt` import yolu `../../create/design-templates`.

- [ ] **Step 2: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/lib/queue/workers/preview-generation.worker.ts && git commit -m "feat(worker): split preview gen into stage A (variations) + stage B (build)"
```

---

### Task 6: select + regenerate route'ları

**Files:**
- Create: `src/app/api/preview/[id]/select/route.ts`
- Create: `src/app/api/preview/[id]/regenerate/route.ts`

- [ ] **Step 1: select route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import { getPreviewGenerationQueue, type PreviewBuildJobData } from "@/lib/queue/queues";

const bodySchema = z.object({ url: z.string().min(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { url } = bodySchema.parse(await request.json());

  const preview = await db.query.previews.findFirst({ where: eq(previews.id, id) });
  if (!preview) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (preview.status !== "styled") return NextResponse.json({ error: "not selectable" }, { status: 409 });
  if (!preview.styledImageUrls?.includes(url)) return NextResponse.json({ error: "invalid selection" }, { status: 400 });

  await db.update(previews)
    .set({ selectedStyledImageUrl: url, status: "building", updatedAt: new Date() })
    .where(eq(previews.id, id));
  await getPreviewGenerationQueue().add("build-from-selection", {
    previewId: id, style: preview.style, selectedUrl: url, modifiers: preview.modifiers ?? [],
  } satisfies PreviewBuildJobData);

  return NextResponse.json({ status: "building" });
}
```

- [ ] **Step 2: regenerate route** (basit sınır: `variationRounds` cap)

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import { getPreviewGenerationQueue, type PreviewGenerationJobData } from "@/lib/queue/queues";

const MAX_VARIATION_ROUNDS = 4;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const preview = await db.query.previews.findFirst({ where: eq(previews.id, id) });
  if (!preview) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (preview.status !== "styled") return NextResponse.json({ error: "not regenerable" }, { status: 409 });
  if ((preview.variationRounds ?? 1) >= MAX_VARIATION_ROUNDS)
    return NextResponse.json({ error: "limit", code: "regenerate_cap" }, { status: 429 });

  await db.update(previews)
    .set({ status: "generating", styledImageUrls: null, variationRounds: (preview.variationRounds ?? 1) + 1, updatedAt: new Date() })
    .where(eq(previews.id, id));
  await getPreviewGenerationQueue().add("generate-variations", {
    previewId: id, imageUrl: preview.photoUrl, photoKey: preview.photoKey,
    photoKeys: preview.photoKeys ?? undefined, style: preview.style, modifiers: preview.modifiers ?? [],
    sceneCustomText: preview.sceneCustomText ?? undefined,
  } satisfies PreviewGenerationJobData);

  return NextResponse.json({ status: "generating" });
}
```

- [ ] **Step 3: tsc + commit**

```bash
git add "src/app/api/preview/[id]/select" "src/app/api/preview/[id]/regenerate" && git commit -m "feat(api): preview select + regenerate routes"
```

---

### Task 7: generate route — job adını `generate-variations` yap

**Files:**
- Modify: `src/app/api/preview/generate/route.ts:221`

- [ ] **Step 1:** `add("generate-preview", {...})` → `add("generate-variations", {...})`. Body değişmez. (Status hâlâ `"generating"`.)
- [ ] **Step 2: tsc + commit**

```bash
git add src/app/api/preview/generate/route.ts && git commit -m "refactor(api): enqueue generate-variations job"
```

---

### Task 8: poll GET route — yeni alanları döndür

**Files:**
- Modify: `src/app/api/preview/[id]/route.ts:54-61` (ve `:40-50` timeout dalı)

- [ ] **Step 1:** Dönen JSON'a ekle (iki return'de de):
```ts
    styledImageUrls: preview.styledImageUrls ?? [],
    selectedStyledImageUrl: preview.selectedStyledImageUrl ?? null,
    variationRounds: preview.variationRounds ?? 1,
```
- [ ] **Step 2: tsc + commit**

```bash
git add "src/app/api/preview/[id]/route.ts" && git commit -m "feat(api): expose styled variations in preview poll"
```

---

### Task 9: ai-generation worker — Replicate yerine Meshy image-to-image (sipariş-anı parite)

**Files:**
- Modify: `src/lib/queue/workers/ai-generation.worker.ts:7,113-115`

Bu yol önizlemesiz sipariş içindir (nadir). Stilize ise tek varyasyon + arka görünüm yapmak yerine, basitçe: stilize ise 1 image-to-image (nüanssız) → image-to-3d; non-stilize ise mevcut gibi ham foto → image-to-3d. Pariteyi korur, Replicate'i kaldırır.

- [ ] **Step 1:** import değiştir, gövdeyi güncelle:
```ts
// üst: applyStyleTransfer importunu kaldır, ekle:
import { meshyImageToImage, DEFAULT_IMAGE_MODEL } from "../../services/meshy-image";
import { buildTemplatePrompt, getTemplate, type FigurineStyle, type StyleModifier } from "../../create/design-templates";
```
```ts
// 110-115 yerine:
job.log(`Starting Meshy generation (style: ${style})...`);
const tpl = getTemplate(style);
let meshyInput: string;
if (tpl?.stylize) {
  const prompt = buildTemplatePrompt(style, modifiers, {})!;
  const styled = await meshyImageToImage([imageUrl], prompt, DEFAULT_IMAGE_MODEL);
  meshyInput = styled.imageUrl; // public Meshy URL — image-to-3d fetch eder
} else {
  meshyInput = imageUrl;
}
const result = await generateWithMeshy(meshyInput, style);
```
(`costCents: 40` notunu koru ya da kredi-bazlı yorum güncelle.)

- [ ] **Step 2: tsc + commit**

```bash
git add src/lib/queue/workers/ai-generation.worker.ts && git commit -m "refactor(worker): order-time generation uses Meshy image-to-image"
```

---

### Task 10: /create UI — varyasyon seçim adımı

**Files:**
- Modify: `src/app/create/page.tsx` (polling + step 1/2 arası render)
- (Opsiyonel) Create: `src/components/create/variation-picker.tsx`

- [ ] **Step 1: polling state'i genişlet.** `previewStatus` zaten var (line 125). Polling'te (`~572-602`) gelen `data`'dan `styledImageUrls`/`selectedStyledImageUrl` state'e yaz; `status === "styled"` görülünce step'i yeni "varyasyon" görünümüne al (ayrı `Step` değeri eklemek yerine `previewStatus==="styled"` ile koşullu render en az invaziv).

- [ ] **Step 2: VariationPicker bileşeni** (yeni dosya):
```tsx
"use client";
export function VariationPicker({
  urls, onSelect, onRegenerate, canRegenerate, busy,
}: {
  urls: string[]; onSelect: (u: string) => void; onRegenerate: () => void; canRegenerate: boolean; busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Beğendiğin görünümü seç</h2>
      <div className="grid grid-cols-2 gap-3">
        {urls.map((u) => (
          <button key={u} disabled={busy} onClick={() => onSelect(u)}
            className="rounded-xl border overflow-hidden hover:ring-2 ring-black disabled:opacity-50">
            <img src={u} alt="varyasyon" className="w-full aspect-square object-cover" />
          </button>
        ))}
      </div>
      <button onClick={onRegenerate} disabled={!canRegenerate || busy}
        className="text-sm underline disabled:opacity-40">Yeniden üret</button>
    </div>
  );
}
```

- [ ] **Step 3: bağla** — `previewStatus==="styled"` iken VariationPicker render et; `onSelect` → `POST /api/preview/{id}/select {url}` sonra polling devam (status `building`→`ready`→step 2 mevcut viewer). `onRegenerate` → `POST .../regenerate`. `canRegenerate = variationRounds < 4`.

- [ ] **Step 4: tsc + manuel deneme + commit**

Run: `npx tsc --noEmit`; lokal denemede (alt portta — memory: local run isolation) bir foto ile akışı gör.
```bash
git add src/app/create/page.tsx src/components/create/variation-picker.tsx && git commit -m "feat(create): 2D variation selection step"
```

---

### Task 11: Replicate temizliği

**Files:**
- Delete: `src/lib/services/style-transfer.ts` (artık kullanılmıyor)
- Modify: import edenler (yalnızca iki worker — Task 5 & 9'da güncellendi). `removeBackground` başka yerde kullanılıyorsa dokunma.

- [ ] **Step 1:** `grep -rn "style-transfer\|applyStyleTransfer\|flux-kontext" src/` → kalan referans olmamalı. `replicate` paketi başka yerde kullanılmıyorsa `package.json`'dan kaldır (`grep -rn "replicate" src/`).
- [ ] **Step 2: tsc + commit**

```bash
git rm src/lib/services/style-transfer.ts && git commit -m "chore: remove Replicate flux-kontext styling (replaced by Meshy)"
```

---

### Task 12: Doğrulama kapısı

- [ ] **Step 1:** `npx tsc --noEmit` → temiz.
- [ ] **Step 2:** Worker'ı çalıştır (`tsx workers/start.ts` veya mevcut script) + dev app (alt port) → bir foto ile uçtan uca: foto → 2 varyasyon → seç → arka+3D → dokusuz GLB önizleme.
- [ ] **Step 3 (ops.):** Playwright e2e — varyasyon-seçim happy path.
- [ ] **Step 4:** branch'i push etme/merge — kullanıcı onayı bekle (memory: finishing-a-development-branch).

---

## Self-review

- **Spec coverage:** 2 varyasyon (T5), seç (T6), arka görünüm + multi-image-to-3d (T5 buildFromSelection), dokusuz (`generateWithMeshy` `should_texture:false` mevcut), Meshy-native/Replicate kaldır (T9/T11), şema (T2), nano-banana (T3), realistic/object atlama (T5), URL persist (T5 download+save), anti-abuse (mevcut generate route korunur + regenerate cap T6). ✓
- **Placeholder:** yok — her kod adımı tam. ✓
- **Tip tutarlılığı:** `PreviewBuildJobData` (T4) T5/T6'da; `meshyImageToImage`/`backViewPrompt`/`VARIATION_NUDGES`/`DEFAULT_IMAGE_MODEL` (T3) T5/T9'da; `getTemplate`/`buildTemplatePrompt` mevcut export. ✓
- **Açık nokta:** Task 1 smoke-test sonucu nano-banana kimlik korumasını teyit etmezse → `nano-banana-pro`'ya `DEFAULT_IMAGE_MODEL` değiştir (tek satır).
