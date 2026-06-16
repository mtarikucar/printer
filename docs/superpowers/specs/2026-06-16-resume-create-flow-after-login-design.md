# Giriş Sonrası Üretim Akışına Kaldığı Yerden Devam — Tasarım

Tarih: 2026-06-16

## Problem

Misafir kullanıcı bir AI-üretim akışında çalışıp "önizleme çıkar"a bastığında
login ekranına yönlendiriliyor. Giriş yaptıktan sonra çıplak `/create` sayfasına
dönüyor; URL'de path olmadığı için kullanıcı path-selector ekranına düşüyor ve
yaptığı tüm seçimler (fotoğraf, boyut, stil, materyal) kayboluyor.

### Kök neden (`src/app/create/page.tsx`)

`CreateRouter` (≈satır 1962), hangi akışın gösterileceğine `?path=` parametresine
göre karar veriyor:

- `?path=upload` → `UploadModelFlow`
- `?path=design` → `DesignToProductFlow`
- aksi halde `hasContext` (path/style/previewId/fromOrder) varsa `CustomCreateFlow`,
  yoksa `CreatePathSelector`.

İki akış üretim adımında girişi zorunlu kılıyor:

1. **Fotoğraf akışı (`CustomCreateFlow`)** — `handleGeneratePreview` içinde
   `loggedIn === false` ise state'i `sessionStorage` (`createFlowState`) anahtarına
   kaydedip `router.push("/login?redirect=/create")` yapıyor. State save/restore
   mantığı doğru çalışıyor; **tek hata** redirect hedefinin çıplak `/create` olması:
   dönüşte path olmadığı için `CustomCreateFlow` hiç mount olmuyor, dolayısıyla
   restore effect'i çalışmıyor.

2. **Tasarım akışı (`DesignToProductFlow`)** — hiç giriş kontrolü yok. Misafir
   "üret"e basınca `/api/preview/generate` doğrudan **401** (`code: auth_required`)
   dönüyor, ekrana genel hata basılıyor, hiçbir state kaydedilmiyor, login'e bile
   yönlendirilmiyor. İş tamamen kayboluyor.

**STL akışı (`UploadModelFlow`)** kapsam dışı: üretim için giriş zorunlu değil
(`/api/upload/model` misafire açık, `userId` null kabul ediyor); kimlik yalnızca
ödeme adımında `CheckoutForm`'da gerekiyor.

## Hedef

Misafir, fotoğraf veya tasarım akışında "üret"e basıp login'e yönlendirildiğinde;
giriş/kayıt sonrası **aynı akışa, tüm seçimleri geri yüklenmiş** halde dönsün ve
tek tıkla üretime devam edebilsin. Üretim otomatik tetiklenmez (para harcadığı için
kullanıcı onaylayarak başlatır).

## Değişiklikler

### 1. Login redirect path'ini koru (fotoğraf akışı — asıl bug)

`src/app/create/page.tsx`, `handleGeneratePreview` içindeki:

```ts
router.push("/login?redirect=/create");
```

şununla değiştirilir:

```ts
router.push(`/login?redirect=${encodeURIComponent("/create?path=photo")}`);
```

`?path=photo` dönüşte `CustomCreateFlow`'u mount eder; mevcut restore effect'i
(`createFlowState`) çalışır. Restore zaten `selectedStyle` dahil tüm alanları geri
yüklediği için, `?style=`/`?path=object` ile girilmiş olsa bile genel `?path=photo`
yeterlidir. Fotoğraf akışı için başka değişiklik gerekmez.

### 2. Tasarım akışına çalışma-koruma ekle (`DesignToProductFlow`)

`src/components/create/design-to-product-flow.tsx`:

1. **Auth durumu**: mount'ta `/api/auth/me` ile `loggedIn` (`boolean | null`) ve
   `currentUserId` çek.
2. **`handleGenerate` başında gate**: `loggedIn === false` ise `photoKey` +
   `photoPreview`'i `sessionStorage` (`designFlowState` anahtarı, `userId` etiketiyle)
   kaydet, `router.push("/login?redirect=" + encodeURIComponent("/create?path=design"))`.
3. **Mount'ta restore effect**: `loggedIn` çözülünce (`!== null`) `designFlowState`
   oku; cross-user guard uygula (anonim kayıt = `userId:null` herkesçe kabul;
   kullanıcıya özel kayıt yalnızca aynı kullanıcıca kabul); `photoKey`+`photoPreview`'i
   geri yükle; anahtarı sil.

Guard mantığı `CustomCreateFlow`'daki ile aynı: `savedFor !== null && savedFor !==
currentFor` ise reddet ve temizle.

### 3. Step-3 misafir "giriş yap" linki (küçük ek)

`src/app/create/page.tsx` ≈satır 1581'deki misafir checkout'undaki
`<Link href="/login?redirect=/create">` linki, üretilmiş önizlemeyi korumak için
`previewId` varsa `?previewId=<id>` taşıyacak şekilde dinamik yapılır
(mevcut `?previewId=` restore effect'i önizlemeyi geri getirir). Adres formu alanları
bu kapsamda kaydedilmez (gelecekteki iş).

## Kapsam dışı / dokunulmuyor

- STL yükleme akışı (misafire açık).
- Email/telefon doğrulama gate'i: davranış korunur. Yeni kayıt olan kullanıcının
  email'i doğrulanmamışsa restore yine işini geri getirir; "üret" butonu doğrulanana
  kadar pasif kalır (mevcut uyarı).

## İzolasyon kararı

Ortak util/hook çıkarılmaz. Fotoğraf akışının çalışan restore mantığını refactor
etmek (tek satırlık asıl fix'e karşı) gereksiz regresyon riski getirir. İki akış
kendi yerel save/restore mantığını taşır; ~10 satırlık guard tekrarı kabul edilir.

## Doğrulama

- `npm run lint` + `npm run typecheck` + `npm run build` (statik garantiler).
- Manuel / e2e (tam yığın gerektirir):
  - Misafir → fotoğraf: foto yükle → üret → login → aynı akış, foto+seçimler yerinde,
    tek tık üret.
  - Misafir → tasarım: görsel yükle → üret → login → aynı akış, görsel yerinde,
    tek tık üret.
  - Giriş yapmış kullanıcı: davranış değişmez.
