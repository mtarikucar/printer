/**
 * Figurunica Üretici Ortaklık Sözleşmesi ve Bilgilendirme metni.
 *
 * SINGLE SOURCE OF TRUTH — rendered as Markdown on the manufacturer register
 * flow (src/app/manufacturer/register/page.tsx) via react-markdown. **Bold**
 * spans are styled bold + underlined, so reserve `**…**` for genuinely
 * binding/important clauses. Turkish only (the platform is TR-only).
 *
 * Every factual claim here must match what the platform actually does — a
 * clause the system cannot honour is a liability, not a nicety. When you change
 * behaviour (payout cadence, carrier integration, QC thresholds, commission),
 * change this text in the same commit.
 */
export const MANUFACTURER_ONBOARDING_TR = `# Üretici Ortaklık Sözleşmesi ve Bilgilendirme

**Sürüm: 2.0 — Yürürlük tarihi: 1 Eylül 2026**

Bu metin, **Figurunica** platformu ("Platform") ile üretici ağına başvuran ve
başvuruyu onaylayarak ("Üretici") aşağıdaki şartlar altında hizmet vermeyi
kabul eden taraf arasındaki çalışma esaslarını düzenler. Başvuruyu tamamlamadan
önce bu metni **dikkatle okumanız ve kabul etmeniz zorunludur**. Hesabınız
onaylandıktan sonra paneliniz aktifleşir ve size sipariş atanmaya başlar.

> Bu metin bilgilendirme amaçlı çerçeve sözleşme niteliğindedir. Platform,
> hizmet kalitesini ve mevzuata uyumu korumak için şartları güncelleyebilir;
> esaslı değişiklikler, 18. maddedeki usule göre kayıtlı e-posta adresinize
> bildirilir.

## 1. Taraflar ve Kapsam

- Üretici, Platform üzerinden iletilen 3D figürin baskı işlerini **kendi
  ekipmanı, sarf malzemesi ve iş gücüyle bağımsız bir hizmet sağlayıcı**
  sıfatıyla üretir. Bu sözleşme bir iş akdi (işçi-işveren ilişkisi) doğurmaz.
- Üretici ile Platform arasında münhasırlık yoktur; ancak atanan her sipariş
  için bu metindeki kalite, süre ve gizlilik yükümlülükleri **bağlayıcıdır**.
- Atanan siparişleri **kendi atölyenizde ve Platforma fotoğrafını sunduğunuz
  kendi ekipmanınızla** üretmekle yükümlüsünüz. **Platformun önceden yazılı
  onayı olmadan** siparişin üretimini başka bir atölyeye, alt yükleniciye veya
  üçüncü kişiye devredemez, fason yaptıramazsınız. Bu yasak, 14. madde
  kapsamında mağazaya listelediğiniz kendi ürünleriniz için de geçerlidir.
  7. maddedeki "Boyacıya Gönder" devri bu yasağın istisnasıdır.
- Atölyenizde çalıştırdığınız kişilerin bu sözleşmedeki kalite, gizlilik ve
  fikrî mülkiyet yükümlülüklerine uymasından **doğrudan siz sorumlusunuz**;
  bu kişilerin fiilleri kendi fiiliniz sayılır. Ücret, sosyal güvenlik (SGK)
  ve iş sağlığı-güvenliği yükümlülükleri **münhasıran Üreticiye** aittir. Bu
  ilişkinin bir iş akdi sayılması veya çalışanlarınızca Platform aleyhine talep
  ileri sürülmesi hâlinde **Platformun Üreticiye rücu hakkı saklıdır.**
- Üreticinin **Platform adına beyanda bulunma, taahhüt verme veya Platformu
  temsil etme yetkisi yoktur.** Müşteriye Platform adına süre, iade, indirim
  veya telafi sözü veremezsiniz; bu talepleri admin ekibine yönlendirirsiniz.
- Bu sözleşme ve buradan doğan alacaklar, Platformun yazılı onayı olmadan
  üçüncü kişiye devredilemez. Platform, sözleşmeyi işletmenin devri hâlinde
  halefine devredebilir.

## 2. Başvuru, Kimlik Doğrulama, Hesap Durumları ve Hesap Güvenliği

Hesabınız yaşam döngüsü boyunca aşağıdaki durumlardan birinde bulunur:

- **Beklemede:** Başvurunuz admin onayında. Henüz sipariş alamazsınız.
- **Koşullu Onaylı:** Ön onay verildi; **üretimde kullandığınız yazıcının/
  atölyenin net fotoğrafını yüklemeniz** beklenir. Bu aşamada panelinizde
  yalnızca fotoğraf yükleme ekranı açılır; fotoğraf yüklenmeden hesabınız
  Aktif duruma geçmez.
- **Aktif:** Sipariş alabilir, tüm panel işlemlerini yapabilirsiniz.
- **Askıya Alınmış:** **Panele giriş yapamazsınız**; dosya indirme, QC
  fotoğrafı yükleme, kargolama ve ödeme talebi dâhil hiçbir işlem yapamazsınız.
  Devam eden siparişleriniz, müşteri mağduriyetini önlemek için admin
  tarafından başka bir üreticiye aktarılabilir. Hak edilmiş ödemeleriniz
  9. madde uyarınca yapılmaya devam eder.

Başvurunun tamamlanabilmesi için **firma/atölye adı, yetkili kişi, e-posta,
telefon, açık adres, IBAN, banka hesap sahibi adı ve en az bir üretim
malzemesi (reçine ve/veya filament) beyanı zorunludur.** IBAN, format ve
kontrol hanesi ile doğrulanır. **Tam onay için ayrıca en az bir yazıcı/atölye
fotoğrafı yüklemeniz şarttır.**

**VKN veya TCKN beyanı başvuru anında zorunlu değildir; ancak boş bırakırsanız
hesabınız otomatik olarak "vergi incelemesi gerekli" olarak işaretlenir.** Bu
işaret uyum puanınızı ve dolayısıyla **atama önceliğinizi düşürür**. Girilen
VKN/TCKN geçersizse başvuru kabul edilmez. **Ödemenin yapılabilmesi için
VKN/TCKN beyanının tamamlanmış olması şarttır (bkz. Madde 9).**

Beyan edilen bilgilerin doğru, güncel ve size ait olduğunu taahhüt edersiniz;
yanlış/yanıltıcı beyan, hesabın askıya alınması veya feshi sebebidir.

**Hesap güvenliği ve bilgi değişikliği:**
- **Panel hesabınız kişiseldir ve devredilemez.** Giriş bilgilerinizi kimseyle
  paylaşamaz, hesabınızı kullandıramaz veya devredemezsiniz. **Hesabınızla
  yapılan tüm işlemler size ait sayılır.** Oturumunuz belirli bir süre sonunda
  otomatik sonlanır; paylaşımlı cihazlarda oturumu açık bırakmayın.
- Yetkisiz erişim şüphesinde **derhâl admin@figurunica.com adresine
  bildirmeniz zorunludur.**
- **Atölye adresi, üretim malzemesi ve ekipman** bilgileriniz değişirse
  panelinizden gecikmeksizin güncellemeniz; yeni ekipman için yazıcı fotoğrafı
  eklemeniz gerekir. **Firma unvanı ve VKN/TCKN panelden değiştirilemez;**
  bu değişiklikler için admin ekibine başvurun.
- **Banka bilgisi (IBAN, hesap sahibi, banka adı) yalnızca hesap Aktif iken
  değiştirilebilir ve Platformun doğrulamasına tabidir.** IBAN'ınızı
  değiştirdiğinizde hesabınız yeniden "vergi incelemesi gerekli" olarak
  işaretlenir; bu, doğrulama tamamlanana kadar atama önceliğinizin düşmesi
  anlamına gelir. Ödeme gecikmesi yaşamamak için IBAN değişikliğini ödeme
  talebinden önce yapın.

## 3. Sipariş Atama ve Kabul Süreci

- Müşteriler siparişi portaldan oluşturur ve **ödemeyi tamamlar**; üretime
  yalnızca ödemesi alınmış siparişler düşer.
- Atama; teslimat adresine olan mesafeniz, o anki iş yükünüz ve eş zamanlı iş
  limitiniz, reddetme geçmişiniz ve hesap uyum durumunuz üzerinden hesaplanan
  bir puanla yapılır.
- Şu hâllerde sipariş size **hiç iletilmez:** panelde beyan ettiğiniz malzeme
  siparişin malzemesiyle uyuşmuyorsa, **"Sipariş Almıyorum"** durumundaysanız,
  eş zamanlı iş limitiniz doluysa veya aynı siparişi daha önce reddettiyseniz.
  Bu nedenle malzeme ve kapasite beyanınızı güncel tutmanız esastır.
- **Kabul/ret kararınızı vermeden önce, siparişin tutarını, uygulanan komisyon
  oranını ve tahmini net payınızı sipariş detay ekranında görürsünüz.**
  Ekonomik koşulları uygun bulmadığınız siparişi reddedebilirsiniz.
- Atanan siparişe **24 saat içinde "Siparişi Kabul Et" veya "Reddet" yanıtı
  vermeniz zorunludur.**
- **Reddettiğinizde** sipariş, sıradaki uygun üreticiye **otomatik olarak**
  yönlendirilir. Aynı siparişi **3 farklı üretici** reddederse ya da uygun
  başka üretici kalmazsa sipariş otomatik yönlendirmeden çıkar ve **manuel
  atama için admin kuyruğuna** düşer. **Mağaza siparişlerinde otomatik
  yönlendirme uygulanmaz** (bkz. Madde 14).
- **Yanıtsız bıraktığınız siparişlerde otomatik yönlendirme çalışmaz.** Sipariş,
  siz yanıt verene kadar üzerinizde kalır; 24 saat aşıldığında admin panelinde
  işaretlenir ve admin ekibi atamayı **tek taraflı geri alarak** başka bir
  üreticiye verebilir. Geri alma sırasında hesabınıza **ihlal kaydı (strike)**
  işlenebilir (bkz. Madde 13).
- **Tekrarlayan reddetme, güvenilirlik puanınızı ve atama önceliğinizi
  düşürür.** Yoğunluk nedeniyle iş alamayacaksanız, reddetmek yerine
  **"Sipariş Almıyorum"** düğmesini kullanmanız beklenir.
- Kapasitenizi panelden yönetebilirsiniz: eş zamanlı iş limitinizi
  belirleyebilir, **"Sipariş Almıyorum" düğmesiyle dilediğiniz zaman yeni
  atamaları durdurabilirsiniz.** Bu, devam eden işlerinizi etkilemez.

## 4. Üretim Standartları ve Kalite Beklentileri

Platform hem **reçine (SLA/DLP/resin)** hem de **filament (FDM/FFF)** üretimini
destekler. Yalnızca elinizdeki ekipmanın karşılayabildiği malzemedeki
siparişleri kabul edin; uygun değilse siparişi reddedebilirsiniz.

**Sipariş özelliklerinin okunması:**
- **Kişiye özel figürin siparişlerinde** malzeme, boyut, stil ve bitiş sipariş
  detayında belirtilir; **siparişi tam olarak belirtilen malzeme ve yöntemle
  üretmeniz zorunludur.**
- **Mağaza siparişlerinde** üretim özellikleri ürün başlığı, açıklaması,
  görselleri ve ürüne bağlı üretim dosyaları ile belirlenir.
- **Müşterinin kendi 3D modelini yüklediği siparişlerde** size modelin özgün
  dosyası iletilir. **Bu dosya, üretilecek malzemeyi ve baskı ölçeğini
  kendiliğinden içermez.** Malzeme ve hedef yükseklik sipariş ekranında yazılı
  görünmüyorsa, **üretime başlamadan önce sipariş mesaj kanalından admin
  ekibine teyit ettirmeniz zorunludur.**
- Panelde görünen bilgi ile adminin sipariş sohbetinde **yazılı olarak** verdiği
  bilgi çelişirse **adminin yazılı son talimatı esastır.** Sözlü/telefon
  talimatı, sipariş sohbetine yazılmadıkça bağlayıcı değildir.

**Reçine (resin) baskı:**
- **Katman yüksekliği 50 mikron (0,05 mm) veya altı** olmalıdır.
- İzinli reçine: figürin/minyatür üretimine uygun, **orijinal ve son kullanma
  tarihi geçmemiş** fotopolimer reçine. Kırılganlığı azaltmak için tough/
  ABS-benzeri reçine kullanılabilir. **Su ile yıkanabilen (water-washable)
  reçineler yalnızca Platformun yazılı onayıyla** kullanılabilir. Aksi yazılı
  olarak bildirilmedikçe figürinler **krem/açık bej (kemik) tonunda** basılır.
- **Aynı siparişteki tüm parçalar ve adetler aynı reçine, aynı renk ve mümkünse
  aynı parti ile üretilir;** parçalar arası gözle görülür ton farkı reddedilme
  sebebidir.
- **Doluluk standardı: en büyük ölçüsü değil, kaide dâhil YÜKSEKLİĞİ 10 cm ve
  altında olan figürler varsayılan olarak tam dolu (solid) üretilir.** Katalog
  boyutlarından Küçük ve Orta her hâlükârda dolu basılır. Çok eksenli özel
  ölçülerde (ör. "15×10×22 cm") sıralama en×boy×yükseklik'tir ve eşik son
  değere uygulanır; ölçü okunaksız veya çelişkiliyse **tereddüt hâlinde tam
  dolu üretim esastır** ve admin ekibine sorulur.
- **Yüksekliği 10 cm'i aşan figürler**, siparişte veya Platformun yazılı
  talimatında aksi belirtilmedikçe **en az 2 mm (tercihen 2,5–3 mm) duvar
  kalınlığı** ile içi boş (hollow) üretilebilir. Bu kalınlık, **sizin
  uyguladığınız kabuk** içindir; modelin kendi geometrisi gereği daha ince olan
  detaylar (saç teli, kılıç ağzı, ince aksesuar) **dolu** basılır.
- **En dar ekseninde kesiti 15 mm'nin altında kalan bölgeler — parmak, el, kol,
  bacak, saç, kulak, boynuz, kuyruk, kanat, silah/asa ve ince kaide kenarı —
  oyuklanamaz; daima tam dolu basılır.** İki yanda 2 mm duvardan sonra en az
  3 mm iç boşluk kalmayan hiçbir bölge oyuklanamaz.
- **Hollow baskılarda en az iki adet, çapı 3–4 mm drenaj/hava tahliye deliği
  bulunmalıdır** (tek delik vakum etkisiyle kabuk göçmesine yol açar). Delikler
  **taban veya sergilenirken görünmeyen yüzeylere** açılır; yüz, baş ve ön
  gövdeye delik açılamaz.
- Hollow parçanın **iç boşluğu tamamen boşaltılmış, yıkanmış ve iç yüzey dâhil
  tam kürlenmiş** olmalıdır. Drenaj delikleri **yalnızca parça tamamen
  boşaltılıp kuruduktan ve kürlendikten sonra** kapatılıp zımparalanabilir.
- **İçinde sıvı/ham reçine kalan, yetersiz temizlenmiş, eksik kürlenmiş veya
  duvar kalınlığı standardın altında kalan baskılar kalite kontrolden geçmez.**
- Oyuklanan kabuk kendi kendini taşımalıdır; emme (suction) kaynaklı içe göçme,
  kabuk çökmesi veya katman kayması görülen parçalar reddedilir.
- **Oyuklama yalnızca baskı kalitesi, ağırlık ve emniyet gerekçesiyle yapılır.
  Yalnızca reçine tüketimini azaltmak için oyuklama yapmak veya duvarı
  inceltmek yasaktır.** Sipariş bedeli ve net payınız doluluk oranından
  bağımsız olarak sabittir.
- **Yıkama:** Parça plakadan alındıktan sonra bekletilmeden, reçine üreticisinin
  önerdiği sıvıyla (talimat yoksa temiz izopropil alkol, IPA) yıkanır.
  **Doygun/kirlenmiş yıkama sıvısı kullanılamaz.** Derin girintiler ve delikler
  fırça veya basınçlı hava ile ayrıca temizlenir.
- **Kürleme:** Parça **kürlemeden önce tamamen kurutulur** ve reçine
  üreticisinin talimatındaki dalga boyu/sürede, **her yüzey eşit ışık alacak
  biçimde döndürülerek** kürlenir. Güneş ışığında veya kontrolsüz lamba altında
  kürleme kabul edilmez. **Aşırı kürleme de eksik kürleme kadar ciddi bir
  kusurdur:** sararma, kırılganlık ve çatlama yaratır.
- Destekler dikkatlice sökülmeli, destek/izleme noktaları zımparalanıp
  temizlenmeli, parça yıkanıp tam olarak kürlenmelidir (UV cure).
- **Eksik kürlenme (yapışkan/yumuşak yüzey), aşırı kürlemeden kaynaklı sararma
  ve kırılganlık, beyazlama/mat sisleme, kurumuş IPA lekesi, görünür destek
  izi, kırılgan/çatlak yüzey, katman kayması, ekran/FEP kaynaklı bantlaşma,
  yüzeyde kürlenmiş parçacıktan doğan kabartılar, fil ayağı ve kaide çapağı
  reddedilme sebebidir.**

**Filament (FDM) baskı:**
- **Katman yüksekliği 200 mikron (0,20 mm) veya altı** olmalıdır; ince detaylı
  modellerde daha düşük katman (0,10–0,12 mm) tercih edilmelidir.
- **Malzeme:** Aksi yazılı olarak bildirilmedikçe **PLA veya PLA+** kullanılır;
  PETG yalnızca siparişte/yazılı talimatta istendiğinde kullanılabilir.
  Nemlenmiş veya baskı dayanımını düşürdüğü görülen filament kullanılamaz.
  **Nozül çapı en fazla 0,4 mm** olmalıdır.
- **Duvar ve doluluk: en az 4 duvar (perimeter), en az 4 üst ve 4 alt katman ve
  en az %20 dolum (infill).** Yüksekliği 10 cm'i aşan figürlerde dolum **en az
  %25**'e çıkarılır. Kol, bacak, silah, kuyruk, boynuz gibi ince ve taşıyıcı
  kesitler dolu basılır.
- **Aynı sipariş içinde marka/parti/renk değiştirilemez;** parçalar arası renk
  ve parlaklık farkı reddedilme sebebidir.
- Destek kullanılıyorsa temas (interface) katmanı uygulanır; **brim/raft/skirt
  kalıntıları kesilip zımparalanır.**
- Yüzeydeki **ipliklenme (stringing), sarkma, katman ayrışması/kabarma
  (delaminasyon), çarpılma (warping), eksik ekstrüzyon (under-extrusion), fil
  ayağı (elephant foot), nem kaynaklı kabarcık ve belirgin dikiş/ek izleri
  reddedilme sebebidir.**

**Ekipman ve bakım (her iki yöntem):**
- Kullandığınız ekipmanı değiştirir veya yeni yazıcı eklerseniz, yeni ekipmanın
  fotoğrafını panelinizden yüklemeniz beklenir.
- **Ekran/optik ve FEP-nFEP film düzenli kontrol edilir;** ölü piksel, çizik
  veya yorulmuş filmden kaynaklanan yüzey kusurları reddedilme sebebidir.
- Yeni reçine, yeni ekipman veya ayar değişikliğinden sonra pozlama/kalibrasyon
  test baskısı yapmak Üreticinin sorumluluğundadır.

**Ölçü, ölçek ve tolerans:**
- Siparişte tek ölçü yazıyorsa bu ölçü figürinin **kaide dâhil toplam
  yüksekliğidir** ve tüm çıkıntılar (saç, kılıç, kanat) dâhildir. Siparişe
  ayrıca eklenen teşhir kaidesi ve isim plakası bu ölçüye dâhil değildir.
- **Panelden indirdiğiniz dosya sipariş ölçeğinde olmayabilir; dosyayı sipariş
  ölçüsüne ölçeklemek Üreticinin sorumluluğundadır.** Dosyanın kendi ölçüsünde
  basılması siparişe uygun üretim sayılmaz.
- **Kabul edilebilir sapma:** nominal yükseklik **100 mm ve altındaysa ±2 mm**,
  üzerindeyse **±%2**. Bu bandın dışındaki fark **ölçü sapması** sayılır ve
  reddedilir.
- QC fotoğraflarından **en az biri, parça bir cetvel/şerit metre yanında dik
  dururken** çekilerek ölçü belgelenir.

**Bitiş katmanına göre yüzey hazırlığı:**
- **Boyanabilir Kit (varsayılan):** parça zımparalanır, tozdan/yağdan
  arındırılır ve **ince kat astar (primer) uygulanır.** Astar detayları
  kapatmamalı, akmamalı, tam kurumuş olmalıdır. **Bu siparişlerde figürin
  boyanmaz.**
- **Collector Raw:** zımparalanmış, yıkanmış ve tam kürlenmiş, **boyasız**
  teslim edilir; astar yalnızca siparişte açıkça istenirse uygulanır.
- **El Boyaması:** baskı size, profesyonel boyama boyacı ortağa aittir
  (bkz. Madde 7).
- **Lüks Vitrin:** tam el boyamasına ek olarak **premium kaide, isim plakası ve
  sert kutu** içerir; bu bileşenler Platform tarafından size/boyacıya gönderilir
  ve **panelde hangi tarafın tamamlayacağı belirtilir.** İsim plakası metni
  siparişte yazıldığı gibi birebir uygulanır; metin panelde görünmüyorsa
  **tahmin etmeyin, admin ekibine sorun.**
- **Obje/tasarım/yükleme siparişlerinde: Ham baskı** — yalnızca destek temizliği;
  **Pürüzsüz** — zımpara + astar; **Boyalı** — siparişte belirtilen tek renk/
  temel boyama.
- **Siparişin bitiş türüyle uyumsuz üretim reddedilme sebebidir:** boyasız
  istenen ürün boyanamaz, astarsız istenen ürün astarlanamaz.

**İnce detaylar, kaide ve dayanım:**
- Parmak, saç teli, kanat, kuyruk, silah/asa gibi ince detaylar; daha dayanıklı
  malzeme kullanılarak, gerekiyorsa ayrı basılıp pim/mıknatısla birleştirilerek
  taşımaya dayanacak biçimde üretilir. Görünümü değiştirecek kalınlaştırma için
  **önceden admin onayı** alınır.
- **Baskı sırasında veya sonrasında kırılan bir parçanın yapıştırılarak kusurun
  gizlenmesi kesinlikle yasaktır;** kırılan parça yeniden basılır. Gizlenmiş
  onarımla teslim, 13. madde kapsamında **yanıltıcı beyan** sayılır.
- Ayakta durmak üzere tasarlanmış figürinler **düz bir yüzeyde desteksiz,
  sallanmadan ve devrilmeden dik durmalıdır.** Kaide alt yüzeyi düz, çapaksız
  ve temiz olmalıdır; **eğrilmiş, içbükey veya sallanan kaide reddedilme
  sebebidir.** Bu şart anahtarlık, mıknatıs ve asılı ürünlere uygulanmaz.

**Çok parçalı ürünler, montaj ve baskı dışı bileşenler:**
- Bazı işler birden fazla baskı parçası, **parça adedi, baskı dışı bileşen
  listesi (mıknatıs, halka, pim, vida, aydınlatma bileşeni) ve sıralı montaj
  adımları** içerir; bunlar panelinizdeki ürün kartında gösterilir.
- **Panelde verilen parça listesi, adetler ve montaj adımlarına birebir
  uyulması zorunludur.** Ürün, aksi belirtilmedikçe **montajı tamamlanmış ve
  kullanıma hazır** teslim edilir.
- **Baskı dışı bileşenlerin temini ve maliyeti**, Platform o sipariş için
  bileşenleri kendisi göndereceğini yazılı olarak bildirmedikçe **Üreticiye
  aittir** ve net payınızın içindedir. Bir bileşeni temin edemiyorsanız siparişi
  kabul etmeyin veya derhâl admin ekibini bilgilendirin; **muadil bileşen ancak
  Platformun yazılı onayıyla** kullanılabilir.
- **Elektrikli bileşen içeren ürünlerde** kablo, soket ve bağlantılar güvenli ve
  yalıtımlı yapılır, çıplak iletken bırakılmaz, ürün paketlemeden önce çalışır
  durumda test edilir.
- Ürünün satıcısı siz değilseniz; baskı dosyaları, bileşen listesi, tedarikçi
  notları ve montaj tarifi **ilgili satıcıya ve/veya Platforma ait ticari
  sırdır**; yalnızca o siparişi üretmek için kullanılabilir.

**Baskı dosyasına müdahale:**
- Baskı dosyası üzerinde yalnızca **baskı için teknik olarak zorunlu** işlemleri
  yapabilirsiniz: sipariş ölçüsüne ölçekleme, yerleştirme/yönlendirme, destek
  ekleme, bu maddedeki kurallara uygun oyuklama ve drenaj deliği açma, açık
  yüzey/manifold onarımı ve gerekiyorsa parçalara ayırma.
- **Figürinin tasarımını, oranlarını, pozunu, yüz hatlarını veya müşteriye
  onaylatılan görünümünü değiştiren hiçbir müdahale yapılamaz.** Zorunlu bir
  geometri değişikliği gerekiyorsa **baskıdan önce** admin onayı alınır.
  Bu maddeye uygun açılan drenaj delikleri "birebir uygunluk" ihlali sayılmaz.
- Size iletilen dosyada baskıyı imkânsız kılan bir kusur (kapalı olmayan yüzey,
  bozuk geometri, desteklenemeyen çıkıntı, malzeme ve ölçekte taşınamayacak
  ince kesit) görürseniz, **baskıya başlamadan önce sipariş mesaj kanalından
  bildirmeniz zorunludur.** Bildirmeden basılan kusurlu iş sizin
  sorumluluğunuzdadır; bildirmenize rağmen Platform devam talimatı verirse
  doğan yeniden üretim maliyeti size yüklenmez.
- Üreticinin oluşturduğu türev dosyalar (ölçeklenmiş/oyuklanmış model, destekli
  dosya, dilimleyici projesi) da **müşteriye ve/veya Platforma aittir**;
  Madde 11 uyarınca imha edilir.

**Her iki yöntem için ortak:**
- Üretilen parça, **size iletilen baskı dosyasına** ve sipariş özelliklerine
  (ölçü, malzeme, bitiş, stil) **birebir uygun** olmalıdır. Dosya ile müşteriye
  gösterilen önizleme arasındaki tasarım farklılıkları Platformun
  sorumluluğundadır.
- **Siparişin bitiş türü boyama gerektiriyorsa** renklendirme ve son rötuş
  tamamlanmalıdır. **Kırık, eksik/yanlış parça, tolerans dışı ölçü sapması ve
  bitiş türünün gerektirdiği işlemin eksik ya da fazla yapılması her durumda
  reddedilme sebebidir.**
- **Ürün güvenliği:** Teslim edilen parça, müşterinin **çıplak elle tutup
  boyayacağı** bir üründür. Yüzeyinde kürlenmemiş reçine kalıntısı bulunan,
  yağlı/yapışkan hisli veya keskin kimyasal kokulu hiçbir parça gönderilemez.
  Destek sökümünden kalan uç ve çapaklar, ürün elle tutulduğunda **kesici/
  batıcı kenar bırakmayacak** biçimde temizlenir.
- Üretilen ürün **koleksiyon/dekoratif objedir; oyuncak olarak üretilmez.**
  Platformun pakete koyduğu kart ve rehberleri çıkaramaz, değiştiremez veya
  kendi uyarı/etiketinizle değiştiremezsiniz.

## 5. Kalite Kontrol (QC) Süreci

- Baskıyı panelden **"Baskı Tamamlandı Olarak İşaretle"** ile bitirdikten sonra,
  kargolamadan önce QC fotoğraflarını yükleyip **"İncelemeye gönder"** adımını
  tamamlamanız zorunludur.
- **Her QC turunda en az 4, en fazla 6 fotoğraf** yüklenir. Fotoğraflar en az
  şu görünümleri kapsamalıdır: **(1) ön, (2) arka, (3) yan/profil, (4) yüz veya
  en detaylı bölgenin yakın çekimi.** Ayrıca **cetvelli ölçü fotoğrafı**
  eklenir. **İçi boş (hollow) üretilen reçine baskılarda drenaj deliklerini ve
  taban yüzeyini gösteren en az bir fotoğraf zorunludur.**
- Fotoğraflar **JPEG veya PNG**, her biri en fazla **10 MB** olmalı; sade
  zeminde, iyi ışıkta, net ve gerçek rengi gösterecek biçimde çekilmelidir.
  **Filtre, rötuş, yapay zekâ ile düzeltme veya başka bir siparişe/örnek
  çalışmaya ait fotoğraf kullanmak yasaktır; yanıltıcı QC fotoğrafı doğrudan
  askıya alma ve fesih sebebidir.**
- Fotoğraflar yalnızca "Baskı tamamlandı" ve "QC reddedildi" durumlarında
  eklenip silinebilir; **incelemeye gönderdikten sonra değiştirilemez.**
- **Admin QC onayı verilmeden kargolama (ve boyamalı siparişlerde "Boyacıya
  Gönder") adımı açılmaz.** Platform, QC kararını en geç **1 iş günü** içinde
  verir.
- **QC reddi hâlinde**, red gerekçesindeki kusurları **ek ücret talep etmeden**
  giderip **en geç 2 iş günü içinde** yeni fotoğraflarla tekrar göndermekle
  yükümlüsünüz. Kusur, niteliği gereği düzeltilemiyorsa parça yeniden üretilir.
- **Aynı sipariş üçüncü kez QC'den reddedilirse** Platform siparişi geri alıp
  başka bir üreticiye devredebilir; bu hâlde sipariş için pay tahakkuk etmez.
  Önceki üreticinin QC red sayısı yeni üreticiye devrolmaz.
- QC yalnızca teslim edilecek işin sipariş özelliklerine uygunluğunu denetler;
  **QC onayı, sonradan ortaya çıkan gizli kusurlar için sorumluluğunuzu
  ortadan kaldırmaz.**

## 6. Paketleme, Ek Hizmetler ve Kargo

**Paket içeriği — siparişin bitiş türüne göre belirlenir:**
- **Boyanabilir Kit:** astarlanmış figürin + Platformun sağladığı mini boya
  kiti (boyalar, fırçalar, karıştırma paleti ve boyama rehberi) + Platform
  bilgi kartı.
- **Collector Raw:** yalnızca ürün + Platform bilgi kartı. **Boya kiti ve fırça
  konulmaz.**
- **Ham / Pürüzsüz / Boyalı (obje siparişleri) ve mağaza ürünleri:** boya kiti
  içermez; yalnızca Platform bilgi kartı eklenir.
- **El Boyaması:** paketlemeyi ve kargoyu boyacı ortak yapar (bkz. Madde 7).
- Pakete konulacak materyaller **Platform tarafından sağlanır.** Stoğunuz
  **10 adedin altına** indiğinde siparişi tamamlamadan önce admin ekibine
  bildirmeniz gerekir; materyal eksikliğinden doğan gecikmede, zamanında
  bildirmeniz kaydıyla gecikme yaptırımı uygulanmaz.
- Müşteriye Platform markası dışında tanıtım/iletişim materyali, kendi kartınız
  veya fatura konulamaz.

**Sipariş ek hizmetleri:** Müşteri ücretli ek hizmet satın alabilir. **Panelde
sipariş kartında listelenen** ek hizmetleri yerine getirmek zorunludur;
**panelde listelenmeyen bir ek hizmetten sorumlu tutulmazsınız.**
- **Hediye paketi:** ürün hediyeye uygun kutu ve kurdele ile paketlenir; pakete
  fiyat etiketi veya fatura konulamaz.
- **Ekstra boya katmanı:** boyalı bitişlerde ek kat / artırılmış doygunluk
  uygulanır; boyacıya devredilen siparişlerde bunu boyacı uygular.
- **Hızlı kargo:** sipariş üretim sıranızda **öncelikli** işlenir; QC onayı
  verildiği **aynı iş günü, en geç ertesi iş günü** kargoya teslim edilir.
- **Dijital dosyalar:** müşteriye Platform tarafından teslim edilir; sizin ek
  bir ediminiz yoktur.

**Paketleme standardı (asgari):**
- Ürün önce **balonlu naylona en az iki tur** sarılır, ürüne uygun **çift
  oluklu karton kutuya** yerleştirilir. Ürün ile kutu duvarı arasında **her
  yönde en az 3 cm dolgu** bulunur; **kutu kapalıyken sallandığında ürün
  içeride hareket etmemelidir.**
- **Çok parçalı ürünlerde her parça ayrı sarılır**, küçük parçalar kilitli
  poşete konur ve üzerine parça adı yazılır.
- Boyanmış veya astarlanmış yüzeyler yapışmayan bir ara katmanla korunur.
- Ürün **kuru olarak** paketlenir; yüzeyinde nem, leke veya yoğuşma
  bulunmamalıdır. Kutunun dışına **"KIRILACAK EŞYA"** etiketi yapıştırılır.
- Platform bilgi kartı, kutu açıldığında ilk görülecek biçimde en üste konur.
- **Yetersiz paketlemeden kaynaklanan taşıma hasarının sorumluluğu Üreticiye
  aittir.**

**Kargo:**
- **Gönderiyi kargoya siz verirsiniz.** Admin QC onayından sonra gönderiyi
  oluşturur, ardından panelinizdeki **"Siparişi Kargola"** adımında **kargo
  firmasını ve takip numarasını girersiniz.** Platform aksini bildirmedikçe
  **varsayılan kargo firması Yurtiçi Kargo'dur.** Platform kargo etiketi
  üretmez.
- **Takip numarası girilmeden sipariş kargolanmış sayılmaz:** müşteriye bildirim
  gönderilmez ve hak edişiniz tahakkuk etmez. Takip numarasının doğru ve o
  gönderiye ait olması Üreticinin sorumluluğundadır; **hatalı/uydurma takip
  numarası girmek askıya alma ve fesih sebebidir.**
- **Türkiye içi kargo müşteriye ücretsizdir;** müşteriden hiçbir ad altında
  kargo bedeli talep edilemez ve **karşı ödemeli gönderi yapılamaz.** Gönderi
  bedeli, Platformun size bildireceği anlaşmalı gönderici kodu üzerinden
  **Platform tarafından karşılanır**; böyle bir kod bildirilmemişse gönderiyi
  kendi hesabınızdan yapar ve bedeli admin onayıyla hak edişinize masraf olarak
  yansıtırsınız.
- Gönderide **gönderici adı olarak yalnızca "Figurunica"** kullanılır; kendi
  markanızı öne çıkaran etiket veya materyal kullanılamaz. Çıkış adresi doğal
  olarak atölyenizin adresidir.

**Taşıma hasarı, kayıp ve iade lojistiği:**
- **Ürün, üretimden kargo firmasına fiilen teslim edilene kadar (boyamalı
  siparişlerde boyacıya teslim edilene kadar) Üreticinin zilyetliğindedir.** Bu
  süre içinde kaybolması, çalınması veya hasar görmesi hâlinde iş **ek ücret
  talep edilmeden yeniden üretilir.**
- Kargoya teslimden sonraki taşıma riski Platforma aittir; **yetersiz
  paketlemeden doğan hasar bunun istisnasıdır.** Gönderi kaybolur veya kargo
  firmasının kusuruyla hasar görürse, gönderici sıfatıyla **tazminat
  başvurusunu Üretici yapar** ve durumu 3 iş günü içinde Platforma bildirir;
  tahsil edilen tazminat Platforma aktarılır.
- **Üreticinin taşıma hasarına ilişkin sorumluluğu, müşteriye teslimden itibaren
  30 gün sonra sona erer.** Üretim kusuru sorumluluğu bu süreyle sınırlı
  değildir.
- **Adreste bulunamama nedeniyle iade dönen gönderiler** size döner; teslim
  aldığınızı 2 iş günü içinde bildirir, ürünü hasarsız saklar ve Platformun
  bildirdiği güncel adrese yeniden gönderirsiniz. İkinci gönderinin bedeli,
  hata sizden kaynaklanmıyorsa Platform tarafından karşılanır.

## 7. Profesyonel Boyama Siparişleri ve Boyacıya Devir

Bazı siparişlerde müşteri **profesyonel el boyama** seçeneğini satın alır. Bu
siparişlerde iki yoldan biri izlenir:

**(a) Boyacıya devir (varsayılan):** Baskıyı üretip QC onayından geçirdikten
sonra figürini, panelinizdeki **"Boyacıya Gönder"** adımıyla Platformun boyacı
ağındaki bir **boyacı ortağa** devredersiniz. Bu andan itibaren boyama, boyacı
kalite kontrolü, paketleme ve müşteriye kargo **boyacı tarafından** yürütülür.
Sorumluluğunuz, sipariş özelliklerine birebir uygun, kusursuz ve QC-onaylı
**boyasız/baz baskıyı** zamanında ve eksiksiz iletmektir; devredilen işteki
baskı kusurları (kırık, eksik parça, ölçü sapması, temizlenmemiş destek izi
vb.) sizin sorumluluğunuzdadır.

**(b) Kendi atölyenizde boyama:** Profilinizde **"Boyamalı siparişleri kendim
boyayıp kargolarım"** seçeneği açıksa, siparişi kendiniz boyayıp doğrudan
müşteriye kargolayabilirsiniz. Bu hâlde **boyama kalitesi dâhil tüm sorumluluk
size aittir.** Bu yolda **boyama sonrası ayrı bir ikinci QC turu yoktur;** bu
nedenle QC'ye yüklediğiniz fotoğraflar **boyanmış nihai ürünü** göstermek
zorundadır. Boyama; siparişin stiline ve müşteriye gösterilen görsele birebir
uygun, malzemeye uygun astar ve boyalarla kalıcı biçimde uygulanmalıdır.
**Yanlış renk/ton, taşan veya eksik boyama, fırça izi/damla, tozlanma, parmak
izi, mat–parlak tutarsızlığı ve yetersiz koruyucu (vernik) uygulaması
reddedilme sebebidir.** Bu seçeneği, Platformdan yazılı onay almadan
açmayacağınızı kabul edersiniz; onaysız açılması sözleşmeye aykırılıktır.
Platform bu istisnayı yazılı bildirimle her zaman sona erdirebilir.

**Baz baskının boyacıya fiziksel devri:**
- "Boyacıya Gönder" adımı yalnızca sistemsel devirdir; **figürini fiziksel
  olarak da göndermeniz gerekir.** Boyacının teslimat adresi ve iletişim
  bilgisi devirden sonra **Platform tarafından size bildirilir**; panelde
  yalnızca boyacının unvanı ve ili görünür. Bu bilgi yalnızca bu devir için
  kullanılır (Madde 11).
- Figürini, 6. maddedeki paketleme kuralına uygun biçimde paketleyip **devirden
  sonra en geç 2 iş günü içinde** gönderirsiniz. **Bu pakete boya kiti ve
  Platform bilgi kartı konmaz;** müşteriye giden nihai paketi boyacı hazırlar.
- **Kargo firmasını ve takip numarasını, gönderiyi verdiğiniz gün admin ekibine
  bildirmeniz zorunludur.** Panelinizdeki takip numarası alanı yalnızca
  müşteriye yapılan gönderi içindir. **Bu bacağın kargo bedeli Platform
  tarafından karşılanır.**
- **Baz baskı boyacıya ulaşana kadar kayıp ve hasar riski Üreticidedir;** risk,
  boyacının teslim aldığını teyit etmesiyle boyacıya geçer.
- **Boyacı işi reddederse** sipariş size geri döner ve **devir anında tahakkuk
  etmiş baskı payınız geri alınır**; iş başka bir boyacıya devredildiğinde veya
  (b) yolunu seçip kendiniz tamamladığınızda ilgili tutar üzerinden yeniden
  tahakkuk eder. Ret, baskı kusurundan kaynaklanıyorsa yeniden gönderim bedeli
  Üreticiye aittir.

## 8. Süreler ve Gecikme

- Kabul edilen bir sipariş için **azami süreler aşamalı olarak uygulanır ve her
  aşama panelde kayıt altına alınır:**
  - **Kabulden QC'ye gönderime: en çok 4 iş günü.**
  - **Admin QC kararı: en çok 1 iş günü (Platformun yükümlülüğü).**
  - **QC onayından kargoya teslime — boyamalı siparişlerde "Boyacıya Gönder"
    adımının tamamlanmasına: en çok 1 iş günü.**
- Bu süreler **ortalama değil, her sipariş için ayrı ayrı geçerli azami
  sürelerdir** ve yalnızca iş günlerini kapsar; hafta sonu ve resmî tatiller
  sayılmaz. **Platform kaynaklı bekleme süreleri (QC incelemesi, dosya/
  malzeme gecikmesi) sizin sürenizden düşülür.**
- **Profesyonel boyama içeren siparişlerde süre yükümlülüğünüz, işi boyacıya
  devrettiğinizde sona erer;** boyama ve müşteriye kargo süresinden boyacı
  sorumludur.
- **Mağaza ürünlerinde**, ürün kartında beyan ettiğiniz üretim süresi esastır
  (bkz. Madde 14).
- **QC reddi hâlinde** düzeltilmiş işi **en geç 2 iş günü içinde** yeniden
  göndermeniz beklenir.
- **Hızlı kargo eklentisi bulunan siparişler** öncelikli sıraya alınır ve QC
  onayından sonra bekletilmeden kargolanır.
- Öngörülemeyen bir gecikme doğacaksa, **süre dolmadan admin ekibini
  bilgilendirmeniz** beklenir. **Bildirimsiz ve tekrarlayan gecikmeler** kayıt
  altına alınır; uyarı, ihlal kaydı (strike), atama önceliğinin düşmesi ve
  hesabın askıya alınmasına yol açabilir. **Mücbir sebep hâlinde süreler
  işlemez** (bkz. Madde 16).

## 9. Ücretlendirme, Komisyon ve Ödeme

- Her sipariş için Üreticiye **net üretici payı** ödenir. Net pay, sipariş
  tutarından **Platform hizmet bedeli (komisyon)** düşülerek hesaplanır.
  **Güncel Platform komisyonu %35, üreticinin net payı ise %65'tir.**
- **Hak ediş tabanı:** Net pay, panelinizde o sipariş için gösterilen **sipariş
  tutarı** üzerinden hesaplanır. Bu tutar **KDV dâhil** perakende tutardır;
  ayrıca bir KDV eklenmez veya düşülmez. Hediye kartı, havale indirimi veya
  kampanya uygulanan siparişlerde taban, **indirim öncesi sipariş tutarıdır**;
  indirimi Platform karşılar ve net payınızdan düşülmez. Birden çok satıcıdan
  oluşan sepet siparişlerinde taban, **yalnızca size ait alt siparişin
  tutarıdır.**
- **Size atanan her siparişte; sipariş tutarı, uygulanan komisyon oranı ve
  tahmini net payınız, kabul/ret kararınızdan ÖNCE sipariş detay ekranında
  gösterilir.** Kabul ekranında görülen tutar tahminîdir; kesinleşmiş hak ediş
  aşağıdaki anlarda oluşur.
- **Hak edişin tahakkuk anı:**
  - Boyama içermeyen siparişlerde: siparişi **kargolayıp takip numarasını
    girdiğinizde**, sipariş tutarının tamamı üzerinden.
  - Boyacıya devredilen siparişlerde: **işi boyacıya devrettiğinizde**, sipariş
    tutarından **boyama bedeli düşülerek (yalnızca baskı payı)** üzerinden.
    Boyama bedelinin payı ilgili boyacıya ödenir.
  - Kendi atölyenizde boyayıp kargoladığınız siparişlerde: **kargoladığınızda**,
    **boyama bedeli dâhil sipariş tutarının tamamı** üzerinden.
- Sipariş bazında **brüt / komisyon / net** kırılımınız panelinizin
  **"Kazançlar"** ekranında görüntülenir.
- **Ödeme:** Bekleyen bakiyeniz için panelden **"Ödeme talep et"** düğmesiyle
  talep oluşturursunuz; talep admin ödeme kuyruğuna düşer ve **tanımlı
  IBAN'ınıza en geç 7 iş günü içinde** aktarılır. Platform, talebinizi
  beklemeden de ödeme yapabilir. **Sabit bir ödeme günü veya haftalık otomatik
  ödeme takvimi taahhüt edilmez.** Asgari ödeme tutarı uygulanmaz; ileride bir
  eşik getirilirse yürürlükten önce bildirilir.
- Ödeme talebi yalnızca hesabı **Aktif** olan üreticiler tarafından
  oluşturulabilir. **Hesabı askıya alınmış veya ortaklığı sona ermiş
  üreticilerin hak edilmiş ödemeleri, talep beklenmeksizin Platform tarafından
  yapılır.**
- Ödemenin yapılabilmesi için **VKN/TCKN ve IBAN bilgilerinizin eksiksiz ve
  doğru** olması şarttır; eksik/hatalı bilgiden kaynaklanan gecikmeler
  Platformun sorumluluğunda değildir.
- **Komisyon oranı değişikliği**, yürürlüğe girmeden **en az 15 gün önce**
  kayıtlı e-postanıza bildirilir ve panelinizde yayımlanır. **Değişiklik
  geriye yürümez: yürürlük tarihinden önce kabul ettiğiniz siparişler, kabul
  anında geçerli olan oran üzerinden ödenir.**
- **Kargo bedeli hak ediş tabanına eklenmez** (Türkiye içi kargo müşteriden
  ayrıca tahsil edilmez). Koruyucu ambalaj malzemesi maliyeti, 1. madde uyarınca
  Üreticinin sarf malzemesi kapsamındadır.
- **Tamamlanmamış işler için pay tahakkuk etmez.** Sipariş kargolandıktan sonra
  iade/iptal edilirse, ödeme itirazı doğarsa veya bir müşteri anlaşmazlığı
  aleyhinize sonuçlanırsa **tahakkuk etmiş hak ediş geri alınır (ters kayıt).**
  Geri alım, kusurun kimde olduğuna bakılmaksızın uygulanır; kusur Üreticiden
  kaynaklanmıyorsa (Platformun içerik/mevzuat gerekçesiyle iptali, Platform
  kaynaklı model hatası, boyacı reddi) **7 gün içinde panelden itiraz
  edebilirsiniz** ve Platform malzeme/emek karşılığını takdiren ödeyebilir.
- **Mahsup:** Kusurunuz nedeniyle doğan yeniden üretim, yeniden gönderim ve
  müşteri iadesi tutarları, **ödenmemiş ve gelecekteki hak edişlerinizden
  mahsup edilebilir**; bakiye yoksa tutar Platformun yazılı talebini izleyen
  **15 gün içinde** iade edilir. **Ödemesi tamamlanmış hak edişler otomatik
  olarak geri alınmaz.** Her geri alım, gerekçesi ve sipariş numarasıyla
  birlikte size bildirilir.

## 10. Vergi ve Faturalandırma

- Üretici, elde ettiği gelire ilişkin **vergisel yükümlülüklerden (beyan, fatura
  düzenleme dâhil) bizzat sorumludur.** Platform yalnızca net payı IBAN'a
  aktarır; hak ediş ve ödeme dökümünüz panelinizin "Kazançlar" ekranında
  görüntülenir.
- Tüzel kişi/şahıs şirketi iseniz, mevzuatın gerektirdiği hâllerde Platforma
  fatura düzenlemeniz gerekebilir.
- Platform, mevzuatın zorunlu kıldığı hâller dışında net paydan kesinti yapmaz.

## 11. Gizlilik ve Kişisel Verilerin Korunması (KVKK)

- Sipariş kapsamında erişeceğiniz **müşteri fotoğrafları, 3D modeller, adres ve
  iletişim bilgileri kişisel veridir.** Bu verileri yalnızca ilgili siparişi
  üretmek amacıyla işleyebilir; **üçüncü kişilerle paylaşamaz, kopyalayamaz,
  saklamaya devam edemez ve başka hiçbir amaçla kullanamazsınız.**
- Bu ilişkide **Platform veri sorumlusu, Üretici veri işleyendir.** Kişisel
  verileri yalnızca Platformun talimatları doğrultusunda ve siparişin üretimi,
  boyacıya devri ve kargoya teslimi amacıyla işlersiniz. Üreticinin kendi
  hesap, vergi ve mağaza kayıtları bu hükmün kapsamı dışındadır.
- **İzinli alıcılar:** Üçüncü kişiyle paylaşma yasağının tek istisnası, siparişin
  ifası için zorunlu olan **kargo firması** (yalnızca gönderi için gerekli
  adres bilgisi) ve **Platformun atadığı boyacı ortaktır.**
- **Güvenlik:** Verilere erişen cihazlarda parola/ekran kilidi ve güncel
  işletim sistemi zorunludur; erişim yalnızca işi fiilen yapan kişilerle
  sınırlanır. **Personelinizi aynı gizlilik yükümlülüğüyle yazılı olarak
  bağlarsınız** ve fiillerinden sorumlu olursunuz. Müşteri fotoğraf ve
  modelleri sosyal medyada, mesajlaşma durumlarında veya numune/vitrin amaçlı
  hiçbir mecrada paylaşılamaz.
- **Bulut ve yapay zekâ hizmetleri:** Müşteri dosyalarını, üretim için zorunlu
  olmayan hiçbir bulut depolama, dosya paylaşım veya yapay zekâ hizmetine
  yükleyemezsiniz. Üretimin gerektirdiği bulut tabanlı dilimleme/yazıcı
  hizmetlerini kullanıyorsanız, dosyaları iş bitiminde o hesaptan da silersiniz.
- **İhlal bildirimi:** Verilerin kaybı, çalınması, yetkisiz erişimi veya
  yanlışlıkla paylaşılması hâlinde, durumu öğrendiğiniz andan itibaren **en geç
  24 saat içinde admin@figurunica.com adresine yazılı bildirimde bulunmanız
  zorunludur.** Yetkili kuruma ve ilgili kişilere bildirim, veri sorumlusu
  sıfatıyla Platforma aittir.
- **İmha:** Sipariş kargolandıktan (boyamalı siparişlerde boyacıya
  devredildikten) sonra, yasal saklama zorunluluğu yoksa, müşteriye ait
  fotoğraf, 3D model, baskı/dilimleme dosyası ve iletişim bilgilerinin **tüm
  kopyalarını (yerel disk, dilimleyici yazılımı, yedek, e-posta ve mesajlaşma
  uygulamaları dâhil) en geç 30 gün içinde kalıcı olarak imha etmeniz
  zorunludur.** Platform talep hâlinde yazılı imha beyanı isteyebilir.
- **Doğrulama:** Platform, bu maddeye uyumu doğrulamak için yazılı beyan, belge
  veya ekran görüntüsü talep edebilir; talebin karşılanmaması askıya alma
  sebebidir.
- Bu gizlilik yükümlülüğü, ortaklık sona erse dahi **süresiz olarak
  geçerlidir.**

## 12. Fikrî Mülkiyet

- **Müşteriye ait işlerde:** Müşteri tasarımları, üretilen 3D modeller ve bunlara
  ait baskı/önizleme dosyaları (STL/OBJ/GLB) **ilgili müşteriye ve/veya
  Platforma aittir.** Üretici bu dosyalar üzerinde **hiçbir mülkiyet veya
  kullanım hakkı iddia edemez.**
- Atanan siparişin dosyalarını **yeniden satamaz, çoğaltıp dağıtamaz, vitrin/
  numune olarak sergileyemez veya başka bir müşteriye üretemezsiniz.**
- **Üreticinin kendi mağaza ürünlerinde:** Mağazaya listelediğiniz kendi özgün
  tasarımlarınızın **fikrî mülkiyeti size aittir;** bu maddenin ilk fıkrası
  mağaza ürünlerinize uygulanmaz.
- Bir ürünü listeleyerek Platforma; **(a)** ürünün görsel, başlık ve
  açıklamasını mağazada ve tanıtım mecralarında yayımlamak, **(b)** yüklediğiniz
  baskı dosyalarını saklamak ve bunlardan yalnızca panel içi teknik önizleme
  üretmek, **(c)** ürüne gelen siparişin üretimi amacıyla baskı dosyasını
  siparişi ifa edecek üreticiye iletmek üzere **münhasır olmayan, ücretsiz bir
  kullanım hakkı** vermiş olursunuz. **Baskı dosyalarınız hiçbir zaman alıcıya
  açılmaz.**
- **Mağaza siparişini kural olarak yalnızca ürünün sahibi üretici basar.**
  Siparişi reddetmeniz veya hesabınızın askıya alınması hâlinde Platform,
  ödemesi alınmış bir siparişi ifa edebilmek için, size bildirmek kaydıyla,
  dosyayı yalnızca o siparişle sınırlı olarak başka bir üreticiye iletebilir;
  istemezseniz sipariş iptal ve iade edilir.
- Listelemeyi kaldırdığınızda ürün mağazadan çıkar ve yukarıdaki haklar sona
  erer; ancak **verilmiş siparişlerin ifası, sipariş/fatura geçmişi ve yasal
  saklama** bakımından mevcut kayıtlar saklanmaya devam eder.
- Mağazaya listelediğiniz tasarımın **üçüncü kişilerin telif, marka veya tasarım
  haklarını ihlal etmediğini ve gerekli izinlere sahip olduğunuzu taahhüt
  edersiniz.** Aksi hâlde doğacak taleplerden münhasıran siz sorumlu olursunuz;
  Platform ürünü **uyarısız yayından kaldırabilir.**

## 13. Performans, İhlal Kaydı (Strike), Askıya Alma ve Fesih

- **Atama önceliğiniz;** teslimat adresine olan mesafeniz, o anki iş yükünüz ve
  eş zamanlı iş limitiniz, reddetme geçmişiniz ve hesap uyum durumunuz
  (VKN/TCKN doğrulaması, tanımlı IBAN, "Sipariş Alıyorum" durumu) üzerinden
  hesaplanan bir puanla belirlenir.
- **Zamanında teslim verileriniz** (atama, kabul, baskı bitişi, QC gönderimi,
  kargo/devir zamanları) kayıt altına alınır ve **önceden bildirilmek kaydıyla**
  atama puanlamasına dâhil edilebilir.
- **Kalite kontrol sonuçlarınız, gecikmeleriniz ve hakkınızdaki müşteri
  itirazları** kayıt altına alınır ve uyarı, atama önceliğinin düşürülmesi,
  askıya alma veya fesih kararlarında **admin ekibi tarafından**
  değerlendirilir.
- **İhlal kaydı (strike):** Aşağıdaki hâllerde hesabınıza bir ihlal kaydı
  işlenir:
  - Kabul ettiğiniz bir siparişi sonradan iptal etmeniz **(her defasında ve
    otomatik olarak)**;
  - Gecikme, yanıtsızlık veya kalite riski nedeniyle siparişin admin tarafından
    geri alınması **(admin takdirindedir)**;
  - Bir müşteri anlaşmazlığının aleyhinize sonuçlanması ve ilgili hak edişin
    geri alınması.
- **Toplam 3 ihlal kaydına ulaşıldığında hesabınız otomatik olarak askıya
  alınır** ve kayıtlı e-postanıza bildirilir. **İhlal kayıtları zamanla
  silinmez;** askı admin değerlendirmesiyle kaldırılsa bile mevcut kayıtlar
  korunur, bu nedenle yeni bir ihlal hesabı doğrudan yeniden askıya alabilir.
  İhlal kayıtlarınızı ve gerekçelerini admin ekibinden talep edebilirsiniz.
- **Kabul sonrası iptal:** Kabul ettiğiniz siparişi yalnızca boyacıya
  devretmeden önce ve zorunlu bir sebeple iptal edebilirsiniz; gerekçesini
  yazmanız beklenir. Sipariş yeniden atama kuyruğuna döner, o siparişe ait
  QC fotoğraflarınız sonraki üreticiye aktarılmaz ve sipariş için pay tahakkuk
  etmez.
- **Kalite/süre standartlarının tekrarlayan ihlali, gizlilik veya fikrî mülkiyet
  ihlali, iş güvenliği/atık yükümlülüklerinin ihlali, yanıltıcı beyan ya da
  Platform dışına yönlendirme girişimi**, uyarı, askıya alma veya **sözleşmenin
  tek taraflı feshi** sebebidir.
- **Platform dışına yönlendirme (bypass) yasağı:** Sipariş kapsamında
  öğrendiğiniz müşteri bilgilerini yalnızca o siparişin üretimi ve teslimi için
  kullanırsınız. **Müşteriyle satış, pazarlama veya yeni iş amacıyla doğrudan
  iletişime geçemezsiniz;** size ulaşan talepleri Platforma yönlendirirsiniz.
  Platform aracılığıyla tanıştığınız müşterilere, ortaklık süresince ve sona
  ermesinden itibaren **12 ay boyunca** Platform dışında aynı/benzer hizmeti
  sunamazsınız. Aynı kural Platformun boyacı ortakları ve diğer üreticileri
  için de geçerlidir. Bu maddenin ihlali **haklı sebeple derhâl fesih**
  sebebidir. **Sipariş mesaj kanalları admin ekibince görüntülenebilir ve
  platform dışı iletişim bilgisi içeren mesajlar otomatik olarak incelemeye
  işaretlenir.**
- **Olağan fesih:** Taraflardan her biri, kayıtlı e-posta ile **en az 15 gün
  önce yazılı bildirimde bulunarak** ortaklığı sebep göstermeksizin
  sonlandırabilir. Bildirimden itibaren yeni sipariş atanmaz; kabul edilmiş
  siparişleri tamamlarsınız.
- **Haklı sebeple derhâl fesih:** Yukarıdaki ihlal hâllerinde ve Üreticinin
  faaliyetini fiilen durdurması hâlinde Platform, ihbar süresi beklemeksizin
  feshedebilir ve devam eden siparişlerin atamasını geri alabilir.
- **Sona ermenin sonuçları:** Tamamlanmamış siparişlere ait baskı dosyalarını,
  yarım baskıları ve Platform malzemelerini Platformun talimatına göre iade
  eder veya imha edersiniz; müşteri verilerini Madde 11 uyarınca imha
  edersiniz. Hak edilmiş net ödemeleriniz, 9. maddedeki olağan ödeme usulüne
  göre yapılır.
- **Ayakta kalan hükümler:** Gizlilik ve KVKK (11), fikrî mülkiyet (12),
  Platform dışına yönlendirme yasağı, sorumluluk ve garanti (16) ile
  uygulanacak hukuk ve yetkili mahkeme (17), sözleşme sona erse dahi yürürlükte
  kalır.

## 14. Mağaza/Pazaryeri Ürünleri (varsa)

- Aktif üretici olarak, kendi hazır 3D baskı ürünlerinizi panelden mağazaya
  listeleyebilirsiniz. Bir ürünü incelemeye gönderebilmeniz için **en az bir
  ürün görseli ve en az bir baskı dosyası (STL/OBJ)** yüklemeniz zorunludur.
  Ürün **taslak → incelemede → yayında** akışını izler ve mağazaya **ancak
  admin onayı ile** çıkar.
- Reddedilen üründe **ret gerekçesi size bildirilir**; düzeltip yeniden
  gönderebilirsiniz. **Yayındaki bir ürünün bilgilerini güncellerseniz ürün
  otomatik olarak yeniden incelemeye alınır** ve yeni onay verilene kadar
  mağazada görünmez.
- Ürününüzü dilediğiniz zaman arşivleyebilirsiniz; **arşivden çıkardığınız ürün
  taslak durumuna döner ve yeniden onaydan geçer.** Platform da kalite, mevzuat
  veya hak ihlali gerekçesiyle bir ürünü **önceden bildirim yapmaksızın yayından
  kaldırabilir.** Sipariş geçmişi olan ürünler kalıcı olarak silinemez.
- **Mağaza ürünleri stoktan değil, sipariş üzerine üretilir.** Ürününüze gelen
  sipariş, ödeme alınır alınmaz **doğrudan size atanır. Mağaza siparişini
  reddetmeniz hâlinde sipariş otomatik olarak başka bir üreticiye
  yönlendirilmez**, admin çözümüne düşer ve kural olarak **iptal edilip müşteriye
  iade edilir**; bu durum performans değerlendirmenize olumsuz yansır.
  Üretemeyeceğiniz bir ürünü yayında tutmayın.
- Her ürün için panelden **üretim/hazırlık süresi** beyan edersiniz. **Beyan
  ettiğiniz süre müşteriye gösterilir ve sizi bağlar;** 8. maddedeki süreler
  yerine bu süre uygulanır. Karşılayamayacağınız bir süre ilan etmeyin.
- **Kişiselleştirilmemiş mağaza ürünleri, tüketicinin teslimden itibaren 14
  günlük cayma hakkı kapsamındadır.** Bu nedenle mağaza ürünlerindeki hak
  edişiniz cayma süresi dolana kadar **koşulludur** ve ödemeye teslimden 14 gün
  sonra konu edilir. Cayma hâlinde ürünün size geri gönderilmesi Platform
  tarafından organize edilir, **iade kargo bedeli Platforma aittir** ve ürünün
  mülkiyeti sizde kalır; bu sipariş için hak ediş doğmaz veya geri alınır. İade
  edilen ürün kullanılmış/hasarlı dönerse bedelin ne kadarının size bırakılacağı
  admin incelemesiyle belirlenir.
- Listelediğiniz ürünün görsel, açıklama, ölçü, malzeme ve fiyat bilgilerinin
  doğruluğundan ve üçüncü kişilerin haklarını ihlal etmemesinden **siz
  sorumlusunuz** (bkz. Madde 12).
- Ürününüz için **doğru ve eksiksiz parça listesi, malzeme listesi ve montaj
  reçetesi** girmekle yükümlüsünüz. Admin, yayın öncesi ve sonrasında başlık,
  açıklama, fiyat ve termin bilgilerini düzeltebilir.
- Mağaza siparişleri; kişiye özel siparişlerle **aynı kalite, paketleme, QC ve
  komisyon esaslarına** tabidir.

## 15. Mevzuata Uygunluk, Çalışma Esasları ve Atölye Güvenliği

- Üretici, faaliyetini yürürlükteki mevzuata uygun yürütür; gerekli izin, kayıt
  ve vergi yükümlülüklerini kendisi yerine getirir.
- Üretici, **çocuk işçi çalıştırmayacağını, zorla veya kayıt dışı çalıştırma
  yapmayacağını** taahhüt eder.
- Reçine, izopropil alkol (IPA) ve benzeri kimyasallarla çalışırken **uygun
  havalandırma, eldiven/gözlük gibi kişisel koruyucu donanım ve güvenli
  depolama** kurallarına uyulur. **18 yaşından küçükler kürlenmemiş reçine ve
  solventlerle çalıştırılamaz.**
- **Kürlenmemiş reçine, kullanılmış IPA, yıkama suyu ve filtre atıkları lavaboya,
  kanalizasyona, toprağa veya evsel çöpe atılamaz.** Sıvı atıklar tamamen
  kürlenip katılaştırıldıktan sonra; kullanılmış IPA ve boş ambalajlar
  **tehlikeli atık** olarak ayrı toplanır ve mevzuata uygun biçimde bertaraf
  edilir.
- Atölyenin iş sağlığı ve güvenliği ile çevre mevzuatına uygunluğundan
  **münhasıran Üretici sorumludur.** Bu hüküm, 1. maddedeki bağımsız hizmet
  sağlayıcı niteliğini değiştirmez ve Platforma denetim yükümlülüğü doğurmaz.
- Üretici; Platform çalışanlarına veya üçüncü kişilere **rüşvet, komisyon,
  hediye veya menfaat teklif etmez** ve sipariş atama sırasını, performans
  puanını veya QC sonucunu etkilemeye yönelik girişimde bulunmaz.
- Bu maddeye aykırılık, 13. madde kapsamında **askıya alma ve fesih**
  sebebidir; doğan idari yaptırım ve zararlardan Üretici sorumludur.

## 16. Sorumluluk, Garanti, Sigorta ve Mücbir Sebep

- Üretici, teslim ettiği işin bu sözleşmedeki standartlara uygunluğunu garanti
  eder; **kusurlu işin ek ücret talep edilmeksizin yeniden üretim sorumluluğu
  Üreticiye aittir.** Bu garanti, Platformun müşteriye karşı sorumlu olduğu
  süre boyunca geçerlidir.
- **Ayıp bildirimi:** Platform, kendisine ulaşan ayıp/hasar bildirimini en geç
  5 iş günü içinde sipariş numarası, fotoğraf ve kusur tanımıyla size iletir.
  **Bildirimden itibaren 3 iş günü içinde yazılı yanıt vermeniz gerekir;**
  süresinde yanıt verilmezse kusur kabul edilmiş sayılır. Kusur üretimden
  kaynaklanıyorsa iş, **en geç 5 iş günü içinde ek ücret talep edilmeden**
  yeniden üretilir.
- **Gizli ayıplarda** (zamanla ortaya çıkan eksik kürlenme, iç boşlukta kalan
  reçine, katman ayrışması, kendiliğinden kırılma) süre, ayıbın ortaya çıktığı
  tarihten itibaren işler. **Müşterinin kullanım hatası, düşürme, ısı/güneş
  etkisi ve teslimden sonraki dış etkenler garanti kapsamı dışındadır.**
- **Sorumluluk sınırı:** Üreticinin bir sipariş bakımından bu sözleşmeden doğan
  toplam sorumluluğu, **ilgili siparişin müşteriden tahsil edilen bedeli ile o
  sipariş için ödenen kargo giderleri toplamını** aşmaz. Bu sınır; **kasıt, ağır
  ihmal, gizlilik/KVKK ihlali ve fikrî mülkiyet ihlalinde** uygulanmaz.
  Platformun Üreticiye karşı toplam sorumluluğu, **ilgili sipariş için ödenmesi
  gereken net üretici payı** ile sınırlıdır.
- Taraflar birbirlerine karşı **dolaylı zarar, kâr kaybı, iş/veri kaybı ve
  itibar kaybından** sorumlu değildir. **Hak edilmiş ve ödenmemiş net payları
  ödeme yükümlülüğü bu sınırdan bağımsız olarak saklıdır.**
- Üreticinin, atölyesindeki müşteri işleri ve Platform malzemeleri bakımından
  **yangın, hırsızlık ve su baskınına karşı makul bir sigorta yaptırması
  tavsiye edilir.** Platform, belirli bir iş hacminin üzerindeki ortaklıklarda
  bunu zorunlu tutabilir.
- Platform; ödeme tahsilatı, sipariş yönetimi, **siparişe ait 3D baskı
  dosyasının üretimi ve size iletilmesi**, kargo takip/bildirim altyapısı ve
  müşteri iletişimini sağlar.
- **Mücbir sebep:** Tarafların kontrolü dışındaki olaylar (doğal afet, genel
  altyapı kesintisi, mevzuat değişikliği vb.) etkilenen edimin ifasını ve süre
  yükümlülüklerini askıya alır; **muaccel para borçlarını ortadan kaldırmaz.**
  Etkilenen taraf durumu **en geç 3 gün içinde** bildirir; süresinde bildirim
  yapılmazsa mücbir sebebe dayanılamaz. Mücbir sebep **15 takvim gününü**
  aşarsa taraflar etkilenen siparişler bakımından yükümlülüklerini sona
  erdirebilir. **Yerel elektrik/internet kesintisi, yazıcı arızası, malzeme
  tedarik sıkıntısı, personel eksikliği ve iş yoğunluğu mücbir sebep
  sayılmaz.**

## 17. İletişim, Bildirimler ve Uyuşmazlık

- Sipariş atamaları, atamanın geri alınması, sipariş iptali, **QC sonuçları**,
  hesap durumu değişiklikleri, ödeme ve IBAN işlemleri ile duyurular hem
  **kayıtlı e-posta adresinize** gönderilir hem de **panelinizdeki
  "Bildirimler"** kutusuna düşer.
- Ayrıca **her siparişin admin ile aranızdaki özel bir mesaj kanalı** vardır.
  **Bu kanaldaki admin mesajları panelinize anlık düşer; e-posta yalnızca
  mesajı belirli bir süre okumazsanız gecikmeli hatırlatma olarak gönderilir.**
  Bu nedenle yalnızca e-postayı takip etmek yeterli değildir; **panelinizi,
  bildirimlerinizi ve açık siparişlerinizin mesaj kanallarını düzenli kontrol
  etmeniz beklenir.** Sipariş mesajlarına **en geç 1 iş günü içinde** yanıt
  vermeniz beklenir.
- Panelinizdeki bildirimler kutusuna düşen bir bildirim, e-posta teslimi
  gerçekleşmese dahi **tarafınıza yapılmış geçerli bir bildirim sayılır.**
- **Bildirim ve tebligat için esas alınan adres, panelinizdeki kayıtlı e-posta
  ve adres bilgilerinizdir;** bunları güncel tutmak Üreticinin
  sorumluluğundadır. **Güncellenmemiş adrese yapılan bildirim geçerli
  sayılır.** Platform için bildirim adresi **info@figurunica.com** ve **Şehit
  Osman Avcı Mahallesi, Akın 688 Sitesi B32, Etimesgut / Ankara**'dır.
- Taraflar, uyuşmazlıkları öncelikle **iyi niyetle ve doğrudan iletişimle**
  çözmeye çalışır. Bir tarafın yazılı bildirimi üzerine **30 gün** içinde
  çözülemeyen uyuşmazlıklarda **Türkiye Cumhuriyeti hukuku uygulanır** ve
  **Ankara Mahkemeleri ile İcra Daireleri yetkilidir.** Bu düzenleme, mevzuatın
  kesin yetki öngördüğü hâlleri ve Üreticinin tacir sayılmadığı hâllerde
  uygulanacak genel yetki kurallarını ortadan kaldırmaz.
- Ticari nitelikteki alacak ve tazminat uyuşmazlıklarında, mevzuat uyarınca
  **dava şartı olan arabuluculuk** süreci saklıdır.
- **Delil sözleşmesi:** Taraflar; panel işlem ve atama kayıtlarını, sipariş ve
  QC kayıtlarını (fotoğraflar ve inceleme sonuçları dâhil), bildirim ve e-posta
  gönderim kayıtlarını ve sözleşme kabul kaydını **kesin delil** olarak kabul
  eder.
- Üretici, bu sözleşme kapsamındaki işleri **kendi ticari/mesleki faaliyeti
  çerçevesinde ve bağımsız hizmet sağlayıcı sıfatıyla** yürütür; Platformun
  nihai müşterisi (tüketicisi) değildir.

## 18. Sözleşmenin Sürümü, Kabulü ve Değişiklikler

- Bu metnin **sürüm numarası ve yürürlük tarihi** başında yer alır. Başvuruyu
  tamamladığınızda kabul ettiğiniz sürüm, kabul tarihinizle birlikte kaydedilir;
  **talebiniz hâlinde kabul ettiğiniz metnin bir kopyası kayıtlı e-posta
  adresinize gönderilir.** Yürürlükteki güncel metin her zaman başvuru
  sayfasında yayımlanır.
- **Esaslı değişiklikler** — komisyon oranı, ödeme koşulları, üretim/kalite
  standartları, süre yükümlülükleri, sorumluluk ve ceza/askı rejimi ile fesih
  hükümleri — **yürürlüğe girmeden en az 15 gün önce** kayıtlı e-posta
  adresinize bildirilir. Yazım/biçim düzeltmeleri bu süreye tabi değildir.
- **Geriye yürümezlik:** Güncellenen şartlar, yürürlük tarihinden **önce
  kabul ettiğiniz siparişlere uygulanmaz.**
- Esaslı bir değişikliği kabul etmiyorsanız, yürürlük tarihine kadar 13. madde
  uyarınca ortaklığı sonlandırabilirsiniz; bu, **performans puanınızı
  etkilemez.** Yürürlük tarihinden sonra yeni sipariş kabul etmeye devam
  etmeniz, güncel sürümü kabul ettiğiniz anlamına gelir.
- Mevzuattan kaynaklanan zorunlu güncellemeler süre şartı olmaksızın yürürlüğe
  girebilir; bu hâlde durum gerekçesiyle birlikte derhâl bildirilir.

---

Bu metni okuyup kabul ederek, yukarıdaki tüm şartlar altında Figurunica üretici
ortaklığına başvurmayı kabul etmiş sayılırsınız.

Sorularınız için: **admin@figurunica.com**
`;
