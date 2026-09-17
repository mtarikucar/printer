# İade ve iptal işlemleri

Sipariş detayındaki **İadeler ve kalan tutarlar** kartı, aynı ödemeye bağlı siparişlerin kalan nakit ve hediye kartı tutarlarını gösterir.

- Nakit iadesini önce PayTR veya bankada tamamlayın. Ardından gerçek işlem referansı, gerçekleşme zamanı, tutar ve gerekçeyi kaydedin. Panel bankaya para transferi talimatı vermez.
- Hediye kartı tutarı kaydedildiğinde kredi, kullanıldığı karta geri yüklenir. Süresi dolmuş kartın süresi uzatılmaz.
- Kısmi iade üretimi durdurmaz. Kalan nakit ve kart tutarının tamamı döndüğünde siparişin ileri işlemleri kapanır; bekleyen özgün partner hak edişleri geri alınır. Önceden ödenmiş hak edişler ve bağımsız ek hak edişler korunur.
- **İptal**, nakit iadesinin yapıldığı anlamına gelmez. Üretim kapanır; doğrulanabilen hediye kredisi döner, nakit yükümlülüğü ayrıca görünür. Atölye iptal raporu, hangi siparişlerde hâlâ iade gerektiğini listeler.
- Bağlantı kesilirse **Aynı kaydın sonucunu kontrol et** düğmesini kullanın. Bekleyen işlem numarası sekmenin oturumunda korunur; yeni kayıt açmayın.
- Eski “iade edildi” işaretlerinin tutarı bilinmiyorsa kart bunu açıkça belirtir. **Eski iade kanıtı** yalnız tarihsel kanıt ekler; ikinci bir para/kart hareketi veya bildirim oluşturmaz.

İşlem geçmişindeki nakit ve kart tutarları gerçekleşen kayıtları, para dökümü ise kalan yükümlülükleri ve korunmuş partner ödemelerini gösterir. Ödeme kaynağı tutarsızsa kesin bakiye hesaplanmaz; uzlaştırma gerekir. Kaydedilmiş finansal kanıt için silme veya üzerine yazma işlemi yoktur.

## Dağıtım ve geri alma

`0061_order_refunds` yalnız üç yeni tablo ekler; eski iadeler için tahmini tutar üretmez. Boş şemada `up → down → up` desteklenir. Tablolardan herhangi biri kullanıldıysa `down`, finansal geçmişi silmeden işlemi reddeder.

Kullanılmış şemayı koruyun. `0061` öncesindeki uygulamanın iade ve hediye kartı dönüşü koduna geri dönmeyin: eski kod kısmi dönüşleri okumaz. Uygulama geri alınacaksa yeni iade/iptal ve kart dönüşü servislerini koruyan bir düzeltme sürümü kullanın; eski yazıcıları yeniden açmayın.

E-posta ve analitik bildirimleri finansal kayıttan sonra, saklanan gönderim durumundan tekrar denenir. Gönderim sorunu para işlemini geri almaz. Dış sağlayıcı kabulünden hemen sonra süreç kesilirse aynı bildirim tekrar gönderilebilir; finansal kayıt ve kart dönüşü ikinci kez uygulanmaz.
