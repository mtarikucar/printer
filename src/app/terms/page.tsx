import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Terms of Service — Figurunica",
};

export default async function TermsPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Kullanım Koşulları" : "Terms of Service"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son güncelleme: 31 Mart 2026" : "Last updated: March 31, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Bu Kullanım Koşulları (&quot;Koşullar&quot;), Figurunica (&quot;Şirket&quot;, &quot;biz&quot;, &quot;bizim&quot;) tarafından
                figurunica.com web sitesi ve ilişkili hizmetler üzerinden sunulan hizmetlerin kullanımına
                ilişkin şartları düzenlemektedir. Hizmetlerimizi kullanarak bu Koşullar&apos;ı kabul etmiş sayılırsınız.
              </p>

              <h2>1. Hizmet Tanımı</h2>
              <p>Figurunica aşağıdaki hizmetleri sunmaktadır:</p>
              <ul>
                <li>Kullanıcı tarafından yüklenen fotoğraflardan yapay zeka destekli 3D model oluşturma</li>
                <li>Oluşturulan 3D modellerin reçine baskı ile fiziksel figürin üretimi</li>
                <li>Figürin ile birlikte boyama kiti (boyalar, fırçalar, rehber) gönderimi</li>
                <li>3D obje oluşturma ve baskı hizmeti</li>
                <li>Dijital STL dosyası satışı</li>
                <li>Hediye kartı satış ve kullanım hizmeti</li>
              </ul>

              <h2>2. Sipariş Süreci</h2>

              <h3>2.1 Sipariş Oluşturma</h3>
              <ul>
                <li>Kullanıcı, web sitemiz üzerinden fotoğraf yükleyerek, figürin boyutunu ve stilini seçerek sipariş oluşturur.</li>
                <li>Sipariş sonrası yapay zekamız bir 3D model önizlemesi oluşturur.</li>
                <li>Kullanıcı, 3D önizlemeyi inceleyip onayladıktan sonra ödeme işlemine geçer.</li>
                <li>Ödeme tamamlandıktan sonra üretim süreci başlar.</li>
              </ul>

              <h3>2.2 Önizleme ve Onay</h3>
              <ul>
                <li>Her sipariş için baskı öncesi dijital önizleme sunulur.</li>
                <li>Kullanıcı, önizlemeyi onaylayana kadar baskı işlemi başlamaz.</li>
                <li>Önizleme, nihai ürünün yaklaşık bir temsilidir; malzeme, renk ve detaylarda küçük farklılıklar olabilir.</li>
              </ul>

              <h3>2.3 Üretim ve Teslimat</h3>
              <ul>
                <li>Onaylanan siparişler genellikle 5-7 iş günü içinde üretilir.</li>
                <li>Yurt içi kargo ücretsizdir ve 2-3 iş günü sürer.</li>
                <li>Belirtilen süreler tahmini olup, yoğunluk dönemlerinde uzayabilir.</li>
                <li>Teslimat adresi sipariş sırasında belirtilen adrestir; adres değişikliği için üretim başlamadan önce iletişime geçiniz.</li>
              </ul>

              <h2>3. Fiyatlandırma ve Ödeme</h2>

              <h3>3.1 Fiyatlar</h3>
              <ul>
                <li>Tüm fiyatlar Türk Lirası (TL) cinsinden ve KDV dahildir.</li>
                <li>Güncel fiyatlar web sitemizde belirtilmektedir.</li>
                <li>Şirket, fiyatları önceden bildirimde bulunmaksızın değiştirme hakkını saklı tutar. Değişiklikler mevcut siparişleri etkilemez.</li>
              </ul>

              <h3>3.2 Ödeme Yöntemleri</h3>
              <ul>
                <li>Kredi kartı / banka kartı (PayTR üzerinden)</li>
                <li>Hediye kartı</li>
                <li>Hediye kartı + kredi kartı kombinasyonu</li>
              </ul>

              <h3>3.3 Hediye Kartları</h3>
              <ul>
                <li>Hediye kartları satın alınma tarihinden itibaren 1 yıl geçerlidir.</li>
                <li>Hediye kartları iade edilemez ve nakde çevrilemez.</li>
                <li>Hediye kartı bakiyesi sipariş tutarını karşılamazsa, kalan tutar başka bir ödeme yöntemiyle tamamlanabilir.</li>
                <li>Hediye kartı bakiyesi sipariş tutarını aşarsa, kalan bakiye bir sonraki siparişte kullanılabilir.</li>
              </ul>

              <h2>4. İptal ve İade Politikası</h2>

              <h3>4.1 Sipariş İptali</h3>
              <ul>
                <li>Üretim başlamadan önce sipariş iptal edilebilir.</li>
                <li>Önizleme onayı verilmeden önceki siparişler ücretsiz iptal edilebilir.</li>
                <li>Önizleme onaylandıktan ve üretim başladıktan sonra iptal kabul edilmez.</li>
              </ul>

              <h3>4.2 İade</h3>
              <ul>
                <li>Her figürin özel üretim olduğu için standart iade kabul edilmemektedir.</li>
                <li>Ürün hasar görmüş veya hatalı olarak teslim edilmişse, teslim tarihinden itibaren 14 gün içinde bizimle iletişime geçiniz.</li>
                <li>Kalite sorunu tespit edilmesi halinde ücretsiz yeniden üretim veya iade yapılır.</li>
                <li>Ürünün fotoğrafı ve sorunun açıklaması ile birlikte info@figurunica.com adresine başvuru yapılmalıdır.</li>
              </ul>

              <h3>4.3 Mesafeli Satış Sözleşmesi</h3>
              <p>
                6502 sayılı Tüketicinin Korunması Hakkında Kanun&apos;un 48. maddesi ve Mesafeli Sözleşmeler Yönetmeliği
                kapsamında, özel üretim ürünler (kişiye özel figürinler) cayma hakkı kapsamında değildir.
                Ancak ürünün ayıplı teslimi halinde tüketici hakları saklıdır.
              </p>

              <h2>5. Fikri Mülkiyet Hakları</h2>

              <h3>5.1 Şirket Hakları</h3>
              <ul>
                <li>Figurunica markası, logosu, web sitesi tasarımı, yazılımı ve içeriği Şirket&apos;in fikri mülkiyetidir.</li>
                <li>Yapay zeka modelleri ve üretim süreçleri Şirket&apos;e aittir.</li>
              </ul>

              <h3>5.2 Yüklenen İçerik ve İzinler</h3>
              <p>
                Bu bölümde &quot;Yüklenen İçerik&quot; Müşteri&apos;nin sipariş sürecinde yüklediği her türlü
                fotoğraf, görsel, logo ve dosyayı; &quot;Tasvir Edilen Kişi&quot; ise Yüklenen İçerik&apos;te
                yüzü/benzerliği yer alan gerçek kişiyi ifade eder.
              </p>
              <ul>
                <li>Yüklediğiniz fotoğrafların telif hakkı size aittir; Yüklenen İçerik üzerinde tasarruf yetkisine sahip olduğunuzu beyan edersiniz.</li>
                <li>Fotoğraf yükleyerek, bu içeriğin figür/obje üretimi, stilize önizleme görseli oluşturulması ve siparişin ifası amacıyla işlenmesine izin vermiş olursunuz.</li>
                <li>Galeriye paylaştığınız figür görsellerinin Şirket tarafından tanıtım amaçlı kullanılmasına izin vermiş olursunuz; paylaşımlarınızı istediğiniz zaman galeriden kaldırabilirsiniz.</li>
              </ul>

              <h3>5.3 Kişisel Verilerin Korunması (KVKK)</h3>
              <ul>
                <li>Yüklenen İçerik bir gerçek kişiye ait yüz/görüntü içeriyorsa bu, 6698 sayılı Kanun anlamında kişisel veridir. Bu veriyi yükleyerek, Tasvir Edilen Kişi&apos;nin görüntüsünün figür üretimi ve siparişin ifası amacıyla işlenmesi için gerekli her türlü hukuki dayanağı (gerektiğinde açık rıza dâhil) önceden temin ettiğinizi kabul ve taahhüt edersiniz.</li>
                <li>Yüklenen İçerik&apos;te kendiniz dışında bir kişi yer alıyorsa, o kişinin görüntüsünün işlenmesine, figüre dönüştürülmesine ve bu amaçla yurt içi/yurt dışı hizmet sağlayıcılara aktarılmasına ilişkin açık rızasını (çocuk ise velisinin/yasal temsilcisinin rızasını) ispatlanabilir biçimde aldığınızı taahhüt edersiniz. Şirket, talebi hâlinde bu rızanın belgelenmesini isteyebilir.</li>
                <li>Stilize görsel üretimi amacıyla Yüklenen İçerik, yurt dışında yerleşik üçüncü taraf yapay zeka hizmet sağlayıcılarına aktarılabilir. Bu sınır ötesi aktarım için Tasvir Edilen Kişi&apos;yi bilgilendirmek ve gerekli rızayı almak dâhil KVKK m.9 kapsamındaki yükümlülüklerin yerine getirildiğini kabul edersiniz.</li>
                <li>Yüklenen İçerik&apos;in Şirket tarafından yüz tanıma veya benzersiz kimlik doğrulama amaçlı özel bir teknik yöntemle işlenmediğini; bu nedenle Şirket nezdinde kural olarak biyometrik veri olarak işlenmediğini kabul edersiniz.</li>
                <li>Verilerin işlenmesine ilişkin ayrıntılar Aydınlatma Metni ve Gizlilik Politikası&apos;nda açıklanmıştır; KVKK m.11 kapsamındaki haklarınızı (silme/yok etme talebi dâhil) kullanabilirsiniz. Şirket&apos;in kanuni saklama ve ispat yükümlülükleri saklıdır.</li>
              </ul>

              <h3>5.4 Kişilik Hakları ve Portre</h3>
              <ul>
                <li>Her kişinin kendi görüntüsü üzerinde hukuken korunan bir kişilik hakkı vardır. Bir kişinin görüntüsünün rızası dışında işlenmesi, çoğaltılması veya figüre dönüştürülmesi, kişilik hakkına hukuka aykırı bir saldırı teşkil edebilir (TMK m.24-25).</li>
                <li>Bir kişinin resmi/portresi, tasvir edilenin (ölmüşse ölümünden itibaren on yıl içinde kanunda sayılan yakınlarının/mirasçılarının) açık rızası olmadıkça teşhir/umuma arz edilemez (FSEK m.86). Siparişe konu görüntü için gerekli rızayı aldığınızı taahhüt edersiniz.</li>
              </ul>

              <h3>5.5 Ünlüler ve Tanınmış Kişiler</h3>
              <ul>
                <li>Ünlü, tanınmış veya kamuya mal olmuş kişilerin (sanatçı, sporcu, siyasetçi, kamu görevlisi vb.) yüzünü, benzerliğini (likeness), karakterini veya ayırt edici görünümünü içeren fotoğraf yükleyemezsiniz.</li>
                <li>Böyle bir kişinin görüntüsünün rızası olmaksızın ticari bir ürüne dönüştürülmesi; kişilik hakkının ihlali ve kişinin isim/görüntüsünün ticari değerinden haksız yararlanma teşkil eder. Şirket, tanınmış bir kişiyi içerdiğinden şüphe ettiği siparişleri, ilgili kişinin yazılı muvafakati ibraz edilmedikçe reddetme hakkını saklı tutar.</li>
              </ul>

              <h3>5.6 Çocuklar ve Reşit Olmayanlar</h3>
              <ul>
                <li>Yüklenen İçerik&apos;te on sekiz yaşından küçük bir çocuk yer alıyorsa, çocuğun görüntüsünün işlenmesi ve figüre dönüştürülmesi için velisinin/yasal temsilcisinin açık rızasını aldığınızı taahhüt edersiniz.</li>
                <li>Çocuk görselinin hiçbir şekilde müstehcen, cinsel içerikli, istismar edici veya çocuğun üstün yararına aykırı biçimde kullanılmadığını kabul edersiniz. Şirket, veli rızası teyit edilemeyen çocuk siparişlerini reddedebilir.</li>
              </ul>

              <h3>5.7 Üçüncü Kişi Telif ve Marka Hakları</h3>
              <ul>
                <li>Profesyonel bir fotoğrafçı/stüdyo veya üçüncü kişi tarafından çekilmiş ve eser niteliği taşıyan bir fotoğrafı, hak sahibinin izni olmaksızın yükleyemezsiniz (FSEK). Aksi hâlde doğacak telif ihlali sorumluluğu size aittir.</li>
                <li>Tescilli marka, logo, amblem ile film/çizgi film/oyun karakterlerini ya da telif/marka korumasına tabi tasarımları, hak sahibinin lisansı olmaksızın yükleyemez ve bunlardan figür üretilmesini talep edemezsiniz (6769 s. SMK; FSEK). Bu tür taleplerden doğacak ihlaller münhasıran sizin sorumluluğunuzdadır.</li>
              </ul>

              <h3>5.8 Yasak İçerik</h3>
              <p>Aşağıdaki nitelikleri taşıyan hiçbir görseli yükleyemez ve bunlardan figür üretilmesini talep edemezsiniz:</p>
              <ul>
                <li>Halkı ırk, din, mezhep, dil, cinsiyet, etnik köken temelinde kin ve düşmanlığa tahrik eden, aşağılayan veya dini değerleri alenen aşağılayan içerikler (TCK m.216).</li>
                <li>Müstehcen/pornografik içerikler; özellikle çocukların kullanıldığı veya temsilî çocuk görüntülerini içeren her türlü müstehcen içerik (TCK m.226).</li>
                <li>Bir kişinin onur, şeref ve saygınlığını rencide edici, hakaret niteliğinde içerikler (TCK m.125).</li>
                <li>Atatürk&apos;ün hatırasına hakaret/sövme niteliği taşıyan içerikler (5816 s. Kanun).</li>
                <li>Terör örgütlerini veya cebir/şiddet/tehdit yöntemlerini meşru gösteren, öven ya da teşvik eden propaganda içerikleri; yasa dışı örgüt sembol ve amblemleri (3713 s. TMK m.7).</li>
                <li>Seçim propagandası, siyasi parti/aday reklamı ve toplumsal-siyasal açıdan kutuplaştırıcı, hassas içerikler.</li>
                <li>Şiddeti, silahı, uyuşturucuyu veya yasa dışı faaliyetleri öven/özendiren; nefret sembolleri içeren görseller.</li>
                <li>Bir kişinin özel hayatına ilişkin, rıza dışı veya hukuka aykırı biçimde elde edilmiş görüntüler (TCK m.134, m.136); üçüncü kişilerin gizlilik haklarını ihlal eden içerikler.</li>
              </ul>

              <h3>5.9 Şirketin Reddetme ve İptal Hakkı</h3>
              <ul>
                <li>Şirket; sözleşmeye, mevzuata veya kamu düzenine aykırı olduğundan şüphe ettiği ya da yasak içerik taşıdığını değerlendirdiği herhangi bir siparişi veya Yüklenen İçerik&apos;i, tek taraflı olarak reddetme, üretimi durdurma veya siparişi iptal etme hakkını saklı tutar.</li>
                <li>Bu hâlde üretime henüz başlanmamışsa ödenen bedel iade edilir; hukuka aykırı içerik nedeniyle iptalde iade, üretim/emek masrafları düşülerek yapılabilir. Tüketici mevzuatındaki haklarınız saklıdır.</li>
              </ul>

              <h3>5.10 Tazminat ve Şirketi Beri Kılma</h3>
              <ul>
                <li>Bu sözleşmedeki taahhütlerinize aykırı davranmanız veya Yüklenen İçerik&apos;in üçüncü kişilerin kişisel verilerine, kişilik/telif/marka haklarına ya da mevzuata aykırılık teşkil etmesi nedeniyle Şirket aleyhine üçüncü kişiler veya resmî/idari makamlar (KVKK Kurumu, mahkemeler, savcılıklar dâhil) tarafından ileri sürülecek her türlü talep, dava, idari para cezası ve yaptırımdan münhasıran siz sorumlu olursunuz.</li>
                <li>Şirket&apos;in bu nedenle uğrayacağı doğrudan zararları, ödemek zorunda kaldığı tazminat ve para cezalarını, avukatlık ücretleri ve yargılama giderleri dâhil olmak üzere derhâl ve nakden tazmin etmeyi (Şirket&apos;i beri kılmayı) kabul ve taahhüt edersiniz (TBK m.49, m.112). Şirket, Yüklenen İçerik&apos;in beyanlarınıza güvenerek işlem yaptığından, hukuka aykırılıktan doğan sonuçlarda size rücu eder.</li>
              </ul>

              <h3>5.11 Beyan, Tekeffül ve Ek Hükümler</h3>
              <ul>
                <li>Sipariş vererek: (a) Yüklenen İçerik üzerinde gerekli tüm izin/rıza/lisansları edindiğinizi; (b) Tasvir Edilen Kişi(ler)in ve/veya yasal temsilcilerinin açık rızasını aldığınızı; (c) içeriğin hiçbir üçüncü kişinin haklarını ihlal etmediğini; (d) yukarıda sayılan yasak içeriklerden hiçbirini taşımadığını; (e) verdiğiniz bilgilerin doğru olduğunu beyan ve taahhüt edersiniz.</li>
                <li>Şirket&apos;in ürettiği stilize 2D görsel ve 3D model üzerindeki fikri haklar Şirket&apos;e aittir; teslim edilen figür ve (satın alındıysa) dijital çıktı üzerinde size kişisel, gayri ticari kullanım hakkı tanınır.</li>
                <li>Yüklenen İçerik&apos;i veya çıktıyı; yanıltıcı temsil (deepfake), dolandırıcılık, kimlik taklidi veya iftira amaçlı kullanamazsınız. Vefat etmiş kişilerin görüntüsünde, kanunda sayılan yakınlarının rızasıyla ve kişinin hatırasına saygı göstererek hareket edersiniz.</li>
              </ul>

              <h2>6. Sorumluluk Sınırlaması</h2>

              <h3>6.1 Hizmet Garantisi</h3>
              <ul>
                <li>Yapay zeka tarafından oluşturulan 3D modellerin kalitesi, yüklenen fotoğrafın kalitesine bağlıdır.</li>
                <li>Önizleme ile nihai ürün arasında küçük farklılıklar olabilir (renk tonları, detay seviyeleri vb.).</li>
                <li>3D baskı sürecinin doğası gereği, her ürün eşsizdir ve küçük farklılıklar üretim toleransları içerisindedir.</li>
              </ul>

              <h3>6.2 Sorumluluk Sınırı</h3>
              <ul>
                <li>Şirket, hizmet kesintileri, teknik arızalar veya üçüncü taraf hizmet sağlayıcılardan kaynaklanan aksaklıklar nedeniyle oluşan dolaylı zararlardan sorumlu değildir.</li>
                <li>Şirket&apos;in toplam sorumluluğu, ilgili siparişin bedelini aşmaz.</li>
              </ul>

              <h2>7. Hesap Kullanımı</h2>
              <ul>
                <li>Hesabınızı başkasına devredemezsiniz.</li>
                <li>Hesap bilgilerinizin güvenliğinden siz sorumlusunuz.</li>
                <li>Hesabınızda yetkisiz erişim farketmeniz halinde derhal bizimle iletişime geçiniz.</li>
                <li>Şirket, bu Koşullar&apos;ı ihlal eden hesapları askıya alma veya kapatma hakkını saklı tutar.</li>
              </ul>

              <h2>8. Mücbir Sebepler</h2>
              <p>
                Doğal afetler, salgınlar, savaş, grev, hükümet kararları, internet altyapı sorunları ve benzeri
                kontrol dışında gelişen olaylar nedeniyle hizmetlerin aksaması veya gecikmesi halinde Şirket sorumlu tutulamaz.
              </p>

              <h2>9. Uyuşmazlık Çözümü</h2>
              <ul>
                <li>Bu Koşullar Türkiye Cumhuriyeti kanunlarına tabidir.</li>
                <li>Uyuşmazlıklarda İstanbul Mahkemeleri ve İcra Daireleri yetkilidir.</li>
                <li>Tüketici şikayetleri için Tüketici Hakem Heyetlerine başvurulabilir.</li>
              </ul>

              <h2>10. Değişiklikler</h2>
              <p>
                Şirket, bu Koşullar&apos;ı herhangi bir zamanda değiştirme hakkını saklı tutar. Değişiklikler
                web sitemizde yayınlandığında yürürlüğe girer. Önemli değişiklikler hakkında kayıtlı
                kullanıcılara e-posta ile bildirim yapılır.
              </p>

              <h2>11. İletişim</h2>
              <p>Bu Kullanım Koşulları hakkında sorularınız için:</p>
              <ul>
                <li>E-posta: info@figurunica.com</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                These Terms of Service (&quot;Terms&quot;) govern the use of services provided by Figurunica (&quot;Company&quot;, &quot;we&quot;, &quot;our&quot;)
                through the figurunica.com website and related services. By using our services, you agree to these Terms.
              </p>

              <h2>1. Service Description</h2>
              <p>Figurunica provides the following services:</p>
              <ul>
                <li>AI-powered 3D model generation from user-uploaded photos</li>
                <li>Physical figurine production from generated 3D models using resin printing</li>
                <li>Paint kit delivery with figurines (paints, brushes, guide)</li>
                <li>3D object creation and printing service</li>
                <li>Digital STL file sales</li>
                <li>Gift card sales and usage service</li>
              </ul>

              <h2>2. Order Process</h2>

              <h3>2.1 Creating an Order</h3>
              <ul>
                <li>Users create orders by uploading a photo, selecting figurine size and style through our website.</li>
                <li>After the order, our AI generates a 3D model preview.</li>
                <li>After reviewing and approving the 3D preview, the user proceeds to payment.</li>
                <li>Production begins after payment is completed.</li>
              </ul>

              <h3>2.2 Preview and Approval</h3>
              <ul>
                <li>A digital preview is provided before printing for every order.</li>
                <li>Printing does not begin until the user approves the preview.</li>
                <li>The preview is an approximate representation of the final product; minor differences in material, color, and details may occur.</li>
              </ul>

              <h3>2.3 Production and Delivery</h3>
              <ul>
                <li>Approved orders are typically produced within 5-7 business days.</li>
                <li>Domestic shipping is free and takes 2-3 business days.</li>
                <li>Stated timelines are estimates and may be extended during peak periods.</li>
                <li>The delivery address is the one provided at the time of order; for address changes, contact us before production begins.</li>
              </ul>

              <h2>3. Pricing and Payment</h2>

              <h3>3.1 Prices</h3>
              <ul>
                <li>All prices are in Turkish Lira (TL) and include VAT.</li>
                <li>Current prices are listed on our website.</li>
                <li>The Company reserves the right to change prices without prior notice. Changes do not affect existing orders.</li>
              </ul>

              <h3>3.2 Payment Methods</h3>
              <ul>
                <li>Credit card / debit card (via PayTR)</li>
                <li>Gift card</li>
                <li>Gift card + credit card combination</li>
              </ul>

              <h3>3.3 Gift Cards</h3>
              <ul>
                <li>Gift cards are valid for 1 year from the date of purchase.</li>
                <li>Gift cards are non-refundable and cannot be converted to cash.</li>
                <li>If the gift card balance does not cover the order amount, the remaining amount can be paid with another payment method.</li>
                <li>If the gift card balance exceeds the order amount, the remaining balance can be used on the next order.</li>
              </ul>

              <h2>4. Cancellation and Return Policy</h2>

              <h3>4.1 Order Cancellation</h3>
              <ul>
                <li>Orders can be cancelled before production begins.</li>
                <li>Orders before preview approval can be cancelled free of charge.</li>
                <li>Cancellations are not accepted after preview approval and production start.</li>
              </ul>

              <h3>4.2 Returns</h3>
              <ul>
                <li>Standard returns are not accepted as each figurine is custom-made.</li>
                <li>If the product is delivered damaged or defective, contact us within 14 days of delivery.</li>
                <li>If a quality issue is confirmed, free reproduction or refund will be provided.</li>
                <li>Applications should be made to info@figurunica.com with a photo of the product and description of the issue.</li>
              </ul>

              <h3>4.3 Distance Sales Contract</h3>
              <p>
                Under Article 48 of Turkish Consumer Protection Law No. 6502 and the Distance Contracts Regulation,
                custom-made products (personalized figurines) are exempt from the right of withdrawal.
                However, consumer rights in case of defective delivery are reserved.
              </p>

              <h2>5. Intellectual Property Rights</h2>

              <h3>5.1 Company Rights</h3>
              <ul>
                <li>The Figurunica brand, logo, website design, software, and content are the intellectual property of the Company.</li>
                <li>AI models and production processes belong to the Company.</li>
              </ul>

              <h3>5.2 Uploaded Content and Permissions</h3>
              <p>
                In this section &quot;Uploaded Content&quot; means any photo, image, logo or file you
                upload during the order process, and &quot;Depicted Person&quot; means any real person
                whose face/likeness appears in it.
              </p>
              <ul>
                <li>You retain copyright of the photos you upload and represent that you are entitled to dispose of the Uploaded Content.</li>
                <li>By uploading, you grant permission for the content to be processed for figurine/object production, stylized preview generation and order fulfilment.</li>
                <li>By sharing figurine images to the gallery, you grant the Company permission to use them for promotional purposes; you can remove your gallery shares at any time.</li>
              </ul>

              <h3>5.3 Protection of Personal Data (KVKK)</h3>
              <ul>
                <li>If the Uploaded Content contains a real person&apos;s face/image, it is personal data under Law No. 6698. By uploading it you accept and undertake that you have obtained, in advance, every legal basis required (including explicit consent where applicable) for processing the Depicted Person&apos;s image for production and order fulfilment.</li>
                <li>If the Uploaded Content shows anyone other than yourself, you undertake that you have obtained — in a demonstrable form — that person&apos;s explicit consent (or, for a child, the consent of their parent/legal guardian) to the processing of their image, its conversion into a figurine, and its transfer to domestic/foreign service providers for that purpose. The Company may ask you to evidence this consent.</li>
                <li>To produce the stylized image, Uploaded Content may be transferred to third-party artificial intelligence providers located abroad. You accept that the obligations under KVKK art. 9 — including informing the Depicted Person and obtaining any required consent — have been fulfilled.</li>
                <li>You accept that the Company does not process Uploaded Content through any special technique for facial recognition or unique identity verification, and that it is therefore not processed as biometric data by the Company as a rule.</li>
                <li>Processing details are set out in the Privacy Notice and Privacy Policy; you may exercise your rights under KVKK art. 11 (including deletion requests). The Company&apos;s statutory retention and evidentiary obligations are reserved.</li>
              </ul>

              <h3>5.4 Personality Rights and Portraits</h3>
              <ul>
                <li>Every person has a legally protected personality right over their own image. Processing, reproducing or converting a person&apos;s image into a figurine without their consent may constitute an unlawful infringement of that right (Turkish Civil Code art. 24-25).</li>
                <li>A person&apos;s picture/portrait may not be displayed or communicated to the public without the explicit consent of the depicted person (or, if deceased, of the relatives/heirs designated by law within ten years of death) (Law No. 5846 art. 86). You undertake that the necessary consent has been obtained.</li>
              </ul>

              <h3>5.5 Celebrities and Public Figures</h3>
              <ul>
                <li>You may not upload photos containing the face, likeness, character or distinctive appearance of celebrities, well-known persons or public figures (artists, athletes, politicians, public officials, etc.).</li>
                <li>Converting such a person&apos;s image into a commercial product without consent infringes their personality right and unjustly exploits the commercial value of their name/image. The Company reserves the right to refuse any order it suspects contains a well-known person unless that person&apos;s written consent is produced.</li>
              </ul>

              <h3>5.6 Children and Minors</h3>
              <ul>
                <li>If the Uploaded Content shows a child under eighteen, you undertake that you have obtained the explicit consent of their parent/legal guardian for the processing of the child&apos;s image and its conversion into a figurine.</li>
                <li>You accept that a child&apos;s image is in no way used in an obscene, sexual, exploitative manner or contrary to the child&apos;s best interests. The Company may refuse orders where guardian consent cannot be confirmed.</li>
              </ul>

              <h3>5.7 Third-Party Copyright and Trademarks</h3>
              <ul>
                <li>You may not upload a photo taken by a professional photographer/studio or a third party that qualifies as a protected work without the rightsholder&apos;s permission. Any resulting copyright infringement is your responsibility.</li>
                <li>You may not upload — or request figurines from — registered trademarks, logos, emblems, film/cartoon/game characters or designs protected by copyright or trademark without the rightsholder&apos;s licence (Law No. 6769; Law No. 5846). Such claims are exclusively your responsibility.</li>
              </ul>

              <h3>5.8 Prohibited Content</h3>
              <p>You may not upload, or request figurines from, any image that:</p>
              <ul>
                <li>Incites hatred or hostility, or degrades, a section of the public on grounds of race, religion, sect, language, gender or ethnic origin, or openly denigrates religious values (Turkish Penal Code art. 216).</li>
                <li>Is obscene/pornographic, in particular any obscene content involving children or depictions of children (TPC art. 226).</li>
                <li>Insults or offends a person&apos;s honour, dignity or reputation (TPC art. 125).</li>
                <li>Insults or reviles the memory of Atatürk (Law No. 5816).</li>
                <li>Constitutes propaganda legitimising, praising or encouraging terrorist organisations or methods of coercion/violence/threat, or contains symbols and emblems of unlawful organisations (Law No. 3713 art. 7).</li>
                <li>Constitutes election propaganda, political party/candidate advertising, or socially/politically polarising, sensitive content.</li>
                <li>Praises or encourages violence, weapons, narcotics or unlawful activity, or contains hate symbols.</li>
                <li>Depicts a person&apos;s private life obtained without consent or unlawfully (TPC art. 134, 136), or violates third parties&apos; privacy rights.</li>
              </ul>

              <h3>5.9 Company&apos;s Right to Refuse and Cancel</h3>
              <ul>
                <li>The Company reserves the right to unilaterally refuse, halt production of, or cancel any order or Uploaded Content it suspects is contrary to this agreement, the law or public order, or that it assesses to carry legal risk.</li>
                <li>In that case, if production has not yet begun the amount paid is refunded; where cancellation is due to unlawful content, the refund may be made after deducting production/labour costs. Your rights under consumer legislation are reserved.</li>
              </ul>

              <h3>5.10 Indemnification</h3>
              <ul>
                <li>If you breach your undertakings here, or the Uploaded Content infringes third parties&apos; personal data, personality, copyright or trademark rights or any legislation, you are exclusively liable for every claim, lawsuit, administrative fine and sanction brought against the Company by third parties or official/administrative authorities (including the KVKK Authority, courts and prosecutors).</li>
                <li>You accept and undertake to indemnify the Company immediately and in cash for all direct damages, compensation and fines it must pay, including attorney fees and litigation costs (Turkish Code of Obligations art. 49, 112). As the Company acts in reliance on your representations, it has a right of recourse against you.</li>
              </ul>

              <h3>5.11 Representations, Warranties and Additional Terms</h3>
              <ul>
                <li>By placing an order you represent and undertake that: (a) you have obtained all required permissions/consents/licences for the Uploaded Content; (b) you have the explicit consent of the Depicted Person(s) and/or their legal representatives; (c) the content infringes no third party&apos;s rights; (d) it contains none of the prohibited content listed above; and (e) the information you provided is accurate.</li>
                <li>Intellectual rights in the stylized 2D image and 3D model produced by the Company belong to the Company; you are granted a personal, non-commercial right of use over the delivered figurine and (if purchased) the digital output.</li>
                <li>You may not use the Uploaded Content or the output for misleading representation (deepfake), fraud, impersonation or defamation. For images of deceased persons, you act with the consent of the relatives designated by law and with respect for the person&apos;s memory.</li>
              </ul>

              <h2>6. Limitation of Liability</h2>

              <h3>6.1 Service Guarantee</h3>
              <ul>
                <li>The quality of AI-generated 3D models depends on the quality of the uploaded photo.</li>
                <li>Minor differences may exist between the preview and the final product (color tones, detail levels, etc.).</li>
                <li>Due to the nature of 3D printing, each product is unique and minor variations are within production tolerances.</li>
              </ul>

              <h3>6.2 Liability Limit</h3>
              <ul>
                <li>The Company is not liable for indirect damages arising from service interruptions, technical failures, or disruptions caused by third-party service providers.</li>
                <li>The Company&apos;s total liability shall not exceed the price of the relevant order.</li>
              </ul>

              <h2>7. Account Usage</h2>
              <ul>
                <li>You may not transfer your account to another person.</li>
                <li>You are responsible for the security of your account credentials.</li>
                <li>Contact us immediately if you notice unauthorized access to your account.</li>
                <li>The Company reserves the right to suspend or close accounts that violate these Terms.</li>
              </ul>

              <h2>8. Force Majeure</h2>
              <p>
                The Company shall not be held responsible for service disruptions or delays caused by events beyond its control,
                including but not limited to natural disasters, pandemics, war, strikes, government decisions, and internet infrastructure issues.
              </p>

              <h2>9. Dispute Resolution</h2>
              <ul>
                <li>These Terms are governed by the laws of the Republic of Turkey.</li>
                <li>Istanbul Courts and Enforcement Offices have jurisdiction for disputes.</li>
                <li>Consumer complaints may be filed with Consumer Arbitration Committees.</li>
              </ul>

              <h2>10. Changes</h2>
              <p>
                The Company reserves the right to modify these Terms at any time. Changes take effect when published
                on our website. Registered users will be notified via email about significant changes.
              </p>

              <h2>11. Contact</h2>
              <p>For questions about these Terms of Service:</p>
              <ul>
                <li>Email: info@figurunica.com</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
