# Atölye seans sistemi — tasarım

Tarih: 2026-09-04
Durum: onaylandı, uygulanacak

## 1. Ne isteniyor

```
kafe/mekan başvurusu → mekan sisteme eklenir → seans (gün+saat) açılır
  → o seansa özel public link → katılımcılar 5 gün öncesine kadar
     fotoğraf gönderir ve öder
  → siparişler seansa yetişecek şekilde üretilir
  → seanstan 1 gün önce HEPSİ tek seferde mekana teslim edilir
```

Katılımcı **boyanmamış** kişiye özel figür alır (₺1.350); boyama işi seansın
kendisidir, mekanda yapılır. Boyacı partneri bu akışa hiç girmez.

## 2. Bugün ne var, ne yok

`workshopRequests` (migration 0028, Temmuz 2026'da canlıya alındı) **saf bir
lead formu**: tek tablo, bir public POST, bir admin mutasyonu, altı durum. Mekan
yok, seans yok, kontenjan yok, katılımcı yok, ödeme yok, siparişle bağ yok.
Onaylı bir talep = üzerinde bir tarih ve bir teklif rakamı olan satır; hiçbir şey
üretmiyor (`src/lib/db/schema.ts:1083-1137`, `src/app/api/admin/workshop-requests/[id]/update/route.ts`).

Denetimde çıkan ve tasarımı belirleyen dört gerçek:

**(a) Sipariş = ödenmiş sipariş.** `orders` satırları yalnızca
`promoteDraftToOrder` içinde, `status:"paid"` sabitiyle yazılıyor
(`order-draft.ts:243,376`). Ödenmemiş niyet `orderDrafts`'ta yaşıyor. Bu,
"ödemeyen üretime girmez" kuralına birebir uyuyor — katılımcı ödeyene kadar
ortada sipariş yok, sadece taslak var.

**(b) Figür yalnızca `hand_painted` olabiliyor.** `validators/order.ts:28`
→ `FIGURE_FINISHES = ["hand_painted"]`, ve `coerceFinishForStyle` (2026-09-01'de
eklendi) figüre yazılan `paintable_kit`'i `hand_painted`'e geri çeviriyor.
Boyanmamış atölye figürü ayrı bir fiyat türü olmak zorunda; mevcut türe
kılıf geçirilemez.

**(c) Kargosuz teslim imkânsız.** `carrierEnum` (`schema.ts:266-273`) `elden`
içermiyor; `delivered` olmak `shipped` şart, `shipped` olmak takip numarası şart
(`validators/order.ts:160-168`). Yurtiçi entegrasyonu sipariş başına tek koli
(`yurtici-kargo.ts:76` `cargoCount: 1`). Konsolidasyon kavramı hiç yok —
`parentReference` tam tersini yapıyor, sepeti satıcı başına böler.
İlginç olan: `elden` **zaten var**, ama yalnızca üretici→boyacı bacağında
(`orders.painterHandoffCarrier`, düz `text`). Desen kanıtlı, müşteri bacağına
taşınmamış.

**(d) Üretim planlaması diye bir şey yok.** `orders`'ta 17 timestamp kolonu var
ve **hiçbiri hedef tarih değil** — hepsi olan bitenin damgası. Üretici
sıralayıcısı da tarih körü: mesafe/yük/güvenilirlik/parti-yakınlığı ile puanlıyor,
`onTimeDelivery` ağırlığı v1'de **0** (`manufacturer-scoring.ts:51-58`).

## 3. 5 günün gerçekçiliği

Kodun kendi zamanında-teslim hedefleri (`manufacturer-assignment.ts:57-58`):

```
OTD_PRINT_TARGET_MS = 7 gün   (atama → baskı bitti)
OTD_SHIP_TARGET_MS  = 3 gün   (baskı → kargo)
```

Üstüne 24 saatlik üretici kabul SLA'sı. Sistemin kendi normu **~10 gün**;
pencere 5 gün. (Not: ilk analizde "48 saatlik müşteri 3D onayı atlanarak zaman
kazanılır" denmişti — **yanlıştı**. Bugünkü figür akışında o adım yok:
`upload-model/route.ts:134` siparişi `awaiting_model` → doğrudan `approved`
yapıyor; `awaiting_customer_approval` kaldırılmış otomatik-3D akışının kalıntısı.)

5 günü gerçekçi kılan üç şey:

1. **Üretici seans açılırken ön rezerve edilir**, link kapanınca atanmaz. Soğuk
   atama + 24 saat kabul beklemesi ortadan kalkar; üretici tarihi baştan
   taahhüt eder.
2. **Boyama bacağı yok.** Üretici→boyacı devri, boyacı kabul SLA'sı ve ikinci
   kargo bacağı komple silinir.
3. **Tek parti, tek plaka.** Seansın tüm figürleri birlikte basılır — merdivenli
   komisyonun dayandığı ekonomi de budur.

Kalan gerçek darboğaz **admin'in kişi başı elle GLB üretmesi**. 20 kişilik seans
= 5 günde 20 model. Sistem bunu hızlandıramaz; **görünür kılar**: seans panelinde
"12/18 model hazır" sayacı ve modeli eksik katılımcı uyarısı.

## 4. Veri modeli (migration 0051)

### `workshopVenues` — kalıcı mekan

```
id                uuid pk
requestId         uuid → workshop_requests(id)   -- nullable: admin doğrudan da ekleyebilir
name              text not null                  -- "Kahve Dünyası Moda"
contactName/Email/Phone   text not null
address           jsonb not null                 -- TurkishAddress (posta kodu DAHİL)
status            text not null default 'active' -- active | paused | archived
notes             text
createdAt/updatedAt
```

`address` neden jsonb: sipariş adresi de `TurkishAddress` jsonb
(`schema.ts:590`) ve seans siparişlerine **birebir kopyalanacak**. Aynı tipte
tutmak dönüşümü ortadan kaldırır. Başvuru formu bugün posta kodu toplamıyor
(`workshopRequests` il/ilçe/adres tutuyor) — sipariş adresi `/^\d{5}$/` şartı
koyduğu için mekana dönüştürürken admin posta kodunu girer.

### `workshopSessions` — bir mekandaki bir gün+saat

```
id                   uuid pk
venueId              uuid not null → workshop_venues(id)
startsAt             timestamp not null
durationMinutes      integer not null default 120
capacity             integer not null
bookedCount          integer not null default 0   -- koşullu UPDATE ile artar
joinToken            text not null unique         -- nanoid(12)
joinClosesAt         timestamp not null           -- varsayılan startsAt − 5 gün
deliverBy            timestamp not null           -- varsayılan startsAt − 1 gün
pricePerSeatKurus    integer not null default 135000
manufacturerId       uuid → manufacturers(id)     -- seans açılışında ön rezerve
manufacturerCommittedAt  timestamp
commissionRateBps    integer                      -- kapanışta donar (bkz. §6)
batchCarrier         text                         -- 'yurtici' | 'elden' | ...
batchTrackingNumber  text
batchShippedAt       timestamp
batchDeliveredAt     timestamp
status               workshop_session_status not null default 'draft'
adminNotes           text
createdAt/updatedAt
index (venueId, startsAt), unique (joinToken)
```

Durum akışı: `draft → open → closed → in_production → shipped → delivered → completed`,
ayrıca her aşamadan `cancelled`.

`joinClosesAt` ve `deliverBy` **hesaplanıp saklanır**, her okumada yeniden
türetilmez: admin tek bir seansta kaydırabilmeli, ve geçmiş seansların kuralı
sonradan değişen bir sabitle bozulmamalı.

### `workshopParticipants` — linkten katılan kişi

```
id              uuid pk
sessionId       uuid not null → workshop_sessions(id)
draftId         uuid → order_drafts(id)     -- ödeme öncesi
orderId         uuid → orders(id)           -- ödeme sonrası
fullName        text not null
email           text not null
phone           text not null               -- E.164
photoKey        text not null               -- photos/<nanoid>.jpg
kvkkConsentAt   timestamp not null
contentConsentAt timestamp not null
status          text not null default 'pending_payment'
                -- pending_payment | paid | model_ready | in_production | delivered | cancelled
createdAt/updatedAt
index (sessionId, createdAt)
```

### `orders` kolonu

```
workshopSessionId  uuid → workshop_sessions(id)   -- nullable
```

Geri bağ; parti sorguları, toplu sevk ve "bu sipariş bir atölye siparişi" kararı
bunun üstünden. NULL = normal sipariş, davranış hiç değişmez.

### `carrierEnum`

```sql
ALTER TYPE carrier ADD VALUE IF NOT EXISTS 'elden';
```

`ADD VALUE` geri alınamaz (PostgreSQL enum'dan değer düşürmez), bu yüzden down
migration bunu **bilerek bırakır** ve nedenini yazar.

## 5. Akışlar

### 5.1 Mekan kaydı

Mevcut `/atolye` formu aynen kalır. Admin talep detayına **"Mekana dönüştür"**
aksiyonu eklenir: form alanlarını ön-doldurur, admin posta kodunu ve mekan adını
tamamlar, `workshopVenues` satırı doğar ve `workshopRequests.status = 'scheduled'`
olur. Talep→mekan bağı `requestId` ile korunur.

Admin ayrıca talepsiz doğrudan mekan da ekleyebilir (`requestId = NULL`) — mekan
telefonla anlaşılmış olabilir.

### 5.2 Seans açma

`/admin/workshops/[venueId]` → "Seans aç": tarih+saat, kontenjan, kişi başı fiyat
(varsayılan ₺1.350), üretici seçimi.

Üretici seçilirken sistem **risk uyarısı** gösterir: seansa kalan gün sayısı, o
üreticinin son 20 işindeki ortalama atama→baskı süresi
(`manufacturer-assignment.ts:191-229`'daki OTD verisi) ve mevcut yükü. Riskliyse
kırmızı uyarı çıkar ama **engellemez** — admin yine de açabilir.

Seans `open` olunca `joinToken` mintlenir (lazy + yarış-güvenli, `ensureJourneyToken`
deseni birebir: `order-journey.ts:82-119`).

Üreticiye bildirim gider: tarih, kontenjan, kişi başı fiyat ve **hacim merdiveni**.
Üretici panelinden taahhüt eder → `manufacturerCommittedAt` damgalanır.

### 5.3 Katılımcı linki — `/atolye/katil/<token>`

`export const dynamic = "force-dynamic"`, `robots: { index: false, follow: false, nocache: true }`,
bulunamayan token `notFound()` — yanlış/silinmiş/uydurma token ayırt edilemez.
Bu iskelet `src/app/yolculuk/[token]/page.tsx`'ten birebir kopyalanır.

Sayfa gösterir: mekan adı+adresi, gün+saat, kalan kontenjan, son katılım tarihi.
Form: ad, e-posta, telefon, fotoğraf, iki onay kutusu:
- KVKK açık rıza
- İçerik hakları — `tr.ts:861`'deki mevcut metin: *"…fotoğraftaki kişi(ler)in
  (çocuksa velisinin) açık rızasını aldığımı…"*. Doğum günü ve okul etkinlikleri
  çocuk fotoğrafı demek; bu cümle zorunlu.

Gönderim → `workshopParticipants` + `orderDrafts` yaratılır → PayTR'ye gider.

**Kısa devre:** AI önizleme yok, varyasyon seçimi yok. `/api/preview/generate`
login + doğrulanmış e-posta istiyor; kafedeki yabancı katılımcı bunu geçemez ve
zaten ihtiyaç da yok — ürün ham baskı, boyama seansın kendisi.

**Kapanış koşulları** (sunucuda, her istekte):
- `now > joinClosesAt` → kapalı
- `bookedCount >= capacity` → dolu
- `status !== 'open'` → kapalı

**Kontenjan yarışı** koşullu UPDATE ile çözülür, oku-sonra-yaz ile değil:

```sql
UPDATE workshop_sessions
   SET booked_count = booked_count + 1
 WHERE id = $1 AND status = 'open' AND booked_count < capacity
   AND now() < join_closes_at
RETURNING booked_count
```

0 satır dönerse koltuk kapılmıştır → 409, taslak yaratılmaz.

Koltuk **ödeme başlarken** rezerve edilir ve taslak süresi dolarsa
(`payment-deadline` kuyruğu) **geri bırakılır** — aksi hâlde ödemeyen biri
koltuğu süresiz tutar.

### 5.4 Ödeme → sipariş

PayTR webhook'u taslağı promote eder (mevcut akış, değişmez). Promote edilen
sipariş atölyeye özgü değerleri taşır:

```
orderType            'custom'          -- kişiye özel: MSY m.15/1-(b) cayma istisnası
priceKind            'workshop_figure' -- YENİ
finish               'paintable_kit'
needsPainting        false
amountKurus          135000
productionBaseKurus  135000            -- kalem modeli: tamamı üretim kalemi
paintingPriceKurus   0
workshopSessionId    <seans>
shippingAddress      <MEKANIN adresi>  -- toplu teslimat buradan doğal olarak çıkıyor
```

`manufacturerId` promote anında YAZILMAZ. Üretici ataması ve komisyon oranı
seans kapanışında, parti bir bütün olarak kesinleşince yazılır (§5.5) — oran
sipariş adedine bağlı olduğu için taslak taslak atamak, üreticinin paneline
oranı bilinmeyen siparişler düşürürdü.

`shippingAddress` mekanın adresi olunca toplu teslimat ayrı bir mekanizma
gerektirmiyor: koliler zaten aynı adrese gidiyor, üzerlerinde katılımcının adı
yazıyor.

`priceKind: 'workshop_figure'` yeni bir tür; `FINISHES_BY_KIND`'a
`workshop_figure: ["paintable_kit"]` eklenir, böylece `coerceFinishForStyle`
bu türü `hand_painted`'e çevirmez.

### 5.5 Üretim

Link kapanınca (`joinClosesAt` geçince, zamanlanmış iş) seans `closed` olur,
sipariş adedi kesinleşir, **komisyon oranı donar** (§6) ve tüm seans siparişleri
ön rezerve üreticiye düşer — kabul beklemesi yok, `manufacturerStatus = 'assigned'`
doğrudan `accepted` olarak yazılır (üretici zaten taahhüt etmişti).

Admin her katılımcı için GLB yükler (mevcut `upload-model` akışı, değişmez).
Seans paneli "12/18 model hazır" sayacı ve eksik olanların listesini gösterir.

### 5.6 Teslimat

Seans panelinde tek aksiyon: **"Toplu sevk"**. Taşıyıcı (`yurtici` veya `elden`)
ve tek takip numarası girilir; N siparişin hepsi tek işlemde `shipped` olur,
`batchTrackingNumber` seansta saklanır.

Katılımcı **"kargoya verildi, takip no …"** maili almaz — atölyeye özel şablon:
*"Figürün hazır ve <mekan>'da seni bekliyor. <gün> <saat>'te görüşürüz."*

Seans günü admin **"Toplu teslim edildi"** der; siparişler `delivered` olur.
Bugünkü `deliver/route.ts` `shipped` şartı koştuğu için sıra korunur.

## 6. Üretici payı — hacim merdiveni

Talep: 1 sipariş → %60, dolu parti → %40. Gerekçe ekonomik: 20 figürü tek plakada
basmak, birini basmaktan birim başına çok daha ucuz.

**Merdiven kontenjana değil, GERÇEK sipariş adedine bağlanır.** Kapasiteye
bağlanırsa 50 kişilik seansta 10 sipariş ile 20 kişilik seansta 10 sipariş —
üretici için aynı iş — farklı ücret alır. Bu yanlış olur.

| Seanstaki ödenmiş sipariş | Üretici payı | `commissionRateBps` |
|---|---|---|
| 1–2 | %60 | 4000 |
| 3–5 | %55 | 4500 |
| 6–10 | %50 | 5000 |
| 11–15 | %45 | 5500 |
| 16+ | %40 | 6000 |

Doğrusal formül yerine merdiven, çünkü (a) sözleşmede tek cümleyle anlatılabiliyor,
(b) üretici kabul etmeden önce net payını kesin görebiliyor, (c) projede zaten
`productPriceTiers` (minQuantity → fiyat) deseni var, aynı zihinsel model.

Tek kaynak: `src/lib/config/workshop.ts` → `WORKSHOP_COMMISSION_TIERS`.
Saf modül (DB yok, `server-only` yok) — hem admin arayüzü hem üretici paneli
hem sunucu aynı fonksiyonu çağırır.

**Oran ne zaman donar:** link kapanınca, tüm seans siparişlerine aynı değerle
yazılır. Erken katılan %60, geç katılan %40 almaz — herkes aynı partide aynı
orandadır. `orders.commissionRateBps` zaten sipariş bazında donuyor
(`accept/route.ts:41`) ve hem `accrueEarning` hem `accruePainterEarning` onu
okuyor (2026-09-01), yani mekanizma hazır.

Kalem modeliyle ilişki: boyama kalemi olmadığı için ₺1.350'nin tamamı üretim
kalemidir. 18 kişilik bir seansta üretici net payı 18 × ₺540 = ₺9.720,
platform ₺14.580.

## 7. Sözleşme etkisi

`manufacturer-onboarding.ts:536` şu an düz bir cümle kuruyor:
*"Güncel Platform komisyonu %40, üreticinin net payı ise %60."* Atölye partileri
bunu kırıyor.

Madde şuna dönüşür: tekil siparişlerde net pay %60; **atölye partilerinde**
kabul öncesi gösterilen hacim merdiveni geçerlidir (%60'tan %40'a). Sözleşme
zaten "oran kabul anında sabitlenir ve panelde şeffaf gösterilir" diyor, yani
değişken oran ifade edilebilir — eksik olan merdivenin kendisi.

`MANUFACTURER_CONTRACT_VERSION` 3.0 → **3.1**, metin başlığındaki yürürlük
tarihi güncellenir. 2026-09-01'deki %35→%40 değişikliği için 15 günlük bildirim
borcu zaten vardı; bu ikisi **tek bildirimde** birleştirilebilir.

Boyacı sözleşmesi değişmez — atölye akışına boyacı hiç girmiyor.

## 8. Güvenlik ve kötüye kullanım

- **Token**: `nanoid(12)`, 64 sembollük alfabe ≈ 72 bit. Düz metin saklanır +
  DB unique. Ev kuralı bu (`order-journey.ts:18-20`); yetki tokenlarında süre
  yok, ama seansın `joinClosesAt`'i doğal bir süre sınırı.
- **Sayfa**: `noindex, nofollow, nocache` + `notFound()`. Bulunamayan token,
  uydurma tokendan ayırt edilemez.
- **Hız sınırı**: public POST'ta mevcut `rate-limit.ts` helper'ı — IP başına ve
  token başına. Foto yükleme + taslak yaratma pahalı işler.
- **Ödeme kapısı doğal savunma**: katılımcı ₺1.350 ödemeden hiçbir üretim
  tetiklenmiyor. AI üretimi de akışta olmadığı için, `/create`'i login+e-posta+
  telefon arkasına koyan kötüye kullanım riski burada yok.
- **Fotoğraf**: mevcut `/api/upload` yolu, `photos/` öneki, `..` reddi
  (`orders/route.ts:499-505` ile aynı kontrol).

## 9. Hata yönetimi ve uç durumlar

| Durum | Davranış |
|---|---|
| Koltuk yarışı | Koşullu UPDATE 0 satır → 409, taslak yaratılmaz |
| Ödeme tamamlanmadı | Taslak süresi dolar (`payment-deadline` kuyruğu) → koltuk geri bırakılır |
| Link kapandıktan sonra giriş | Sayfa "katılım kapandı" gösterir, form render edilmez |
| Seans iptal | Ödenmiş siparişler mevcut admin iade akışıyla iade edilir; katılımcılara bildirim |
| Tek katılımcının modeli yetişmedi | O katılımcı iptal + iade; parti kalanla devam eder |
| Seans hiç sipariş almadı | Kapanışta otomatik `cancelled`; üreticiye bildirim |
| Üretici taahhüdü geri çekti | Seans `open` kalır, admin başka üretici seçer; risk uyarısı yeniden hesaplanır |
| Mekan adresi değişti | `workshopVenues.address` güncellenir; **açılmamış** seanslar yeni adresi alır, açık seansların siparişleri snapshot'ı korur |

## 10. Test

`scripts/test-workshop-sessions.ts` (yeni, `test:unit`'e eklenir):

1. **Komisyon merdiveni** — her kademe sınırı (1,2,3,5,6,10,11,15,16,17,100),
   monotonluk (sipariş arttıkça pay asla artmaz), sınırlar [4000, 6000] içinde.
2. **Kontenjan** — koşullu UPDATE mantığının saf karşılığı: dolu seans, kapanmış
   seans, taslak seans reddedilir.
3. **Tarih türetme** — `joinClosesAt = startsAt − 5g`, `deliverBy = startsAt − 1g`;
   geçmiş tarihli seans açılamaz.
4. **Sipariş alanları** — atölye siparişi `needsPainting=false`,
   `paintingPriceKurus=0`, `productionBaseKurus = amountKurus`; kalem invariantı
   korunur (2026-09-01 modeliyle uyum).
5. **`workshop_figure` yüzey kapısı** — `coerceFinishForStyle` bu türde
   `paintable_kit`'i `hand_painted`'e ÇEVİRMEZ; figür türünde hâlâ çevirir.

## 11. Migration 0051 (up + down)

**Up:** `workshop_venues`, `workshop_sessions`, `workshop_participants`
tabloları; `workshop_session_status` enum; `orders.workshop_session_id` kolonu;
`ALTER TYPE carrier ADD VALUE IF NOT EXISTS 'elden'`. `lock_timeout = '5s'`
(canlıda `orders` sürekli okunuyor).

**Down:** üç tabloyu ve `orders.workshop_session_id` kolonunu düşürür.
**`carrier` enum değeri BIRAKILIR** — PostgreSQL enum'dan değer düşüremez ve
`elden` yazılmış satırlar varsa veri kaybı olur. Down dosyası bunu açıkça yazar.
Gidiş-dönüş (up → down → up) scratch şemada doğrulanır.

## 12. Kapsam dışı (v2)

- Mekan paneli (kendi seanslarını açma/görme) — v1'de admin yönetir
- Mekan payı/komisyonu — v1'de yok, para akışı platform↔üretici arasında
- Tekrarlayan seans serisi (haftalık/aylık RRULE)
- Katılımcı check-in / yoklama
- Atölye siparişleri için ayrı KDV/fatura akışı — mevcut fatura mantığı aynen
- Katılımcının AI önizleme görüp varyasyon seçmesi — kısa devrenin özü bunu
  atlamak
