# Kalem bazlı hakediş — tasarım

Tarih: 2026-09-01
Durum: onaylandı, uygulanacak

## 1. Problem

Bugün bir siparişin partner hakedişleri **örtük** kurallardan türetiliyor:

```
üretici brüt  = amountKurus                       (boyama yoksa / üretici kendi boyuyorsa)
              = amountKurus − paintingPriceKurus  (boyacıya devredildiyse)
boyacı brüt   = paintingPriceKurus
platform      = her iki brütün %35'i
```

`paintingPriceKurus` sabit **₺1.000** (`PAINTING_PORTION_KURUS`) ve yalnızca web
checkout'ta, yalnızca `orderType === "custom"` + `figure` + `hand_painted`
siparişlerde yazılıyor (`src/app/api/orders/route.ts:516-529`). Bunun üç sonucu var:

### 1.1 Aynı para iki partnere vaat ediliyor (kullanıcının gördüğü hata)

`src/app/manufacturer/orders/[id]/page.tsx:329-331` üreticinin gösterilen hakediş
tabanını siparişin gerçek durumundan değil, **üreticinin profil bayrağından**
(`manufacturers.paintsInHouse`) seçiyor:

```ts
grossKurus:
  order.needsPainting && !manufacturer.paintsInHouse
    ? Math.max(0, order.amountKurus - order.paintingPriceKurus)
    : order.amountKurus,
```

"Kendim boyarım" işaretli bir üretici işi boyacıya devrettiğinde
(`send-to-painter` rotasında `paintsInHouse` guard'ı **yok**) kartı hâlâ
**₺3.499'un %65'i = ₺2.274,35** yazmaya devam ediyor; boyacı ise kendi panelinde
aynı ₺1.000'in %65'i = **₺650**'yi görüyor. Aynı ₺1.000 iki partnere birden
vaat edilmiş oluyor. Ekrandaki vaat onurlandırılırsa toplam partner ödemesi
₺3.499'un ₺2.924,35'i olur ve platform marjı %35'ten **%16,4'e** düşer.

Ayrıca `client.tsx:640-644` dipnotu da aynı bayrağa bağlı: devirden sonra
üretici "Hak ediş, siparişi kargoladığınızda tahakkuk eder" okuyor — oysa
`ship/route.ts:65`'teki `isNull(orders.painterId)` o siparişi kargolamasını
kalıcı olarak imkânsız kılıyor.

Veritabanı çift tahakkuk etmiyor (`manufacturer_earnings.order_id` UNIQUE +
`onConflictDoNothing`), yani hata **ekran düzeyinde** — ama kaynağı örtük modelin
kendisi.

### 1.2 Boyacı hattı siparişlerin çoğunda erişilemez

`needsPainting`'i yazan yalnızca üç yer var: `/api/orders/route.ts:759`,
`order-draft.ts:373` (kopyalama) ve `reorder/route.ts:225`. Yani:

- **Admin manuel siparişi** (`/api/admin/orders/create`) — `finish: "hand_painted"`
  kabul edip saklıyor, `needsPainting`/`paintingPriceKurus` hiç yazmıyor.
- **WhatsApp ajan siparişi** (`wa-order.ts:196`) — `finish` varsayılanı
  `"hand_painted"`, aynı şekilde painting kolonlarını yazmıyor.
- **`/api/admin/orders/[id]/edit`** (`route.ts:105-110`) — mevcut bir siparişin
  `finish`'ini değiştiriyor, painting kolonlarını yeniden hesaplamıyor (her iki
  yönde de: `hand_painted`'e çevirince taban oluşmuyor, `hand_painted`'ten
  çıkarınca `needsPainting=true` bayat kalıyor).

Bu siparişlerde `needsPainting=false` olduğu için `send-to-painter:60` ve
`assign-painter:65` **kalıcı olarak reddediyor** ("Bu sipariş için boyama
seçilmemiş"), `ship/route.ts:66`'daki `eq(orders.needsPainting, false)` geçiyor
ve `accrueEarning(..., order.amountKurus)` üreticiye **tutarın tamamını** yazıyor.
Müşteri boyalı figür parası ödüyor, boyacı ₺0 alıyor, figür boyanmadan çıkabiliyor.

### 1.3 Kırılımı ifade etmenin yolu yok

Admin `/admin/orders/new` ekranında "Kalemler" giriyor (açıklama + birim fiyat +
adet) ama bir kalemin **ne** olduğunu söyleyemiyor. ₺3.499'un ne kadarı baskı,
ne kadarı boyama — sistemde bu bilgi hiç yok.

## 2. Çözüm — kalem türü hakediş tabanını belirler

Ürünün/siparişin fiyatı **tam olarak iki tür kalemden** oluşur:

| Kalem türü | Hakediş tabanı |
|---|---|
| `production` — Üretim / baskı | Üretici |
| `painting` — Boyama | Boyacı |

```
fiyat            = Σ(production) + Σ(painting)          [zorunlu invariant]
üretici brüt     = Σ(production)
boyacı brüt      = Σ(painting)
üretici net      = %60 × Σ(production)
boyacı net       = %60 × Σ(painting)
platform         = %40 × fiyat
```

Toplam partner ödemesi fiyatın **%60'ı**; matematiksel olarak fiyatı geçmesi
imkânsız. Komisyon %35 → **%40**'a çıkar (partner net payı %65 → %60).

## 3. Bileşenler

### 3.1 `src/lib/config/cost-lines.ts` (yeni) — tek kaynak

```ts
export const COST_LINE_KINDS = ["production", "painting"] as const;
export type CostLineKind = (typeof COST_LINE_KINDS)[number];
export const COST_LINE_LABELS_TR: Record<CostLineKind, string>;

/** Kalemleri iki hakediş tabanına indirger. */
export function splitCostLines(lines: { kind: CostLineKind; amountKurus: number }[]):
  { productionKurus: number; paintingKurus: number };

/**
 * Bir kalem kırılımının oranlarını gerçek satır tutarına ölçekler.
 * En büyük kalan (largest-remainder) yöntemi — iki taban HER ZAMAN tam olarak
 * totalKurus'a eşitlenir, yuvarlama kaybı olmaz.
 */
export function allocateBases(args: {
  productionKurus: number;  // ürün tanımındaki kırılım
  paintingKurus: number;
  totalKurus: number;       // siparişte gerçekleşen satır tutarı
}): { productionKurus: number; paintingKurus: number };
```

Saf modül: DB yok, `server-only` yok — client bileşenleri de import edebilir
(`config/bulk.ts` ile aynı konvansiyon; bkz. worker-server-only tuzağı).

### 3.2 Komisyon oranı

`PLATFORM_COMMISSION_RATE_BPS`: `3500` → `4000` (`src/lib/config/prices.ts`).

### 3.3 Şema değişiklikleri (migration `0050_cost_lines`)

**Yeni tablo `product_cost_lines`:**

```
id            uuid pk
product_id    uuid not null → products(id) on delete cascade
kind          text not null            -- 'production' | 'painting'
label         text                     -- opsiyonel serbest açıklama
amount_kurus  integer not null
sort_order    integer not null default 0
created_at    timestamp not null default now()
index (product_id, sort_order)
```

**Yeni kolonlar:**

```
orders.production_base_kurus        integer NULL
order_drafts.production_base_kurus  integer NULL
```

`NULL` = kırılımı olmayan **eski** sipariş → bugünkü davranış aynen korunur
(kullanıcının kararı). `paintingPriceKurus` zaten var, değişmiyor.

`down` migration: iki kolonu düşürür, tabloyu düşürür. Yalnızca up'ın
eklediklerini geri alır, operatör verisine dokunmaz.

### 3.4 `src/lib/services/earning-base.ts` (yeni) — tek türetim noktası

Bugün üretici tabanı **beş** yerde ayrı ayrı hesaplanıyor
(`send-to-painter:124`, `assign-painter:188-192`, `revoke-after-painter`,
`ship:87`, `manufacturer/orders/[id]/page.tsx:329`). Hepsi tek fonksiyona iner:

```ts
export function manufacturerBaseKurus(order: {
  amountKurus: number;
  productionBaseKurus: number | null;
  paintingPriceKurus: number;
  painterId: string | null;
  paintsInHouse: boolean;   // yalnızca eski/kırılımsız siparişler için
}): number;

export function painterBaseKurus(order: {
  productionBaseKurus: number | null;
  paintingPriceKurus: number;
}): number;
```

Kural:
- `productionBaseKurus !== null` → üretici tabanı = `productionBaseKurus`,
  boyacı tabanı = `paintingPriceKurus`. **Üretici kendi boyuyorsa** (devretmediyse)
  taban = `productionBaseKurus + paintingPriceKurus` — işi o yaptığı için.
- `productionBaseKurus === null` (eski sipariş) → bugünkü kural birebir.

### 3.5 `needsPainting` türetilmiş hale gelir

`needsPainting = paintingPriceKurus > 0`. Kolon kalır (sorgular ve indeksler
kullanıyor) ama artık **her** sipariş yaratma yolunda kalem kırılımından yazılır:

- `/api/admin/orders/create` — kalem türlerinden
- `wa-order.ts` — ürün kırılımından / figür sabitlerinden
- `/api/orders` — ürün kırılımından (marketplace) veya mevcut sabitlerden (figür)
- `/api/admin/orders/[id]/edit` — `finish` değişince yeniden hesaplanır

Bu tek başına 1.2'deki hatayı kapatır: manuel/ürün/WhatsApp siparişleri ilk kez
boyacıya yönlendirilebilir olur.

### 3.6 Boyacı komisyon oranı dondurulur

`accruePainterEarning` (`painter-payouts.ts:21`) bugün **canlı sabiti** okuyor,
`orders.commissionRateBps`'i değil. `painter-onboarding.ts:142-143` ise
"komisyon oranı işi kabul ettiğiniz anda sabitlenir" diye taahhüt ediyor.
**%35→%40 değişikliği bu düzeltilmeden yayınlanırsa** uçuştaki her boyama işinin
neti ₺650'den ₺600'e geriye dönük düşer.

`accrueEarning`'in üretici tarafındaki deseni birebir uygulanır: `orders.commissionRateBps`
okunur, `NULL` ise sabite düşülür. (Not: bu, üreticinin kabul anında donan oran —
boyacı ataması her zaman `qc_approved`'dan sonra geldiği için oran zaten o an
sabitlenmiş oluyor; geriye dönük olmama taahhüdü karşılanır.)

`painter/jobs/page.tsx:156` de canlı sabit yerine siparişin donmuş oranını gönderir.

### 3.7 Ekranlar — kalem türü select box

**a) Admin manuel sipariş** (`/admin/orders/new`, `new-order-client.tsx`):
Her "Kalem" satırına **Tür** select'i eklenir (Üretim / baskı · Boyama).
Toplam zaten gösteriliyor; altına tür bazlı kırılım ve türetilen partner
payları eklenir. `lineItemSchema`'ya `kind` alanı eklenir.

**b) Admin ürün formu** (`/admin/products/new` + `[id]/edit-client.tsx`):
Fiyat alanı **kalemlerden hesaplanır** (kullanıcının kararı: "bu ikisi ürünün
fiyatını oluştursun"). Kalem editörü + canlı toplam + partner payı önizlemesi.

**c) Üretici/satıcı ürün formu** (`/manufacturer/products/new` + `[id]/edit-client.tsx`):
Aynı editör. Her iki form da `createProductSchema`'yı kullandığı için validator
tek yerde genişler.

**d) Üretici sipariş detayı** (`manufacturer/orders/[id]/page.tsx:329`):
Taban artık `earning-base.ts`'ten, siparişin gerçek durumundan türetilir —
`paintsInHouse` profil bayrağından değil. `client.tsx:640-644` dipnotu da
devir durumuna göre doğru metni gösterir. **1.1'deki hata kapanır.**

### 3.8 Sözleşme metinleri

- `src/lib/content/manufacturer-onboarding.ts:536` — %35/%65 → %40/%60
- `src/lib/content/painter-onboarding.ts:134` — %35/%65 → %40/%60
- Üretici sözleşmesindeki hakediş tabanı maddesi (`:548-555`) kalem modelini
  yansıtacak şekilde güncellenir.

⚠️ **İş tarafı:** `manufacturer-onboarding.ts` komisyon değişikliğinin
yürürlükten **en az 15 gün önce** kayıtlı e-postaya bildirilmesini taahhüt
ediyor. Kod tarafındaki geriye dönük koruma sağlanıyor (oran kabul anında
donuyor + 3.6 ile boyacı tarafı da donuyor), ancak **bildirimin gönderilmesi
kod dışı bir aksiyondur** ve operatöre aittir.

## 4. Veri akışı

```
ÜRÜN TANIMI                         SİPARİŞ                      TAHAKKUK
────────────                        ───────                      ────────
product_cost_lines                  orders.production_base_kurus  manufacturerBaseKurus()
  production: ₺2.400   ──┐          orders.painting_price_kurus   painterBaseKurus()
  painting:   ₺1.100     │            ▲                             │
  ───────────────────    ├─ oran ─────┘                             ├→ computeEarning(taban, donmuş oran)
  products.price ₺3.500  │  bazlı                                   │
                       ──┘  ölçekleme                               ↓
                            (opsiyon/addon/tier/adet                manufacturer_earnings
                             satır tutarını değiştirdiğinde)        painter_earnings
```

Admin manuel siparişinde ürün adımı atlanır: kalemler doğrudan siparişe girilir.

## 5. Hata yönetimi

- **Kalem toplamı ≠ fiyat** → 400, ürün kaydedilmez. Fiyat kalemlerden
  hesaplandığı için UI'da bu duruma düşmek zor; yine de sunucu tarafında zorunlu.
- **Kalemsiz ürün** → izinli; `production_base_kurus` NULL yazılır, eski davranış.
- **Negatif / taşan tutar** → mevcut `MAX_AMOUNT_KURUS` ve int4 sınırları aynen.
- **Ölçekleme** → largest-remainder; iki taban toplamı satır tutarına **tam**
  eşit. Test bunu rastgele 10.000 tutar üzerinde doğrular.

## 6. Test

`scripts/test-cost-lines.ts` (yeni, `test:unit`'e eklenir):

1. `splitCostLines` — boş liste, tek tür, karışık.
2. `allocateBases` — toplam korunumu (fuzz), sıfır boyama, sıfır üretim,
   ₺1 gibi bölünemeyen tutarlar.
3. `manufacturerBaseKurus` / `painterBaseKurus` — kırılımlı ve kırılımsız
   (eski) siparişler; devredilmiş / devredilmemiş; paintsInHouse.
4. **Ana invariant:** üretici brüt + boyacı brüt === amountKurus.
5. **Ana invariant:** üretici net + boyacı net + platform === amountKurus
   (yuvarlama kayması yok).
6. Yeni oran: %60/%40; donmuş oran (%35) olan eski sipariş %65 almaya devam eder.

`scripts/test-prices.ts` — `PLATFORM_COMMISSION_RATE_BPS === 4000` regresyonu.
`scripts/test-finance.ts` — mevcut testler oran değişikliğine karşı gözden geçirilir.

## 7. Kapsam dışı

Denetimde çıkan ve bu değişiklikle ilgisi olmayan bulgular ayrı tutuldu:
havale indiriminin `/pay`'de gösterilip PayTR'de tahsil edilmemesi, sepet
upsell'lerinin alt siparişlere düşmemesi, ödenmiş payout sonrası iade clawback'i,
`revoke-after-painter` yarış koşulları. Bunlar bu dalda **değiştirilmez**;
ayrıca raporlanır.
