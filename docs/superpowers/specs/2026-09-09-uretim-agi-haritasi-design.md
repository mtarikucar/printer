# Üretim Ağı Haritası — Tasarım (2026-09-09)

> Rev. 2026-09-10 — üç bağımsız eleştiri turundan (veri/gizlilik, UX, entegrasyon)
> sonra revize edildi: `distanceScore` ayrık sonuç döndürüyor, saf yardımcılar DB
> modülünden ayrıldı, koyu kart paleti beyaz tabanlı rampaya çevrildi, mobil akış
> yeniden tanımlandı.
>
> Rev. 2 (uygulama sonrası çekişmeli inceleme, 12 bulgu): public payload artık
> HİÇBİR partnerin unvanını içermiyor, malzeme rozeti yalnız beyan edilmişse
> çıkıyor, admin editörüne `pending_approval` eklendi. Aşağıdaki bölümler bu
> son hâli anlatır.

## Amaç

Anasayfaya **"Türkiye'nin en geniş 3D üretim ağı"** başlıklı, etkileşimli bir
Türkiye il haritası eklemek. Haritada üreticilerin ve boyacıların bulunduğu
iller işaretlenir; her üreticinin **sorumlu olduğu iller (etki alanı)** il il
tanımlanır ve bir üreticiye gelince o etki alanı haritada görünür. Admin bu
etki alanlarını **harita üzerinden** düzenler. Etki alanı sipariş atama mesafe
skoruna girer, yani yalnızca dekor değildir.

## Kapsam dışı

- Koordinat / ilçe düzeyi; harita **il** düzeyindedir.
- Üreticinin kendi panelinden etki alanı düzenlemesi (sorumluluk platformun
  operasyonel kararıdır; admin düzenler).
- Boyacı seçimini etki alanına göre sıralamak (boyacıyı üretici elle seçiyor;
  ranker yok). Boyacı `coverage_provinces` kolonu **açılmaz**.
- Atama ağırlıklarının değişmesi (sadece "kapsama eşleşmesi" kademesi eklenir).

## Gizlilik kararı (kritik)

Public harita **hiçbir partnerin unvanını yayımlamaz**. "Hangi illerde üretim
var ve her atölye hangi illere hizmet veriyor" sorusunu yanıtlar, "kim"
sorusunu değil. Partnerler türleriyle anılır: "Üretici atölyesi", "Boyacı
atölyesi".

Neden: üretici sözleşmesi Platforma yayın hakkını **listelenen ürün başına**
veriyor ("Bir ürünü listeleyerek..."). Yani hiç ürün listelememiş, yalnızca
fason üreten bir atölyenin unvanı bugüne dek hiçbir public yüzeyde yoktu.
Boyacı sözleşmesi v3.0 ise unvan+il'i yalnızca **devir alan üreticiye**, o tek
devir için açıyor. İkisi de açık internete yayın yetkisi vermiyor ve
partnerlerin çoğu şahıs işletmesi, yani unvan kişisel addır.

| | Haritada pin | Panelde | İl | İlçe | Unvan |
|---|---|---|---|---|---|
| Üretici | ✔ | "Üretici atölyesi" | ✔ | ✘ | ✘ |
| Boyacı | ✔ | "Boyacı atölyesi" | ✔ | ✘ | ✘ |

Public payload'da **unvan, id, e-posta, telefon, açık adres, ilçe, IBAN,
`acceptingOrders` yok**. `getNetworkMapData` unvanı DB'den hiç okumaz; iki
birim testi bunu kilitler. Unvanlar da yayımlanmak istenirse önce sözleşmeye
madde + sürüm bump, sonra payload'a alan eklenir.

`map_visible` (iki tabloda da, DEFAULT true) admin'e her partneri haritadan
çıkarma imkânı verir. Kimlik yayımlanmadığı için varsayılanın açık olması kabul
edildi. Partnere dönük bir anahtar yok; kaldırma talebi admin'den geçer.

## Veri modeli — migration `0052_network_coverage`

| Tablo | Kolon | Tip |
|---|---|---|
| manufacturers | `coverage_provinces` | jsonb NULL → `string[]` |
| manufacturers | `map_visible` | boolean NOT NULL DEFAULT true |
| painters | `map_visible` | boolean NOT NULL DEFAULT true |

**Üretim yolu (repo konvansiyonu):** schema.ts düzenle → `npm run db:generate`
→ dosyayı `0052_network_coverage.sql` olarak adlandır → başına
`SET lock_timeout = '5s'`, kolonlara `IF NOT EXISTS` ekle → `0051` şablonundan
`0052_network_coverage.down.sql` yaz (`DELETE FROM drizzle.__drizzle_migrations`
notu dâhil) → snapshot + `_journal.json` commit'le → tek kullanımlık PG
konteynerinde up → down → up doğrula.

**Konum ili** = `address.il`, **PROVINCES'a karşı doğrulanır**; tanınmayan bir
değer "konum yok" sayılır (partner profil API'si il'i serbest metin kabul
ediyor). Partnerler kendi il'lerini değiştirebilir, yani kendi pinlerini
taşıyabilirler — admin'in adres düzenleme yetkisi yok, bu bilinçli bir sınır.

**Etkin etki alanı** = `coverage ∪ {konum ili}`.

## Modül yerleşimi (DB/worker/istemci ayrımı)

`src/lib/db` import edildiği anda `pg.Pool` kurulur; admin editörü istemci
bileşenidir ve `manufacturer-assignment.ts` BullMQ worker'ından erişilebilir.
Bu yüzden saf parçalar ayrı dosyalarda durur ve **hiçbiri `server-only`
import etmez**:

| Dosya | İçerik |
|---|---|
| `src/lib/data/turkey-map.ts` | ÜRETİLMİŞ — 81 il path + centroid, `TURKEY_MAP_VIEWBOX`, `TURKEY_MAP_PROVINCES` |
| `src/lib/data/turkey-regions.ts` | mevcut + `REGION_LABELS`, `PROVINCES_BY_REGION` |
| `src/lib/validators/network-map.ts` | zod `coverageBodySchema`, `normalizeCoverage` |
| `src/lib/config/network-map.ts` | saf `buildNetworkMap` + tipler + `effectiveCoverage` |
| `src/lib/services/network-map.ts` | yalnız `getNetworkMapData()` (DB) |
| `src/components/turkey-map/turkey-map-svg.tsx` | stil-bağımsız harita (iki yüzey de kullanır) |
| `src/components/marketplace/network-map/*` | anasayfa derisi |

`scripts/build-turkey-map.ts` kaynağı `npm pack turkey-map-react@2.0.6` ile
tek seferlik indirir (runtime bağımlılığı eklenmez); üretilen dosya başında
MIT lisans notu durur. `npm run map:build` kısayolu.

## Servis katmanı

```ts
interface PublicPartner {
  kind: "manufacturer" | "painter";
  il: string | null;
  coverage: string[];       // etkin etki alanı, Türkçe sıralı
  materials: string[];      // yalnız üretici; yalnız BEYAN EDİLMİŞ material_* etiketleri
}
interface NetworkMapData {
  partners: PublicPartner[];
  provinces: Record<string, { located: number[]; covered: number[] }>; // partners[] indeksleri
  stats: { manufacturers, painters, homeProvinces, coveredProvinces };
}
```

`materials` yalnız beyan edilmiş etiketleri gösterir; etiket yoksa boş döner ve
rozet çıkmaz. `manufacturerSupportsMaterial` etiketsizi "her malzemeyi basar"
sayar, ama bu İÇ ve hoşgörülü bir yönlendirme varsayılanıdır. Haritaya
taşınırsa partnerin hiç yapmadığı bir public olgu iddiasına dönüşürdü. İki
yüzeyin burada farklı konuşması bilinçlidir.

Anasayfa `getNetworkMapData()`'yı **try/catch** içinde çağırır (yerel dev DB'de
`painters` tablosu yok; dekoratif bir bölüm anasayfayı düşüremez). Hata →
bölüm gizlenir + `console.warn`. Admin PATCH'i `revalidatePath("/")` çağırır,
yoksa ISR yüzünden değişiklik 60 sn'ye kadar gecikir.

## Atama skoru

`distanceScore` **export edilir** ve ayrık sonuç döndürür:

```ts
type DistanceVerdict = { score: number; kind: "same_il"|"coverage"|"same_region"|"other"|"unknown" };
```

Değerlendirme sırası (kesin):

1. `orderCity` yok → 30 / `unknown`
2. `mfgCity` var ve eşit → 100 / `same_il`
3. etki alanı `orderCity`'yi içeriyor → **85** / `coverage`
4. iki bölge de biliniyor ve eşit → 60 / `same_region`
5. `mfgCity` yok → 30 / `unknown`
6. aksi → 20 / `other`

Kapsama kontrolü adres yokluğu kontrolünden ÖNCE gelir: adressiz ama etki
alanı tanımlı partner geçerli bir durumdur.

Sonuç rozeti: `same_il` → "Aynı şehir", `coverage` → **"Etki alanı"**,
`same_region` → "Aynı bölge". (Bugünkü `scores.distance >= 60` kontrolü 85'i
"Aynı bölge" diye yanlış etiketlerdi.)

`weightsVersion` **"v1.2" / "v2.2"**'ye çıkar — ağırlıklar değişmese de
`distance` alt-skorunun anlamı değişti, gölge değerlendirmeler karışmamalı.
`scripts/test-scoring-v2.ts` güncellenir.

**Aşırı geniş kapsama riski:** 81 ile yayılmış bir üretici her yerde 85 alır ve
aynı bölgedeki (60) rakiplerini ülke çapında geçer. Admin editörü 20 ilden
fazla seçimde uyarı gösterir ve "bu iller için atama önceliği kazanır" notunu
her zaman görünür tutar. Birim test `all-81 kapsama < aynı il` iddiasını
doğrular.

## Anasayfa bölümü

**Yer:** raflardan sonra, `CustomStrip`'ten önce. `partners.length === 0` ise
hiç render edilmez. Kod bölünmesi: `next/dynamic` (SSR **açık**) — 47 KB'lik
geometri (~20 KB gz) yalnız bölüm gerçekten varsa iner.

**Palet (koyu kart, beyaz tabanlı — `ink-2` kontur görünmezdi, 1.4:1):**

| Öğe | Değer |
|---|---|
| kart | `bg-ink` + `rounded-3xl border border-white/10` + hero'nun gölgesi |
| doku | PromoBanner'dan çıkarılan `PixelGrid light` (`rgba(255,255,255,.07)`) |
| il (kapsamasız) | `fill rgba(255,255,255,.05)` + `stroke rgba(255,255,255,.14)`, `vector-effect: non-scaling-stroke` |
| il (kapsanan) | `fill accent/25`; 2+ partner → `accent/45` |
| seçili partnerin alanı | `fill accent/55` + `stroke accent` |
| soluk durum | kapsamasız durumun kendisi (asla altına inilmez) |
| eyebrow | mono, `text-green-300` |
| h2 | `var(--font-display)`, `text-white`, `text-2xl md:text-3xl` |
| gövde | `text-white/70`, istatistik `text-white/60` + beyaz rakam |
| satır | `bg-white/5 hover:bg-white/10`, çip `border-white/15 text-white/80` |

**Pinler:** üretici cyan, boyacı amber; beyaz halka; aynı ilde iki tür yan yana;
`animate-ping` + `motion-reduce:animate-none`, gecikme indeksle kaydırılır.
Panelde amber **durum** rozeti kullanılmaz (amber = "beklemede" semantiği).

**Etkileşim kuralları (belirsizlik bırakmadan):**
- Hover = geçici önizleme, `mouseleave` ile geri alınır. Tık/dokunuş = kalıcı
  seçim. Escape veya denize tık seçimi temizler.
- Pin tıklaması = il tıklaması (pinler `pointer-events: none`, path'ler her
  zaman tıklanabilir). Partner kartına yalnız panelden geçilir.
- **Boşta panel** boş değildir: lejant (cyan/amber disk + üç dolgu örneği),
  istatistik şeridi, "Bir ile tıkla" ipucu.

**İstatistik şeridi:** sıfır olan segment hiç yazılmaz ("0 boyacı" görünmez).
Sıralama kapsamayı öne alır: "L ilde hizmet · K şehirde atölye · Türkiye'nin
her yerine ücretsiz kargo" (footer ile aynı ifade).

**Mobil (`(hover: none)` / `<md`):** kart tam genişliğe açılır, harita
**gösterge değil görsel**tir; birincil kontrol harita üstündeki il seçici
(`<select>`, yalnız partnerli iller). Seçimde panel `scrollIntoView({block:
"nearest"})` ile görünür olur; panelin altında WhatsApp FAB'ı için `pb-20`.

**Erişilebilirlik:** sekme durağı yalnız **konumlu** iller (roving tabindex:
harita tek durak, ok tuşları pinli iller arasında gezer, Enter/Space seçer,
Escape temizler). Tooltip hover **ve** focus'ta, fare değil centroid'e
(`cx/cy`) çapalı. `<svg role="group" aria-label>`, panelde
`aria-live="polite"`, path'lerde `focus-visible` konturu.

**Kopya tutarlılığı:** `/figur` ticker'ındaki "Ankara'da üretim" → "Türkiye'de
üretim" (tr + en), yoksa çok şehirli harita ile çelişir.

## Admin — `/admin/network-map`

Sidebar'da Üreticiler grubunda. `force-dynamic`. `active`, `suspended`, `conditionally_approved` ve `pending_approval` yüklenir;
yalnız `rejected` dışarıda. `pending_approval` içeride çünkü onay tek bir
UPDATE ile status'ü `active` yapıyor ve `map_visible`'a dokunmuyor: başvuru
listede olmasaydı görünürlük kararı ancak yayından sonra verilebilirdi. Göz
düğmesi ve listelerdeki "Haritada" rozeti ham `map_visible`'ı değil
`map_visible AND status='active'`'i gösterir.

- **Sol:** arama + tür filtresi + durum rozeti (`STATUS_BADGE` yeniden
  kullanılır) + `map_visible` göz düğmesi. `?partner=<id>` doğrudan düzenlemeye
  girer.
- **Harita:** seçili partnerin konum ili kilitli vurgulu ("adresten gelir"
  notuyla; adres yoksa uyarı satırı ve kapsama yine düzenlenebilir), etki alanı
  boyalı, ile tık aç/kapat. Yanında **il yazarak ekleme** (typeahead) + seçili
  iller çip listesi (× ile çıkar) + "N il seçili" sayacı.
- **Diğer partnerlerin kapsamasını göster** anahtarı: başkalarının alanı hayalet
  katman olarak altta çizilir — admin'in verdiği karar tam olarak budur.
- Bölge çipleri `REGION_LABELS` ile Türkçe; "Tümünü temizle" + **"Vazgeç"**
  (kaydedilene dön). Kirli durumda başka partnere geçiş ve `beforeunload`
  uyarır.
- `lg` altında liste harita üstüne yığılır.
- **API:** `PATCH /api/admin/manufacturers/[id]/coverage` ve
  `.../painters/[id]/coverage`. Gövde **kısmi**:
  `{ coverageProvinces?: string[]; mapVisible?: boolean }`, en az biri zorunlu —
  göz düğmesi tüm kapsama dizisini geri göndermek zorunda kalmasın (aksi hâlde
  başka sekmedeki kaydedilmemiş düzenleme sessizce ezilir). Boyacı rotası
  yalnız `mapVisible` kabul eder.
- Mevcut üretici/boyacı listelerinin detay kartına "Etki alanı" bölümü +
  "Haritada düzenle" linki.

## Test

`scripts/test-network-map.ts` (saf, DB'siz; `test:unit` zincirine eklenir):

- harita verisi: 81 il, PROVINCES ile birebir, boş path yok, centroid bbox
  içinde, yalnız M/L/Z komutları, tekrarsız plaka.
- `REGION_LABELS` / `PROVINCES_BY_REGION` 81 ili kapsar.
- `normalizeCoverage`: bilinmeyen il elenir, tekrar temizlenir, sıralı döner.
- `buildNetworkMap`: indeks + istatistik + **gizlilik** (payload'da boyacı adı,
  e-posta, telefon, ilçe, id yok) + geçersiz `address.il` → konum yok +
  etiketsiz üreticide iki malzeme.
- `distanceScore`: altı kademe, sıralama, `kind` etiketleri, all-81 < aynı il.
- `server-only` regex nöbetçisi (config/validators/data modülleri).

Ek: `tsc --noEmit`, `eslint`, migration round-trip, Playwright ile masaüstü +
mobil ekran görüntüsü ve admin kaydet akışı.
