# Figurine Studio — Sistem Tanıtımı

## Ne Yapıyor?
Müşteri fotoğrafını yükler → yapay zeka fotoğraftan stilize bir figür görseli üretir → müşteri onaylar → ekip/üretici onaylı görselden 3D modeli hazırlar → reçineli baskı alınır → boya kitiyle birlikte kargoya verilir. Türkiye'ye yönelik bir foto-to-figür e-ticaret uygulaması.

## Akış (Müşteri Gözünden)
1. **Yükleme** — Müşteri fotoğraf yükler (`/create`). İnsan tespiti + arka plan temizleme yapılır.
2. **Önizleme** — fal.ai (nano-banana) ile fotoğraftan stilize figür görseli üretilir (2 varyasyon), müşteri beğendiğini seçer/onaylar. Otomatik 3D üretimi yoktur; onaylı görselden 3D modeli ekip hazırlar ve admin panelden yükler (sipariş `awaiting_model` durumunda bekler).
3. **Ödeme** — PayTR (kart) veya Havale/EFT. Havale akışında dekontu OCR ile eşleştiriyoruz.
4. **Üretim** — Sipariş bir üreticiye atanır (`manufacturer-assignment`). Üretici panelden onaylar, basar, kargoya verir.
5. **Kargo** — Yurtiçi Kargo SOAP API üzerinden gönderi açılır, takip numarası müşteriye gider.

## Teknik Yapı

### Çekirdek
- **Next.js 16** (App Router, TS strict) — port 3005
- **PostgreSQL + Drizzle ORM** — 13 tablo, migration'lar `/drizzle/` altında commit'li
- **BullMQ + Redis** — uzun süren işler (görsel üretimi, e-posta, bildirim, temizlik) ayrı worker process'inde (`workers/start.ts`)
- **Python subprocess** — müşterinin yüklediği STL/OBJ modellerinin geometri işlemesi (`scripts/process_upload_model.py`)

### Servisler (`src/lib/services/`)
- `fal-image.ts` — fal.ai ile fotoğraftan stilize figür/ürün görseli üretimi (eski Meshy/Tripo 3D sağlayıcıları kaldırıldı)
- `paytr.ts` — kart ödeme entegrasyonu
- `dekont-ocr.ts` — havale dekontu OCR + fuzzy eşleştirme
- `yurtici-kargo.ts` — kargo SOAP istemcisi
- `manufacturer-assignment.ts` — üretici atama mantığı (shadow versiyonu da var, karşılaştırma için)
- `customer-auth.ts` / `manufacturer-auth.ts` — müşteri ve üretici için ayrı auth
- `email.ts`, `password-reset.ts`, `gift-card.ts`, `iban.ts`, `tax-id.ts` vb.

### Auth
- **Admin** → NextAuth v5 beta (credentials)
- **Üretici** → custom JWT cookie
- **Müşteri** → kendi servisi (`customer-auth.ts`)

### Depolama
Yerel dosya sistemi (`./uploads/`, `UPLOAD_DIR`). S3 yok. Dosyalar `/api/files/[...path]` üzerinden servis ediliyor.

### Dil
Türkçe birincil, İngilizce ikincil (`src/lib/i18n/dictionaries/`).

### Deploy
Railway üzerinde Docker compose, `deploy.sh` ile migration'lar uygulanıyor.

## Panel Yapısı
- `/admin` — sipariş yönetimi, OCR review, galeri moderasyonu, üretici yönetimi
- `/manufacturer` — üreticiye atanan sipariş listesi, basım/kargo akışı
- `/account` — müşteri sipariş takibi
- `/track` — public sipariş izleme

## Test
- **Playwright e2e** — `npm run test:e2e`
- **Unit/smoke testler** — `npm run test:unit` (OCR, ödeme, scoring, slug, fuzzy match vb. için tek tek `tsx scripts/test-*.ts`)
- **TypeScript check** — `tsc --noEmit` fiili doğruluk kapısı

## Kritik Notlar
- ioredis 5.9.3'e pinli (BullMQ uyumluluğu)
- Drizzle migration'ları commit ediliyor, sadece `_journal.json` gitignore'da
- Üretici atama için "shadow" servis var — yeni mantığı canlıya almadan eski sonuçla karşılaştırıyoruz
