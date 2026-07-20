# Fotoğraf / Görsel Kullanım & Kişilik Hakları Onayı — Sözleşme Taslağı

> **STATÜ: TASLAK — AVUKAT ONAYI GEREKLİDİR.** Aşağıdaki metin, doğrulanmış güncel
> mevzuata (mevzuat.gov.tr) dayanan bir taslaktır; hukuki mütalaa değildir.
> Yürürlüğe koymadan önce bir avukata inceletilmesi zorunludur (bkz. sondaki
> "Avukat incelemesi gereken noktalar"). Hazırlık: 2026-07-20.

Bu belge iki parçadır: **(1)** kodda nereye/nasıl uygulanacağının mimari tasarımı,
**(2)** sözleşmeye (Kullanım Koşulları §5) girecek doğrulanmış Türkçe madde taslakları.

---

## 1) Mimari tasarım (uygulama)

**A. Sözleşme metni** — `src/app/terms/page.tsx` §5 (Fikri Mülkiyet / Kullanıcı İçeriği /
Yasaklar) aşağıdaki maddelerle kapsamlı biçimde genişletilir (TR + EN).

**B. Zorunlu onay kutusu** — tekrar kullanılabilir `ContentConsentCheckbox` bileşeni;
işaretlenmeden sipariş/ödeme butonu pasif. Gösterildiği yerler:
- `/create` (fotoğraftan figür) son adım
- `checkout-form` (upload / STL-OBJ siparişleri)
- `/pay/[reference]` (WhatsApp siparişi ödeme sayfası)

**C. Sunucu tarafı zorunluluk + kayıt** — `/api/orders` (custom + upload) ve
`/api/pay/[reference]` (WhatsApp): onay yoksa 400; onay `content_consent_at` (zaman
damgası) + `content_consent_version` olarak siparişe yazılır (denetim izi).

**D. DB** — `orders` tablosuna `content_consent_at timestamp` + `content_consent_version text`;
geri alınabilir up/down migration (0034), round-trip test edilir.

**Kapsam:** foto/model içeren siparişler (custom + upload + WhatsApp). Saf marketplace
(/shop) alışverişinde müşteri foto yüklemediği için bu onay uygulanmaz.

---

## 2) Sözleşme madde taslakları

**Tanımlar:** **"Şirket"** = Figurunica'yı işleten tüzel kişi; **"Müşteri"** = siparişi
veren/hesabı kullanan kişi; **"Yüklenen İçerik"** = Müşteri'nin sipariş sürecinde
yüklediği her türlü fotoğraf, görsel, logo ve dosya; **"Tasvir Edilen Kişi"** = Yüklenen
İçerik'te yüzü/benzerliği yer alan gerçek kişi.

### 1. Kişisel Verilerin Korunması (KVKK)

**1.1 Fotoğrafın kişisel veri niteliği ve işleme rızası** — Müşteri, Yüklenen İçerik'in
bir gerçek kişiye ait yüz/görüntü içermesi hâlinde bunun 6698 sayılı Kanun anlamında
kişisel veri olduğunu bildiğini; söz konusu veriyi Şirket'e yükleyerek, Tasvir Edilen
Kişi'nin görüntüsünün 3D figür üretimi, ön izleme görseli oluşturulması, sipariş ifası ve
buna bağlı hizmetler amacıyla işlenmesi için gerekli olan her türlü hukuki dayanağı (açık
rıza dâhil) önceden ve usulüne uygun olarak temin ettiğini kabul, beyan ve taahhüt eder.
*(6698 s. KVKK m.3, m.5)*

**1.2 Tasvir Edilen Kişinin açık rızası taahhüdü** — Müşteri, Yüklenen İçerik'te kendisi
dışında bir kişi yer alıyorsa, o kişinin görüntüsünün işlenmesine, figüre
dönüştürülmesine ve bu amaçla yurt içi/yurt dışı hizmet sağlayıcılara aktarılmasına
ilişkin açık rızasını (özgür iradeyle, belirli bir konuya ilişkin ve bilgilendirilmeye
dayalı olarak) yazılı veya ispatlanabilir biçimde aldığını taahhüt eder. Müşteri,
Şirket'in talebi hâlinde bu rızanın varlığını belgelendirmeyi kabul eder. Rızanın
alınmamış olmasından doğan tüm hukuki ve cezai sorumluluk münhasıran Müşteri'ye aittir.
*(KVKK m.3, m.5, m.11)*

**1.3 Yurt dışına aktarım (yabancı yapay zeka sağlayıcısı)** — Müşteri, Yüklenen İçerik'in
stilize görsel üretimi amacıyla yurt dışında yerleşik üçüncü taraf yapay zeka hizmet
sağlayıcılarına aktarılabileceğini bildiğini; bu sınır ötesi aktarım için Tasvir Edilen
Kişi'yi bilgilendirmek ve gerekli açık rızayı almak dâhil KVKK m.9 kapsamındaki
yükümlülüklerin yerine getirildiğini kabul ve taahhüt eder. Şirket, aktarımı öncelikle
yeterlilik kararı veya uygun güvenceler (Kurul onaylı standart sözleşme / bağlayıcı şirket
kuralları) çerçevesinde; bunların bulunmadığı hâllerde ilgili kişinin bilgilendirilmiş
açık rızasına dayalı arızi aktarım rejimi çerçevesinde gerçekleştirir.
*(KVKK m.9 — 7499 s. Kanun ile değişik, yürürlük 01.06.2024; Yurt Dışına Aktarım Yönetmeliği 10.07.2024)*

> ⚠️ 2024 reformuyla yurt dışı aktarımda "açık rıza" artık **birincil/genel** yöntem değil,
> **arızi (istisnai)** bir yöntemdir. Şirket'in asıl güvencesi, AI sağlayıcıyla imzalanacak
> **Kurul onaylı standart sözleşme** olmalıdır (Kurul'a 5 iş günü içinde bildirim). Yalnızca
> "müşteri rıza aldı" demek Şirket'in kendi sorumluluğunu kaldırmaz.

**1.4 Veri sorumlusu / veri işleyen ilişkisi** — Taraflar, Yüklenen İçerik bakımından
Müşteri'nin veri sorumlusu konumunda bulunabileceğini; Şirket'in siparişin ifası
kapsamında Müşteri adına ve talimatı doğrultusunda işlem yapan veri işleyen sıfatını haiz
olabileceğini kabul eder. Şirket, kendi belirlediği amaçlarla (hizmet güvenliği, kötüye
kullanım denetimi vb.) yürüttüğü işleme faaliyetleri bakımından veri sorumlusudur ve bu
faaliyetleri Aydınlatma Metni ve Gizlilik Politikası'nda açıklanmıştır.
*(KVKK m.3, m.10, m.12)*

**1.5 Özel nitelikli / biyometrik veri beyanı** — Müşteri, yüklediği fotoğrafın özel
nitelikli kişisel verileri açığa çıkaracak içerik taşımamasına özen gösterir. Müşteri,
yüklediği fotoğrafın Şirket tarafından yüz tanıma veya benzersiz kimlik doğrulama amaçlı
özel bir teknik yöntemle işlenmeyeceğini; bu nedenle fotoğrafın Şirket nezdinde kural
olarak biyometrik veri olarak işlenmediğini kabul eder. Fotoğrafın özel nitelikli veri
içermesi hâlinde işlenmesine dair açık rızayı almak Müşteri'nin sorumluluğundadır.
*(KVKK m.6 — 7499 s. ile değişik; KVKK Biyometrik Veriler Rehberi)*

### 2. Kişilik Hakları (Görüntü / Portre)

**2.1 Görüntü üzerindeki kişilik hakkı ve rıza** — Müşteri, her kişinin kendi görüntüsü
üzerinde hukuken korunan bir kişilik hakkına sahip olduğunu; Tasvir Edilen Kişi'nin
görüntüsünün rızası dışında işlenmesinin, çoğaltılmasının veya bir ürüne (figüre)
dönüştürülmesinin kişilik hakkına hukuka aykırı bir saldırı teşkil edebileceğini bilir.
Müşteri, siparişe konu görüntünün kullanımı için gerekli rızanın mevcut olduğunu ve bu
kullanımın hiçbir kişinin şeref, onur, özel hayat veya görüntü hakkını ihlal etmediğini
taahhüt eder. *(4721 s. TMK m.24, m.25)*

**2.2 Resim ve portrelerin kullanımı** — Müşteri, bir kişinin resminin/portresinin, tasvir
edilenin (ölmüşse ölümünden itibaren on yıl içinde kanunda sayılan yakınlarının/
mirasçılarının) açık rızası olmadıkça teşhir/umuma arz edilemeyeceğini bilir. Müşteri,
siparişe konu görüntü için bu rızanın alındığını taahhüt eder.
*(5846 s. FSEK m.86 — resim ve portreler; siyasi/içtimai hayatta rol oynayanlar ve güncel olay istisnaları saklıdır)*

### 3. Ünlüler, Kamuya Mal Olmuş Kişiler ve Kamu Görevlileri

**3.1 Tanınmış kişilerin görüntüsü ve benzerliği yasağı** — Müşteri, ünlü, tanınmış veya
kamuya mal olmuş kişilerin (sanatçı, sporcu, siyasetçi, kamu görevlisi vb.) yüzünü,
benzerliğini (likeness), karakterini veya ayırt edici görünümünü içeren fotoğraf
yüklemeyeceğini kabul eder. Böyle bir kişinin görüntüsünün rızası olmaksızın bir ticari
ürüne dönüştürülmesi; kişilik hakkının ihlali ve kişinin isim/görüntüsünün ticari
değerinden haksız yararlanma teşkil eder. Şirket, tanınmış bir kişinin görüntüsünü
içerdiğinden şüphe ettiği siparişleri, ilgili kişinin yazılı muvafakati ibraz edilmedikçe
reddetme hakkını saklı tutar. *(TMK m.24-25 ve FSEK m.86; publicity right Türk hukukunda TMK m.24-25 + m.25/3 üzerinden korunur)*

### 4. Çocuklar ve Reşit Olmayanlar

**4.1 Veli/vasi rızası ve çocuk görselinde ek koruma** — Yüklenen İçerik'te on sekiz
yaşından küçük bir çocuk yer alıyorsa, Müşteri o çocuğun görüntüsünün işlenmesi ve figüre
dönüştürülmesi için velisinin/yasal temsilcisinin açık rızasını aldığını; kendisinin
veli/vasi olması hâlinde bu rızaya bizzat sahip olduğunu taahhüt eder. Müşteri, çocuk
görselinin hiçbir şekilde müstehcen, cinsel içerikli, istismar edici veya çocuğun üstün
yararına aykırı biçimde kullanılmadığını kabul eder. Şirket, veli rızası teyit edilemeyen
çocuk siparişlerini reddedebilir. *(KVKK m.5-6; TMK m.24; TCK m.226/3)*

### 5. Üçüncü Kişi Telif Hakları ve Markalar

**5.1 Fotoğrafçının telif hakkı** — Müşteri, yüklediği fotoğrafın maliki/hak sahibi
olduğunu veya fotoğraf üzerinde 3D figür üretimi ve türev eser oluşturulması dâhil işleme
yetkisine sahip bulunduğunu taahhüt eder. Profesyonel bir fotoğrafçı/stüdyo tarafından
çekilmiş ve eser niteliği taşıyan bir fotoğrafı, hak sahibinin izni olmaksızın
yüklemeyeceğini; aksi hâlde doğacak telif ihlali sorumluluğunun kendisine ait olacağını
kabul eder. *(5846 s. FSEK m.4; mali haklar; izinsiz kullanımda FSEK m.68 tazminat riski — madde no avukatça teyit edilmeli)*

**5.2 Marka, logo ve karakter ihlali yasağı** — Müşteri, tescilli marka, logo, amblem ile
film/çizgi film/oyun karakterlerini (Disney, Marvel vb.) ya da telif/marka korumasına tabi
figür ve tasarımları, hak sahibinin lisansı olmaksızın yüklemeyeceğini ve bunlardan figür
üretilmesini talep etmeyeceğini taahhüt eder. Bu tür taleplerden doğacak ihlal iddiaları
münhasıran Müşteri'nin sorumluluğundadır. *(6769 s. Sınai Mülkiyet Kanunu; 5846 s. FSEK)*

### 6. Yasak İçerik

**6.1** — Müşteri, aşağıdaki nitelikleri taşıyan hiçbir görseli yüklemeyeceğini ve
bunlardan figür üretilmesini talep etmeyeceğini kabul ve taahhüt eder:

- **(a)** Halkı ırk, din, mezhep, dil, cinsiyet, etnik köken temelinde kin ve düşmanlığa
  tahrik eden, aşağılayan ya da dini değerleri alenen aşağılayan içerikler. *(TCK m.216)*
- **(b)** Müstehcen/pornografik içerikler; özellikle çocukların kullanıldığı veya çocuk
  gibi görünen/temsilî çocuk görüntülerini içeren her türlü müstehcen içerik. *(TCK m.226; çocuk için m.226/3)*
- **(c)** Bir kişinin onur, şeref ve saygınlığını rencide edici, hakaret niteliğinde
  içerikler. *(TCK m.125)*
- **(d)** Atatürk'ün hatırasına hakaret/sövme niteliği taşıyan içerikler. *(5816 s. Kanun m.1)*
- **(e)** Terör örgütlerini, cebir/şiddet/tehdit yöntemlerini meşru gösteren, öven ya da
  teşvik eden propaganda içerikleri; yasa dışı örgüt sembol/amblemleri. *(3713 s. TMK m.7/2)*
- **(f)** Seçim propagandası, siyasi parti/aday reklamı ve toplumsal-siyasal açıdan hassas,
  kutuplaştırıcı içerikler.
- **(g)** Şiddeti, silahı, uyuşturucuyu, yasa dışı faaliyetleri öven/özendiren; nefret
  sembolleri veya yasaklanmış işaretler içeren görseller.
- **(h)** Bir kişinin özel hayatına ilişkin, rıza dışı elde edilmiş görüntüler ve hukuka
  aykırı ele geçirilmiş içerikler. *(TCK m.134, m.136)*

### 7. Şirketin Siparişi Reddetme, İptal ve İade Hakkı

**7.1 Tek taraflı ret ve iptal yetkisi** — Şirket, sözleşmeye/mevzuata/kamu düzenine aykırı
olduğundan şüphe ettiği ya da hukuki risk taşıdığını değerlendirdiği herhangi bir siparişi;
yasak içeriklerden birini taşıdığından şüphelendiği Yüklenen İçerik'i, gerekçe
göstermeksizin, tek taraflı olarak ve tazminat yükümlülüğü doğmaksızın reddetme, üretimi
durdurma veya iptal etme hakkını saklı tutar. Üretime henüz başlanmamışsa ödenen bedel iade
edilir; hukuka aykırı içerik nedeniyle iptalde iade, üretim/emek masrafları düşülerek
yapılabilir. *(TBK m.26-27; TKHK m.5 haksız şart sınırı saklıdır)*

### 8. Tazminat ve Şirketi Beri Kılma (Indemnification)

**8.1 Müşterinin tazmin yükümlülüğü** — Müşteri, beyan ve taahhütlerine aykırı davranması
veya Yüklenen İçerik'in üçüncü kişilerin kişisel verilerine, kişilik/telif/marka haklarına
ya da mevzuata aykırılık teşkil etmesi nedeniyle; Şirket aleyhine üçüncü kişiler,
tüketiciler veya resmî/idari makamlar (KVKK Kurumu, mahkemeler, savcılıklar dâhil)
tarafından ileri sürülecek her türlü talep, dava, şikâyet, idari para cezası ve
yaptırımdan münhasıran kendisinin sorumlu olacağını; Şirket'in bu nedenle uğrayacağı tüm
doğrudan zararları, tazminat ve para cezalarını, avukatlık ücretleri ve yargılama giderleri
dâhil derhâl ve nakden tazmin edeceğini (Şirket'i beri kılacağını) kabul ve taahhüt eder.
*(6098 s. TBK m.49, m.50-51, m.112; KVKK m.18)*

**8.2 Sorumluluğun sınırlandırılması ve rücu** — Şirket, Yüklenen İçerik'in hukuka
uygunluğunu araştırma yükümlülüğü bulunmaksızın Müşteri'nin beyanlarına güvenerek hareket
eder. Hukuka aykırılıktan doğan tüm sonuçlardan Müşteri sorumludur ve Şirket bir bedel
ödemek zorunda kalırsa Müşteri'ye rücu eder.
*(TBK m.49, m.61; sınır: TBK m.115 — Şirket kendi ağır kusurundan doğan sorumluluğunu önceden kaldıramaz; bu kayıt yalnızca Müşteri kaynaklı ihlalleri kapsar)*

### 9. Fotoğrafın Saklanması, İşlenme Amacı ve Silinmesi

**9.1** — Şirket, Yüklenen İçerik'i yalnızca siparişin ifası, görsel üretimi, kalite
denetimi, yasal saklama yükümlülükleri ve olası uyuşmazlıklarda ispat amacıyla işler ve
ilgili mevzuatın öngördüğü süreler boyunca saklar. Sürelerin sonunda veya amacın ortadan
kalkması hâlinde silinir, yok edilir veya anonim hâle getirilir. Müşteri KVKK m.11
haklarını kullanabilir; Şirket'in kanuni saklama ve ispat yükümlülükleri saklıdır.
*(KVKK m.4, m.7, m.11, m.12)*

### 10. Beyan ve Tekeffül (Toplu Madde)

**10.1** — Müşteri, sipariş vererek: **(a)** Yüklenen İçerik üzerinde tasarruf yetkisine
sahip olduğunu ve gerekli tüm izin/rıza/lisansları edindiğini; **(b)** Tasvir Edilen
Kişi(ler)in ve/veya yasal temsilcilerinin açık rızasını aldığını; **(c)** Yüklenen
İçerik'in hiçbir üçüncü kişinin kişisel verilerini, kişilik/telif/marka haklarını ihlal
etmediğini; **(d)** §6'daki yasak içeriklerden hiçbirini taşımadığını; **(e)** verdiği
bilgilerin doğru/güncel/eksiksiz olduğunu; **(f)** aykırılıktan doğacak tüm sorumluluğun
kendisine ait olduğunu beyan ve taahhüt eder. Beyanların gerçeğe aykırı çıkması, Şirket'e
iptal ve §8 kapsamında tazminat hakkı verir. *(TBK m.49, m.112; KVKK m.5, m.9; TMK m.24-25; FSEK m.86)*

### 11. Ek Maddeler

**11.1 Yapay zeka çıktısının lisansı** — Şirket'in ürettiği stilize 2D görsel ve 3D model
üzerindeki fikri haklar Şirket'e aittir. Şirket, teslim edilen fiziki figür ve (satın
alındıysa) dijital çıktı üzerinde Müşteri'ye kişisel, gayri ticari kullanım hakkı tanır;
Müşteri yazılı izin olmaksızın ticari çoğaltamaz/satamaz/dağıtamaz. *(FSEK m.20-25, m.48-52)*

**11.2 Deepfake ve yanıltıcı temsil yasağı** — Müşteri, Yüklenen İçerik'i ve çıktıyı;
yanıltıcı temsil (deepfake), dolandırıcılık, kimlik taklidi veya iftira amaçlı
kullanmayacağını taahhüt eder. *(TCK m.125, m.136; TMK m.24; TBK m.49)*

**11.3 Vefat etmiş kişilerin görüntüsü** — Yüklenen İçerik vefat etmiş bir kişiye ait ise,
Müşteri kanunda sayılan yakınlarının/mirasçılarının rızasıyla ve kişinin hatırasına saygı
göstererek hareket ettiğini taahhüt eder; hatırasına hakaret/aşağılama teşkil eden
kullanımlar yasaktır. *(FSEK m.86; TCK m.130 — madde no avukatça teyit edilmeli)*

**11.4 Kişi odaklı hizmet kapsamı** — Hizmet gerçek kişilerin figüre dönüştürülmesine
yöneliktir. Müşteri, üçüncü kişilere ait özel mülk/mekân veya tanınabilir özel eser
görüntüleri yüklemesi hâlinde de gerekli izinlere sahip olduğunu kabul eder. *(TMK m.24; FSEK m.86)*

**11.5 Mevzuata genel uyum** — Müşteri yürürlükteki tüm T.C. mevzuatına uyacağını; Şirket'in
bu koşulları mevzuat değişikliklerine uyum amacıyla güncelleyebileceğini kabul eder.

---

## 3) Onay kutusu metni

**Öneri: iki ayrı kutu** (KVKK açısından aydınlatma + açık rızanın ayrı alınması daha güvenli):

**Kutu 1 — Kullanım Koşulları + fotoğraf taahhütleri:**
> ☐ Yüklediğim fotoğrafı kullanma hakkına sahip olduğumu; fotoğraftaki kişi(ler)in
> (çocuksa velisinin) açık rızasını aldığımı; fotoğrafın ünlü/üçüncü kişi, telifli/markalı,
> müstehcen, nefret söylemi veya yasa dışı içerik taşımadığını, aksi hâlde tüm hukuki
> sorumluluğun bana ait olduğunu ve **Kullanım Koşulları'nı** okuyup kabul ettiğimi beyan ederim.

**Kutu 2 — KVKK aydınlatma + açık rıza (yurt dışı aktarım):**
> ☐ Fotoğrafımın stilize görsel üretimi için yurt dışındaki yapay zeka sağlayıcılarına
> aktarılabileceğini; **KVKK Aydınlatma Metni'ni** okuduğumu ve bu işleme/aktarıma **açık
> rıza** verdiğimi beyan ederim.

---

## 4) Avukat incelemesi gereken noktalar (öncelik sırasıyla)

1. **Yurt dışı aktarımın hukuki temeli (YÜKSEK):** 2024 reformuyla açık rıza *arızi* bir
   yöntem. Asıl güvence, AI sağlayıcıyla **Kurul onaylı standart sözleşme** (+ Kurul'a 5 iş
   günü içinde bildirim). "Müşteri rıza aldı" tek başına Şirket'i korumaz.
2. **Veri sorumlusu/işleyen ayrımı (§1.4):** Şirket muhtemelen çoğu işlemede veri
   sorumlusudur; "müşteri sorumlu, Şirket işleyen" kurgusu her senaryoya uymayabilir.
3. **Sorumsuzluk/iade kayıtları (§7, §8.2):** TBK m.115 (ağır kusur) ve TKHK m.5 (haksız
   şart) sınırları; "gerekçesiz ret + iade etmeme" tüketici lehine dengelenmeli.
4. **Cayma hakkı:** Kişiye özel üretim → Mesafeli Sözleşmeler Yönetmeliği m.15/1-ç istisnası;
   mesafeli satış sözleşmesinde açıkça belirtilmeli.
5. **Madde no teyidi:** FSEK m.68 ve TCK m.130 birebir mevzuat.gov.tr'den doğrulanmalı
   (araştırmada işaretlendi, birebir teyit edilmedi).
6. **Publicity right (§3):** Türk hukukunda müstakil yasa yok; koruma TMK m.24-25 + FSEK
   m.86. Ret politikası operasyonel olarak da uygulanabilir olmalı.
7. **Aydınlatma vs açık rıza:** KVKK'da ayrı belgeler/ayrı onaylar olmalı; tek kutuya
   sıkıştırılırsa rıza geçersiz sayılabilir → yukarıdaki iki-kutu önerisi.
8. **Çocuk verisi (§4):** Yaş doğrulama olmadan salt taahhüt zayıf; şüpheli içerikte manuel
   inceleme önerilir.

## 5) Kaynaklar

- KVKK 6698 + 2024 (7499) değişiklikleri, yurt dışı aktarım: mevzuat.gov.tr/6698; kvkk.gov.tr
- Biyometrik veri rehberi (KVKK)
- TMK m.24-25; FSEK m.86; TCK m.125/134/136/216/226; 5816 s. m.1; 3713 s. m.7; TBK m.49/112/115
- Mesafeli Sözleşmeler Yönetmeliği m.15
