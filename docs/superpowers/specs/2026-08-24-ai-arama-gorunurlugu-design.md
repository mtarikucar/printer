# Yapay zekâ aramalarında görünürlük (GEO/AEO) + kişiye özel figür yeniden fiyatlandırma

**Tarih:** 2026-08-24
**Durum:** Tasarım — sahibi onayı bekliyor
**Tetikleyici:** Ankara'dan iki müşteri Figurunica'yı ChatGPT'ye sorarak buldu ve WhatsApp'tan sipariş verdi. Hedef: bu kanalı tesadüf olmaktan çıkarıp Türkiye geneline yaymak.

---

## 1. Bağlam ve kanıt

10 ajanlık bir denetim (5 kod tarafı, 4 harici araştırma, 1 sentez) ve ayrı bir hukuk araştırması yürütüldü. Ham çıktılar `subagents/workflows/wf_b7430894-e4e/journal.jsonl` içinde.

### Zincirin neresi kopuk

AI asistanları bir siteyi şu sırayla "görür": **ağ katmanı → robots.txt → tarama → indeks → retrieval → alıntı.** Figurunica'da her halka ayrı ayrı kopuk:

| Halka | Durum | Kanıt |
|---|---|---|
| Ağ | Cloudflare önde, AI-bot ayarları bilinmiyor | `dig NS` → `angela/gabe.ns.cloudflare.com`, AS13335 |
| robots.txt | `Disallow: /api/` → tüm ürün görselleri kapalı; `/painter/` unutulmuş | `src/app/robots.ts` |
| Görsel | HMAC imzalı, 24-48 saatte 401 | `storage.ts:150`, `deploy.yml:209` `FILES_REQUIRE_SIGNATURE=1` |
| Sitemap | 7 statik URL, sıfır ürün, 11 sayfa eksik | `src/app/sitemap.ts` |
| İndeks | Ana sayfa hâlâ **İngilizce başlıkla** indekste | Haziran'dan beri site Türkçe-only; anlamlı yeniden tarama yok |
| Structured data | Tüm repoda sıfır `application/ld+json` | grep boş |
| İçerik | Anahtar kelime taşıyan tek Türkçe route yok | `/create`, `/shop`, `/figur` |

### Zaten sağlam olan (bozulmayacak)

SSR temiz — gövde metinleri ham HTML'de (araştırma: GPTBot/ClaudeBot/PerplexityBot **hiç JS çalıştırmıyor**, bu binary bir ön koşul ve bizde sağlanmış). Canonical mimarisi doğru (`src/lib/seo.ts` + `x-pathname`). Middleware bot engellemiyor, rate-limit'lerin 23'ü de POST `/api` üzerinde — crawler 429 yiyemez. Global `X-Robots-Tag` yok, CSP report-only.

### Araştırmanın üç ayırt edici bulgusu

1. **Eğitim botu ≠ alıntı botu.** OpenAI dokümanı birebir: *"Sites that are opted out of OAI-SearchBot will not be shown in ChatGPT search answers."* GPTBot için sadece *"should not be used in training."* Yani `GPTBot`'u bloklamak ChatGPT görünürlüğüne **hiç** mal olmaz; `OAI-SearchBot`'u bloklamak sizi görünmez yapar. 11 alıntılayıcı botun 9'u eğitim crawler'ı değil — hepsini açmanın eğitim maliyeti sıfır. Cloudflare'in tek tıklık "Block AI bots" düğmesi ikisini birden keser; asıl tuzak bu.

2. **Google yetmiyor.** ChatGPT'nin retrieval'ı **Bing** indeksi. Claude'un web araması **Brave** üzerinden (bir analiz Claude atıflarının %86,7'sinin Brave top sonuçlarıyla örtüştüğünü buldu). Google'da mükemmel indekslenmiş bir site Bing/Brave taramadıysa ChatGPT ve Claude için yapısal olarak görünmezdir.

3. **Alıntılanabilirlik formülü.** Rakip analizinden çıkan ortak payda: (a) sayfada yazılı fiyat rakamı, (b) gün cinsinden teslim süresi, (c) malzeme/teknoloji adı (SLA, reçine), (d) numaralı süreç adımları, (e) her özel gün için ayrı URL. Ayrıca atıfların %44,2'si dokümanın ilk %30'undan geliyor → cevap en üste. "Yazar" ve "son güncelleme" alanı olmayan sayfaların kaynak kartına çıkma oranı 2,4x düşük.

**Dürüstlük notu:** 2026 GEO literatür taraması (arXiv 2607.14035) hiçbir tekniğin platformlar arası istikrarlı nedensel etki göstermediğini söylüyor. Aşağıdaki plan bu yüzden "garantili sıralama" vaat etmiyor; **görünmez olmanın yapısal sebeplerini kaldırıyor** ve alıntılanabilir varlık üretiyor.

---

## 2. Sahibinin verdiği kararlar

| Konu | Karar |
|---|---|
| Konumlanma | Hediyelik figür **ve** 3D baskı hizmeti — eşit ağırlıkta |
| Şehir sayfaları | 6-8 şehir, gerçek içerikle (81 il şablonu **hayır**) |
| İçerik | Tam Türkçe metinleri Claude yazar, sahibi onaylar |
| Cloudflare | Sahibinin erişimi var, kontrol edecek |
| Ürün görselleri | Ayrı herkese açık `/media` route'u |
| Yasal kimlik | Sahibi iletecek |
| **Kişiye özel figür** | **Sabit 15 cm, sadece reçine, profesyonel el boyamalı, boyama kiti yok, ₺3.499, kargo dahil** |
| Özel tasarım / farklı boyut | Otomatik fiyat yok → admin teklif akışı |
| Pazaryeri + Creative Lab | Dokunulmayacak |
| İade politikası | Gerçek mevzuata göre yazılacak (ayrı hukuk araştırması yürütüldü) |

---

## 3. İki iş paketi ve sıralama

**A paketi (fiyat/ürün) B paketinden ÖNCE gelmek zorunda.** Sebep: B paketi fiyatı, boyutu ve ürün tanımını hem `Offer` structured data'sına hem de onlarca içerik sayfasına yazıyor. Önce içerik yazılıp sonra fiyat değişirse her şey iki kez yazılır ve AI'lara yanlış rakam ezberletmiş oluruz.

```
A. Ürün yeniden tanımı  →  B0. Kanamayı durdur  →  B1. Metadata  →  B2. JSON-LD  →  B3. İçerik  →  B4. Dağıtım
   (fiyat, boyut, boyama)    (robots, görsel,       (Türkçe title,    (Product,      (TR route'lar,  (IndexNow,
                              sitemap)                og:image)        Offer, FAQ)     şehir, rehber)  llms.txt, ölçüm)
```

---

## A. Kişiye özel figür — yeniden tanım

### A.1 Ürün

**Öncesi:** 3 boyut (6/8/12 cm) × 2 malzeme (reçine/filament) × 4 bitiş = 24 kombinasyon, ₺899–₺3.799 arası. Varsayılan: boyanabilir kit.

**Sonrası:** Tek ürün. **15 cm, SLA reçine, profesyonel el boyamalı, sergilemeye hazır, ücretsiz kargo — ₺3.499.** Boyama kiti yok. Farklı boyut isteyen teklif akışına düşer.

### A.2 Migration gerekmiyor (tasarım kazancı)

- Boyut kolonu migration 0036'dan beri düz `text` → yeni bir preset key migration istemez.
- `finish` enum'unda `hand_painted` **zaten var** → yeni enum değeri gerekmez.
- Yani A paketi **saf uygulama katmanı değişikliği**. Geri alınması `git revert`.

### A.3 Dosya dosya

**`src/lib/config/sizes.ts`**
- `SIZE_PRESETS` tek girdiye iner: `{ key: "standart", heightMm: 150, labelKey: "sizes.standart", labelTr: "Standart" }`.
- Eski `kucuk`/`orta`/`buyuk` key'leri **silinmez** — `SIZE_PRESETS_LEGACY` olarak korunur ve `presetHeightMm` bunları da çözer. Sebep: DB'de bu değerlerle yazılmış geçmiş siparişler var; admin/track/e-posta ekranları onları hâlâ render edebilmeli.
- `isSizePreset` sadece satılabilir preset'i (`standart`) doğrular → yeni sipariş yalnızca 15 cm açar.

**`src/lib/config/prices.ts`**
- `FIGURINE_PRICE_KURUS = 349900` (tek sabit). `FIGURINE_PRICES_KURUS` matrisi legacy sipariş okuması için korunur, yeni akışta kullanılmaz.
- `figurinePriceKurus()` yeni akışta malzeme/boyut argümanına bakmadan sabit döner; legacy key gelirse eski tablodan okur.
- **Kritik:** `paintingPortionKurus()` bugün boyacı hakedişini `hand_painted` ek ücretinden (₺1.000) türetiyor. Boyama fiyata gömülünce bu bağ kopar. Çözüm: `PAINTING_PORTION_KURUS = 100000` açık sabiti tanımlanır ve `paintingPortionKurus()` yeni ürün için bunu döndürür. **Bu yapılmazsa boyacılar sıfır hakediş alır.**
- `FINISH_SURCHARGES_KURUS` korunur (legacy siparişler için) ama yeni akış her zaman `hand_painted` + 0 ek ücretle çalışır.

**`/create` akışı** — boyut seçici ve malzeme seçici kaldırılır; tek ürün kartı + "farklı boyut istiyorum" → teklif/WhatsApp CTA'sı. Bitiş seçici kaldırılır (hep `hand_painted`).

**Metin katmanı** — `tr.ts` + `en.ts`: "boyama kiti" geçen ~40 anahtar yeniden yazılır. Yeni vaat: *"profesyonel el boyamasıyla, sergilemeye hazır."* Etkilenen: hero, SSS (a3 boyut, a4 boyama, a6 malzeme), kutu içeriği, e-posta şablonları.

**Yasal sayfalar** — `/on-bilgilendirme` §2'deki fiyat tablosu tek satıra iner. `/iade`, `/mesafeli-satis`, `/kargo` içindeki ürün tanımı güncellenir. Her sayfanın "son güncelleme" tarihi 2026-08-24 olur (şu an 31 Mart / 9 Haziran / 28 Temmuz — tutarsız).

### A.4 Riskler

- **Marj:** ₺3.499'un ₺1.000'i boyacıya gidiyor, üzerine %35 platform komisyonu ve üretici payı. Sahibi birim maliyeti doğrulamalı.
- **Fiyat sıçraması:** Mevcut tavan ₺1.799 (12 cm reçine, kit dahil). Yeni giriş ₺3.499. Boyalı 12 cm eşdeğeri bugün ₺2.799 — yani gerçek artış %25, algılanan artış %289. İletişimde bu ayrım vurgulanmalı.
- **Sepetteki taslaklar:** DB'de eski boyut/malzeme ile bekleyen draft'lar var. Deploy'da bunlar teklif akışına düşürülmeli veya fiyatları dondurulmalı — bu bir veri geçişi kararı, kod yazmadan önce netleşmeli.

---

## B. GEO/AEO

### B0 — Kanamayı durdur

Bu üçü olmadan geri kalanı boşa gider.

**B0.1 `src/app/robots.ts`** *(10 dk, en yüksek etki/efor)*
- `disallow`'a `/painter/` ekle (`/admin/`, `/manufacturer/` ile simetri; footer `/painter/register`'a link veriyor).
- `allow`'a `/api/files/products/` ekle — robots.txt'te longest-match kazanır, 20 karakterlik Allow 5 karakterlik `Disallow: /api/`'yi yener.
- **Alıntılayıcı botları isimle allow et:** `OAI-SearchBot`, `ChatGPT-User`, `OAI-AdsBot`, `PerplexityBot`, `Perplexity-User`, `Claude-SearchBot`, `Claude-User`, `Googlebot`, `Googlebot-Image`, `bingbot`, `Applebot`, `meta-webindexer`, `Amzn-SearchBot`, `Amzn-User`, `MistralAI-Index`, `MistralAI-User`, `DuckAssistBot`, `YouBot`.
- **Saf eğitim botlarını ayrı grupta disallow et:** `GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`, `Bytespider`, `meta-externalagent`, `Amazonbot`, `MistralAI-Training`, `Webzio-Extended`, `Diffbot`, `cohere-training-data-crawler`.
- `facebookexternalhit` **asla** bloklanmaz — WhatsApp link önizlemesini öldürür (Türkiye'de WhatsApp penetrasyonu %90 ve mevcut siparişler oradan geliyor).

**B0.2 İmzasız kalıcı ürün görseli**
- `src/app/media/products/[...key]/route.ts` — imzasız, `Cache-Control: public, max-age=31536000, immutable`. **Yalnızca `products/` öneki.** Dosya adları nanoid, içerik değişmez.
- `src/lib/services/storage.ts` → `getPublicImageUrl()`: `products/` için imzasız `/media/...`, diğer her şey için mevcut imzalı `getPublicUrl()`'e delege.
- Güvenlik gerekçesi: `.env.example`'daki imza gerekçesi PII fotoğrafları, GLB/STL mesh'leri ve chat görselleri için yazılmış. `products/` zaten anonim ziyaretçiye gösterilen vitrin fotoğrafı — farklı risk sınıfı. **Diğer tüm prefix'ler imzalı kalır.**
- Çağrı yerleri: `src/app/page.tsx`, `src/app/shop/[slug]/page.tsx`, `src/lib/services/shop-query.ts`, `product-card.tsx`'e beslenen her yer.

**B0.3 `src/app/sitemap.ts`**
- 11 eksik statik route: `/figur`, `/urunler`, `/toplu-siparis`, `/anahtarlik-kutusu`, `/atolye`, `/kargo`, `/iade`, `/cerez`, `/mesafeli-satis`, `/on-bilgilendirme`, `/ticari-ileti`.
- DB'den aktif ürünler → `/shop/<slug>`, `lastModified: updatedAt`. `slug` nullable, `isNotNull` filtresi şart.
- `export const revalidate = 3600`.
- `/create` priority 0.9 → B1.4 yapılana kadar 0.5.

### B1 — Bulunabilir metadata

- **`tr.ts` + `en.ts` `meta.title`/`meta.description`** — Türkçe arama terimi taşısın: *"Fotoğraftan 3D Figür Yaptır | Kişiye Özel El Boyamalı Biblo | Figurunica"*. Description'a fiyat + teslim + malzeme + şehir girer (~155 karakter).
- **Ana sayfaya kendi `metadata`'sı** (şu an yok, kök layout'un generic'ini miras alıyor).
- Title-only olan 10 sayfaya description; `/privacy` + `/terms` başlıkları Türkçeleşir.
- **`src/app/opengraph-image.tsx`** (Next 16 `ImageResponse`, 1200×630) + PDP'de ürün görseliyle explicit `openGraph` override. Next child'ın title'ını parent'ın openGraph'ına merge etmez — tüm obje yeniden verilir.
- **PDP yorumlarını server-render et** — bugün ham HTML'de "Henüz yorum yok." yazıyor, aynı ürünün listeleme kartı server-side "4.7 (12)" gösteriyor. Crawler'a çelişkili bilgi gidiyor. Gizlilik kuralı korunur: yazar adı yalnızca ilk isim.
- **`/create` ve `/urunler` server shell'e çevrilir** — `/cart`, `/checkout`'un zaten kullandığı pattern. Statik pazarlama metni Suspense dışına, sadece search-param'a bağlı kısım içine.

### B2 — JSON-LD

- **`src/lib/seo/jsonld.tsx`** — native `<script type="application/ld+json">` (Next.js resmi pattern'i; `next/script` değil, `metadata` API'si JSON-LD üretemez). **`.replace(/</g, "\\u003c")` opsiyonel değil** — pazaryeri satıcısı ürün başlığına `</script>` yazabilir, stored XSS. Ürün adı, açıklama ve müşteri yorumu hepsi kullanıcı girdisi.
- Her entity tam bir kez, tek `@graph`, Suspense boundary dışında.
- **`src/lib/seo/organization.ts`** — tip **`OnlineStore`**, `LocalBusiness` değil (o fiziksel şube gerektirir ve self-serving review politikası nedeniyle yıldız özelliğine uygun değil). **Organization'a `aggregateRating` konmaz.**
- **PDP:** `Product` + `Offer` (`availability: InStock` — `MadeToOrder` semantik olarak doğru ama Google desteklemiyor; üretim süresi `handlingTime`'a gider), rolling `priceValidUntil` (+12 ay, hardcoded tarih rich result'ı sessizce düşürür), `shippingDetails` (₺0, TR, handling 5-7 gün + transit 2-3 gün), `hasMerchantReturnPolicy` (ürün tipine göre dallanır), `aggregateRating` (yalnızca `ratingCount > 0` — `ratingValue: 0` Google'da hard error), `BreadcrumbList`.
- **`FAQPage`** — Google rich result'ı 2023'te öldü ama LLM'ler için ucuz ve net Q&A eşlemesi. **Önce a7 düzeltilmeli** (aşağı bkz.), yoksa hukuken yanlış bir iddiayı makine-okunur hale getiririz.
- `WebSite` node'unda `SearchAction` **yok** (2024-11-21'de kapatıldı).

### B3 — Türkçe içerik (asıl atıf oyunu)

Araştırma net: e-ticaret dikeyi rank↔atıf örtüşmesinde en kötü (%22,9), transactional sorgular AIO'yu %13-14 tetikliyor, informational %83. Kazanç informational tarafta.

- **`/hediye/[occasion]`** — data-driven registry (`design-templates.ts` pattern'i). Set: `yildonumu`, `sevgililer-gunu`, `dogum-gunu`, `mezuniyet`, `anneler-gunu`, `babalar-gunu`, `asker-ugurlama`, `yeni-dogan`, `dugun-pasta-figuru`, `kurumsal`, `evcil-hayvan`, `ogretmenler-gunu`.
- **Şehir sayfaları** — Ankara, İstanbul, İzmir, Bursa, Antalya, Adana, Konya, Gaziantep. Ankara sorgusunu şu an `armut.com` dizini tutuyor ("En İyi 40 Ankara 3D Baskı Firması"); dizini geçmenin yolu onun veremediğini vermek: gerçek fiyat + gün cinsinden teslim + ilçe kargo bilgisi + gerçek iş görselleri.
- **`/fiyatlar`** — 2026 tam şeffaf fiyat tablosu, `prices.ts`'ten üretilir (elle kopyalanmaz). Pazarda tam tablo yayınlayan **yok**; LLM'ler tam olarak bu tip tabloları alıntılıyor.
- **`/recine-mi-filament-mi`**, **`/fotograf-nasil-cekilir`**, **`/guvenilir-mi`** (ETBİS, mesafeli satış, 3D Secure, gerçek adres — sektörün Şikayetvar dosyalarıyla kirli güven tabanında alıntılanabilir tek cevap olma şansı).
- Her sayfa: cevap en üstte, gerçek rakam + tablo + numaralı adım, FAQPage JSON-LD, "son güncelleme", sitemap kaydı.

**B3.2 İç link grafiği** — `FigFooter` bugün 32 public sayfanın 2'sinde; bir `(public)` route group'una taşınır. `/figur` tamamen orphan, nav'a girer. `/shop`'a gerçek `?page=` pagination + `<link rel="next">`. `src/app/shop/kategori/[...path]` — bugün `?category=` varyantlarının hepsi `/shop`'a canonicalize oluyor, yani pazaryerinin birincil organik yüzeyi indekslenemez halde. Header kategori submenu'sü server-side beslenir. Ana sayfadaki çift `<h1>` tekilleşir. `not-found.tsx` eklenir.

### B4 — Dağıtım ve ölçüm

- **IndexNow** (`src/lib/services/indexnow.ts`) — ürün yayın/güncelleme kancası, fire-and-forget. Dinleyenler: bing, yandex, seznam, naver, yep, internetarchive, amazonbot. Google katılmıyor. Yol: IndexNow → Bing → **ChatGPT/Copilot**.
- **`llms.txt`** — dürüst not: hiçbir büyük sağlayıcı tükettiğini doğrulamadı. Maliyeti bir dosya, tutulur ama etkisi beklenmez.
- **Ölçüm:** sunucu loglarında AI-bot UA filtresi (200 alıyor mu?), `chatgpt.com` / `perplexity.ai` / `claude.ai` referrer'ları, Bing Webmaster + GSC tarama istatistikleri, WhatsApp'ta "bizi nereden buldunuz?" sorusu.

---

## 4. İade politikası — açık madde

Sitede çelişki var: SSS a7 *"iade kabul edilmemektedir"* derken `/iade` §4 ve `/on-bilgilendirme` §5 hazır ürünlerde 14 günlük yasal cayma hakkı tanıyor. Sahibi "gerçek mevzuat neyse ona göre yaz" dedi.

Ayrı bir hukuk araştırması yürütülüyor (3 bağımsız araştırmacı + 2 çekişmeli doğrulayıcı + sentez): 6502 m.48, Mesafeli Sözleşmeler Yönetmeliği m.9/m.15, hakem heyeti ve Yargıtay uygulaması, sektör emsali. Çıktısı bu bölümü doldurup `MerchantReturnPolicy` enum değerlerini kesinleştirecek.

**Ön kabul (doğrulanacak):** kişiye özel figür → `MerchantReturnNotPermitted`; hazır katalog ürünü → `MerchantReturnFiniteReturnWindow`, 14 gün. Ayıplı mal rejimi her iki durumda da bağımsız olarak devam eder.

---

## 5. Sahibinin yapacakları (off-site)

Öncelik sırasıyla. 1 ve 3 olmadan kod tarafı boşa gider.

1. **Cloudflare** — Security → Bots → AI Crawl Control'de alıntılayıcı botları allow'a al; Bot Fight Mode kapalı; Security Level "High" değil; managed robots.txt enjeksiyonu var mı diye canlı `robots.txt`'i build çıktısıyla karşılaştır. **Şebeke dışı bir makineden** `OAI-SearchBot`/`PerplexityBot`/`bingbot` UA'larıyla 200 doğrula.
2. **VPS nginx** — `grep -rn 'user_agent\|limit_req\|deny' /etc/nginx/` (canlı config repoda yok).
3. **Bing Webmaster Tools** — doğrula, sitemap gönder, IndexNow key kaydet. **ChatGPT ve Copilot'un gördüğü indeks budur.**
4. **Brave Search** — `site:figurunica.com` kontrolü; Claude'un web araması buradan geçiyor.
5. **ETBİS kaydı + footer karekodu** — 6563 sayılı kanun gereği zorunlu, 2026 cezası ₺143.102–715.516. Ayrıca `etbis.ticaret.gov.tr` üzerinden herkese açık doğrulanabilir olmak, LLM'in "bu gerçek bir tüzel kişi" doğrulaması yapabileceği **en yüksek otoriteli Türkçe kaynak** ve parayla satın alınamaz.
6. **Google İşletme Profili** — "hizmet alanı işletmesi" olarak (adres gizlenir, Ankara/il bazlı hizmet alanı tanımlanır). Gemini ve AI Overviews yerel cevaplarının birincil beslemesi.
7. **Şikayetvar doğrulanmış marka profili** — sektörün AI'daki itibarı bu sitedeki dosyalarla kirli.
8. **Google Merchant Center** (TR ücretsiz listeleme uygunluğunu doğrula) + Microsoft Merchant Center.
9. **Yandex Business** + **Foursquare** (Apple Haritalar dahil POI veritabanlarını besler).
10. **armut.com'a hizmet veren kaydı** — "Ankara 3D baskı" sorgusunun mevcut sahibi.
11. **NAP tutarlılığı** — site / TOBB / Ticaret Sicili Gazetesi / ETBİS birebir aynı olmalı. Farklıysa entity çözümlemesi bölünür. Off-site listedeki en büyük teknik risk.
12. **Trendyol / Hepsiburada / Çiçeksepeti mağazası** — yorum sayısı LLM için güven sinyali.
13. **Ekşi Sözlük + YouTube TR** — Ekşi, Türkçe AIO SERP'lerinin %37'sinde; ilgili başlıklar şu an neredeyse boş. **Promosyon amaçlı yazılmaz**, silinir ve geri teper.
14. **WhatsApp'a "bizi nereden buldunuz?"** — şu anki tek sert kanıt o iki Ankara siparişi.

---

## 6. Sahibinden gereken veri

Organization JSON-LD ve yasal sayfalar için, tek kaynak `src/lib/config/business-identity.ts`'e konacak:

| Alan | Durum |
|---|---|
| Hukuki unvan (Ltd. Şti. / A.Ş. / şahıs) | Eksik — repoda sadece "Unvan: Figurunica" |
| MERSİS no | Eksik |
| VKN + vergi dairesi | Eksik |
| Ticaret sicil no | Eksik |
| ETBİS numarası | Kayıt iddia ediliyor, numara yok |
| Posta kodu (Etimesgut) | Eksik |
| Sosyal medya hesapları | **Hiç yok** — `sameAs` boş kalacak |
| İşletme kuruluş yılı | Eksik |

---

## 7. Test ve doğrulama

- `npx tsc --noEmit` her paket sonunda.
- Fiyat değişikliği için birim testi: `figurinePriceKurus`, `paintingPortionKurus`, legacy boyut çözümlemesi.
- JSON-LD: Google Rich Results Test + schema.org validator, her şablon için bir örnek URL.
- Crawler simülasyonu: `curl -A "<bot UA>"` ile ana sayfa, PDP, içerik sayfası → 200 + beklenen metin ham HTML'de.
- `/media/products/` route'u: imzasız 200, `products/` dışı bir key → 404 (imza bypass'ı sızmamalı).
- Playwright e2e: `/create` akışı tek ürünle uçtan uca.

---

## 8. Bilinen belirsizlikler

- Cloudflare'in botları gerçekten blokladığı **doğrulanmadı** — bu makineden yapılan her istek kurumsal proxy tarafından kesiliyor (tarayıcı UA'sı bile 403 alıyor). Elenmedi de.
- `/create`'in prod'da JS'siz crawler'a ne gösterdiği konusunda iki denetim ajanı çelişti (biri `<div hidden>`, diğeri Suspense-fallback-only dedi). Düzeltme her iki durumda da aynı.
- Bekleyen sipariş taslaklarının fiyat geçişi bir veri kararı — kod yazmadan netleşmeli.
- GEO literatürü nedensel etki garantisi vermiyor; plan görünmezliğin yapısal sebeplerini kaldırmaya dayanıyor.
