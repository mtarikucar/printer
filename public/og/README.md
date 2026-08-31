# OG kart fontları

`og-regular.ttf` ve `og-bold.ttf`, **DejaVu Sans**'ın yalnızca link önizleme
kartında geçen karakterlere (Latin + Türkçe + rakam + noktalama) alt kümelenmiş
hâlleridir. 760 KB'lık tam font yerine ~14 KB.

**Neden depoda duruyorlar:** `next/og` (satori) bilmediği bir glif gördüğünde
üçüncü taraf bir font servisinden dinamik font çekmeye çalışıyor. Türkçe `ğ`/`ş`
tam olarak bunu tetikliyor ve kısıtlı ağda build/render düşüyor. Yerel font, o
dış bağımlılığı tamamen kaldırıyor. satori **woff2 desteklemiyor**, bu yüzden
TTF.

**Lisans:** DejaVu fontları Bitstream Vera lisansı türevidir; ticari kullanım ve
yeniden dağıtım serbesttir, telif bildiriminin korunması gerekir:

    Fonts are (c) Bitstream (see below). DejaVu changes are in public domain.
    Glyphs imported from Arev fonts are (c) Tavmjong Bah (see below).

Tam metin: https://dejavu-fonts.github.io/License.html
