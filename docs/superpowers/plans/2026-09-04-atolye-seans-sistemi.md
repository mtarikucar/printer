# Atölye Seans Sistemi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bir kafe/mekan başvurusundan başlayıp, o mekanda açılan bir atölye seansına public linkten fotoğraf+ödeme toplayan, siparişleri tek parti hâlinde ürettiren ve seanstan bir gün önce hepsini tek seferde mekana teslim ettiren uçtan uca akışı kurmak.

**Architecture:** Mevcut `workshopRequests` lead formu intake olarak korunur; onaylı talep kalıcı bir `workshopVenues` kaydına dönüşür. Her mekana `workshopSessions` (gün+saat+kontenjan+public token) açılır. Katılımcı public linkten fotoğraf yükleyip öder; bu bir `orderDrafts` yaratır, ödeme onaylanınca mevcut `promoteDraftToOrder` akışıyla siparişe döner. Sipariş adresi **mekanın adresi** olduğu için toplu teslimat ayrı bir mekanizma gerektirmez. Üretici seans açılışında ön rezerve edilir; link kapanınca komisyon oranı parti büyüklüğüne göre donar ve tüm parti o üreticiye düşer.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Drizzle ORM + PostgreSQL 16, BullMQ + Redis, zod, Tailwind 4, PayTR, nodemailer.

**Spec:** `docs/superpowers/specs/2026-09-04-atolye-seans-sistemi-design.md`

## Global Constraints

- **Para birimi kuruştur.** Her tutar `integer` kolonda kuruş olarak tutulur. Tüm money kolonları pg `int4`; tavan `MAX_AMOUNT_KURUS = 2_000_000_00`.
- **Atölye figürü fiyatı: `135000` kuruş (₺1.350).** Boyanmamış; boyama seansın kendisidir.
- **Komisyon merdiveni** (`commissionRateBps` = PLATFORMUN payı): 1–2 sipariş → 4000, 3–5 → 4500, 6–10 → 5000, 11–15 → 5500, 16+ → 6000. Merdiven **gerçek ödenmiş sipariş adedine** bağlıdır, kontenjana değil.
- **Kalem invariantı** (2026-09-01'de canlıya alındı): her siparişte `productionBaseKurus + paintingPriceKurus === amountKurus`. Atölye siparişinde `paintingPriceKurus = 0`, `productionBaseKurus = amountKurus`.
- **Saf modüller `server-only` İMPORT ETMEZ.** `src/lib/config/**` BullMQ worker'larından da import edilir; bir `server-only` importu standalone Node worker'ını crash-loop'a sokar.
- **Input genişlik tuzağı:** `.input-base{width:100%}` paylaşılan `<Input>`/`<Select>` üzerinde Tailwind `w-*`/`flex-1`'i ezer. Genişlik **wrapper/grid'e** verilir, asla input'un kendisine.
- **Migration'lar up + down çifti olarak yazılır.** Down idempotent ve dar kapsamlıdır. Gidiş-dönüş (up → down → up) uygulanmadan görev bitmiş sayılmaz.
- **Commit mesajlarına AI/Claude izi EKLENMEZ.** Düz conventional-commit.
- **Dil Türkçe.** Kullanıcıya görünen tüm metinler Türkçe; `src/app/atolye/**` konvansiyonu gereği bu yüzeyde hardcoded Türkçe kabul edilir (i18n'e sokulmaz).
- **Doğrulama kapısı:** `npm run typecheck` (0 hata) · `npm run lint` (0 error) · `npm run test:unit` (tümü geçer). Yerelde `npm run build` Google Fonts'a çıkamadığı için düşer — bu ortam kısıtı, CI'da geçer.

---

## File Structure

**Yeni saf modül (DB yok, server-only yok):**
- `src/lib/config/workshop.ts` — komisyon merdiveni, tarih türetme, seans/katılımcı durum sabitleri. Hem sunucu hem client hem worker bunu import eder.

**Yeni servisler (DB'ye dokunur):**
- `src/lib/services/workshop-venue.ts` — talep→mekan dönüşümü, mekan CRUD
- `src/lib/services/workshop-session.ts` — seans yaratma, token mint, koltuk rezervasyonu, kapanış+parti atama, risk hesabı
- `src/lib/services/workshop-participant.ts` — katılımcı + taslak yaratma, koltuk serbest bırakma

**Yeni validator:**
- `src/lib/validators/workshop.ts` — mekan, seans ve katılım zod şemaları

**Değişen çekirdek:**
- `src/lib/db/schema.ts` — 3 tablo + 1 enum + `orders.workshopSessionId` + `carrier` enum'a `elden`
- `src/lib/config/prices.ts` — `WORKSHOP_FIGURE_PRICE_KURUS`, `ItemKind`'a `workshop_figure`
- `src/lib/validators/order.ts` — `FINISHES_BY_KIND`'a `workshop_figure`, kind-tabanlı yüzey yardımcıları
- `src/lib/services/order-draft.ts` — promote sırasında atölye alanlarının taşınması
- `src/lib/queue/workers/payment-deadline.worker.ts` — taslak sürerse koltuğu bırak
- `src/lib/content/manufacturer-onboarding.ts` + `src/lib/config/contract-versions.ts` — merdiven maddesi, sürüm 3.1

**Yeni API:**
- `src/app/api/admin/workshop-requests/[id]/convert-to-venue/route.ts`
- `src/app/api/admin/workshops/venues/route.ts` · `venues/[id]/route.ts`
- `src/app/api/admin/workshops/sessions/route.ts` · `sessions/[id]/route.ts` · `sessions/[id]/ship/route.ts` · `sessions/[id]/deliver/route.ts`
- `src/app/api/workshop/join/[token]/route.ts` (public)
- `src/app/api/manufacturer/workshop-sessions/[id]/commit/route.ts`

**Yeni sayfalar:**
- `src/app/admin/workshops/page.tsx` + `workshops-client.tsx` (mekan listesi)
- `src/app/admin/workshops/[venueId]/page.tsx` + `venue-client.tsx` (mekanın seansları)
- `src/app/admin/workshops/sessions/[id]/page.tsx` + `session-client.tsx` (katılımcılar, model sayacı, toplu sevk)
- `src/app/atolye/katil/[token]/page.tsx` + `join-client.tsx` (public katılım)

**Yeni worker:**
- `src/lib/queue/workers/workshop-close.worker.ts` — kapanış zamanı geçen seansları kapat, oranı dondur, partiyi ata

**Yeni test:**
- `scripts/test-workshop.ts` — `npm run test:unit` zincirine eklenir

---

### Task 1: Saf çekirdek — komisyon merdiveni ve tarih türetme

Bu görev tek başına test edilebilir saf mantığı kurar; sonraki her görev bunu import eder.

**Files:**
- Create: `src/lib/config/workshop.ts`
- Create: `scripts/test-workshop.ts`
- Modify: `package.json` (test:unit zinciri + tekil script)

**Interfaces:**
- Produces:
  - `WORKSHOP_FIGURE_PRICE_KURUS: number` (135000)
  - `WORKSHOP_COMMISSION_TIERS: ReadonlyArray<{ minOrders: number; commissionRateBps: number }>`
  - `workshopCommissionRateBps(paidOrderCount: number): number`
  - `WORKSHOP_JOIN_CLOSES_DAYS_BEFORE: number` (5), `WORKSHOP_DELIVER_DAYS_BEFORE: number` (1)
  - `deriveSessionDates(startsAt: Date): { joinClosesAt: Date; deliverBy: Date }`
  - `WORKSHOP_SESSION_STATUSES: readonly string[]`, `WorkshopSessionStatus`
  - `WORKSHOP_PARTICIPANT_STATUSES: readonly string[]`, `WorkshopParticipantStatus`

- [ ] **Step 1: Testi yaz (kırmızı)**

`scripts/test-workshop.ts`:

```ts
import assert from "node:assert/strict";
import {
  WORKSHOP_FIGURE_PRICE_KURUS,
  WORKSHOP_COMMISSION_TIERS,
  workshopCommissionRateBps,
  deriveSessionDates,
  WORKSHOP_JOIN_CLOSES_DAYS_BEFORE,
  WORKSHOP_DELIVER_DAYS_BEFORE,
} from "../src/lib/config/workshop";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

// ─── Fiyat ──────────────────────────────────────────────────────────────────

test("atölye figürü ₺1.350", () => {
  assert.equal(WORKSHOP_FIGURE_PRICE_KURUS, 135000);
});

// ─── Komisyon merdiveni ─────────────────────────────────────────────────────
// commissionRateBps PLATFORMUN payıdır; üreticinin net payı 10000 − bps.

test("merdiven kademe sınırları", () => {
  const expected: Array<[number, number]> = [
    [1, 4000], [2, 4000],
    [3, 4500], [5, 4500],
    [6, 5000], [10, 5000],
    [11, 5500], [15, 5500],
    [16, 6000], [17, 6000], [100, 6000],
  ];
  for (const [n, bps] of expected) {
    assert.equal(
      workshopCommissionRateBps(n),
      bps,
      `${n} sipariş için ${bps} bekleniyordu, ${workshopCommissionRateBps(n)} geldi`
    );
  }
});

test("üretici payı sipariş arttıkça ASLA artmaz (monotonluk)", () => {
  let prev = -1;
  for (let n = 1; n <= 200; n++) {
    const bps = workshopCommissionRateBps(n);
    assert.ok(bps >= prev, `n=${n}: komisyon geriledi (${prev} → ${bps})`);
    prev = bps;
  }
});

test("oran her zaman [4000, 6000] aralığında", () => {
  for (const n of [0, 1, 7, 50, 1000, -3]) {
    const bps = workshopCommissionRateBps(n);
    assert.ok(bps >= 4000 && bps <= 6000, `n=${n} → ${bps}`);
  }
});

test("sıfır ve negatif sipariş en düşük komisyona düşer", () => {
  // Parti yoksa merdivenin ilk basamağı geçerlidir; üreticiyi cezalandırmaz.
  assert.equal(workshopCommissionRateBps(0), 4000);
  assert.equal(workshopCommissionRateBps(-1), 4000);
});

test("merdiven tanımı artan sırada ve boşluksuz", () => {
  let prevMin = 0;
  for (const t of WORKSHOP_COMMISSION_TIERS) {
    assert.ok(t.minOrders > prevMin, "minOrders artan olmalı");
    prevMin = t.minOrders;
  }
  assert.equal(WORKSHOP_COMMISSION_TIERS[0].minOrders, 1);
});

// ─── Tarih türetme ──────────────────────────────────────────────────────────

test("kapanış seanstan 5 gün, teslim 1 gün önce", () => {
  assert.equal(WORKSHOP_JOIN_CLOSES_DAYS_BEFORE, 5);
  assert.equal(WORKSHOP_DELIVER_DAYS_BEFORE, 1);
  const startsAt = new Date("2026-10-20T18:00:00.000Z");
  const d = deriveSessionDates(startsAt);
  assert.equal(d.joinClosesAt.toISOString(), "2026-10-15T18:00:00.000Z");
  assert.equal(d.deliverBy.toISOString(), "2026-10-19T18:00:00.000Z");
});

test("tarih türetme girdiyi değiştirmez", () => {
  const startsAt = new Date("2026-10-20T18:00:00.000Z");
  const before = startsAt.toISOString();
  deriveSessionDates(startsAt);
  assert.equal(startsAt.toISOString(), before, "startsAt mutasyona uğradı");
});

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}
console.log(`\n${passed}/${cases.length} passed`);
```

- [ ] **Step 2: Testi çalıştır, DÜŞTÜĞÜNÜ gör**

```bash
npx tsx scripts/test-workshop.ts
```
Beklenen: `Cannot find module '../src/lib/config/workshop'` ile hata.

- [ ] **Step 3: Saf modülü yaz**

`src/lib/config/workshop.ts`:

```ts
/**
 * Atölye seansları — saf çekirdek.
 *
 * DB yok, `server-only` yok: bu modülü admin arayüzü, public katılım sayfası,
 * API route'ları ve BullMQ worker'ları birlikte import eder. Bir `server-only`
 * importu standalone Node worker'ını crash-loop'a sokar (bkz. order-draft
 * zinciri).
 */

/**
 * Boyanmamış kişiye özel atölye figürü. Boyama işi seansın KENDİSİDİR ve
 * mekanda yapılır; bu yüzden boyacı partneri bu akışa hiç girmez ve siparişin
 * boyama kalemi sıfırdır.
 */
export const WORKSHOP_FIGURE_PRICE_KURUS = 135000;

/** Katılım linki seanstan kaç gün önce kapanır. */
export const WORKSHOP_JOIN_CLOSES_DAYS_BEFORE = 5;

/** Parti mekana seanstan kaç gün önce teslim edilir. */
export const WORKSHOP_DELIVER_DAYS_BEFORE = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Üretici payı hacimle düşer: 20 figürü tek plakada basmak, birini basmaktan
 * birim başına çok daha ucuzdur.
 *
 * Merdiven KONTENJANA DEĞİL, gerçekleşen ödenmiş sipariş adedine bağlıdır.
 * Kapasiteye bağlansaydı 50 kişilik seanstaki 10 sipariş ile 20 kişilik
 * seanstaki 10 sipariş — üretici için aynı iş — farklı ücret alırdı.
 *
 * `commissionRateBps` PLATFORMUN payıdır; üreticinin net payı `10000 - bps`.
 * Doğrusal formül yerine merdiven, çünkü sözleşmede tek cümleyle anlatılabiliyor
 * ve üretici kabul etmeden önce net payını kesin görebiliyor. Aynı zihinsel
 * model `productPriceTiers` (minQuantity → fiyat) ile tutarlı.
 */
export const WORKSHOP_COMMISSION_TIERS: ReadonlyArray<{
  minOrders: number;
  commissionRateBps: number;
}> = [
  { minOrders: 1, commissionRateBps: 4000 }, // üretici %60
  { minOrders: 3, commissionRateBps: 4500 }, // %55
  { minOrders: 6, commissionRateBps: 5000 }, // %50
  { minOrders: 11, commissionRateBps: 5500 }, // %45
  { minOrders: 16, commissionRateBps: 6000 }, // %40
] as const;

/**
 * Bir seansın ödenmiş sipariş adedine düşen platform komisyonu (bps).
 * Sipariş yoksa merdivenin ilk basamağı döner — boş parti üreticiyi cezalandırmaz.
 */
export function workshopCommissionRateBps(paidOrderCount: number): number {
  const n = Math.max(0, Math.trunc(paidOrderCount) || 0);
  let rate = WORKSHOP_COMMISSION_TIERS[0].commissionRateBps;
  for (const tier of WORKSHOP_COMMISSION_TIERS) {
    if (n >= tier.minOrders) rate = tier.commissionRateBps;
    else break;
  }
  return rate;
}

/**
 * Seansın başlangıcından katılım kapanışı ve teslim tarihini türetir.
 * Sonuç DB'ye YAZILIR, her okumada yeniden türetilmez: admin tek bir seansta
 * kaydırabilmeli ve geçmiş seansların kuralı sonradan değişen bir sabitle
 * bozulmamalı.
 */
export function deriveSessionDates(startsAt: Date): {
  joinClosesAt: Date;
  deliverBy: Date;
} {
  const t = startsAt.getTime();
  return {
    joinClosesAt: new Date(t - WORKSHOP_JOIN_CLOSES_DAYS_BEFORE * DAY_MS),
    deliverBy: new Date(t - WORKSHOP_DELIVER_DAYS_BEFORE * DAY_MS),
  };
}

export const WORKSHOP_SESSION_STATUSES = [
  "draft",
  "open",
  "closed",
  "in_production",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
] as const;
export type WorkshopSessionStatus = (typeof WORKSHOP_SESSION_STATUSES)[number];

export const WORKSHOP_SESSION_STATUS_LABELS: Record<WorkshopSessionStatus, string> = {
  draft: "Taslak",
  open: "Katılıma açık",
  closed: "Katılım kapandı",
  in_production: "Üretimde",
  shipped: "Mekana yolda",
  delivered: "Mekana teslim edildi",
  completed: "Tamamlandı",
  cancelled: "İptal edildi",
};

export const WORKSHOP_PARTICIPANT_STATUSES = [
  "pending_payment",
  "paid",
  "model_ready",
  "in_production",
  "delivered",
  "cancelled",
] as const;
export type WorkshopParticipantStatus =
  (typeof WORKSHOP_PARTICIPANT_STATUSES)[number];

export const WORKSHOP_PARTICIPANT_STATUS_LABELS: Record<
  WorkshopParticipantStatus,
  string
> = {
  pending_payment: "Ödeme bekleniyor",
  paid: "Ödendi",
  model_ready: "Modeli hazır",
  in_production: "Üretimde",
  delivered: "Teslim edildi",
  cancelled: "İptal",
};
```

- [ ] **Step 4: Testi çalıştır, GEÇTİĞİNİ gör**

```bash
npx tsx scripts/test-workshop.ts
```
Beklenen: `8/8 passed`

- [ ] **Step 5: test:unit zincirine kaydet**

`package.json` içinde iki değişiklik:
1. `"test:cost-lines": "tsx scripts/test-cost-lines.ts",` satırının hemen ardına ekle:
   `"test:workshop": "tsx scripts/test-workshop.ts",`
2. `test:unit` zincirinde `npx tsx scripts/test-cost-lines.ts &&` ifadesini
   `npx tsx scripts/test-cost-lines.ts && npx tsx scripts/test-workshop.ts &&` ile değiştir.

- [ ] **Step 6: Tam kapıyı çalıştır**

```bash
npm run typecheck && npm run lint 2>&1 | grep -E "✖" && npm run test:unit >/dev/null && echo "UNIT PASS"
```
Beklenen: typecheck sessiz, lint `0 errors`, `UNIT PASS`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/config/workshop.ts scripts/test-workshop.ts package.json
git commit -m "feat(atölye): komisyon merdiveni ve seans tarih türetmesi"
```

---

### Task 2: Şema ve migration 0051

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0051_workshop_sessions.sql`
- Create: `drizzle/0051_workshop_sessions.down.sql`
- Modify: `drizzle/meta/_journal.json` (tag yeniden adlandırma)

**Interfaces:**
- Consumes: Task 1'in `WORKSHOP_SESSION_STATUSES`
- Produces: `workshopVenues`, `workshopSessions`, `workshopParticipants` tabloları; `orders.workshopSessionId`; `carrier` enum'unda `elden`

- [ ] **Step 1: Enum ve tabloları schema.ts'e ekle**

`carrierEnum`'a (schema.ts:266) `elden` ekle:

```ts
export const carrierEnum = pgEnum("carrier", [
  "yurtici",
  "aras",
  "mng",
  "ptt",
  "surat",
  "other",
  // Atölye partileri elden teslim edilebilir (üretici mekana getirir ya da
  // mekan seansta dağıtır). Bu değer üretici→boyacı bacağında zaten
  // kullanılıyordu (orders.painterHandoffCarrier, düz text); müşteri bacağına
  // taşınıyor ki kargosuz teslimat sahte takip numarası gerektirmesin.
  "elden",
]);
```

`workshopRequests` tanımının ardına (schema.ts:1137 civarı) ekle:

```ts
export const workshopSessionStatusEnum = pgEnum("workshop_session_status", [
  "draft",
  "open",
  "closed",
  "in_production",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
]);

/**
 * Kalıcı atölye mekanı. `workshopRequests` bir LEAD'dir (tek seferlik talep);
 * bu ise defalarca seans açılabilen bir partner kaydıdır. Onaylı bir talepten
 * doğar (requestId) ya da admin doğrudan ekler (requestId NULL).
 */
export const workshopVenues = pgTable(
  "workshop_venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").references(() => workshopRequests.id),
    name: text("name").notNull(),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone").notNull(), // E.164
    // Sipariş adresiyle AYNI tipte (orders.shippingAddress) — seans siparişlerine
    // birebir kopyalanır, dönüşüm gerekmez. Posta kodu ZORUNLU: sipariş adresi
    // /^\d{5}$/ şartı koyuyor, başvuru formu ise posta kodu toplamıyor.
    address: jsonb("address").notNull().$type<TurkishAddress>(),
    status: text("status").notNull().default("active"), // active | paused | archived
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index("workshop_venues_status_idx").on(t.status, t.createdAt),
  })
);

/**
 * Bir mekandaki bir gün+saat. `joinToken` public katılım linkinin adresidir.
 *
 * `joinClosesAt` / `deliverBy` HESAPLANIP SAKLANIR (config/workshop.ts'ten
 * türetilir), her okumada yeniden hesaplanmaz: admin tek bir seansta
 * kaydırabilmeli ve geçmiş seansların kuralı sonradan değişen bir sabitle
 * bozulmamalı.
 */
export const workshopSessions = pgTable(
  "workshop_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => workshopVenues.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(120),
    capacity: integer("capacity").notNull(),
    // Koşullu UPDATE ile artar (booked_count < capacity), oku-sonra-yaz DEĞİL:
    // iki kişi son koltuğu aynı anda kapayabilir.
    bookedCount: integer("booked_count").notNull().default(0),
    joinToken: text("join_token").notNull().unique(),
    joinClosesAt: timestamp("join_closes_at").notNull(),
    deliverBy: timestamp("deliver_by").notNull(),
    pricePerSeatKurus: integer("price_per_seat_kurus").notNull(),
    // Seans AÇILIŞINDA ön rezerve edilir; link kapanınca soğuk atama + 24 saat
    // kabul beklemesi olmadan parti bu üreticiye düşer. 5 günlük pencereyi
    // gerçekçi kılan şey budur.
    manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id),
    manufacturerCommittedAt: timestamp("manufacturer_committed_at"),
    // Kapanışta, parti büyüklüğüne göre donar (config/workshop.ts merdiveni) ve
    // seansın TÜM siparişlerine aynı değerle yazılır. Erken katılan %60, geç
    // katılan %40 almaz.
    commissionRateBps: integer("commission_rate_bps"),
    batchCarrier: carrierEnum("batch_carrier"),
    batchTrackingNumber: text("batch_tracking_number"),
    batchShippedAt: timestamp("batch_shipped_at"),
    batchDeliveredAt: timestamp("batch_delivered_at"),
    status: workshopSessionStatusEnum("status").notNull().default("draft"),
    adminNotes: text("admin_notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    byVenue: index("workshop_sessions_venue_idx").on(t.venueId, t.startsAt),
    byStatus: index("workshop_sessions_status_idx").on(t.status, t.joinClosesAt),
  })
);

/**
 * Public linkten katılan kişi. Ödeme öncesi yalnızca `draftId` doludur —
 * bu sistemde sipariş = ödenmiş sipariş demektir (promoteDraftToOrder
 * status:"paid" sabitler), ödenmemiş niyet orderDrafts'ta yaşar.
 */
export const workshopParticipants = pgTable(
  "workshop_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => workshopSessions.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id").references(() => orderDrafts.id),
    orderId: uuid("order_id").references(() => orders.id),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(), // E.164
    photoKey: text("photo_key").notNull(), // photos/<nanoid>.jpg
    // KVKK açık rıza + içerik hakları (fotoğraftaki kişi çocuksa velisinin
    // rızası dâhil). Doğum günü ve okul etkinlikleri çocuk fotoğrafı demektir.
    kvkkConsentAt: timestamp("kvkk_consent_at").notNull(),
    contentConsentAt: timestamp("content_consent_at").notNull(),
    status: text("status").notNull().default("pending_payment"),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    bySession: index("workshop_participants_session_idx").on(
      t.sessionId,
      t.createdAt
    ),
    byDraft: index("workshop_participants_draft_idx").on(t.draftId),
  })
);
```

`orders` tablosuna (`workshopSessionId`), `productionBaseKurus` kolonunun hemen ardına:

```ts
    // Atölye siparişi ise bağlı olduğu seans. NULL = normal sipariş, davranış
    // hiç değişmez. Parti sorguları, toplu sevk ve "bu bir atölye siparişi mi"
    // kararı bunun üstünden yürür.
    workshopSessionId: uuid("workshop_session_id").references(
      (): any => workshopSessions.id
    ),
```

> `(): any =>` ileri referans için gereklidir; `orders` tablosu `workshopSessions`'tan ÖNCE tanımlanıyor. Aynı desen `products` referansında zaten kullanılıyor (`schema.ts:28` civarı `productId`).

Relations bloklarını da ekle (`workshopRequestsRelations`'ın yanına):

```ts
export const workshopVenuesRelations = relations(workshopVenues, ({ one, many }) => ({
  request: one(workshopRequests, {
    fields: [workshopVenues.requestId],
    references: [workshopRequests.id],
  }),
  sessions: many(workshopSessions),
}));

export const workshopSessionsRelations = relations(
  workshopSessions,
  ({ one, many }) => ({
    venue: one(workshopVenues, {
      fields: [workshopSessions.venueId],
      references: [workshopVenues.id],
    }),
    manufacturer: one(manufacturers, {
      fields: [workshopSessions.manufacturerId],
      references: [manufacturers.id],
    }),
    participants: many(workshopParticipants),
  })
);

export const workshopParticipantsRelations = relations(
  workshopParticipants,
  ({ one }) => ({
    session: one(workshopSessions, {
      fields: [workshopParticipants.sessionId],
      references: [workshopSessions.id],
    }),
    order: one(orders, {
      fields: [workshopParticipants.orderId],
      references: [orders.id],
    }),
  })
);
```

- [ ] **Step 2: Migration üret**

```bash
npx drizzle-kit generate
```

Üretilen dosyanın adını not al (rastgele bir isim gelir, ör. `0051_curious_wasp.sql`).

- [ ] **Step 3: Migration'ı yeniden adlandır ve elle sertleştir**

```bash
mv drizzle/0051_*.sql drizzle/0051_workshop_sessions.sql
python3 - <<'PY'
import json
p='drizzle/meta/_journal.json'
j=json.load(open(p))
e=j['entries'][-1]
assert e['idx']==51, e
e['tag']='0051_workshop_sessions'
json.dump(j,open(p,'w'),indent=2)
print("journal tag ->", e['tag'])
PY
```

Sonra `drizzle/0051_workshop_sessions.sql` dosyasının BAŞINA şunu ekle ve tüm
`CREATE TABLE` / `CREATE INDEX` / `ADD COLUMN` ifadelerini `IF NOT EXISTS`
hâline getir, `ADD CONSTRAINT`leri `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
bloğuna sar (0050_cost_lines.sql'deki birebir desen):

```sql
-- 0051 — atölye seans sistemi.
--
-- Kalıcı mekan → tekrarlı seans → public linkten katılan katılımcı zinciri,
-- artı orders.workshop_session_id geri bağı ve carrier enum'una 'elden'.
--
-- ADD COLUMN (NULL, DEFAULT'suz) PG11+'ta tablo yeniden yazmaz; yine de kısa
-- süreli ACCESS EXCLUSIVE kilit ister. Canlıda `orders` sürekli okunuyor:
-- kilit hemen alınamazsa deploy'u dakikalarca bekletmek yerine hızlı başarısız
-- olsun.
SET lock_timeout = '5s';
--> statement-breakpoint
-- ALTER TYPE ... ADD VALUE PostgreSQL 12+'ta transaction içinde çalışır ve bu
-- migration o değeri AYNI transaction'da hiçbir yere yazmaz (yazsaydı hata
-- verirdi). Prod PG 16.12 — doğrulandı.
ALTER TYPE "carrier" ADD VALUE IF NOT EXISTS 'elden';
--> statement-breakpoint
```

- [ ] **Step 4: Down migration'ı yaz**

`drizzle/0051_workshop_sessions.down.sql`:

```sql
-- 0051 geri alma.
--
-- DİKKAT — `carrier` enum'undaki 'elden' değeri BİLEREK BIRAKILIR. PostgreSQL
-- bir enum'dan değer düşüremez; ayrıca o değeri yazmış sipariş satırları varsa
-- düşürmek veri kaybı olurdu. Zararsız bir artıktır.
--
-- Tablolar sırayla düşer: participants → sessions → venues (FK yönü).
-- Yalnızca up'ın eklediklerini kaldırır. Tekrar çalıştırılabilir (IF EXISTS).
SET lock_timeout = '5s';
ALTER TABLE "orders" DROP COLUMN IF EXISTS "workshop_session_id";
DROP TABLE IF EXISTS "workshop_participants";
DROP TABLE IF EXISTS "workshop_sessions";
DROP TABLE IF EXISTS "workshop_venues";
DROP TYPE IF EXISTS "workshop_session_status";
```

- [ ] **Step 5: Gidiş-dönüşü scratch şemada doğrula**

Kullanıcının dev DB'sini bozmadan, ayrı bir şemada:

```bash
set -a && . ./.env && set +a
S=/tmp/ws-rt
mkdir -p $S
docker exec postgres psql "$DATABASE_URL" -qc "DROP SCHEMA IF EXISTS ws_rt CASCADE; CREATE SCHEMA ws_rt;"
docker exec postgres psql "$DATABASE_URL" -qc "SET search_path TO ws_rt;
CREATE TABLE workshop_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE manufacturers (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE order_drafts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid());"
# public. → ws_rt. ve carrier ALTER'ı (public tipe dokunur) çıkarılır
sed 's/"public"\./"ws_rt"./g; /ALTER TYPE "carrier"/d; s/--> statement-breakpoint//g' \
  drizzle/0051_workshop_sessions.sql > $S/up.sql
sed 's/--> statement-breakpoint//g' drizzle/0051_workshop_sessions.down.sql > $S/down.sql
run(){ docker exec -i postgres psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "SET search_path TO ws_rt;" -f - ; }
probe(){ docker exec postgres psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='ws_rt' AND table_name LIKE 'workshop_%';"; }
echo "baseline: $(probe)"
cat $S/up.sql   | run 2>&1|grep -v NOTICE; echo "UP #1    : $(probe)"
cat $S/up.sql   | run 2>&1|grep -v NOTICE; echo "UP tekrar: $(probe)"
cat $S/down.sql | run 2>&1|grep -v NOTICE; echo "DOWN     : $(probe)"
cat $S/down.sql | run 2>&1|grep -v NOTICE; echo "DOWN tkr : $(probe)"
cat $S/up.sql   | run 2>&1|grep -v NOTICE; echo "UP #2    : $(probe)"
docker exec postgres psql "$DATABASE_URL" -qc "DROP SCHEMA IF EXISTS ws_rt CASCADE;" >/dev/null
```

Beklenen: `baseline: 1` (workshop_requests stub'ı), `UP #1: 4`, `UP tekrar: 4`, `DOWN: 1`, `DOWN tkr: 1`, `UP #2: 4`. Hiçbir adımda hata olmamalı.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck && npm run test:unit >/dev/null && echo OK
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(atölye): mekan, seans ve katılımcı tabloları (migration 0051)"
```

---

### Task 3: `workshop_figure` fiyat türü

Boyanmamış atölye figürü ayrı bir fiyat türü olmak ZORUNDA: `validators/order.ts:28`
`FIGURE_FINISHES = ["hand_painted"]` diyor ve `coerceFinishForStyle` figüre
yazılan `paintable_kit`'i `hand_painted`'e geri çeviriyor.

**Files:**
- Modify: `src/lib/config/prices.ts`
- Modify: `src/lib/validators/order.ts`
- Modify: `scripts/test-workshop.ts`

**Interfaces:**
- Consumes: Task 1'in `WORKSHOP_FIGURE_PRICE_KURUS`
- Produces: `ItemKind`'a `"workshop_figure"`; `allowedFinishesForKind(kind: string): string[]`; `coerceFinishForKind(kind: string, finish: unknown): string`

- [ ] **Step 1: Testleri yaz (kırmızı)**

`scripts/test-workshop.ts` içinde, runner döngüsünün ÜSTÜNE ekle (importları da genişlet):

```ts
import { itemPriceKurus } from "../src/lib/config/prices";
import {
  allowedFinishesForKind,
  coerceFinishForKind,
  coerceFinishForStyle,
} from "../src/lib/validators/order";

// ─── workshop_figure fiyat türü ─────────────────────────────────────────────

test("workshop_figure düz fiyatlıdır: boyut/malzeme/yüzey etkilemez", () => {
  const a = itemPriceKurus({ kind: "workshop_figure", material: "resin" });
  const b = itemPriceKurus({
    kind: "workshop_figure",
    material: "filament",
    size: "her ne ise",
    finish: "paintable_kit",
  });
  assert.equal(a, WORKSHOP_FIGURE_PRICE_KURUS);
  assert.equal(b, WORKSHOP_FIGURE_PRICE_KURUS);
});

test("workshop_figure yüzeyi paintable_kit'tir ve KORUNUR", () => {
  assert.deepEqual(allowedFinishesForKind("workshop_figure"), ["paintable_kit"]);
  assert.equal(coerceFinishForKind("workshop_figure", "paintable_kit"), "paintable_kit");
  // Yanlış yüzey gelirse türün varsayılanına düşer, hand_painted'e KAÇMAZ.
  assert.equal(coerceFinishForKind("workshop_figure", "hand_painted"), "paintable_kit");
  assert.equal(coerceFinishForKind("workshop_figure", undefined), "paintable_kit");
});

test("normal figür davranışı DEĞİŞMEDİ (regresyon)", () => {
  // Bu, atölye türünün mevcut tek ürün kuralını kırmadığının kanıtı.
  assert.deepEqual(allowedFinishesForKind("figure"), ["hand_painted"]);
  assert.equal(coerceFinishForStyle("realistic", "paintable_kit"), "hand_painted");
});

test("atölye siparişi kalem invariantını korur", () => {
  const amountKurus = itemPriceKurus({ kind: "workshop_figure", material: "resin" });
  const paintingPriceKurus = 0; // boyama seansın kendisi, boyacı payı yok
  const productionBaseKurus = amountKurus - paintingPriceKurus;
  assert.equal(productionBaseKurus + paintingPriceKurus, amountKurus);
  assert.equal(productionBaseKurus, 135000);
});
```

- [ ] **Step 2: Testin düştüğünü gör**

```bash
npx tsx scripts/test-workshop.ts
```
Beklenen: `allowedFinishesForKind` export edilmediği için tip/çalışma hatası.

- [ ] **Step 3: `prices.ts`'e türü ekle**

`ItemKind` birleşimine ekle:

```ts
export type ItemKind =
  | "figure"
  | "workshop_figure"
  | "object"
  | "design"
  | "upload"
  | CreativeLabKind;
```

`FIGURINE_PRICE_KURUS` tanımının ardına:

```ts
/**
 * Atölye figürü — BOYANMAMIŞ kişiye özel figür. Boyama işi atölye seansının
 * kendisidir ve mekanda yapılır, bu yüzden boyacı partneri bu akışa hiç girmez
 * ve siparişin boyama kalemi sıfırdır (tamamı üretim kalemi).
 *
 * Tek kaynak config/workshop.ts'tedir; buradan yalnızca yeniden ihraç edilir ki
 * `itemPriceKurus` tek bir fiyat dağıtıcısı olarak kalsın.
 */
export { WORKSHOP_FIGURE_PRICE_KURUS } from "./workshop";
```

> `prices.ts` zaten `./sizes`'tan import ediyor; `./workshop` de saf modül, döngü oluşmaz.

`itemPriceKurus` içinde, `isFlatPricedKind` short-circuit'inin HEMEN ARDINA:

```ts
  if (kind === "workshop_figure") {
    // Düz fiyat: atölye figüründe boyut/malzeme/yüzey ekseni yoktur. Boyut
    // kontrolünden ÖNCE dönmeli — atölye siparişi katalog boyut anahtarı
    // taşımaz ve UnpricedSizeError'a düşmemeli.
    return WORKSHOP_FIGURE_PRICE_KURUS;
  }
```

Dosyanın başına import ekle:

```ts
import { WORKSHOP_FIGURE_PRICE_KURUS } from "./workshop";
```

- [ ] **Step 4: `validators/order.ts`'e kind-tabanlı yüzey kapısını ekle**

`FINISHES_BY_KIND` haritasına satır ekle:

```ts
const FINISHES_BY_KIND: Record<string, string[]> = {
  figure: FIGURE_FINISHES,
  // Atölye figürü boyanmamış satılır; boyama seansın kendisidir. Bu yüzden
  // `figure`'ın hand_painted zorunluluğu buraya UYGULANMAZ.
  workshop_figure: ["paintable_kit"],
  object: OBJECT_FINISHES,
  keychain: FLAT_FINISHES,
  fridge_magnet: FLAT_FINISHES,
  lamp: FLAT_FINISHES,
};
```

Mevcut `allowedFinishesForStyle` / `coerceFinishForStyle`'ı kind-tabanlı bir
çekirdeğe delege et (davranış aynen korunur):

```ts
/**
 * Bir FİYAT TÜRÜNÜN taşıyabileceği yüzeyler. Style-tabanlı sürüm bunu sarar.
 * Atölye akışı bir tasarım şablonu taşımaz (DesignTemplate.priceKind dar bir
 * birleşimdir ve workshop_figure oraya girmez), bu yüzden türü doğrudan verir.
 */
export function allowedFinishesForKind(kind: string): string[] {
  return FINISHES_BY_KIND[kind] ?? FIGURE_FINISHES;
}

/** Güvenilmeyen bir yüzeyi türün izin verdiğine daraltır. */
export function coerceFinishForKind(kind: string, finish: unknown): string {
  const allowed = allowedFinishesForKind(kind);
  return typeof finish === "string" && allowed.includes(finish) ? finish : allowed[0];
}

export function allowedFinishesForStyle(style: unknown): string[] {
  const slug =
    typeof style === "string" && isValidTemplateSlug(style) ? style : DEFAULT_TEMPLATE_SLUG;
  return allowedFinishesForKind(priceKindForStyle(slug));
}

export function coerceFinishForStyle(style: unknown, finish: unknown): string {
  const allowed = allowedFinishesForStyle(style);
  return typeof finish === "string" && allowed.includes(finish) ? finish : allowed[0];
}
```

- [ ] **Step 5: Testlerin geçtiğini gör**

```bash
npx tsx scripts/test-workshop.ts && npx tsx scripts/test-prices.ts && npx tsx scripts/test-cost-lines.ts
```
Beklenen: üçü de `passed`. `test-prices` ve `test-cost-lines` regresyon kanıtıdır.

- [ ] **Step 6: Tam kapı + commit**

```bash
npm run typecheck && npm run test:unit >/dev/null && echo OK
git add src/lib/config/prices.ts src/lib/validators/order.ts scripts/test-workshop.ts
git commit -m "feat(atölye): boyanmamış atölye figürü fiyat türü (₺1.350)"
```

---

### Task 4: Mekan — validator, servis, talep→mekan dönüşümü

**Files:**
- Create: `src/lib/validators/workshop.ts`
- Create: `src/lib/services/workshop-venue.ts`
- Create: `src/app/api/admin/workshop-requests/[id]/convert-to-venue/route.ts`
- Create: `src/app/api/admin/workshops/venues/route.ts`
- Create: `src/app/api/admin/workshops/venues/[id]/route.ts`
- Modify: `src/app/admin/workshop-requests/[id]/client.tsx` ("Mekana dönüştür" butonu)

**Interfaces:**
- Consumes: `workshopVenues` (Task 2), `createTurkishAddressSchema` (`@/lib/validators/order`)
- Produces:
  - `createVenueSchema(locale?)` → zod
  - `createVenueFromRequest(requestId, input, adminEmail): Promise<{ venueId: string } | { error: string }>`
  - `listVenues(): Promise<VenueRow[]>`

- [ ] **Step 1: Validator'ı yaz**

`src/lib/validators/workshop.ts`:

```ts
import { z } from "zod";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { createTurkishAddressSchema } from "@/lib/validators/order";
import { WORKSHOP_SESSION_STATUSES } from "@/lib/config/workshop";

/**
 * Mekan yaratma/güncelleme. Adres, SİPARİŞ adresiyle aynı şemadan geçer —
 * seans siparişlerine birebir kopyalanacağı için posta kodu dâhil eksiksiz
 * olmak zorunda. Başvuru formu posta kodu toplamıyor; admin burada tamamlar.
 */
export function createVenueSchema(locale: Locale = defaultLocale) {
  return z.object({
    name: z.string().trim().min(2, "Mekan adı en az 2 karakter").max(120),
    contactName: z.string().trim().min(2).max(120),
    contactEmail: z.string().trim().email("Geçerli bir e-posta girin").max(200),
    contactPhone: z.string().trim().min(1).max(40),
    address: createTurkishAddressSchema(locale),
    notes: z.string().trim().max(2000).optional(),
  });
}

export const updateVenueStatusSchema = z.object({
  status: z.enum(["active", "paused", "archived"]),
});

/**
 * Seans yaratma. `startsAt` ISO string; kapanış ve teslim tarihleri
 * config/workshop.ts'ten TÜRETİLİR, istemciden alınmaz.
 */
export const createSessionSchema = z.object({
  venueId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(30).max(600).default(120),
  capacity: z.number().int().min(1).max(200),
  pricePerSeatKurus: z.number().int().min(100).max(100_000_00),
  manufacturerId: z.string().uuid().optional(),
  adminNotes: z.string().trim().max(2000).optional(),
});

export const updateSessionSchema = z.object({
  status: z.enum(WORKSHOP_SESSION_STATUSES).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  manufacturerId: z.string().uuid().nullable().optional(),
  joinClosesAt: z.string().datetime({ offset: true }).optional(),
  adminNotes: z.string().trim().max(2000).optional(),
});

/** Public katılım formu. Fotoğraf ayrı /api/upload ile yüklenir, key gelir. */
export const joinSessionSchema = z.object({
  fullName: z.string().trim().min(2, "Adınızı girin").max(120),
  email: z.string().trim().email("Geçerli bir e-posta girin").max(200),
  phone: z.string().trim().min(1, "Telefon girin").max(40),
  photoKey: z.string().trim().min(1).max(300),
  kvkkConsent: z.literal(true, {
    message: "Devam etmek için KVKK aydınlatma metnini onaylamalısınız.",
  }),
  contentConsent: z.literal(true, {
    message: "Fotoğraf kullanım haklarına ilişkin onayı vermelisiniz.",
  }),
});

export const batchShipSchema = z.object({
  carrier: z.enum(["yurtici", "aras", "mng", "ptt", "surat", "other", "elden"]),
  trackingNumber: z.string().trim().max(60).optional(),
});
```

- [ ] **Step 2: Mekan servisini yaz**

`src/lib/services/workshop-venue.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopVenues, workshopRequests } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";

export interface VenueInput {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: TurkishAddress;
  notes?: string;
}

/**
 * Onaylı bir atölye TALEBİNİ kalıcı bir MEKANA dönüştürür.
 *
 * Talep bir lead'dir: tek seferlik, üzerinde bir tarih ve bir teklif rakamı
 * taşır ve hiçbir şey üretmez. Mekan ise defalarca seans açılabilen partner
 * kaydıdır. Bağ `requestId` ile korunur, böylece "bu kafe nereden geldi"
 * sorusu cevaplanabilir kalır.
 *
 * Aynı talepten ikinci kez mekan yaratılmaz.
 */
export async function createVenueFromRequest(
  requestId: string,
  input: VenueInput,
  adminEmail: string
): Promise<{ venueId: string } | { error: string }> {
  const request = await db.query.workshopRequests.findFirst({
    where: eq(workshopRequests.id, requestId),
    columns: { id: true },
  });
  if (!request) return { error: "Talep bulunamadı" };

  const existing = await db.query.workshopVenues.findFirst({
    where: eq(workshopVenues.requestId, requestId),
    columns: { id: true },
  });
  if (existing) return { error: "Bu talep zaten bir mekana dönüştürülmüş." };

  const [venue] = await db
    .insert(workshopVenues)
    .values({ requestId, ...input, notes: input.notes || null })
    .returning({ id: workshopVenues.id });

  // Talebi 'scheduled' yap: artık işlenmiş bir lead'dir.
  await db
    .update(workshopRequests)
    .set({ status: "scheduled", adminEmail, updatedAt: new Date() })
    .where(eq(workshopRequests.id, requestId));

  return { venueId: venue.id };
}

/** Talepsiz, doğrudan mekan (telefonla anlaşılmış kafe). */
export async function createVenue(input: VenueInput): Promise<{ venueId: string }> {
  const [venue] = await db
    .insert(workshopVenues)
    .values({ requestId: null, ...input, notes: input.notes || null })
    .returning({ id: workshopVenues.id });
  return { venueId: venue.id };
}

export async function listVenues() {
  return db.query.workshopVenues.findMany({
    orderBy: [desc(workshopVenues.createdAt)],
  });
}

export async function setVenueStatus(id: string, status: string): Promise<boolean> {
  const [row] = await db
    .update(workshopVenues)
    .set({ status, updatedAt: new Date() })
    .where(eq(workshopVenues.id, id))
    .returning({ id: workshopVenues.id });
  return !!row;
}
```

- [ ] **Step 3: convert-to-venue route'unu yaz**

`src/app/api/admin/workshop-requests/[id]/convert-to-venue/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createVenueSchema } from "@/lib/validators/workshop";
import { createVenueFromRequest } from "@/lib/services/workshop-venue";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";

/**
 * Onaylı atölye talebini kalıcı mekana çevirir. Admin, başvuruda olmayan iki
 * alanı burada tamamlar: mekanın adı ve POSTA KODU — sipariş adresi /^\d{5}$/
 * şartı koyuyor, başvuru formu ise posta kodu toplamıyor.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const locale = getRequestLocale(request);
  const parsed = createVenueSchema(locale).safeParse(
    await request.json().catch(() => ({}))
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  const result = await createVenueFromRequest(id, parsed.data, a.session.user.email);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ venueId: result.venueId });
}
```

- [ ] **Step 4: Mekan listeleme/güncelleme route'ları**

`src/app/api/admin/workshops/venues/route.ts` — `GET` (liste) + `POST` (talepsiz yaratma).
`src/app/api/admin/workshops/venues/[id]/route.ts` — `PATCH` (durum).

Her ikisi de `requireAdmin()` ile başlar ve şu iskeleti kullanır:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listVenues, createVenue, setVenueStatus } from "@/lib/services/workshop-venue";
import { createVenueSchema, updateVenueStatusSchema } from "@/lib/validators/workshop";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";

export async function GET() {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  return NextResponse.json({ venues: await listVenues() });
}

export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const parsed = createVenueSchema(getRequestLocale(request)).safeParse(
    await request.json().catch(() => ({}))
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }
  return NextResponse.json(await createVenue(parsed.data));
}
```

- [ ] **Step 5: Admin talep detayına "Mekana dönüştür" butonu**

`src/app/admin/workshop-requests/[id]/client.tsx` içindeki aksiyon butonları
bloğuna (mevcut "Planla" butonunun yanına) ekle. Buton bir modal açar; modal
mekan adı + posta kodu ister, kalan alanları talepten ön-doldurur:

```tsx
{!req.venueId && (
  <button
    type="button"
    onClick={() => setConvertOpen(true)}
    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
  >
    Mekana dönüştür
  </button>
)}
```

Modal gönderimi:

```tsx
const convert = async () => {
  setBusy(true);
  try {
    const res = await fetch(`/api/admin/workshop-requests/${req.id}/convert-to-venue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: venueName,
        contactName: req.contactName,
        contactEmail: req.contactEmail,
        contactPhone: req.contactPhone,
        address: {
          adres: req.addressLine,
          mahalle: mahalle,
          ilce: req.district,
          il: req.city,
          postaKodu: postaKodu,
          telefon: req.contactPhone,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Mekana dönüştürülemedi.");
      return;
    }
    window.location.href = `/admin/workshops/${data.venueId}`;
  } finally {
    setBusy(false);
  }
};
```

> Yönlendirme `window.location.href` ile yapılır, `router.push` ile değil —
> panel kabuğunda auth/yerleşim geçişleri TAM navigasyon ister (panel-shell
> responsive notu).

- [ ] **Step 6: Doğrula + commit**

```bash
npm run typecheck && npm run lint 2>&1 | grep "✖" && npm run test:unit >/dev/null && echo OK
git add src/lib/validators/workshop.ts src/lib/services/workshop-venue.ts \
        src/app/api/admin/workshop-requests src/app/api/admin/workshops \
        src/app/admin/workshop-requests
git commit -m "feat(atölye): kalıcı mekan kaydı ve talepten mekana dönüştürme"
```

---

### Task 5: Seans servisi — yaratma, token, risk hesabı

**Files:**
- Create: `src/lib/services/workshop-session.ts`
- Create: `src/app/api/admin/workshops/sessions/route.ts`
- Create: `src/app/api/admin/workshops/sessions/[id]/route.ts`
- Modify: `scripts/test-workshop.ts`

**Interfaces:**
- Consumes: `deriveSessionDates`, `workshopCommissionRateBps` (Task 1); `workshopSessions` (Task 2)
- Produces:
  - `createSession(input): Promise<{ sessionId: string; joinToken: string } | { error: string }>`
  - `ensureJoinToken(sessionId): Promise<string | null>`
  - `sessionJoinUrl(token: string): string`
  - `assessSessionRisk(args): { level: "ok" | "warn" | "danger"; message: string }`

- [ ] **Step 1: Risk hesabı testini yaz**

`scripts/test-workshop.ts`'e ekle (saf fonksiyon olduğu için test edilebilir):

```ts
import { assessSessionRisk } from "../src/lib/services/workshop-session";

test("risk: bol süre → ok", () => {
  const r = assessSessionRisk({ daysUntilSession: 21, avgPrintDays: 5, currentLoad: 1, maxConcurrentOrders: 5 });
  assert.equal(r.level, "ok");
});

test("risk: süre üreticinin ortalamasına yakın → warn", () => {
  const r = assessSessionRisk({ daysUntilSession: 7, avgPrintDays: 6, currentLoad: 2, maxConcurrentOrders: 5 });
  assert.equal(r.level, "warn");
});

test("risk: süre ortalamadan AZ → danger", () => {
  const r = assessSessionRisk({ daysUntilSession: 4, avgPrintDays: 7, currentLoad: 1, maxConcurrentOrders: 5 });
  assert.equal(r.level, "danger");
  assert.ok(r.message.length > 0, "uyarı metni boş olamaz");
});

test("risk: kapasitesi dolu üretici → danger", () => {
  const r = assessSessionRisk({ daysUntilSession: 30, avgPrintDays: 3, currentLoad: 5, maxConcurrentOrders: 5 });
  assert.equal(r.level, "danger");
});
```

- [ ] **Step 2: Testin düştüğünü gör**

```bash
npx tsx scripts/test-workshop.ts
```
Beklenen: modül bulunamadı hatası.

- [ ] **Step 3: Seans servisini yaz**

`src/lib/services/workshop-session.ts`:

```ts
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { workshopSessions, workshopVenues } from "@/lib/db/schema";
import { deriveSessionDates } from "@/lib/config/workshop";

/** Katılım token'ı: 12 karakter × 64 sembol ≈ 72 bit. Ev kuralı (order-journey). */
const TOKEN_LENGTH = 12;

/**
 * Seansın katılım linki. `ensureJourneyToken` ile aynı yarış-güvenli tembel
 * mint deseni: token varsa döner; yoksa `isNull(joinToken)` koşuluyla yazmayı
 * dener, kaybederse yeniden okur. Basılmış/paylaşılmış bir link asla
 * geçersizleşmez.
 */
export async function ensureJoinToken(sessionId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.query.workshopSessions.findFirst({
      where: eq(workshopSessions.id, sessionId),
      columns: { joinToken: true },
    });
    if (!row) return null;
    if (row.joinToken) return row.joinToken;

    const candidate = nanoid(TOKEN_LENGTH);
    const [updated] = await db
      .update(workshopSessions)
      .set({ joinToken: candidate, updatedAt: new Date() })
      .where(and(eq(workshopSessions.id, sessionId), isNull(workshopSessions.joinToken)))
      .returning({ joinToken: workshopSessions.joinToken });
    if (updated?.joinToken) return updated.joinToken;
  }
  return null;
}

export function sessionJoinUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com").replace(/\/$/, "");
  return `${base}/atolye/katil/${token}`;
}

export interface CreateSessionInput {
  venueId: string;
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
  pricePerSeatKurus: number;
  manufacturerId?: string | null;
  adminNotes?: string | null;
}

export async function createSession(
  input: CreateSessionInput
): Promise<{ sessionId: string; joinToken: string } | { error: string }> {
  const venue = await db.query.workshopVenues.findFirst({
    where: eq(workshopVenues.id, input.venueId),
    columns: { id: true, status: true },
  });
  if (!venue) return { error: "Mekan bulunamadı" };
  if (venue.status !== "active") return { error: "Mekan aktif değil" };

  const now = Date.now();
  if (input.startsAt.getTime() <= now) {
    return { error: "Seans tarihi geçmişte olamaz." };
  }

  const { joinClosesAt, deliverBy } = deriveSessionDates(input.startsAt);
  // Kapanış zaten geçmişse link hiç açılamaz — admin'i sessizce ölü bir
  // seansla bırakmak yerine reddet.
  if (joinClosesAt.getTime() <= now) {
    return {
      error:
        "Bu tarih için katılım penceresi zaten kapanmış olurdu (kapanış seanstan 5 gün öncedir). Daha ileri bir tarih seçin.",
    };
  }

  const token = nanoid(TOKEN_LENGTH);
  const [row] = await db
    .insert(workshopSessions)
    .values({
      venueId: input.venueId,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      capacity: input.capacity,
      pricePerSeatKurus: input.pricePerSeatKurus,
      manufacturerId: input.manufacturerId ?? null,
      adminNotes: input.adminNotes ?? null,
      joinToken: token,
      joinClosesAt,
      deliverBy,
      status: "draft",
    })
    .returning({ id: workshopSessions.id, joinToken: workshopSessions.joinToken });

  return { sessionId: row.id, joinToken: row.joinToken };
}

/**
 * Seçilen üreticinin bu tarihe yetişip yetişemeyeceğine dair uyarı.
 *
 * ENGELLEMEZ — admin bilerek riskli bir seans açabilir (üreticiyle telefonda
 * anlaşmış olabilir). Saf fonksiyon: girdi hesaplanıp verilir, test edilebilir.
 */
export function assessSessionRisk(args: {
  daysUntilSession: number;
  /** Üreticinin son işlerindeki ortalama atama→baskı süresi (gün). */
  avgPrintDays: number;
  currentLoad: number;
  maxConcurrentOrders: number;
}): { level: "ok" | "warn" | "danger"; message: string } {
  const { daysUntilSession, avgPrintDays, currentLoad, maxConcurrentOrders } = args;

  if (currentLoad >= maxConcurrentOrders) {
    return {
      level: "danger",
      message: `Bu üreticinin kapasitesi dolu (${currentLoad}/${maxConcurrentOrders}). Parti sıraya girer.`,
    };
  }
  // Teslim seanstan 1 gün önce; kargo için 1 gün daha pay bırak.
  const usableDays = daysUntilSession - 2;
  if (usableDays < avgPrintDays) {
    return {
      level: "danger",
      message: `Seansa ${daysUntilSession} gün var; bu üreticinin ortalama baskı süresi ${avgPrintDays} gün. Yetişmeyebilir.`,
    };
  }
  if (usableDays < avgPrintDays * 1.5) {
    return {
      level: "warn",
      message: `Seansa ${daysUntilSession} gün var; ortalama baskı süresi ${avgPrintDays} gün. Pay dar.`,
    };
  }
  return { level: "ok", message: "Süre yeterli görünüyor." };
}

/** Kapanış zamanı geçmiş, hâlâ açık seanslar (kapanış worker'ı için). */
export async function findSessionsDueToClose(now: Date) {
  return db
    .select({ id: workshopSessions.id })
    .from(workshopSessions)
    .where(and(eq(workshopSessions.status, "open"), lte(workshopSessions.joinClosesAt, now)));
}
```

- [ ] **Step 4: Testin geçtiğini gör**

```bash
npx tsx scripts/test-workshop.ts
```
Beklenen: tüm testler `ok`.

- [ ] **Step 5: Seans API route'larını yaz**

`src/app/api/admin/workshops/sessions/route.ts` — `POST` (yaratma):

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSessionSchema } from "@/lib/validators/workshop";
import { createSession, sessionJoinUrl } from "@/lib/services/workshop-session";

export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const parsed = createSessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  const result = await createSession({
    ...parsed.data,
    startsAt: new Date(parsed.data.startsAt),
    manufacturerId: parsed.data.manufacturerId ?? null,
    adminNotes: parsed.data.adminNotes ?? null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    sessionId: result.sessionId,
    joinUrl: sessionJoinUrl(result.joinToken),
  });
}
```

`src/app/api/admin/workshops/sessions/[id]/route.ts` — `PATCH` (durum/kapasite/üretici),
`updateSessionSchema` ile; `draft → open` geçişinde üretici seçilmiş olmasını şart koş:

```ts
  if (parsed.data.status === "open") {
    const s = await db.query.workshopSessions.findFirst({
      where: eq(workshopSessions.id, id),
      columns: { manufacturerId: true },
    });
    if (!s?.manufacturerId) {
      return NextResponse.json(
        { error: "Seansı açmadan önce bir üretici seçin — parti kapanışta ona düşecek." },
        { status: 400 }
      );
    }
  }
```

- [ ] **Step 6: Doğrula + commit**

```bash
npm run typecheck && npm run test:unit >/dev/null && echo OK
git add src/lib/services/workshop-session.ts src/app/api/admin/workshops scripts/test-workshop.ts
git commit -m "feat(atölye): seans yaratma, katılım token'ı ve risk uyarısı"
```

---

### Task 6: Admin arayüzü — mekan listesi ve mekanın seansları

**Files:**
- Create: `src/app/admin/workshops/page.tsx`
- Create: `src/app/admin/workshops/workshops-client.tsx`
- Create: `src/app/admin/workshops/[venueId]/page.tsx`
- Create: `src/app/admin/workshops/[venueId]/venue-client.tsx`
- Modify: `src/app/admin/sidebar.tsx`

**Interfaces:**
- Consumes: `listVenues` (Task 4), `sessionJoinUrl` (Task 5), `WORKSHOP_SESSION_STATUS_LABELS` (Task 1)

- [ ] **Step 1: Sidebar'a "Atölyeler" ekle**

`src/app/admin/sidebar.tsx` — `"/admin/workshop-requests"` girdisinin HEMEN ARDINA,
aynı `admin.nav.group.customer` grubunun içine:

```tsx
        {
          href: "/admin/workshops",
          label: "Atölyeler",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />,
          badge: 0,
        },
```

- [ ] **Step 2: Mekan listesi sayfası**

`src/app/admin/workshops/page.tsx`:

```tsx
import { listVenues } from "@/lib/services/workshop-venue";
import { WorkshopsClient } from "./workshops-client";

export const dynamic = "force-dynamic";

export default async function AdminWorkshopsPage() {
  const venues = await listVenues();
  return (
    <WorkshopsClient
      venues={venues.map((v) => ({
        id: v.id,
        name: v.name,
        contactName: v.contactName,
        contactPhone: v.contactPhone,
        city: v.address.il,
        district: v.address.ilce,
        status: v.status,
        createdAt: v.createdAt.toISOString(),
      }))}
    />
  );
}
```

`src/app/admin/workshops/workshops-client.tsx` — `"use client"`, mekanları
tabloda listeler, her satır `/admin/workshops/<id>`'ye link verir. Durum
rozetleri için `admin/workshop-requests/client.tsx`'teki pill desenini birebir
klonla (aynı Tailwind sınıf konvansiyonu).

- [ ] **Step 3: Mekanın seansları sayfası**

`src/app/admin/workshops/[venueId]/page.tsx` — mekanı + seanslarını yükler,
her seansın katılım linkini `sessionJoinUrl(session.joinToken)` ile üretip
client'a verir.

`venue-client.tsx` — seans listesi + "Seans aç" formu. Form alanları:
tarih+saat (`<input type="datetime-local">`), süre, kontenjan, kişi başı fiyat
(varsayılan ₺1.350), üretici seçimi (`<Select>`). Üretici seçilince risk
uyarısı gösterilir.

**Genişlik tuzağı:** `<Input>`/`<Select>` üzerine `className="w-32"` YAZMA —
`.input-base{width:100%}` onu ezer. Genişliği saran grid hücresine ver:

```tsx
<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
  <FormField label="Kontenjan" required>
    <Input type="number" min={1} max={200} value={capacity}
           onChange={(e) => setCapacity(e.target.value)} />
  </FormField>
  {/* … */}
</div>
```

Katılım linki kopyalama düğmesi:

```tsx
<button
  type="button"
  onClick={() => { navigator.clipboard.writeText(s.joinUrl); setCopiedId(s.id); }}
  className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
>
  {copiedId === s.id ? "Kopyalandı ✓" : "Katılım linkini kopyala"}
</button>
```

- [ ] **Step 4: Elle doğrula**

```bash
npx next dev --port 3011
```
(Kullanıcının 3005'teki dev ortamını bozmamak için alternatif port.)

Tarayıcıda: `/admin/workshops` açılıyor, sidebar'da "Atölyeler" görünüyor, bir
mekana girip seans açılabiliyor, katılım linki kopyalanabiliyor. Sunucuyu durdur.

- [ ] **Step 5: Doğrula + commit**

```bash
npm run typecheck && npm run lint 2>&1 | grep "✖" && echo OK
git add src/app/admin/workshops src/app/admin/sidebar.tsx
git commit -m "feat(atölye): admin mekan ve seans yönetim ekranları"
```

---

### Task 7: Public katılım sayfası (sunucu tarafı)

**Files:**
- Create: `src/app/atolye/katil/[token]/page.tsx`
- Create: `src/lib/services/workshop-join.ts` (token→seans yükleyici)

**Interfaces:**
- Produces: `loadSessionByToken(token: string): Promise<JoinView | null>`

- [ ] **Step 1: Yükleyiciyi yaz**

`src/lib/services/workshop-join.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopSessions } from "@/lib/db/schema";

export interface JoinView {
  sessionId: string;
  venueName: string;
  venueCity: string;
  venueDistrict: string;
  venueAddressLine: string;
  startsAt: string;
  joinClosesAt: string;
  capacity: number;
  bookedCount: number;
  pricePerSeatKurus: number;
  /** Form gösterilsin mi; false ise `closedReason` doludur. */
  open: boolean;
  closedReason: string | null;
}

/**
 * Token'dan katılım görünümü. Bulunamayan token `null` döner ve sayfa
 * `notFound()` çağırır — yanlış, silinmiş ve uydurma token birbirinden
 * ayırt edilemez.
 */
export async function loadSessionByToken(token: string): Promise<JoinView | null> {
  // Savunma amaçlı uzunluk sınırı, DB'ye gitmeden.
  if (!token || token.length > 64) return null;

  const s = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.joinToken, token),
    with: { venue: true },
  });
  if (!s || !s.venue) return null;

  const now = Date.now();
  let closedReason: string | null = null;
  if (s.status === "cancelled") closedReason = "Bu atölye seansı iptal edildi.";
  else if (s.status !== "open") closedReason = "Bu seans şu anda katılıma kapalı.";
  else if (now > s.joinClosesAt.getTime())
    closedReason = "Katılım süresi doldu. Figürlerin seansa yetişmesi için son katılım tarihi geçti.";
  else if (s.bookedCount >= s.capacity) closedReason = "Kontenjan doldu.";

  return {
    sessionId: s.id,
    venueName: s.venue.name,
    venueCity: s.venue.address.il,
    venueDistrict: s.venue.address.ilce,
    venueAddressLine: s.venue.address.adres,
    startsAt: s.startsAt.toISOString(),
    joinClosesAt: s.joinClosesAt.toISOString(),
    capacity: s.capacity,
    bookedCount: s.bookedCount,
    pricePerSeatKurus: s.pricePerSeatKurus,
    open: closedReason === null,
    closedReason,
  };
}
```

- [ ] **Step 2: Public sayfayı yaz**

`src/app/atolye/katil/[token]/page.tsx` — `src/app/yolculuk/[token]/page.tsx`
iskeletinin birebir kopyası:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSessionByToken } from "@/lib/services/workshop-join";
import { JoinClient } from "./join-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atölyeye katıl | Figurünica",
  // Link yalnızca paylaşıldığı kişilere aittir: arama motorlarına girmemeli.
  robots: { index: false, follow: false, nocache: true },
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadSessionByToken(token);
  // Yanlış, süresi geçmiş ya da uydurma token birbirinden ayırt edilemez.
  if (!view) notFound();

  return <JoinClient token={token} view={view} />;
}
```

- [ ] **Step 3: Doğrula + commit**

```bash
npm run typecheck && echo OK
git add src/lib/services/workshop-join.ts src/app/atolye/katil
git commit -m "feat(atölye): public katılım sayfası iskeleti ve token yükleyicisi"
```

---

### Task 8: Katılım API'si — koltuk rezervasyonu ve taslak

Bu görevin özü **koşullu UPDATE**'tir: iki kişi son koltuğu aynı anda kapayabilir.

**Files:**
- Create: `src/lib/services/workshop-participant.ts`
- Create: `src/app/api/workshop/join/[token]/route.ts`
- Modify: `scripts/test-workshop.ts`

**Interfaces:**
- Consumes: `joinSessionSchema` (Task 4), `resolveOrCreateGuestUser`, `buildDraftReference`, `buildMerchantOid`
- Produces: `joinSession(token, input, ip): Promise<{ reference: string; payUrl: string } | { error: string; status: number }>`

- [ ] **Step 1: Katılım servisini yaz**

`src/lib/services/workshop-participant.ts`:

```ts
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orderDrafts,
  workshopParticipants,
  workshopSessions,
} from "@/lib/db/schema";
import { resolveOrCreateGuestUser } from "@/lib/services/guest-user";
import { buildDraftReference } from "@/lib/services/order-draft";
import { buildMerchantOid } from "@/lib/services/paytr";
import { WORKSHOP_FIGURE_PRICE_KURUS } from "@/lib/config/workshop";
import { coerceFinishForKind } from "@/lib/validators/order";
import type { TurkishAddress } from "@/lib/db/schema";

export interface JoinInput {
  fullName: string;
  email: string;
  phone: string;
  photoKey: string;
}

/**
 * Koltuğu ATOMİK olarak rezerve eder. Oku-sonra-yaz DEĞİL: iki kişi son
 * koltuğu aynı anda kapayabilir ve kontenjan aşılırsa mekanda figürü olmayan
 * bir katılımcı oluşur.
 *
 * 0 satır dönerse koltuk kapılmıştır ya da seans kapanmıştır.
 */
async function reserveSeat(sessionId: string): Promise<boolean> {
  const rows = await db
    .update(workshopSessions)
    .set({ bookedCount: sql`${workshopSessions.bookedCount} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(workshopSessions.id, sessionId),
        eq(workshopSessions.status, "open"),
        sql`${workshopSessions.bookedCount} < ${workshopSessions.capacity}`,
        gt(workshopSessions.joinClosesAt, new Date())
      )
    )
    .returning({ bookedCount: workshopSessions.bookedCount });
  return rows.length > 0;
}

/** Rezervasyonu geri alır (ödeme başarısız / taslak süresi doldu). */
export async function releaseSeat(sessionId: string): Promise<void> {
  await db
    .update(workshopSessions)
    .set({
      // GREATEST(0, ...) — sayaç asla negatife düşmesin.
      bookedCount: sql`GREATEST(0, ${workshopSessions.bookedCount} - 1)`,
      updatedAt: new Date(),
    })
    .where(eq(workshopSessions.id, sessionId));
}

export async function joinSession(
  token: string,
  input: JoinInput
): Promise<{ reference: string; payUrl: string } | { error: string; status: number }> {
  const session = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.joinToken, token),
    with: { venue: true },
  });
  if (!session || !session.venue) return { error: "Seans bulunamadı", status: 404 };
  if (session.status !== "open") return { error: "Bu seans katılıma kapalı.", status: 409 };

  // Fotoğraf anahtarı doğrulaması — /api/orders'daki aynı kapı.
  if (!input.photoKey.startsWith("photos/") || input.photoKey.includes("..")) {
    return { error: "Geçersiz fotoğraf.", status: 400 };
  }

  // Public guest checkout: allowExistingAccount ASLA verilmez. E-postası kayıtlı
  // birinin siparişini bir yabancının başkasının hesabına iliştirmesini
  // engelleyen şey budur.
  const guest = await resolveOrCreateGuestUser({
    email: input.email,
    name: input.fullName,
    phone: input.phone,
  });
  if (!guest.ok) {
    // ResolveGuestResult: { ok: false; code: "email_registered" } — alan adı
    // `code`, `error` DEĞİL.
    return {
      error:
        guest.code === "email_registered"
          ? "Bu e-posta ile kayıtlı bir hesap var. Lütfen giriş yapıp tekrar deneyin."
          : "Kayıt oluşturulamadı.",
      status: 409,
    };
  }

  if (!(await reserveSeat(session.id))) {
    return { error: "Kontenjan doldu ya da katılım kapandı.", status: 409 };
  }

  try {
    const reference = buildDraftReference();
    const amountKurus = session.pricePerSeatKurus || WORKSHOP_FIGURE_PRICE_KURUS;
    // Sipariş adresi MEKANIN adresidir — toplu teslimat buradan doğal olarak
    // çıkar: koliler zaten aynı adrese gider, üzerlerinde katılımcının adı yazar.
    const shippingAddress: TurkishAddress = {
      ...session.venue.address,
      telefon: input.phone,
    };

    const [draft] = await db
      .insert(orderDrafts)
      .values({
        reference,
        userId: guest.user.id,
        email: input.email,
        customerName: input.fullName,
        phone: input.phone,
        shippingAddress,
        orderType: "custom",
        amountKurus,
        // Kalem modeli: boyama yok, tamamı üretim kalemi.
        productionBaseKurus: amountKurus,
        paintingPriceKurus: 0,
        needsPainting: false,
        finish: coerceFinishForKind("workshop_figure", "paintable_kit") as "paintable_kit",
        photoKeys: [input.photoKey],
        paymentMethod: "card",
        status: "pending",
        paytrMerchantOid: buildMerchantOid(reference),
        productTitleSnapshot: `Atölye figürü — ${session.venue.name}`,
        attributionChannel: "workshop",
      })
      .returning({ id: orderDrafts.id });

    await db.insert(workshopParticipants).values({
      sessionId: session.id,
      draftId: draft.id,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      photoKey: input.photoKey,
      kvkkConsentAt: new Date(),
      contentConsentAt: new Date(),
      status: "pending_payment",
    });

    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com").replace(/\/$/, "");
    return { reference, payUrl: `${base}/pay/${reference}` };
  } catch (err) {
    // Taslak yazılamadıysa koltuğu geri bırak, yoksa kontenjan sızar.
    await releaseSeat(session.id).catch(() => {});
    throw err;
  }
}
```

- [ ] **Step 2: Public route'u yaz**

`src/app/api/workshop/join/[token]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { joinSessionSchema } from "@/lib/validators/workshop";
import { joinSession } from "@/lib/services/workshop-participant";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Public uç: hem IP hem token başına sınır. Foto yükleme + taslak yaratma
  // pahalı işler; workshop-requests route'undaki aynı desen.
  const ip = extractClientIp(request);
  const ipRl = await rateLimitAsync(`workshop-join:${ip}`, 5, 60 * 60 * 1000);
  if (!ipRl.success) {
    return NextResponse.json(
      { error: "Çok fazla deneme yaptınız. Lütfen bir saat sonra tekrar deneyin." },
      { status: 429 }
    );
  }
  const tokenRl = await rateLimitAsync(`workshop-join-token:${token}`, 60, 60 * 60 * 1000);
  if (!tokenRl.success) {
    return NextResponse.json(
      { error: "Bu seans için çok fazla istek alındı. Lütfen sonra tekrar deneyin." },
      { status: 429 }
    );
  }

  const parsed = joinSessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  const result = await joinSession(token, {
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    photoKey: parsed.data.photoKey,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Katılım ucunun hata yollarını gözden geçir**

`orderDrafts.attributionChannel` düz `text`'tir (`schema.ts:551`), enum DEĞİL —
`"workshop"` değeri için migration gerekmez.

Kontrol et: `joinSession` her erken dönüşünde koltuk ya hiç alınmamıştır ya da
`releaseSeat` ile geri bırakılmıştır. `reserveSeat`'ten SONRAKİ her hata yolu
`try/catch` içindedir; aksi hâlde kontenjan sızar.

- [ ] **Step 4: Doğrula + commit**

```bash
npm run typecheck && npm run test:unit >/dev/null && echo OK
git add src/lib/services/workshop-participant.ts src/app/api/workshop
git commit -m "feat(atölye): katılım ucu, atomik koltuk rezervasyonu ve taslak"
```

---

### Task 9: Katılım formu (client)

**Files:**
- Create: `src/app/atolye/katil/[token]/join-client.tsx`

**Interfaces:**
- Consumes: `JoinView` (Task 7), `/api/upload`, `/api/workshop/join/[token]`

- [ ] **Step 1: Formu yaz**

`join-client.tsx` — `"use client"`. Akış: fotoğraf `/api/upload`'a gider
(Turnstile token'ı ile), dönen `key` forma iliştirilir, gönderim
`/api/workshop/join/<token>`'a gider ve dönen `payUrl`'e yönlendirilir.

Kritik parçalar:

```tsx
const uploadPhoto = async (file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("turnstileToken", turnstileToken);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setError(data.error || "Fotoğraf yüklenemedi.");
    return null;
  }
  return data.key as string;
};
```

Onay kutuları — içerik onayı metni `tr.ts:861`'deki mevcut cümledir ve
**çocuk fotoğrafı** durumunu kapsar (doğum günü/okul etkinlikleri):

```tsx
<label className="flex items-start gap-2 text-sm text-gray-700">
  <input type="checkbox" checked={contentConsent}
         onChange={(e) => setContentConsent(e.target.checked)} className="mt-1" />
  <span>
    Yüklediğim fotoğrafı kullanma hakkına sahip olduğumu; fotoğraftaki
    kişi(ler)in (çocuksa velisinin) açık rızasını aldığımı; görselin
    ünlü/üçüncü kişi, telifli/markalı, müstehcen, nefret söylemi veya yasa
    dışı içerik taşımadığını, aksi hâlde tüm hukuki sorumluluğun bana ait
    olduğunu kabul ediyorum.
  </span>
</label>
```

Kapalı seans durumu — form hiç render edilmez:

```tsx
if (!view.open) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900">{view.venueName}</h1>
      <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
        {view.closedReason}
      </p>
    </main>
  );
}
```

Kayıtlı e-posta hatası ayrı ele alınır (giriş bağlantısıyla):

```tsx
{error === "registered" ? (
  <p className="text-sm text-red-600">
    Bu e-posta ile kayıtlı bir hesap var.{" "}
    <a href="/login" className="font-semibold underline">Giriş yapın</a> ve tekrar deneyin.
  </p>
) : error ? (
  <p className="text-sm text-red-600">{error}</p>
) : null}
```

**Genişlik tuzağı:** tüm `<Input>`'lar `FormField` içinde, genişlik saran
grid'de. Input'un kendisine `w-*` verilmez.

- [ ] **Step 2: Elle doğrula**

```bash
npx next dev --port 3011
```
Bir seans aç, linki kopyala, gizli sekmede aç. Kontrol et: kapalı seans mesajı
doğru çıkıyor, açık seansta form görünüyor, onay kutuları işaretlenmeden
gönderilemiyor, fotoğraf yükleniyor, gönderim `/pay/<reference>`'a yönlendiriyor.
Sunucuyu durdur.

- [ ] **Step 3: Doğrula + commit**

```bash
npm run typecheck && npm run lint 2>&1 | grep "✖" && echo OK
git add src/app/atolye/katil
git commit -m "feat(atölye): public katılım formu — fotoğraf, onaylar ve ödemeye yönlendirme"
```

---

### Task 10: Ödeme → sipariş bağlantısı ve koltuk serbest bırakma

**Files:**
- Modify: `src/lib/services/order-draft.ts`
- Modify: `src/lib/queue/workers/payment-deadline.worker.ts`

**Interfaces:**
- Consumes: `releaseSeat` (Task 8)
- Produces: promote sonrası `workshopParticipants.orderId` dolu, `orders.workshopSessionId` dolu

- [ ] **Step 1: Promote sırasında atölye bağını kur**

`src/lib/services/order-draft.ts` — tekil sipariş promote bloğunda (cart değil),
`orders` INSERT'ünden SONRA:

```ts
    // Atölye katılımcısıysa siparişi seansa bağla. Katılımcı kaydı taslak
    // üzerinden bulunur; sipariş = ödenmiş sipariş olduğu için bu, katılımcının
    // "ödedi" anıdır.
    const participant = await tx
      .update(workshopParticipants)
      .set({ orderId: order.id, status: "paid", updatedAt: new Date() })
      .where(eq(workshopParticipants.draftId, draft.id))
      .returning({ sessionId: workshopParticipants.sessionId });
    if (participant.length > 0) {
      await tx
        .update(orders)
        .set({ workshopSessionId: participant[0].sessionId })
        .where(eq(orders.id, order.id));
    }
```

- [ ] **Step 2: Taslak süresi dolunca koltuğu bırak**

`src/lib/queue/workers/payment-deadline.worker.ts` — taslağı `expired` yapan
bloğun ardına:

```ts
  // Atölye koltuğu rezervasyonu ödeme başlarken alınır; ödeme gelmezse geri
  // bırakılmalı, yoksa ödemeyen biri koltuğu süresiz tutar ve kontenjan sızar.
  const [participant] = await db
    .update(workshopParticipants)
    .set({ status: "cancelled", cancelReason: "Ödeme süresi doldu", updatedAt: new Date() })
    .where(
      and(
        eq(workshopParticipants.draftId, draft.id),
        eq(workshopParticipants.status, "pending_payment")
      )
    )
    .returning({ sessionId: workshopParticipants.sessionId });
  if (participant) {
    await releaseSeat(participant.sessionId).catch((e) =>
      console.error("workshop releaseSeat failed", e)
    );
  }
```

- [ ] **Step 3: Uçtan uca elle doğrula**

Dev sunucusunda: seans aç → linkten katıl → `/pay/<reference>` sayfasına git →
admin panelinden "havale ödendi işaretle" ile promote et →
`/admin/workshops/sessions/<id>`'de katılımcının `paid` olduğunu ve siparişin
`workshopSessionId` taşıdığını doğrula:

```bash
set -a && . ./.env && set +a
docker exec postgres psql "$DATABASE_URL" -tAc \
  "SELECT o.order_number, o.workshop_session_id, o.production_base_kurus, o.painting_price_kurus, o.needs_painting
     FROM orders o WHERE o.workshop_session_id IS NOT NULL ORDER BY o.created_at DESC LIMIT 3;"
```
Beklenen: `workshop_session_id` dolu, `production_base_kurus = 135000`,
`painting_price_kurus = 0`, `needs_painting = f`.

- [ ] **Step 4: Doğrula + commit**

```bash
npm run typecheck && npm run test:unit >/dev/null && echo OK
git add src/lib/services/order-draft.ts src/lib/queue/workers/payment-deadline.worker.ts
git commit -m "feat(atölye): ödeme sonrası sipariş-seans bağı ve koltuk serbest bırakma"
```

---

### Task 11: Üretici ön rezervasyonu ve seans kapanış worker'ı

**Files:**
- Create: `src/app/api/manufacturer/workshop-sessions/[id]/commit/route.ts`
- Create: `src/lib/queue/workers/workshop-close.worker.ts`
- Modify: `src/lib/queue/queues.ts`
- Modify: `workers/start.ts`
- Modify: `src/lib/services/workshop-session.ts` (kapanış mantığı)

**Interfaces:**
- Consumes: `workshopCommissionRateBps` (Task 1), `findSessionsDueToClose` (Task 5)
- Produces: `closeSession(sessionId): Promise<{ orderCount: number; commissionRateBps: number } | { error: string }>`

- [ ] **Step 1: Kapanış mantığını yaz**

`src/lib/services/workshop-session.ts`'e ekle:

```ts
/**
 * Seansı kapatır: sipariş adedini sabitler, komisyon oranını merdivenden
 * hesaplayıp DONDURUR ve tüm partiyi ön rezerve üreticiye düşürür.
 *
 * Oran seansın TÜM siparişlerine aynı değerle yazılır — erken katılan %60,
 * geç katılan %40 almaz. Üretici seans açılışında zaten taahhüt ettiği için
 * soğuk atama + 24 saat kabul beklemesi yoktur; bu, 5 günlük pencereyi
 * gerçekçi kılan şeydir.
 */
export async function closeSession(
  sessionId: string
): Promise<{ orderCount: number; commissionRateBps: number } | { error: string }> {
  return db.transaction(async (tx) => {
    const [s] = await tx
      .update(workshopSessions)
      .set({ status: "closed", updatedAt: new Date() })
      .where(and(eq(workshopSessions.id, sessionId), eq(workshopSessions.status, "open")))
      .returning();
    if (!s) return { error: "Seans açık değil" };

    const paid = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.workshopSessionId, sessionId));
    const orderCount = paid.length;
    const commissionRateBps = workshopCommissionRateBps(orderCount);

    await tx
      .update(workshopSessions)
      .set({
        commissionRateBps,
        status: orderCount > 0 ? "in_production" : "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(workshopSessions.id, sessionId));

    if (orderCount > 0 && s.manufacturerId) {
      await tx
        .update(orders)
        .set({
          manufacturerId: s.manufacturerId,
          // Üretici seansı açılışta taahhüt etti: kabul beklemesi yok.
          manufacturerStatus: "accepted",
          assignedToManufacturerAt: new Date(),
          manufacturerAcceptedAt: new Date(),
          commissionRateBps,
          updatedAt: new Date(),
        })
        .where(eq(orders.workshopSessionId, sessionId));
    }

    return { orderCount, commissionRateBps };
  });
}
```

Gerekli importları ekle: `orders`, `workshopCommissionRateBps`.

- [ ] **Step 2: Kuyruğu tanımla**

`src/lib/queue/queues.ts` — `getModelApprovalSlaQueue` deseninin birebir aynısı:

```ts
let workshopCloseQueue: Queue | null = null;

/**
 * Saatlik süpürme: kapanış zamanı geçmiş atölye seanslarını kapatır, komisyon
 * oranını dondurur ve partiyi üreticiye düşürür. Kimse izlemezse seans açık
 * kalır ve siparişler üretime hiç girmez.
 */
export function getWorkshopCloseQueue(): Queue {
  if (!workshopCloseQueue) {
    workshopCloseQueue = new Queue("workshop-close", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // Tek deneme: süpürme idempotent ve bir saat sonra tekrar koşuyor.
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return workshopCloseQueue;
}
```

- [ ] **Step 3: Worker'ı yaz**

`src/lib/queue/workers/workshop-close.worker.ts`:

```ts
import { Worker } from "bullmq";
import { getRedisConnection } from "@/lib/queue/queues";
import { findSessionsDueToClose, closeSession } from "@/lib/services/workshop-session";

export function startWorkshopCloseWorker() {
  return new Worker(
    "workshop-close",
    async (job) => {
      const due = await findSessionsDueToClose(new Date());
      let closed = 0;
      for (const s of due) {
        const r = await closeSession(s.id);
        if (!("error" in r)) {
          closed++;
          job.log(`session ${s.id}: ${r.orderCount} sipariş, komisyon ${r.commissionRateBps}bps`);
        }
      }
      return { scanned: due.length, closed };
    },
    { connection: getRedisConnection() }
  );
}
```

- [ ] **Step 4: `workers/start.ts`'e kaydet**

Import ekle, worker'ı başlat ve saatlik zamanlayıcıyı kur:

```ts
import { startWorkshopCloseWorker } from "../src/lib/queue/workers/workshop-close.worker";
// … getWorkshopCloseQueue'yu queues importuna ekle
const workshopCloseWorker = startWorkshopCloseWorker();

// Kapanış zamanı geçen seansları saatlik kapat, oranı dondur, partiyi ata.
getWorkshopCloseQueue().upsertJobScheduler(
  "workshop-close-hourly",
  { every: 3600000 },
  { name: "workshop-close" }
);
console.log("  - workshop-close (repeatable: every 1h)");
```

- [ ] **Step 5: Üretici taahhüt ucunu yaz**

`src/app/api/manufacturer/workshop-sessions/[id]/commit/route.ts` — üretici
kendi seansını taahhüt eder:

```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopSessions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [updated] = await db
    .update(workshopSessions)
    .set({ manufacturerCommittedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workshopSessions.id, id),
        eq(workshopSessions.manufacturerId, session.manufacturerId)
      )
    )
    .returning({ id: workshopSessions.id });
  if (!updated) return NextResponse.json({ error: "Seans bulunamadı" }, { status: 404 });
  return NextResponse.json({ success: true });
}
```

Seans `open` yapılırken üreticiye `notifyManufacturer` ile bildirim gönder;
gövdede tarih, kontenjan, kişi başı fiyat ve **merdiven tablosu** olsun.

- [ ] **Step 6: Doğrula + commit**

```bash
npm run typecheck && npm run test:unit >/dev/null && echo OK
git add src/lib/services/workshop-session.ts src/lib/queue src/app/api/manufacturer/workshop-sessions workers/start.ts
git commit -m "feat(atölye): üretici ön rezervasyonu ve seans kapanış süpürmesi"
```

---

### Task 12: Seans detay ekranı, toplu teslimat ve sözleşme güncellemesi

**Files:**
- Create: `src/app/admin/workshops/sessions/[id]/page.tsx`
- Create: `src/app/admin/workshops/sessions/[id]/session-client.tsx`
- Create: `src/app/api/admin/workshops/sessions/[id]/ship/route.ts`
- Create: `src/app/api/admin/workshops/sessions/[id]/deliver/route.ts`
- Modify: `src/lib/services/workshop-notify.ts`
- Modify: `src/lib/content/manufacturer-onboarding.ts`
- Modify: `src/lib/config/contract-versions.ts`

- [ ] **Step 1: Toplu sevk ucunu yaz**

`.../ship/route.ts` — N siparişi TEK işlemde `shipped` yapar:

```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, workshopSessions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { batchShipSchema } from "@/lib/validators/workshop";
import { notifyWorkshopParticipantsReady } from "@/lib/services/workshop-notify";

/**
 * Seansın tüm siparişlerini TEK konsinye olarak mekana sevk eder.
 *
 * Bugün her sevk tek siparişliktir ve takip numarası zorunludur; atölye
 * partisinde N koli tek irsaliyeyle gider (ya da elden teslim edilir), bu
 * yüzden takip numarası tüm partiye ortaktır ve `elden` seçildiğinde hiç
 * gerekmez.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const parsed = batchShipSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }
  const { carrier, trackingNumber } = parsed.data;
  if (carrier !== "elden" && !trackingNumber?.trim()) {
    return NextResponse.json(
      { error: "Kargoyla sevkte takip numarası zorunludur." },
      { status: 400 }
    );
  }

  const now = new Date();
  const shipped = await db
    .update(orders)
    .set({
      status: "shipped",
      manufacturerStatus: "shipped",
      carrier,
      trackingNumber: trackingNumber?.trim() || `ATÖLYE-${id.slice(0, 8)}`,
      shippedAt: now,
      updatedAt: now,
    })
    .where(and(eq(orders.workshopSessionId, id), ne(orders.status, "shipped")))
    .returning({ id: orders.id });

  await db
    .update(workshopSessions)
    .set({
      status: "shipped",
      batchCarrier: carrier,
      batchTrackingNumber: trackingNumber?.trim() || null,
      batchShippedAt: now,
      updatedAt: now,
    })
    .where(eq(workshopSessions.id, id));

  // Katılımcı "kargoya verildi, takip no …" DEĞİL, "atölyede seni bekliyor"
  // maili alır — figürü kendisi teslim almayacak, seansta elden alacak.
  await notifyWorkshopParticipantsReady(id).catch((e) =>
    console.error("notifyWorkshopParticipantsReady failed", e)
  );

  return NextResponse.json({ shipped: shipped.length });
}
```

- [ ] **Step 2: Toplu teslim ucunu yaz**

`.../deliver/route.ts` — aynı desen; `status: "delivered"`, `deliveredAt`,
seansta `batchDeliveredAt` + `status: "delivered"`, katılımcılar `delivered`.
`shipped` olmayan siparişlere dokunma (mevcut deliver kapısıyla aynı sıra).

- [ ] **Step 3: Katılımcı bildirim şablonunu yaz**

`src/lib/services/workshop-notify.ts`'e ekle — mevcut `sendRawEmail` +
`escHtml` desenini kullan:

```ts
/**
 * Parti mekana yola çıktığında katılımcılara gider. Kargo takip maili
 * DEĞİLDİR: katılımcı figürü seansta elden alacak, evine bir şey gelmeyecek.
 */
export async function notifyWorkshopParticipantsReady(sessionId: string): Promise<void> {
  const rows = await db.query.workshopParticipants.findMany({
    where: eq(workshopParticipants.sessionId, sessionId),
    with: { session: { with: { venue: true } } },
  });
  await Promise.allSettled(
    rows
      .filter((p) => p.status !== "cancelled")
      .map((p) =>
        sendRawEmail({
          to: p.email,
          subject: "Figürün atölyede seni bekliyor 🎨",
          html: `
            <p>Merhaba ${escHtml(p.fullName)},</p>
            <p>Figürün hazır ve <strong>${escHtml(p.session.venue.name)}</strong>'da
               seni bekliyor.</p>
            <p><strong>${formatTrDateTime(p.session.startsAt)}</strong> — adres:
               ${escHtml(p.session.venue.address.adres)},
               ${escHtml(p.session.venue.address.ilce)}/${escHtml(p.session.venue.address.il)}</p>
            <p>Boyama malzemeleri atölyede hazır olacak. Görüşmek üzere!</p>
          `,
        })
      )
  );
}
```

- [ ] **Step 4: Seans detay ekranını yaz**

`page.tsx` seansı + katılımcıları + her katılımcının siparişinin
`modelGlbUrl`'ünü yükler. `session-client.tsx` gösterir:

- Seans başlığı: mekan, tarih, durum rozeti, kalan gün
- **Model sayacı**: `{hazır}/{toplam} model hazır` — modeli eksik katılımcılar
  ayrı listelenir. Bu, sistemin çözemediği tek darboğazı (admin'in kişi başı
  elle GLB üretmesi) görünür kılar.
- Komisyon satırı: sipariş adedi + donmuş oran + üreticinin toplam net payı
- Katılımcı tablosu: ad, e-posta, durum, sipariş no, model durumu
- **Toplu sevk** ve **Toplu teslim** butonları

```tsx
<div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5">
  <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-800">
    Model hazırlığı
  </h3>
  <p className="mt-2 text-2xl font-bold text-indigo-900">
    {readyCount}/{totalCount} model hazır
  </p>
  {missing.length > 0 && (
    <p className="mt-1 text-xs text-indigo-800/80">
      Eksik: {missing.map((m) => m.fullName).join(", ")}
    </p>
  )}
</div>
```

- [ ] **Step 5: Sözleşmeyi güncelle**

`src/lib/config/contract-versions.ts`:

```ts
export const MANUFACTURER_CONTRACT_VERSION = "3.1";
```

(`PAINTER_CONTRACT_VERSION` "3.0" kalır — atölye akışına boyacı hiç girmiyor.)

`src/lib/content/manufacturer-onboarding.ts` — başlıktaki sürüm satırını
`**Sürüm: 3.1 — Yürürlük tarihi: <yürürlük>**` yap ve komisyon maddesine
merdiveni ekle:

```
- **Güncel Platform komisyonu %40, üreticinin net payı ise %60'tır.**
- **Atölye partileri:** Bir atölye seansının tüm figürleri tek partide basılır.
  Parti büyüdükçe birim maliyet düştüğü için net payınız hacme göre kademelenir:
  1–2 sipariş %60, 3–5 %55, 6–10 %50, 11–15 %45, 16 ve üzeri %40. Uygulanacak
  kademe, katılım kapandığında sipariş sayısı kesinleşince belirlenir ve
  **partinin tamamına aynı oran** uygulanır. Merdiven, seansı taahhüt
  etmenizden ÖNCE panelinizde gösterilir.
```

- [ ] **Step 6: İptal ve iade yolunu yaz**

Spec §9 iki iptal senaryosu tanımlıyor ve ikisi de para iade eder.

`src/app/api/admin/workshops/sessions/[id]/cancel/route.ts` — seansı iptal eder:
her ödenmiş siparişi mevcut admin iade akışına sokar, katılımcıları `cancelled`
yapar, seansı `cancelled` yapar ve katılımcılara bilgilendirme maili atar.

```ts
  // Seans iptali: her ödenmiş sipariş iade edilir. Mevcut admin iade akışı
  // (refundOrder) kullanılır — hakediş ters kaydı, gift-card iadesi ve PayTR
  // iadesi zaten orada çözülmüş; burada ikinci bir para yolu AÇILMAZ.
  const paid = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.workshopSessionId, id));
  for (const o of paid) {
    await refundOrder(o.id, "Atölye seansı iptal edildi").catch((e) =>
      console.error(`workshop cancel: refund ${o.id} failed`, e)
    );
  }
```

`src/app/api/admin/workshops/sessions/[id]/participants/[pid]/cancel/route.ts` —
tek katılımcıyı iptal eder (modeli yetişmediyse): siparişi iade eder,
katılımcıyı `cancelled` yapar ve **koltuğu geri bırakır** (`releaseSeat`).

Önce mevcut iade fonksiyonunun tam adını ve imzasını doğrula:

```bash
grep -rn "export async function refund" src/lib/services/ src/app/api/admin/orders/\[id\]/refund/route.ts | head -3
```

Bulunan imza neyse ona göre çağır; iade mantığını YENİDEN YAZMA.

- [ ] **Step 7: Tam doğrulama + commit**

```bash
npm run typecheck && npm run lint 2>&1 | grep "✖" && npm run test:unit >/dev/null && echo "TÜM KAPILAR GEÇTİ"
git add src/app/admin/workshops src/app/api/admin/workshops \
        src/lib/services/workshop-notify.ts src/lib/content/manufacturer-onboarding.ts \
        src/lib/config/contract-versions.ts
git commit -m "feat(atölye): seans detayı, toplu sevk/teslim ve sözleşme merdiven maddesi"
```

---

## Uygulama sonrası kontrol listesi

- [ ] `npm run typecheck` — 0 hata
- [ ] `npm run lint` — 0 error
- [ ] `npm run test:unit` — tümü geçer (`test-workshop.ts` dâhil)
- [ ] Migration gidiş-dönüşü (up → down → up) scratch şemada doğrulandı
- [ ] Uçtan uca elle: mekan → seans → link → katılım → ödeme → model → toplu sevk → toplu teslim
- [ ] **Operatör aksiyonu:** üretici sözleşmesi 3.1 için 15 günlük bildirim
      (2026-09-01'deki %35→%40 bildirimiyle birleştirilebilir)
