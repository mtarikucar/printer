# Spec — WhatsApp AI Satış Ajanı + Otomatik 3D Sipariş Boru Hattı

- **Tarih:** 2026-08-27
- **Durum:** Tasarım onaylandı (kullanıcı), spec incelemesi bekliyor
- **Kapsam:** 4 faz. Faz 0 ve Faz 1 detaylı; Faz 2 ve Faz 3 uygulanabilir düzeyde; Faz 4 kalibrasyon.

---

## 1. Problem

Bugün ödenmiş her kişiye özel sipariş `awaiting_model` statüsünde duruyor ve `kickOffOrderProcessing`
kuyruğa **hiçbir şey atmıyor**. Bir insan elle 3D model üretip `POST /api/admin/orders/[id]/upload-model`
ile yükleyene kadar hiçbir şey olmuyor. Bu, hem ölçeklenmeyi hem 7/24 satışı bloke ediyor.

Aynı anda iki taahhüt karşılıksız duruyor:
- `src/app/mesafeli-satis/page.tsx`: *"Her sipariş için baskı öncesi dijital önizleme sunulur; üretim,
  Alıcı önizlemeyi onaylayana kadar başlamaz"* — 3D model için böyle bir kapı **yok**.
- Cayma hakkı istisnası da tam olarak bu onaya bağlanmış durumda.

WhatsApp tarafında ise sadece `wa.me` click-to-chat linkleri ve admin'in elle ödeme linki gönderdiği
bir araç var (`/admin/orders/new`); gelen mesaj hiçbir yerde saklanmıyor, otomasyon yok.

### 1.1 Neden bu iş bir kez battı

2026-07-04 tarihli `fal-image-figure-flow-design.md` otomatik Meshy 3D'yi kaldırdı ama **gerekçeyi
yazmadı**. Kullanıcı beyanı: *"çıkan model baskıya uygun olmuyordu o yüzden değiştirmiştik, şimdi
meshy-7 ile bu sorun azaldı"*.

Bu spec'i yazarken canlı Meshy anahtarıyla gerçek ölçüm yapıldı (bkz. §3). Sonuç, varsayımı kısmen
çürütüyor ve tasarımın merkezini belirliyor.

---

## 2. Kilitlenen kararlar (kullanıcı onaylı, tartışmaya kapalı)

| # | Karar |
|---|---|
| 1 | WhatsApp kanalı = **Meta WhatsApp Cloud API (resmi)**. Bot için **yeni numara**; mevcut `0850 840 73 03` insan destek + admin ödeme linki için aynen kalır. |
| 2 | Fiyat **sunucuda** hesaplanır, AI sadece okur, pazarlık/indirim yapamaz. **Sipariş başına admin fiyat onayı yok.** |
| 3 | 3D model otomatik üretilir, ardından **admin panelinde tek tık onay** kapısı vardır. |
| 4 | Admin onayından sonra **müşteriye 360° video + "Onaylıyorum / Değişiklik iste / Vazgeç"** turu gider; baskı ancak müşteri onayıyla başlar. |
| 5 | Web `/create` arayüzü **aynen kalır**; sadece "admin GLB yükler" adımı otomatikleşir. Siteye AI sohbet balonu **eklenmez**. |
| 6 | 3D sağlayıcı = **Meshy, `ai_model: "meshy-7"`** (pinli, `latest` asla). |
| 7 | Faz sırası **0 → 1 → 2 → 3**. Meta numara/şablon tedariki Faz 1 ile **paralel** yürür. |
| 8 | **Yeniden fiyatlandırma önce yapılır** (tek beden `standart` 150 mm, sadece resin, hep `hand_painted`, ₺3.499). |
| 9 | Müşteriye **1 ücretsiz revizyon** hakkı. |
| 10 | Kapı temiz `pass` verip **48 saat** admin tıklamadıysa **otomatik onaylanır**, admin bilgilendirilir. `warn`/`fail` asla otomatik onaylanmaz. |
| 11 | e-Fatura stub'ı için **asgari dürüst düzeltme** yapılır (`pending` statüsü; gerçek `providerRef` olmadan `issued` yazmayı reddet). |

---

## 3. ÖLÇÜLMÜŞ GERÇEKLER (2026-08-27, canlı Meshy anahtarıyla)

Bu bölüm tahmin değil, ölçümdür. Tasarımın üç yeri bu ölçümler yüzünden değişti.

### 3.1 Hesap ve yetki
- Yerel `.env`'deki `MESHY_API_KEY` (`msy_…`, 40 karakter) **canlı**. `GET /openapi/v1/balance` → `{"balance": 3231}`.
- **`ai_model: "meshy-7"` kabul edildi** — dokümanlardaki "requires account entitlement" notu bu hesap için sorun değil.
- **`image_url` olarak 1,5 MB'lık `data:image/png;base64,…` kabul edildi.** Yani müşteri fotoğrafını
  herkese açık imzalı URL'den servis etmek **zorunda değiliz** — bugün prod'da fal.ai'a öyle veriliyor
  ve bu bir gizlilik açığı. Meshy bu açığı kapatmamıza izin veriyor.

### 3.2 `POST /openapi/v1/image-to-3d` (meshy-7) — gerçek ölçüm
```
girdi : public/examples/anime.png (stilize figür görseli), data URI
gövde : ai_model=meshy-7, should_remesh=true, topology=triangle, target_polycount=300000,
        enable_pbr=false, should_texture=false, image_enhancement=FALSE, moderation=true
süre  : 64,2 saniye      kredi : 20
çıktı : model_urls = { glb, fbx, usdz, obj, stl }
```
**`video_url` = null, `multi_view_thumbnails` = null.** Sadece tek bir `thumbnail_url` var.
⇒ **360° turntable videosunu kendimiz render etmek zorundayız.** Sentezdeki "Meshy'nin ücretsiz
4 PNG'lik multi-view albümü fallback olur" varsayımı **yanlış**; fallback tek bir PNG'dir.

### 3.3 `POST /openapi/v1/print/analyze` — ÜCRETSİZ, ~0,5 saniye
Şema: `printability.status` + `printability.metrics.{is_watertight, volume, non_manifold_edges,
degenerate_faces, holes}` + `issue_count` / `error_count` / `warning_count`. `consumed_credits: 0`.

### 3.4 EN ÖNEMLİ BULGU — meshy-7 ham çıktısı baskıya hazır DEĞİL

| Metrik | Ham meshy-7 | `print/repair` sonrası |
|---|---|---|
| `printability.status` | **error** | warning |
| `is_watertight` | **false** | **true** |
| `non_manifold_edges` | 416 | **0** |
| `holes` | 16 | **0** |
| `degenerate_faces` | 33.314 | 33.260 (değişmedi) |

`POST /openapi/v1/print/repair`: **6,1 saniye, 10 kredi**, yalnız `model_urls.glb` döndürür.

⇒ **Onarım bir kenar durum değil, VARSAYILAN yoldur.** Sipariş başına Meshy maliyeti
**20 değil 30 kredi** olarak planlanmalıdır. Sentezdeki "%20'sinde repair" varsayımı yanlıştır.

### 3.5 Onarılmış mesh — kendi araçlarımızla ölçüm (trimesh)
```
faces 303.484 · vertices 151.732
watertight True · is_volume True · winding_consistent True
bağlı bileşen sayısı: 1        (bu örnekte kopmuş uzuv yok)
degenerate oranı: 33.260 / 303.484 = %10,96   (sert red eşiği %25 → GEÇER)
trimesh'in saydığı sıfır-alanlı yüzey: 0      (Meshy'nin tanımı daha katı: sliver üçgenler)
```

### 3.6 KRİTİK HATA — eksen çevirimi (muhtemel kök sebep)

`scripts/process_mesh.py:21` `load_mesh()` **sahne grafiği dönüşümünü yok sayıyor**
(`scene.geometry.values()`'tan geometriyi doğrudan alıyor). Meshy GLB'si glTF standardı gereği
**Y-up**. Ama:
- `scale_to_target()` (satır 191) yüksekliği **Z ekseninden** ölçüyor: `bounds[1][2] - bounds[0][2]`
- `add_base()` (satır 213) kaide silindirini **Z = 0'ın altına** koyuyor

Ölçülen extents: `X 0.5433 · Y 1.9033 · Z 0.6586` → **en uzun eksen Y**.

Sonuç, ölçüldü:

| | bugünkü kod (Z'yi yükseklik sanıyor) | doğru eksen (Y) |
|---|---|---|
| bbox (mm) | `123,7 × 433,5 × 150,0` | `42,8 × 150,0 × 51,9` |
| 220×220×250 zarfı | **TAŞIYOR** | SIĞIYOR |
| hacim | 1.328 cm³ | 55,0 cm³ |

Eski Meshy boru hattı **tam olarak bu kodu** çalıştırıyordu: figürü 433 mm boyunda üretiyor ve kaideyi
figürün ayaklarına değil **sırtına** yapıştırıyordu. "Çıkan model baskıya uygun olmuyordu" şikâyetinin
en güçlü açıklaması budur ve **meshy-7 bunu düzeltmez** — bu bizim kodumuzda.

### 3.7 Duvar kalınlığı — 150 mm'de gerçek ölçüm
```
p1 = 0,78 mm      p5 = 1,53 mm       (1999 geçerli ışın)
reçine sert eşik 0,50 mm  → GEÇER
reçine güvenli eşik 0,90 mm → GEÇMEZ ⇒ THICKEN turu gerekir
```
⇒ **Thicken turu opsiyonel bir kurtarma değil, 150 mm'de NORMAL yoldur.** Doluluk oranı 0,165
(içi boş kabuk eşiği 0,02 → rahat geçer).

### 3.8 Bu ölçümlerin tasarıma etkisi
1. Sipariş başına Meshy bütçesi **30 kredi** (20 üretim + 10 onarım), 60 değil.
2. Turntable videosu **kendi render'ımız**; fallback tek `thumbnail_url`.
3. **Eksen düzeltmesi Faz 1'in ilk iş kalemidir** — kapı eşiklerini kalibre etmeden önce.
4. Uçtan uca üretim süresi ölçüldü: **~70 saniye** (64 s üretim + 6 s onarım) + kendi mesh işlememiz.
   15 dakikalık poll bütçesi fazlasıyla yeterli.
5. Tek örnek istatistik değildir. Faz 1 uygulanırken 10-20 gerçek fotoğrafla tekrarlanmalı.

---

## 4. Mimari

### 4.1 Kanal-bağımsız çekirdek

WhatsApp ikinci bir sipariş sistemi **değil**, mevcut sistemin ikinci klavyesidir. Her WhatsApp siparişi
de web `/create` akışının ürettiğiyle aynı `previews` + `order_drafts` satırıdır. Dolayısıyla
`promoteDraftToOrder` → `kickOffOrderProcessing` → 3D boru hattı → üretici ataması **tek kod yoludur**;
kanal dallanması yoktur.

```
                    ┌──────────────────┐         ┌──────────────────┐
   web /create ────►│  previews satırı │────────►│  order_drafts    │───► PayTR / havale
   WhatsApp ajanı ─►│  (fal.ai 2D ×2)  │         │  (fiyat sunucuda)│         │
                    └──────────────────┘         └──────────────────┘         ▼
                                                                    promoteDraftToOrder
                                                                              │
                                                              kickOffOrderProcessing
                                                                              │
              ┌───────────────────────────────────────────────────────────────┘
              ▼
     [model-generation kuyruğu]  Meshy image-to-3d (meshy-7, data URI, 20 kredi)
              │                  → print/analyze (0 kredi) → print/repair (10 kredi)
              ▼
     [mesh-processing kuyruğu]   eksen düzeltme → birleştirme → pymeshlab onarım
              │                  → 150mm ölçekleme → thicken → kaide → KAPI → turntable
              ▼
        orders.status = 'review'  ──[ADMİN tek tık | 48s otomatik]──►
        awaiting_customer_approval ──[müşteri: WhatsApp butonu / /onay/<token>]──► approved
              │                                                                      │
              └── 'Değişiklik iste' → review (1 ücretsiz)                            ▼
              └── 'Vazgeç' → rejected + iade görevi                          MEVCUT MAKİNE
                                                                     (üretici → QC → boya → kargo)
```

### 4.2 Durum makinesi

`orders.status` enum'una **tam olarak bir yeni değer**: `awaiting_customer_approval`.
Legacy `generating`, `processing_mesh`, `review`, `failed_generation`, `failed_mesh` değerleri
**yeniden kullanılır** (admin'in "problems" filtresi bunları zaten tanıyor).

| Geçiş | Aktör | Muhafız |
|---|---|---|
| `paid → generating` | `kickOffOrderProcessing` | `auto_model_enabled` ∧ `orderType='custom'` ∧ `previewId` ∧ `!uploadedModelId` ∧ `resolveTargetHeightMm().ok` ∧ `contentConsentVersion >= CONTENT_CONSENT_VERSION_MESHY` ∧ `reserveSpend()` ∧ bakiye ≥ `MESHY_MIN_CREDIT_BALANCE` |
| `paid → awaiting_model` | aynı fonksiyon | yukarıdakilerden **herhangi biri** false. **BUGÜNKÜ DAVRANIŞ = KILL SWITCH** |
| `paid → review` | aynı fonksiyon | `uploadedModelId` dolu (**değişmedi**) |
| `generating → generating` | `poll-task` | `PENDING\|IN_PROGRESS` ∧ `polls < 90`. Bloklu poll YOK — 10 sn gecikmeyle kendini yeniden kuyruğa atar |
| `generating → processing_mesh` | `poll-task` | `status='SUCCEEDED'` |
| `generating → failed_generation` | `poll-task` | `status='FAILED'` \| poll bütçesi doldu \| `reserveSpend` reddetti |
| `failed_generation → generating` | **ADMİN** | `model_generation_round < 2` ∧ `reserveSpend`. **Müşteri asla tetiklemez** |
| `processing_mesh → processing_mesh` | worker | `thicken` (≤1) veya `repair` (≤1) |
| `processing_mesh → review` | worker | hüküm `pass` \| `warn` \| `fail` — **üçü de `review`'a düşer** |
| `processing_mesh → failed_mesh` | worker | python exit≠0 \| 600 sn timeout |
| `review → awaiting_customer_approval` | **ADMİN tek tık** veya **48s otomatik (yalnız `pass`)** | `orderType='custom'` ∧ `modelGlbKey` ∧ `model_source='meshy_auto'`; enforce+fail ise `overrideGateFail=true` |
| `review → approved` | ADMİN | yukarıdakinin değili — marketplace/upload **birebir bugünkü davranış** |
| `awaiting_customer_approval → approved` | **MÜŞTERİ** | atomik `WHERE status='awaiting_customer_approval'`; `model:ok:<uuid>` butonu LLM'e **hiç uğramadan** deterministik router'da |
| `awaiting_customer_approval → review` | MÜŞTERİ | `model:revise:<uuid>`, 1 ücretsiz. **Otomatik yeniden üretim YOK** |
| `awaiting_customer_approval → rejected` | MÜŞTERİ | `model:cancel:<uuid>` → iade görevi (sözleşme md.117 hakkı) |
| `approved → … → delivered` | — | **DEĞİŞMEDİ** |

`assignableStatusGuard()` zaten `eq(orders.status,'approved')` kabul ettiği için üretici tarafına
tek satır dokunulmuyor.

### 4.3 Baskı kalite kapısı

**Aşama 1 — Meshy `print/analyze` (0 kredi):** çapraz kontrol. Tek başına asla geçirmez (§3.4'te
`is_watertight:true` ve 33 bin bozuk yüzeyli bir mesh yalnız `warning` alıyor). Yalnız iki karar için:
`metrics.volume <= 0` → anında sert red; ve onarım tetikleyicisinin yarısı.

**Aşama 2 — `process_mesh.py`, HAKEM BUDUR.** **Basılacak olan** mesh üzerinde: eksen düzeltme →
birleştirme → pymeshlab onarım → `scale_to_target(150mm)` → thicken → kaide **sonrası**.

**SERT RED** (`verdict='fail'`, herhangi biri):

| # | Kural | Gerekçe |
|---|---|---|
| 1 | `is_watertight !== true` | — |
| 2 | `is_volume !== true` | — |
| 3 | **`dropped_significant_component === true`** | `keep_largest_component()` kopuk kabukları siler; kopan kol/yay/kılıç sonrası mesh **mükemmel su geçirmez kalır**, su geçirmezliğe bakan her kontrol geçer, tek kollu figür kutudan çıkar. Python bunu **zaten hesaplıyor**, hiçbir TypeScript hiç okumadı |
| 4 | `component_count !== 1` (birleştirme sonrası) | — |
| 5 | `face_count < 15.000` | blob. Ölçüm: sağlıklı mesh 303k |
| 6 | `face_count > 400.000` | slicer'ı boğar |
| 7 | bbox ekseni `PRINT_ENVELOPE_MM {220,220,250}` aşımı | `prices.ts:242`'den **yeniden kullanılır** |
| 8 | `volume_cm3 / bbox_volume_cm3 < 0,02` | içi boş kabuk. Ölçüm: sağlıklı 0,165 |
| 9 | `base_added === false` | — |
| 10 | `meshy.metrics.volume <= 0` | — |
| 11 | `meshy.degenerate_faces / face_count > 0,25` | Ölçüm: 0,11 |
| 12 | thicken turundan **sonra** hâlâ `min_wall_p1_mm < 0,50` (resin) / `< 0,90` (filament) | — |

**UYARI** (`verdict='warn'` — geçer, admin kartında kırmızı rozet): `min_wall_p1_mm ∈ [0,50 – 0,90)` ·
`min_wall_p5_mm < 0,90` · Meshy `status='warning'` · `base_added_concatenate` (boolean fallback) ·
`merged_component_count > 1` (aksesuar kurtarıldı ama bilinsin) · ölçülen yükseklik hedeften %5+ sapma ·
`min_wall_*` hesaplanamadı.

**THICKEN** (`verdict='thicken'`, sipariş başına ≤1): `min_wall_p1_mm < 0,90` (resin) ∧ `!thicken_applied`
∧ 3/5/7'den sert red yok → `process_mesh.py --thicken-pass` ile yeniden, kapı baştan.
**§3.7'ye göre bu 150 mm'de NORMAL yoldur (p1 = 0,78 mm), istisna değil.**

**ONARIM** (`verdict='repair'`, sipariş başına ≤1, `round=1`): Meshy `status ∈ {error, warning}` ∧
(`is_watertight=false` ∨ `non_manifold_edges>0` ∨ `holes>0`) ∧ 3/5/7'den sert red yok.
Kopmuş uzuv / blob / zarf aşımı onarımla düzelmez → doğrudan `fail`'e kısa devre, 10 kredi tasarruf.
**§3.4'e göre bu da normal yoldur.** Doku zaten yok (`should_texture:false`), Retexture dalı hiç yok.

**BAŞARISIZLIK YOLU**
- `pass` \| `warn` → `review`, admin tek tık, yeşil/kırmızı rozet.
- `fail` + `PRINT_GATE_MODE='shadow'` (**VARSAYILAN**) → yine `review`, uyarı rozeti, admin normal onaylar.
  Her override `admin_actions.notes`'ta etiketli bir eğitim satırıdır.
- `fail` + `PRINT_GATE_MODE='enforce'` → yine `review` (`failed_mesh` değil — mesh var, admin bakabilir),
  ama approve route'u `overrideGateFail:true` + `overrideReason` ister ve kaydeder.
  **İnsan override'ı kaldırılmaz** (KVKK m.11/g: tamamen otomatik değerlendirmenin aleyhte sonucuna itiraz).
- python exit≠0 / 600 sn timeout → `failed_mesh`. Meshy FAILED / `moderation_blocked` → `failed_generation`.
- Admin'in üç çıkışı da mevcut: yeniden üret (`round ≤ 2`), elle GLB yükle (`upload-model`, **değişmedi**), reddet.

**HİÇBİR ŞEY MÜŞTERİYE YA DA ÜRETİCİYE KAPI GEÇMEDEN VE ADMİN (veya 48s otomatik) ONAYLAMADAN ULAŞMAZ.**

**TRIPWIRE:** 20 siparişlik kayan pencerede `fail` oranı **> %30** → alarm. Bu, "meshy-7 sorunu çözdü"
varsayımını aylarla değil **günlerle** test eden tek enstrümandır.

### 4.4 AI ajanı — fiyat kararı bir *argümanın yokluğu*

**Genel kural:** her tool `strict: true` + `additionalProperties: false` + tam `required`.
`conversationId` **hiçbir** tool'un argümanı değil (runner context'inden gelir → model yapısal olarak
başkasının konuşmasına yazamaz). Müşteriye görünen tek çıkış `emit_reply`. **Görseller modele vision
içeriği olarak hiç verilmez** (bir görsel bir metin kanalıdır ⇒ bir enjeksiyon kanalıdır; ajanın kararı
için fotoğrafın içeriği gerekmez, içerik taramasını Meshy `moderation:true` ücretsiz yapar).

| Tool | Döner | Yasaklar |
|---|---|---|
| `emit_reply({text ≤700, ui: enum})` | döngüyü bitirir | buton başlığı/id üretemez, medya ekleyemez, çoklu mesaj yollayamaz. `ui` kapalı küme, karşılığı `wa-flow.ts::renderUiBlock()`'ta sabit blok. **Sayı muhafızı:** metindeki her ₺ figürü o turda `quote_item`'ın döndürdüğü `formatted` kümesinde olmak zorunda |
| `get_catalog({})` | şablonlar, bedenler, kaplamalar, upsell'ler | **fiyat döndürmez** (fiyat tek yerden) |
| `quote_item({style, size, material, finish, upsells})` | `{amountKurus, formatted, breakdown}` | şemada `price`/`discount`/`amount`/`coupon` **alanı yok**; `UnpricedSizeError` → `needs_admin_quote`, ₺0'a düşemez |
| `save_photo({waMediaId})` | `{ok, photoIndex}` | storage key'i bile döndürmez. `photos/wa/<convId>/` altına yazılır (`/api/orders:371`'in `photos/` ön-ek doğrulaması için). ≤4 foto |
| `start_preview({styleSlug})` | `{previewId, etaSeconds}` | `photoKeys` argüman değil. `WHATSAPP_FREE_PREVIEW_ENABLED=0` **varsayılan kapalı** |
| `select_variation({index: 0\|1})` | `{ok}` | `previewId` argüman değil; keyfi url seçilemez |
| `parse_address({raw ≤1000})` | `{ok, address?, missing[], confidence}` | **DB'ye hiçbir şey yazmaz** — saf ayrıştırıcı. Önce deterministik (posta kodu regex, il/ilçe sözlüğü, `normalizePhone`) |
| `save_customer({fullName, email, address})` | `{ok}` \| `{error:'email_registered'}` | `allowExistingAccount` **geçemez** (yalnız admin) |
| `create_draft({})` | `{reference, payUrl, formatted}` | **SIFIR ARGÜMAN.** Tutar sunucuda `agent_order_specs`'ten `itemPriceKurus()` ile **yeniden** hesaplanır. `amount`/`discount`/`giftCardCode`/`paymentMethod`/`shippingAddress`/`contentConsent` şemada **yok**. İdempotent |
| `get_order_status({reference})` | `{status, statusLabelTr, trackingNumber?}` | **yalnız bu konuşmaya bağlı siparişler.** Eşleşmezse `not_found` — "yetkiniz yok" bile demez (8 karakterlik `FIG-` uzayı aksi hâlde numaralandırma oracle'ı; KVKK m.12 ihlali). Adres/tutar/e-posta/foto/model URL asla dönmez |
| `send_faq({topic: 12 elemanlı enum})` | sabit Türkçe metin + kanonik link | serbest metin üretmez. İade/cayma/KVKK metinleri modele yazdırılmaz |
| `request_human_handoff({reason, summary})` | `{ok}` | **her zaman izinli, asla hız-sınırlı, asla bütçe-bloklu** — güvenli eylem en ucuz eylem olmalı |

**Bilerek var olmayan tool'lar:** `approve_model` (baskıyı başlatan onay yalnız `model:ok:<uuid>` buton
payload'undan, LLM'e hiç uğramadan — cayma hakkı istisnasının dayanağı bir dil modelinin çıkarımına
bırakılamaz) · `record_consent` (KVKK rızası `/pay`'deki mevcut, sürümlü, IP'ye bağlanabilir
PayConsentGate'ten; modelin "tamam"ı yorumlaması açık rıza kaydı değildir) · `apply_discount` ·
`set_price` · `refund_order` · `cancel_order` · `change_order_status` · `assign_manufacturer` ·
`issue_gift_card` · `send_raw_message` · `upload_model` · `sql`/`http` kaçış deliği.

**Tur bütçesi (prompt değil, `break` deyimi):** tur başına ≤6 tool çağrısı, ≤2 tool hatası, 20 sn duvar
saati; konuşma başına 30 tur/24 saat. Kuyrukta `attempts: 1` — **bir LLM turu asla otomatik yeniden
denenmez** (retry token'ı yeniden harcar ve yan etkiyi kopyalayabilir); başarısızlık insana devirdir.

**Debounce, salt kilit değil:** `jobId='wa-agent:<convId>'`, `delay: 2500ms`; yeni mesajda `remove()` +
`add()`. 8 saniyede 3 mesaj atan müşteri **tek** ajan turu üretir ve üçünü birden görür. Salt Redis kilidi
2. ve 3. mesajı `attempts:1` ile sessizce düşürürdü — WhatsApp'ta bu kenar durum değil, insanların
yazma biçimidir.

**Model:** `claude-opus-5`, `thinking:{type:'adaptive'}`, `output_config:{effort:'low'}`,
`max_tokens: 1500`. Prompt caching: sabit system + tool tanımları, son `cache_control` breakpoint'i orada.
Ucuzlatma kolu: `WA_AGENT_MODEL=claude-haiku-4-5` (~5× ucuz), hacim gerektirdiğinde çevrilir.

---

## 5. Veri modeli

Tüm migration'lar **up/down çifti** (global kural). `meta/_journal.json`'a eklenmez (0042/0029 konvansiyonu).
Round-trip (up→down→up) lokalde doğrulanır.

### `0043_ops_spine` (Faz 0)
- `platform_flags(key PK, enabled bool, updated_at, updated_by)` — `auto_model_enabled`, `meshy_enabled`,
  `wa_bot_enabled`, `wa_agent_enabled`, `fal_enabled`. `fal_enabled` hariç hepsi `false` tohumlanır.
- `ai_spend_ledger(id, scope, scope_id, provider, reserved_cents, settled_cents, status, created_at)` — reserve→settle.
- `idempotency_keys(scope, key, status, response_json, expires_at, PK(scope,key))`.

### `0044_auto_model_pipeline` (Faz 1)
- `order_status` enum'una **`awaiting_customer_approval`** (`ALTER TYPE … ADD VALUE`; down'da enum
  değeri düşürülemez → down, değeri kullanan satırları `review`'a çeker ve sütunları düşürür, enum değeri
  ölü kalır; bu açıkça belgelenir).
- `orders`: `model_source text` (`'meshy_auto'|'admin_upload'`), `model_generation_round int default 0`,
  `model_turntable_key text`, `model_turntable_url text`, `model_approval_token text`,
  `customer_model_approved_at timestamptz`, `customer_model_revision_note text`.
- `order_model_approvals(id, order_id, revision, glb_key, turntable_key, shown_at, channel, decided_at,
  decision, ip, user_agent)` — **hukuki delil satırı.** Cayma hakkı istisnası bu satırla savunulur,
  `orders.status` ile değil: 2. tur üretim `orders` sütunlarının üzerine yazar ve 1. turda onaylananın
  kanıtı yok olur.
- `mesh_reports`: `meshy_printability jsonb`, `min_wall_p1_mm`, `min_wall_p5_mm`, `verdict text`,
  `verdict_reasons jsonb`, `thicken_applied bool`, `merged_component_count int`, `height_mm numeric`.
- `generation_attempts`: `credits int`, **`UNIQUE(order_id, round)`** — Meshy POST'undan **önce** turu
  sahiplenme. Repoda `dekont-ocr` dışında hiçbir kuyrukta `lockDuration` yok; pymeshlab tek vCPU'yu
  doyurup Node event loop'unu aç bıraktığında BullMQ'nun 30 sn varsayılan kilidi yenilenemez, job
  STALLED işaretlenip **yeniden çalıştırılır**. `jobId` bunu kurtarmaz (aynı job'ın yeniden koşusudur).
  Sahiplenme indeksi kurtarır: ikinci koşu satırı bulamaz, mevcut `provider_task_id`'ye yeniden bağlanır,
  **ikinci 20 kredilik task satın alınmaz.**

### `0045_whatsapp_channel` (Faz 2)
- `wa_conversations(id, phone_e164 UNIQUE, wa_id, mode, state jsonb, last_inbound_at,
  kvkk_notice_sent_at, blocked_at)` — `mode`: `bot|human|blocked`.
- `wa_messages(id, conversation_id, direction, wa_message_id, type, body, media_key, sent_at, status)`
  — `wa_message_id` üzerinde **kısmi UNIQUE**.
- `wa_inbound_events(id, event_hash UNIQUE, payload jsonb, received_at)` — tüm teslimat dedupe'u.
- `wa_status_events`, `wa_media_cache(local_key PK, meta_media_id, uploaded_at)` (Meta media id 30 gün yaşar).
- `orders.wa_conversation_id`, `order_drafts.channel text` (`'web'|'whatsapp'|'admin'`).
  **`attribution_channel` PAZARLAMA atfıdır** (bir Google Ads kampanyası da 'whatsapp' yazabilir);
  KVKK kapısının sert bir alana ihtiyacı var. Kural: `channel <> 'web' AND content_consent_at IS NULL
  ⇒ ödeme başlatılamaz`.

### `0046_agent_runtime` (Faz 3)
- `agent_runs(id, conversation_id, model, input_tokens, output_tokens, cache_read_tokens,
  cache_write_tokens, cost_cents, stop_reason, duration_ms, created_at)`.
- `agent_actions(id, run_id, tool, args_json, result_status, denied_reason, created_at)` —
  enjeksiyon/kötüye kullanım denemesi bir SQL sorgusudur, log grep'i değil.
- `agent_order_specs(id, conversation_id UNIQUE, spec jsonb, draft_id, created_at)`.

---

## 6. Fazlar

### Faz 0 — Zemin + yeniden fiyatlandırma · ~1 hafta
**Tek başına değeri:** WhatsApp veya Meshy'ye hiç dokunmadan bugün canlı olan iki para deliğini kapatır.
- `docs/superpowers/plans/2026-08-24-figur-yeniden-fiyatlandirma…` **Task 1-6** uygulanır: tek beden
  `standart` 150 mm, sadece resin, finish hep `hand_painted`, `FIGURINE_PRICE_KURUS = 349900`,
  açık `PAINTING_PORTION_KURUS = 100000`, `kucuk/orta/buyuk` → `LEGACY_SIZE_PRESETS` (görüntülenir,
  fiyatlanmaz). Bu, 60 mm duvar kalınlığı sorununu **tamamen ortadan kaldırır**.
- `docker-compose.production.yml`: `redis`'e `printer_redis:/data` volume + `--appendonly yes`
  (**bugün hiç volume yok** — bir container recreate her gecikmeli işi yok ediyor); `worker`'a
  `mem_limit: 2g` + healthcheck.
- `sentry.worker.config.ts` **yeni dosya** (repoda yalnız server + edge var); `workers/instrument.ts`
  `workers/start.ts`'in ilk satırında.
- `src/app/api/health/route.ts` yeni; `deploy.sh` ve `deploy.yml` curl hedefi kökten `/api/health`'e.
- `src/lib/services/flags.ts` + `platform_flags` (10 sn Redis TTL cache, env break-glass `AI_KILL_ALL=1`).
- `src/lib/services/spend-guard.ts` + `ai_spend_ledger` (`reserveSpend` **sağlayıcı çağrısından önce**).
- `src/lib/services/idempotency.ts`; `POST /api/orders`'a `Idempotency-Key` + `rateLimitAsync`
  (10/saat/IP, 5/saat/e-posta, 3/saat/userId).
- `POST /api/preview/[id]/regenerate`: **müşteri oturumu zorunlu** + rate limit + `reserveSpend('fal',8)`.
- `src/lib/config/sizes.ts`'e `resolveTargetHeightMm()` (`figurineSize` 0036'dan beri serbest metin ve
  `presetHeightMm` `!` non-null assertion kullanıyor → `"17,5 cm"` bir TypeError'dır).
- Tüm ağır kuyruklara açık `lockDuration` + `maxStalledCount: 1`.
- `deploy.yml` `upsert_env` listesine yeni sırlar (**doğrulandı:** listede olmayan anahtar ezilmiyor,
  hiç senkronize edilmiyor — `FAL_API_KEY`'in VPS'te elle durmasının sebebi bu).
- e-Fatura asgari düzeltmesi: `invoiceStatusEnum`'a `pending`, gerçek `providerRef` olmadan `issued` yok.

### Faz 1 — Otomatik 3D + baskı kapısı · ~2,5-3 hafta · **EN BÜYÜK KAZANIM**
**Tek başına değeri:** WhatsApp hiç yapılmasa bile web akışı tam çalışır. `auto_model_enabled=false`
bugünkü davranışı **bayt bayt** geri getirir (hiçbir kod yolu silinmiyor → regresyon riski sıfır).

1. **İLK İŞ: eksen düzeltmesi** (§3.6). `load_mesh()` sahne dönüşümünü uygulasın **veya**
   `scale_to_target()` en uzun ekseni yükseklik kabul edip mesh'i Z-up'a döndürsün. Kaide o eksene göre.
   Bir regresyon testi (`scripts/test-mesh-axis.ts`) Y-up bir GLB'nin doğru ölçeklendiğini kanıtlar.
2. `src/lib/services/meshy.ts` geri yazılır. `ai_model:'meshy-7'` **pinli**. Silinen dosyanın ayarlanmış
   değerleri korunur (`should_remesh:true`, `topology:'triangle'`, `target_polycount:300000`,
   `enable_pbr:false`, `should_texture:false`). **`image_enhancement: FALSE`** — varsayılanı `true` ve
   zaten stilize edilmiş bir fal.ai render'ına uygulanınca konuyu yeniden stilize eder: mesh kusursuz,
   kapı geçer, figür müşterinin çocuğu değildir; hiçbir metrikte görünmez. Girdi **data URI**
   (§3.1 — müşteri fotoğrafı herkese açık URL'e konmaz).
3. `print/analyze` (0 kredi) + `print/repair` (10 kredi) istemcileri. **Onarım varsayılan yoldur** (§3.4).
4. `scripts/process_mesh.py` genişletilir: `--height-mm` (zorunlu), `--material`,
   `min_wall_p1_mm` **ve** `min_wall_p5_mm`, `--thicken-pass`. `keep_largest_component()` korunur ama
   **öncesinde** `merge_components_by_volume()` çalışır: en büyüğün %2'sinden büyük her kabuk manifold3d
   boolean union ile birleştirilir (manifold3d zaten `requirements.txt`'te), yalnız gerçek zerreler atılır.
   `dropped_significant_component` artık **okunur**. `should_remesh` **değiştirilmez** (Faz 4 kolu —
   python'u düzeltip aynı anda API parametresini çevirmek, kalite düşerse atıf yapmayı imkânsız kılar).
5. `scripts/render_turntable.py` **yeni**: 24 kare, 400px, pyrender + `PYOPENGL_PLATFORM=osmesa`,
   ffmpeg → ~3 sn h264 mp4 (<2 MB), decimate edilmiş kopya üzerinde. `docker/Dockerfile` `base` stage'ine
   `libosmesa6`, `libosmesa6-dev`, `ffmpeg`; `requirements.txt`'e `pyrender`, `PyOpenGL`.
   **Fallback tek `thumbnail_url`'dür** (§3.2 — Meshy video/multi-view vermiyor).
6. `src/lib/services/mesh-runner.ts` **yeni** — repoda TypeScript↔Python köprüsü hiç yok.
   `/opt/venv/bin/python3` spawn, stderr BullMQ job log'una, 600 sn sert timeout + SIGKILL.
7. `src/lib/config/print-gate.ts` + `src/lib/services/print-gate.ts` — saf `evaluatePrintGate()`,
   `scripts/test-print-gate.ts` ile birim test.
8. `model-generation` + `mesh-processing` kuyrukları ve worker'ları. Poll **bloklu değil**:
   `poll-task` kendini 10 sn gecikmeyle yeniden kuyruğa atar (90 tur = 15 dk).
9. `src/lib/services/order-model.ts::attachOrderModel()` — `upload-model` route'undan çıkarılır;
   worker ve admin **aynı kodla** yazar. Aksi hâlde otomatik model revizyon arşivine görünmez olur.
10. `kickOffOrderProcessing` içinde tek dal (§4.2 muhafızları).
11. `POST /api/admin/orders/[id]/approve` **dallandırılır** — bugün koşulsuz `approved` + `unassigned`
    yazıyor, `order_approved` e-postası atıyor. Müşteri onaylamadan "Siparişiniz onaylandı" e-postası
    gitmesi kabul edilemez. Yeni: `requiresCustomerModelApproval(order)` ise hedef
    `awaiting_customer_approval`, e-posta `model_approval_request`, `manufacturerStatus`'a dokunulmaz.
12. `src/lib/services/model-approval.ts` + `/onay/[token]` sayfası. Token **ayrı** mintlenir
    (`orders.model_approval_token`) — `journeyToken` kutuya basılan karekodun tokenıdır, yeniden kullanılamaz.
13. 48 saat otomatik onay (yalnız `pass`) + SLA süpürgesi: DB tabanlı `upsertJobScheduler` 6 saatte bir
    (Redis silinse bile boot'ta yeniden kurulur; düz gecikmeli iş bunu yapmaz).
14. **Entegrasyon işleri:** `order-status-tracker.tsx`'e yeni adım (aksi hâlde tüm adımlar gri render
    edilir) · `tr.ts` **ve** `en.ts`'e tracker anahtarları (`en.ts` `Dictionary` tip kaynağı, eksikse
    `tsc --noEmit` düşer) · admin orders `needsAction` grubu + renk haritası · dashboard sayaçları ·
    `/api/files/[...path]`'e `.mp4` MIME (**bugün yok**) **ve** HTTP Range/206 (route CORS'ta Range
    ilan ediyor ama gövdede işlemiyor; `<video>` bunu ister).

### Faz 2 — WhatsApp kanalı, AI YOK · ~2 hafta kod + Meta tarafı 1-3 hafta (paralel)
**Tek başına değeri:** gerçek, imza doğrulamalı, dedupe'lu bir gelen kutusu; onay turu e-posta yerine
WhatsApp'tan turntable videosu + dokunmatik butonlarla. **LLM'e ait tek bayt yok ⇒ prompt-injection
yüzeyi yok.**
- Meta App + WABA + **yeni numara** kaydı. Numara WhatsApp Messenger/Business'ta **hiç** kullanılmamış
  olmalı (hata 133015). 0850 seçilirse gelen **uluslararası** çağrı kabul etmeli ve doğrulama araması bir
  **insana** düşmeli (IVR gezemez). Düşük riskli seçim: temiz mobil SIM. İki adımlı PIN sır deposuna
  (kaybı yeniden kaydı bloklar: 133005/133008/133009).
- `src/app/api/webhooks/whatsapp/route.ts` — PayTR webhook deseni. `runtime='nodejs'`. POST'ta **ilk iş**
  `await request.text()`: imza **ham baytlar** üzerinden `META_APP_SECRET` ile HMAC-SHA256;
  `request.json()` çağırmak imzayı geri dönülemez bozar. Bozuk imza → **401** (200 değil: 200 iş kuyruğa
  atar). **500 yalnız retry'ın gerçekten yardımcı olacağı durumda** (Redis/Postgres kesintisi) — mutlak
  "her zaman 200" bir DB kesintisinde müşterinin mesajını kalıcı yok eder.
  `value.metadata.phone_number_id` eşleşmeyen yükler atılır (webhook'lar hesap geneli).
- **Dedupe üç bağımsız katman:** `wa_inbound_events.event_hash` UNIQUE + `wa_messages.wa_message_id`
  kısmi UNIQUE + BullMQ `jobId = wamid`. Hepsi `ON CONFLICT DO NOTHING RETURNING` ile —
  **23505 yakalanmaz**, çünkü drizzle 0.45 pg kodunu `.cause`'a saklıyor (gift-cards'taki kontrol bu
  yüzden zaten latent bozuk, bkz. `drizzle-error-wrapping` notu).
- `src/lib/services/whatsapp-send.ts` — `graph.facebook.com`'a dokunan **tek** modül, yalnız
  `whatsapp-outbound` worker'ından. Ürettiğimiz her medya Meta'ya **yüklenip `id` ile** gönderilir,
  `link` ile değil (birinin çocuğunun fotoğrafı Meta'nın fetcher'ına imzalı URL olarak verilmez; media id
  30 gün yaşar ⇒ yeniden gönderim bedava). Buton sayısı ≤3, başlık ≤20 karakter **derleme zamanında**
  assert edilir.
- 24h penceresi **gönderim anında** kontrol edilir (kuyruğa atma anında değil) ve pencere kapalıysa
  onaylı şablona çevrilir. Admin'in 03:00'te, müşterinin son mesajından 30 saat sonra onaylaması
  **normaldir**; bu, tasarımın parayı sessizce tutmasının en olası yoludur.
- 3 Türkçe **UTILITY** şablonu: `figur_model_onay_v1` (video header + 3 quick-reply),
  `figur_odeme_linki_v1`, `figur_kargo_bildirim_v1`. **MARKETING kategorili hiçbir şablon yapılmaz** —
  konuşma yeniden başlatma şablonu ETK 6563 m.6 uyarınca ticari elektronik iletidir.
- Butonlar: `model:ok:` / `model:revise:` / `model:cancel:`. Başlıklar: "Onaylıyorum"(11),
  "Değişiklik iste"(15), "Vazgeç"(6). **Üçüncü buton zorunludur:** sözleşme md.117 "önizleme onayı
  verilmeden ve üretim başlamadan önce sipariş ücretsiz iptal edilebilir" diyor ve
  `awaiting_customer_approval` tam olarak o penceredir.
- `/admin/whatsapp` gelen kutusu (`PanelShell` + SSE). `mode`: bot/human/blocked. `human` iken bot
  **tamamen susar**; `bot`'a dönüş **yalnız admin tıklamasıyla** — asla otomatik, asla zamanlayıcıyla
  (bir şikâyetin ortasında botu sessizce yeniden kurmak, şikâyeti bir Tüketici Hakem Heyeti dosyasına çevirir).
- İlk gelen mesaja otomatik KVKK aydınlatma yanıtı + "bu sohbete bir yapay zekâ asistanı yanıt veriyor,
  dilediğiniz an temsilci yazın". `wa_conversations.kvkk_notice_sent_at` bunu kanıtlar.

### Faz 3 — AI satış ajanı · ~2 hafta
**Tek başına değeri:** müşteri "merhaba" der, ~4 dakika sonra elinde ödeme linki olur.
`wa_agent_enabled=false` her an Faz 2'nin insan gelen kutusuna **veri kaybı olmadan** düşer.
- `npm i @anthropic-ai/sdk`; `wa-agent` kuyruğu (concurrency 4, limiter 30/60s, **attempts: 1**).
- `src/lib/agent/runner.ts` — **manuel tool-use döngüsü**: her tool çağrısından önce
  kill switch → spend reserve → idempotency → `.strict()` şema → çalıştır → `agent_actions` denetim satırı.
- `src/lib/agent/output-guard.ts` — §4.4'teki sayı muhafızı; ayrıca IBAN, indirim dili ve
  `NEXT_PUBLIC_APP_URL`/`wa.me` dışı origin taşıyan URL reddedilir.
- `src/lib/services/wa-order.ts::createWhatsAppDraft()` — **`/api/orders`'ı çağırmaz.** O route'un
  draft-insert bloğu çıkarılamaz: `attributionColumns`'u `@/lib/analytics/attribution-server`'dan alıyor
  ve o dosya repodaki gerçek tek `import "server-only"` → standalone Node worker'ı çökertir
  (bkz. `worker-server-only-trap`, 470bf22). Bunun yerine `buildDraftReference` /
  `resolveOrCreateGuestUser` / `itemPriceKurus` doğrudan process içinde; `/api/admin/orders/create`
  zaten ikinci bir draft yazarı olduğunun kanıtı.

### Faz 4 — Kalibrasyon, SLA'lar ve uyum kapanışı · ~1 hafta + sürekli
- `PRINT_GATE_MODE` `shadow` → `enforce`, **ancak ~50 gerçek siparişte yanlış-red oranı ölçüldükten sonra**.
- Tripwire tetiklenirse merdiven: (1) `previews.back_image_url` + `backViewPrompt()` diriltilip
  `multi-image-to-3d`'ye geçilir (sütun ve endpoint **zaten var**, migration gerekmez),
  (2) onarım/thicken bütçesi artırılır, (3) `should_remesh` tek başına ölçülür,
  (4) `auto_model_enabled=false` — yalnız deploy kaybedilir, müşteri değil.
- **Üretici kabul SLA'sı**: `assignment-sla.worker.ts:13` bugün yalnız `[SLA]` bayrağı koyuyor
  ("This flags them; it deliberately does NOT revoke automatically"). Otomatik yeniden atama politikası
  burada — aksi hâlde bir insan adımını kaldırıp önüne iki tane koymuş oluruz.
- `/admin/ops`: kuyruk derinlikleri, 24 saatlik servis bazlı harcama, kapı geçme oranı, ajan devir oranı,
  WhatsApp teslim/hata oranları, `printer_uploads` disk doluluğu.
- **Disk retention**: sipariş başına ham GLB + STL + mp4 + ara PNG kareler paylaşılan volume'a yazılıyor;
  `preview-cleanup` bugün 30 günde çalışıp üretilen varyasyon PNG'lerini **hiç silmiyor**.
- `preview-generation` kuyruğunun iki ön yüz arasında yeniden bütçelenmesi (ayrı kuyruk ya da açık
  öncelik) — aksi hâlde bir WhatsApp patlaması ölçülen web `/create` hunisini aç bırakır.
- Saklama: `wa_inbound_events` 30 gün, WhatsApp medya 90 gün, `wa_messages`/`agent_runs`/`agent_actions`
  **25 ay** (TKHK m.12 ayıplı mal 2 yıl + pay; 12 ay **yanlıştır** — kendi kanıtımızı, kendi aleyhimize,
  sınırlama süresi dolmadan silmek olur).

---

## 7. Güvenlik ve bütçe

**LLM fiyat / statü / iade kararı veremez — üç kat yapısal, sıfır prompt talimatı:**
1. **Fiyat: argümanın yokluğu.** `create_draft({})` sıfır argüman. Tutar `createWhatsAppDraft()` içinde
   `itemPriceKurus()` ile **yeniden** hesaplanır — `quote_item`'ın hesabından bağımsız ikinci bir
   hesaplama, dolayısıyla halüsine bir fiyat `order_drafts.amountKurus`'a hayatta ulaşamaz.
   Üçüncü kat: `guardOutboundText()`.
2. **Statü: LLM'in ulaşabildiği hiçbir tool `orders.status` yazmaz.** Tek yol deterministik buton
   router'ı (LLM'den **önce**, kapalı id kümesi + sahiplik kontrolü).
3. **İade: tool yok.** `model:cancel:` butonu bir admin görevi yaratır, bir iade **yapmaz**.

**Tavanlar** (hepsi reserve-**önce**-çağrı): `AI_SPEND_DAILY_CAP_CENTS` (5.000 ≈ $50/gün; %80'de alarm,
%100'de ilgili bayrak **otomatik kapanır**, yalnız elle geri açılır) · `AI_SPEND_CONVERSATION_CAP_CENTS`
(60) · `AI_SPEND_ORDER_CAP_CENTS` (150) · `AI_SPEND_PHONE_DAILY_CAP_CENTS` (100) ·
`MESHY_MAX_CREDITS_PER_ORDER` (60) · `MESHY_DAILY_CREDIT_CAP` · `MESHY_MIN_CREDIT_BALANCE`.
Bakiye task oluşturmadan **önce** sorulur; altındaysa sipariş `awaiting_model`'e (bugün çalışan elle yol)
gider ve admin'e alarm düşer. **Ödeme almış bir boru hattı elle yola bozulmalı, hata e-postasına değil.**

**Kill switch:** `platform_flags` tablosu (Postgres kalıcılık + denetim izi), 10 sn Redis cache,
`/admin/ops`'tan tek tık; env break-glass `AI_KILL_ALL=1`.
**.env düzenleyip VPS'te yeniden deploy etmek bir acil durum kolu değildir.**

**Kabul edilen sınır:** anahtar çevrildiğinde uçuşta olan Meshy task'ları tamamlanır ve faturalanır.

**Kötüye kullanım duruşu:** ajan ödemeden **önce** sıfır ücretli üretim tetikler
(`WHATSAPP_FREE_PREVIEW_ENABLED=0`). Düşman bir kullanıcı tek bir fal/Meshy senti harcatamaz;
dayatabileceği tek maliyet Claude token'ıdır ve o da konuşma/telefon/global olarak tavanlıdır.

---

## 8. Maliyet

Ölçülmüş birim: **Meshy 30 kredi/sipariş** (20 üretim + 10 onarım — §3.4'e göre onarım varsayılan yol).
⚠️ Kredi başına USD **türetilmiş** bir sayıdır ($20/1.000 = $0,02); resmî per-credit figürü hiçbir
dokümanda yok → **canlı abonelik sayfasından doğrulanmalı.**

| Kalem | WhatsApp siparişi | Web siparişi |
|---|---|---|
| Claude ajanı (~12 tur) | $0,30 | — |
| fal.ai 2 varyasyon | $0,078 | $0,078 (bugün de harcanıyor) |
| Meshy 30 kredi | $0,60 | $0,60 |
| `print/analyze` ×2 | $0,00 | $0,00 |
| WhatsApp (service ücretsiz + ~2 UTILITY şablon) | $0,015 | $0,007 |
| **TOPLAM** | **≈ $0,99 ≈ ₺45** | **≈ $0,69 ≈ ₺31** |

**Otomatik 3D'nin gerçek marjinal maliyeti sipariş başına ~₺27** (gerisi zaten harcanıyor).
₺3.499 yeniden fiyatlandırmada platform payı ≈ ₺1.225 (`src/lib/services/finance.ts:12` doğrulandı:
*"Platform keeps `commissionRateBps`; the manufacturer is paid the remainder"* ⇒ %35 platformun payıdır)
⇒ AI maliyeti WhatsApp siparişinde **%3,7**, web siparişinde **%2,5**.

---

## 9. Canlıya çıkmadan kapatılacak hukuk kalemleri

| # | Kalem | Ne zaman |
|---|---|---|
| 1 | **KVKK m.9 standart sözleşme.** Haziran 2024'ten beri açık rıza yalnız **arızi** aktarımlar için geçerli dayanak. Her siparişte yüz fotoğrafı göndermek rutin çekirdektir. Meta Platforms Ireland, fal.ai, Meshy, Anthropic ile standart sözleşme + **5 iş günü içinde Kurum'a bildirim**. Kod işi değil, tedarik+evrak işi; teslim süresi WhatsApp numarasıyla kıyaslanabilir. | Faz 1 başlar başlamaz |
| 2 | **`content-consent.tsx` amaç metni.** Bugün "stilize **görsel üretimi** için" diyor; açık rıza "belirli bir konuya ilişkin" olmak zorunda (KVKK m.3) ⇒ 2D için verilmiş rıza 3D mesh üretimini ve WhatsApp taşımasını **kapsamaz**. Metin genişletilir + `CONTENT_CONSENT_VERSION_MESHY` bump'ı + **sürüm yordamı** (`kickOffOrderProcessing` muhafızına `contentConsentVersion >=` şartı; eski sürümlüler `awaiting_model`'e). | Faz 1'den önce |
| 3 | **Mesafeli Satış Sözleşmesi tadili:** 3D 360° görüntünün onaylanacak artefakt olduğu · onay kanalları · **1 ücretsiz revizyon** · azami onay süresi 14 gün ve süre sonu politikası · md.117 ücretsiz iptal hakkının `awaiting_customer_approval` ekranında **butonu**. Bugünkü hâl (var olmayan bir 3D kapısını vaat etmek) iki durumun kötüsü. | Faz 1'den önce |
| 4 | **Gizlilik politikası.** Kullanılmayan **AWS S3** ve **Resend** çıkar (gerçekte local FS + nodemailer); Meta, fal.ai, Meshy, Anthropic girer; m.9 dayanağı yazılır; WhatsApp'ta bir AI'ın yanıt verdiği ve **her zaman insan talep edilebildiği** açıklanır. | Faz 2'den önce |
| 5 | **Saklama vaadi uzlaştırması.** Politika 90 gün diyor; `preview-cleanup` 30 günde çalışıp üretilen varyasyon PNG'lerini **hiç silmiyor**. Ya worker düzeltilir ya metin — **işleyici listesiyle aynı PR'da**. | Faz 2'den önce |
| 6 | **İlk temas aydınlatması.** Müşteri fotoğrafı gönderdiği anda Meta İrlanda onu zaten işlemiştir; tek gerçek azaltma toplama noktasındadır ⇒ Business Profile + ilk mesaja otomatik KVKK m.10 yanıtı (ziyaret edilmemiş bir sayfaya link değil). | Faz 2 |
| 7 | **ETK 6563 / İYS.** `src/app/ticari-ileti/page.tsx` bugün "onaylar İYS'ye iletilir" diyor — **bu ifade bugün yanlış**. Karar: Faz 2'de **yalnız UTILITY** şablon; MARKETING yok. Meta'nın şablon kategorisi ile hukuki kategori **aynı şey değildir**. | Faz 2 |
| 8 | **Kalıcı veri saklayıcısı.** Ön bilgilendirme formu + sözleşme, ödeme sonrası **PDF döküman mesajı** olarak aynı sohbete. **Sentetik e-posta adresi kullanılmaz** — kimsenin kontrol etmediği adrese teslim, teslim değildir. | Faz 2 |
| 9 | **Kargolanmadan önce şikâyet kanalı.** `dispute/route.ts` önce `getSessionUser()` ile 401 veriyor, sonra `['shipped','delivered']` kontrolü ⇒ **misafir müşteri (WhatsApp alıcısının tam olarak olacağı şey) hiçbir statüde şikâyet açamıyor.** Referans+telefon doğrulamalı, `paid`'den itibaren açık bir yol. | Faz 2 |
| 10 | **KVKK m.11 başvuru / silme ucu.** `src/app/api/customer/` altında hiç yok. m.7/2 silme talebinin **aktarılan her tarafa** iletilmesini, m.13 30 günlük cevap süresini şart koşuyor. Bu tasarım dört aktarımcı ekliyor. | Faz 3 |
| 11 | **Rollback yordamı.** Sürüm kayması: `migrate` biter, yeni app healthcheck'i düşer, deploy **imajı** geri alır — DB'de yeni enum değeri ve satırlar kalır. Rollback prosedürüne `.down.sql`'in **elle** çalıştırılması açıkça yazılır. | Faz 0 |

---

## 10. Açık riskler

1. **Tek örnek istatistik değildir.** §3'teki tüm ölçümler **bir** görselden. Faz 1'in ilk işi 10-20
   gerçek müşteri fotoğrafıyla tekrarlamak olmalı; özellikle `dropped_significant_component` oranı.
2. **Kredi başına USD doğrulanmadı** — tüm birim ekonomi türetilmiş bir sayıya dayanıyor.
3. **Kapı eşikleri kalibre edilmedi.** 0,50/0,90 mm, 15k yüz, %2 doluluk, %25 degenerate — biri ölçüldü
   (§3.5, §3.7), gerisi mühendislik kanaati. `shadow` modu azaltmadır ama yanlış-red oranı yüksek çıkarsa
   admin'in yükü azalmaz ve Faz 1'in değer önerisi zayıflar.
4. **Thicken turu kanıtlanmadı.** pymeshlab offset'inin parmakları/silahı/saç tellerini görsel olarak
   bozmadan kalınlaştırıp kalınlaştıramayacağı ölçülmedi — ve §3.7'ye göre bu **normal yol**.
   Kalınlaştırılan mesh müşterinin onayladığı 2D görselden görünür şekilde saparsa, çözüm sorunun kendisi olur.
5. **OSMesa / pyrender bu yığının en az kanıtlanmış parçası.** GPU'suz `node:20-slim`'de yazılım render'ı;
   base imajda bugün ne `libosmesa6` ne `ffmpeg` var. Ve §3.2'ye göre **Meshy fallback'i tek bir PNG**.
   OSMesa istikrarsız çıkarsa dürüst hamle tek PNG'yi varsayılan yapıp videoyu sonraya bırakmaktır.
6. **Tek process patlama yarıçapı.** `workers/start.ts` 9 → 12 worker; yenilerden ikisi (mesh-processing +
   turntable) sistemin en bellek-aç işi, Postgres **aynı host'ta**. Faz 0'daki `mem_limit` + healthcheck +
   Sentry çöküşü görünür kılar; gerçek çözüm worker'ı ikiye bölmektir ve bellek profili **ölçülene kadar**
   bilinçli olarak erteleniyor.
7. **Aşağı akıştaki insan darboğazı dokunulmadan kalıyor ve ilk üç faz onu kötüleştiriyor.** Bir insan
   adımı (admin'in heykel yapması) kalkıyor, önüne **iki bekleme** giriyor (admin tıklaması + müşteri onayı).
   **Müşterinin uçtan uca beklediği süre kısalmayabilir.** Faz 4 ele alıyor ama daha erken ölçülmeli.
8. **`users.phone` tekil değil, indekssiz, serbest metin.** Web'de "0532 123 45 67" ile sipariş verip
   "+905321234567"den yazan müşteri **iki kimliktir**. Yazarken `normalizePhone` uygulanıyor ama geçmiş
   veri için backfill tasarlanmadı ⇒ `get_order_status` bazı meşru eski siparişler için `not_found` döner.
9. **Bot numarası bir tedarik riski, kod riski değil** (bkz. Faz 2). En uzun teslim süreli kalem.
10. **Şablon onayı kritik yolda.** `figur_model_onay_v1`, 24h penceresi dışında Faz 1'in onay turunun
    taşıyıcısıdır ve Meta'nın saatiyle işler. **WABA yaratıldığı gün sunulmalı**, kod hazır olduğu hafta değil.
11. **Meta'nın 20 karakterlik buton başlığı sınırı Türkçe'de** bayt mı karakter mi belgesiz. Seçilen
    başlıklar güvenli tarafta ama ilk şablon gönderimiyle ampirik doğrulanmalı.
12. **Ajan konuşma maliyeti modellendi ama ölçülmedi** (~$0,30, 12 turluk ortalama varsayımı).
    İlk 100 konuşmadan sonra yeniden ayarlanmalı.

---

## 11. Doğrulama

- `tsc --noEmit` (de facto doğruluk kapısı) + `npm run lint` + `npm run test:unit`.
- `scripts/test-print-gate.ts` — kapı hükmü birim testleri (saf fonksiyon).
- `scripts/test-mesh-axis.ts` — Y-up bir GLB'nin doğru ölçeklendiğinin regresyon testi (§3.6).
- `scripts/check-meshy.ts` — atılabilir task; anahtar, `meshy-7` yetkisi, süre, kredi, `print/analyze`.
- Her migration için up→down→up round-trip lokalde.
- Faz 1 kabul kriteri: 10-20 gerçek fotoğrafla uçtan uca koşu; kapı hükümlerinin dağılımı raporlanır.
