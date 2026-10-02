# Google Business Profile + Bing Places — doldurma listesi

**Neden bu dosya var.** ChatGPT'ye "figür nerede yaptırabilirim" diye sorulduğunda
cevabın en üstüne yıldızlı bir işletme listesi geliyor (ölçülen örnek,
2026-10-02: S3D Designed, Frostblack 3D, Tuzla 3D Tarama). O blok **site
metninden gelmiyor** — Google/Bing işletme kaydından geliyor. Kaydı olmayan bir
marka o bloğa hiçbir içerik iyileştirmesiyle giremez.

Kaydı **işletme sahibi** açmak zorunda: hesap onun adına açılıyor ve Google
adres/telefon doğrulaması istiyor (kart, telefon ya da video). Aşağıdaki
alanların tamamı siteden doğrulanmış gerçek değerlerdir; kaynak dosya her
satırda yazılı. **Uydurulmuş hiçbir değer yok; eksik olanlar "SENDEN" diye
işaretli.**

Kayıt açıldıktan sonra bana Maps bağlantısını ver: `sameAs`'e ve `LocalBusiness`
şemasına eklerim — site ile işletme kaydı o zaman **aynı varlık** olarak
eşleşir. O eşleşme olmadan iki ayrı şey gibi görünürüz.

---

## 1. Temel bilgiler

| Alan | Değer | Kaynak |
|---|---|---|
| İşletme adı | `Figurunica` | `src/lib/config/business-identity.ts:18` |
| Telefon | `+90 850 840 73 03` | `src/lib/config/contact.ts:1` |
| E-posta | `info@figurunica.com` | `contact.ts:4` |
| Web sitesi | `https://figurunica.com` | — |
| Adres | `Şehit Osman Avcı Mahallesi, Akın 688 Sitesi B32, 06820 Etimesgut / Ankara` | `business-identity.ts:30-43` |
| VKN | `8841014310` | `business-identity.ts:21` |

**Kuruluş yılı — SENDEN.** Şemada `foundingDate` alanı boş; Google da "açılış
tarihi" soruyor. Yıl (gerekirse ay) söyle, hem kayda hem siteye girsin.

**Yasal unvan eki — SENDEN.** Sitede yalnız "Figurunica" yazıyor; `Ltd. Şti.` /
`A.Ş.` / şahıs şirketi ibaresi yok. Mesafeli satış sözleşmesinde tam unvanın
yazması gerekiyor; kayıtta da tam unvan isteniyor.

---

## 2. Kategori — doğru seçim önemli

Google'ın kategorisi, hangi sorularda çıktığını belirliyor.

- **Birincil:** `3D printing service` (Türkçe arayüzde "3D baskı servisi")
- **İkincil olarak ekle:** `Gift shop` · `Souvenir store` · `Model shop`

Gerekçe: ölçülen cevapta çıkan üç işletmenin üçü de `3D printing service`
kategorisinde. Ama bizim müşterimiz "hediye" arıyor, o yüzden hediye
kategorileri ikincil olarak gerekli.

---

## 3. Hizmet alanı — şehir değil, ÜLKE

Bu kritik: **Etimesgut'u hizmet alanı olarak seçme.** Kayıt tipini "hizmet
bölgesi olan işletme" yap ve bölgeyi **Türkiye** olarak ver.

Gerekçe: ölçülen cevapta BADU CRAFT'ın alıntılanma sebebi tam olarak
"Türkiye'nin 81 iline kargo gönderdiğini belirtiyor" cümlesiydi. Site de bunu
söylüyor (`Yurtiçi Kargo ile Türkiye içi ücretsiz`, `src/app/kargo/page.tsx:84`);
kaydın da aynı şeyi söylemesi gerekiyor, yoksa "Ankara'da bir dükkân" gibi
görünürüz ve Ankara dışındaki sorularda hiç çıkmayız.

---

## 4. İşletme açıklaması (750 karakter sınırı)

Aşağıdaki metin siteden doğrulanmış rakamlarla yazıldı — rakamlar alıntılanmanın
sebebi, o yüzden hiçbirini çıkarma:

> Fotoğraftan kişiye özel 3D figür üretiyoruz. Yüklediğiniz fotoğraftan yapay
> zekâ destekli tasarımı çıkarıyor, onayınızdan sonra 15 cm boyunda SLA reçine
> baskıyla (25 mikron katman) üretiyor ve atölyemizde profesyonel el boyamasıyla
> boyuyoruz. Tek fiyat 3.499 TL, KDV dahil; Türkiye içi kargo ücretsiz. Üretim
> 5-7 iş günü, kargo 2-3 iş günü. Doğum günü, yıl dönümü, evcil hayvan ve
> mezuniyet hediyesi olarak hazırlanıyor. Ayrıca fotoğraftan anahtarlık (149 TL),
> buzdolabı magneti (129 TL) ve gece lambası (399 TL) üretiyoruz. Kendi 3D
> modelinizi (STL, OBJ, 3MF) yükleyip FDM veya SLA baskı için anında fiyat
> alabilirsiniz; FDM 74 TL'den, SLA 123 TL'den başlıyor.

Rakamların kaynakları: ₺3.499 `src/lib/config/prices.ts:31` · 15 cm
`SIZE_PRESETS[0].heightMm=150` · 25 µm `tr.ts:2708-2710` · 5-7 / 2-3 iş günü
`src/app/nasil-calisir/page.tsx:114,118` · ₺149/₺129/₺399 `prices.ts:355-357` ·
₺74 / ₺123 katalog tohumu.

---

## 5. Hizmet kalemleri (fiyatlı)

Google "Hizmetler" bölümüne fiyatla girilebiliyor ve bu alan alıntılanıyor:

| Hizmet | Fiyat | Açıklama |
|---|---|---|
| Fotoğraftan kişiye özel figür | 3.499 TL | 15 cm, SLA reçine, profesyonel el boyamalı, ücretsiz kargo |
| Fotoğraftan anahtarlık | 149 TL | — |
| Fotoğraftan buzdolabı magneti | 129 TL | — |
| Fotoğraftan gece lambası | 399 TL | — |
| 3D baskı — FDM (filament) | 74 TL'den başlar | Kendi modelinizi yükleyin, anında fiyat |
| 3D baskı — SLA (reçine) | 123 TL'den başlar | Kendi modelinizi yükleyin, anında fiyat |

Asgari sipariş tutarı 200 TL (anlık teklif için).

---

## 6. Fotoğraflar — en az 10 tane

Google boş profilleri sıralamada düşürüyor. Gerekenler:

1. Boyanmış bitmiş figür (yakın plan, 3-4 farklı açı)
2. Fotoğraf → figür karşılaştırması (yan yana) — en çok tıklanan görsel tipi
3. Yazıcı çalışırken (reçine tankı görünür)
4. El boyama aşaması
5. Kargo paketi / kutusu
6. Boya kiti

**SENDEN.** Sitede gerçek bir logo dosyası bile yok
(`src/lib/seo/organization.ts:18-20`: "no real logo file exists"). Logo da
gerekiyor.

---

## 7. Yorumlar — sıralamanın asıl yakıtı

Ölçülen üç işletmenin puanları 4.8, 4.9 ve 5.0. Yorumsuz bir kayıt o listeye
girmez.

- Teslim edilen her siparişten sonra yorum isteyen bir mesaj (sipariş yolculuğu
  sayfası `/yolculuk/<token>` bunun için uygun yer — karekod zaten kutuda).
- **Yorum satın alma, kendine yorum yazma.** Google bunları tespit edip kaydı
  askıya alıyor; ayrıca sitenin JSON-LD'si bilerek `aggregateRating`
  taşımıyor (`organization.ts:11-14`, Google'ın kendi-kendine-yorum politikası).

---

## 8. Bing Places — ayrı kayıt, ChatGPT için ASIL olan

ChatGPT'nin retrieval'ı **Bing** indeksinde çalışıyor
(`src/lib/services/indexnow.ts:7-11`), yani Bing tarafı Google'dan daha önemli.

1. **Bing Places** (`bingplaces.com`) — Google profili açıldıktan sonra oradan
   içe aktarma yapabiliyor, en kolay yol bu.
2. **Bing Webmaster Tools** (`bing.com/webmasters`) — siteyi ekle ve doğrula.
   Bu olmadan IndexNow gönderimlerinin karşılığını göremiyoruz.
3. Doğrulamadan sonra bana haber ver: `INDEXNOW_KEY` ortam değişkeninin canlıda
   dolu olup olmadığını kontrol edeceğim — boşsa IndexNow hiç çalışmıyor
   (`indexnow.ts:27-30`, anahtar yoksa sessizce `no_key` dönüyor).

---

## 9. Benden bekleyeceklerin (kayıt açıldıktan sonra)

- `LocalBusiness` şeması + `sameAs`'e Maps bağlantısı — site ile kayıt aynı
  varlık olarak eşleşsin
- Footer adresine posta kodunun eklenmesi (`CONTACT_ADDRESS_FULL` şu an `06820`
  taşımıyor, `contact.ts:7`) — NAP bloğunun eksiksiz olması eşleşmeyi
  kolaylaştırıyor
- Kuruluş yılı ve tam yasal unvan verildiğinde şemaya ve yasal sayfalara girmesi
