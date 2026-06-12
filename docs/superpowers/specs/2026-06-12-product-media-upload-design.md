# Product Media Upload — Bulk STL/ZIP + Image Performance

Date: 2026-06-12
Status: Approved (design), implementation pending

Two consistent workstreams on the product media pipeline, scoped tight (YAGNI):
**(A) bulk + ZIP print-file upload**, and **(B) image-loading performance**.

---

## A. Bulk STL upload + ZIP acceptance

### Goal
The product spec editor uploads one print file at a time. Sellers/admins with
multi-part products (12-cap) want to drop several STL/OBJ files — or one ZIP
containing them — and have each become a product print file.

### Approach: client-side expansion (chosen)
The browser flattens the selection into individual model files, then uploads
each through the **existing** `POST …/products/[id]/files` endpoint.

Rejected alternatives:
- **Server batch endpoint**: one large combined body re-hits the host nginx
  1 MB→413 limit (a ZIP of parts can exceed 50 MB), and needs zip-slip /
  zip-bomb defense + temp-file handling. More code, more risk.
- **Server `unzip` subprocess**: same downsides plus shell/temp management.

Client expansion keeps each request a single ≤50 MB file (under the proxy
limit), reuses the already-validated save path, and gives per-file progress.

### Behavior
- File input gains `multiple` and accepts `.zip` (alongside `.stl`/`.obj`).
- New `uploadFiles(FileList)` flow:
  1. Flatten: for each selected file, if it is a `.zip`, extract entries whose
     name ends in `.stl`/`.obj` (case-insensitive); skip directories,
     `__MACOSX/`, dotfiles, and non-model entries. Plain files pass through.
  2. Each entry → `partName` = basename without extension (≤120 chars),
     `quantity` = 1. (Single-file path with the name+qty inputs is unchanged
     for precise control.)
  3. Capacity: enforce `MAX_PRODUCT_FILES` (12) on the client — upload up to
     the remaining slots, report `N skipped (limit 12)`.
  4. Upload sequentially via the existing endpoint; accumulate created rows;
     collect per-file failures using the existing error-code messages.
  5. Progress (`Yükleniyor 3/8…`) + final summary
     (`8 dosyadan 7 eklendi · 1 başarısız: x.stl geçersiz STL`).
- Trigger: a single non-zip file with a typed name/qty → current single
  behavior; multiple files or any zip → bulk path (filename names, qty 1).

### Code
- `src/lib/services/model-bundle.ts` (client-safe, pure): 
  `extractModelEntriesFromZip(bytes: Uint8Array): { name: string; bytes: Uint8Array }[]`
  using `fflate`. Unit-testable in node.
- `MAX_PRODUCT_FILES` moves to client-safe `src/lib/config/upload.ts`;
  `product-spec.ts` imports it from there (single source of truth).
- New dep: `fflate` (~8 KB, zero-dep).
- Server: **no change** — every entry flows through the validated `/files`
  handler (size, STL/OBJ content validation, 12-cap, best-effort GLB preview).

### Out of scope (YAGNI)
Post-upload name/qty editing, drag-and-drop, a server batch API.

---

## B. Image-loading performance

### Root causes (evidence-gathered)
1. **Cache-busting URLs (primary).** `getPublicUrl` → `signFilePath` computes
   `exp = now + 24h` on *every* render, so an image's `?exp=&sig=` query
   changes each page load. The browser keys its cache on the full URL, so the
   `Cache-Control: immutable, max-age=1y` header is wasted — every navigation
   re-downloads every image.
2. **Full-size originals.** Product images are stored as the raw upload (≤10 MB
   JPEG/PNG); `sharp` is a dependency but unused for product images. Grids load
   multi-MB originals.

### Fixes
1. **Stable signed URLs.** Quantize `exp` to the TTL boundary:
   `exp = (floor(now / ttl) + 1) * ttl`. Within a 24 h window every render
   yields the *same* exp → the *same* URL → the immutable cache actually hits.
   Signature stays valid (exp ≥ now) and security is unchanged. One-line change
   in `signFilePath`, global benefit across the whole app.
2. **Optimize on upload.** New `src/lib/services/image-optimize.ts` →
   `optimizeDisplayImage(buffer): Promise<{ buffer; ext: "webp"; contentType }>`
   using sharp: `.rotate()` (honor EXIF), `.resize(1600, 1600, { fit: inside,
   withoutEnlargement: true })`, `.webp({ quality: 80 })`. Apply in the product
   image POST handlers (admin + manufacturer). Add `.webp` to the
   `/api/files` MIME map. A typical 4 MB photo → ~150–300 KB.
   - **Not applied** to the customer's AI source photo (`/api/upload` → model
     needs full resolution) or QC/dekont images (evidence/correctness). Those
     keep their originals; only display-grid product images are optimized.

### Out of scope (YAGNI)
Separate thumbnail derivatives, next/image migration, a CDN, on-the-fly
resizing. The cache fix + a single ~200 KB WebP makes grids fast; revisit
thumbnails only if still slow.

---

## Testing
- `extractModelEntriesFromZip`: node test — a zip with 3 STLs + a `.txt` + a
  nested folder yields exactly the 3 STLs.
- `signFilePath` quantization: two calls a second apart return the **same**
  `exp`/`sig` for the same path; the value is ≥ now and `verifyFileSignature`
  accepts it.
- `optimizeDisplayImage`: a large PNG/JPEG in → smaller WebP out, dimensions
  capped at 1600.
- Playwright (live, :3170): multi-select N STLs → N rows; upload a zip → entries
  extracted; over-cap selection reports skips; product image upload returns a
  `.webp` URL; reloading a product page reuses the same image URL (cache key
  stable).
