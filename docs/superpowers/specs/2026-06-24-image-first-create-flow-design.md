# Spec — "Önce 2D Üret → Müşteri Seçsin → Sonra 3D" Create Akışı (Faz 1)

- **Tarih:** 2026-06-24
- **Branch:** `feat/image-first-create-flow`
- **Durum:** Tasarım onaylandı (kullanıcı), spec inceleme bekliyor
- **Kapsam:** Faz 1 (detaylı). Faz 2/3 sonda roadmap olarak; kendi spec'lerini alacak.

---

## 1. Problem

Bugünkü create akışı tamamen otomatik ve müşteriye seçim hakkı vermiyor:

```
foto yükle → (otomatik) TEK stilize görsel → (otomatik) Meshy 3D → 3D önizleme → onayla → ödeme
```

Kanıt (kod):
- `src/app/api/preview/generate/route.ts:221` — tek preview satırı açılıp `preview-generation` job'ı kuyruğa atılıyor.
- `src/lib/queue/workers/preview-generation.worker.ts` — `applyStyleTransfer()` **bir kez** çağrılıyor (tek görsel, varyasyon yok), hemen ardından `generateWithMeshy()` ile 3D'ye gidiliyor. Arada **müşteri seçim kapısı yok.**
- Stilize motoru şu an **ücretli Replicate `flux-kontext-pro`** (`src/lib/services/style-transfer.ts`).

Meshy "Creative Lab" ise "önce 2D konsept üret, müşteri seçsin, sonra 3D" yapıyor. Müşterinin asıl şikayeti tam olarak bu eksik adım.

## 2. Hedefler / Hedef-dışı

**Hedefler**
- Müşteri, 3D'ye gitmeden önce **2 adet stilize 2D varyasyon** arasından seçim yapsın.
- Seçilen varyasyonun **arka görünümü** otomatik üretilip, **ön + arka** ile `multi-image-to-3d` çalıştırılsın (daha iyi geometri).
- Tüm görsel + 3D üretimi **tek sağlayıcıda (Meshy kredisi)** olsun → Replicate kaldırılsın.
- Stilize motoru olarak Meshy **Image-to-Image (`nano-banana` = Gemini 2.5 Flash Image, kimlik-koruyan)** kullanılsın.

**Hedef-dışı (Faz 1'de değil)**
- Yeni stiller / vinyl-funko vb. (Faz 2)
- Dokulu/renkli 3D önizleme (Faz 2) — Faz 1 önizleme **dokusuz** kalır.
- Yeni fiziksel ürünler: anahtarlık/magnet/lamba (Faz 3)

## 3. Karara bağlanmış akış

```
[0] Foto + stil seç  (mevcut /create step 0)
       │
       ▼  Aşama A — Varyasyon işçisi
[A] Meshy image-to-image × 2   (ai_model=nano-banana, reference_image_urls=[foto(lar)],
       prompt = design-templates stil prompt'u + varyasyon nüansı)
       → 2 renkli stilize PNG'yi ./uploads'a indir+kaydet
       → previews.styledImageUrls = [url1, url2];  status = "styled"   → DUR
       │
       ▼  Seçim kapısı  (/create YENİ adım: 2 kart, seç / yeniden üret)
[S] Müşteri 1 varyasyon seçer  → POST /api/preview/[id]/select { url }
       → previews.selectedStyledImageUrl = url;  status = "building"
       │
       ▼  Aşama B — Build işçisi (otomatik, müşteri beklemez başka onay)
[B1] Meshy image-to-image × 1  (seçilen görsel referans, prompt = "aynı karakter, ARKADAN")
       → backUrl
[B2] Meshy multi-image-to-3d  (image_urls = [selectedFrontUrl, backUrl], mevcut meshy-6 ayarları, should_texture=false)
       → glb/obj/stl;  previews.status = "ready"
       │
       ▼  Mevcut 3D önizleme (ModelViewer) + checkout  AYNEN devam
```

**Varsayılan parametreler**
- Varyasyon sayısı **N = 2**.
- Görsel modeli: **`nano-banana`** (3 kredi/görsel; smoke-test'te `nano-banana-pro` ile A/B).
- 3D: mevcut `buildMeshyBody` ayarları (meshy-6, `should_remesh:true`, `topology:triangle`, `target_polycount:300000`, **`should_texture:false`**, `image_enhancement:true`, `remove_lighting:true`).

## 4. Meshy Image-to-Image entegrasyonu (doğrulanmış sözleşme)

Kaynak: docs.meshy.ai (image-to-image, text-to-image, pricing, changelog). **Not:** araştırmada firecrawl kredisi bitti; sözleşme render edilmiş docs'tan okundu, ham OpenAPI JSON'la byte-doğrulanmadı → **implementasyonun İLK adımı canlı `curl` smoke-test** (bkz. §10).

- **Endpoint:** `POST https://api.meshy.ai/openapi/v1/image-to-image` → `{ "result": "<taskId>" }`
- **Poll:** `GET https://api.meshy.ai/openapi/v1/image-to-image/:id` → `status` (`PENDING|IN_PROGRESS|SUCCEEDED|FAILED|CANCELED`), `image_urls[]`, `consumed_credits`, `expires_at`
- **SSE (ops.):** `GET .../image-to-image/:id/stream`
- **Auth/host:** mevcut `MESHY_API_KEY`, aynı `api.meshy.ai` host (image-gen `/openapi/v1`, 3D `/openapi/v2` — tek anahtar).
- **Body parametreleri:**
  - `ai_model` (zorunlu): `nano-banana` | `nano-banana-2` | `nano-banana-pro` | `gpt-image-2`
  - `prompt` (zorunlu): uygulanacak dönüşüm/edit
  - `reference_image_urls` (zorunlu): 1–5 görsel (public URL **veya** base64 data URI) — bizim girdi foto(lar)ımız
  - `generate_multi_view` (ops., default false): true → 3 açı döner (kullanmıyoruz; biz ön+arka'yı kendimiz iki çağrıyla yapıyoruz — kullanıcı kararı)
- **API'de OLMAYAN (teyitli):** `n`/`num_images`/`batch` yok → **N varyasyon = N çağrı**; `seed` yok → varyasyon çeşitliliği **prompt nüansıyla**; `negative_prompt` yok.
- **Çıktı:** `image_urls[]` (PNG), **imzalı + süreli** (`expires_at`) → hemen ./uploads'a indir, hot-link etme (mevcut desen).
- **Kredi (per görsel):** nano-banana **3**, nano-banana-2 6, nano-banana-pro 9, gpt-image-2 12.

### Kimlik koruma
`nano-banana` = Google Gemini 2.5 Flash Image; karakter/kimlik tutarlılığı için özel. Meshy SLA vermiyor; **agresif stilizasyon (chibi) doğası gereği benzerlikten feda eder** → gerçek müşteri fotolarıyla QA şart (§10).

## 5. Prompt stratejisi

- **Stil prompt'ları korunur:** `src/lib/create/design-templates.ts` → `buildTemplatePrompt()` (look + scene axis + `POSE_FROM_PHOTO` + arka plan temizleme + `PRINT_READINESS_CLAUSE`). Bunlar bizim IP'miz; sadece hedef motor değişiyor (Replicate → Meshy image-to-image).
- **Varyasyon çeşitliliği (seed yok):** her çağrıya küçük, deterministik bir nüans eklenir (örn. varyasyon-2 için hafif farklı ifade/açı/ışık cümlesi) → iki görselin birbirinin kopyası olmaması. Nüans seti kodda sabit bir dizi (`VARIATION_NUDGES[]`).
- **Arka görünüm prompt'u:** seçilen görsel referans alınarak "Aynı karakteri **tam arkadan** göster; aynı kıyafet/renk/oranlar; düz beyaz arka plan; aynı stilize figür." `nano-banana`'nın kimlik tutarlılığı aynı karakteri korur.
- nano-banana, FLUX'tan farklı yanıt verebilir → smoke-test'te prompt ince ayarı.

## 6. Veri modeli değişiklikleri

`previews` tablosu (`src/lib/db/schema.ts:328-357`):

```diff
  status: enum(
-   "generating" | "ready" | "failed" | "approved" | "revision_requested"
+   "generating" | "styled" | "building" | "ready" | "failed" | "approved" | "revision_requested"
  )
+ styledImageUrls        jsonb<string[]>   -- N varyasyonun kalıcı URL'leri
+ selectedStyledImageUrl text              -- müşterinin seçtiği ön görsel
+ backImageUrl           text              -- otomatik üretilen arka görsel
```

- Migration: Drizzle generate → commit → deploy (bkz. memory: migration pipeline). `previews.status` bir enum; yeni değerler `ALTER TYPE ... ADD VALUE`.
- `meshyTaskId` zaten var; image-to-image task id'lerini de loglamak için ya yeniden kullan ya da `styledTaskIds jsonb` ekle (ops., maliyet/iz için faydalı — karar implementasyonda).

**Yeni route'lar**
- `POST /api/preview/[id]/select` — body `{ url }`; URL'in `styledImageUrls` içinde olduğunu doğrula, `selectedStyledImageUrl` yaz, `status="building"`, Aşama B job'ını kuyruğa at.
- `POST /api/preview/[id]/regenerate` — yeni 2 varyasyon (Aşama A tekrar); anti-abuse limitine tabi.

## 7. Worker / servis değişiklikleri

- **Yeni servis `src/lib/services/meshy-image.ts`:** `generateStyledVariations(photoUrls, prompt, n)` ve `generateBackView(frontUrl, basePrompt)` — image-to-image create+poll (mevcut `meshy.ts` poll desenini izler; timeout/retry aynı mantık).
- **`preview-generation.worker.ts` ikiye bölünür:**
  - **Stage A job** (`generate-variations`): foto(ları) oku → `generateStyledVariations` → PNG'leri ./uploads'a kaydet → `styledImageUrls` yaz → `status="styled"`. **Meshy 3D çağrısı YOK.**
  - **Stage B job** (`build-from-selection`): `generateBackView` → `generateWithMeshy([front, back], style)` (mevcut multi-image yolu) → glb/obj/stl kaydet → `status="ready"`.
- **`generateWithMeshy` zaten array (multi-image) destekliyor** (`src/lib/services/meshy.ts:58-60`) → Stage B minimal değişiklik.
- **`style-transfer.ts` (Replicate) kaldırılır**; `ai-generation.worker.ts` (sipariş-anı yol, önizlemesiz) de aynı yeni servise geçirilir ki iki yol paritede kalsın.

## 8. UI (/create)

- Mevcut "Generating (step 1) → 3D Preview (step 2)" arasına **yeni adım: Varyasyon Seçimi.**
  - `status="styled"` görülünce: 2 kart (PNG önizleme) + "Seç" + "Yeniden üret".
  - Seçince `status="building"` → "Modeliniz hazırlanıyor" spinner → `status="ready"` → mevcut step 2 (ModelViewer).
- Durum güncellemesi: **mevcut polling yeterli** (`src/app/create/page.tsx:572-602`). Opsiyonel: mevcut SSE altyapısı (memory: sse-realtime-architecture) ile anlık.

## 9. Kenar durumlar / kararlar

- **realistic / object (stilize değil):** restyle yok → varyasyon adımını **atla**, bugünkü direkt yolla devam (ham foto → 3D). Bu şablonlarda 2-varyasyon kapısı gösterilmez.
- **Arka görünüm başarısız/kötü:** fallback → tek görselle (`single image-to-3d`) build et; logla.
- **URL süreli:** image-to-image çıktısı `expires_at` taşır → indir+kaydet zorunlu.
- **Başarısız Meshy task'ı:** `consumed_credits=0` (kredi iadesi) → mevcut hata/yeniden-dene UX'i korunur.
- **Anti-abuse:** ücretsiz önizleme limitleri (login+email+free-tier caps) **Stage A**'ya bağlanır; pahalı 3D (Stage B) sadece seçimden sonra harcanır → ekonomi daha sağlıklı. `regenerate` de limite tabi.

## 10. Doğrulama planı (kod öncesi + sırasında)

1. **İLK: canlı `curl` smoke-test** — gerçek bir müşteri fotosuyla:
   - `image-to-image` (nano-banana, prompt=storybook) → `image_urls` çıktısını gözle gör; param adlarını (`reference_image_urls`, `ai_model`) ve kredi tüketimini teyit et.
   - Seçilen görselle arka-view image-to-image → `multi-image-to-3d` → glb.
2. **Benzerlik QA:** 5–10 farklı müşteri fotosu × {nano-banana, nano-banana-pro} → yüz benzerliği + stil kalitesi öznel skor; model kararını buna göre kesinleştir.
3. `tsc --noEmit` (de facto correctness gate).
4. Playwright e2e: yeni varyasyon-seçim adımının happy-path'i.

## 11. Maliyet modeli (figür başına, Meshy kredisi)

| Adım | Çağrı | Kredi |
|---|---|---|
| 2 varyasyon (image-to-image, nano-banana) | ×2 | 6 |
| Arka görünüm (image-to-image, nano-banana) | ×1 | 3 |
| multi-image-to-3d (meshy-6, dokusuz) | ×1 | 20 |
| **Toplam** | | **~29 kredi** |

≈ **$0.58** (Pro, $0.02/kredi) / **$0.44** (Studio). "Yeniden üret" her seferinde +6 kredi. `nano-banana-pro` seçilirse varyasyon+arka = 9×3=27 → toplam ~47 kredi (~$0.94).
> USD/kredi Meshy tarafından yayınlanmıyor; plan fiyatı ÷ aylık kredi'den türetildi.

## 12. Riskler / açık sorular

- Benzerlik kalitesi (nano-banana vs pro) ölçülmedi → QA'ya bağlı. **Faz 1 onayı bu QA'ya kapı bırakıyor.**
- API sözleşmesi render-docs'tan; `curl` smoke-test ilk iş.
- `previews.status` enum'a değer ekleme migration'ı prod'da `ALTER TYPE ADD VALUE` (geri-alınamaz; dikkat).
- Arka-görünüm kimlik kayması olasılığı → fallback (tek görsel) tasarımda var.

---

## Appendix — Faz 2 & 3 (roadmap, kendi spec'lerini alacak)

**Faz 2 — Stil çeşidi + çıktı kalitesi**
- `design-templates.ts`'e yeni görünümler (vinyl/funko, realistik-pro…) — registry-only ekleme.
- Opsiyonel **dokulu** önizleme (`should_texture:true`, +10 kr "wow") — baskı yine dokusuz olabilir.
- Meshy kalite ayarları: `model_type:lowpoly` A/B, `target_formats` ile doğrudan STL/3MF, `auto_size`+`origin_at` ile gerçek baskı-boyu ölçekleme, çoklu-açı thumbnail.

**Faz 3 — Yeni fiziksel ürünler (Creative Lab API)**
- API'den çağrılabilen 4'lü: **anahtarlık, magnet, lamba** (+ chibi-figure). Uçlar: `POST /openapi/creative-lab/{product}/v1/prototype` → `.../v1/build` (input_task_id ile zincir). Kredi: prototype 6 + build 30.
- /shop'a yeni ürün tipleri, fiyatlandırma, üretim akışı. Faz 1'in "2D önizle → seç → build" deseni yeniden kullanılır.
- Web-UI-only ürünler (vinyl/brick/twist-egg/keyboard-cap/fidget) API'den **çağrılamaz** → kapsam dışı.
