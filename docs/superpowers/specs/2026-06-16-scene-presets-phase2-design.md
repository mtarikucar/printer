# Sahne Preset'leri — Faz 2: Kişi Sayısı Algılama

Tarih: 2026-06-16
Faz 1: `2026-06-16-scene-presets-design.md` (canlıda).

## Hedef

Fotoğraf yüklenince kişi sayısını algıla; uygun sahneyi **öner** ve uyumsuzlukta
**uyar**. Üretimi asla bloklamaz — tamamen en-iyi-çaba (best-effort).

## Algılama (yerel, harici API yok)

`src/lib/services/person-detection.ts`: arka plan kaldırmayla (RMBG) aynı
`@huggingface/transformers` (transformers.js, CPU) yığınını kullanır.
`Xenova/detr-resnet-50` nesne algılama → eşik 0.7 üstü "person" etiketlerini sayar.
Her hata "bilinmiyor" (null) olarak ele alınır.

- API: `POST /api/photos/analyze { photoKey }` → `{ personCount }`. IP rate-limit
  (`/api/remove-background` deseni), `maxDuration=300`. Her hata `{ personCount: null }`.
- Docker: DETR `model` stage'inde önceden indirilir; **non-fatal** (indirme
  başarısızsa build sürer, app çalışma anında indirir). Eager warmup yok (VPS
  bellek baskısını önlemek için lazy yükleme).

## Create akışı (öneri/uyarı)

`CustomCreateFlow`:
- Fotoğraf yüklenince (`photoKey` set) `/api/photos/analyze` çağrılır →
  `detectedPersonCount`. Foto değişince yeniden, silinince temizlenir.
- **Öneri**: `count ≥ 2` ve seçili sahnenin `peopleHint === "single"` ise yeşil
  banner + tek tıkla önerilen grup sahnesine geç (tercih "family", yoksa ilk
  `multiple`).
- **Uyarı**: `count === 1` ve seçili sahne `peopleHint === "multiple"` ise amber
  uyarı.
- Karar kullanıcıda kalır (otomatik kilitleme yok) — Faz öncesi mutabık kalınan
  "öner + uyar" davranışı.

## Kapsam dışı (bilinçli)
- Realistic şablonu için hafif-FLUX sahne geçişi: realistic/object ham fotoğrafı
  Meshy'ye gönderir; sahne FLUX prompt'una girdiği için stilize stillerle sınırlı.
  Realistic'i FLUX'tan geçirmek "gerçekçi" vaadini bozma riski taşıdığından
  uygulanmadı; istenirse ayrı bir karar olarak ele alınır.

## Doğrulama
- typecheck + lint (0 hata) + build (82 statik sayfa) geçti.
- Algılama modeli inference'ı yerelde indirilemediğinden (ağ/boyut) prod'da
  doğrulanır; başarısızlıkta UI sessiz kalır (graceful).
