# Faz 1 — Otomatik 3D + Baskı Kapısı + Admin Tek Tık + Müşteri Onayı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ödenmiş bir kişiye özel siparişin 3D modelini insan eli değmeden üretmek, baskıya uygunluğunu sayısal olarak yargılamak, admin'in önüne tek tıklık bir karar olarak koymak ve müşteriye 360° video ile onaylatmak.

**Architecture:** İki yeni BullMQ kuyruğu (`model-generation`, `mesh-processing`) + Meshy istemcisi + Python mesh/turntable araçları + saf bir kapı fonksiyonu. Sipariş `paid → generating → processing_mesh → review → awaiting_customer_approval → approved` yolunu izler; `approved`'dan sonra mevcut üretici/boyacı/kargo makinesine tek satır dokunulmaz. `auto_model_enabled=false` bayrağı bugünkü elle davranışı bayt bayt geri getirir.

**Tech Stack:** Next.js 16, TypeScript strict, Drizzle, BullMQ, Python 3 (trimesh + pymeshlab + manifold3d, `/opt/venv`), ffmpeg.

**Spec:** `docs/superpowers/specs/2026-08-27-whatsapp-ai-otomatik-siparis-design.md` — **§3.9 EK ÖLÇÜM bölümünü mutlaka oku**, üst bölümlerdeki thicken/koşullu-repair tasarımını geçersiz kılıyor.

## Global Constraints

- **Ölçülmüş sözleşme (2026-08-27/28, canlı anahtar):** `ai_model:"meshy-7"` · image-to-3d 64 s / 20 kredi · `print/analyze` 0 kredi / 0,5 s, şema `printability.metrics.*` · `print/repair` 10 kredi / 6 s, yalnız GLB · `video_url` ve `multi_view_thumbnails` **null** · `image_url` 1,5 MB data URI kabul ediyor.
- **`print/repair` ZORUNLU, koşullu değil.** Ham çıktı 610 kabuk içeriyor. Sipariş başına **30 kredi**.
- **Otomatik thicken YOK.** Kapı: `fail` < 0,50 mm (reçine), `warn` 0,50–0,90 mm.
- **Kapı hükmü deterministik olmak zorunda** — duvar ölçümü rastgele örneklemeyle değil, yüz merkezlerinden eşit adımlı yapılır.
- **`image_enhancement: false`** — varsayılanı `true` ve zaten stilize bir görsele uygulanınca konuyu yeniden stilize eder; mesh kusursuz olur, kapı geçer, figür müşterinin çocuğu değildir.
- Migration up/down çifti; sıradaki numara **0044**. `ALTER TYPE ... ADD VALUE` transaction dışında çalışır.
- `src/lib/config/*`, `src/lib/services/meshy.ts`, `print-gate.ts`, `mesh-runner.ts`, `order-model.ts` — hiçbirine `import "server-only"` **eklenmez** (worker bunlara ulaşıyor).
- `tr.ts`'e eklenen her anahtar `en.ts`'e de eklenir.
- Commit mesajları düz conventional commit; **hiçbir AI/Claude izi yok.**
- Kapı `PRINT_GATE_MODE=shadow` (varsayılan) ile canlıya çıkar — engellemez, yalnız rozet basar.

---

### Task 1: Python araçları — `process_mesh.py` yeniden yazımı + `render_turntable.py`

**Files:**
- Modify: `scripts/process_mesh.py`
- Create: `scripts/render_turntable.py`
- Modify: `docker/Dockerfile` (base stage'e `ffmpeg`)

**Interfaces:**
- Produces: `process_mesh.py <in.glb> <out.stl> <report.json> --height-mm N [--material resin|filament]`; rapor anahtarları: `is_watertight, is_volume, vertex_count, face_count, component_count, bounding_box{min,max,size}, volume_cm3, fill_ratio, base_added, repairs_applied[], dropped_significant_component, merged_component_count, min_wall_p1_mm, min_wall_p5_mm, target_height_mm, measured_height_mm, material, processing_time_seconds`.
- Produces: `render_turntable.py <in.glb|stl> <out.mp4> [--frames 24] [--size 480]`.

- [ ] **Step 1.1:** `scripts/process_mesh.py`'yi doğrulanmış prototiple değiştir. Beş düzeltme zorunlu: (a) `load_mesh` `scene.to_geometry()` ile düğüm dönüşümlerini uygular; (b) `orient_z_up` eklenir; (c) `merge_components` `keep_largest_component`'in yerini alır (en büyüğün %2'sinden büyük kabukları manifold3d union'la birleştirir, `dropped_significant_component` yine hesaplanır); (d) `add_base` silindiri modele 0,6 mm sokar ve gövde `height − 3 mm`'ye ölçeklenir; (e) `decimate_if_needed` `preservetopology=True, planarquadric=True` geçer, eşik 400k/300k, ve mesh zaten `is_watertight && is_volume` ise pymeshlab onarımı atlanır.
- [ ] **Step 1.2:** `estimate_wall_percentiles` — yüz merkezlerinden `stride` ile deterministik örnekleme, `(p1, p5)` döndürür.
- [ ] **Step 1.3:** `scripts/render_turntable.py` — saf numpy z-buffer rasterizer + gömülü PNG yazıcı (Pillow/imageio gerekmez) + ffmpeg çağrısı.
- [ ] **Step 1.4:** `docker/Dockerfile` base stage'ine `ffmpeg` ekle. **`libosmesa6`/`pyrender`/`PyOpenGL` EKLEME** — pyrender bu yığında derlenmiyor.
- [ ] **Step 1.5:** Doğrula: `python3 scripts/process_mesh.py <örnek.glb> /tmp/o.stl /tmp/r.json --height-mm 150` çıktısında `is_watertight=true`, `component_count=1`, `measured_height_mm≈150`.
- [ ] **Step 1.6:** Commit: `feat(mesh): baskıya hazır STL boru hattı — eksen düzeltmesi, parça birleştirme, deterministik duvar ölçümü`

---

### Task 2: `print-gate` — saf hüküm fonksiyonu

**Files:**
- Create: `src/lib/config/print-gate.ts`, `src/lib/services/print-gate.ts`
- Create: `scripts/test-print-gate.ts`
- Modify: `package.json` (`test:unit` zincirine `test-print-gate` ekle)

**Interfaces:**
- Produces: `evaluatePrintGate(report: MeshReport, meshy: MeshyPrintabilitySummary | null): GateResult` · `GateResult = { verdict: "pass"|"warn"|"fail"; failures: string[]; warnings: string[]; reasonsTr: string[] }` · `gateMode(): "shadow"|"enforce"` · `requiresOverride(verdict): boolean` · sabitler `PRINT_ENVELOPE_MM`, `MIN_WALL_HARD_MM`, `MIN_WALL_SAFE_MM`, `MIN_FACES`, `MAX_FACES`, `MIN_FILL_RATIO`, `MAX_DEGENERATE_RATIO`.

- [ ] **Step 2.1:** Testi önce yaz — 12 sert red kuralının her biri için bir vaka, artı gerçek ölçülmüş raporun `warn` verdiğini doğrulayan bir vaka (`is_watertight:true, component_count:1, face_count:303628, fill_ratio:0.1699, min_wall_p1_mm:0.644, min_wall_p5_mm:1.265, meshy.status:"warning", meshy.degenerateFaces:33260` → `verdict:"warn"`, `failures:[]`).
- [ ] **Step 2.2:** Testi koş, başarısız olduğunu gör.
- [ ] **Step 2.3:** Modülleri yaz. **Thicken dalı yok, repair dalı yok** — repair yukarı akışta zorunlu.
- [ ] **Step 2.4:** Testi koş, geçtiğini gör. `npm run test:unit` zincirine ekle.
- [ ] **Step 2.5:** Commit: `feat(mesh): baskıya uygunluk kapısı — sayısal eşikler, gölge modu varsayılan`

---

### Task 3: Meshy istemcisi + Python köprüsü

**Files:**
- Create: `src/lib/services/meshy.ts`, `src/lib/services/mesh-runner.ts`
- Create: `scripts/check-meshy.ts` (atılabilir doğrulama betiği)
- Modify: `.env.example`

**Interfaces:**
- Produces: `createImageTo3dTask(imageUrl): Promise<string>` · `getImageTo3dTask(id): Promise<MeshyTask>` · `analyzePrintability({taskId?|modelUrl?}): Promise<string>` · `getPrintAnalysis(id)` · `createPrintRepairTask(inputTaskId): Promise<string>` · `getPrintRepairTask(id)` · `getCreditBalance(): Promise<number>` · `isTerminal(status)` · `classifyTaskError(msg): string` · `MESHY_CREDITS_PER_ORDER = 30` · `MeshyError` (`code`: `no_api_key|http_error|task_failed|timeout|moderation_blocked|insufficient_credits`).
- Produces: `runProcessMesh({inputPath, outputStlPath, reportPath, heightMm, material, onLog}): Promise<RawMeshReport>` · `runRenderTurntable({...}): Promise<boolean>` (**non-fatal**) · `MeshProcessError`.

- [ ] **Step 3.1:** `meshy.ts` — doğrulanmış sözleşme; girdi olarak data URI tercih edilir.
- [ ] **Step 3.2:** `mesh-runner.ts` — `/opt/venv/bin/python3` çözümlemesi (yoksa `python3`), 600 sn timeout + SIGKILL, tipli hata.
- [ ] **Step 3.3:** `scripts/check-meshy.ts` — bakiye + tek atılabilir task; `npm run check:meshy`.
- [ ] **Step 3.4:** `.env.example`'a `MESHY_API_KEY`, `MESHY_AI_MODEL`, `PRINT_GATE_MODE`, `MESHY_MIN_CREDIT_BALANCE`.
- [ ] **Step 3.5:** Commit: `feat(meshy): meshy-7 istemcisi + zorunlu print/repair + python köprüsü`

---

### Task 4: Şema + migration 0044

**Files:** `src/lib/db/schema.ts`, `drizzle/0044_auto_model_pipeline.sql` + `.down.sql`

- [ ] **Step 4.1:** `orderStatusEnum`'a `awaiting_customer_approval` (`awaiting_model`'dan sonra).
- [ ] **Step 4.2:** `orders`: `modelSource text`, `modelGenerationRound integer default 0`, `modelTurntableKey text`, `modelTurntableUrl text`, `modelApprovalToken text`, `customerModelApprovedAt timestamptz`, `customerModelRevisionNote text`.
- [ ] **Step 4.3:** `orderModelApprovals` tablosu (hukuki delil satırı): `id, orderId, revision, glbKey, turntableKey, shownAt, channel, decidedAt, decision, ip, userAgent`.
- [ ] **Step 4.4:** `meshReports`'a: `meshyPrintability jsonb`, `minWallP1Mm`, `minWallP5Mm`, `verdict text`, `verdictReasons jsonb`, `mergedComponentCount integer`, `heightMm numeric`, `fillRatio numeric`.
- [ ] **Step 4.5:** `generationAttempts`'e `credits integer` + **`UNIQUE(order_id, round)`** (turu POST'tan önce sahiplenme; BullMQ stalled-job yeniden koşusunda ikinci 20 kredilik task satın alınmasını yapısal olarak engeller).
- [ ] **Step 4.6:** `npx drizzle-kit generate --name auto_model_pipeline`, sonra `.down.sql`'i elle yaz (enum değeri düşürülemez — down, o statüdeki satırları `review`'a çeker, sütun/tabloları düşürür, enum değerini ölü bırakır; yorumla belgelenir).
- [ ] **Step 4.7:** Commit: `feat(db): otomatik model boru hattı şeması (migration 0044)`

---

### Task 5: Kuyruklar + worker'lar

**Files:** `src/lib/queue/queues.ts`, `src/lib/queue/workers/model-generation.worker.ts`, `src/lib/queue/workers/mesh-processing.worker.ts`, `workers/start.ts`, `src/lib/services/order-model.ts`

**Interfaces:**
- Produces: `getModelGenerationQueue()`, `getMeshProcessingQueue()`, `ModelGenerationJobData = { orderId, round, taskId?, repairTaskId?, polls? }`, `MeshProcessingJobData = { orderId, round, glbKey }`, `attachOrderModel({orderId, glbKey, stlKey, turntableKey, source, note}): Promise<void>`.

- [ ] **Step 5.1:** `attachOrderModel()` — `upload-model` route'undan çıkarılır; worker ve admin **aynı kodla** `orderModelRevisions` satırı + `orders.modelGlb*/modelStl*` yazar.
- [ ] **Step 5.2:** `model-generation` worker: `create-task` → `poll-task` (kendini 10 sn gecikmeyle yeniden kuyruğa atar, **bloklu poll yok**, 90 tur = 15 dk) → `analyze` → `repair` → `poll-repair` → GLB'yi `UPLOAD_DIR`'e indir → `mesh-processing`'e devret. Her adımda `reserveSpend`/`settleSpend`. `generationAttempts` turu POST'tan **önce** sahiplenilir.
- [ ] **Step 5.3:** `mesh-processing` worker: `runProcessMesh` → `evaluatePrintGate` → `runRenderTurntable` (non-fatal) → `attachOrderModel` → `meshReports` yaz → `orders.status='review'`. Hüküm ne olursa olsun `review`.
- [ ] **Step 5.4:** İki kuyruğa da `lockDuration: 900_000`, `maxStalledCount: 1`, `attempts: 2`.
- [ ] **Step 5.5:** `workers/start.ts`'e ikisini de ekle.
- [ ] **Step 5.6:** Commit: `feat(worker): meshy üretim + mesh işleme kuyrukları`

---

### Task 6: `kickOffOrderProcessing` dalı + admin onayı + müşteri onayı

**Files:** `src/lib/services/order-confirm.ts`, `src/app/api/admin/orders/[id]/approve/route.ts`, `src/lib/services/model-approval.ts`, `src/app/onay/[token]/page.tsx`, `src/app/api/onay/[token]/route.ts`

- [ ] **Step 6.1:** `kickOffOrderProcessing` — tek dal, muhafızlar: `auto_model_enabled` ∧ `orderType==='custom'` ∧ `previewId` ∧ `!uploadedModelId` ∧ `resolveTargetHeightMm().ok` ∧ `contentConsentVersion >= CONTENT_CONSENT_VERSION_MESHY` ∧ `reserveSpend` ∧ bakiye ≥ `MESHY_MIN_CREDIT_BALANCE`. Değilse **bugünkü `awaiting_model`**.
- [ ] **Step 6.2:** `approve` route'unu dallandır: `requiresCustomerModelApproval(order)` ise hedef `awaiting_customer_approval`, e-posta `model_approval_request` (**`order_approved` DEĞİL**), `manufacturerStatus`'a dokunma. Aksi hâlde bugünkü davranış birebir.
- [ ] **Step 6.3:** `model-approval.ts` — `orders.model_approval_token` (nanoid(32), `journeyToken`'dan **ayrı**), `orderModelApprovals` satırı, `openModelApproval()` / `decideModelApproval()`.
- [ ] **Step 6.4:** `/onay/[token]` sayfası — turntable videosu + 3 buton (Onaylıyorum / Değişiklik iste / Vazgeç). Atomik `UPDATE ... WHERE status='awaiting_customer_approval'`; ikinci dokunuş dostane no-op.
- [ ] **Step 6.5:** 48 saat otomatik onay (yalnız `verdict='pass'`) + 72 saat müşteri hatırlatması + 7 gün admin görevi — DB tabanlı `upsertJobScheduler`, 6 saatte bir.
- [ ] **Step 6.6:** Commit: `feat(orders): otomatik model üretimi, admin tek tık onayı ve müşteri 3D onayı`

---

### Task 7: Arayüz bütünlüğü ve i18n

**Files:** `src/components/order-status-tracker.tsx`, `src/lib/i18n/dictionaries/{tr,en}.ts`, `src/app/admin/orders/page.tsx`, `src/app/admin/orders/orders-client.tsx`, `src/app/admin/orders/[id]/*`, `src/app/api/files/[...path]/route.ts`

- [ ] **Step 7.1:** Tracker'a `awaiting_customer_approval` adımı (`review` ile `approved` arasına) — aksi hâlde tüm adımlar gri render edilir.
- [ ] **Step 7.2:** `tr.ts` **ve** `en.ts`'e tracker + admin anahtarları.
- [ ] **Step 7.3:** Admin sipariş listesinde yeni statü: `needsAction` grubu + renk haritası + dashboard sayacı.
- [ ] **Step 7.4:** Admin sipariş detayına **kapı kartı**: hüküm rozeti (yeşil/sarı/kırmızı), `reasonsTr` listesi, turntable videosu, ölçüler (yükseklik, hacim, duvar p1/p5, yüz sayısı).
- [ ] **Step 7.5:** `/api/files/[...path]`'e `.mp4` MIME (**bugün yok** — turntable octet-stream inerdi) **ve** HTTP Range/206 desteği (route CORS'ta Range ilan ediyor ama gövdede işlemiyor; `<video>` bunu ister).
- [ ] **Step 7.6:** Commit: `feat(admin): kapı kartı, turntable önizlemesi ve yeni statünün arayüz bütünlüğü`

---

### Task 8: Bütünsel doğrulama

- [ ] **Step 8.1:** `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build` — dördü de temiz.
- [ ] **Step 8.2:** Migration round-trip: up → down → up.
- [ ] **Step 8.3:** `npm run check:meshy` — canlı anahtarla bakiye + meshy-7 erişimi.
- [ ] **Step 8.4:** Uçtan uca kuru koşu: gerçek bir GLB ile `process_mesh.py` + `render_turntable.py` + `evaluatePrintGate`; hüküm ve süre raporlanır.
