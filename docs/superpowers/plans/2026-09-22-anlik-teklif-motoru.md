# Anlık Teklif Motoru Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xometry-style instant quoting for 3D printing (FDM + SLA): multi-part upload → queued geometry analysis with rendered thumbnail → per-part configuration with live, login-gated pricing → quote management (manual/RFQ/target price, chat, share, document, library) → one order through the existing payment/hakediş/assignment/QC pipeline.

**Architecture:** New `quotes`/`quote_parts`/catalog tables (migration 0064, append-only in `schema.ts`); a pure core (`src/lib/config/quote-*.ts`) computes units, DfM, prices and lead days from a per-quote frozen catalog snapshot; services + `/api/quotes/**` routes serialize through ONE presenter that strips prices for non-logged-in viewers; a BullMQ worker runs `scripts/analyze_quote_part.py`; checkout creates an `order_drafts` row + `quote_checkouts` link, and `kickOffOrderProcessing` links the paid order and enqueues a file-attach job.

**Tech Stack:** Next.js 16 App Router (TS strict), Drizzle ORM + PostgreSQL, BullMQ + Redis (ioredis 5.9.3), Python 3 (trimesh, pymeshlab, manifold3d, numpy, Pillow), sharp, three/@react-three, Tailwind 4, tsx test scripts.

**Spec:** `docs/superpowers/specs/2026-09-22-anlik-teklif-motoru-design.md` (read it first; it is the authority on behaviour). Reader briefs with exact file/line facts: `/tmp/claude-1001/-home-tarik-Projects-printer/791f3589-8a6a-4f3d-9cbf-a6248c4ba897/scratchpad/briefs/{geometry,checkout,accounts-ui,admin,partners,misc,xometry,critic}.md`.

## Global Constraints

- Work ONLY inside the worktree `/home/tarik/Projects/printer/.claude/worktrees/anlik-teklif` (branch `worktree-anlik-teklif`). Never touch `/home/tarik/Projects/printer` (another session has uncommitted work there).
- **DO NOT EDIT these files** (another session's in-flight work; conflict): `src/app/api/orders/route.ts`, `src/lib/services/order-draft.ts`, `src/components/checkout/checkout-form.tsx`, `src/app/checkout/checkout-client.tsx`, `src/app/create/page.tsx`, `src/lib/queue/queues.ts`, `src/lib/queue/workers/email.worker.ts`, `src/lib/queue/workers/payment-deadline.worker.ts`, `src/lib/services/paytr.ts`, `src/app/pay/**`, `src/app/havale/**`, `src/app/account/page.tsx`, `src/app/api/customer/orders/[orderNumber]/**`, `src/app/track/**`, `src/app/api/webhooks/paytr/route.ts`, `src/app/api/pay/**`, `src/app/api/admin/drafts/**`, `src/app/admin/drafts/**`, `src/lib/services/draft-commercial-consent.ts`, `src/lib/services/wa-order.ts`, `src/lib/services/workshop-*.ts`, `src/app/shop/[slug]/detail-client.tsx`, `src/components/bank-transfer-instructions.tsx`. Importing their exports is fine.
- **Append-only** edits allowed in: `src/lib/db/schema.ts` (one delimited block at END of file: `// ═══ Anlık teklif motoru (0064) ═══`), `drizzle/meta/_journal.json` (one entry), `package.json` (new `test:*` scripts + appending to `test:unit`).
- Migration is `drizzle/0064_instant_quotes.sql` + `drizzle/0064_instant_quotes.down.sql` + `drizzle/meta/0064_snapshot.json`; journal entry `{"idx":64,"version":"7","when":1789657000000,"tag":"0064_instant_quotes","breakpoints":true}`. `when` MUST be `1789657000000` — strictly BETWEEN 0062 (`1789654507721`) and the other session's still-uncommitted 0063 (`1789657536377`), because this branch deploys to production FIRST (OD-1 → Path B). `drizzle-kit migrate` walks `journal.entries` in ARRAY order against a single `max(created_at)` watermark, so a 0063 that lands afterwards with a SMALLER `when` than 0064 would be skipped forever. Any migration that lands after 0064 has been applied must carry a LARGER `when` (regenerate it as 0065; never hand-merge an older journal entry) — see `scripts/db/README.md`.
- No new pg enum types and no `ALTER TYPE ... ADD VALUE`; status/kind columns are `text` + named `CHECK`.
- Money is integer kuruş everywhere. Prices are KDV-inclusive; KDV-excluded = `computeKdv(total, KDV_RATE_BPS).subtotalKurus` (`src/lib/services/finance.ts`, `src/lib/config/prices.ts` `KDV_RATE_BPS = 2000`).
- Modules imported by BullMQ workers (anything under `src/lib/config/quote-*`, `src/lib/services/quote-order.ts`, `quote-analysis.ts`, `quote-maintenance.ts`, `quote-notify.ts`, `quote-catalog.ts`) MUST NOT `import "server-only"`.
- BullMQ custom job ids: no `:` (use `-`).
- Customer-facing copy is Turkish. Customer UI strings go through the dictionary under the `instantQuote.` prefix, added to BOTH `src/lib/i18n/dictionaries/tr.ts` and `en.ts` (en.ts is the `Dictionary` type source; a key missing in either fails tsc) as ONE block inserted in the MIDDLE of each file (not the end). Landing/SEO prose, emails and admin screens may hardcode Turkish (house precedent).
- API error bodies: `{ error: "<Türkçe cümle>", code?: "snake_code" }`. Wrap handlers with `handleRouteFailure(e, "<METHOD> <path>", <ERROR_CONST>)` from `src/lib/api/route-error.ts`.
- Prices never leave the server for a viewer with `canSeePrices=false` (no price keys at all in JSON, RSC props, or markup).
- Signed file URLs only via `getPublicUrl(key)` at read time; store keys, never URLs; never put signed GLB/source URLs in share views, emails or the document page.
- Git: plain conventional commit messages in Turkish/English, **NO `Co-Authored-By` trailer, no "Generated with Claude", no AI marker anywhere** (user's global rule overrides harness defaults). Author = the configured git user. Commit only your task's files (`git add <paths>`; never `git add -A`).
- Env for local verification: `node --env-file=/tmp/claude-1001/-home-tarik-Projects-printer/791f3589-8a6a-4f3d-9cbf-a6248c4ba897/scratchpad/qa.env` provides `QA_URL`/`QA_QUOTE_DB_URL`/`QA_MONEY_PG_URL` (Postgres 127.0.0.1:55433/printer_qa), `QA_REDIS_URL` (127.0.0.1:56380) and `MESH_PYTHON` (scratch venv with trimesh/pymeshlab/manifold3d/Pillow). Run tsx tests as `npx tsx --env-file=<that file> scripts/test-x.ts` when they need these. Never use the user's dev DB (localhost:5432) or dev Redis (6379) or port 3005.
- Gates per task: `npx tsc --noEmit -p .` must pass (it includes `scripts/**/*.ts`); your new tests must pass; `npm run -s test:unit` must stay green.
- Contract types live in `src/lib/config/quote-types.ts` (already written; import from it; extend only by adding, never renaming).

## File Map (ownership by task)

| Path | Task |
|---|---|
| `scripts/process_upload_model.py`, `docker/Dockerfile`, `scripts/requirements.txt`, `scripts/fixtures/quote/*`, `scripts/test-upload-geometry.py` | 0.1 |
| `src/lib/db/schema.ts` (end block), `drizzle/0064_*`, `drizzle/meta/0064_snapshot.json`, `drizzle/meta/_journal.json`, `scripts/test-quote-migration-db.ts` | 1.1 |
| `src/lib/config/quote-units.ts`, `quote-pricing.ts`, `quote-dfm.ts`, `quote-compute.ts`, `business-days.ts`, `quote-policy.ts`, `quote-number.ts`, `quote-keys.ts`, `quote-seed.ts`, `flags.ts` (FEATURE group), `scripts/test-quote-core.ts`, `scripts/test-ops-spine.ts` | 1.2 |
| `src/app/api/uploads/chunk/route.ts`, `src/lib/services/chunked-upload.ts`, `src/lib/services/quote-model-validation.ts`, `src/lib/upload-large-file.ts`, `scripts/test-quote-validation.ts` | 2.1 |
| `scripts/analyze_quote_part.py`, `src/lib/services/mesh-runner.ts` (`runAnalyzeQuotePart`), `scripts/test-analyze-quote-part.py` | 2.2 |
| `src/lib/queue/quote-queues.ts`, `src/lib/services/quote-analysis.ts`, `src/lib/queue/workers/quote-part-analysis.worker.ts`, `workers/start.ts`, `src/lib/services/storage.ts` (helpers), `src/lib/realtime/{events,emit}.ts`, `src/app/api/realtime/quote/[id]/route.ts`, `scripts/test-quote-analysis-db.ts` | 2.3 |
| `src/lib/services/quote-catalog.ts`, `quote-access.ts`, `quote-present.ts`, `quote-service.ts`, `quote-notify.ts`, `quote-chat.ts`, `src/app/api/quotes/**`, `src/app/api/customer/quotes/route.ts`, `src/app/api/customer/parts/route.ts`, `scripts/test-quote-api.ts`, `scripts/test-quote-service-db.ts` | 2.4 |
| `src/components/quote/price-gate-modal.tsx`, `src/lib/services/password-reset.ts`, `src/app/api/auth/{register,login}/route.ts`, `src/components/site-header.tsx`, `src/components/user-dropdown.tsx`, `src/lib/analytics/events.ts`, `src/lib/seo/policy.ts`, `src/app/robots.ts`, `src/app/sitemap.ts`, `scripts/test-sitemap.ts`, i18n `instantQuote.*` block | 3.1 |
| `src/app/teklif/[number]/**`, `src/components/quote/*` (except price-gate-modal), `src/components/model-viewer.tsx` (`dimensionsMm` prop), `scripts/test-quote-ui.ts` | 3.2 |
| `src/app/3d-baski/**`, `src/lib/seo/service.ts`, `src/app/account/teklifler/**`, `src/app/account/parcalar/**`, footer link | 3.3 |
| `src/lib/services/quote-checkout.ts`, `src/lib/validators/quote-checkout.ts`, `src/app/api/quotes/[id]/checkout/route.ts`, `src/components/quote/quote-checkout-form.tsx`, `src/app/teklif/[number]/odeme/**`, `scripts/test-quote-checkout-db.ts` | 4.1 |
| `src/lib/services/quote-order.ts`, `src/lib/services/order-confirm.ts`, `src/lib/services/order-model.ts` (tx extraction), `src/lib/config/order-model-policy.ts`, `src/lib/queue/workers/quote-order-files.worker.ts`, `src/app/api/admin/orders/[id]/approve/route.ts`, `scripts/test-quote-order-db.ts` | 4.2 |
| `src/lib/services/capability.ts`, `manufacturer-assignment.ts`, `manufacturer-assign.ts` (large-format override only), `scripts/test-capability.ts`, `scripts/test-scoring-v2.ts` additions | 4.3 |
| `src/app/manufacturer/orders/[id]/{page,client}.tsx`, `src/app/admin/orders/[id]/{page,client}.tsx`, `src/lib/config/order-money.ts`, `src/lib/services/order-money.ts`, QC cap files, `scripts/test-order-money.ts`, `scripts/test-qc.ts` additions | 4.4 |
| `src/app/admin/baski-katalogu/**`, `src/app/api/admin/print-catalog/**`, `src/app/admin/ayarlar/**`, `src/app/api/admin/flags/route.ts`, `scripts/test-quote-admin-catalog.ts` | 5.1 |
| `src/app/admin/teklifler/**`, `src/app/api/admin/quotes/**`, `src/lib/services/quote-admin.ts`, `src/app/admin/sidebar.tsx`, `src/app/admin/layout.tsx`, `scripts/test-quote-admin.ts` | 5.2 |
| `src/lib/services/quote-maintenance.ts`, `src/lib/queue/workers/quote-maintenance.worker.ts`, `scripts/test-quote-maintenance-db.ts` | 6.1 |
| `src/components/create/upload-model-flow.tsx`, `src/components/create/path-selector.tsx`, docs/memory | 7.1 |

---

## Phase 0 — Legacy geometry hotfix

### Task 0.1: Fix `process_upload_model.py` ImportError + guard

**Files:** Modify `scripts/process_upload_model.py`, `docker/Dockerfile`, `scripts/requirements.txt`. Create `scripts/fixtures/quote/cube20.stl` (binary, 20 mm cube), `scripts/fixtures/quote/cube20.obj`, `scripts/fixtures/quote/two_bodies.stl` (two disjoint 10 mm cubes), `scripts/fixtures/quote/open_box.stl` (cube missing one face), `scripts/fixtures/quote/cube1in.3mf` (1-unit cube, `<model unit="inch">`), `scripts/fixtures/make_quote_fixtures.py` (generator, committed), `scripts/test-upload-geometry.py`.

**Interfaces:** Produces the fixtures used by Tasks 2.1/2.2/2.3.

Requirements:
1. Replace the 4 dead imports: `keep_largest_component` → `merge_components(mesh, repairs)` (use returned tuple `(mesh, merged_count, dropped_significant)`); `validate_mesh` → `build_report(mesh)`; `estimate_min_wall_thickness_mm(mesh)` → `estimate_wall_percentiles(mesh)[0]`; delete the `repair_self_intersections` fallback (`repair_with_pymeshlab` never raises). Keep the CLI contract and report keys exactly as documented in `briefs/geometry.md` §1 (callers: `src/app/api/upload/model/route.ts`, `src/lib/services/product-spec.ts`). Use `abs(mesh.volume)`.
2. `scripts/requirements.txt`: add explicit `lxml>=5.0`, `networkx>=3.0`, `Pillow>=10.0`, keep existing pins.
3. `docker/Dockerfile`: in the worker/runtime stage that has `/opt/venv`, after `COPY scripts`, add `RUN /opt/venv/bin/python3 -c "import sys; sys.path.insert(0,'scripts'); import process_upload_model, process_mesh, render_turntable"` so an import break fails the image build.
4. `scripts/test-upload-geometry.py`: runs `process_upload_model.py` on `cube20.stl` with target heights `80` and `0`, asserts exit 0 and report keys `is_watertight, is_volume, volume_mm3, bounding_box_mm, min_wall_thickness_estimate_mm, print_risk`; for h=0 asserts `volume_mm3 ≈ 8000 ± 1` and bbox ≈ 20.

- [ ] Step 1: write fixture generator + fixtures; write `test-upload-geometry.py`.
- [ ] Step 2: run `$MESH_PYTHON scripts/test-upload-geometry.py` → FAIL (ImportError).
- [ ] Step 3: fix imports.
- [ ] Step 4: run again → PASS. Run `npx tsc --noEmit -p .` → PASS.
- [ ] Step 5: commit `fix(geometri): silinen yardimcilar yerine process_mesh karsiliklari` (files above only).

---

## Phase 1 — Data + pure core

### Task 1.1: Schema block + migration 0064 (+ seed) with reversible down

**Files:** Modify `src/lib/db/schema.ts` (append block at end), `drizzle/meta/_journal.json`. Create `drizzle/0064_instant_quotes.sql`, `drizzle/0064_instant_quotes.down.sql`, `drizzle/meta/0064_snapshot.json`, `scripts/test-quote-migration-db.ts`.

**Interfaces:**
- Consumes: `src/lib/config/quote-types.ts`; seed values from `src/lib/config/quote-seed.ts` (Task 1.2 writes it; for the SQL, copy the SAME values listed below).
- Produces (Drizzle exports, camelCase): `printTechnologies`, `printMaterials`, `printFinishes`, `printAddons`, `quotePricingSettings`, `printCatalogChanges`, `quotes`, `quoteParts`, `quoteCheckouts`, `quoteMessages`, `quoteAdminActions` + relations. Column names exactly as the spec's Veri modeli section (snake_case in SQL, camelCase in TS). jsonb columns typed with `$type<>` from quote-types (`PartGeometry`, `PricingSnapshot`, `SnapshotColor[]`, `MaterialProperties`, `QtyBreak[]`, `LeadTier[]`, `FrozenQuotePart[]`, `FrozenQuoteAddon[]`, `string[]`, `number[]`).
- `quotes.seq`: `integer("seq").generatedAlwaysAsIdentity()`; `quotes.number`: `text("number").generatedAlwaysAs(sql\`'T-' || lpad(seq::text, 6, '0')\`)` unique. `quotes.userId → users.id`, `quotes.orderId → orders.id` unique, `quotes.sourceQuoteId → quotes.id` (use `(): any =>`), `quoteCheckouts.draftId → orderDrafts.id` unique, `quoteParts.quoteId → quotes.id`, `printMaterials.technologyId → printTechnologies.id` (restrict), `printFinishes.technologyId` nullable.

Requirements:
1. Generate SQL with drizzle-kit into a SCRATCH dir (never overwrite repo files blindly): `npx drizzle-kit generate --name instant_quotes` produces `0063_instant_quotes.sql` + `meta/0063_snapshot.json` + a journal entry → rename to `0064_instant_quotes.sql`, `meta/0064_snapshot.json`, and set the journal entry exactly to the Global Constraints values (idx 64, when 1789657000000, tag `0064_instant_quotes`). Then hand-harden the SQL to house style (briefs/misc.md §8): header comment, `SET lock_timeout = '5s';`, `--> statement-breakpoint` separators, `CREATE TABLE IF NOT EXISTS`, constraints named and declared inside CREATE TABLE, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, CHECKs:
   - `print_technologies_key_chk` key `~ '^[a-z0-9_]{2,32}$'`; `order_material IN ('resin','filament')`.
   - `print_finishes_cost_line_kind_chk`, `print_addons_price_type_chk`, `quote_pricing_settings_singleton_chk (id = 1)`, `print_catalog_changes_entity_chk`, `print_catalog_changes_action_chk IN ('create','update')`.
   - `quotes_status_chk`, `quotes_review_kind_chk`, `quotes_lead_tier_chk`, `quotes_invoice_type_chk`, `quotes_tax_id_type_chk`.
   - `quote_parts_source_format_chk`, `quote_parts_analysis_status_chk`, `quote_parts_units_chk`, `quote_parts_quantity_chk (quantity BETWEEN 1 AND 100000)`, `quote_parts_scale_chk (scale > 0.0099 AND scale < 100.01)`.
   - `quote_messages_sender_chk`, `quote_admin_actions_action_chk`.
   - Indexes: `quotes_user_idx (user_id, created_at DESC)`, `quotes_anon_idx (anonymous_id)`, `quotes_status_idx (status, review_requested_at)`, `quote_parts_quote_idx (quote_id, sort_order)`, `quote_parts_sha_idx (source_sha256)`, `quote_messages_quote_idx (quote_id, created_at)`, `quote_checkouts_quote_idx (quote_id)`, unique `quote_parts_upload_id_uq`, `quotes_share_token_uq`, `quotes_order_id_uq`, `quote_checkouts_draft_id_uq`, `print_materials_tech_key_uq (technology_id, key)`.
2. Seed (same file, after tables) with `INSERT ... ON CONFLICT DO NOTHING` using FIXED uuids (so down/tests can target them): technologies `fdm` (`00000000-0000-4000-8000-000000000f01`) and `sla` (`...0f02`); materials/finishes/addons/settings as in the Seed table below.
3. Down file: one `DO $$ ... $$;` block: `SET LOCAL lock_timeout='5s'`; for each existing table (guard with `to_regclass`) `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE`; if `quotes` has any row OR `quote_checkouts` has any row → `RAISE EXCEPTION '0064 rollback refused: quotes exist'`; then `DROP TABLE IF EXISTS` in dependency order (quote_admin_actions, quote_messages, quote_checkouts, quote_parts, quotes, print_catalog_changes, quote_pricing_settings, print_addons, print_finishes, print_materials, print_technologies); finally `IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789657000000; END IF;`. Idempotent (safe no-op when already reverted).
4. `scripts/test-quote-migration-db.ts` (QA 55433 only, guard like `test-dispute-migration-db.ts`): disposable schema; create minimal predecessor tables `users(id uuid pk)`, `orders(id uuid pk)`, `order_drafts(id uuid pk)` in that schema; rewrite `public.`/`drizzle.__drizzle_migrations` to the schema; apply up twice (idempotent), assert 11 tables + seed counts (2 technologies, 7 materials, 5 finishes, 4 addons, 1 settings row); insert one `quotes` row → down must throw `/0064 rollback refused/` (inside SAVEPOINT); delete it; down twice; assert tables gone and only the fake journal row with `created_at=1789657000000` deleted (rows at when±1 survive); up again succeeds. Always `DROP SCHEMA ... CASCADE` in finally.

**Seed table** (kuruş; all `active=true`; `sort_order` = row order):

| technology | key fdm | key sla |
|---|---|---|
| name | FDM (Filament) | SLA (Reçine) |
| description | Eriyik yığma; dayanıklı prototip ve fonksiyonel parçalar | Reçine; yüksek detay ve pürüzsüz yüzey |
| order_material / capability_tag | filament / material_filament | resin / material_resin |
| build x,y,z | 250,210,210 | 218,122,220 |
| min_wall / min_feature | 0.8 / 0.4 | 0.6 / 0.3 |
| tolerance_text | ±%0,5 (en az ±0,5 mm) | ±%0,2 (en az ±0,15 mm) |
| layer_options / default | [100,200,300] / 200 | [50,100] / 50 |
| infill_options / default | [15,20,30,50,100] / 20 | null / null |
| shell_mm | 1.2 | 0 |
| setup_fee | 2500 | 3500 |
| machine_rate | 6000 | 4000 |
| throughput_cm3_per_hour | 12 | 40 |
| height_hours_per_mm | 0.002 | 0.03 |
| min_unit_price | 4900 | 7900 |
| base_lead_days | 3 | 4 |

Materials (technology, key, name, density, price/g, support_factor, capability_tag, lead_extra, colors[key:name:hex:surcharge]):
- fdm `pla` PLA 1.24 150 1.10 null 0 — beyaz:Beyaz:#F5F5F5:0, siyah:Siyah:#1A1A1A:0, gri:Gri:#8A8D91:0, kirmizi:Kırmızı:#C62828:0, mavi:Mavi:#1565C0:0, yesil:Yeşil:#2E7D32:0, sari:Sarı:#F9A825:0
- fdm `petg` PETG 1.27 170 1.10 `pmat_petg` 0 — siyah, beyaz, seffaf:Şeffaf:#DDEEEE:500
- fdm `abs` ABS 1.04 170 1.10 `pmat_abs` 0 — siyah, beyaz
- fdm `tpu95a` TPU 95A (esnek) 1.21 280 1.10 `pmat_tpu` 1 — siyah, beyaz
- sla `standard_resin` Standart reçine 1.15 300 1.15 null 0 — gri:Gri:#9E9E9E:0, beyaz:Beyaz:#FAFAFA:0, siyah:Siyah:#212121:0, seffaf:Şeffaf:#E3F2FD:1000
- sla `tough_resin` Dayanıklı reçine (ABS benzeri) 1.18 450 1.15 `pmat_tough_resin` 1 — gri
- sla `flex_resin` Esnek reçine 1.10 550 1.15 `pmat_flex_resin` 1 — siyah
(properties jsonb per material with sensible `uses` in Turkish, e.g. PLA `{"tensileMpa":50,"heatDeflectionC":55,"uses":["prototip","maket","dekor"]}`.)

Finishes (technology_key null for all; key, name, fixed, per_cm2, lead_extra, requires_manual, cost_line_kind): `ham` "Standart (destekler alınmış)" 0 0 0 false production; `zimpara` "Zımparalı" 1500 20 1 false production; `astar` "Astarlı (boyaya hazır)" 2500 35 2 false production; `boyali` "Boyalı (RAL)" 0 0 3 true painting; `ozel` "Özel ardıl işlem" 0 0 2 true production.

Addons (key, name, price_type, price, lead_extra): `uygunluk_sertifikasi` "Uygunluk sertifikası" fixed 35000 0; `olcum_raporu` "Standart ölçüm raporu" fixed 125000 1; `malzeme_veri_sayfasi` "Malzeme veri sayfası" fixed 15000 0; `rohs_beyani` "RoHS uygunluk beyanı" fixed 25000 1.

Settings row id=1: `qty_breaks` `[{"minQty":1,"discountBps":0},{"minQty":5,"discountBps":500},{"minQty":10,"discountBps":1000},{"minQty":25,"discountBps":1500},{"minQty":50,"discountBps":2000},{"minQty":100,"discountBps":2500},{"minQty":500,"discountBps":3000}]`; `lead_tiers` `[{"key":"economy","name":"Ekonomik","multiplierBps":9000,"daysDelta":3,"minDays":5},{"key":"standard","name":"Standart","multiplierBps":10000,"daysDelta":0,"minDays":3},{"key":"express","name":"Ekspres","multiplierBps":14000,"daysDelta":-2,"minDays":2}]`; `min_order_kurus` 20000; `max_auto_total_kurus` 10000000; `max_auto_qty_per_part` 1000; `max_parts_per_quote` 20; `max_file_bytes` 33554432 (32 MiB — düzeltme dalgası D / OD-2: worker konteyneri 2 GB'ta kaldığı için reklam edilen tavan ölçülen zarfa indirildi); `quote_valid_days` 30; `retention_days_after_expiry` 90; `price_break_quantities` `[1,5,10,25,50,100]`; `holidays` `["2026-01-01","2026-03-20","2026-03-21","2026-03-22","2026-04-23","2026-05-01","2026-05-19","2026-05-27","2026-05-28","2026-05-29","2026-05-30","2026-07-15","2026-08-30","2026-10-29","2027-01-01","2027-03-09","2027-03-10","2027-03-11","2027-04-23","2027-05-01","2027-05-16","2027-05-17","2027-05-18","2027-05-19","2027-07-15","2027-08-30","2027-10-29"]`; `cutoff_hour` 14; `havale_discount_applies` true.

- [ ] Step 1: write the schema block; `npx tsc --noEmit -p .` PASS.
- [ ] Step 2: generate into scratch, rename, harden, write down + journal + snapshot.
- [ ] Step 3: write `test-quote-migration-db.ts`; run with `npx tsx --env-file=<qa.env> scripts/test-quote-migration-db.ts` → PASS.
- [ ] Step 4: add `"test:quote-migration:db": "tsx scripts/test-quote-migration-db.ts"` to package.json (NOT to test:unit).
- [ ] Step 5: commit `feat(teklif): 0064 teklif ve katalog tablolari, geri alinabilir`.

### Task 1.2: Pure core — units, pricing, DfM, compute, business days, policy, keys, seed, flag group

**Files:** Create `src/lib/config/quote-units.ts`, `quote-pricing.ts`, `quote-dfm.ts`, `quote-compute.ts`, `business-days.ts`, `quote-policy.ts`, `quote-number.ts`, `quote-keys.ts`, `quote-seed.ts`, `scripts/test-quote-core.ts`. Modify `src/lib/config/flags.ts`, `scripts/test-ops-spine.ts`, `package.json` (script + test:unit).

**Interfaces (Produces — exact):**
```ts
// quote-units.ts
export function unitFactor(units: QuoteUnits): number;             // mm 1, cm 10, in 25.4
export function scaledGeometry(g: PartGeometry, units: QuoteUnits, scale: number): ScaledGeometry;
export function suggestUnits(g: PartGeometry, maxBuild: Vec3): QuoteUnits | null;
// quote-keys.ts   (deterministic strings, no crypto)
export function partPricingKey(p: { sourceSha256: string | null; config: PartConfig }, leadTier: LeadTierKey): string;
export function dfmWarningKey(codes: DfmCode[], p: { sourceSha256: string | null; config: PartConfig }): string;
// quote-pricing.ts
export function findTechnology(s: PricingSnapshot, key: string): SnapshotTechnology | null;
export function findMaterial(s: PricingSnapshot, techKey: string, key: string): SnapshotMaterial | null;
export function findFinish(s: PricingSnapshot, techKey: string, key: string): SnapshotFinish | null;
export function qtyDiscountBps(breaks: QtyBreak[], qty: number): number;
export function leadTier(s: PricingSnapshot, key: LeadTierKey): LeadTier;
export function priceUnitAuto(args: { snapshot: PricingSnapshot; scaled: ScaledGeometry; config: PartConfig; tier: LeadTier; quantity: number }): { unitKurus: number; breakdown: PartPriceBreakdown };
export function partLeadDaysBase(s: PricingSnapshot, config: PartConfig): number;
export function applyTierDays(base: number, tier: LeadTier): number;
export function addonLines(s: PricingSnapshot, addonKeys: string[], partCount: number, unitCount: number): AddonLine[];
// quote-dfm.ts
export function evaluatePartDfm(part: PricingPartInput, snapshot: PricingSnapshot): PartDfmResult;
// quote-compute.ts  (THE entry point used by services/presenter/checkout)
export function computeQuote(snapshot: PricingSnapshot, parts: PricingPartInput[], q: QuoteLevelInput): ComputedQuote;
export function defaultPartConfig(snapshot: PricingSnapshot, g: PartGeometry | null): PartConfig;
// business-days.ts
export function istanbulDateKey(d: Date): string; // YYYY-MM-DD in Europe/Istanbul
export function addBusinessDays(start: Date, days: number, holidays: string[], cutoffHour: number): Date;
// quote-policy.ts
export function quotePermissions(q: { status: QuoteStatus; expiresAt: Date; orderId: string | null }, ctx: { hasLiveDraft: boolean; now: Date }): { canEdit: boolean; canCheckout: boolean; canRequestReview: boolean; blockedReason: string | null };
export function checkoutBlockers(c: ComputedQuote, parts: PricingPartInput[], q: { termsAccepted: boolean; expired: boolean }): string[]; // Turkish sentences; [] = ready
// quote-number.ts
export function formatQuoteNumber(seq: number): string;  // "T-000123"
export function parseQuoteNumber(s: string): number | null;
// quote-seed.ts
export const SEED_SNAPSHOT: PricingSnapshot; // exactly the Task 1.1 seed (takenAt "2026-09-22T00:00:00.000Z"), used by tests & docs
// flags.ts
// add "instant_quote_enabled" to FLAG_KEYS (default false, label "Anlık teklif motoru") and a new exported FEATURE_FLAG_KEYS group
```

Pricing algorithm (normative; spec §quote-pricing): `s=unitFactor×scale`; `V=volumeCm3`; `A=areaCm2`; if `tech.infillOptionsPct` → `shell=min(V, A×shellMm/10)`, `eff=shell+(V−shell)×infill/100` else `eff=V`; `grams=eff×density×supportFactor`; `material=grams×pricePerGram`; `z=sortedMm[0]`; `layerK=defaultLayerUm/layerUm`; `hours=(eff/throughput + z×heightHoursPerMm)×layerK`; `machine=hours×rate`; `finish=fixed + A×perCm2`; `color=surcharge`; `unitBase=max(material+machine+finish+color, minUnitPrice)`; `unitDisc=unitBase×(10000−bps)/10000`; `U=ceil(((setup + unitDisc×q)/q)×tier.multiplierBps/10000 − 1e-9)`; `line=U×q`. Manual price valid when `manualUnitPriceKurus!=null && manualPriceKey===partPricingKey(part, tier)` → `U=manual`, source `manual`, breakdown null. Totals: `parts=Σline`; addons (fixed: price; per_part: price×partCount; per_unit: price×unitCount); `topUp=max(0,minOrder−(parts+addons))` only when `allPriced`; `total=parts+addons+topUp`; `kdvExcluded=computeKdv(total,2000).subtotalKurus` — import `computeKdv` from `@/lib/services/finance` (verified: pure, no imports) and `KDV_RATE_BPS` from `@/lib/config/prices` (verify it has no server-only import; if it does, use the literal 2000 with a comment). Lead days: part base = `tech.baseLeadDays + material.leadDaysExtra + finish.leadDaysExtra`; quote base = max over parts + max addon leadDaysExtra; `applyTierDays(base,tier)=max(tier.minDays, base+tier.daysDelta)`. `leadOptions` = every tier with its `leadDays` and `totalKurus` (recomputed with that tier's multiplier; manual prices only valid for their tier so other tiers show `null` total when any part is manual).

DfM rules (normative): see spec table. `analysis_pending` (severity error, but callers treat as "not ready" not "manual") when status queued/analyzing; `too_large` when any `sortedMm[i] > sortedBuild[i]` with params `{maxX,maxY,maxZ, fitsTechnology?: key, fitScale?: number(2 decimals, largest scale that fits)}`; `too_small` when `sortedMm[2] < 2`; `thin_walls` when `wallP1Mm != null && wallP1Mm < tech.minWallMm` params `{wallMm (1 decimal), minMm}`; `multiple_bodies` when `bodyCount>1` params `{count}`; `not_watertight` when `!isVolume && volumeEstimated`; `no_volume` when `volume==null`; `qty_over_auto` when `quantity > maxAutoQtyPerPart`; `finish_manual` when finish.requiresManual; `tolerance_manual` when criticalTolerance; `config_invalid` when tech/material/color/finish missing in snapshot, finish technologyKey mismatch, layer not in options, infill not in options (or non-null for SLA). Quote-level `total_over_auto` is represented in `ComputedQuote.quoteIssues` with code `qty_over_auto` params `{reason:"total"}`. `blocking` = any error except when a valid manual price exists (then only `analysis_pending/analysis_failed/config_invalid` still block). `warningKey = dfmWarningKey(warningCodes, part)` or null.

Policy: `quotePermissions`: `ordered|cancelled` → nothing; `expired` or `now>expiresAt` → no edit/checkout, canRequestReview false, blockedReason "Teklifin süresi doldu — yeniden fiyatlayın."; `hasLiveDraft` → canEdit false, canCheckout true (returns existing ref), blockedReason "Bu teklif için bekleyen bir ödeme var."; `needs_review` → canEdit true (editing cancels nothing, stays in review), canCheckout false. `checkoutBlockers` sentences (Turkish): analysis pending, any blocking part ("N parça manuel fiyat bekliyor"), unacknowledged warnings, `!termsAccepted`, expired, `!allPriced`, zero parts.

`scripts/test-quote-core.ts` (hand-rolled `test(name, fn)` + `node:assert/strict`, prints `ok`, exits 1 on failure) MUST include these exact golden assertions against `SEED_SNAPSHOT`:
- G1 (20 mm PLA cube, geometry `{volume:8000, area:2400, extents:{20,20,20}, bodyCount:1, isWatertight:true, isVolume:true, volumeEstimated:false, faceCount:12, wallP1:20, wallP5:20, overhangArea:400, sourceUnits:null, objectCount:1}`, units mm, scale 1, fdm/pla/beyaz/ham, layer 200, infill 20, qty 1, standard): `unitKurus === 7400`, `lineKurus === 7400`, breakdown.effectiveVolumeCm3 ≈ 3.904, grams ≈ 5.325; totals: `partsKurus 7400`, `minOrderTopUpKurus 12600`, `totalKurus 20000`, `kdvExcludedKurus === Math.round(20000/1.2) === 16667`; leadDays standard 3, express 2, economy 6.
- G2 (same, qty 10): `unitKurus 4660`, `lineKurus 46600`, topUp 0, total 46600.
- G3 (same, qty 10, express): `unitKurus === Math.ceil(4660*14000/10000) === 6524`.
- G4 (units "cm", scale 1 on a 2-unit cube `{volume:8, area:24, extents 2,2,2}`) prices identical to G1.
- G5 (inch units on `cube1in` geometry `{volume:1, area:6, extents 1,1,1}`): scaledGeometry volumeMm3 ≈ 16387.064, extents 25.4.
- G6 manual: manualUnitPriceKurus 9999 with matching `partPricingKey` → unit 9999 source manual; after changing quantity → key mismatch → auto price again.
- DfM: 300 mm cube FDM → `too_large` error with `fitsTechnology` absent and `fitScale` 0.7 (floor to 2 decimals of min(sortedBuild/sortedMm)); 1 mm cube → `too_small`; wallP1 0.5 FDM → `thin_walls` warning & warningKey non-null; bodyCount 2 → `multiple_bodies`; finish `boyali` → `finish_manual` blocking; SLA with infill 20 → `config_invalid`; qty 1001 → `qty_over_auto`.
- `U×q===line` property for q in 1..120 and every tier (loop).
- business days: `addBusinessDays(new Date("2026-10-27T08:00:00Z") /*11:00 IST Tue*/, 3, holidays, 14)` skips 2026-10-29 → returns date key `2026-11-02`; same date at 13:00Z (16:00 IST, after cutoff) → `2026-11-03`; start Saturday 2026-10-31 10:00 IST, 1 day → `2026-11-03` (Mon counts as day 0 when start is a non-business day, +1 → Tue).
- `formatQuoteNumber(123)==="T-000123"`, `parseQuoteNumber("T-000123")===123`, `parseQuoteNumber("x")===null`.
- policy cases: expired, live draft, ordered, needs_review.
- `test-ops-spine.ts`: update to require every flag key in exactly one of `AI_SPEND_FLAG_KEYS`, `AUTO_ASSIGN_FLAG_KEYS`, `FEATURE_FLAG_KEYS`; `instant_quote_enabled` default false.

- [ ] Step 1: write `test-quote-core.ts` with the goldens above; run `npx tsx scripts/test-quote-core.ts` → FAIL (modules missing).
- [ ] Step 2: implement modules.
- [ ] Step 3: run → PASS; `npx tsx scripts/test-ops-spine.ts` PASS; add `"test:quote-core"` + append `&& npx tsx scripts/test-quote-core.ts` to `test:unit`; `npm run -s test:unit` PASS; tsc PASS.
- [ ] Step 4: commit `feat(teklif): saf fiyat, DfM, birim ve is gunu cekirdegi`.

---

## Phase 2 — Upload, analysis, services, API

### Task 2.1: Anonymous chunk staging + 3MF-aware quote validation

**Files:** Modify `src/app/api/uploads/chunk/route.ts`, `src/lib/services/chunked-upload.ts`, `src/lib/upload-large-file.ts`. Create `src/lib/services/quote-model-validation.ts`, `scripts/test-quote-validation.ts`.

**Interfaces (Produces):**
```ts
// chunked-upload.ts (additions)
export async function readStagedRange(uploadId: string, offset: number, length: number): Promise<Buffer>;
export async function setStagedUploadMeta(uploadId: string, meta: { owner: string; expectedSize: number | null }): Promise<void>; // Redis key `upload-meta-<id>` JSON, TTL 24h
export async function getStagedUploadMeta(uploadId: string): Promise<{ owner: string; expectedSize: number | null } | null>;
export function uploadOwnerKey(v: { userId?: string | null; anonymousId?: string | null; role?: string }): string; // "u:<id>" | "a:<id>" | "<role>:<id>"
// quote-model-validation.ts
export async function validateStagedQuoteModel(uploadId: string, fileName: string, maxBytes: number): Promise<{ ok: true; format: QuoteSourceFormat; size: number; sha256: string } | { ok: false; error: string /* Turkish */ ; code: string }>;
export function inspect3mfCentralDirectory(tail: Buffer, readRange: (off: number, len: number) => Promise<Buffer>, size: number): Promise<{ ok: true; entries: number; unit: QuoteUnits | null } | { ok: false; code: string }>;
// upload-large-file.ts
// uploadLargeFile(file, { onProgress, signal, expectedSize?: boolean }) — when true, PUT body is JSON {size: file.size}
```
Requirements:
1. `/api/uploads/chunk`: keep existing authenticated behaviour byte-for-byte for admin/manufacturer/painter/customer sessions. Additionally allow an anonymous visitor: in `PUT` call `getOrCreateAnonymousId()` (route handler, so cookie set is OK); rate-limit `rateLimitAsync(\`chunk:put:ip:${ip}\`, 60, 3600_000)` and `chunk:put:anon:<id>` 40/h; daily byte quota per anon 2 GB (`chunk:bytes:anon:<id>:<YYYYMMDD>` via Redis INCRBY; in-memory fallback acceptable if the rate-limit helper exposes one — otherwise skip quota when Redis unavailable and log). In `POST`/`GET` for anon, require the anon cookie to match the stored owner. Record owner + optional expected size in `PUT` (`setStagedUploadMeta`). `POST` rejects when `offset+len > expectedSize` (413 Turkish error). IP via `extractClientIp`.
2. `validateStagedQuoteModel`: size ≤ maxBytes and == expected (if meta has it); by extension+magic: STL/OBJ reuse `validateStagedModel` logic from `model-file-validation.ts` (import, don't copy); 3MF: head `PK\x03\x04`; tail up to 65,557 bytes → EOCD `0x06054b50`; reject ZIP64 markers; read central dir ≤ 1 MB via `readStagedRange`; ≤ 10,000 entries; require `[Content_Types].xml` and ≥1 entry matching `/^3D\/.*\.model$/i`; reject encrypted (flag bit 0) and methods ∉ {0,8}; Σ uncompressed ≤ 1.5 GB and per-entry ratio ≤ 1000. sha256 computed by streaming the staged file.
3. Tests `scripts/test-quote-validation.ts` (unit; builds buffers in memory with `fflate` zipSync, writes to a temp staging dir by setting `UPLOAD_DIR` to a mkdtemp before importing): valid STL/OBJ/3MF fixtures from Task 0.1 pass with right format; 3MF without model entry → `3mf_no_model`; encrypted flag → `3mf_encrypted`; ZIP64 → `3mf_zip64`; method 12 → `3mf_method`; bomb (ratio > 1000) → `3mf_bomb`; oversize → `too_large`; `.stl` extension with random bytes → invalid. `uploadOwnerKey` cases.
- [ ] Steps: failing test → implement → pass → add `test:quote-validation` to package.json + test:unit → tsc → commit `feat(teklif): misafir parcali yukleme ve 3MF dogrulama`.

### Task 2.2: `analyze_quote_part.py` + `runAnalyzeQuotePart`

**Files:** Create `scripts/analyze_quote_part.py`, `scripts/test-analyze-quote-part.py`. Modify `src/lib/services/mesh-runner.ts`.

**Interfaces:**
- CLI: `analyze_quote_part.py <input> <format stl|obj|3mf> <outdir> [--thumb-size 512] [--max-faces-walls 2500000]` writes `<outdir>/report.json`, `thumb.png`, `preview.glb`, `canonical.stl`; exit 0 on success; on failure exit 2 and write `report.json` `{"ok":false,"error":"<code>","message":"..."}` when possible.
- `report.json` success shape: `{"ok":true,"geometry":<PartGeometry JSON exactly as quote-types, keys camelCase>, "timings":{...}}`.
- TS: `export async function runAnalyzeQuotePart(args: { inputPath: string; format: QuoteSourceFormat; outDir: string; timeoutMs?: number; onLog?: (l: string) => void }): Promise<{ geometry: PartGeometry }>` — throws `MeshProcessError` (existing class) with code `exit_nonzero|timeout|bad_report|python_missing`; validates the report shape (all PartGeometry keys, numbers finite).

Requirements: measure the FULL-resolution mesh at scale 1 in file units; do not merge/drop bodies (`bodyCount` = `len(mesh.split(only_watertight=False))`, capped computation for >2.5M faces: use `trimesh.graph.connected_components` count); volume: if watertight `abs(mesh.volume)`, else run `repair_with_pymeshlab` on a COPY and use its volume if it becomes a volume (`volumeEstimated=true`), else `volume=null`; `area=mesh.area`; `extents=mesh.extents`; `wallP1/P5` from `estimate_wall_percentiles` on the (repaired) copy unless faces > max-faces-walls (then null); `overhangArea` = Σ area of faces with normal z < −0.707 excluding faces within 0.01×extent.z of the minimum z; `sourceUnits` for 3MF read from the first `3D/*.model` XML `unit` attribute (micron→ treat as mm with note? map: millimeter→mm, centimeter→cm, inch→in, else null); `objectCount` for 3MF = number of `<object>` with mesh; 3MF load via `trimesh.load(path, force="scene")` then concatenate geometry with transforms (reuse `load_mesh`). OBJ: rotate Y-up→Z-up (`Rx(+90°)`) for measurement consistency. Thumbnail: `simplify` to 12k faces → center → scale `1/max(extents)` → `rot = Rx(+30°) @ Rz(45°)` → `render_frame(tris@rot.T, normals@rot.T, size)` → save PNG with Pillow (RGB). Preview GLB: decimate to ≤200k faces (`decimate_if_needed`-style, but target 200k), rotate Z-up→Y-up, export `.glb`. canonical.stl: ORIGINAL (unrepaired, undecimated) geometry, binary STL, file units. Set `resource.setrlimit(RLIMIT_AS, 3 GB)` at start (ignore failure).

`scripts/test-analyze-quote-part.py` (run with `$MESH_PYTHON`): cube20.stl → volume≈8000, area≈2400, extents 20, bodyCount 1, isWatertight true, thumb.png is a 512×512 PNG with non-background pixels, preview.glb loads with trimesh, canonical.stl loads with same volume; cube20.obj → same metrics; two_bodies.stl → bodyCount 2; open_box.stl → isWatertight false and (volume null or volumeEstimated true); cube1in.3mf → sourceUnits "in", extents ≈1.
- [ ] Steps: failing python test → implement → pass → extend mesh-runner + tsc → commit `feat(teklif): parca analizi, izometrik gorsel ve kanonik STL`.

### Task 2.3: Queue, analysis worker, storage helpers, realtime

**Files:** Create `src/lib/queue/quote-queues.ts`, `src/lib/services/quote-analysis.ts`, `src/lib/queue/workers/quote-part-analysis.worker.ts`, `src/app/api/realtime/quote/[id]/route.ts`, `scripts/test-quote-analysis-db.ts`. Modify `workers/start.ts`, `src/lib/services/storage.ts`, `src/lib/realtime/events.ts`, `src/lib/realtime/emit.ts`.

**Interfaces (Produces):**
```ts
// quote-queues.ts  (own Queue instances; do NOT touch queues.ts)
export const QUOTE_ANALYSIS_QUEUE = "quote-part-analysis";
export const QUOTE_ORDER_FILES_QUEUE = "quote-order-files";
export const QUOTE_MAINTENANCE_QUEUE = "quote-maintenance";
export interface QuotePartAnalysisJob { partId: string }
export interface QuoteOrderFilesJob { orderId: string; quoteId: string }
export function getQuoteAnalysisQueue(): Queue<QuotePartAnalysisJob>;
export function getQuoteOrderFilesQueue(): Queue<QuoteOrderFilesJob>;
export function getQuoteMaintenanceQueue(): Queue;
export async function enqueuePartAnalysis(partId: string, attempt: number, priority?: number): Promise<void>; // jobId `quote-part-analysis-<partId>-r<attempt>`
export async function enqueueQuoteOrderFiles(orderId: string, quoteId: string): Promise<void>; // jobId `quote-order-files-<orderId>`
// storage.ts additions
export async function saveFileFromPath(srcPath: string, subdir: string, filename: string): Promise<string>;
export async function linkOrCopyStoredFile(srcKey: string, subdir: string, filename: string): Promise<string>; // fs.link, fallback copyFile
// quote-analysis.ts
export async function analyzeQuotePart(partId: string): Promise<"ready" | "failed" | "skipped">;
export async function requeueStuckQuoteParts(olderThanMs: number): Promise<number>;
// events/emit
// topics.quote = (id) => `quote:${id}`; event { kind: "quote_part"; quoteId: string; partId: string; status: AnalysisStatus }
export function emitQuotePartChanged(args: { quoteId: string; partId: string; status: AnalysisStatus; userId?: string | null }): void;
export function emitQuoteChanged(args: { quoteId: string; userId?: string | null }): void; // kind "quote"
```
Requirements:
1. `analyzeQuotePart`: conditional `UPDATE quote_parts SET analysis_status='analyzing', analysis_attempt=analysis_attempt+1 WHERE id=$1 AND analysis_status IN ('queued') AND deleted_at IS NULL RETURNING …` (0 rows → "skipped"); copy source to a mkdtemp; `runAnalyzeQuotePart`; save outputs under `quote-parts/<partId>/` as `canonical-<nanoid8>.stl` (`saveFileFromPath`), `preview-<nanoid8>.glb`, `thumb-<nanoid8>.webp` (sharp from PNG, quality 82); then conditional `UPDATE … SET analysis_status='ready', geometry, keys, units = COALESCE(suggested) only if the part's units are still the default 'mm' and geometry.sourceUnits != null, updated_at WHERE id AND analysis_status='analyzing' AND deleted_at IS NULL`; bump `quotes.version` and recompute `quotes.total_kurus/lead_days` via a callback exported by quote-service? → NO circular import: implement `recomputeQuoteCache(tx, quoteId)` in `quote-analysis.ts`? It belongs to the service layer — put `recomputeQuoteCache(quoteId)` in a new small module `src/lib/services/quote-cache.ts` (no server-only) that loads quote+parts, runs `computeQuote`, and writes `total_kurus`, `lead_days`, `version=version+1`; Task 2.4 imports the same function. On failure: status `failed`, `analysis_error` = MeshProcessError code; emit event; `rm -rf` temp in finally.
2. Worker: `concurrency 1`, `lockDuration 300_000`, `attempts 2`, backoff exponential 10s, `removeOnComplete {count:500}`, `removeOnFail {count:500}`; registered in `workers/start.ts` with shutdown close, banner line, and `upsertJobScheduler("quote-analysis-recovery", {every: 300_000}, {name:"recover"})` that calls `requeueStuckQuoteParts(10*60_000)` (re-enqueue `queued` parts older than 10 min and `analyzing` parts older than 20 min back to `queued`).
3. Realtime route: GET `/api/realtime/quote/[id]` — allow when session user owns the quote, or anon cookie matches and quote.userId null; else 404; `sseResponse(req, [topics.quote(id)])`.
4. `scripts/test-quote-analysis-db.ts` (QA DB schema via drizzle-scratch like `test-gift-card-usage-db.ts`; `UPLOAD_DIR` mkdtemp; `MESH_PYTHON` from env): insert quote+part pointing at a copied `cube20.stl`; `analyzeQuotePart` → ready, geometry volume≈8000, three keys exist on disk; second call → "skipped"; a soft-deleted part stays untouched; a failing input (garbage bytes) → failed with code; `requeueStuckQuoteParts` moves an old `analyzing` part back to queued.
- [ ] Steps: failing DB test → implement → pass → tsc → add `test:quote-analysis:db` script → commit `feat(teklif): analiz kuyrugu, worker ve canli durum`.

### Task 2.4: Catalog snapshot, access, presenter, quote service, notify/chat, all customer quote APIs

**Files:** Create `src/lib/services/quote-catalog.ts`, `quote-cache.ts` (if not created by 2.3 — coordinate: 2.3 creates it), `quote-access.ts`, `quote-present.ts`, `quote-service.ts`, `quote-notify.ts`, `quote-chat.ts`, routes under `src/app/api/quotes/**`, `src/app/api/customer/quotes/route.ts`, `src/app/api/customer/parts/route.ts`, tests `scripts/test-quote-api.ts`, `scripts/test-quote-service-db.ts`.

**Interfaces (Produces):**
```ts
// quote-catalog.ts (no server-only)
export async function loadActiveSnapshot(): Promise<PricingSnapshot>;             // active rows + settings, sorted by sort_order
export async function catalogUpdatedAt(): Promise<Date>;                        // max(updated_at) over catalog tables + settings
// quote-access.ts
export type QuoteAccess = { quote: QuoteRow; viewer: QuoteViewer; sessionUserId: string | null };
export async function resolveQuoteAccess(idOrNumber: string, opts: { shareToken?: string | null; forEdit?: boolean }): Promise<QuoteAccess | null>; // null → 404
// quote-present.ts (pure; signer injected)
export function presentQuote(input: { quote: QuoteRow; parts: QuotePartRow[]; snapshot: PricingSnapshot; computed: ComputedQuote; viewer: QuoteViewer; liveDraftReference: string | null; orderNumber: string | null; catalogChanged: boolean; now: Date; sign: (key: string) => string; shareBaseUrl: string }): PresentedQuote;
export async function loadPresentedQuote(access: QuoteAccess): Promise<PresentedQuote>; // service-side convenience (in quote-service.ts to keep present pure)
// quote-service.ts
export async function createQuote(args: { userId: string | null; anonymousId: string | null; termsAccepted: true }): Promise<{ id: string; number: string }>;
export async function addPartFromUpload(access: QuoteAccess, args: { uploadId: string; fileName: string }): Promise<{ partId: string }>;
export async function updatePart(access: QuoteAccess, partId: string, patch: PartPatch): Promise<void>;
export async function bulkUpdateParts(access: QuoteAccess, partIds: string[], patch: PartPatch | { delete: true }): Promise<void>;
export async function deletePart(access: QuoteAccess, partId: string): Promise<void>;
export async function duplicatePart(access: QuoteAccess, partId: string): Promise<{ partId: string }>;
export async function setDrawing(access: QuoteAccess, partId: string, file: File | null): Promise<void>; // PDF only (%PDF magic), ≤20 MB
export async function updateQuote(access: QuoteAccess, patch: QuotePatch): Promise<void>;
export async function claimQuote(quoteId: string, userId: string, anonymousId: string): Promise<boolean>;
export async function repriceQuote(access: QuoteAccess): Promise<void>;       // new snapshot, expires=now+valid, drop manual prices, status draft
export async function requestReview(access: QuoteAccess, args: { kind: ReviewKind; note: string; targets?: Array<{ partId: string; unitKurus: number }> }): Promise<void>;
export async function splitByTechnology(access: QuoteAccess): Promise<{ newQuoteNumbers: string[] }>;
export async function setShareToken(access: QuoteAccess, action: "create" | "rotate" | "revoke"): Promise<string | null>;
export async function requote(access: QuoteAccess): Promise<{ number: string }>;
export async function importParts(access: QuoteAccess, sourcePartIds: string[], userId: string): Promise<number>;
export async function listCustomerQuotes(userId: string, page: number): Promise<{ items: CustomerQuoteListItem[]; hasNext: boolean }>;
export async function listCustomerParts(userId: string, page: number): Promise<{ items: LibraryPart[]; hasNext: boolean }>;
export async function liveDraftForQuote(quoteId: string): Promise<{ draftId: string; reference: string } | null>; // quote_checkouts ⋈ order_drafts status IN ('pending','awaiting_review')
// PartPatch = Partial<{ name; technologyKey; materialKey; colorKey; finishKey; layerUm; infillPct; quantity; units; scale; criticalTolerance; note; dfmAckKey; targetUnitPriceKurus }>
// QuotePatch = Partial<{ title; leadTier; addonKeys; customerNote; poNumber; invoiceType; companyName; taxId; taxOffice; billingAddress; expectedVersion }>
// quote-notify.ts (no server-only; sendRawEmail + notifyCustomer; all best-effort .catch)
export async function notifyReviewRequested(quoteId: string): Promise<void>;        // customer ack + admin email (ADMIN_EMAIL) + publishRealtime admin badge
export async function notifyManualQuoteReady(quoteId: string): Promise<void>;
export async function notifyTargetDecision(quoteId: string, decision: "accept" | "counter" | "reject"): Promise<void>;
export async function notifyQuoteExpiring(quoteId: string): Promise<void>;
export async function notifyQuoteAbandoned(quoteId: string): Promise<void>;
export async function notifyQuoteMessage(quoteId: string, from: "customer" | "admin"): Promise<void>;
// quote-chat.ts
export async function listQuoteMessages(quoteId: string, viewer: "customer" | "admin"): Promise<{ messages: SerializedMessage[]; unreadCount: number }>;
export async function createQuoteMessage(args: { quoteId: string; sender: "customer" | "admin"; senderUserId?: string | null; senderEmail?: string | null; body: string; file?: File | null }): Promise<void>;
export async function markQuoteMessagesRead(quoteId: string, viewer: "customer" | "admin"): Promise<void>;
```
Routes (all `handleRouteFailure`; JSON; Turkish errors; `export const dynamic = "force-dynamic"` where needed):
- `POST /api/quotes` body `{turnstileToken, termsAccepted: true}` → Turnstile verify + `quote:create:ip` 20/h + `quote:create:anon` 10/h → `createQuote` (anon id from `getOrCreateAnonymousId()` when no session) → `{id, number}`.
- `GET /api/quotes/[id]?t=` → presented quote (404 when no access).
- `PATCH /api/quotes/[id]` → `updateQuote` (409 `{code:"version_conflict"}` on stale `expectedVersion`) → presented.
- `POST /api/quotes/[id]/parts` `{uploadId, fileName}` → 20-part cap counted under `SELECT … FOR UPDATE` on quotes; validate (`validateStagedQuoteModel`), promote to `quote-parts/<partId>/source.<ext>`, insert part with `defaultPartConfig(snapshot, null)` and `upload_id`, enqueue analysis (priority = position) → presented. Duplicate `uploadId` → return existing part (unique constraint). Upload owner must equal the caller (`getStagedUploadMeta`).
- `PATCH|DELETE /api/quotes/[id]/parts/[partId]`, `POST …/duplicate`, `POST /api/quotes/[id]/parts/bulk`, `POST|DELETE …/parts/[partId]/drawing` (multipart), `GET …/parts/[partId]/drawing` (owner/admin; streams PDF).
- `POST /api/quotes/[id]/claim`, `/reprice`, `/review`, `/split`, `/share` `{action}`, `/requote`, `/parts/import` `{sourcePartIds}`.
- `GET|POST /api/quotes/[id]/messages`, `POST /api/quotes/[id]/messages/read` (owner only; body ≤ 4000; attachment via existing `saveChatAttachment`).
- `GET /api/customer/quotes?page=`, `GET /api/customer/parts?page=` (session required; 401 `d["api.auth.notLoggedIn"]`).
- `GET /api/quotes/catalog` → public catalog WITHOUT prices + `{enabled: isFlagEnabled("instant_quote_enabled") || isAdminSession}` for the landing uploader.
Every mutation: runs under `db.transaction` with `SELECT quotes … FOR UPDATE`, checks `quotePermissions` (403/409 with `blockedReason`), writes, then `recomputeQuoteCache` (version+1), then `emitQuoteChanged`. Config patches are validated against the quote's snapshot (unknown keys → 400 "Geçersiz seçenek"); when technology changes, material/color/finish/layer/infill reset to that technology's defaults (first material, first color, `ham`, default layer/infill). `quoted` + any config/geometry-affecting edit → status back to `draft`. `needs_review` stays. Units/scale edits never re-enqueue analysis. Feature flag: when `instant_quote_enabled` is off, every `/api/quotes*` route returns 404 unless an admin session (`auth()` role admin) is present.

`quote-present.ts` requirements: `canSeePrices=false` ⇒ output has NO `price`, `totals`, `targetUnitPriceKurus`, addon `priceKurus/priceType`, `leadOptions[].totalKurus` keys (delete, not null). Share viewer ⇒ `previewGlbUrl=null`, no `invoice`, no `shareUrl`, no `customerNote`, no `poNumber`. `invoice` and `shareUrl` only for owner. `readiness.blockers` from `checkoutBlockers`. `shipByDate` = `addBusinessDays(now, totals.leadDays, holidays, cutoff)` ISO date when leadDays known.

Tests:
- `scripts/test-quote-api.ts` (route tests with stubbed CJS drivers per `briefs/misc.md` §8; or pure presenter tests + access matrix via injected fakes): presenter with `canSeePrices=false` → `JSON.stringify(out)` matches none of `/"price"|"totals"|Kurus"/` except the allowed non-price key `targetUnitPriceKurus` which must also be absent; share viewer hides GLB/invoice; owner sees totals. Access matrix: owner ✓ edit ✓ prices; anon cookie ✓ edit ✗ prices; share ✓ read-only (prices only with session); stranger null; number-guess null.
- `scripts/test-quote-service-db.ts` (QA DB): create → addPart ×20 in `Promise.all` then 21st → exactly 20 parts and a Turkish limit error; duplicate uploadId → same part; claim only with matching anon + null user; updatePart technology switch resets material; stale version → conflict; reprice drops manual prices; requestReview sets needs_review; splitByTechnology creates a second quote with the SLA parts; share create/rotate/revoke; requote copies parts (new keys via linkOrCopyStoredFile, analysis copied, status ready); listCustomerParts dedupes by sha256.
- [ ] Steps: failing tests → implement → pass → package.json scripts (`test:quote-api` in test:unit; `test:quote-service:db` separate) → tsc → `npx tsx scripts/test-api-contracts.ts` PASS → commit `feat(teklif): teklif servisleri ve musteri API'leri`.

---

## Phase 3 — Customer UI

### Task 3.1: Foundations — dictionary block, price-gate modal, auth fixes, header links, analytics, SEO wiring

**Files:** Modify `src/lib/i18n/dictionaries/tr.ts`, `en.ts` (one `instantQuote.*` block mid-file containing ALL customer UI strings needed by Tasks 3.1–3.3: workspace, part card, config panel, DfM messages `instantQuote.dfm.<code>` with `{param}` placeholders, summary, lead tiers, modal, checkout page, account pages, share/document labels), `src/lib/services/password-reset.ts` (guest `isGuest && !passwordHash` → `issueGuestClaimToken` + email), `src/app/api/auth/register/route.ts` + `login/route.ts` (lowercase + trim email before lookup/store), `src/components/site-header.tsx` (listen `window` event `figurunica:auth-changed` → refetch `/api/auth/me`; add "3D baskı teklifi" nav link to `/3d-baski`), `src/components/user-dropdown.tsx` (links "Tekliflerim" `/account/teklifler`, "Parça kütüphanem" `/account/parcalar`), `src/lib/analytics/events.ts` (`quote_upload`, `generate_lead`; reuse existing `sign_up` if present else add), `src/lib/seo/policy.ts` (`/teklif` noindex prefix), `src/app/robots.ts` (disallow `/teklif/`), `src/app/sitemap.ts` + `scripts/test-sitemap.ts` (`/3d-baski`, `/3d-baski/malzemeler`). Create `src/components/quote/price-gate-modal.tsx`.

**Interfaces:** `export function PriceGateModal(props: { open: boolean; onClose: () => void; onAuthenticated: () => void; redirectPath: string; initialTab?: "register" | "login" }): JSX.Element | null` — tabs Kayıt ol / Giriş yap; register fields fullName, email, `PhoneInput`, password (min 6), marketing checkbox (unchecked, links `/ticari-ileti`), KVKK note linking `/privacy`; `GoogleSignInButton redirect={redirectPath}`; 409 → switch to login with email prefilled; 429 → "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin."; on success dispatch `window.dispatchEvent(new Event("figurunica:auth-changed"))`, `track("sign_up")` for register, call `onAuthenticated()`. Modal shell per `account-gallery-modal.tsx` (Escape, body overflow lock, `z-[110]`).
Tests: add to `scripts/test-quote-ui.ts` (created here; Task 3.2 extends): render modal markup (with `LocaleProvider` + router context) contains "Teklifinizi görmek için" heading text from dictionary and both tabs; password-reset guest branch unit test in `scripts/test-quote-ui.ts` or a small `scripts/test-guest-reset.ts` with stubs.
- [ ] Steps: dictionary block (tsc proves parity) → modal → auth fixes → wiring → tests (`test:quote-ui` into test:unit) → `npx tsx scripts/test-sitemap.ts` PASS → tsc → commit `feat(teklif): fiyat kapisi modali, sozluk ve giris duzeltmeleri`.

### Task 3.2: Quote workspace `/teklif/[number]` (+ document page)

**Files:** Create `src/app/teklif/[number]/page.tsx` (server: `resolveQuoteAccess` by number + `?t=`; `notFound()`), `src/app/teklif/[number]/workspace-client.tsx`, `src/app/teklif/[number]/belge/page.tsx` (+ `belge.css`, print button client), `src/components/quote/{dropzone,part-card,part-config-panel,part-viewer-modal,price-break-table,dfm-list,quote-summary,lead-tier-picker,addons-picker,bulk-bar,review-request-dialog,share-dialog,quote-chat-panel,quote-header}.tsx`, `src/lib/quote/client-api.ts` (typed fetch helpers for every `/api/quotes` endpoint). Modify `src/components/model-viewer.tsx` (optional `dimensionsMm` chip). Extend `scripts/test-quote-ui.ts`.

Requirements (map 1:1 to spec "Müşteri arayüzü" `/teklif/[number]` bullet — every element listed there must exist):
1. Page renders `PresentedQuote` only (no direct DB in client). Upload flow: `uploadLargeFile(file,{expectedSize:true})` → `POST /parts`; page-wide drag-drop overlay; per-file progress via `UploadProgressBar`; client-side checks (extension stl/obj/3mf, size ≤ `catalog.maxFileBytes`, part count ≤ `maxPartsPerQuote`) with Turkish messages; `track("quote_upload")`.
2. Live updates: `RealtimeProvider url={/api/realtime/quote/<id>}` for owner/anon + 3 s polling of `GET /api/quotes/[id]` while any part is `queued|analyzing` (also when SSE unavailable).
3. Part card: thumbnail (click → `part-viewer-modal` with `ModelViewer url=previewGlbUrl dimensionsMm`), inline rename, dims `X × Y × Z mm`, units select + scale input (0.01–100) with suggestion chip from `suggestedUnits`, analysis state ("Parça geometrisi inceleniyor…" skeleton + blurred spec), config summary, "Özellikleri düzenle" → config panel (technology tabs, material list with properties popover, color swatches, finish list with manual badge, layer/infill selects only when options exist, quantity stepper, note textarea, drawing PDF upload/remove, "Kritik tolerans (teknik çizim gerekir)" checkbox), DfM list with Turkish messages + "Uyarıları okudum" checkbox (PATCH `dfmAckKey`), price block (unit + line + `price-break-table`) or placeholder `–₺–,––` + "Fiyatı gör" button (opens modal) when `!viewer.canSeePrices`, duplicate/delete actions, "Manuel fiyat bekliyor" badge.
4. Group parts by technology with headers; "Hepsini seç" + bulk bar (apply technology/material/color/finish/quantity to selection; delete selection).
5. Summary sidebar: lead tier picker (name, business days, ship-by date, and total per tier when prices visible), addons picker (checkbox list; prices when visible), "N parça (M adet)", parts subtotal, addons, min-order top-up line, total with "KDV dahil" + toggle "KDV hariç göster" (client `localStorage` pref, try/catch), "Kargo: Ücretsiz", blockers list, primary "Ödemeye geç" → `/teklif/<no>/odeme` (disabled with reason when not ready; when `!canSeePrices` it opens the modal), "Manuel teklif iste", "Hedef fiyat öner" (dialog with per-part unit targets), "Yüksek hacim teklifi (RFQ)" shown when `quoteIssues` contains `qty_over_auto`, quote note textarea, PO number field, "Teknolojiye göre ayır" when >1 technology, catalog-changed banner with "Yeniden fiyatla", expired banner with "Yeniden fiyatla", locked banner linking `/pay/<ref>`, ordered banner linking `/track/<orderNumber>`.
6. Header: number, editable title, created/expiry dates, share dialog (create/copy/rotate/revoke), "Belge / PDF" link to `/teklif/<no>/belge`, "Teklif sohbeti" panel (reuse `<OrderChat basePath={/api/quotes/<id>/messages} orderId={quote.id}/>` if its props allow; otherwise `quote-chat-panel.tsx` minimal equivalent).
7. After modal success: `POST /claim` then refetch; if claim false (quote already owned by someone else) show read-only notice.
8. Terms: on first upload (quote creation) a required checkbox "Yüklediğim tasarımların haklarına sahibim; yasaklı ürün içermediğini ve dosyaların yalnızca atanan üretim ortağıyla paylaşılacağını kabul ediyorum." (sent as `termsAccepted:true`).
9. Document page `/teklif/[number]/belge`: A4 print layout (Figurunica identity from `src/lib/seo/organization.ts`/business-identity, quote number, dates, validity, customer/company + VKN, PO, parts table with thumbnail, config, qty, unit, line, addons, top-up, total KDV dahil + KDV hariç + KDV, lead tier + ship-by, IBAN block from `getBankDetails()` titled "Proforma / Havale bilgileri", "Bu teklif <tarih> tarihine kadar geçerlidir."), `window.print()` button (`.no-print`), requires owner or (share token + session) — prices obey the gate (without session the page redirects to the workspace).
10. `scripts/test-quote-ui.ts`: render workspace client with a logged-out `PresentedQuote` fixture → markup contains `–₺–,––`, contains no `₺` digits pattern `/₺\s?\d/`; with logged-in fixture shows `74,00` style formatted totals; part card with DfM warning renders ack checkbox; bulk bar appears when 2 selected (state test via exported pure helper `groupPartsByTechnology`).
- [ ] Steps: client-api + components + page → UI tests → tsc → `npx tsx scripts/test-api-contracts.ts` → commit `feat(teklif): teklif calisma alani, parca karti ve belge sayfasi`.

### Task 3.3: Landing `/3d-baski`, materials page, account pages, footer

**Files:** Create `src/app/3d-baski/page.tsx`, `src/app/3d-baski/landing-uploader.tsx` (client: terms checkbox + Turnstile + create quote + first upload → `router.push('/teklif/<no>')`), `src/app/3d-baski/malzemeler/page.tsx`, `src/lib/seo/service.ts` (`buildPrintServiceJsonLd(catalog)`), `src/app/account/teklifler/page.tsx` + client, `src/app/account/parcalar/page.tsx` + client. Modify footer (`src/components/figurunica/sections.tsx` + `dict.ts` key per `briefs/accounts-ui.md` §8).
Requirements: landing is a server component with `revalidate = 3600`, reads `loadActiveSnapshot()` inside try/catch (fallback to `SEED_SNAPSHOT` display values so `next build` without DB works); hero (font-mono eyebrow "ANLIK 3D BASKI TEKLİFİ", h1 display font), uploader, 4 steps ("Modelini yükle / Özelliklerini seç / Anında fiyatını gör / Üretime gönder"), technology comparison table (build volume, layer options, min wall, tolerance, base lead days, "₺X'den başlayan" = min over materials of `priceUnitAuto` for a 20 mm cube qty 1 standard + setup, computed server-side from catalog — public anchor numbers), materials grid linking `/3d-baski/malzemeler#<key>`, confidentiality block ("Dosyalarınız yalnızca siparişinizi üreten, atanmış üretim ortağıyla paylaşılır."), FAQ (≥6 Q&A: formatlar STL/OBJ/3MF, dosya tavanı (32 MB), asgari sipariş tutarı, 20 parça, fiyatı görmek için hesap, teslim süreleri, STEP'i nasıl dışa aktarırım, manuel teklif, kurumsal fatura), JSON-LD. When flag off and not admin: render a "Yakında" state without uploader. Account pages: server guard `getSessionUser()` → `redirect('/login?redirect=/account/teklifler')`; list via `/api/customer/quotes` (number, title, part count, total when priced, status chip, expiry, link); parts library via `/api/customer/parts` (thumbnail, name, dims, last material, "Yeni teklife ekle" → `POST /api/quotes` then `/parts/import`, or into an existing draft quote chooser).
Tests: extend `scripts/test-quote-ui.ts` with landing render using SEED values (contains "₺" anchor and all FAQ questions); `scripts/test-sitemap.ts` PASS.
- [ ] Steps → tsc → `npm run build` (must pass; if it fails only due to network/env, record exact error) → commit `feat(teklif): 3d baski acilis sayfasi, malzeme kutuphanesi ve hesap sayfalari`.

---

## Phase 4 — Order integration

### Task 4.1: Quote checkout

**Files:** Create `src/lib/validators/quote-checkout.ts`, `src/lib/services/quote-checkout.ts`, `src/app/api/quotes/[id]/checkout/route.ts`, `src/components/quote/quote-checkout-form.tsx`, `src/app/teklif/[number]/odeme/page.tsx` (+ client), `scripts/test-quote-checkout-db.ts`.
**Interfaces:**
```ts
export const quoteCheckoutSchema: z.ZodType<QuoteCheckoutInput>; // { expectedVersion:number; expectedTotalKurus:number; shippingAddress: TurkishAddress(E.164 phone); paymentMethod:"card"|"bank_transfer"; distanceContractConsent:true; preliminaryInfoConsent?:true; invoice:{type:"individual"|"corporate"; companyName?; taxId?; taxOffice?; billingAddress?}; poNumber?:string }
export async function createQuoteCheckout(args: { quoteId: string; userId: string; email: string; input: QuoteCheckoutInput; req: NextRequest }): Promise<{ reference: string; paymentMethod: "card" | "bank_transfer"; iframeUrl?: string; paytrToken?: string; redirectUrl?: string; finalAmountKurus: number; reused: boolean }>;
```
Requirements: exactly spec "Ödeme → sipariş" steps 1–5. Copy (import, never edit) from `/api/orders` upload branch: consent columns (`CONTENT_CONSENT_VERSION` not required for quotes — set `contentConsentAt` null; set `preliminaryInfoAcceptedAt`, versions, `consentIp`, `consentUserAgent`), `buildDraftReference`, `buildMerchantOid`, `createPaytrToken` with single basket line `["Teklif T-…", amount, 1]` via existing `allocatePaytrBasket` if compatible, `calculateHavaleDiscount` (only when settings.havaleDiscountApplies), `getPaymentDeadlineQueue` + `havaleReminderJobId`/`havaleExpireJobId`/`cardExpireJobId` (always queue card-expire for card drafts), `getBankDetails`, bank transfer instructions email via existing `getEmailQueue().add("send", {type:"bank_transfer_instructions", …})` using the SAME payload shape `/api/orders` uses (read it; do not modify queues.ts), `withIdempotency({scope:"quotes.checkout"})`, `rateLimitAsync("quote-checkout:user:<id>", 10, 3600_000)`, `attributionColumns(attributionFromRequest(req))`, `recordEvent` `begin_checkout`/`add_payment_info` like `/api/orders`. Corporate invoice requires `parseTaxId` ok + companyName + taxOffice; stored on the quote (`invoice_type, company_name, tax_id, tax_id_type, tax_office, billing_address`) in the same tx. `parts_snapshot` = `FrozenQuotePart[]` from computed prices; `addons_snapshot`. Form: fork of the checkout form UI (address fields, `PhoneInput`, payment method radio, havale discount preview, distance contract + preliminary info consent with `consentVariantForOrderType("upload")`, invoice type toggle + corporate fields, PO), posts to `/api/quotes/<id>/checkout` with `Idempotency-Key` header, handles `iframeUrl` (redirect) / `redirectUrl`.
Tests (QA DB, PayTR + BullMQ stubbed at CJS level): happy card path creates one draft (orderType upload, quantity Σq, amount=total, productionBase=amount, painting 0, material from dominant tech) + one quote_checkouts row; second call returns same reference (`reused:true`); stale `expectedTotalKurus` → 409; expired quote → 409 Turkish; blockers (unacked warning) → 400; corporate with invalid VKN → 400; havale path applies 3% discount per settings.
- [ ] Steps → tsc → commit `feat(teklif): teklif odemesi ve kurumsal fatura bilgileri`.

### Task 4.2: Link paid order + attach files job

**Files:** Create `src/lib/services/quote-order.ts`, `src/lib/queue/workers/quote-order-files.worker.ts`, `scripts/test-quote-order-db.ts`. Modify `src/lib/services/order-confirm.ts`, `src/lib/services/order-model.ts`, `src/lib/config/order-model-policy.ts` (+ `scripts/test-order-model-policy.ts`), `src/app/api/admin/orders/[id]/approve/route.ts`, `workers/start.ts`.
**Interfaces:**
```ts
export async function linkQuoteToOrderTx(tx: Tx, args: { orderId: string; draftId: string | null }): Promise<{ quoteId: string } | null>;
export async function attachQuoteFilesToOrder(orderId: string): Promise<"attached" | "already" | "not_quote" | "missing_files">;
export async function findQuoteOrdersMissingFiles(limit: number): Promise<Array<{ orderId: string; quoteId: string }>>;
export async function attachOrderModelFilesTx(tx: Tx, args: AttachOrderModelFilesArgs): Promise<AttachResult>; // in order-model.ts; attachOrderModelFiles becomes a thin db.transaction wrapper (behaviour identical)
export function scaleBinaryStl(srcPath: string, dstPath: string, factor: number): Promise<void>; // float32 × factor streaming; factor 1 → caller links instead
```
Requirements: `kickOffOrderProcessing` (order-confirm.ts:~120): inside its existing transaction call `linkQuoteToOrderTx`; condition becomes `if (order.uploadedModelId || quoteLink)` → status `review`; after commit `enqueueQuoteOrderFiles` (try/catch + log). `linkQuoteToOrderTx`: find `quote_checkouts` by `draft_id`; `UPDATE quotes SET order_id=$order, status='ordered', updated_at=now() WHERE id=$q AND order_id IS NULL RETURNING`; if the quote already has a different order_id → append admin note `[ÇİFT ÖDEME] Teklif T-… başka bir siparişe bağlı (FIG-…)` via `appendAdminNote` pattern, return `{quoteId}` still (the order proceeds to review; admin resolves). Attach: idempotent (return "already" if `latestModelFiles` non-empty); for each frozen part: output name `P${pos:02}_${safe(name)}_x${qty}.stl` (via `safeModelFileName` + `dedupeFileNames`); factor==1 → `linkOrCopyStoredFile(canonicalStlKey, models/<orderId>, name)`; else stream-scale; then `attachOrderModelFilesTx({orderId, files, source:"customer_quote", note:"Teklif T-…", uploadedByEmail: null})`; publish `emitOrderChanged`. Extend `source`/`nextModelSource` unions with `"customer_quote"` (text column, no migration) and its tests. Approve route: if order is a quote order (`quotes.order_id = order.id` exists) and `latestModelFiles` empty → 409 "Teklif dosyaları henüz siparişe eklenmedi; birkaç dakika sonra tekrar deneyin." Worker `quote-order-files` (concurrency 2) + scheduler `quote-order-files-recovery` every 5 min using `findQuoteOrdersMissingFiles(20)`.
Tests (QA DB): end-to-end: seed quote+parts (analysis ready, canonical STL on disk in mkdtemp UPLOAD_DIR), `createQuoteCheckout` (stub PayTR), then `promoteDraftToOrder(draftId)` twice concurrently → one order; `kickOffOrderProcessing` twice → status `review`, `quotes.order_id` set once; `attachQuoteFilesToOrder` twice → exactly one revision with N stl files, `orders.model_stl_key` set, scaled file for an inch part has 25.4× extents (parse binary STL header/first vertex); `productionBaseKurus + paintingPriceKurus === amountKurus`; a second paid draft for the same quote → `[ÇİFT ÖDEME]` note, no throw.
- [ ] Steps → `npx tsx scripts/test-order-model-policy.ts` PASS → tsc → commit `feat(teklif): odenen teklifi siparise baglama ve dosya ekleme isi`.

### Task 4.3: Ranker/capability parity

**Files:** Modify `src/lib/services/capability.ts`, `src/lib/services/manufacturer-assignment.ts`, `src/lib/services/manufacturer-assign.ts` (only `largeFormatPlacementBlocked` optional override + `loadPlacementFacts` reading quote), tests `scripts/test-capability.ts`, `scripts/test-scoring-v2.ts`.
**Interfaces:** `export function quoteRequirements(parts: Array<{ orderMaterial: "resin" | "filament"; polymerTag: string | null; dimsMm: Vec3; buildMm: Vec3 }>): { materials: Array<"resin" | "filament">; polymerTags: string[]; largeFormat: boolean }`; `export function manufacturerSupportsAllMaterials(caps: string[] | null, materials: readonly string[]): boolean`; `export function manufacturerSupportsPolymers(caps: string[] | null, tags: readonly string[]): boolean` (lenient: true when caps has no `pmat_*`). `ManufacturerScoringOrder` gains optional `requiredMaterials?`, `requiredPolymerTags?`, `largeFormatRequired?`; defaults preserve today's behaviour (`[order.material]`, `[]`, existing figurine rule). In `rankManufacturersDetailed` load the quote's frozen parts (via `quotes.order_id = orders.id` → `quote_checkouts` latest by created_at) when present and fill those fields (largeFormat: any part's sorted dims > 120 mm on the largest axis, consistent with `LARGE_FORMAT_MIN_MM`, only used when that signal is live).
Tests: existing suites unchanged (deep-equal parity); new cases: FDM+SLA quote requires shop with both tags; shop with no tags passes (lenient); shop with `pmat_pla` only fails a PETG part; shop with no `pmat_*` passes PETG.
- [ ] Steps → `npx tsx scripts/test-capability.ts && npx tsx scripts/test-scoring-v2.ts && npx tsx scripts/test-auto-assign.ts` PASS → tsc → commit `feat(teklif): atamada teklif parcalarinin teknoloji ve polimer gereksinimleri`.

### Task 4.4: Partner/admin order surfaces, money breakdown, QC cap, download gating

**Files:** Modify `src/app/manufacturer/orders/[id]/page.tsx` + `client.tsx`, `src/app/manufacturer/orders/page.tsx` + list client (show "N parça" instead of size for quote orders), `src/app/admin/orders/[id]/page.tsx` + `client.tsx`, `src/lib/config/order-money.ts`, `src/lib/services/order-money.ts`, `src/lib/config/qc.ts`, `src/lib/services/qc.ts`, `src/components/qc-photo-uploader.tsx`, `src/app/api/manufacturer/orders/[id]/qc-photos/route.ts`. Create `src/app/api/manufacturer/orders/[id]/quote-files/[partId]/route.ts` (drawing/thumbnail download, guarded by `manufacturerOrderOrError`), `src/app/api/admin/orders/[id]/quote-files/[partId]/route.ts`. Tests: `scripts/test-order-money.ts`, `scripts/test-qc.ts`, `scripts/test-admin-order-routes.ts` updates.
**Interfaces:** `export async function loadOrderQuoteParts(orderId: string): Promise<{ quoteNumber: string; quoteId: string; leadTier: LeadTierKey; leadDays: number; parts: FrozenQuotePart[]; addons: FrozenQuoteAddon[]; invoice: {...} | null; poNumber: string | null } | null>` (put in `quote-order.ts`, import from 4.2 file — coordinate: 4.4 adds this function to `quote-order.ts` only if 4.2 is done; run 4.4 after 4.2). `export function qcPhotoCap(partCount: number): number` = `Math.min(24, Math.max(6, partCount + 2))`.
Requirements: spec "Üretici ve admin sipariş yüzeyleri" bullets, all. Manufacturer view never shows `unitKurus/lineKurus`. Parts table read wrapped in the page's `displayRead` and added to `unreadableAreas` + `productionGateClosed`. Admin "Teklif" card on Özet tab: number (link `/admin/teklifler/<quoteId>`), PO, invoice (company/VKN/tax office), lead tier + ship-by, parts table WITH prices, addons. `download-upload` links render only when `uploadedModelId` present. Money: `classifyMoneyOrder` returns `"quote"` before `"upload"` when the snapshot has quote parts; lines = one production line per part (`qty × unit`), addon lines, "Asgari sipariş tamamlama" line; reconcile to `amountKurus` via existing `reconcileKinds`; add fixtures in `test-order-money.ts` (Σ lines == amount; with later painting carve-out still reconciles). QC cap used by API + uploader prop; `test-qc.ts` cases 1→6, 10→12, 30→24.
- [ ] Steps → the three test scripts PASS → tsc → commit `feat(teklif): uretici ve admin siparis ekranlarinda parca listesi, para dokumu`.

---

## Phase 5 — Admin

### Task 5.1: Catalog admin, settings, simulator, flags page

**Files:** Create `src/app/admin/baski-katalogu/page.tsx` + `catalog-client.tsx`, `src/app/api/admin/print-catalog/{technologies,materials,finishes,addons}/route.ts` (GET, POST) + `[id]/route.ts` (PATCH), `src/app/api/admin/print-catalog/settings/route.ts` (GET, PUT), `src/app/api/admin/print-catalog/simulate/route.ts` (POST), `src/lib/services/quote-catalog-admin.ts`, `src/lib/validators/print-catalog.ts`, `src/app/admin/ayarlar/page.tsx` + client, `src/app/api/admin/flags/route.ts` (GET, PUT), `scripts/test-quote-admin-catalog.ts`.
Requirements: `requireAdmin()` on every route; zod validation with Turkish messages (ranges: prices ≥0 ≤ 10,000,000; density 0.5–3; support 1–3; build 10–2000 mm; bps 0–9000 discounts, multipliers 5000–30000; minDays 1–60; holidays ISO dates; qty breaks strictly increasing minQty starting at 1; lead tiers must contain all three keys; colors ≥1 with `#RRGGBB`); PATCH requires `expectedUpdatedAt` (409 on mismatch); every write + `print_catalog_changes` row in ONE transaction; `revalidatePath("/3d-baski")` and `/3d-baski/malzemeler`; no DELETE (active toggle). Simulator: body `{technologyKey, materialKey, colorKey, finishKey, layerUm, infillPct, quantity, leadTier, geometry:{volumeCm3, areaCm2, x, y, z}}` → `computeQuote` against `loadActiveSnapshot()` → returns breakdown + totals. UI tabs: Teknolojiler / Malzemeler (color editor rows) / Yüzey işlemleri / Ek hizmetler / Fiyat ayarları / Simülatör; Turkish labels; note under holidays: "Dini bayram tarihlerini Diyanet takviminden doğrulayın." Flags page lists `FLAG_KEYS` with `FLAG_LABELS_TR`, toggles via PUT `{key, enabled}` → `setFlag(key, enabled, email)`. Sidebar entries are added by Task 5.2 (single owner of sidebar.tsx).
Tests: validator unit tests (bad holiday, non-increasing breaks, missing tier, bad hex); simulator pure path equals `computeQuote` golden G1 for SEED values; route 401 without admin (stub `requireAdmin`); `test-api-contracts` PASS.
- [ ] Steps → tsc → commit `feat(teklif): admin baski katalogu, fiyat ayarlari, simulator ve bayraklar`.

### Task 5.2: Admin quote queue, detail, manual pricing, target decision, sidebar

**Files:** Create `src/lib/services/quote-admin.ts`, `src/app/admin/teklifler/page.tsx` + `client.tsx`, `src/app/admin/teklifler/[id]/page.tsx` + `client.tsx`, `src/app/api/admin/quotes/[id]/{price,target,extend,reject-review,reopen}/route.ts`, `src/app/api/admin/quotes/[id]/messages/route.ts` (+ `read`), `scripts/test-quote-admin.ts`. Modify `src/app/admin/sidebar.tsx` (group "Teklifler": "Anlık teklifler" `/admin/teklifler` with badge, "Baskı kataloğu" `/admin/baski-katalogu`, "Ayarlar" `/admin/ayarlar`; rename legacy entry to "Eski yükleme teklifleri"), `src/app/admin/layout.tsx` (badge count `needs_review` via `displayRead`, add line to `unreadableAreas`), `scripts/test-admin-order-routes.ts` if it pins the layout.
**Interfaces:**
```ts
export async function priceQuoteManually(args: { quoteId: string; adminEmail: string; expectedUpdatedAt: string; parts: Array<{ partId: string; unitKurus: number | null }>; expiresInDays: number; reason: string }): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
export async function decideTargetPrice(args: { quoteId: string; adminEmail: string; decision: "accept" | "counter" | "reject"; counters?: Array<{ partId: string; unitKurus: number }>; reason: string; expectedUpdatedAt: string }): Promise<…same>;
export async function extendQuoteExpiry(args: { quoteId: string; adminEmail: string; days: number; reason: string }): Promise<…>;
export async function rejectReview(args: { quoteId: string; adminEmail: string; reason: string }): Promise<…>;
export async function reopenQuote(args: { quoteId: string; adminEmail: string; reason: string }): Promise<…>;
export async function listAdminQuotes(args: { tab: "review" | "target" | "rfq" | "quoted" | "ordered" | "expired" | "all"; page: number; q?: string }): Promise<{ items: AdminQuoteListItem[]; hasNext: boolean }>;
```
Requirements: transaction pattern of `order-money-edit.ts` (`SET LOCAL lock_timeout`, `FOR UPDATE`, compare `updated_at` to `expectedUpdatedAt`, guarded update, `quote_admin_actions` row with before/after in the same tx); manual price stores `manual_unit_price_kurus`, `manual_price_key = partPricingKey(part, quote.leadTier)`, `manual_priced_at/by`; sets status `quoted`, `expires_at = now + expiresInDays`, `reviewed_at/by`; refuses when a live draft exists (409 "Bu teklif için açık bir ödeme var; önce ödeme süresinin dolmasını bekleyin."). Target accept = manual price = target for each part; counter = given counters; reject = status `draft`, `review_note` = reason. After commit: `notifyManualQuoteReady` / `notifyTargetDecision`, `recomputeQuoteCache`, `publishRealtime([topics.admin()],{kind:"badge"})`. Detail page shows everything in spec "Admin" bullet (thumbnails, `ModelViewer`, dims, DfM, config, computed vs manual price, forms, chat via `<OrderChat basePath=/api/admin/quotes/<id>/messages>` if compatible, audit table, linked order link). List page uses disputes pattern (tab validation, `limit pageSize+1`).
Tests: service DB-less pure checks where possible + route 401/409 tests with stubs; `test-admin-order-routes.ts` updated if layout guarded reads changed; `test-api-contracts` PASS.
- [ ] Steps → tsc → commit `feat(teklif): admin teklif kuyrugu, manuel fiyat ve hedef fiyat karari`.

---

## Phase 6 — Maintenance

### Task 6.1: Expiry, reminders, retention worker

**Files:** Create `src/lib/services/quote-maintenance.ts`, `src/lib/queue/workers/quote-maintenance.worker.ts`, `scripts/test-quote-maintenance-db.ts`. Modify `workers/start.ts` (register worker + `upsertJobScheduler("quote-maintenance-hourly", {every: 3_600_000}, {name:"tick"})`).
**Interfaces:** `export async function expireQuotes(now: Date): Promise<number>`; `export async function sendExpiryReminders(now: Date): Promise<number>` (quotes `draft|quoted` with user, totals priced, `expires_at` within 3 days, `expiry_reminder_sent_at IS NULL` → `UPDATE … SET expiry_reminder_sent_at=now() WHERE … IS NULL RETURNING` then notify); `export async function sendAbandonedReminders(now: Date): Promise<number>` (priced, user has `marketing_consent=true`, `updated_at` older than 24 h, no checkout, `abandoned_reminder_sent_at IS NULL`); `export async function purgeExpiredQuoteFiles(now: Date): Promise<number>` (quotes `expired|cancelled`, `order_id IS NULL`, `expires_at < now − retention days`; for each part with `files_purged_at IS NULL` delete source/canonical/glb/thumb/drawing keys unless the same key is referenced by any other non-purged part; set `files_purged_at`).
Tests (QA DB + mkdtemp UPLOAD_DIR): expire moves only past-due non-ordered quotes; reminder sent once (idempotent under two concurrent calls); abandoned skipped without consent; purge deletes files of an old expired quote but keeps a key shared with another live part and never touches ordered quotes.
- [ ] Steps → tsc → commit `feat(teklif): sure dolumu, hatirlatmalar ve dosya saklama suresi`.

---

## Phase 7 — Cutover + final verification

### Task 7.1: Flag-driven cutover, docs

**Files:** Modify `src/components/create/upload-model-flow.tsx` (on mount fetch `/api/quotes/catalog`; if `enabled` → `router.replace('/3d-baski')`; otherwise legacy behaviour unchanged), `src/components/create/path-selector.tsx` (upload card href `/3d-baski` when enabled — fetch once; fallback legacy), `docs/superpowers/specs/…` status line. No `next.config.ts` redirect (flag-driven instead).
- [ ] Steps → tsc → commit `feat(teklif): bayrak acikken eski yukleme akisini anlik teklife yonlendir`.

### Task 7.2: Full gates (orchestrator)
`npx tsc --noEmit -p .`; `npm run lint`; `npm run -s test:unit`; all `:db` quote tests; python tests; `npm run build`; Playwright on an alternate port (`npx next dev --port 3117` with QA DB/Redis env + worker process `npx tsx workers/start.ts` pointed at QA) for: upload cube → thumbnail appears → price placeholder → register in modal → price appears → change quantity → price updates → checkout page renders. Then multi-lens adversarial review of the whole branch diff (security/price-leak, money/idempotency, migration reversibility, integration with dirty-file contracts, UI completeness vs spec) and fix confirmed findings.

## Self-review notes
- Spec coverage: every spec section maps to a task (Veri modeli→1.1; saf çekirdek→1.2; yükleme/analiz→2.1–2.3; erişim/fiyat gizleme→2.4; UI→3.x; yaşam döngüsü/özel teklifler→2.4+3.2+5.2; ödeme→4.1; sipariş bağlama→4.2; üretici/admin yüzeyleri→4.3–4.4; admin→5.x; bildirimler→2.4(notify)+6.1; paylaşım/belge/sohbet/kütüphane→2.4+3.2+3.3; saklama→6.1; bayrak/geçiş→1.2+7.1; eski akış düzeltmeleri→0.1+3.1).
- Names are fixed in `quote-types.ts` and the Interfaces blocks above; later tasks must import, not redefine.
