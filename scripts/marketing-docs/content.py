# -*- coding: utf-8 -*-
"""
Figurunica — pazarlama tanıtım dokümanlarının içeriği.

Buradaki her rakam, oran ve vaat 2026-07-13 tarihinde canlı kod tabanına karşı
doğrulanmıştır (9 alan / 311 bulgu). Fiyat veya politika değişirse ÖNCE burayı
güncelleyin, sonra `python3 scripts/marketing-docs/build.py` ile dokümanları
yeniden üretin.

Blok tipleri: h1, h2, lead, p, note, ul, ol, table, kv, callout, quote, qa, pb
Satır içi **kalın** desteklenir.
"""

BRAND = {
    "name": "Figurunica",
    "tagline": "Fotoğrafın, figürün.",
    "site": "figurunica.com",
    "email": "info@figurunica.com",
    "phone": "+90 850 840 73 03",
    "address": "Şehit Osman Avcı Mah., Akın 688 Sitesi B32, Etimesgut / Ankara",
    "version": "v1.0",
    "date": "13 Temmuz 2026",
}

# Her dokümanın sonuna giren ortak iletişim bloğu.
CONTACT = [
    {"t": "h1", "x": "İletişim"},
    {"t": "kv", "x": [
        ["Web", "figurunica.com"],
        ["E-posta", "info@figurunica.com"],
        ["Telefon / WhatsApp", "+90 850 840 73 03"],
        ["Stüdyo", "Şehit Osman Avcı Mah., Akın 688 Sitesi B32, Etimesgut / Ankara"],
        ["Sipariş takibi", "figurunica.com/track/<sipariş-numarası> — üyelik gerekmez"],
    ]},
    {"t": "note", "x": "Bu doküman canlı koddan doğrulanmış bilgilerle üretilmiştir "
                       "(sürüm v1.0 · 13 Temmuz 2026). Fiyat veya politika değiştiğinde "
                       "pazarlama ekibi güncel sürümü talep etmelidir."},
]


# ═══════════════════════════════════════════════════════════════════════════
# DOKÜMAN 1 — SON MÜŞTERİ (B2C) SATIŞ KİTİ
# ═══════════════════════════════════════════════════════════════════════════

DOC1 = {
    "num": "01",
    "slug": "01-son-musteri-satis-kiti",
    "title": "Son Müşteri Satış Kiti",
    "subtitle": "Fotoğraftan kişiye özel 3D figür, hazır ürün mağazası ve "
                "kendi 3D dosyanı bastırma — ürün, fiyat, süreç ve itiraz karşılama.",
    "audience": "Hedef kitle: bireysel müşteri · hediye alıcısı · mağaza müşterisi · maker",
    "blocks": [
        {"t": "h1", "x": "Bir bakışta Figurunica"},
        {"t": "lead", "x": "Figurunica, fotoğrafından kişiye özel 3D baskı figür üreten bir "
                           "üretim stüdyosu ve aynı zamanda onaylı üreticilerin hazır ürünlerini "
                           "sattığı bir 3D pazaryeridir. Müşteri fotoğrafını yükler, yapay zekâ iki "
                           "stilize tasarım seçeneği üretir, müşteri beğendiğini seçer; ekip o "
                           "tasarımdan 3D modeli hazırlar, partner atölye basar, ürün fotoğraflı "
                           "kalite kontrolünden geçer ve boyama kitiyle birlikte kargolanır."},
        {"t": "kv", "x": [
            ["Ne satıyoruz", "Kişiye özel figür · 2D tasarım/logodan ürün · kendi STL/OBJ dosyanı bastırma · "
                             "hazır ürün mağazası · anahtarlık/magnet/gece lambası"],
            ["Başlangıç fiyatı", "Filament ₺899 · Reçine ₺999 (KDV dahil)"],
            ["Kargo", "Türkiye içi ücretsiz — sipariş toplamına kargo bedeli eklenmez"],
            ["Üyelik", "Sipariş için gerekmez (misafir checkout). Sadece ücretsiz AI tasarım üretimi giriş ister"],
            ["Teslim", "Onaydan sonra 5–7 iş günü üretim + 2–3 iş günü kargo (tahmini, garanti değil)"],
            ["Ödeme", "Kart (PayTR 3D Secure) veya Havale/EFT — havalede %3 indirim"],
            ["Takip", "figurunica.com/track/<sipariş-no> — üyeliksiz, canlı güncellenen 8 adımlı takip"],
            ["Güvence", "Baskı, müşteri tasarımı onaylamadan başlamaz + kargodan önce fotoğraflı kalite kontrol"],
        ]},

        {"t": "h1", "x": "30 saniyelik konuşma"},
        {"t": "p", "x": "Bu metni ezberleyin. Her rakamı doğrulanmıştır; üzerine bir şey eklemeyin."},
        {"t": "quote", "x": "“Bir fotoğraf yükleyin — yapay zekâ size iki farklı stilize tasarım "
                            "seçeneği çıkarsın, beğendiğinizi siz seçin. Siz onaylamadan hiçbir şey "
                            "basılmaz. Onayınızdan sonra ekibimiz 3D modeli hazırlar, partner "
                            "atölyelerimiz reçine ya da filamentle basar, ürün fotoğraflı kalite "
                            "kontrolünden geçer ve boya kitiyle birlikte kapınıza gelir. Fiyatlar "
                            "filamentte ₺899, reçinede ₺999’dan başlar; KDV dahil, Türkiye içi kargo "
                            "ücretsiz ve üye olmanıza bile gerek yok. Siparişinizi numaranızla, üye "
                            "olmadan, canlı takip edersiniz.”"},

        {"t": "h1", "x": "Ürünler ve fiyatlar"},
        {"t": "note", "x": "Tüm fiyatlar KDV dahildir ve ödemeden önce müşteriye net gösterilir. "
                           "Sürpriz ek ücret yoktur. Türkiye içi kargo ücretsizdir."},

        {"t": "h2", "x": "Fotoğraftan kişiye özel figür"},
        {"t": "table",
         "head": ["Boyut", "Yaklaşık ölçü", "Reçine (SLA)", "Filament (FDM)"],
         "w": [3.6, 3.6, 4.4, 4.4],
         "rows": [
             ["Küçük", "~60 mm", "₺999", "₺899"],
             ["Orta (varsayılan)", "~80 mm", "₺1.399", "₺1.199"],
             ["Büyük", "~120 mm", "₺1.799", "₺1.499"],
         ]},
        {"t": "p", "x": "**Reçine (SLA):** yüksek detay, pürüzsüz premium yüzey. "
                        "**Filament (FDM):** ekonomik alternatif. Seçim müşterinin."},

        {"t": "h2", "x": "Bitiş paketleri (figür fiyatının üzerine)"},
        {"t": "table",
         "head": ["Paket", "İçerik", "Fiyat farkı"],
         "w": [3.8, 8.4, 3.8],
         "rows": [
             ["Boyanabilir Kit\n(varsayılan)",
              "Zımparalı + astarlı baskı, 6 akrilik boya, 2 fırça (orta yuvarlak + ince detay), "
              "karıştırma paleti, adım adım boyama rehberi", "Fiyata dahil (+₺0)"],
             ["Collector Raw", "Boyasız, yüksek detaylı reçine. Boya kiti yok.", "−₺100 (indirim)"],
             ["El Boyaması", "Profesyonel el boyama, kalite kontrol fotoğrafı, hediye kutusu", "+₺1.000"],
             ["Lüks Vitrin", "Premium kaide, isim plakası, sert kutu, tam el boyaması", "+₺2.000"],
         ]},

        {"t": "h2", "x": "2D tasarım / obje → ürün (logo, çizim, düz görsel, nesne fotoğrafı)"},
        {"t": "table",
         "head": ["Boyut", "Reçine", "Filament"],
         "w": [5.3, 5.3, 5.4],
         "rows": [["Küçük", "₺799", "₺549"], ["Orta", "₺1.099", "₺849"], ["Büyük", "₺1.499", "₺1.199"]]},
        {"t": "p", "x": "Obje bitişleri: **Ham baskı** +₺0 · **Pürüzsüz** (zımpara + astar) +₺150 · "
                        "**Boyalı** (tek renk, temel boyama) +₺400."},

        {"t": "h2", "x": "Creative Lab hediyelikler (figurunica.com/urunler)"},
        {"t": "table",
         "head": ["Ürün", "Fiyat"],
         "w": [10.6, 5.4],
         "rows": [["Anahtarlık", "₺149"], ["Buzdolabı magneti", "₺129"], ["Gece lambası", "₺399"]]},
        {"t": "note", "x": "Sabit fiyatlıdır; boyut/malzeme/bitiş seçimi yoktur. Fotoğraftan üretilir ve "
                           "sitede normal ödemeyle satın alınır. Bu ürünler /create tasarım ızgarasında "
                           "görünmez, yalnızca /urunler sayfasından satılır."},

        {"t": "h2", "x": "Kendi 3D dosyanı bastır (STL / OBJ)"},
        {"t": "ul", "x": [
            "**Dosya:** STL veya OBJ, en fazla 50 MB. **Yükseklik:** 40 / 60 / 80 / 120 / 160 mm. "
            "**Malzeme:** reçine veya filament.",
            "**Fiyat formülü açıktır:** Reçine ₺99 baz + ₺15/cm³ (en az ₺199) · "
            "Filament ₺69 baz + ₺9/cm³ (en az ₺149). Üzerine bitiş: Ham +₺0 · Pürüzsüz +₺150 · Boyalı +₺400.",
            "**Baskı zarfı 220 × 220 × 250 mm.** Zarfı aşan, kapalı hacim oluşturmayan veya otomatik "
            "fiyatı ₺50.000’i geçen modeller reddedilmez — ekip elle özel teklif hazırlar (teklif 7 gün geçerli).",
            "Bu yolda AI yoktur, üyelik gerekmez. Sipariş “Modeliniz Hazırlanıyor” adımını atlar, "
            "doğrudan üretime girer.",
        ]},

        {"t": "h2", "x": "Ek hizmetler (ödeme adımında seçilir)"},
        {"t": "table",
         "head": ["Ek hizmet", "Fiyat"],
         "w": [10.6, 5.4],
         "rows": [
             ["Ekstra boya katmanı", "₺49"],
             ["Hediye paketi (kraft kutu + kurdele)", "₺29"],
             ["Hızlı kargo (üretim sonrası 1–2 iş günü)", "₺79"],
             ["Dijital dosyalar (STL + OBJ indirme)", "₺99"],
         ]},

        {"t": "h2", "x": "Hazır ürün mağazası (figurunica.com/shop)"},
        {"t": "ul", "x": [
            "Yalnızca **admin onayından geçmiş** ürünler satılır; her ürün **siparişe özel üretilir** — stok kavramı yoktur.",
            "Filtreler: kategori, ürün adında arama, malzeme (reçine/filament), fiyat aralığı, sıralama. "
            "Sayfa başına 24 ürün.",
            "Ürün sayfasında: fotoğraf galerisi, açıklama, malzeme, **teslim süresi**, satıcı firma adı, "
            "kutu içeriği, puan/yorum ve en fazla 6 benzer ürün.",
            "**Sahte yorum imkânsız:** yorumu yalnızca o ürünü satın alıp **teslim almış** kayıtlı müşteri, "
            "ürün başına bir kez yazabilir.",
            "Farklı satıcıların ürünleri tek sepette, tek ödemeyle alınır; sipariş arka planda satıcı bazında bölünür. "
            "Sepet 30 gün saklanır (misafirde bile), satır başına en fazla 20 adet.",
            "Fiyatı satıcı belirler (KDV dahil). Sepet sayfasında “WhatsApp’tan Sipariş Ver” butonu vardır.",
        ]},

        {"t": "pb"},
        {"t": "h1", "x": "Müşteri yolculuğu — 12 adım"},
        {"t": "table",
         "head": ["Adım", "Ne oluyor", "Müşteriye verilen söz"],
         "w": [3.4, 6.8, 5.8],
         "rows": [
             ["1. Yol seç", "Üç giriş yolu: fotoğraftan üret · 2D tasarım → ürün · kendi 3D dosyam (STL/OBJ).",
              "Ne elinizde varsa ondan başlayın."],
             ["2. Boyut & fotoğraf", "Boyut, malzeme ve 7 tasarım deseninden biri seçilir; JPG/PNG (en fazla 10 MB) "
              "yüklenir, tarayıcı içi kırpma editörü açılır. Arka plan kendi sunucumuzda temizlenir.",
              "Tek net fotoğraf yeter."],
             ["3. Önizleme", "AI tam **2** stilize 2D görsel üretir (genellikle bir dakikadan kısa). Beğenilmezse "
              "“yeni seçenekler üret” — toplam **4 tura** kadar.",
              "Sipariş vermeden önce nasıl görüneceğini görün."],
             ["4. Onay", "Müşteri görseli onaylar ya da 1.000 karaktere kadar not bırakıp revizyon ister; "
              "ekip inceleyip e-postayla döner.", "Siz onaylamadan baskı başlamaz."],
             ["5. Ödeme", "Misafir olarak ad-soyad + e-posta ile ödeme. Bitiş paketi, ek hizmetler ve hediye kartı "
              "kodu burada girilir. Kart (PayTR 3D Secure) veya Havale/EFT (%3 indirim, 72 saat).",
              "Fiyat ödemeden önce net gösterilir; sürpriz ek ücret yok."],
             ["6. Model hazırlığı", "Sipariş “Modeliniz Hazırlanıyor” durumuna geçer; ekip onaylı tasarımdan 3D "
              "modeli hazırlayıp yükler. Kendi dosyasını yükleyenler bu adımı atlar.",
              "3D modeliniz makineye bırakılmaz — ekibimiz hazırlar."],
             ["7. Baskı", "Sipariş; malzemesine uyan, kapasitesi olan ve mümkün olduğunca müşteriye yakın partner "
              "atölyeye yönlendirilir. Atölye kabul eder ve basar.",
              "Siparişiniz, o işi gerçekten yapabilecek atölyeye gider."],
             ["8. Kalite kontrol", "Üretici en az 1 ürün fotoğrafı yükleyip kalite kontrole gönderir. Figurunica "
              "onaylamadan kargoya verilemez; reddedilirse düzeltilip yeniden gönderilir.",
              "Figürünüz kargodan önce fotoğraflı kontrolden geçer."],
             ["9. El boyama (varsa)", "El Boyaması seçilen siparişlerde figür, kalite kontrolden sonra boyacı "
              "partnere devredilir; boyanır, **ikinci** bir kalite kontrolden geçer.",
              "El boyama, ikinci kontrolden geçmeden yola çıkmaz."],
             ["10. Kargo", "Yurtiçi, Aras, MNG, PTT ve Sürat desteklenir; müşteriye tıklanabilir takip bağlantısı "
              "gösterilir, e-posta ve site içi bildirim gider.",
              "Türkiye içi kargo ücretsiz; takip numaranız elinizde."],
             ["11. Takip & teslim", "/track/<sipariş-no> üyeliksiz açılır ve durum değiştiği anda kendiliğinden "
              "güncellenir (8 adımlı çizelge).", "Sipariş numaranızla, üye olmadan, canlı takip."],
             ["12. Sorun olursa", "Kargolanmış/teslim edilmiş siparişte “Sorun bildir”: benzemedi / hasarlı geldi / "
              "hiç ulaşmadı / diğer. Hasar, teslimattan sonraki **48 saat** içinde fotoğrafla bildirilir.",
              "Kalite sorununda ücretsiz yeniden üretim, değişim veya bedel iadesi."],
         ]},

        {"t": "pb"},
        {"t": "h1", "x": "Neden Figurunica — satışta kullanılacak 8 argüman"},
        {"t": "ul", "x": [
            "**Baskıdan önce tasarımı müşteri onaylar.** AI iki seçenek üretir, müşteri seçer; 4 tura kadar yeni "
            "seçenek isteyebilir veya not bırakıp revizyon talep edebilir. Onaylamadan üretim başlamaz — "
            "“ne geleceğini bilmeden ödeme” riski yoktur.",
            "**Zorunlu, fotoğraflı kalite kontrol.** Üretici baskıyı bitirince ürünün fotoğraflarını yüklemek "
            "zorundadır; Figurunica onaylamadan kargolama açılmaz. El boyamada ikinci bir tur daha vardır.",
            "**Dağıtık üretim ağı + akıllı yönlendirme.** Sipariş; o malzemeyi basabilen, kapasitesi uygun ve "
            "mümkün olduğunca müşteriye yakın atölyeye gider. Atölye reddederse iş otomatik olarak sıradaki "
            "uygun atölyeye geçer.",
            "**Türkiye içi kargo gerçekten ücretsiz.** Sipariş toplamına kargo bedeli eklenmez. “Hızlı kargo” "
            "(₺79) yalnızca süreyi kısaltan opsiyonel bir ektir.",
            "**Üyelik zorunlu değil, takip herkese açık.** Misafir olarak sipariş verilip ödenebilir; takip "
            "sayfası giriş istemez ve durum değiştikçe canlı güncellenir.",
            "**Fiyat şeffaflığı.** Tüm fiyatlar KDV dahildir ve ödemeden önce net gösterilir. Yüklenen 3D "
            "dosyalarda fiyat formülü bile açıktır (baz + cm³ başına birim fiyat).",
            "**Havale/EFT ile %3 indirim + otomatik dekont okuma.** Dekont yüklenir, sistem okur; tutar ±1 TL "
            "toleransla eşleşir ve çoğu dekont insan beklemeden saniyeler içinde onaylanır.",
            "**Ödeme güvenliği.** Kart bilgileri Figurunica sunucularına hiç girmez; ödeme PayTR’ın güvenli "
            "sayfasında yapılır ve ödeme bildirimi imzayla doğrulanır — sahte “ödeme başarılı” bildirimiyle "
            "sipariş açtırılamaz.",
        ]},

        {"t": "h1", "x": "İtiraz karşılama"},
        {"t": "qa", "x": [
            ["Bana benzemezse ne olacak?",
             "Baskı, siz tasarımı onaylamadan başlamaz. AI iki seçenek üretir; beğenmezseniz 4 tura kadar yeni "
             "seçenekler isteyebilirsiniz. Yine olmadıysa 1.000 karaktere kadar not bırakıp revizyon talebi "
             "gönderirsiniz, ekip inceleyip e-postayla döner."],
            ["Kargo ücreti var mı?",
             "Türkiye içi kargo tamamen ücretsiz; sipariş toplamına kargo bedeli eklenmez. Şu an yalnızca "
             "Türkiye içine gönderim yapıyoruz."],
            ["Hangi fotoğraf işe yarar?",
             "Net, iyi aydınlatılmış, yüzün göründüğü, sade arka planlı önden bir kare idealdir. JPG veya PNG, "
             "en fazla 10 MB. Gerçekçi ve 3D Obje desenlerinde ana fotoğrafın yanına 3 referans fotoğraf daha "
             "eklenebilir."],
            ["Üye olmam gerekiyor mu?",
             "Sipariş için hayır — misafir olarak ad-soyad ve e-posta ile sipariş verebilirsiniz; sonrasında "
             "e-postanıza hesap aktivasyon bağlantısı gelir. Yalnızca ücretsiz AI tasarım üretimi giriş ve "
             "e-posta doğrulaması ister."],
            ["İade edebilir miyim?",
             "Kişiye özel figürinler kişiselleştirilmiş ürün olduğu için 14 günlük cayma hakkı kapsamı dışındadır; "
             "fikir değişikliğiyle iade alınmaz. Hazır/standart mağaza ürünlerinde 14 gün cayma hakkı vardır. "
             "Hasar veya ayıp durumunda her iki üründe de ücretsiz yeniden üretim, değişim veya bedel iadesi "
             "yapılır; onaylanan iadeler 5–10 iş günü içinde ödeme yöntemine yansır."],
            ["Boyamayı beceremem, zor mu?",
             "Figür astarlanmış gelir, boya kolay tutunur ve kutuda adım adım rehber vardır. İstemezseniz "
             "El Boyaması (+₺1.000) veya Lüks Vitrin (+₺2.000) paketiyle profesyonel boyanmış olarak alırsınız."],
            ["Mağazadaki ürün stokta var mı?",
             "Stok kavramı yoktur — her ürün sipariş üzerine üretilir. Ürün sayfasındaki teslim süresi satıcının "
             "taahhüdüdür."],
            ["Mağazadaki satıcı güvenilir mi?",
             "Satıcılar kimlik/vergi kontrolünden geçmiş, hesabı aktif üreticilerdir; her ürün admin onayından "
             "geçer ve yayındaki ürün düzenlenirse yeniden incelemeye düşer. Askıya alınmış satıcının ürünleri "
             "satın alınamaz."],
            ["Kendi dosyamı yüklersem fiyatı hemen görebilir miyim?",
             "Uygun geometrideki modellerde fiyat hacimden otomatik hesaplanır. Ancak her yükleme için anında "
             "fiyat garanti edilemez: model kapalı hacim değilse, 220×220×250 mm baskı zarfına sığmıyorsa veya "
             "geometri ölçülemezse talep özel teklife düşer ve ekip fiyatı e-postayla iletir."],
            ["Yüklediğim dosya başkasına gider mi?",
             "Hayır. Baskı dosyalarını yalnızca siparişi atanan üretici, yetki kontrolünden geçen bir indirme "
             "ucundan çekebilir; mağaza ziyaretçilerine veya diğer müşterilere hiçbir zaman gösterilmez."],
            ["Çok büyük bir parça bastırmak istiyorum.",
             "220×220×250 mm zarfını aşan işler otomatik fiyatlanmaz ama reddedilmez; ekibimiz elle teklif hazırlar."],
            ["50 adet aynı üründen alabilir miyim?",
             "Sepette satır başına en fazla 20 adet alınabiliyor. Daha büyük hacimli talepler için WhatsApp veya "
             "e-posta üzerinden ekiple ilerlenmesi gerekir."],
        ]},

        {"t": "pb"},
        {"t": "h1", "x": "Sık sorulan sorular (sitedeki resmî cevaplar)"},
        {"t": "qa", "x": [
            ["Figürinim ne kadar sürede elime ulaşır?",
             "Önizleme onayından sonra üretim genellikle 5–7 iş günü, Türkiye içi kargo 2–3 iş günü — toplam "
             "yaklaşık 7–10 iş günü. Bu süreler tahminidir, garanti edilmez."],
            ["Figürinler ne kadar büyük?",
             "Üç boyut: Küçük (~60 mm), Orta (~80 mm) ve Büyük (~120 mm). Orta boy en popüler tercihimizdir."],
            ["Figürinler hangi malzemeden yapılıyor?",
             "Reçine (profesyonel SLA baskı, yüksek kaliteli fotopolimer — dayanıklı, detaylı, pürüzsüz) veya "
             "filament (ekonomik FDM baskı). Seçim müşterinin."],
            ["Baskıdan önce nasıl göreceğimi görebilir miyim?",
             "Evet. Yapay zekâ fotoğrafınızdan iki stilize tasarım görseli üretir, siz birini seçersiniz. "
             "Beğenmezseniz 4 tura kadar yeni seçenekler üretebilir veya revizyon talebi gönderebilirsiniz. "
             "Siz onaylamadan baskı başlamaz. (Satın alma öncesi gösterilen bu görsel 2 boyutludur; 3D modeli "
             "sipariş sonrası ekibimiz hazırlar.)"],
            ["Nasıl ödeyebilirim?",
             "Kredi/banka kartı (PayTR 3D Secure — kart bilgileriniz bize hiç girmez) veya Havale/EFT. Havale ile "
             "%3 indirim uygulanır, ödeme için 72 saatiniz vardır ve 24. saatte hatırlatma e-postası gider. "
             "Hediye kartı bakiyesi siparişi tamamen karşılarsa ödeme adımı atlanır."],
            ["Siparişimi nasıl takip ederim?",
             "figurunica.com/track/<sipariş-numaranız> adresinden — üye olmanıza gerek yok. Sayfa, sipariş durumu "
             "değiştiği anda kendiliğinden güncellenir."],
            ["STL/OBJ dosyalarımı alabilir miyim?",
             "Evet — ödeme adımında “Dijital dosyalar” ek hizmetini (₺99) seçtiyseniz, ekibimiz modelinizi "
             "hazırladıktan sonra sipariş sayfanızdan indirebilirsiniz."],
            ["Ürün hasarlı gelirse?",
             "Teslimattan sonra 48 saat içinde fotoğraflarla info@figurunica.com adresine bildirin; hasar "
             "doğrulandığında ürün ücretsiz yeniden üretilir, değiştirilir veya bedeli iade edilir."],
        ]},

        {"t": "pb"},
        {"t": "h1", "x": "Asla söylemeyin"},
        {"t": "callout", "kind": "danger", "title": "Bu ifadeler yanlıştır ve müşteriyi yanıltır",
         "x": ["Aşağıdaki cümleler ürünün gerçekte yaptığı işle çelişir. Reklamda, sosyal medyada, "
               "e-postada veya birebir görüşmede kullanılmamalıdır. Her maddenin altında doğru mesaj vardır."]},
        {"t": "ul", "x": [
            "**“Yapay zekâ fotoğrafınızı anında 3D modele çevirir.”** — Otomatik 3D üretimi yoktur. AI yalnızca "
            "2 boyutlu stilize görsel üretir; 3D modeli ödeme sonrası ekip hazırlar. "
            "*Doğru mesaj:* “Baskıdan önce tasarımınızı onaylayın.”",
            "**“Satın almadan önce 3D modelini döndürerek inceleyin.”** — Satın alma öncesi önizleme düz bir 2D "
            "görseldir; döndürülebilir 3D önizleme yoktur. Bu, mağaza ürünleri için de geçerlidir.",
            "**“Koşulsuz para iade garantisi” / “Memnun kalmazsan iade.”** — Kişiye özel figürinlerde fikir "
            "değişikliğiyle iade yoktur. *Doğru mesaj:* onaylamadan baskı başlamaz + hasar/ayıpta ücretsiz "
            "yenileme, değişim veya bedel iadesi + hazır ürünlerde 14 gün cayma hakkı.",
            "**“Tek tıkla anında para iadesi.”** — Para iadesi manuel bir operasyondur; “5–10 iş günü” "
            "operasyonel taahhüttür, yazılım garantisi değildir.",
            "**“Dekontunuz anında onaylanır.”** — Koşulsuz söylemeyin. Bulanık/eğik dekont veya IBAN uyuşmazlığında "
            "sipariş insan incelemesine düşer. *Doğru mesaj:* “çoğu dekont saniyeler içinde otomatik onaylanır.”",
            "**“E-faturanız otomatik düzenlenir.”** — E-fatura entegrasyonu yoktur; yalnızca uygulama içinde KDV "
            "ayrıştırmalı fatura dökümü gösterilir.",
            "**“Kargonuzu canlı izliyoruz, teslimatta otomatik haber veriyoruz.”** — “Teslim edildi” bilgisi kargo "
            "firmasından otomatik gelmez, ekip elle işaretler.",
            "**“Kampanya kodu / indirim kuponu girin.”** — Kupon, promosyon kodu, toplu alım indirimi ve referans "
            "programı sistemde YOKTUR. Tek indirimler: %3 havale indirimi ve hediye kartı.",
            "**“Sevdiklerinize hediye kartı satın alın.”** — Müşteri siteden hediye kartı SATIN ALAMAZ; kartlar "
            "yalnızca yönetici panelinden oluşturulur.",
            "**“5.000+ mutlu müşteri”, “4,9 puan”, “binlerce hazır ürün”** gibi hacim/sosyal kanıt iddiaları "
            "YASAKTIR — sitede müşteri yorumu/referans bölümü yoktur ve elimizde doğrulanmış bir sayı yoktur.",
            "**“Dünyaya gönderim.”** — Şu an yalnızca Türkiye içi teslimat vardır.",
            "**“Yüklediğiniz her modele anında otomatik fiyat.”** — Geometri işlenemezse, model kapalı hacim "
            "değilse veya baskı zarfını aşarsa talep özel teklife düşer.",
            "**“Görsellerinizi kendi sunucumuzda üretiyoruz.”** — Figür görselleri dış bir servisle üretilir "
            "(sağlayıcı adı dışarıya verilmez). Kendi sunucumuzda yapılan tek AI işi arka plan silmedir.",
            "**“Telefon/SMS doğrulamalı güvenli üretim.”** — Telefon doğrulaması kapalıdır.",
            "**“Fotoğraflarınız 90 gün sonra otomatik silinir.”** — Bu uygulanmıyor; siparişe bağlı fotoğraflar "
            "saklanır.",
            "**“Tek tıkla siparişi iptal et.”** — Müşteri tarafında iptal butonu yoktur; iptal e-posta ile "
            "manuel yapılır.",
            "**Teslim sürelerini “garanti” diye sunmayın** — politika açıkça “tahminidir, garanti edilmez” der.",
            "**Başlangıç fiyatında tek rakama sadık kalın:** reçine ₺999’dan, filament ₺899’dan başlar. "
            "İki farklı rakamı aynı kampanyada karıştırmayın.",
            "**İngilizce pazarlama materyalini sitedeki metinlere dayandırmayın** — site yalnızca Türkçe yayındadır.",
        ]},

        {"t": "h1", "x": "Kampanya öncesi netleştirilecekler"},
        {"t": "p", "x": "Aşağıdaki maddeler kampanya yayına girmeden önce kurucuya/ekibe sorulmalıdır. "
                        "Cevap alınmadan ilgili konuda iletişim yapılmamalıdır."},
        {"t": "ol", "x": [
            "Başlangıç fiyatı iletişiminde hangi rakamı kullanıyoruz: “₺899’dan başlayan” (filament) mı, "
            "“₺999’dan başlayan” (reçine) mi?",
            "Kargo SMS’i gerçekten gönderiliyor mu? (SMS sağlayıcısının bağlı olduğu teyit edilmeli.)",
            "İade politikası ile sitedeki bazı güven ifadeleri çelişiyor. Hukuk hangi metni onaylıyor?",
            "Gizlilik politikasında kodla çelişen maddeler var. Düzeltilecek mi, yoksa pazarlama bu konulardan "
            "hiç bahsetmeyecek mi?",
            "Yurt dışı gönderim talebi geldiğinde standart cevabımız ne?",
            "Kupon/indirim kodu motoru gelecek mi? Gelmezse tüm kampanyalar %3 havale indirimi ve hediye kartı "
            "üzerinden kurgulanmalı.",
            "Hediye kartı satın alma sayfası yol haritasında var mı? Yılbaşı/bayram kampanyası bunsuz kurulamaz.",
            "Mağazada onaylı ürün var mı? Yoksa ana sayfa rafları boş görünür.",
        ]},
        *CONTACT,
    ],
}


# ═══════════════════════════════════════════════════════════════════════════
# DOKÜMAN 2 — PARTNER KAZANIM KİTİ (ÜRETİCİ + BOYACI)
# ═══════════════════════════════════════════════════════════════════════════

DOC2 = {
    "num": "02",
    "slug": "02-partner-kazanim-kiti",
    "title": "Partner Kazanım Kiti",
    "subtitle": "3D baskı atölyeleri ve el boyama sanatçılarını Figurunica ağına katmak için "
                "kazanç modeli, iş akışı, panel ve itiraz karşılama.",
    "audience": "Hedef kitle: 3D baskı atölyesi (üretici) · el boyama atölyesi / sanatçı (boyacı)",
    "blocks": [
        {"t": "h1", "x": "Teklif tek cümlede"},
        {"t": "lead", "x": "**Üreticiye:** “Yazıcınız boş durmasın — biz müşteri talebini size getirelim, "
                           "siz sadece basın, kalite kontrolden geçirin ve kargolayın.” "
                           "**Boyacıya:** “Baskıyla uğraşmayın, sadece boyayın — üretici size kalite kontrolden "
                           "geçmiş boyasız figürü devretsin, siz boyayıp doğrudan müşteriye gönderin.”"},
        {"t": "kv", "x": [
            ["Komisyon", "Platform %35 · Partnerin net payı %65 — üretici, boyacı ve pazaryeri satışında aynı oran"],
            ["Hak ediş ne zaman", "Üretici: siparişi kargoladığında (boyacıya devrederse devir anında). "
                                  "Boyacı: boyalı ürünü kargoladığında"],
            ["Ödeme", "Panelden “Ödeme Talebi” — bekleyen tüm hak edişler tek pakette admin ödeme kuyruğuna düşer"],
            ["Kapasite kontrolü", "Partnerde: 1–50 arası eş zamanlı iş (varsayılan 5) + “Sipariş Almıyorum” anahtarı"],
            ["Ön ödeme riski", "Yok — üretime yalnızca ödemesi alınmış siparişler düşer"],
            ["Münhasırlık", "Yok. İlişki iş akdi değildir; partner bağımsız hizmet sağlayıcıdır"],
            ["Başvuru", "Beklemede → Koşullu Onaylı → Aktif (3 aşama)"],
        ]},

        {"t": "h1", "x": "30 saniyelik konuşma — üretici"},
        {"t": "quote", "x": "“Siz yazıcınızı kurmuşsunuz ama iş bulmakla uğraşıyorsunuz. Biz müşteriyi, tasarımı "
                            "ve ödemeyi hallediyoruz — size yalnızca **ödemesi alınmış**, **malzemenize uyan** ve "
                            "**kapasitenize sığan** işler düşüyor. Platform komisyonu %35, net payınız %65. "
                            "Kargoladığınız anda hak ediş hesabınıza işlenir, panelden tek tuşla ödeme talep "
                            "edersiniz. Yoğunsanız “sipariş almıyorum” dersiniz, iş yığılmaz. Münhasırlık yok — "
                            "kendi işinize devam edersiniz.”"},

        {"t": "h1", "x": "30 saniyelik konuşma — boyacı"},
        {"t": "quote", "x": "“Yazıcıya, reçineye, kargoya yatırım yapmanıza gerek yok. Üretici, kalite kontrolden "
                            "geçmiş boyasız figürü size devreder; siz boyar, kalite kontrol fotoğrafını yükler ve "
                            "onaydan sonra doğrudan müşteriye gönderirsiniz. El boyama bedeli ₺1.000 ve komisyon "
                            "sonrası figür başına net **₺650** kazanırsınız. Aynı anda kaç iş alacağınıza siz karar "
                            "verirsiniz.”"},

        {"t": "h1", "x": "Kazanç modeli"},
        {"t": "p", "x": "Tek bir oran vardır: **platform %35, partner %65.** Komisyon yuvarlanır, net pay tam "
                        "kalan olarak verilir — komisyon + net her zaman brüt tutara eşittir, partnerin aleyhine "
                        "kuruş kaybı olmaz."},
        {"t": "table",
         "head": ["Örnek iş", "Brüt", "Komisyon (%35)", "Partnerin neti (%65)"],
         "w": [6.4, 3.2, 3.2, 3.2],
         "rows": [
             ["Filament, küçük figür", "₺899", "₺314,65", "**₺584,35**"],
             ["Reçine, orta figür (en popüler)", "₺1.399", "₺489,65", "**₺909,35**"],
             ["Reçine, büyük figür", "₺1.799", "₺629,65", "**₺1.169,35**"],
             ["El boyama bedeli (boyacının tabanı)", "₺1.000", "₺350", "**₺650**"],
         ]},
        {"t": "ul", "x": [
            "**Normal (boyamasız) sipariş:** üretici, siparişi kargoladığı anda **sipariş tutarının tamamı** "
            "üzerinden hak ediş kazanır.",
            "**El boyamalı sipariş, iş boyacıya devredilirse:** üretici, sipariş tutarından boyama bedeli düşülerek "
            "kalan **baskı payı** üzerinden kazanır ve hak edişi **devir anında** tahakkuk eder (kargoyu beklemez). "
            "Boyacı ise ₺1.000’lik boyama bedeli üzerinden net ₺650 kazanır.",
            "**Kendi atölyesinde boyayan üretici** (panelden açılan seçenek) boyamalı siparişi hem basar, hem boyar, "
            "hem kargolar ve **sipariş tutarının tamamı** üzerinden kazanır — tek işte hem baskı hem boyama payını alır.",
            "**Ek gelir:** aktif üretici, kendi hazır ürünlerini pazaryerine listeleyebilir (admin onayıyla yayına "
            "girer, aynı %35 komisyon).",
            "**İade/iptal:** henüz ödenmemiş hak ediş geri alınır ve ödeme paketinden düşülür.",
        ]},

        {"t": "h1", "x": "Ödeme akışı"},
        {"t": "ol", "x": [
            "Hak edişler sipariş bazında birikir; üretici panelinde **Kazançlar** sayfasında bekleyen tutar, "
            "bugüne kadar ödenen toplam ve sipariş sipariş **brüt / komisyon / net** dökümü şeffaf biçimde görünür.",
            "Partner, panelden **“Ödeme Talebi”** düğmesine basar: bekleyen tüm hak edişler tek bir ödeme paketinde "
            "toplanıp admin ödeme kuyruğuna düşer.",
            "Admin ödemeyi yaptığında hak edişler “ödendi” durumuna geçer ve geçmiş ödeme listesinde görünür.",
            "Ödemeler yalnızca hesabı **aktif** olan partnerlere yapılır.",
            "**IBAN değişikliği admin onayına tabidir** — güvenlik gereği, onaylanana kadar ödeme eski IBAN’a gider. "
            "(Üreticide IBAN değişikliği ayrıca vergi incelemesini yeniden tetikler.)",
        ]},

        {"t": "pb"},
        {"t": "h1", "x": "Üretici partner — nasıl çalışır"},
        {"t": "h2", "x": "İş akışı"},
        {"t": "ol", "x": [
            "**Sipariş atanır.** Sadece ödemesi alınmış, malzemenize uyan ve kapasitenize sığan işler gelir. "
            "E-posta + panel içi bildirim alırsınız.",
            "**Kabul veya reddedersiniz.** Reddedilen sipariş otomatik olarak sıradaki uygun atölyeye yönlendirilir "
            "ve size tekrar teklif edilmez. (Bir sipariş 3 kez reddedilirse yöneticinin manuel atama kuyruğuna düşer.)",
            "**Model dosyasını indirirsiniz** (GLB / STL / OBJ) ve baskıyı başlatıp bitirirsiniz.",
            "**Kalite kontrol:** en az 1 ürün fotoğrafı yükleyip kalite kontrole gönderirsiniz. **Zorunludur** — "
            "Figurunica onaylamadan kargolama açılmaz. Reddedilirse düzeltip yeniden gönderirsiniz.",
            "**Kargolarsınız** (veya el boyamalı siparişte boyacıya devredersiniz). Hak ediş bu anda tahakkuk eder.",
        ]},
        {"t": "h2", "x": "Kontrol sizde"},
        {"t": "ul", "x": [
            "**“Sipariş Almıyorum” anahtarı:** tek tıkla kapatırsınız; kapalıyken hiç yeni sipariş atanmaz, "
            "devam eden işler etkilenmez. Tatil ve yoğunluk dönemleri için birebir.",
            "**Kapasite:** 1–50 arası eş zamanlı iş limiti (varsayılan 5). Limite ulaştığınızda yeni iş atanmaz.",
            "**Malzeme:** yalnızca çalıştığınız malzemedeki (reçine ve/veya filament) siparişler yönlendirilir — "
            "ekipmanınıza uymayan iş hiç düşmez.",
            "**Reddetme hakkı:** atanan işi reddedebilirsiniz.",
        ]},
        {"t": "h2", "x": "Sipariş size nasıl geliyor?"},
        {"t": "p", "x": "Sistem uygun atölyeleri puanlayıp sıralar: **lokasyon** (aynı şehir/bölge yakınlığı), "
                        "**mevcut iş yükü**, **geçmiş güvenilirlik** ve **uyum puanı**. Yakındaki ve yükü düşük olan "
                        "atölyeye öncelik verilir. İlk atamayı yönetici onaylar; bir üretici işi reddettiğinde "
                        "yeniden yönlendirme otomatik çalışır."},
        {"t": "h2", "x": "Panel"},
        {"t": "p", "x": "Üretici paneli 5 bölümdür: **Siparişler** (yeni atama rozetiyle), **Ürünlerim** "
                        "(pazaryeri ürünleri), **Kazançlar**, **Bildirimler** ve **Profil**. Sipariş ekranında model "
                        "dosyasını indirme, kabul/ret, baskıyı başlat/bitir, kalite kontrol fotoğrafı yükleme, "
                        "boyacıya gönderme ve kargolama adımları bulunur. Durum değişiklikleri panele canlı düşer."},

        {"t": "h1", "x": "Boyacı partner — nasıl çalışır"},
        {"t": "ol", "x": [
            "Üretici, kalite kontrolden geçmiş boyasız baskıyı size **devreder** (boyacıyı üretici seçer).",
            "**Kabul veya reddedersiniz.** Reddederseniz sipariş üreticiye geri döner ve başka bir boyacıya gönderilir.",
            "**Boyarsınız.**",
            "**Kalite kontrol fotoğrafını** yükleyip yönetici onayına gönderirsiniz.",
            "Onaydan sonra ürünü **doğrudan müşteriye kargolarsınız** — kargo firmasını ve takip numarasını panele "
            "elle girersiniz.",
        ]},
        {"t": "ul", "x": [
            "**Kazanç tabanı:** “El Boyaması” bitişinin kendisi, yani ₺1.000 → net **₺650** (aynı %35 komisyon).",
            "**Kapasite:** profilden 1–50 arası eş zamanlı iş; kapasite üstü iş size devredilemez. "
            "“Sipariş almıyorum” anahtarı vardır.",
            "**Panel** 4 bölümdür: Panel, İşler (yeni iş rozeti), Bildirimler, Profil. Ana ekranda atanan / kabul "
            "edilen / boyanmakta olan iş sayıları ve **bekleyen kazanç tutarı** görünür.",
        ]},
        {"t": "callout", "kind": "warn", "title": "Boyacıya dürüst olun",
         "x": ["Boyacı panelinde şu an **sipariş bazlı kazanç dökümü, ödeme geçmişi ve “ödeme talep et” düğmesi "
               "YOKTUR** — ödeme süreci ekiple yürütülür. Boyacı adayının soracağı ilk soru budur; “panelden "
               "kazancınızı takip edip ödeme talep edersiniz” demeyin, ödemenin nasıl yürüdüğünü operasyondan "
               "öğrenip net söyleyin."]},

        {"t": "pb"},
        {"t": "h1", "x": "Başvuru: ne isteniyor, kaç aşama?"},
        {"t": "p", "x": "Başvuru **3 aşamalıdır:** Beklemede (admin incelemesi) → Koşullu Onaylı (kanıt yüklenir) → "
                        "**Aktif** (iş almaya başlar). Hesap aktif olmadan sipariş atanmaz."},
        {"t": "table",
         "head": ["", "Üretici", "Boyacı"],
         "w": [4.6, 5.7, 5.7],
         "rows": [
             ["Temel bilgiler", "Firma adı, yetkili kişi, e-posta, telefon (WhatsApp opsiyonel), şifre",
              "Firma adı, yetkili kişi, e-posta, telefon (WhatsApp opsiyonel), şifre"],
             ["Adres", "Tam adres (il / ilçe / mahalle / posta kodu / açık adres)", "Tam adres"],
             ["Mesleki bilgi", "Üretim malzemesi (reçine ve/veya filament) + kapasite",
              "En az bir boyama tekniği + kapasite"],
             ["IBAN", "Başvuruda: IBAN + hesap sahibi + banka adı",
              "Hesap aktifleştikten SONRA panelden girilir"],
             ["Vergi no", "VKN/TCKN alanı var ancak zorunlu değil (boş bırakılırsa admin manuel inceler)", "—"],
             ["Koşullu onay kanıtı", "Kullanılan 3D yazıcıların net fotoğrafları (birden çok yazıcı için ayrı "
              "fotoğraf; JPEG/PNG, dosya başına en fazla 10 MB)", "Örnek çalışma"],
             ["Sözleşme", "Onay zorunlu — kutu işaretlenmeden kayıt açılmaz; komisyon oranı sözleşmede yazılı",
              "Onay zorunlu"],
             ["Panele giriş", "Hesap onaylanana kadar giriş yapılamaz",
              "Giriş yapıp durum ekranını görebilir, ancak aktif olmadan iş almaz"],
         ]},
        {"t": "p", "x": "Üretici ayrıca panelden **KYC belgesi** yükleyebilir: vergi levhası, ticaret sicil, "
                        "imza sirküleri, kimlik ve diğer (JPEG/PNG/PDF, dosya başına en fazla 10 MB). Belgeler hesap "
                        "onay beklerken de yüklenebilir. Yazıcı fotoğrafı yüklendikten sonra panelde “hesabınız "
                        "24 saat içinde incelenip onaylanacaktır” bilgisi gösterilir."},

        {"t": "h1", "x": "İtiraz karşılama"},
        {"t": "qa", "x": [
            ["Parasını almadığım iş için üretim yapar mıyım?",
             "Hayır. Üretime yalnızca **ödemesi alınmış** siparişler düşer. Ön ödeme riski yoktur."],
            ["Ödemem ne zaman yapılıyor?",
             "Panelden ödeme talebi oluşturduğunuzda bekleyen tüm hak edişleriniz tek pakette admin ödeme kuyruğuna "
             "düşer ve ödendiğinde kapanır. **Sabit bir haftalık otomatik ödeme günü vaat etmiyoruz.**"],
            ["Tatildeyim / yoğunum, iş yığılır mı?",
             "“Sipariş Almıyorum” anahtarını kapatır veya kapasitenizi düşürürsünüz — yeni iş atanmaz, devam eden "
             "işler etkilenmez."],
            ["Ekipmanıma uymayan iş gelir mi?",
             "Hayır. Yalnızca seçtiğiniz malzemedeki (reçine ve/veya filament) siparişler yönlendirilir."],
            ["Kalite tartışması çıkarsa ne olur?",
             "Her siparişte fotoğraflı kalite kontrol turu vardır; Figurunica onaylamadan kargolama açılmaz ve kaç "
             "turda geçildiği kayıt altındadır. İade/uyuşmazlıkta henüz ödenmemiş hak ediş geri alınır. Kabul edilen "
             "siparişi iptal etmeniz veya müşteri şikâyetinin aleyhinize sonuçlanması “strike” doğurur; **3 strike’ta "
             "hesap otomatik askıya alınır.** (Boyacılarda strike mekanizması yoktur.)"],
            ["Başka işlerime devam edebilir miyim?",
             "Evet. Münhasırlık yoktur ve ilişki bir iş akdi (işçi–işveren) doğurmaz; bağımsız hizmet sağlayıcı "
             "olarak kendi ekipmanınız ve malzemenizle çalışırsınız. Vergi/fatura yükümlülüğü size aittir."],
            ["İşi nasıl alıyorum? (boyacı)",
             "Boyacıya iş ataması algoritmik değildir: üretici, panelinden boyacı seçip işi devreder. Otomatik sıraya "
             "girme veya yeniden yönlendirme boyacı tarafında yoktur."],
            ["Kargoyu ben mi yapıyorum? (boyacı)",
             "Evet. Boyalı ürünü kalite kontrol onayından sonra doğrudan müşteriye siz kargolarsınız; kargo firmasını "
             "ve takip numarasını panele elle girersiniz."],
        ]},

        {"t": "pb"},
        {"t": "h1", "x": "Asla söylemeyin"},
        {"t": "callout", "kind": "danger", "title": "Partner adayına verilmiş yanlış söz, ilk ayda kaybedilen partnerdir",
         "x": ["Aşağıdakiler sistemde YOKTUR. Söylenirse partner ilk hafta fark eder ve güven biter."]},
        {"t": "ul", "x": [
            "**ASLA %70/%30 demeyin.** Tek geçerli oran: **%35 platform / %65 partner.** (Koddaki bazı eski yorumlar "
            "yanıltıcıdır.)",
            "**“%65 cebinize kalan kârdır” demeyin** — kargo/paketleme maliyetleri ayrı bir kesinti mekanizmasıyla "
            "modellenmiyor; %65 brüt hak ediştir.",
            "**“Her Cuma otomatik ödeme.”** — Zamanlanmış toplu ödeme yoktur. *Doğru mesaj:* “panelden talep "
            "ettiğinizde toplu ödeme”.",
            "**“Ödeme raporunuzu panelden indirin.”** — CSV/PDF rapor dışa aktarma yoktur.",
            "**“Kargo etiketi panelinize düşer.”** — Üretici paneli etiket üretmez; takip numarası elle girilir.",
            "**“Yanıt vermezseniz sipariş 24 saat içinde otomatik başka atölyeye gider.”** — Böyle bir zaman aşımı "
            "yoktur; yeniden yönlendirme yalnızca açıkça “Reddet” denince çalışır.",
            "**“Sipariş otomatik olarak üreticiye düşer.”** — Sistem adayları puanlayıp sıralar, **ilk atamayı "
            "yönetici onaylar.**",
            "**“Atölyeleri zamanında teslim performansına göre seçiyoruz.”** — Zamanında teslim şu an atama "
            "önceliğini etkilemiyor.",
            "**Boyacıya “kazançlarınızı panelden takip edip ödeme talep edin” demeyin** — boyacı panelinde Kazançlar "
            "sayfası, sipariş bazlı döküm ve ödeme talep düğmesi yoktur.",
            "**“Reddedilen boyama işi otomatik sıradaki boyacıya gider” demeyin** — boyacı ataması algoritmik değildir.",
            "**“Onaylanmadan panele giriş yok” iddiasını genellemeyin** — bu üretici için doğrudur; boyacı giriş yapıp "
            "durum ekranını görebilir.",
            "**Pazaryerinde “satıcı vitrini / tüm ürünlerimi gör” sayfası vaat etmeyin** — satıcı profil sayfası yoktur.",
        ]},

        {"t": "h1", "x": "Partner görüşmesi öncesi netleştirilecekler"},
        {"t": "ol", "x": [
            "Partner ödemeleri hangi ritimde yapılıyor — talepten sonra kaç iş günü? (Sözleşmedeki “her Cuma” "
            "ifadesinin kodda karşılığı yok; net bir taahhüt lazım.)",
            "Boyacı partnerlere kazanç dökümü ve ödeme talebi paneli ne zaman gelecek? Kazanım görüşmesinde "
            "sorulacak ilk soru budur.",
            "Boyacı ödemeleri şu an fiilen nasıl yapılıyor? (Panelde düğme olmadığına göre operasyonel akış nedir?)",
            "“Lüks Vitrin” paketi tam el boyaması vaat ediyor ama sipariş otomatik olarak boyacıya yönlenmiyor — "
            "operasyon bunu nasıl karşılıyor?",
            "Boyacı rolü ve atölye talepleri canlı veritabanında aktif mi? “Canlıda” demeden önce teyit gerekir.",
        ]},
        *CONTACT,
    ],
}


# ═══════════════════════════════════════════════════════════════════════════
# DOKÜMAN 3 — KURUMSAL & ATÖLYE (B2B) KİTİ
# ═══════════════════════════════════════════════════════════════════════════

DOC3 = {
    "num": "03",
    "slug": "03-kurumsal-atolye-kiti",
    "title": "Kurumsal & Atölye Kiti",
    "subtitle": "Mekânınızda Atölye, kurumsal hediyelik ve endüstriyel 3D baskı — "
                "üç B2B teklifi, süreçleri, sınırları ve itiraz karşılama.",
    "audience": "Hedef kitle: kafe/restoran/okul/kreş/ofis sahipleri · etkinlik organizatörleri · "
                "kurumsal hediye alıcıları · mühendislik ve tasarım ekipleri",
    "blocks": [
        {"t": "h1", "x": "Üç kurumsal teklif"},
        {"t": "table",
         "head": ["Teklif", "Kime", "Fiyat"],
         "w": [4.4, 6.6, 5.0],
         "rows": [
             ["**Mekânınızda Atölye**", "Kafe, restoran, okul, kreş, ofis, etkinlik salonu, ev — "
              "uygulamalı figür boyama & tasarım deneyimi", "Sabit fiyat yok — her etkinliğe özel teklif"],
             ["**Kurumsal hediyelik**", "Çalışan/müşteri hediyesi, etkinlik hatırası: fotoğraftan figür, "
              "anahtarlık, magnet, gece lambası", "Anahtarlık ₺149 · Magnet ₺129 · Gece lambası ₺399 · "
              "Figür ₺899’dan başlar"],
             ["**Endüstriyel 3D baskı**", "Kendi STL/OBJ dosyasını bastırmak isteyen mühendislik, mimarlık, "
              "tasarım ve maker ekipleri", "Hacim bazlı otomatik fiyat veya özel teklif"],
         ]},
        {"t": "note", "x": "Üçünde de Türkiye içi kargo ücretsizdir ve tüm fiyatlar KDV dahildir."},

        {"t": "pb"},
        {"t": "h1", "x": "Teklif 1 — Mekânınızda Atölye"},
        {"t": "lead", "x": "Kafe, restoran, okul, kreş, ofis, etkinlik salonu ya da eve, uygulamalı figür boyama ve "
                           "tasarım atölyesini biz getiriyoruz. **Tüm malzeme ve ekipman bizden.** Katılımcı sayısı "
                           "ve konsepte göre size özel program ve teklif hazırlıyoruz."},
        {"t": "h2", "x": "Kapsam"},
        {"t": "table",
         "head": ["", "Seçenekler"],
         "w": [4.2, 11.8],
         "rows": [
             ["Mekân türü", "Kafe · Restoran · Okul · Anaokulu/Kreş · Kurumsal/Ofis · Etkinlik salonu · Ev · Diğer"],
             ["Etkinlik türü", "Doğum günü · Kurumsal / takım etkinliği · Okul / sınıf · Özel grup · Diğer"],
             ["Yaş grubu", "Çocuk (4–12) · Genç (13–17) · Yetişkin (18+) · Karışık"],
             ["Katılımcı sayısı", "1 – 1000"],
             ["Konum", "Türkiye’nin 81 ilinden talep gönderilebilir (stüdyomuz Ankara/Etimesgut’ta)"],
         ]},
        {"t": "h2", "x": "Süreç"},
        {"t": "ol", "x": [
            "Mekân sahibi **figurunica.com/atolye** formunu doldurur: tercih edilen ve alternatif tarih, kurum adı, "
            "katılımcı sayısı, yaş grubu, özel istekler, bütçe (opsiyonel) ve il/ilçe. Üyelik gerekmez.",
            "Talebe **WS-XXXXXX** takip referansı verilir ve anında onay e-postası gider.",
            "Talep sırayla **Yeni → İnceleniyor → Planlandı → Tamamlandı** aşamalarından geçer.",
            "**Planlandı** aşamasında tarih, teklif tutarı ve adres yazılı olarak e-postayla iletilir.",
        ]},
        {"t": "callout", "kind": "info", "title": "Formda ne söylüyoruz",
         "x": ["“Mekânınıza geliyoruz — tüm malzeme ve ekipmanı biz getiriyoruz.”",
               "“Her yaş grubuna uyarlanabilen figür boyama & tasarım deneyimi.”",
               "“Anahtar teslim: katılımcı sayısı ve konsepte göre size özel program ve teklif.”",
               "Form **bağlayıcı bir sipariş oluşturmaz** — bunu görüşmede de açıkça söyleyin, dönüşümü artırır."]},
        {"t": "note", "x": "KVKK açık rızası formda zorunludur ve zaman damgasıyla kayıt altına alınır."},

        {"t": "pb"},
        {"t": "h1", "x": "Teklif 2 — Kurumsal hediyelik"},
        {"t": "lead", "x": "Fotoğraftan üretilen kişiye özel hediyelikler: figür, anahtarlık, buzdolabı magneti ve "
                           "gece lambası. Sabit fiyat, sitede gerçek ödeme, Türkiye içi ücretsiz kargo."},
        {"t": "table",
         "head": ["Ürün", "Fiyat", "Not"],
         "w": [4.6, 3.4, 8.0],
         "rows": [
             ["Anahtarlık", "₺149", "Fotoğraftan üretim, sabit fiyat"],
             ["Buzdolabı magneti", "₺129", "Fotoğraftan üretim, sabit fiyat"],
             ["Gece lambası", "₺399", "Fotoğraftan üretim, sabit fiyat"],
             ["Kişiye özel figür", "₺899 – ₺1.799", "Malzeme ve boyuta göre; el boyaması +₺1.000, "
              "lüks vitrin +₺2.000"],
             ["Logo / 2D tasarımdan ürün", "₺549 – ₺1.499", "Kurum logosu, çizim veya düz görselden 3D ürün"],
         ]},
        {"t": "h2", "x": "Kurumsal alıcıya avantaj"},
        {"t": "ul", "x": [
            "**Havale/EFT ile %3 indirim** — kurumsal transferle ödeyen için doğrudan avantaj. Ödeme için 72 saat "
            "süre vardır, 24. saatte hatırlatma e-postası gider.",
            "**Sipariş kaynağı ölçülebilir:** kampanya/kanal bilgisi siparişe yazılır; yönetim panelinde kanal bazlı "
            "ciro raporu vardır. Kurumsal kampanyaların getirisi raporlanabilir.",
            "**Hediye kartı** ödeme adımında kullanılabilir (bakiye bazlı, kısmi kullanılabilir).",
            "Anahtarlık/magnet/lamba yalnızca **figurunica.com/urunler** sayfasından satılır — figür tasarım "
            "ekranında görünmez.",
        ]},
        {"t": "callout", "kind": "warn", "title": "Kurumsal satışta bilmeniz gereken üç sınır",
         "x": ["**Sepette satır başına en fazla 20 adet** alınabilir. Daha büyük hacimli talepler self-servis "
               "yapılamaz; WhatsApp veya e-posta üzerinden ekiple ilerlemek gerekir.",
               "**Toplu alım indirimi ve indirim kuponu sistemde yoktur.** Tek indirim mekanizmaları: %3 havale "
               "indirimi ve hediye kartı.",
               "**Sipariş akışında VKN / firma unvanı gibi kurumsal fatura alanları yoktur** ve e-fatura entegrasyonu "
               "bulunmamaktadır. Kurumsal faturalama ekiple manuel yürütülür — büyük hesapta bunu görüşmenin "
               "başında söyleyin."]},

        {"t": "pb"},
        {"t": "h1", "x": "Teklif 3 — Endüstriyel / maker 3D baskı"},
        {"t": "lead", "x": "Elinizdeki STL veya OBJ dosyasını yükleyin, baskı yüksekliğini ve malzemeyi seçin. "
                           "Uygun modellerde fiyat hacimden otomatik hesaplanır; büyük ve karmaşık işlerde ekibimiz "
                           "özel teklif hazırlar. Bu yolda yapay zekâ yoktur, üyelik gerekmez."},
        {"t": "table",
         "head": ["", "Detay"],
         "w": [4.6, 11.4],
         "rows": [
             ["Dosya", "STL veya OBJ · en fazla 50 MB"],
             ["Baskı yüksekliği", "40 / 60 / 80 / 120 / 160 mm (varsayılan 80 mm)"],
             ["Malzeme", "Reçine (SLA) veya filament (FDM)"],
             ["Fiyat formülü", "**Reçine:** ₺99 baz + ₺15/cm³ (en az ₺199)\n"
                               "**Filament:** ₺69 baz + ₺9/cm³ (en az ₺149)"],
             ["Bitiş", "Ham +₺0 · Pürüzsüz (zımpara + astar) +₺150 · Boyalı (tek renk) +₺400"],
             ["Baskı zarfı", "220 × 220 × 250 mm"],
             ["Özel teklif", "Zarfı aşan, kapalı hacim oluşturmayan veya otomatik fiyatı ₺50.000’i geçen modeller "
                             "**reddedilmez** — ekip elle teklif hazırlar. Teklifte fiyat ve “siparişe çevir & öde” "
                             "bağlantısı e-postayla gider; **teklif 7 gün geçerlidir.**"],
         ]},
        {"t": "h2", "x": "Gizlilik — mühendislik müşterisinin ilk sorusu"},
        {"t": "p", "x": "Yüklenen baskı dosyaları açıkta değildir: yalnızca siparişi atanan üretici, oturum ve atama "
                        "kontrolünden geçen bir indirme ucundan dosyayı çekebilir. Dosyalar mağaza ziyaretçilerine "
                        "veya diğer müşterilere hiçbir zaman gösterilmez. Bu siparişler “model hazırlığı” adımını "
                        "atlar, doğrudan üretime girer."},

        {"t": "h1", "x": "İtiraz karşılama"},
        {"t": "qa", "x": [
            ["Atölye ne kadara mal olur?",
             "Sabit paket fiyatımız yok; katılımcı sayısı ve konsepte göre size özel teklif hazırlıyoruz ve teklifi "
             "yazılı olarak e-postayla iletiyoruz."],
            ["Formu doldurursam taahhüt altına girer miyim?",
             "Hayır. Form bağlayıcı bir sipariş oluşturmaz; talebiniz ekibe ulaşır ve size dönüş yapılır."],
            ["Bizim şehre gelir misiniz?",
             "Türkiye’nin 81 ilinden talep gönderilebiliyor; stüdyomuz Ankara/Etimesgut’ta. Şehrinize gelip "
             "gelemeyeceğimizi teklif aşamasında netleştiriyoruz."],
            ["Atölyeyi siteden online ödeyebilir miyim?",
             "Şu an hayır — teklif e-postayla iletiliyor, ödeme ve planlama ekibimizle yürütülüyor."],
            ["Toplu alım indirimi var mı?",
             "Adet bazlı toplu alım indirimi veya kupon kodu sistemde yok. Tek indirim mekanizmaları: %3 havale "
             "indirimi ve hediye kartı."],
            ["Kurumsal fatura kesiyor musunuz?",
             "Sipariş akışında VKN/firma unvanı gibi kurumsal fatura alanları henüz yok; ödemesi tamamlanan siparişte "
             "müşteri KDV ayrıştırmalı fatura dökümünü hesabından görüntüleyebiliyor. Kurumsal faturalama için "
             "ekiple iletişime geçilmesi gerekiyor."],
            ["500 adet hediyelik istiyorum, siteden alabilir miyim?",
             "Sepette satır başına en fazla 20 adet alınabiliyor; bu hacimdeki talepler ekiple yürütülür. "
             "WhatsApp veya e-postadan bize ulaşın."],
            ["Dosyamı yüklersem fiyatı hemen görür müyüm?",
             "Uygun geometrideki modellerde evet, fiyat hacimden hesaplanır. Model kapalı hacim değilse, baskı "
             "zarfına sığmıyorsa veya geometri ölçülemezse talep özel teklife düşer ve fiyatı e-postayla iletiriz."],
        ]},

        {"t": "pb"},
        {"t": "h1", "x": "Asla söylemeyin"},
        {"t": "callout", "kind": "danger", "title": "Kurumsal müşteriye verilen yanlış söz, sözleşme aşamasında patlar",
         "x": ["B2B alıcı satın alma öncesi her vaadi doğrular. Aşağıdakiler sistemde YOKTUR."]},
        {"t": "ul", "x": [
            "**Atölyede sabit fiyat (“kişi başı ₺X”), sabit süre veya sabit paket içeriği VAAT ETMEYİN.** Sistemde "
            "atölye fiyat listesi yoktur; her talep elle fiyatlanır. (Formdaki “₺500” yalnızca bir örnek metindir.)",
            "**“Atölye talebinizi online takip edin” demeyin** — müşteri tarafında atölye takip sayfası yoktur; "
            "yalnızca e-posta ve WS- referansı vardır. Atölyeyi siteden online ödeme yolu da yoktur.",
            "**“Kurumsal faturalı self-servis satış” vaat etmeyin** — sipariş akışında VKN/firma unvanı/e-fatura "
            "alanı yoktur. Ayrı bir kurumsal sayfa da bulunmuyor.",
            "**“E-faturanız otomatik düzenlenir / e-arşiv kesiyoruz” demeyin** — e-fatura entegrasyonu yoktur.",
            "**“Kampanya kodu / toplu alım indirimi” vaat etmeyin** — kupon motoru yoktur.",
            "**Sepette 20 adet üstü toplu siparişi self-servis olarak vaat etmeyin.**",
            "**“Size ödeme linki gönderelim” akışını duyurmayın** — bu akış canlıda kullanılmıyor.",
            "**“Yüklediğiniz her modele anında otomatik fiyat” demeyin** — geometri işlenemezse veya zarf aşılırsa "
            "talep sessizce özel teklife düşer.",
            "**Teslim sürelerini “garanti” diye sunmayın** — süreler tahminidir.",
            "**“Dünyaya gönderim” demeyin** — yalnızca Türkiye içi teslimat vardır.",
        ]},

        {"t": "h1", "x": "Kurumsal görüşme öncesi netleştirilecekler"},
        {"t": "ol", "x": [
            "Atölye için verilebilecek bir **referans fiyat bandı** var mı? (Kişi başı veya paket — satış "
            "konuşmasında bir bant olmadan ilerlemek zor.)",
            "Atölye **hizmet bölgemiz** neresi? 81 ilden talep alıyoruz ama stüdyo Ankara’da — fiilen hangi illere "
            "gidiyoruz?",
            "**E-fatura / e-arşiv** gerçek entegrasyonu ne zaman geliyor? Kurumsal satışta bu bir engel.",
            "20 adet üstü toplu siparişte **operasyonel kapasitemiz** ne? Kaç günde kaç adet üretebiliyoruz?",
            "Toplu kurumsal siparişte özel fiyat verebiliyor muyuz — yoksa liste fiyatı mı geçerli?",
        ]},
        *CONTACT,
    ],
}


# ═══════════════════════════════════════════════════════════════════════════
# DOKÜMAN 4 — GENEL SİSTEM TANITIMI
# ═══════════════════════════════════════════════════════════════════════════

DOC4 = {
    "num": "04",
    "slug": "04-sistem-tanitimi-genel",
    "title": "Sistem Tanıtımı",
    "subtitle": "Figurunica’nın ne olduğu, iş modeli, dört taraflı pazaryeri mekaniği, "
                "uçtan uca operasyon, teknoloji ve yol haritası.",
    "audience": "Hedef kitle: yatırımcı · iş ortağı · üst düzey paydaş · yeni ekip üyesi",
    "blocks": [
        {"t": "h1", "x": "Tek cümlede"},
        {"t": "lead", "x": "**Figurunica**, fotoğraftan kişiye özel 3D baskı figür üreten bir üretim stüdyosu ve "
                           "aynı zamanda onaylı üreticilerin hazır ürünlerini sattığı bir 3D baskı pazaryeridir — "
                           "yapay zekâ destekli tasarım önizlemesi, dağıtık partner üretim ağı, zorunlu kalite "
                           "kontrol ve uçtan uca sipariş takibiyle birlikte."},

        {"t": "h1", "x": "Problem ve çözüm"},
        {"t": "table",
         "head": ["Problem", "Figurunica’nın çözümü"],
         "w": [7.8, 8.2],
         "rows": [
             ["Kişiye özel 3D figür pazarında müşteri, ne alacağını görmeden ödeme yapmak zorunda kalıyor.",
              "Yapay zekâ **iki** stilize tasarım seçeneği üretir, müşteri seçer ve onaylar. **Onaylanmadan üretim "
              "başlamaz;** beğenilmezse 4 tura kadar yeni seçenek veya revizyon talebi."],
             ["3D baskı atölyeleri ekipmana yatırım yapıyor ama sürekli iş akışı bulamıyor; boş kapasiteyle çalışıyor.",
              "Dağıtık partner ağı: platform müşteriyi, tasarımı ve ödemeyi getirir; atölyeye yalnızca **ödemesi "
              "alınmış**, malzemesine uyan ve kapasitesine sığan iş düşer. Komisyon %35, atölyenin payı %65."],
             ["Kişiye özel üretimde kalite tutarsızlığı en büyük itibar riski.",
              "Her siparişte **zorunlu, fotoğraflı kalite kontrol.** Platform onaylamadan kargolama açılmaz; "
              "el boyamada ikinci bir tur daha vardır. Turlar kayıt altındadır."],
             ["Müşteri, siparişinin nerede olduğunu bilmiyor; destek yükü artıyor.",
              "Üyelik gerektirmeyen, durum değiştiği anda **canlı güncellenen** 8 adımlı sipariş takip sayfası."],
         ]},

        {"t": "h1", "x": "İş modeli"},
        {"t": "p", "x": "Tek ve tutarlı bir komisyon oranı: **platform %35, partner %65.** Aynı oran üreticiler, "
                        "boyacılar ve pazaryerinde ürün satan üreticiler için geçerlidir; kodda tek bir sabitten "
                        "okunur. Komisyon yuvarlanır, net pay tam kalan olarak verilir — komisyon + net her zaman "
                        "brüte eşittir."},
        {"t": "table",
         "head": ["Gelir hattı", "Nasıl çalışır", "Marj"],
         "w": [4.4, 7.6, 4.0],
         "rows": [
             ["Kişiye özel üretim (ana hat)", "Fotoğraftan / 2D tasarımdan / müşterinin STL-OBJ dosyasından figür ve "
              "obje üretimi. Fiyat ₺549 – ₺1.799 + bitiş paketi (+₺1.000 el boyama, +₺2.000 lüks vitrin) + ek hizmetler.",
              "Üretim partnere verilirse **%35 komisyon**"],
             ["Pazaryeri", "Onaylı üreticiler kendi hazır ürünlerini listeler; her ürün admin onayından geçer, "
              "siparişe özel üretilir. Fiyatı satıcı belirler.", "**%35 komisyon**"],
             ["Boyama katmanı", "El boyama ₺1.000’lik bir bitiş olarak satılır; iş boyacı partnere devredilir.",
              "**%35 komisyon** (boyacıya net ₺650)"],
             ["Hediyelik ürünler", "Anahtarlık ₺149, magnet ₺129, gece lambası ₺399 — sabit fiyat, fotoğraftan üretim.",
              "Sabit fiyatlı satış"],
             ["Atölye etkinlikleri", "Mekânda uygulamalı figür boyama & tasarım atölyesi; talep formu → özel teklif.",
              "Etkinlik başına özel fiyat"],
             ["Ek hizmetler", "Ekstra boya katmanı ₺49, hediye paketi ₺29, hızlı kargo ₺79, dijital dosyalar ₺99.",
              "Doğrudan satış"],
         ]},
        {"t": "note", "x": "Sabit maliyet avantajı: üretim kapasitesi partner atölyelerde olduğu için ölçeklenme "
                           "makine yatırımı gerektirmez. Nakit riski düşüktür — üretime yalnızca ödemesi alınmış "
                           "siparişler düşer."},

        {"t": "pb"},
        {"t": "h1", "x": "Platformun dört tarafı"},
        {"t": "table",
         "head": ["Taraf", "Ne yapar", "Ne kazanır"],
         "w": [3.6, 7.4, 5.0],
         "rows": [
             ["**Müşteri**", "Fotoğraf/tasarım/3D dosya yükler veya mağazadan hazır ürün alır; tasarımı onaylar, öder, "
              "siparişini canlı takip eder.", "Onaylamadan üretim başlamayan, kalite kontrolden geçmiş kişiye özel ürün"],
             ["**Üretici**", "Atanan siparişi kabul eder, basar, fotoğraflı kalite kontrolden geçirir, kargolar. "
              "İsterse kendi ürünlerini pazaryerine listeler.", "Sipariş tutarının **%65’i** + pazaryeri satış geliri"],
             ["**Boyacı**", "Üreticiden devraldığı boyasız figürü boyar, kalite kontrolden geçirir, doğrudan müşteriye "
              "kargolar.", "El boyama bedelinin **%65’i** = figür başına net **₺650**"],
             ["**Platform**", "Talep yaratır, tasarımı üretir/hazırlar, ödemeyi ve iadeyi yönetir, üreticiyi atar, "
              "kalite kontrolü onaylar, lojistiği ve müşteri iletişimini yürütür.", "**%35 komisyon** + sabit fiyatlı "
              "ürün ve hizmet satışı"],
         ]},

        {"t": "h1", "x": "Uçtan uca operasyon"},
        {"t": "ol", "x": [
            "**Talep:** müşteri üç yoldan biriyle girer — fotoğraftan üretim, 2D tasarım/logodan ürün ya da kendi "
            "STL/OBJ dosyası. Ayrıca hazır ürün mağazası vardır.",
            "**Tasarım önizlemesi:** yapay zekâ, fotoğraftan **iki** stilize 2D görsel üretir (7 tasarım deseni). "
            "Müşteri seçer; beğenmezse 4 tura kadar yeniler veya revizyon talebi bırakır. Arka plan temizleme kendi "
            "sunucumuzda yapılır.",
            "**Ödeme:** kart (3D Secure, kart bilgisi platforma hiç girmez) veya havale/EFT (%3 indirim). Havale "
            "dekontu otomatik okunur; tutar ±1 TL toleransla eşleşir ve çoğu dekont insan beklemeden onaylanır.",
            "**Model hazırlığı:** ekip, onaylı tasarımdan 3D modeli hazırlayıp sisteme yükler. (Kendi dosyasını "
            "yükleyen sipariş bu adımı atlar.)",
            "**Üretici ataması:** sistem uygun atölyeleri **lokasyon, iş yükü, geçmiş güvenilirlik ve uyum puanına** "
            "göre sıralar; ilk atamayı yönetici onaylar. Atölye reddederse iş otomatik olarak sıradaki uygun atölyeye "
            "geçer (3 retten sonra yönetici kuyruğuna düşer).",
            "**Üretim + kalite kontrol:** atölye basar, en az bir ürün fotoğrafı yükleyip kalite kontrole gönderir. "
            "Platform onaylamadan kargolama açılmaz.",
            "**El boyama (opsiyonel):** figür boyacı partnere devredilir, boyanır ve **ikinci** bir kalite kontrolden "
            "geçer. Kendi atölyesinde boyayan üretici bu adımı kendisi yapar.",
            "**Kargo ve takip:** Yurtiçi, Aras, MNG, PTT ve Sürat desteklenir; müşteriye tıklanabilir takip bağlantısı, "
            "e-posta ve site içi bildirim gider. Takip sayfası üyeliksizdir ve canlı güncellenir.",
            "**Satış sonrası:** kargolanmış siparişte “sorun bildir” akışı; hasar teslimattan sonraki 48 saat içinde "
            "fotoğrafla bildirilirse ücretsiz yeniden üretim, değişim veya bedel iadesi.",
        ]},

        {"t": "pb"},
        {"t": "h1", "x": "Savunulabilirlik — sistemin gerçekten yaptıkları"},
        {"t": "ul", "x": [
            "**Onaya dayalı üretim.** Müşteri tasarımı onaylamadan hiçbir şey basılmaz. Bu, kişiye özel üretimdeki "
            "en büyük iade/şikâyet sebebini kaynağında keser.",
            "**Zorunlu, fotoğraflı kalite kontrol.** Kargolama, kalite kontrol onayı olmadan teknik olarak mümkün "
            "değildir; el boyamada ikinci tur vardır ve turlar kayıt altındadır.",
            "**Akıllı üretici yönlendirme.** Sipariş; malzemesine uyan, kapasitesi olan ve müşteriye yakın atölyeye "
            "gider. Ret durumunda otomatik yeniden yönlendirme çalışır.",
            "**Otomatik dekont okuma.** Havale dekontu okunur; tutar ±1 TL toleransla eşleşir, referans bulanık "
            "eşleştirmeyle bile bulunur ve tanınan banka şablonlarında ödeme insan beklemeden onaylanır. "
            "IBAN uyuşmazlığında otomatik onay asla verilmez.",
            "**Ödeme güvenliği.** Kart bilgileri platform sunucularına hiç girmez; ödeme bildirimi HMAC-SHA256 imzayla "
            "doğrulanır — sahte “ödeme başarılı” bildirimiyle sipariş açtırılamaz. Şifreler bcrypt ile saklanır.",
            "**Fikrî mülkiyet koruması.** Baskı dosyaları alıcılara hiçbir zaman gösterilmez; yalnızca siparişi atanan "
            "üretici yetki kontrolünden geçen bir uçtan indirebilir. Müşteri kendi STL/OBJ dosyasını ancak ₺99’luk "
            "dijital dosya ek hizmetini aldıysa indirebilir.",
            "**Sahte yorum imkânsız.** Ürün yorumunu yalnızca o ürünü satın alıp teslim almış kayıtlı müşteri, ürün "
            "başına bir kez yazabilir.",
            "**Partner ekonomisinde tek ve net oran.** %35 / %65 — üretici, boyacı ve pazaryeri satışında aynı. "
            "Hak ediş kargoda (boyamada devirde) tahakkuk eder, iade/uyuşmazlıkta geri alınır. Kuruş kaybı yoktur.",
            "**Partner disiplini.** Kabul edilen siparişin iptali veya müşteri şikâyetinin partner aleyhine "
            "sonuçlanması “strike” doğurur; 3 strike’ta üretici hesabı otomatik askıya alınır.",
            "**KVKK’ya uygun ölçüm.** Çerez rızası varsayılan “reddet” mantığıyla çalışır; onay verilmeden analitik ve "
            "pazarlama çerezleri çalışmaz. Sunucu tarafında IP adresleri hash’lenir, olay kayıtları 180 gün sonra "
            "otomatik silinir. Ticari ileti izni opt-in ve zaman damgalıdır.",
        ]},

        {"t": "h1", "x": "Şu an canlı olan"},
        {"t": "ul", "x": [
            "Üç girişli üretim akışı (fotoğraf · 2D tasarım · STL/OBJ yükleme) + 7 tasarım deseni.",
            "Yapay zekâ ile iki varyasyonlu tasarım önizlemesi ve müşteri onayı.",
            "Hazır ürün pazaryeri: kategori/arama/filtre, satıcı bazında bölünen tek sepet, satın alma doğrulamalı "
            "yorumlar.",
            "Kart ve havale/EFT ödeme + otomatik dekont okuma + hediye kartı.",
            "Üretici paneli (siparişler, ürünler, kazançlar, bildirimler, profil) ve boyacı paneli.",
            "Zorunlu fotoğraflı kalite kontrol + el boyama için ikinci kalite kontrol turu.",
            "Beş kargo firması desteği, üyeliksiz canlı sipariş takibi, e-posta ve site içi bildirimler.",
            "Mekânda atölye talep sistemi (WS- referansı, dört aşamalı yaşam döngüsü, KVKK rızası).",
            "Yönetim paneli: sipariş yönetimi, dekont incelemesi, üretici/boyacı yönetimi, ürün onayı, iade, "
            "kanal bazlı ciro raporu.",
        ]},

        {"t": "h1", "x": "Yol haritası — henüz canlıda olmayanlar"},
        {"t": "p", "x": "Aşağıdakiler bilinçli olarak “yok” kabul edilmelidir. Dış iletişimde bunlar vaat "
                        "edilmemelidir; yatırımcı/paydaş sunumunda ise yol haritası olarak dürüstçe konumlandırılır."},
        {"t": "table",
         "head": ["Eksik", "Etkisi", "Önem"],
         "w": [5.0, 7.8, 3.2],
         "rows": [
             ["Kupon / indirim kodu motoru", "Kampanya kurgusu yalnızca %3 havale indirimi ve hediye kartıyla sınırlı. "
              "Performans pazarlaması için engel.", "**Yüksek**"],
             ["Hediye kartı satın alma sayfası", "Kartlar yalnızca yönetici tarafından oluşturulabiliyor; müşteri satın "
              "alamıyor. Yılbaşı/bayram kampanyası bunsuz kurulamaz.", "**Yüksek**"],
             ["E-fatura / e-arşiv entegrasyonu", "Kurumsal satışta doğrudan engel; entegrasyon şu an bir taslaktır.",
              "**Yüksek**"],
             ["Boyacı kazanç/ödeme paneli", "Boyacıda sipariş bazlı kazanç dökümü ve ödeme talep düğmesi yok; ödeme "
              "manuel yürüyor. Partner kazanımında ilk sorulan soru.", "**Yüksek**"],
             ["Otomatik para iadesi", "İade butonu ödeme sağlayıcısına otomatik iade çağrısı yapmıyor; iade manuel "
              "bir operasyon.", "Orta"],
             ["Kurumsal fatura alanları (VKN/unvan)", "Sipariş akışında kurumsal alan yok; B2B self-servis satış "
              "yapılamıyor.", "Orta"],
             ["Toplu sipariş (20+ adet)", "Sepette satır başına 20 adet limiti var; kurumsal hacim self-servis "
              "karşılanamıyor.", "Orta"],
             ["Sosyal kanıt (yorum/referans bölümü)", "Sitede müşteri yorumu/referans bölümü yok; dönüşüm oranını "
              "doğrudan etkiler.", "Orta"],
             ["Meta / TikTok reklam pikselleri", "Canlıda çalışmıyor; performans pazarlaması ölçümü şu an yalnızca "
              "GA4/GTM ile sınırlı.", "Orta"],
             ["Satıcı vitrini (pazaryeri)", "Satıcının tüm ürünlerini gösteren profil sayfası yok.", "Düşük"],
             ["Telefon/SMS doğrulaması", "Kapalı; bağlı bir SMS sağlayıcısı yok.", "Düşük"],
             ["Yurt dışı gönderim", "Yalnızca Türkiye içi teslimat.", "Düşük"],
         ]},

        {"t": "pb"},
        {"t": "h1", "x": "Açık riskler ve netleştirilmesi gerekenler"},
        {"t": "callout", "kind": "danger", "title": "Lansman/sunum öncesi cevaplanmalı",
         "x": ["Bunlar ürün riskleri değil, **doğrulanmamış operasyonel varsayımlardır.** Cevap alınmadan “canlıda "
               "çalışıyor” denmemelidir."]},
        {"t": "ol", "x": [
            "**Ödeme sağlayıcısı canlı modda mı?** Kod varsayılanı test modudur; doğrulanmadan “canlı ödeme "
            "alıyoruz” denemez.",
            "**Kargo entegrasyonunun canlı kimlik bilgileri tanımlı mı** ve test modu kapalı mı?",
            "**SMS sağlayıcısı bağlı mı?** Bağlı değilse “kargo SMS’i gönderiyoruz” vaadi kaldırılmalı.",
            "**Bot koruması (Turnstile) anahtarı canlıda tanımlı mı?** Tanımlı değilse doğrulama sessizce atlanır.",
            "**Yüklenen model için geometri işleme canlı sunucuda çalışıyor mu?** Çalışmıyorsa “anında otomatik "
            "fiyat” vaadi tamamen kaldırılmalı ve akış “özel teklif” olarak anlatılmalı.",
            "**Gizlilik politikası kodla çelişiyor:** politika depolama sağlayıcısı, e-posta sağlayıcısı ve “izleme "
            "çerezi kullanmıyoruz” maddelerinde gerçeği yansıtmıyor; “fotoğraflar 90 gün sonra silinir” maddesi de "
            "uygulanmıyor. Hukuki risk — düzeltilmeli.",
            "**Pazaryeri ödeme formunda mesafeli satış ve KVKK onay kutusu yok** — mevzuat açığı, lansman öncesi "
            "kapatılmalı.",
            "**Ticari ileti izin sistemi (İYS) entegrasyonu yok** — toplu ticari e-posta/SMS göndermeden önce hukuk "
            "teyidi şart.",
            "**Boyacı ödemeleri fiilen nasıl yapılıyor?** Panelde ödeme talep akışı yok.",
            "**Pazaryerinde onaylı ürün var mı?** Yoksa ana sayfa rafları boş görünür — lansman öncesi ürün "
            "doldurulmalı.",
            "**Sözleşmedeki “her Cuma ödeme” ifadesinin kodda karşılığı yok** — partner sözleşmesi düzeltilmeli.",
        ]},
        *CONTACT,
    ],
}

DOCS = [DOC1, DOC2, DOC3, DOC4]
