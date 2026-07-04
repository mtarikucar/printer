# fal.ai image-first figure flow (remove Meshy / auto-3D)

Date: 2026-07-04
Status: approved (full autonomy granted — "en kapsamlı çözüm, en profesyonel mühendislik")

## Goal

Replace all **automatic 3D-mesh generation (Meshy)** with a **2D image** flow:

1. Customer uploads a photo + picks a style.
2. **fal.ai** turns the photo into stylized figure **image** variations.
3. Customer reviews the variations, picks one, and **approves the image**.
4. If approved → purchase. If not → no order.
5. After payment, the **admin manually produces the 3D model** and uploads the
   finished file to the order; the order then advances to fulfilment.

Everything else (pricing, orders, marketplace, manufacturers, QC, shipping,
gift cards, analytics, the customer's own-STL upload flow) stays the same.

## Decisions (locked)

- **fal.ai model:** `fal-ai/nano-banana/edit` (Gemini image edit). Chosen for:
  multi-image input (`image_urls`, matches our multi-photo fusion), $0.039/image
  (cheapest), best identity hold for "photo → figurine", and prompt continuity
  (we already used Meshy's `nano-banana`). Alternative documented:
  `fal-ai/flux-pro/kontext` ($0.04, single image) if we ever want single-image
  edits. Upgrade path: `nano-banana-2` / `nano-banana-pro` for higher fidelity.
- **Variations UX:** keep multi-variation "pick one" (existing VariationPicker).
  N calls with nudged prompts (fal has no seed/n param), like today.
- **Admin 3D:** admin uploads the finished GLB/STL to the order; order advances.
- **Schema:** additive (Approach A). Add columns/enum values; keep old
  Meshy/3D columns for historical rows (do not destructively drop). Safe under
  the raw-SQL prod-migration constraint.
- **Scope:** Phase 1 = main `/create` flow. Phase 2 = Creative Lab onto the same
  rails. Both delivered; Phase 1 verified+deployed first.

## Architecture

### New service — `src/lib/services/fal-image.ts`
Mirrors the deleted `meshy-image.ts` contract so call sites barely change.

```ts
falNanoBananaEdit(imageUrls: string[], prompt: string): Promise<{
  imageUrl: string; requestId: string; costCents: number;
}>
```
- POST `https://queue.fal.run/fal-ai/nano-banana/edit` `{ prompt, image_urls }`,
  `Authorization: Key ${FAL_API_KEY}` — same fal queue pattern as `tripo.ts`.
- Poll `/requests/{id}/status` → on `COMPLETED` fetch `/requests/{id}`, take
  `images[0].url`. Wall budget ~120s. `costCents = 4`.
- Keep `VARIATION_NUDGES` (moved here). Delete `backViewPrompt` (3D-only).

### Customer flow (`/create`)
- `preview-generation.worker.ts` → **Stage A only**: for every template, call
  `falNanoBananaEdit` `VARIATION_COUNT` times with nudged prompts → save PNGs →
  `previews.status = 'styled'`, `styledImageUrls` set. **Delete Stage B**
  (`buildFromSelection`, back-view, `generateWithMeshy`).
- All templates now stylize (the old `stylize=false` short-circuit to 3D is
  removed; every style produces an image). `design-templates.ts` prompts kept,
  re-tuned to describe a *figurine-style image* rather than a printable mesh
  (drop `PRINT_READINESS_CLAUSE`, pose-mode plumbing).
- `POST /api/preview/[id]/select` = **approve**: set `selectedStyledImageUrl` +
  `previews.status = 'approved'`. No 3D build enqueued. `regenerate` unchanged
  (re-runs Stage A, bounded by `variationRounds`).
- `POST /api/preview/[id]/route.ts` (poll) returns image state only.
- Create wizard step 2 shows the selected **image** (not `ModelViewer`). Approve
  → checkout (unchanged). `design-to-product-flow.tsx` updated the same way.

### Post-payment — `order-confirm.ts`
- Remove the three-way Meshy branch. A paid custom order (has an approved
  preview image) → `orders.status = 'awaiting_model'`. No queue enqueued.
- Marketplace + upload orders unchanged.

### Admin flow (`/admin/orders/[id]`)
- New action panel at `awaiting_model`: **"3D modelini yükle"** — drag GLB
  (+optional STL). Endpoint `POST /api/admin/orders/[id]/upload-model`
  (reuses `save-sculpted-mesh` validation: GLB magic bytes, 50 MB cap), saves
  under `models/{orderId}/`, sets `orders.modelGlbKey`/`modelStlKey`,
  transitions `awaiting_model → approved`, logs adminAction `upload_model`,
  emits realtime.
- Summary tab: show the customer-approved **image** + original photo; once a
  model is uploaded, show it in `ModelViewer` (kept for admin) + GLB/STL
  download.
- Stepper/buckets/sidebar: replace `generating`/`processing_mesh` with
  `awaiting_model`; `needsAction` bucket + sidebar badge key on `awaiting_model`.
- Remove the admin "regenerate" (Meshy) button/route. `MeshSculptor` adapted to
  load/save `orders.modelGlbKey` (optional editor on the uploaded model).

### Data model (additive)
- `orders`: **add** `modelGlbKey`, `modelGlbUrl`, `modelStlKey`, `modelStlUrl`
  (admin-uploaded 3D — orders had no 3D column before). Add `modelUploadedAt`.
- `orderStatusEnum`: **add** `awaiting_model`. Keep `generating`,
  `processing_mesh`, `failed_generation`, `failed_mesh` for historical rows
  (unused going forward).
- `previewStatusEnum`: reuse `generating → styled → approved`. `building`/`ready`
  become unused (kept for history). `styledImageUrls`/`selectedStyledImageUrl`
  now hold the fal.ai image (semantics unchanged; source Meshy→fal.ai). The 3D
  columns on `previews` (`glbUrl`…`meshyTaskId`, `backImageUrl`) go unused.
- Admin upload writes to the new `orders.model*` columns — NOT to
  `generation_attempts`. `generation_attempts`/`mesh_reports` (and the
  `generationProviderEnum`) are left untouched for historical rows only; no new
  provider value is needed.
- `adminActionTypeEnum`: **add** `upload_model`.
- Migration: one additive drizzle SQL (new enum values + new `orders` columns).
  Applied to prod as raw SQL per the established constraint.

### `digital_files` upsell
Previously the Meshy-generated STL/OBJ, exposed after payment. Now it is the
**admin-uploaded** model (`orders.modelStlKey`/`modelGlbKey`), so the download
becomes available once the admin uploads the model (not at payment time). The
customer order page gates the download on `modelStlKey` presence.

### Removals (Phase 1)
- `src/lib/services/meshy.ts`, `src/lib/services/meshy-image.ts`.
- `preview-generation.worker.ts` Stage B; `ai-generation.worker.ts` (whole
  Meshy order-time path); `mesh-processing.worker.ts` + auto-invocation of
  `scripts/process_mesh.py`; their queues in `queues.ts` + `workers/start.ts`.
- `src/app/api/admin/orders/[id]/regenerate/route.ts`.
- `scripts/test-meshy-*.ts`, `scripts/gen-style-previews.ts`.
- `MESHY_API_KEY` from `.env.example`; Meshy mention in `privacy/page.tsx`
  (replace with fal.ai as image sub-processor).
- `model-viewer.tsx` kept (admin-side 3D). `tripo.ts` kept or removed (unused).

### Free-generation caps / gates
`config/generation.ts` caps + login/email/phone gates stay — they now guard
fal.ai cost ($0.039/call) instead of Meshy. Thresholds unchanged.

## Phase 2 — Creative Lab (`/urunler`)
Fold keychain/magnet/lamp onto the same rails:
- Generate a fal.ai **image** (product-appropriate prompt) instead of Meshy 3D.
- Customer approves image → **real checkout** (not WhatsApp) → order with a
  product-type dimension → `awaiting_model` → admin uploads 3D.
- Pricing: extend `prices.ts` `ItemKind` with `keychain`/`magnet`/`lamp` (new
  base table, sensible defaults, clearly marked configurable). Reuse the unified
  order/checkout pipeline. Retire the WhatsApp handoff (or keep as a secondary
  contact button).
- `creative_lab_jobs`: repurpose image columns; drop reliance on Meshy task ids.
  Or fold into `previews` with a product-type — decided during Phase 2 planning.

## Testing & rollout
- Unit: fal-image service (mock fetch), price dispatcher for new kinds.
- Typecheck + lint + `next build` green (CI quality gate).
- Manual run: generate on `/create` (needs `FAL_API_KEY`), approve image,
  checkout, admin upload-model advances the order.
- Migration applied to prod DB (raw SQL) before deploy.
- Deploy: branch → verify → merge to `main` (auto-deploy). Phase 1 first.

## Out of scope
Pricing/orders/marketplace/manufacturer/QC/gift-card/analytics internals; the
customer own-STL upload flow (`uploaded_models`, Blender — never used Meshy).
