# Figurunica — Pazarlama Kitleri

Pazarlama ve satış ekibinin sistemi tanıtırken kullanacağı dört doküman. Her biri
**.odt** (LibreOffice/Word ile düzenlenebilir) ve **.pdf** (dağıtıma hazır) olarak üretilir.

| # | Doküman | Kime |
|---|---------|------|
| 01 | `01-son-musteri-satis-kiti` | Bireysel müşteri, hediye alıcısı, mağaza müşterisi, maker |
| 02 | `02-partner-kazanim-kiti` | 3D baskı atölyeleri (üretici) ve el boyama atölyeleri (boyacı) |
| 03 | `03-kurumsal-atolye-kiti` | Mekân sahipleri, etkinlik organizatörleri, kurumsal alıcılar, mühendislik ekipleri |
| 04 | `04-sistem-tanitimi-genel` | Yatırımcı, iş ortağı, üst düzey paydaş, yeni ekip üyesi |

## Önemli

Bu dokümanlar **iç kullanım içindir** — müşteriye veya partnere olduğu gibi verilmez.
Her birinde bir **“Asla söylemeyin”** bölümü ve cevaplanmamış operasyonel sorular vardır.
Dışarıya çıkacak materyal (ilan, e-posta, sunum) bu dokümanlardan **üretilir**, doküman
kendisi paylaşılmaz.

İçerikteki her fiyat, oran ve vaat 13 Temmuz 2026'da canlı kod tabanına karşı doğrulanmıştır
(9 alan, 311 bulgu). Fiyat veya politika değişirse dokümanlar yeniden üretilmelidir.

## Yeniden üretme

İçeriği `scripts/marketing-docs/content.py` içinde değiştirin, sonra:

```bash
python3 scripts/marketing-docs/build.py      # → .odt + .build/*.html
node   scripts/marketing-docs/render_pdf.mjs # → .pdf
```

`.build/` ara HTML klasörüdür, sürüme dahil değildir.
