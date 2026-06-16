# Sahne Preset'leri (Scene Presets) — Tasarım

Tarih: 2026-06-16
Faz: 1 (çekirdek). Faz 2 (kişi sayısı algılama) ayrı spec.

## Problem

Fotoğraf → 3D akışında stil promptları (`src/lib/create/design-templates.ts`) tek
kişiye ve sabit bir T-pose'a kodlanmış ("this person", "only the single character",
"in a clear T-pose"). Aile/grup fotoğrafı yüklenince sistem herkesi tek bir T-pose
karaktere indirgiyor. İstenen: çok kişili fotoğraflar **tek bağlı parça** (tek taban)
bir figür olarak, **fotoğraftaki pozları korunarak** üretilebilsin; bunun için
yönetilebilir bir **sahne** ekseni gelsin.

## Kararlar (onaylı)

1. **Her zaman tek figür basılır** (tek bağlı parça, tek taban) — içinde N kişi
   olabilir. **Fiyat / boyut / sipariş modeli değişmez.**
2. **T-pose yok.** Poz her zaman fotoğraftan türetilir (best-effort; baskı
   sağlamlığı yumuşak kısıt).
3. Stil (görünüm) ve **Sahne** (kim/nasıl dizilmiş) **dik/bağımsız** iki eksen.
4. Sahne preset'leri **DB-tabanlı ve admin panelinden yönetilir** (ekle/çıkar/düzenle).
5. Onaylı başlangıç sahneleri: Tek kişi, Aile, Çift/Sevgili, Arkadaş grubu,
   Mezuniyet (sadeleştirilmiş kep/cübbe), Evcil hayvanıyla, Serbest tanım.
6. Kişi sayısı algılama Faz 2.

## Veri modeli

### Yeni tablo `scene_presets` (`src/lib/db/schema.ts`)
- `id` uuid PK defaultRandom
- `slug` text notNull unique (sabit anahtar; `previews.scene`'de saklanır)
- `label` text notNull (TR düz metin — i18n anahtarı değil, kategori/ürün deseni)
- `description` text (TR, opsiyonel)
- `promptFragment` text notNull (FLUX prompt'una enjekte edilen kompozisyon metni —
  **admin'in düzenlediği asıl değişken**; İngilizce, prompt diline uygun)
- `peopleHint` text notNull default `'any'` (`single` | `multiple` | `any`; Faz 2 için)
- `enabled` boolean notNull default true
- `sortOrder` integer notNull default 0
- `createdAt` / `updatedAt` timestamp defaultNow

### `previews` tablosuna eklenen kolonlar
- `scene` text (nullable) — seçilen preset slug'ı
- `sceneCustomText` text (nullable) — serbest tanım metni

`orders` tablosuna dokunulmaz (sahne fiyatı/siparişi etkilemez).

### Migration + seed (deploy'da otomatik uygulanır)
- `npm run db:generate` → şema migration'ı (tablo + kolonlar).
- `npx drizzle-kit generate --custom --name seed_scene_presets` → custom migration;
  içine 7 preset için idempotent `INSERT ... ON CONFLICT (slug) DO NOTHING`.
- Deploy'daki `migrate` container'ı (`drizzle-kit migrate`) ikisini de uygular.

## Prompt mimarisi

`design-templates.ts` **saf kalır** (DB bilmez). Stil promptları yeniden yazılır:
T-pose, "single character" ve arka plan cümleleri çıkarılır; geriye yalnızca
*görünüm* tarifi kalır (storybook/anime/chibi). Yeni sabit:

```
POSE_FROM_PHOTO = "Preserve each person's original pose, gesture, stance and facial
expression from the photo, adapting them faithfully onto the figurine; never use a
generic T-pose."
```

`buildTemplatePrompt(slug, modifiers, { sceneFragment?, customText? })` kompozisyonu:

```
[STİL görünümü] + [sceneFragment (DB) ya da customText] + POSE_FROM_PHOTO
+ "Remove the background completely and replace it with a plain white background."
+ PRINT_READINESS_CLAUSE
```

- `customText` doluysa (serbest tanım / `slug=custom`) sceneFragment yerine geçer.
- Non-stilize şablonlar (realistic/object): FLUX atlandığı için sahne enjekte
  edilmez — ham fotoğraf Meshy'ye gider, poz/kişiler fotoğrafta ne ise odur.
  (Realistic için hafif-FLUX geçişi Faz 2+ / kapsam dışı.)
- `peopleHint` ve T-pose'a bağlı `poseMode` alanı kaldırılır / kullanımdan düşer;
  `meshy.ts`'teki `poseModeForStyle` çağrısı temizlenir (artık T-pose ipucu yok).

### Akış (veri yolu)
- `api/preview/generate`: body'ye `scene` (slug) + `sceneCustomText` eklenir; slug
  DB'de `enabled` preset'e karşı doğrulanır; preset'in `promptFragment`'i okunur;
  `previews`'a `scene`+`sceneCustomText` yazılır; job'a `sceneFragment` +
  `sceneCustomText` eklenerek enqueue edilir.
- `PreviewGenerationJobData`: opsiyonel `sceneFragment?`, `sceneCustomText?`.
- Worker → `applyStyleTransfer(buffer, style, modifiers, { sceneFragment, customText })`
  → `buildTemplatePrompt`.

## Admin paneli

Gift-cards desenini izler:
- `src/app/admin/scene-presets/page.tsx` (server) + client tablo/form bileşeni.
- `src/app/api/admin/scene-presets/route.ts` (GET list, POST create) +
  `.../[id]/route.ts` (PATCH update, DELETE). Hepsi `requireAdmin()` korumalı, Zod
  doğrulamalı.
- Admin layout/sidebar'a "Sahne Preset'leri" linki.
- Düzenlenebilir alanlar: label, description, promptFragment, peopleHint, enabled,
  sortOrder. `slug` oluşturuldu mu sabit (değiştirilemez).
- i18n: admin başlık/etiketleri için TR sözlük anahtarları eklenir.

## Create sayfası

`src/app/create/page.tsx` (CustomCreateFlow):
- Stil seçicinin yanına **sahne seçici** (`/api/scene-presets` → enabled liste).
- `slug=custom` (Serbest tanım) seçilince bir `textarea` görünür → `sceneCustomText`.
- Varsayılan sahne `single` (mevcut tek-kişi davranışı korunur).
- Üretim isteğine `scene` + `sceneCustomText` eklenir.
- Yeni public API: `src/app/api/scene-presets/route.ts` (GET enabled list, auth'suz).

## Servis

`src/lib/services/scene-presets.ts`:
- `listEnabledScenePresets()` (create + public API)
- `getScenePreset(slug)` (generate doğrulama)
- `DEFAULT_SCENE_SLUG = "single"`
- Seed verisi (7 preset) — seed migration üretmek için referans + tek kaynak.

## Kapsam dışı (Faz 2)
- Kişi sayısı algılama → preset öner + uyumsuzluk uyarısı + taban aralığı.
- Realistic şablonu için hafif-FLUX sahne geçişi.

## Doğrulama
- `npm run typecheck` + `npm run lint` + `npm run build`.
- `npm run db:generate` migration üretir; deploy `drizzle-kit migrate` uygular.
- Manuel: admin'den sahne ekle/düzenle; create'de Aile seç + çok kişili foto →
  tek tabanda grup, fotoğraf pozları korunmuş, T-pose yok.
- Canlı: main'e push → "Deploy Printer" hattı (migrate + app/worker recreate).
