# Anlaşmazlık kararları

`/admin/disputes` ekranı açık, çözülen ve işlem yapılmadan kapatılan başvuruları gösterir. Karar gerekçesi müşteriye iletilir. Bir karar kaydedildikten sonra aynı kayıt yeniden değiştirilemez; geçmiş karar ve varsa bağlı iade sipariş bağlantısıyla birlikte korunur.

## Karar ve iade

- **Çözüm kaydet:** Yalnız karar kaydedilebilir veya aynı karara gerçekleşen bir iade eklenebilir.
- **İncelendi — işlem yok:** Yeni iade oluşturmaz ve siparişi iptal etmez.
- İade seçildiyse yalnız başvurunun siparişine uygulanır. Karar, iade kaydı, hediye kartı dönüşü ve müşteri bildirim kaydı birlikte kaydedilir; bir adım başarısızsa tamamı geri alınır.
- Nakit alanı banka/PayTR üzerinden **önceden gerçekleştirilmiş** dönüşün kanıtıdır. Bu ekran dış ödeme sağlayıcısına para transferi emri vermez. Referans, tarih ve gerçekleşme onayı gerekir. Hediye kartı bakiyesi kayıt sırasında geri yüklenir.
- Kısmi iade üretimi durdurmaz. Tam iade mevcut iade kuralını uygular: bekleyen asıl hakedişler geri alınır, ödenmiş veya mahsuplaşmış hakedişler korunur. Gerekli partner düzeltmesi ayrı kayıtla yapılır; anlaşmazlık kararı otomatik ceza yazmaz.
- Tahsilat/iade geçmişi doğrulanamıyorsa iade seçimi kapanır. Para hareketi yapmayan karar yine kaydedilebilir. Eski kararda bağlı iade kanıtı yoksa ekran tutar uydurmaz.

## Yanıt kaybolursa

Tarayıcı işlem numarasını ve gönderilen kararı POST öncesinde saklar. Bağlantı kesilmesi, oturum süresinin dolması veya eşzamanlı işlem halinde **Aynı kararın sonucunu kontrol et** kullanılmalıdır. Tekrar aynı kararın sonucunu getirir; ikinci bir iade oluşturmaz. Yeni sekmeye geçilse veya kapanan kayıt açıklar listesinden çıksa da bekleyen komut görünür.

## Bildirim ve kurtarma

Yeni müşteri başvurusu, yönetici e-posta niyetiyle aynı işlemde kaydedilir. Karar sonrası müşteri tek bir birleşik karar/iade mesajı alır; tam iadede ilgili partner bildirimleri korunur. Karar yalnız bildirim kuyruğu erişilemediği için başarısız sayılmaz.

Mevcut e-posta işçisi `dispute_email_recover` işini dakika başına çalıştırır. Açılış ve karar gönderimlerinin bağımsız durum, kilit süresi ve alıcı bazlı ilerleme kayıtları vardır. Açılış mesajı karar sonrasında da gönderilebilir. SMTP kabulü ile ilerleme kaydı arasındaki kesinti aynı e-postanın yeniden gönderilmesine neden olabilir; para işlemi veya karar tekrarlanmaz. İşçi hataları ve `disputes` üzerindeki ilgili gönderim alanları inceleme kaynağıdır.

## Sürüm geri alma

0062 yalnız mevcut `disputes` tablosuna alanlar ekler; eski başvurulara karar/iade/bildirim uydurmaz. Kullanılmamış ek alanlar up/down/up ile geri alınabilir. Herhangi bir yeni karar, başvuru bildirim niyeti veya gönderim kanıtı varsa down işlemi atomik olarak reddedilir. Geçmişi silerek rollback açılmamalıdır; yeni şemayı okuyabilen uygulama sürümü kullanılmalıdır.
