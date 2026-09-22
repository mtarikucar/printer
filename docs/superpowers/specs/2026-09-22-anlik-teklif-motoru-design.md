# Anlık Teklif Motoru (Xometry paritesi) — Tasarım (2026-09-22)

> Kaynak: xometry.com.tr + get.xometry.com.tr gerçek tarayıcıyla tarandı (test küpü
> yüklendi; hesap açılmadı). Figurunica kodu HEAD `5a46616` üzerinde 7 paralel
> okuyucu + eksiksizlik eleştirmeni ile incelendi (özetler bu dosyanın sonundaki
> "Kaynak notları"nda). Bu belge hem tasarım hem uygulama sözleşmesidir.

## Amaç

Xometry'nin Anlık Fiyat Motoru'nun (IQE) 3D baskıya düşen bütün müşteri akışını
Figurunica'ya kazandırmak:

1. Müşteri tek teklife **20 parçaya kadar** STL / OBJ / 3MF yükler (sürükle-bırak,
   hesapsız).
2. Her parça kuyrukta analiz edilir: **render görseli ("fotoğraf")**, 3D önizleme,
   ölçüler, hacim/alan, duvar kalınlığı, gövde sayısı, üretilebilirlik (DfM) uyarıları.
3. Müşteri parça başına teknoloji, malzeme, renk, yüzey işlemi, katman, doluluk,
   adet, birim ve ölçek seçer; teklif düzeyinde teslim kademesi (Ekonomik / Standart
   / Ekspres) ve sertifika/ek hizmet ekler. **Fiyat her değişiklikte anında yenilenir.**
4. **Fiyatı görmek için hesap zorunludur** (Xometry gibi): fiyat alanları sunucu
   tarafında hiç gönderilmez; kayıt/giriş modalı fiyatı açar.
5. Teklif belgesi (yazdır/PDF), paylaşım linki, PO numarası, notlar, teklif sohbeti,
   süre/yenileme, manuel teklif, yüksek hacim (RFQ), hedef fiyat teklifi, parça
   kütüphanesi ve yeniden sipariş.
6. Ödeme → **tek sipariş** (N parça, `orderModelFiles`), mevcut hakediş / otomatik
   atama / QC / anlaşmazlık altyapısı değişmeden çalışır.

## Kullanıcı kararları (2026-09-22)

| Soru | Karar |
|---|---|
| Süreç kapsamı | **Yalnız 3D baskı** (FDM + SLA ile açılış; katalogdan yeni teknoloji eklenebilir) |
| Hedef kitle | **Bireysel + kurumsal**: bireye KDV dahil, kurumsal müşteriye ek olarak KDV hariç görünüm, PO, fatura bilgileri, proforma |
| Fiyat kapısı | **Xometry gibi hesap zorunlu**; yükleme, görsel, ölçü ve DfM hesapsız görünür |
| Yaklaşım | **A**: `quotes` / `quote_parts` birinci sınıf varlık; eski `/create?path=upload` + `upload-quotes` akışının yerini alır (tek fiyat yolu) |
| Yürütme | "Plan doğru görünüyorsa gerçekleştir" — aşağıdaki sahip kararları varsayılanlarla alındı, hepsi admin ayarından değiştirilebilir |

## Sahip kararları (varsayılan olarak alındı, geri alınabilir)

1. **Karışık teknoloji (FDM + SLA aynı teklifte):** teklifte serbest; sipariş
   tek üreticiye gider, ranker iki teknolojiyi de beyan etmiş üreticiyi arar, yoksa
   mevcut `[ATAMA]` admin notu ile manuel atama. Arayüz uyarır ve **"Teknolojiye
   göre ayır"** eylemi parçaları yeni bir teklife taşır.
2. **Sertifika/ek hizmet geliri:** işi üretici yaptığı için **üretim kalemi**.
3. **Havale indirimi (%3):** teklif siparişlerine de uygulanır (sitedeki politika ile
   tutarlı). Ayar: `havaleDiscountApplies`.
4. **Hediye kartı:** v1'de teklif ödemesinde **yok** (rezervasyon mantığı yalnız
   diğer oturumun düzenlediği `api/orders` içinde satır içi; kopyalamak para
   riskli). Belgelendi, sonraki faz.
5. **Paylaşım linki:** salt okunur; fiyatlar yalnız giriş yapmış izleyiciye.
6. **Saklama:** siparişe dönmeyen tekliflerin dosyaları, süre dolumundan **90 gün**
   sonra silinir (ayar).
7. **Kayıt modalı şifreli** (mevcut `/api/auth/register`). Şifresiz hesap açmak,
   doğrulanmamış e-postaya oturum vermek olurdu → başkasının tekliflerini okuma riski.
8. **Boyalı / özel yüzey:** anlık fiyat verilmez → manuel teklif; admin boyama payını
   sipariş sonrası mevcut `add-painting` ile ayırır.
9. **Teklif belgesi:** sunucu tarafı yazdırılabilir A4 HTML (`/teklif/[no]/belge`),
   tarayıcıdan "PDF olarak kaydet". `pdfkit` bir devDependency; route handler'da
   kullanmak standalone derlemede riskli.

## Kapsam dışı (gerekçeli)

| Xometry özelliği | Neden |
|---|---|
| CNC, sac metal, kalıplama, döküm; diş/havşa/yüzey pürüzlülüğü/ISO 2768 | Kullanıcı 3D baskıyla sınırladı |
| STEP / SLDPRT / IPT gibi yerel CAD formatları | OpenCascade (~100 MB) bağımlılığı; ayrı faz. Arayüz "STEP'i STL/3MF olarak dışa aktarın" der |
| X-Points sadakat puanı, promosyon kodu | Para/iade akışları diğer oturumun Faz 6 değişikliklerinde açık; ayrı faz |
| Teamspace (ekip rolleri) | Sahiplik modelini tüm hesap sayfalarında değiştirir; ayrı faz |
| SOLIDWORKS / Fusion eklentileri, PunchOut (Ariba/Coupa) | Masaüstü/ERP ürünleri |
| Çoklu para birimi | Figurunica yalnız TRY |
| Framework (çerçeve) anlaşmalar, planlı sevkiyat | Tekrarlayan kurumsal tedarik; RFQ ile manuel karşılanır |
| Kartta ön provizyonlu hedef fiyat | PayTR ön provizyon akışı yok; hedef fiyat admin onayından sonra ödenir |
| CMM ölçüm raporu | Ağda CMM beyan eden üretici yok |

## Mimari özet

```
/3d-baski (landing, SEO)            /teklif/[T-000123] (çalışma alanı)
   │ dosya bırak                        │  SSE + 3 sn poll (anonim)
   ▼                                    ▼
PUT/POST /api/uploads/chunk ──► staging (sahip bağlı: user|anon)
   │
POST /api/quotes  ──► quotes (+pricing_snapshot)  POST /api/quotes/[id]/parts
   │                                                  │ promote + validate (3MF zip)
   │                                                  ▼
   │                                 BullMQ "quote-part-analysis"
   │                                 scripts/analyze_quote_part.py
   │                                 → report.json, thumb.png→webp, preview.glb, canonical.stl
   ▼
presentQuote(viewer)  ◄── saf fiyat/DfM modülleri (quote-pricing, quote-dfm, quote-units, business-days)
   │   (fiyat alanları yalnız canSeePrices)
   ▼
POST /api/quotes/[id]/checkout ──► order_drafts (orderType 'upload') + quote_checkouts(parts_snapshot)
   │  PayTR / havale (mevcut /pay, webhook, dekont OCR)
   ▼
promoteDraftToOrder (DOKUNULMAZ) → kickOffOrderProcessing (order-confirm.ts)
   │  linkQuoteToOrderTx → quotes.order_id, status review
   ▼
BullMQ "quote-order-files" → ölçekli STL'ler models/<orderId>/ → attachOrderModelFilesTx(source 'customer_quote')
   ▼
admin onay → autoAssign (ranker: tüm teknolojiler + polimer etiketleri) → üretici "Parça listesi" → QC → kargo
```

## Veri modeli (migration `0064_instant_quotes`)

Tüm yeni tablolar `schema.ts` sonuna tek blok olarak eklenir. `orders` /
`order_drafts` tanımlarına **dokunulmaz**; bağ `quote_checkouts.draft_id` ve
`quotes.order_id` üzerinden kurulur. Durum/tür kolonları `text + CHECK`
(pg enum'a değer eklemek down migration'da geri alınamaz — ev kuralı).
Aşağıdaki tablolarda "timestamp" yazan her kolon `timestamp with time zone`
olarak yazılır (0061/0062 ev örneği; geçerlilik/iş günü hesapları için güvenli tip).
Tablolardaki CHECK listesi asgaridir: spec metninde geçen değer kuralları
(ör. `support_factor ≥ 1`, `colors en az 1`) ayrı adlandırılmış CHECK'lere dönüşebilir.

### Katalog

**`print_technologies`**
| kolon | tip | not |
|---|---|---|
| id | uuid pk | |
| key | text unique, CHECK `^[a-z0-9_]{2,32}$` | `fdm`, `sla` |
| name, description | text | |
| order_material | text CHECK IN (`resin`,`filament`) | `orders.material` eşlemesi |
| capability_tag | text | `material_filament` / `material_resin` |
| build_x_mm, build_y_mm, build_z_mm | integer | baskı hacmi |
| min_wall_mm, min_feature_mm | double | DfM |
| tolerance_text | text | "±%0,5 (en az ±0,5 mm)" |
| layer_options_um | jsonb int[] | FDM [100,200,300], SLA [50,100] |
| default_layer_um | integer | |
| infill_options_pct | jsonb int[] \| null | FDM [15,20,30,50,100]; null = katı |
| default_infill_pct | integer \| null | FDM 20; SLA null |
| shell_mm | double | FDM kabuk kalınlığı (efektif hacim) |
| setup_fee_kurus | integer | parça satırı başına bir kez |
| machine_rate_kurus_per_hour | integer | |
| throughput_cm3_per_hour | double | |
| height_hours_per_mm | double | Z yüksekliği süresi |
| min_unit_price_kurus | integer | birim taban |
| base_lead_days | integer | iş günü |
| active, sort_order, created_at, updated_at | | |

**`print_materials`**: id, technology_id → print_technologies (restrict), key (uniq
per technology), name, description, properties jsonb (`{tensileMpa?, elongationPct?,
heatDeflectionC?, flexible?, transparent?, uses?: string[]}`), density_g_cm3,
price_kurus_per_gram, support_factor (≥1), capability_tag text null (`pmat_<slug>`),
colors jsonb `[{key,name,hex,surchargeKurus}]` (en az 1), lead_days_extra, active,
sort_order, timestamps.

**`print_finishes`**: id, technology_id null (null = tümü), key (uniq), name,
description, fixed_kurus (birim başı), per_cm2_kurus (birim başı × alan),
lead_days_extra, requires_manual boolean (boyalı/özel → manuel),
cost_line_kind text CHECK IN (`production`,`painting`), active, sort_order, timestamps.

**`print_addons`** (sertifika / rapor / hizmet, teklif düzeyi): id, key uniq, name,
description, price_type CHECK IN (`fixed`,`per_part`,`per_unit`), price_kurus,
lead_days_extra, active, sort_order, timestamps.

**`quote_pricing_settings`** (tek satır, `id = 1` CHECK): qty_breaks jsonb
`[{minQty, discountBps}]`, lead_tiers jsonb `[{key, name, multiplierBps, daysDelta,
minDays}]` (key ∈ economy|standard|express), min_order_kurus, max_auto_total_kurus,
max_auto_qty_per_part, max_parts_per_quote (20), max_file_bytes (100 MB),
quote_valid_days (30), retention_days_after_expiry (90), price_break_quantities jsonb
int[] ([1,5,10,25,50,100]), holidays jsonb string[] (ISO tarih), cutoff_hour (14),
havale_discount_applies boolean, updated_at, updated_by.

**`print_catalog_changes`** (denetim): id, entity text CHECK IN
(`technology`,`material`,`finish`,`addon`,`settings`), entity_id uuid null, action
CHECK IN (`create`,`update`), admin_email, before jsonb, after jsonb, created_at.
Her katalog yazımı ile **aynı işlemde**.

**Seed** (up içinde `ON CONFLICT DO NOTHING`, down tohumları sabit anahtarlarıyla
kaldırır): FDM (PLA, PETG, ABS, TPU 95A; renkler), SLA (Standart reçine, Dayanıklı
reçine, Esnek reçine; renkler), yüzeyler (Ham/destek alınmış, Zımparalı, Astarlı,
Boyalı-RAL [manuel], Özel [manuel]), ek hizmetler (Uygunluk sertifikası, Standart
ölçüm raporu, Malzeme veri sayfası, RoHS beyanı), ayar satırı (2026–2027 TR resmi +
dini tatilleri; dini bayram tarihleri Diyanet takvimiyle admin tarafından doğrulanmalı).

### Teklif

**`quotes`**
| kolon | not |
|---|---|
| id uuid pk | |
| seq integer GENERATED ALWAYS AS IDENTITY unique | |
| number text GENERATED ALWAYS AS (`'T-' \|\| lpad(seq::text, greatest(6, length(seq::text)), '0')`) STORED unique | yarış yok; 6 haneye kadar `lpad(seq::text, 6, '0')` ile birebir aynı, 7+ hanede KESMEZ (düz `lpad` `seq=1234567`'yi `T-123456`'ya kırpıp `seq=123456` ile çakışırdı). `formatQuoteNumber`'ın `padStart(6)`'sı ile aynı çıktı |
| user_id → users null | |
| anonymous_id text null | yalnız `user_id IS NULL` iken geçerli |
| status text CHECK IN (`draft`,`needs_review`,`quoted`,`ordered`,`expired`,`cancelled`) | |
| review_kind text null CHECK IN (`manual`,`rfq`,`target_price`) | |
| review_note, review_requested_at, reviewed_at, reviewed_by_email | |
| title text null | proje adı |
| lead_tier text CHECK IN (`economy`,`standard`,`express`) default `standard` | |
| addon_keys jsonb string[] default `[]` | |
| customer_note, po_number | |
| invoice_type CHECK IN (`individual`,`corporate`) default individual; company_name, tax_id, tax_id_type CHECK IN (`vkn`,`tckn`), tax_office, billing_address jsonb | B2B |
| pricing_snapshot jsonb not null, snapshot_taken_at | aktif katalog + ayarlar |
| version integer not null default 1 | her değişiklikte +1 |
| total_kurus integer null, lead_days integer null | liste/rapor önbelleği (fiyatlanamıyorsa null) |
| expires_at timestamp not null | oluşturma + valid_days; yeniden fiyatlama uzatır |
| share_token text unique null | nanoid(32) |
| terms_accepted_at, terms_version | tasarım hakkı / yasaklı ürün / üreticiyle paylaşım onayı (ilk yüklemede) |
| order_id → orders unique null | |
| source_quote_id → quotes null | yeniden teklif soyu |
| expiry_reminder_sent_at, abandoned_reminder_sent_at | |
| created_at, updated_at | |

İndeksler: (user_id, created_at desc), (anonymous_id), (status, review_requested_at).

**`quote_parts`**
| kolon | not |
|---|---|
| id uuid pk, quote_id → quotes (restrict), sort_order | |
| name text | müşteri yeniden adlandırabilir |
| file_name, source_key, source_format CHECK IN (`stl`,`obj`,`3mf`), source_bytes bigint, source_sha256 | |
| upload_id text unique null | staging talebi tekilliği |
| analysis_status CHECK IN (`queued`,`analyzing`,`ready`,`failed`), analysis_attempt int, analysis_error text | |
| geometry jsonb null | **dosya birimlerinde**: volume, area, extents{x,y,z}, bodyCount, isWatertight, isVolume, volumeEstimated, faceCount, wallP1, wallP5, overhangArea, sourceUnits, objectCount |
| canonical_stl_key, preview_glb_key, thumbnail_key | |
| units CHECK IN (`mm`,`cm`,`in`) default mm; scale double default 1 (0.01–100) | |
| technology_key, material_key, color_key, finish_key text; layer_um int null; infill_pct int null | anahtarlar teklifin snapshot'ına bakar (FK değil) |
| quantity int CHECK 1–100000 | |
| note text | "Ek üretim gereklilikleri" |
| drawing_key, drawing_name | teknik çizim PDF |
| critical_tolerance boolean | true → manuel |
| dfm_ack_key text null | onaylanan uyarı kümesinin özeti |
| manual_unit_price_kurus int null, manual_price_key text null, manual_priced_at, manual_priced_by_email | hash = geometri sha + konfig + teslim kademesi; değişince geçersiz |
| target_unit_price_kurus int null | müşterinin hedef fiyatı |
| deleted_at null | yumuşak silme (worker yarışı) |
| files_purged_at null | saklama süpürücüsü |
| created_at, updated_at | |

**`quote_checkouts`**: id, quote_id → quotes, draft_id → order_drafts **unique**,
quote_version, amount_kurus, parts_snapshot jsonb (dondurulmuş parça tanımları:
ad, dosya anahtarları, teknoloji/malzeme/renk (ad+hex)/yüzey adları, katman, doluluk,
adet, mm ölçüler, hacim, birim fiyat, satır toplamı, çizim anahtarı, DfM uyarıları),
addons_snapshot jsonb, lead_tier, lead_days, created_at. Kısmi benzersiz indeks yok
(taslak durumu `order_drafts`'ta); canlı taslak kontrolü sorguyla.

**`quote_messages`** (teklif sohbeti): id, quote_id, sender CHECK IN
(`customer`,`admin`), sender_user_id, sender_email, body, attachment_key,
attachment_thumbnail_key, read_by_admin_at, read_by_customer_at, flagged, created_at;
indeks (quote_id, created_at).

**`quote_admin_actions`**: id, quote_id (restrict), quote_part_id null, action CHECK
IN (`manual_price`,`target_accept`,`target_counter`,`target_reject`,`review_reject`,
`extend_expiry`,`reopen`), admin_email, reason not null, before jsonb, after jsonb,
created_at.

### Down migration

`0064_instant_quotes.down.sql`: tek `DO $$` bloğu; `SET LOCAL lock_timeout`; sahip
tabloları `LOCK`; **çalışma zamanı tablolarının herhangi birinde satır varsa**
(`quotes`, `quote_checkouts`, `quote_parts`, `quote_messages`, `quote_admin_actions`,
`print_catalog_changes`) `RAISE EXCEPTION '0064 rollback refused: …'` (kullanıcı ve
operatör verisini asla silmez); yoksa bağımlılık sırasına göre `DROP TABLE IF EXISTS`
(katalog tohumları tabloyla gider); journal satırını `created_at = <when>` ile siler.
Idempotent. Round-trip testi: up ×2, dolu DB'de down reddi, down ×2, up.

Operasyonel sonuç (runbook'a yazılır, Faz 7.1): `print_catalog_changes` bir denetim
tablosudur ve **tek bir admin katalog düzenlemesi** 0064'ü bu script'le geri
alınamaz yapar. Geri alma yine de isteniyorsa operatör denetim satırlarını bilerek ve
kaydını alarak kendisi siler (`DELETE FROM print_catalog_changes;`), sonra down'ı
yeniden çalıştırır; script bunu kendiliğinden yapmaz.

## Saf çekirdek modüller (`src/lib/config/`, `server-only` YOK)

### `quote-units.ts`
`unitFactor(units)` (mm 1, cm 10, in 25.4); `scaledGeometry(geometry, units, scale)`
→ mm cinsinden `volumeMm3 = v·s³`, `areaMm2 = a·s²`, `extentsMm = e·s`, `wallP1Mm`;
`suggestUnits(geometry, maxBuild)` sezgisi: 3MF `sourceUnits` varsa tartışma yok, o.
Aksi hâlde öneri YALNIZ "sayılar şüpheli derecede küçük" durumunda verilir — en büyük
boyut < 10, yani mm okunursa parça 1 cm'in altında kalır: inç yorumu `maxBuild`'e
sığıyorsa `in`, sığmıyorsa cm yorumu sığıyorsa `cm`, ikisi de sığmıyorsa `null`.
Baskı hacmini AŞAN parçaya birim ÖNERİLMEZ (`unitFactor(cm|in) > 1`; cm/inç parçayı
küçültmez, büyütür): sığmayanın çözümü birim değil ölçektir, bkz. `too_large.fitScale`.

### `quote-pricing.ts`
Girdi: snapshot, parça (geometri + konfig), teklif (lead tier, addons).

1. `s = unitFactor × scale`; ölçekli V (cm³), A (cm²), boyutlar (mm).
2. **Efektif hacim**: `infill_options` varsa (FDM) `shell = min(V, A × shell_mm/10)`,
   `eff = shell + (V − shell) × infill/100`; yoksa (SLA) `eff = V`.
3. Malzeme: `gram = eff × density × support_factor`; `matCost = gram × pricePerGram`.
4. Süre: `z = min(boyutlar)` (en düşük yükseklik yönü); `layerK = default_layer/layer`;
   `hours = (eff / throughput + z × height_hours_per_mm) × layerK`;
   `machineCost = hours × rate`.
5. Yüzey: `fixed + A × per_cm2`; renk ek ücreti.
6. `unitBase = max(matCost + machineCost + finish + color, min_unit_price)`.
7. Adet indirimi: `qty_breaks`'ten `bps` → `unitDisc = unitBase × (10000 − bps)/10000`.
8. `U = ceil(((setup + unitDisc × q) / q) × tier.multiplierBps / 10000)`;
   **`line = U × q`** (birim × adet her zaman satıra eşit).
9. Manuel fiyat geçerliyse (`manual_price_key === hash(part, tier)`) `U = manual`.
10. Teklif: `parts = Σ line`; addons (fixed / per_part × parça / per_unit × Σq);
    `minOrderTopUp = max(0, min_order − (parts + addons))` ayrı satır;
    `total = parts + addons + topUp` (KDV dahil). KDV hariç = `computeKdv(total, 2000)`.
11. `priceBreaks(part)` = `price_break_quantities` için U.
12. Tüm aritmetik tamsayı kuruş; ara değerler `Math.ceil` ile yukarı. Toplam asla
    ayrı yuvarlanmaz.

Çıktı: `{unitKurus, lineKurus, breakdown{material, machine, finish, color, setup,
qtyDiscountBps, tierBps}, priceBreaks[], hours, grams}` ve teklif
`{partsKurus, addonsKurus, minOrderTopUpKurus, totalKurus, kdv{subtotal,kdv}, leadDays}`.

### `quote-dfm.ts`
`evaluateDfm(part, snapshot, settings) → {issues: [{code, severity, params}], autoPriceable, needsAck}`

| kod | şiddet | kural |
|---|---|---|
| analysis_failed | error | analiz başarısız |
| no_volume | error | hacim ölçülemedi |
| not_watertight | warning | onarım sonrası hacim tahmini |
| too_large | error | sıralı boyutlar > sıralı baskı hacmi (öneri: sığan teknoloji / ölçek) |
| too_small | error | en büyük boyut < 2 mm |
| thin_walls | warning | wallP1 < min_wall |
| multiple_bodies | warning | gövde > 1 |
| qty_over_auto | error | adet > max_auto_qty_per_part → RFQ |
| total_over_auto | error (teklif) | toplam > max_auto_total → RFQ |
| finish_manual | error | yüzey `requires_manual` |
| tolerance_manual | error | critical_tolerance |
| config_invalid | error | anahtar snapshot'ta yok/aktif değil, katman/doluluk teknolojiye uymuyor |

Error varsa ve geçerli manuel fiyat yoksa parça anlık fiyatlanmaz ("Manuel teklif
iste"). Warning'ler ödemeden önce onay ister (`dfm_ack_key`). Türkçe mesajlar
`instantQuote.dfm.*` sözlük anahtarları.

`too_large` parametreleri: `{maxX, maxY, maxZ}` seçili teknolojinin baskı hacmi;
`fitsTechnology` (yalnız varsa) aynı parçanın SIĞDIĞI başka teknoloji anahtarı;
`fitScale` **mutlak ölçek** — parçanın sığması için `config.scale` alanına yazılacak
değer: `floor2(config.scale × min(sıralıBaskı[i] / sıralıMm[i]))`. Aşağı yuvarlanır ki
önerilen ölçek her zaman gerçekten sığsın. ÇARPAN DEĞİLDİR: arayüz mevcut ölçekle
çarpmaz, doğrudan ATAR (`config.scale = 1` iken ikisi aynı değeri verir, bu yüzden
karıştırılması kolaydır). 2 basamakta 0'a düşüyorsa parametre hiç yazılmaz.

### `business-days.ts`
`addBusinessDays(start, n, holidays, cutoffHour)` — İstanbul saatiyle; hafta sonu ve
tatiller atlanır; cutoff sonrası verilen sipariş ertesi iş gününden sayılır.
`leadDays(quote)` = max(parça günleri: tech.base + material.extra + finish.extra) +
max(addon extra) → kademe: `max(tier.minDays, base + tier.daysDelta)`.

### `quote-policy.ts`
`quoteStatusPermissions(quote, {hasLiveDraft, now})` → `{canEdit, canCheckout,
canRequestReview, canClaim, blockedReason}`; `checkoutReadiness(computed)` →
eksik liste (analiz bekliyor, error, onaysız warning, süre doldu, fiyat yok, limit).

Uygulama adı `checkoutBlockers(computed, parts, {termsAccepted, expired})`; boş dizi =
teklif ödenebilir. Ürettiği Türkçe cümleler ve sırası: (1) parça yok — tek başına
döner, (2) süre doldu, (3) N parçanın analizi sürüyor, (4) N parça manuel fiyat
bekliyor (analizi süren parçalar burada sayılmaz), (5) "Fiyat hesaplanamadı" — bu
cümle `!allPriced` için YAKALAYICIDIR ve yalnız (3) ile (4) boşken yazılır: aynı sorun
müşteriye iki kez anlatılmaz, (6) N parça için uyarı onayı eksik, (7) toplam tutar
anlık teklif sınırını aşıyor (`ComputedQuote.quoteIssues` içindeki `qty_over_auto`
`{reason:"total"}` — yukarıdaki tablonun `total_over_auto` satırının karşılığı),
(8) mesafeli satış sözleşmesi onayı.

### `quote-present.ts`
**Tek serileştirici** `presentQuote(quote, parts, computed, viewer)`; `viewer =
{canSeePrices, canEdit, isOwner, isShare, isAdmin}`. `canSeePrices=false` iken
çıktıda **hiçbir fiyat anahtarı yok** (tip düzeyinde ayrı `PublicQuoteView`). Sayfa
RSC props'u, `GET /api/quotes/[id]`, SSE sonrası yeniden çekme, belge sayfası ve
e-postalar bunu kullanır. Paylaşım görünümünde imzalı GLB/kaynak URL yok, yalnız
küçük resim.

### `quote-number.ts`, `quote-hash.ts`
`formatQuoteNumber`, `parseQuoteNumber`; `partConfigHash(part, tier)` (sha256).
`formatQuoteNumber(seq) = 'T-' + String(seq).padStart(6, '0')` — 7+ hanede kırpma YOK;
`quotes.number` generated kolonu (bkz. Teklif tablosu) birebir aynı çıktıyı verir.

## Yükleme ve analiz

- **Anonim staging:** `/api/uploads/chunk` (temiz dosya) `anonymous_session` çerezi
  olan ziyaretçiye açılır: IP başına + anonim kimlik başına oran limiti, günlük bayt
  kotası; `PUT` sırasında sahip Redis'e yazılır (`upload-owner-<id>` =
  `u:<userId>` | `a:<anonId>`, 24 sa); beklenen `size` alınır, `POST` aşarsa 413.
  Mevcut çağıranlar (admin/üretici/ürün) etkilenmez.
- **Doğrulama:** yeni `quote-model-validation.ts` (paylaşılan `UPLOAD_MODEL_FORMATS`
  değişmez): STL/OBJ mevcut kurallar; **3MF** = ZIP başlığı, EOCD, ZIP64 reddi, merkezi
  dizin (≤10k girdi) `[Content_Types].xml` + `3D/*.model`, şifreli giriş reddi, yöntem
  0/8, zip-bomb koruması (toplam ≤1,5 GB, oran ≤1000:1). `chunked-upload.ts`'e
  `readStagedRange`.
- **Limitler:** dosya ≤ `max_file_bytes` (100 MB), teklif başına ≤ 20 parça
  (`quotes FOR UPDATE` altında sayılır), `upload_id` unique.
- **Script** `scripts/analyze_quote_part.py <input> <fmt> <outdir>`: `process_mesh`
  yardımcılarını (load/repair/decimate/wall) ve `render_turntable`
  (`simplify/render_frame/write_png`) kullanır. **Ölçüm tam çözünürlükte, dosya
  biriminde, ölçeksiz**; kabuklar birleştirilmez/atılmaz. Çıktılar: `report.json`,
  `thumb.png` (512², 3/4 izometrik, pozitif yükseklik açısı), `preview.glb`
  (≤200k yüz, Y-up), `canonical.stl` (binary, orijinal geometri, onarımsız; OBJ/3MF
  dönüştürülür). `RLIMIT_AS` koruması; >2,5M yüzde duvar ölçümü atlanır.
- **Worker** `quote-part-analysis` (yeni `src/lib/queue/quote-queues.ts`; kirli
  `queues.ts`'e dokunulmaz): concurrency 1, kilit 300 sn, 2 deneme; koşullu
  güncellemeler (`WHERE analysis_status='analyzing' AND deleted_at IS NULL`); PNG →
  WebP (sharp); `emitQuotePartChanged`; 5 dk'da bir `queued`'da takılanları yeniden
  kuyruğa alan zamanlayıcı. İş kimliği tire ile (`quote-part-analysis-<id>-r<n>`).
- **Gerçek zamanlı:** `topics.quote(id)`, olay `{kind:"quote_part", quoteId, partId,
  status}` (fiyat/geometri taşımaz); `/api/realtime/quote/[id]` (sahip/anonim çerez
  erişimi); istemci SSE + analiz sürerken 3 sn poll.

## Erişim ve fiyat gizleme

| izleyici | okuma | düzenleme | fiyat |
|---|---|---|---|
| sahip (oturum.userId = quote.userId) | ✓ | ✓ (kilit yoksa) | ✓ |
| anonim çerez (quote.userId NULL ∧ anonymous_id eşleşir) | ✓ | ✓ | ✗ |
| paylaşım token'ı `?t=` | ✓ salt okunur, küçük resim | ✗ | yalnız giriş yapmışsa |
| admin | ✓ (admin API) | admin eylemleri | ✓ |
| diğer / T-numarası tahmini | 404 | | |

**Talep (claim):** `POST /api/quotes/[id]/claim` → `UPDATE … SET user_id = oturum
WHERE id = ? AND user_id IS NULL AND anonymous_id = çerez`. Link sahibi olmak asla
talep hakkı vermez. Kayıt/giriş sonrası çalışma alanı talebi otomatik yapar.

## Müşteri arayüzü

- **`/3d-baski`** (landing, index'lenir): başlık + sürükle-bırak (teklif açar →
  `/teklif/T-…`), "Nasıl çalışır" 4 adım, **teknoloji karşılaştırma tablosu**
  (katalogdan: baskı hacmi, teslim, min duvar, tolerans, "₺X'den başlayan"), malzeme
  özetleri, gizlilik ("dosyalarınız yalnız atanan üretim ortağıyla paylaşılır"), SSS,
  `Service` JSON-LD. DB okumaları `.catch` (CI'da DB yok). Bayrak kapalıyken admin
  olmayan ziyaretçiye "Yakında".
- **`/3d-baski/malzemeler`**: malzeme kütüphanesi (özellikler, renkler, kullanım
  alanları, başlangıç fiyatı).
- **`/teklif/[number]`** (noindex): başlık (numara, proje adı, PO, paylaş, belge,
  sohbet), "Teklife parça ekle" alanı + sayfanın her yerine bırakma, **Hepsini seç** +
  toplu işlem (konfig uygula, sil), teknolojiye göre gruplanmış parça kartları:
  küçük resim ("fotoğraf"; tıklanınca ölçülü 3D görüntüleyici), yeniden adlandır,
  mm ölçüler, birim + ölçek, analiz ilerlemesi, konfig özeti + "Özellikleri düzenle"
  paneli (teknoloji, malzeme, renk örnekleri, yüzey, katman, doluluk, adet, not,
  teknik çizim, kritik tolerans), DfM uyarıları + onay kutusu, fiyat (birim, satır,
  **adet kademe tablosu**) ya da girişsiz "–₺–,––", çoğalt/sil. Sağ panel: teslim
  kademesi seçici (tarih + fiyat), sertifikalar, "N parça (M adet)", ara toplam, ek
  hizmet, asgari tamamlama, **KDV dahil / hariç** anahtarı, "Ücretsiz kargo",
  "Ödemeye geç", "Manuel teklif iste", "Hedef fiyat öner", teklif notu. Girişsizken
  **fiyat kapısı modalı** (Kayıt ol / Giriş yap sekmeleri: ad, e-posta, telefon, şifre,
  ticari ileti izni, KVKK notu, Google).
- **`/teklif/[number]/odeme`**: çatallanmış ödeme formu (`quote-checkout-form.tsx`;
  kirli `checkout-form.tsx`'e dokunulmaz): adres, ödeme yöntemi, fatura türü
  (bireysel/kurumsal: unvan, VKN/TCKN `parseTaxId`, vergi dairesi, fatura adresi), PO,
  sözleşme onayları (mevcut sürümler; `personalized` cayma istisnası).
- **`/teklif/[number]/belge`**: yazdırılabilir A4 teklif belgesi / proforma (IBAN,
  referans, PO, parçalar, küçük resimler, geçerlilik).
- **Hesap:** `/account/teklifler` (liste), `/account/parcalar` (parça kütüphanesi:
  sha256 ile tekilleştirilmiş, "Yeni teklife ekle", "Yeniden teklif al"). Kullanıcı
  menüsü + mobil menü bağlantıları (kirli `account/page.tsx`'e dokunulmaz).
- Sözlük: yeni `instantQuote.*` önek bloğu `tr.ts` + `en.ts` **dosya ortasına**.

## Teklif yaşam döngüsü

- `draft` → (müşteri "manuel teklif iste" / "RFQ" / "hedef fiyat") → `needs_review`
  → (admin fiyatlar) `quoted` (süre: şimdi + valid_days) → ödeme → `ordered`.
  `quoted` iken müşteri düzenlerse `draft`'a döner; değişmeyen parçaların manuel fiyatı
  hash eşleştiği sürece geçerli kalır.
- Anlık fiyatlanabilir `draft` doğrudan ödenebilir (Xometry gibi).
- **Kilit:** teklife bağlı canlı taslak (`pending`/`awaiting_review`) varsa teklif salt
  okunur; "Ödeme bekleniyor" + `/pay/<ref>` bağlantısı. Kart taslakları için **her
  zaman** `card-expire` işi kuyruğa alınır (terk edilen iframe teklifi sonsuza dek
  kilitlemesin).
- **Süre dolumu:** saatlik iş `expires_at` geçmiş `draft/quoted/needs_review`'u
  `expired` yapar; müşteri "Yeniden fiyatla" ile yeni snapshot + yeni süre alır
  (manuel fiyatlar düşer).
- **Katalog değişimi:** açık teklifler kendi snapshot'ıyla bağlayıcıdır; çalışma
  alanı "Katalog güncellendi — yeniden fiyatla" bandı gösterir.
- `version` her değişiklikte artar; ödeme `expectedVersion` + `expectedTotalKurus` ile
  gelir, uyuşmazlık 409.

## Özel teklif türleri

- **Manuel (review_kind=manual):** anlık fiyatlanamayan parça (büyük, boyalı, kritik
  tolerans, analiz hatası) → admin parça başı birim fiyat girer.
- **Yüksek hacim / RFQ (rfq):** adet veya toplam eşiği aşınca otomatik önerilir;
  müşteri teslim planı + not + ek dosya (çizim) ile gönderir; admin 24–48 sa içinde
  parça bazlı fiyatlar.
- **Hedef fiyat (target_price):** müşteri parça başına hedef birim fiyat girer; admin
  kabul (manuel fiyat = hedef) / karşı teklif / red (gerekçeli). Kabul/karşı teklif →
  `quoted`; ödeme normal akış.
- Tümü `quote_admin_actions` denetimi + e-posta + uygulama içi bildirim + admin rozeti.

## Ödeme → sipariş

**`POST /api/quotes/[id]/checkout`** → `quote-checkout.ts`:
1. Oturum zorunlu + sahiplik; `withIdempotency({scope:"quotes.checkout"})`; oran limiti.
2. İşlem: `quotes FOR UPDATE`; canlı taslak varsa **aynı referansı döndür**; politika
   (süre, durum, hazır olma, onaylar); fiyatı snapshot'tan **sunucuda yeniden hesapla**;
   `expectedVersion`/`expectedTotalKurus` uyuşmazsa 409; `MAX_AMOUNT_KURUS`.
3. `order_drafts` insert: `orderType 'upload'`, `uploadedModelId null`, `material` =
   baskın teknolojinin `order_material`, `finish 'raw'`, `quantity = Σ adet`,
   `productTitleSnapshot "Teklif T-000123 (N parça)"`, `amountKurus = total`,
   `productionBaseKurus = total`, `paintingPriceKurus 0`, `upsells null`,
   `selectedAddons null`, tüm onay kolonları, havale son tarihi / PayTR merchant oid,
   attribution.
4. `quote_checkouts` insert (parts_snapshot dondurulur).
5. İşlem sonrası: kart → `createPaytrToken` (tek satır sepet) + `card-expire` işi;
   havale → indirim (ayar açıksa), hatırlatma/son tarih işleri, talimat e-postası.
   Yanıt şekli `/api/orders` ile aynı (`iframeUrl` | `redirectUrl`).

**Sipariş bağlama (`order-confirm.ts` `kickOffOrderProcessing`, temiz dosya):**
`linkQuoteToOrderTx(tx, {orderId, draftId})` (yeni `quote-order.ts`, `server-only`
yok): `quote_checkouts.draft_id = order.draftId` → `quotes.order_id` (yalnız NULL iken;
farklı sipariş bağlıysa `[ÇİFT ÖDEME]` admin notu, hata atmaz), `status 'ordered'`;
sipariş `review`'a alınır (yükleme siparişi gibi). İşlem sonrası
`quote-order-files` işi kuyruğa. **`promoteDraftToOrder` ve PayTR webhook'una teklif
kodu girmez.**

**Dosya bağlama işi:** her parça için ölçek faktörü 1 ise `canonical.stl` hardlink/
kopya, değilse binary STL float32 × s akışla ölçeklenir →
`models/<orderId>/P01_<ad>_x<adet>.stl`; `attachOrderModelFilesTx` (mevcut
`attachOrderModelFiles`'tan çıkarılır, tek yazma yolu korunur) `source
'customer_quote'`, tek revizyon; idempotent (revizyon varsa atla). 5 dk'lık kurtarma
taraması (siparişe bağlı ama dosyasız teklif siparişleri). Onay rotası dosyasız teklif
siparişini reddeder. İlk ekleme atamadan önce olduğu için `notifyOrderModelRevision`
çağrılmaz.

## Üretici ve admin sipariş yüzeyleri

- **Ranker:** `ManufacturerScoringOrder.requiredMaterials` (varsayılan
  `[order.material]` → mevcut siparişler aynen skorlanır; testler deep-equal),
  teklif siparişinde parçaların teknolojilerinden; `manufacturerSupportsAllMaterials`;
  polimer etiketleri (`pmat_*`) esnek kural (hiç `pmat_*` beyan etmeyen her polimeri
  basar sayılır). `orderHasPrintableContent`'e **dokunulmaz** (dosyalar `modelStlKey`
  yazar).
- **Kapasite:** `orders.quantity = Σ adet` → mevcut ağırlıklı yük kuralı.
- **Üretici sipariş sayfası:** "Parça listesi" (küçük resim, ad, teknoloji, malzeme,
  renk, yüzey, katman, doluluk, adet, mm ölçü, çizim indirme), "N parça · M adet",
  teslim kademesi + kargoya teslim tarihi rozeti; müşteri fiyatları gösterilmez.
  Okunamazsa `productionGateClosed`.
- **Admin sipariş sayfası:** "Teklif" kartı (numara, PO, fatura bilgileri, parçalar,
  `/admin/teklifler/[id]` bağlantısı); para dökümünde `"quote"` türü (parça satırları
  + ek hizmet + asgari tamamlama; Σ = amountKurus).
- `download-upload` bağlantıları `uploadedModelId` varlığına bağlanır (teklif
  siparişinde 404 vermesin).
- **QC:** foto üst sınırı parça sayısına göre `min(24, max(6, parça+2))`.

## Admin

- **`/admin/baski-katalogu`**: sekmeler Teknolojiler / Malzemeler (renk düzenleyici)
  / Yüzey işlemleri / Ek hizmetler / Fiyat ayarları (kademeler, teslim kademeleri,
  limitler, tatiller) + **fiyat simülatörü** (hacim/alan/boyut girip fiyat görme).
  Silme yok (pasifleştirme); `expectedUpdatedAt`; her yazım + `print_catalog_changes`
  aynı işlemde; `revalidatePath('/3d-baski')`.
- **`/admin/ayarlar`**: özellik bayrakları (`instant_quote_enabled` dahil).
- **`/admin/teklifler`**: sekmeler İnceleme bekleyen / Hedef fiyat / RFQ / Fiyatlandı /
  Sipariş / Süresi dolan / Tümü; sayfalama (disputes deseni); kenar çubuğu rozeti
  (`displayRead`).
- **`/admin/teklifler/[id]`**: parçalar (küçük resim, 3D, ölçü, DfM, konfig, hesaplanan
  vs manuel fiyat), manuel fiyatlama formu (parça başı birim, gerekçe ≥10),
  hedef fiyat kararı, süre uzatma, yeniden açma, sohbet, denetim geçmişi, bağlı sipariş.
- Eski `/admin/upload-quotes` **yazılabilir kalır** (uçuştaki satırlar bitene dek),
  kenar çubuğunda "Eski yükleme teklifleri" olarak.

## Bildirimler

`quote-notify.ts` (`sendRawEmail` + `notifyCustomer`; kirli `email.worker.ts` /
`queues.ts`'e dokunulmaz): manuel teklif hazır, hedef fiyat kararı, inceleme talebi
alındı (müşteri) + yeni talep (admin), süresi dolmak üzere (3 gün kala, işlemsel),
terk edilmiş teklif (24 sa, **yalnız ticari ileti izni varsa**), yeni sohbet mesajı.
Saatlik `quote-maintenance` işi: süre dolumu, hatırlatmalar (`…_sent_at` ile tekil),
saklama süpürücüsü.

## Paylaşım, belge, sohbet, kütüphane, saklama

- **Paylaşım:** `share_token` nanoid(32) üret/yenile/iptal; `/teklif/[no]?t=…`;
  lookup oran limiti; paylaşım görünümünde e-posta/telefon/adres yok.
- **Belge:** `/teklif/[no]/belge` (sahip/paylaşım+giriş; `@media print`, A4).
- **Sohbet:** `quote_messages` + `quote-chat.ts` (`order-chat` deseni,
  `saveChatAttachment`, `containsContactInfo`), müşteri + admin rotaları, mevcut
  `<OrderChat basePath>` bileşeni, realtime `kind:"message"`.
- **Kütüphane + yeniden teklif:** `POST /api/quotes/[id]/requote` ve
  `POST /api/quotes/[id]/parts/import` (kaynak parça sahibinse dosyaları kopyalar,
  analizi kopyalar — yeniden analiz yok, yeni snapshot).
- **Saklama:** `quote-file-retention.ts`: siparişe dönmemiş, `expired/cancelled` +
  90 gün teklif parçalarının dosyalarını siler (başka referans yoksa), `files_purged_at`.
  Sipariş dosyaları `models/<orderId>/` kopyası olduğu için etkilenmez.

## Bayrak ve geçiş

- `instant_quote_enabled` (varsayılan **kapalı**): yeni `FEATURE_FLAG_KEYS` grubu;
  `test-ops-spine` üç gruplu hale gelir. Kapalıyken yeni yüzeyler yalnız admin
  oturumuna açık (iç test).
- Açıldığında `upload-model-flow.tsx` (temiz) `/3d-baski`'ya yönlendirir; başlık ve
  `path-selector` bağlantıları bayrağa göre. Eski `/quote/[id]` ve `/api/upload/model`
  çalışmaya devam eder (geometri düzeltmesi sayesinde); en son `quoteExpiresAt`
  geçince arşivlenir.

## Eski akış düzeltmeleri (Faz 0, bağımsız)

- `process_upload_model.py`: silinmiş dört yardımcı yerine `merge_components`,
  `build_report`, `estimate_wall_percentiles()[0]`; `repair_self_intersections` kaldırılır.
  (Yükleme ve satıcı ürün dosyaları önizleme/geometri almaya döner.)
- `docker/Dockerfile` worker aşamasına import koruması; `scripts/requirements.txt`'e
  `lxml`, `networkx`, `Pillow` açıkça.
- Misafir hesap şifre belirleme çıkmazı (`password-reset.ts`) ve e-posta küçük harf
  normalizasyonu (register/login) — fiyat kapısı modalı bunlara dayanır.

## Çakışma stratejisi (diğer oturumun commit'lenmemiş dosyaları)

Dokunulmaz: `api/orders/route.ts`, `order-draft.ts`, `checkout-form.tsx`,
`checkout-client.tsx`, `create/page.tsx`, `queues.ts`, `email.worker.ts`, `paytr.ts`,
`pay/*`, `havale/*`, `account/page.tsx`, `reorder`, `track`. Yalnız eklemeli:
`schema.ts` (dosya sonu blok), `drizzle/meta/_journal.json` (0064 girdisi),
`package.json` (test betikleri). Birleştirmede: diğer oturum 0063'ü commit'ledikten
sonra 0064 snapshot'ı `prevId` zinciri için yeniden üretilir; `quote-checkout.ts`
onların `payment-attempts` değişikliklerine göre gözden geçirilir.

## Test stratejisi

- **Birim (`test:unit` zincirine):** quote-units, quote-pricing (altın değerler:
  yuvarlama, taban, kademe, KDV, asgari tamamlama, U×q=satır), quote-dfm, business-days
  (tatil, cutoff), quote-policy, quote-present (**girişsiz çıktıda fiyat anahtarı
  yok**), quote-model-validation (zip bomb, ZIP64, şifreli, model girdisi yok),
  capability/ranker paritesi (teklifsiz siparişler aynen), order-money `quote` türü,
  order-model-policy `customer_quote`, ops-spine üç grup, api-contracts, sitemap.
- **Python:** fixture'lar (küp STL/OBJ, inç 3MF, iki gövde, su geçirmez olmayan) scratch
  venv'de; rapor anahtarları ve PNG/GLB/STL çıktıları.
- **DB (QA 55433, tek kullanımlık şema):** migration round-trip (up×2, dolu down reddi,
  down×2, up); servis: parça limiti yarışı, upload_id tekilliği, claim, worker durum
  geçişleri, checkout → promote → kickoff → dosya bağlama (tek revizyon, `review`,
  üretim+boyama=tutar, quotes.order_id), eski versiyon 409, süre dolmuş red, ikinci
  checkout aynı referans.
- **API rota testleri:** erişim matrisi (sahip/anonim/paylaşım/yabancı), fiyat gizleme,
  21. parça, admin 401/409.
- **UI render:** girişsiz markup'ta fiyat yok; çalışma alanı, modal, admin sayfaları.
- **Kapılar:** `tsc --noEmit`, `npm run lint`, `npm run build`, `test:unit`; alternatif
  portta Playwright uçtan uca (yükle → analiz → kayıt → fiyat → konfig değişimi).

## Uygulama fazları

| Faz | İçerik | Doğrulama |
|---|---|---|
| 0 | Eski geometri hotfix + Docker koruması + requirements | Python fixture, tsc |
| 1 | Şema + 0064 up/down + tohum + saf çekirdek + bayrak grubu | birim + migration round-trip |
| 2 | Anonim staging, 3MF doğrulama, analiz scripti + worker, realtime, teklif servisi + API | validation/python/API/DB testleri |
| 3 | Landing, malzeme sayfası, çalışma alanı, modal, hesap sayfaları, sözlük, SEO, analitik, auth düzeltmeleri | UI render, sitemap, api-contracts, build |
| 4 | Checkout, form, kickoff bağlama, dosya işi, ranker, üretici/admin panelleri, para dökümü, QC | DB uçtan uca, ranker paritesi, policy |
| 5 | Admin katalog/ayarlar/simülatör/bayrak/teklif kuyruğu/manuel fiyat/hedef fiyat | rota + render |
| 6 | Özel talepler, sohbet, bildirimler, bakım işi, paylaşım, belge, kütüphane, saklama | DB + birim |
| 7 | Geçiş (bayrak güdümlü yönlendirme), tam kapılar, uçtan uca, çok mercekli inceleme | tümü |

## Kaynak notları

Okuyucu özetleri (oturum scratchpad'i, commit edilmez): geometry, checkout,
accounts-ui, admin, partners, misc, xometry parity, critic. Önemli doğrulanmış
bulgular: `process_upload_model.py` ImportError (7874d10); `/api/uploads/chunk`
misafire 401; misafir hesap şifre sıfırlama çıkmazı; yükleme siparişlerinde yeniden
sipariş her zaman 400; `kickOffOrderProcessing` yalnız `uploadedModelId`'yi
`review`'a alıyor; `ORDER_MODEL_FORMATS = stl|glb`; `messages.order_id NOT NULL`;
BullMQ 5.70.1 özel iş kimliğinde `:` kısıtı; `pdfkit` devDependency; göç sırası
`when` kuralı.
