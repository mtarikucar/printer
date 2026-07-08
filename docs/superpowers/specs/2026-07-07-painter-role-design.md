# Boyacı (Painter) Partner Rolü + Opsiyonel Profesyonel Boyama — Tasarım

**Tarih:** 2026-07-07
**Durum:** Onaylı (kullanıcı 3 pivot kararı + tasarımı onayladı: "onaylıyorum yap")

## 1. Onaylanan kararlar
1. **Para modeli:** Müşteri-öder premium seçenek. Müşteri "Profesyonel boyama +₺X" seçer; boyacı bu ücretten %70 komisyonla hak ediş kazanır (üreticiler gibi).
2. **Kapsam:** Üretici altyapısının tam aynası (auth/panel/admin-onay/kapasite/hak ediş/ödeme).
3. **Kargo:** Boyacı doğrudan müşteriye kargolar.

## 2. Para modeli (kuruş, bps)
- `PLATFORM_COMMISSION_RATE_BPS = 3000` yeniden kullanılır (%30 platform / %70 partner).
- Sipariş `amountKurus` = item + upsell **+ paintingPriceKurus** (boyama seçiliyse).
- **Üretici hak edişi tabanı** = `amountKurus − paintingPriceKurus` (baskı payı).
- **Boyacı hak edişi tabanı** = `paintingPriceKurus`.
- Tahakkuk noktaları:
  - Boyama YOK: üretici kargolar → `accrueEarning(order, mfr, amountKurus)` (mevcut; paintingPrice=0).
  - Boyama VAR: üretici "boyacıya gönder" → üretici hak edişi (`amountKurus − paintingPriceKurus`); boyacı kargolar → boyacı hak edişi (`paintingPriceKurus`).
- `manufacturerEarnings.orderId` unique (bozulmaz). Yeni `painterEarnings.orderId` unique (sipariş başına 1 boyacı hak edişi).
- Boyama fiyatı: `PROFESSIONAL_PAINTING_PRICE_KURUS` config sabiti (v1 sabit; ileride bedene göre).

## 3. Sipariş akışı + durum makinesi
```
Boyama YOK:  paid → awaiting_model → … → printing → quality_check → [üretici ship] → shipped → delivered
Boyama VAR:  … → quality_check → [üretici "boyacıya gönder"] → painting(customer-görünür)
             → painterStatus: assigned → accepted → painting → painted → [boyacı ship] → shipped → delivered
```
- `orderStatusEnum` += **`painting`** (quality_check ile shipped arası; `ALTER TYPE … ADD VALUE 'painting' BEFORE 'shipped'`). Takip sayfasında "Boyanıyor".
- Yeni `painterOrderStatusEnum` = `["unassigned","assigned","accepted","painting","painted","shipped"]` (orders.painterStatus, default unassigned).
- Yeni `orders` kolonları: `needsPainting bool default false`, `paintingPriceKurus int default 0`, `painterId uuid → painters.id`, `painterStatus painterOrderStatusEnum default 'unassigned'`, `assignedToPainterAt ts`, `sentToPainterAt ts`, `paintedAt ts`, `declinedPainterIds jsonb $type<string[]>`.
- **Atama:** üretici panelinde, boyama-gerektiren + QC-onaylı siparişte "Boyacıya gönder" → aktif+kabul-açık+kapasitesi olan boyacılardan birini seçer → painterStatus=assigned, painterId set, sentToPainterAt/assignedToPainterAt set, order.status='painting', üretici hak edişi tahakkuk. Admin görebilir/yeniden atayabilir.

## 4. Boyacı veri modeli (manufacturers aynası)
- `painterStatusEnum` = manufacturerStatusEnum aynısı: `pending_approval, conditionally_approved, active, suspended, rejected`.
- `painters` tablosu = manufacturers aynası; farklar: `capabilities` = boyama teknikleri (jsonb string[]); `printerPhotoUploadedAt` → `workSamplePhotoUploadedAt` (koşullu-onay için iş örneği fotoğrafı kapısı); marketplace/seller alanları YOK. Alanlar: id, email(unique), passwordHash, companyName, contactPerson, phone, whatsappPhone, address(jsonb TurkishAddress), capabilities, taxId, taxIdType, requiresManualTaxReview, iban, bankAccountHolder, bankName, maxConcurrentOrders(def 5), acceptingOrders(def true), onboardingAcceptedAt, status(def pending_approval), rejectionReason, workSamplePhotoUploadedAt, notes, strikeCount(def 0), pendingIban, ibanReviewStatus, createdAt, updatedAt.
- `painterEarnings` = manufacturerEarnings aynası: id, orderId(unique FK), painterId(FK), grossKurus, commissionKurus, netKurus, commissionRateBps, status(earningStatusEnum), payoutId(→painterPayouts), createdAt, updatedAt.
- `painterPayouts` = payouts aynası: id, painterId(FK), totalKurus, status(payoutStatusEnum), reference/note, requestedAt, paidAt, createdAt.
- `painterActions` = manufacturerActions aynası (per-order audit): id, orderId, painterId, action(text), notes, createdAt.
- `painterNotifications` = manufacturerNotifications aynası (bildirim merkezi).
- relations() blokları: painters/painterEarnings/painterPayouts.

## 5. Boyacı auth + panel (manufacturer-auth + /manufacturer aynası)
- `src/lib/services/painter-auth.ts`: cookie `painter_session`, secret `env.PAINTER_JWT_SECRET` (fallback AUTH_SECRET), `JWT_CLAIMS.painter`, token `{painterId,email}`, `create/verify/set/clear/getPainterSession`. `hashPassword/verifyPassword` customer-auth'tan.
- `src/lib/env.ts`: `PAINTER_JWT_SECRET` (optional, fallback AUTH_SECRET) + `JWT_CLAIMS.painter = {iss:"figurunica-painter", aud:"painter"}`.
- `src/middleware.ts`: `/painter/*` gate (login hariç), cookie kontrolü — manufacturer gate aynası.
- `src/app/painter/**`: layout + sidebar (PanelShell + LocaleProvider), register, login, dashboard, jobs (atanan boyama işleri + aksiyonlar: accept/decline, "boyandı", ship+kargo no), profile (IBAN/kapasite/kabul toggle/iş örneği foto), notifications.
- `src/app/api/painter/**`: auth/{register,login,logout,me}, orders/[id]/{accept,decline,painted,ship}, payout-request, notifications, profile/iban, work-sample-photo.

## 6. Boyacı admin (admin/manufacturers aynası)
- `src/app/admin/painters/**`: list + [id] detay + client (approve/conditionally-approve/reject/suspend/activate/message-note/payout). Onay yaşam döngüsü + iş örneği foto kapısı.
- `src/app/api/admin/painters/[id]/**`: approve, conditionally-approve, reject, suspend, activate, payout, iban.
- `src/app/api/admin/painter-payouts/**` (veya admin/payouts'a boyacı sekmesi): payout işleme.
- Admin sidebar: "Boyacılar" nav girişi (`pending_approval` sayaç rozeti) — üreticiler grubunda.

## 7. Add-on: müşteri seçimi + fiyat
- Checkout/sipariş oluşturmada order-level "Profesyonel boyama +₺X" seçeneği (checkbox). Seçilince `needsPainting=true`, `paintingPriceKurus=PROFESSIONAL_PAINTING_PRICE_KURUS`, `amountKurus`'a eklenir (upsell bileşeni gibi). `src/app/api/orders/route.ts` amount hesabına entegre.
- Takip sayfasında müşteriye "Profesyonel boyama dahil" + `painting` durumu gösterimi.

## 8. Bildirim + e-posta
- `painter-notifications.ts` (manufacturer-notifications aynası): boyacıya iş atandı, admin mesajı, onay/red, ödeme. `sendRawEmail`/`sendEmail` ile e-posta (boyacı welcome/approved/rejected + "yeni iş" + admin'e "boyama bekleyen sipariş").

## 9. Migration (reversible — global kural)
- schema.ts düzenle → `npm run db:generate -- --name painters` → 0029. Ancak `ALTER TYPE order_status ADD VALUE` içerir; migrate txn dışı çalışır (drizzle-kit migrate her statement'ı ayrı çalıştırır — OK). Hand-written `.down.sql`: yeni tabloları/kolonları/enumları düşür (idempotent, journal'a eklenmez; enum value geri alınamaz → down notu). Round-trip throwaway DB'de doğrula.

## 10. i18n
- tr+en'e `painter.*`, `admin.nav.painters`, order status `painting` label, add-on copy. en.ts tip kaynağı → ikisi senkron.

## 11. v1 kapsam sınırı (net)
Çekirdek partner yaşam döngüsü tam aynalanır. **İleri aşamaya bırakılan** (isterse eklenir): boyacı-tarafı QC foto onay kapısı (v1: boyacı "boyandı" işaretler + kargolar), boyacı↔admin mesajlaşma thread'i (v1: bildirim), otomatik-strike-suspend politikası (strikeCount kolonu var, otomasyon yok), boyacı SSE realtime (v1: sayfa yenileme/bildirim).

## 12. Uygulama fazları
1. **Veri modeli + migration** (enums, painters, painterEarnings, painterPayouts, painterActions, painterNotifications, order kolonları, orderStatus 'painting', config fiyat).
2. **Auth + env** (painter-auth.ts, env PAINTER_JWT_SECRET + JWT_CLAIMS, middleware gate).
3. **Boyacı paneli** (/painter: layout/sidebar/register/login/dashboard/jobs/profile/notifications + /api/painter).
4. **Boyacı admin** (/admin/painters + /api/admin/painters + sidebar + payout).
5. **Sipariş entegrasyonu** (add-on seçimi+fiyat, üretici "boyacıya gönder", boyacı accept/paint/ship, hak ediş split, tracking 'painting').
6. **i18n + bildirim + e-posta + doğrulama** (typecheck/lint/migration round-trip/tarayıcı E2E + adversarial audit).

## 13. Doğrulama
- `tsc --noEmit` + `eslint` temiz; migration round-trip; throwaway DB'de tarayıcı E2E (boyacı kayıt→admin onay→üretici gönder→boyacı boya/kargo→hak ediş); çok-ajanlı adversarial audit. Kullanıcının dev DB'sine dokunma.
