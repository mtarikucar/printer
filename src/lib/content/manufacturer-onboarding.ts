/**
 * Figurunica Üretici Ortaklık Sözleşmesi ve Bilgilendirme metni.
 *
 * SINGLE SOURCE OF TRUTH — rendered as Markdown on the manufacturer register
 * flow (src/app/manufacturer/register/page.tsx) via react-markdown. **Bold**
 * spans are styled bold + underlined, so reserve `**…**` for genuinely
 * binding/important clauses. Turkish only (the platform is TR-only).
 */
export const MANUFACTURER_ONBOARDING_TR = `# Üretici Ortaklık Sözleşmesi ve Bilgilendirme

Bu metin, **Figurunica** platformu ("Platform") ile üretici ağına başvuran ve
başvuruyu onaylayarak ("Üretici") aşağıdaki şartlar altında hizmet vermeyi
kabul eden taraf arasındaki çalışma esaslarını düzenler. Başvuruyu tamamlamadan
önce bu metni **dikkatle okumanız ve kabul etmeniz zorunludur**. Hesabınız
onaylandıktan sonra paneliniz aktifleşir ve size sipariş atanmaya başlar.

> Bu metin bilgilendirme amaçlı çerçeve sözleşme niteliğindedir. Platform,
> hizmet kalitesini ve mevzuata uyumu korumak için şartları güncelleyebilir;
> önemli değişiklikler kayıtlı e-postanıza bildirilir ve panelde yayınlanır.

## 1. Taraflar ve Kapsam

- Üretici, Platform üzerinden iletilen 3D figürin baskı işlerini **kendi
  ekipmanı, sarf malzemesi ve iş gücüyle bağımsız bir hizmet sağlayıcı**
  sıfatıyla üretir. Bu sözleşme bir iş akdi (işçi-işveren ilişkisi) doğurmaz.
- Üretici ile Platform arasında münhasırlık yoktur; ancak atanan her sipariş
  için bu metindeki kalite, süre ve gizlilik yükümlülükleri **bağlayıcıdır**.

## 2. Başvuru, Kimlik Doğrulama ve Hesap Durumları

Hesabınız yaşam döngüsü boyunca aşağıdaki durumlardan birinde bulunur:

- **Beklemede:** Başvurunuz admin onayında. Henüz sipariş alamazsınız.
- **Koşullu Onaylı:** Ön onay verildi; **yazıcı fotoğrafı ve belge
  doğrulamasını (KYC) tamamlamanız** beklenir. Eksikler giderilene kadar
  sipariş atanmaz.
- **Aktif:** Tüm doğrulamalar tamam; sipariş alabilirsiniz.
- **Askıya Alınmış:** Yeni atama yapılmaz; varsa devam eden siparişlerinizi
  tamamlamanız beklenir.

Başvuru ve onay için **geçerli VKN veya TCKN, IBAN ve istenen üretim belgeleri
(yazıcı/atölye fotoğrafı dâhil) zorunludur**. Beyan edilen bilgilerin doğru,
güncel ve size ait olduğunu taahhüt edersiniz; yanlış/yanıltıcı beyan, hesabın
askıya alınması veya feshi sebebidir.

## 3. Sipariş Atama ve Kabul Süreci

- Müşteriler siparişi portaldan oluşturur ve **ödemeyi tamamlar**; üretime
  yalnızca ödemesi alınmış siparişler düşer.
- Admin ekibi; mevcut iş yükü, lokasyon (kargo mesafesi), geçmiş performans ve
  uygunluk puanına göre sipariş atamasını yapar.
- Atanan siparişe **24 saat içinde "Kabul Et" veya "Reddet" yanıtı vermeniz
  zorunludur.** Yanıt verilmez veya reddedilirse sipariş otomatik olarak başka
  bir üreticiye yönlendirilir. **Tekrarlayan reddetme ve yanıtsız bırakma,
  performans puanınızı düşürür** ve atama önceliğinizi azaltır.
- Kapasitenizi panelden yönetebilirsiniz: eş zamanlı iş limitinizi
  belirleyebilir, **"Sipariş Almıyorum" düğmesiyle dilediğiniz zaman yeni
  atamaları durdurabilirsiniz.** Bu, devam eden işlerinizi etkilemez.

## 4. Üretim Standartları ve Kalite Beklentileri

Platform hem **reçine (SLA/DLP/resin)** hem de **filament (FDM/FFF)** üretimini
destekler. **Her sipariş, üretilmesi gereken malzemeyi (reçine veya filament)
belirtir ve siparişi tam olarak belirtilen malzeme ve yöntemle üretmeniz
zorunludur.** Yalnızca elinizdeki ekipmanın karşılayabildiği malzemedeki
siparişleri kabul edin; uygun değilse siparişi reddedebilirsiniz.

**Reçine (resin) baskı:**
- **Katman yüksekliği 50 mikron (0,05 mm) veya altı** olmalıdır.
- Destekler dikkatlice sökülmeli, destek/izleme noktaları zımparalanıp
  temizlenmeli, parça yıkanıp tam olarak kürlenmelidir (UV cure).
- **Eksik kürlenme (yapışkan/yumuşak yüzey), beyazlama, görünür destek izi ve
  kırılgan/çatlak yüzey reddedilme sebebidir.**

**Filament (FDM) baskı:**
- **Katman yüksekliği 200 mikron (0,20 mm) veya altı** olmalıdır; ince detaylı
  modellerde daha düşük katman (0,10–0,12 mm) tercih edilmelidir.
- Sipariş, dolum (infill) ve dayanım gereksinimini taşıyabilir; aksi
  belirtilmedikçe **figürin bütünlüğünü koruyacak yeterli dolum ve duvar
  kalınlığı** kullanılmalıdır.
- Yüzeydeki **ipliklenme (stringing), sarkma, katman ayrışması/kabarma
  (delaminasyon), çarpılma (warping), eksik ekstrüzyon (under-extrusion), fil
  ayağı (elephant foot) ve belirgin dikiş/ek izleri reddedilme sebebidir.**
  Destek/raft izleri temizlenmeli, gerekli yerlerde zımpara/rötuş yapılmalıdır.

**Her iki yöntem için ortak:**
- Üretilen model; müşteriye gönderilen önizlemeye ve sipariş özelliklerine
  (boyut, stil, yüzey, malzeme) **birebir uygun** olmalıdır.
- Renklendirme ve son rötuş tamamlanmalıdır. **Kırık, eksik/yanlış parça,
  eksik boyama ve ölçü sapması her durumda reddedilme sebebidir.**
- Sipariş "Hazır" işaretlenmeden önce, kalite kontrol (QC) için **net ve
  yeterli sayıda fotoğraf yüklemeniz zorunludur.** Admin QC onayı verilene
  kadar sipariş kargoya verilmez. **QC reddi hâlinde, kusurlu işi ek ücret
  talep etmeden yeniden üretmekle yükümlüsünüz.**

## 5. Paketleme ve Kargo

- Her pakete **Platformun sağladığı standart fırça setini ve QR kartı**
  eklemeniz zorunludur. Müşteriye Platform markası dışında tanıtım/iletişim
  materyali, kendi kartınız veya fatura konulamaz.
- Ürün, taşımada hasar görmeyecek şekilde **uygun koruyucu malzemeyle**
  paketlenmelidir. **Yetersiz paketlemeden kaynaklanan taşıma hasarının
  sorumluluğu Üreticiye aittir.**
- Kargo, **Yurtiçi Kargo üzerinden Platform tarafından açılır**; siparişi
  "Hazır" işaretlediğinizde kargo etiketi panelinize düşer. Etiketi basıp
  paketin üzerine yapıştırır ve gönderiyi teslim edersiniz.

**Profesyonel boyama siparişleri (boyacıya devir):** Bazı siparişlerde müşteri
**profesyonel el boyama** seçeneğini satın alır. Bu siparişlerde figürini **siz
boyamaz ve müşteriye kargolamazsınız.** Baskıyı üretip QC onayından geçirdikten
sonra, figürini panelinizdeki **"Boyacıya Gönder"** adımıyla, Platformun boyacı
ağındaki bir **boyacı ortağa** devredersiniz. Bu andan itibaren boyama, kendi
kalite kontrolü, paketleme ve müşteriye kargo **boyacı tarafından** yürütülür.
Sizin sorumluluğunuz, siparişin özelliklerine birebir uygun, kusursuz ve
QC-onaylı **boyasız/baz baskıyı** zamanında ve eksiksiz biçimde boyacıya
iletmektir. Boyacıya devredilen işteki baskı kusurları (kırık, eksik parça,
ölçü sapması, temizlenmemiş destek izi vb.) sizin sorumluluğunuzdadır.

## 6. Süreler ve Gecikme

- Kabul edilen bir sipariş için **ortalama üretim süresi 5 iş günüdür.** Bu
  süre, kabul anından kargoya teslim anına kadar geçen süredir.
- Öngörülemeyen bir gecikme doğacaksa, **süre dolmadan admin ekibini
  bilgilendirmeniz** beklenir. **Bildirimsiz ve tekrarlayan gecikmeler**
  performans puanını düşürür, atama önceliğini azaltır ve hesabın askıya
  alınmasına yol açabilir.

## 7. Ücretlendirme, Komisyon ve Ödeme

- Her tamamlanan ve teslim edilen sipariş için Üreticiye **net üretici payı**
  ödenir. Net pay, sipariş tutarından **Platform hizmet bedeli (komisyon)**
  düşülerek hesaplanır. **Güncel Platform komisyonu %35, üreticinin net payı
  ise %65'tir.** Komisyon oranı ve her siparişin net payı panelde şeffaf biçimde
  gösterilir; oran değişirse önceden bildirilir.
- **Profesyonel boyama içeren siparişlerde** net üretici payınız, sipariş
  tutarından **boyama bedeli düşülerek (yalnızca baskı payı) üzerinden**
  hesaplanır; boyama bedelinin payı ilgili **boyacıya** ödenir. Bu siparişlerde
  üretici hak edişiniz, işi boyacıya devrettiğinizde tahakkuk eder.
- Ödemeler, **tanımlı IBAN'ınıza haftalık olarak (Cuma günleri) toplu** yapılır.
  Hesap kesim/ödeme raporunuzu panelden indirebilirsiniz.
- Ödemenin yapılabilmesi için **VKN/TCKN ve IBAN bilgilerinizin eksiksiz ve
  doğru** olması şarttır; eksik/hatalı bilgiden kaynaklanan ödeme gecikmeleri
  Platformun sorumluluğunda değildir.
- İade, iptal veya QC reddi gibi tamamlanmamış işler için pay tahakkuk etmez;
  kusurlu iş nedeniyle doğan yeniden üretim maliyeti Üreticiye aittir.

## 8. Vergi ve Faturalandırma

- Üretici, elde ettiği gelire ilişkin **vergisel yükümlülüklerden (beyan, fatura
  düzenleme dâhil) bizzat sorumludur.** Platform yalnızca net payı IBAN'a
  aktarır ve kesim raporu sağlar.
- Tüzel kişi/şahıs şirketi iseniz, mevzuatın gerektirdiği hâllerde Platforma
  fatura düzenlemeniz gerekebilir.

## 9. Gizlilik ve Kişisel Verilerin Korunması (KVKK)

- Sipariş kapsamında erişeceğiniz **müşteri fotoğrafları, 3D modeller, adres ve
  iletişim bilgileri kişisel veridir.** Bu verileri yalnızca ilgili siparişi
  üretmek amacıyla işleyebilir; **üçüncü kişilerle paylaşamaz, kopyalayamaz,
  saklamaya devam edemez ve başka hiçbir amaçla kullanamazsınız.**
- Sipariş tamamlandıktan sonra, yasal saklama zorunluluğu yoksa, müşteriye ait
  dosya ve verileri **imha etmeniz** beklenir.
- Bu gizlilik yükümlülüğü, ortaklık sona erse dahi **süresiz olarak geçerlidir.**

## 10. Fikrî Mülkiyet

- Müşteri tasarımları, üretilen 3D modeller ve baskı dosyaları (STL/OBJ) **ilgili
  müşteriye ve/veya Platforma aittir.** Üretici, bu dosya ve modeller üzerinde
  **hiçbir mülkiyet veya kullanım hakkı iddia edemez.**
- Atanan siparişin dosyalarını **yeniden satamaz, çoğaltıp dağıtamaz, vitrin/
  numune olarak sergileyemez veya başka bir müşteriye üretemezsiniz.**

## 11. Performans, Uyarı, Askıya Alma ve Fesih

- Performansınız; kabul oranı, zamanında teslim, QC onay oranı ve müşteri
  memnuniyeti üzerinden değerlendirilir.
- **Kalite/süre standartlarının tekrarlayan ihlali, gizlilik veya fikrî mülkiyet
  ihlali, yanıltıcı beyan ya da Platform dışına yönlendirme girişimi**, uyarı,
  askıya alma veya **sözleşmenin tek taraflı feshi** sebebidir.
- Her iki taraf da, devam eden siparişlerin tamamlanması kaydıyla, ortaklığı
  sonlandırabilir. Fesih hâlinde, hak edilmiş net ödemeleriniz olağan ödeme
  takviminde yapılır.

## 12. Mağaza/Pazaryeri Ürünleri (varsa)

- Aktif üretici olarak, kendi hazır 3D baskı ürünlerinizi panelden mağazaya
  listeleyebilirsiniz. Listelenen her ürün **admin onayından geçer** ve aynı
  kalite, paketleme, süre ve komisyon esaslarına tabidir.

## 13. Sorumluluk, Garanti ve Mücbir Sebep

- Üretici, teslim ettiği işin bu sözleşmedeki standartlara uygunluğunu garanti
  eder; **kusurlu işin yeniden üretim sorumluluğu Üreticiye aittir.**
- Platform; ödeme tahsilatı, sipariş yönetimi, kargo entegrasyonu ve müşteri
  iletişimini sağlar. Tarafların kontrolü dışındaki olaylar (doğal afet, genel
  kesinti, mevzuat değişikliği vb. **mücbir sebepler**) süre yükümlülüklerini
  makul ölçüde askıya alır; taraflar durumu en kısa sürede bildirir.

## 14. İletişim, Bildirimler ve Uyuşmazlık

- Yeni atamalar, durum değişiklikleri ve admin mesajları **kayıtlı e-posta
  adresinize** gönderilir; e-postalarınızı düzenli takip etmeniz beklenir.
  Belirttiğiniz telefon ve (varsa) WhatsApp numarası admin ekibine görünür olur.
- Bildirimler için esas alınan adres, panelinizdeki kayıtlı iletişim
  bilgilerinizdir; bunları güncel tutmak Üreticinin sorumluluğundadır.
- Taraflar, uyuşmazlıkları öncelikle **iyi niyetle ve doğrudan iletişimle**
  çözmeye çalışır.

---

Bu metni okuyup kabul ederek, yukarıdaki tüm şartlar altında Figurunica üretici
ortaklığına başvurmayı kabul etmiş sayılırsınız.

Sorularınız için: **admin@figurunica.com**
`;
