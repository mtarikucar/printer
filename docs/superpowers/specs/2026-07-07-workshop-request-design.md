# Atölye Talebi (Workshop Request) — Tasarım Dokümanı

**Tarih:** 2026-07-07
**Durum:** Onaylı (kullanıcı detayları delege etti — "detayları sen belirle, kapsamlı olsun, admin tarafını da tamamla, durma")

## 1. Amaç ve kapsam

Mekân sahipleri / kurumlar (kafe, restoran, okul, kreş, kurumsal ofis, etkinlik salonu, doğum günü, ev vb.), **kendi mekânlarında Figurünica atölyesi** (fotoğraftan figür / boyama & yaratıcı atölye etkinliği) düzenlenmesi için talep oluşturur. Talep sistemde kayda geçer, admin panelinden yönetilir (durum yaşam döngüsü + e-posta bildirimleri).

Bu, sipariş/ödeme akışına bağlı OLMAYAN, bağımsız bir **lead/talep** modülüdür. Referans alınan en yakın örnekler: `disputes` (statülü admin işleme tablosu) ve `manufacturer/register` (çok alanlı public form → zod → rate-limit → insert → durum).

### Kapsam dışı (YAGNI)
- Ödeme/checkout entegrasyonu yok (atölye ücreti admin tarafından teklif olarak iletilir, tahsilat manuel/harici).
- Müşteri self-servis takip sayfası yok (referans no + e-posta yeterli; admin yönetir).
- Takvim/otomatik planlama entegrasyonu yok (admin `scheduledAt` alanını elle set eder).

## 2. Mimari genel bakış

```
Public form (/atolye)                Admin panel (/admin/workshop-requests)
  ├─ page.tsx (RSC shell + SiteHeader)   ├─ page.tsx (RSC list, force-dynamic, db.query)
  └─ workshop-form.tsx ("use client")    ├─ client.tsx (tablo + durum filtreleri + satır aksiyonları)
        │ POST /api/workshop-requests     ├─ [id]/page.tsx (RSC detay)
        ▼                                 └─ [id]/client.tsx (detay + aksiyon formu)
  /api/workshop-requests/route.ts               │ POST /api/admin/workshop-requests/[id]/update
   ip→rateLimit→turnstile→zod→insert            ▼
   →referans üret→e-posta(admin+talep sahibi)   requireAdmin→zod→atomik durum geçişi
                                                 →adminEmail/updatedAt/scheduledAt stamp
                                                 →talep sahibine durum e-postası (non-fatal)

Ortak katman:
  src/lib/workshop/constants.ts   → saf sabitler + TR etiketler (client+server güvenli)
  src/lib/services/workshop-notify.ts → e-posta kompozisyonu (server-only)
  src/lib/services/email.ts       → + sendRawEmail({to,subject,html,replyTo}) (yeni, jenerik)
  src/lib/db/schema.ts            → + workshopRequests tablosu + workshopRequestStatusEnum + relations
  drizzle/0028_workshop_requests.sql (+ .down.sql, elle)
```

## 3. Veri modeli

### Enum
```ts
workshopRequestStatusEnum = pgEnum("workshop_request_status",
  ["new", "reviewing", "scheduled", "completed", "rejected", "cancelled"])
```
İlk değer `new` = varsayılan.

### Tablo `workshop_requests`
| kolon | tip | not |
|---|---|---|
| id | uuid pk defaultRandom | |
| reference | text notNull unique | insan-dostu ref, örn. `WS-3F7K2Q` (destek + e-posta) |
| userId | uuid → users.id (nullable) | giriş yapmışsa iliştir |
| contactName | text notNull | |
| contactEmail | text notNull | küçük harfe normalize |
| contactPhone | text notNull | E164 |
| organizationName | text (nullable) | kurum/işletme (varsa) |
| venueType | text notNull | doğrulanmış set (constants) |
| city | text notNull | il |
| district | text notNull | ilçe |
| addressLine | text notNull | açık adres |
| participantCount | integer notNull | katılımcı sayısı |
| ageGroup | text notNull | doğrulanmış set |
| workshopType | text notNull | doğrulanmış set |
| preferredDate | text (nullable) | YYYY-MM-DD veya boş |
| alternativeDate | text (nullable) | |
| budgetRange | text (nullable) | |
| message | text (nullable) | ek notlar |
| howHeard | text (nullable) | nereden duydunuz |
| status | enum notNull default 'new' | |
| adminNotes | text (nullable) | iç not |
| rejectionReason | text (nullable) | red gerekçesi (e-postaya girer) |
| quotedPriceKurus | integer (nullable) | teklif tutarı (kuruş) |
| scheduledAt | timestamp (nullable) | planlanan tarih |
| adminEmail | text (nullable) | son işlem yapan admin |
| source | text notNull default 'web' | gelecekte whatsapp vb. |
| createdAt | timestamp notNull defaultNow | |
| updatedAt | timestamp notNull defaultNow | serviste elle bump |

İndeksler: `workshop_requests_status_idx (status, createdAt)`, `workshop_requests_user_idx (userId, createdAt)`, `reference` unique. Relations: `user: one(users)`.

**Neden `text` + zod (enum yerine) venueType/ageGroup/workshopType için:** bunlar ürün-tanımlı, değişmeye açık setler; repo konvansiyonu "akışkan setler için text, stabil yaşam döngüleri için pgEnum". `status` stabil → gerçek pgEnum.

## 4. Ortak sabitler — `src/lib/workshop/constants.ts` (saf, importu güvenli)
- `WORKSHOP_VENUE_TYPES`: `[{value,label}]` — cafe, restaurant, school, kindergarten, corporate, event_hall, home, other
- `WORKSHOP_AGE_GROUPS`: kids (4-12), teens (13-17), adults (18+), mixed
- `WORKSHOP_TYPES`: birthday, corporate, school, private_group, other
- `WORKSHOP_STATUSES`: value+label+badge sınıfı (admin)
- yardımcılar: `venueTypeLabel(v)`, `ageGroupLabel`, `workshopTypeLabel`, `workshopStatusMeta`
- `WORKSHOP_VENUE_TYPE_VALUES` vb. `readonly string[]` (zod `.refine`/`z.enum` için)

## 5. Public akış — `/atolye`
- **page.tsx** (RSC): `getLocale`+`getDictionary`, `<SiteHeader/>`, başlık/alt başlık, açıklama (ne sunuyoruz), sonra `<WorkshopForm/>`. `generateMetadata` ile SEO başlığı.
- **workshop-form.tsx** ("use client"): manufacturer/register desenini birebir izler.
  - Alanlar: ad, e-posta, `PhoneInput`, kurum(ops), mekân türü(select), il(select PROVINCES)→ilçe(select DISTRICTS), açık adres(textarea), katılımcı sayısı(number), yaş grubu(select), etkinlik türü(select), tercih tarih(`<input type=date>`), alternatif tarih(ops), bütçe(ops), mesaj(textarea ops), nereden duydunuz(ops), **KVKK onayı(checkbox, zorunlu)**.
  - `@/components/ui` (Button/Input/Select/Textarea/FormField/Card) + `inputCls` deseni; TR metinler inline (register deseni gibi).
  - `<Turnstile ref>`; submit’te `getToken()`; hata banner’ı; loading buton.
  - Başarıda: `submitted` state → referans no ile teşekkür kartı (ayrı sayfa yok).
- **API** `POST /api/workshop-requests`: `extractClientIp` → `rateLimitAsync("workshop-request:"+ip, 5, 3600_000)` → `verifyTurnstileToken` (403) → `zod.parse` → il/ilçe/set doğrulama → `reference` üret → `db.insert().returning()` (giriş varsa `userId`) → `sendWorkshopRequestReceivedEmails` (admin alarm + talep sahibi onay, non-fatal) → `NextResponse.json({success,reference})`. ZodError→400, diğer→500.

## 6. Admin akışı — `/admin/workshop-requests`
- **page.tsx** (RSC, `force-dynamic`): tüm talepleri `db.query.workshopRequests.findMany` (desc createdAt, limit 200), Date→ISO serialize, `<WorkshopRequestsClient/>`. (Layout zaten admin gate’li — ek guard gerekmez.)
- **client.tsx** ("use client"): durum filtre sekmeleri (tümü/new/reviewing/scheduled/completed/rejected/cancelled + sayaç), `bg-white rounded-xl border` tablo, `STATUS_BADGE` inline map, her satır `/admin/workshop-requests/[id]` detayına link. Yeni talepler vurgulanır.
- **[id]/page.tsx** (RSC): `findFirst` + `notFound()`, serialize, `<WorkshopRequestDetailClient/>`.
- **[id]/client.tsx**: tüm alanları okunur gösterir; admin aksiyon paneli — adminNotes textarea, quotedPriceKurus input, scheduledAt date input, rejectionReason; butonlar: İncelemeye al / Planla / Tamamlandı / Reddet / İptal / Notu kaydet. Her biri `POST .../update` çağırır, `router.refresh()`.
- **API** `POST /api/admin/workshop-requests/[id]/update`: `requireAdmin` → zod `{status?, adminNotes?, quotedPriceKurus?, scheduledAt?, rejectionReason?}` → sağlanan alanları güncelle; `status` verildiyse atomik geçiş (`.where(eq(id)).returning()`), `adminEmail`+`updatedAt` stamp, `scheduled` ise `scheduledAt` set; `scheduled/rejected/completed` geçişinde talep sahibine `sendWorkshopStatusEmail` (non-fatal). Başarı `{success:true}`.
- **Sidebar**: `admin.nav.group.orders` grubuna `/admin/workshop-requests` link (`badge: workshopPendingCount`). Layout’a `new` sayacı sorgusu + prop; sidebar props/type güncellenir.

## 7. E-posta — `src/lib/services/email.ts` + `workshop-notify.ts`
- `email.ts`: yeni jenerik `sendRawEmail({to,subject,html,replyTo?})` — mevcut `transporter`+`FROM_EMAIL`’i yeniden kullanır (sipariş-merkezli `sendEmail` union’ını kirletmez).
- `workshop-notify.ts` (server-only):
  - `sendWorkshopRequestReceivedEmails(req)` → (a) admin’e (`ADMIN_EMAIL` || `system@figurunica.com`) tüm detay + `replyTo: contactEmail`; (b) talep sahibine "Talebiniz alındı" + referans.
  - `sendWorkshopStatusEmail(req, status)` → scheduled (tarih+teklif), rejected (gerekçe), completed (teşekkür) şablonları. Hepsi `escHtml`’li, TR, Figurünica imzalı.

## 8. Entry points (keşfedilebilirlik)
- Footer (`FigFooter`, sections.tsx): "Mekanınızda Atölye" linki → `/atolye` (yeni dict key `landing.fig.footer.workshopLink`, en+tr).
- `/contact` sayfasına atölye CTA kartı → `/atolye`.

## 9. i18n
- Public form metinleri: inline TR (register deseni; Türkçe-only). Dict key şişkinliğinden kaçınılır.
- Eklenecek dict key’ler (en.ts + tr.ts, senkron — `en.ts` tip kaynağı): `landing.fig.footer.workshopLink`, `workshop.meta.title`, ve `contact` CTA için 2-3 key. Admin etiketleri inline TR (upload-quotes deseni).

## 10. Migration (reversible — global kural)
- `schema.ts` düzenle → `npm run db:generate -- --name workshop_requests` → `drizzle/0028_workshop_requests.sql` + snapshot + journal (commit).
- Elle `drizzle/0028_workshop_requests.down.sql`: `DROP TABLE IF EXISTS "workshop_requests" CASCADE; DROP TYPE IF EXISTS "public"."workshop_request_status";` (idempotent, journal’a EKLENMEZ, açıklama bloklu — 0027 deseni).
- Round-trip doğrula (up→down→up) throwaway/lokal DB’de; kullanıcının çalışan dev DB’sine dokunma.

## 11. Doğrulama
- `npm run typecheck` (de facto gate) temiz.
- `npm run lint` temiz.
- Public form + admin akışı Playwright/manuel ile smoke (mümkünse).
- Adversarial code review (ultracode) — bug + reuse taraması.

## 12. Dosya envanteri
**Yeni:**
- `src/lib/workshop/constants.ts`
- `src/lib/services/workshop-notify.ts`
- `src/app/atolye/page.tsx`, `src/app/atolye/workshop-form.tsx`
- `src/app/api/workshop-requests/route.ts`
- `src/app/admin/workshop-requests/page.tsx`, `client.tsx`, `[id]/page.tsx`, `[id]/client.tsx`
- `src/app/api/admin/workshop-requests/[id]/update/route.ts`
- `drizzle/0028_workshop_requests.sql`, `drizzle/0028_workshop_requests.down.sql`, `drizzle/meta/0028_snapshot.json`, `_journal.json`(update)

**Düzenlenen:**
- `src/lib/db/schema.ts` (+tablo/enum/relations)
- `src/lib/services/email.ts` (+sendRawEmail)
- `src/app/admin/sidebar.tsx` (+nav link +prop), `src/app/admin/layout.tsx` (+sayaç +prop)
- `src/components/figurunica/sections.tsx` (footer link)
- `src/app/contact/page.tsx` (CTA)
- `src/lib/i18n/dictionaries/en.ts` + `tr.ts` (yeni key’ler)
