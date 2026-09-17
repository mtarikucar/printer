# Faz 5: etki alanı ve üretici sıralaması

## Yayın kapsamı

- `/admin/coverage`: il ve malzeme bazında hesaplanan kapsam; yönetici sabitlemesi, dışlama ve hesabın eski il listesiyle farkı.
- Ana sayfa haritası hesaplanan kapsamı okur. Kapasite dolduğunda veya uygun üretici olmadığında bir il kapsama dışında görünebilir.
- Üretici ağırlıklı yükü, boyacıyla aynı `1 + floor(adet / 20)` kuralını kullanır. İadeler ve boyacıya geçmiş işler üretici tezgâhını doldurmaz.
- Yeni sıralama sinyalleri varsayılan olarak yalnız gölgede ölçülür. Canlı üretici sıralaması mevcut kurallarıyla devam eder.
- Yalnız otomatik atanmış ve 24 saattir yanıtlanmamış üretici işleri yeniden denenir. Elle atanmış, satıcıya ait veya yola çıkmış işler otomatik taşınmaz. SLA işlemi ceza puanı vermez.

## Gölge dönemi

Kaynak: `src/lib/config/scoring.ts`. `MFG_PHASE5_SHADOW` varsayılan açıktır;
`MFG_SIGNAL_*_LIVE` anahtarları varsayılan kapalıdır. Bu yayın canlı anahtarları açmaz.
`MANUFACTURER_SCORING_V2_PERCENT` mevcut dağıtım ayarıdır; bu faz değiştirmez.

`/admin/assignment-sweep` ve değerlendirme kayıtlarında 1–2 hafta boyunca:

1. Kazananın değiştiği kararları ve hiçbir uygun aday kalmayan kararları inceleyin.
2. Ölçülemeyen kapasite/kapsama kayıtlarını eksik veri olarak değerlendirin.
3. Büyük format beyanlarını, tezgâh limitlerini ve malzeme etiketlerini düzeltin.
4. Yeni sinyalleri ancak bu değerlendirmeden sonra uygulama ve worker süreçlerinde aynı ayarla açın.

Ağırlıklı yük canlıya açılırsa tek sipariş ataması, üreticisiz atölye partisine atama
ve geç ödenen katılımcının partiye alınması aynı anahtarı kullanır. Önceden taahhüt
edilmiş seansın kapanışı kapasite nedeniyle iptal edilmez. Sıralama ile yazma arasında
tezgâh değişebilir; son kontrolde reddedilen otomatik atama yöneticiye bildirilir.

## Veritabanı ve geri alma

0058, `coverage_overrides` tablosunu ekler; eski `manufacturers.coverage_provinces`
verisini değiştirmez. Uygulama ve worker yayınından önce migration uygulanır.

Down dosyası tablo boşsa kaldırır ve yalnız kendi migration kaydını siler.
Tabloda yönetici müdahalesi varsa geri alma durur; kayıtları kendiliğinden silmez.
Veriler için ayrıca koruma/aktarma kararı verilmeden dolu tabloyu kaldırmayın.
Önce daha yeni migration'lar geri alınmalıdır. Eski uygulamaya dönmek için tabloyu
kaldırmak gerekmez; eski uygulama bu ek tabloyu kullanmaz.

## Doğrulama

Standart yayın kapısı: `npm run lint`, `npm run typecheck`, `npm run build`,
`npm run test:unit`. Veritabanı davranış testi ayrıca izole QA Postgres ve Redis ile
`npm run test:workshop-cancel` üzerinden çalışır; kendi geçici şemasını temizler.
Ana veritabanı veya kullanıcı Redis'i bu test için kullanılmaz.
