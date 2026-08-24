# Kişiye Özel Figür Yeniden Fiyatlandırma + AI Crawler Erişimi — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kişiye özel figürü tek bir ürüne indirmek (15 cm, reçine, profesyonel el boyamalı, ₺3.499) ve AI arama motorlarının siteyi tarayabilmesini engelleyen üç yapısal tıkanıklığı kaldırmak.

**Architecture:** A paketi saf uygulama katmanı — `src/lib/config/sizes.ts` ve `prices.ts` tek kaynak olduğu için değişiklik oradan yayılıyor; migration gerekmiyor (boyut kolonu migration 0036'dan beri `text`, `hand_painted` bitişi enum'da zaten var). B0 paketi üç bağımsız düzeltme: robots.txt bot politikası, ürün görselleri için imzasız kalıcı bir `/media` route'u, ve DB'den beslenen sitemap.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM, PostgreSQL. Test: ad-hoc `tsx scripts/test-*.ts` betikleri (`npm run test:unit` hepsini çalıştırır), `npx tsc --noEmit` de facto doğruluk kapısı.

**Spec:** `docs/superpowers/specs/2026-08-24-ai-arama-gorunurlugu-design.md`

## Global Constraints

- **Fiyat:** `FIGURINE_PRICE_KURUS = 349900` (₺3.499, KDV dahil). Tüm fiyatlar kuruş cinsinden tamsayı.
- **Boyut:** tek preset `standart`, `heightMm: 150` (15 cm). Emekli tier'lar `kucuk`/`orta`/`buyuk` yalnızca geçmiş kayıtların gösterimi için çözülür — satılamaz, fiyatlanamaz.
- **Malzeme:** yalnızca `resin`. `filament` yeni siparişte kapalı.
- **Bitiş:** yeni her sipariş `hand_painted` saklar. Boyama ek ücret değil, taban fiyata dahil.
- **Boyacı hakedişi:** `PAINTING_PORTION_KURUS = 100000` (₺1.000). Bu sabit kaldırılırsa boyacılar ₺0 kazanır.
- **Migration YOK.** Hiçbir task `drizzle/` altına dosya eklemez. Şema değişikliği gerektiğini düşünüyorsan dur ve sor.
- **`src/lib/config/*` altında `import "server-only"` YASAK** — BullMQ worker'ları `order-draft.ts` üzerinden bu modüllere ulaşıyor ve standalone Node worker crash-loop'a girer (2026-06-13'te yaşandı, fix `470bf22`).
- **Sözlük senkronu:** `tr.ts`'e eklenen her anahtar `en.ts`'e de eklenir — `en.ts` `Dictionary` tipinin kaynağı, eksik anahtar `tsc` hatası verir. Site Türkçe-only, ama tip için ikisi de gerekli.
- **Commit mesajları:** düz conventional commit. **Hiçbir AI/Claude izi, `Co-Authored-By` trailer'ı veya "Generated with" satırı EKLENMEZ** (kullanıcının global kuralı).
- **Para birimi gösterimi:** Türkçe gruplama, `toLocaleString("tr-TR")`.

---

### Task 1: Boyut config — tek satılabilir preset, emekli tier'lar gösterimde yaşar

**Files:**
- Modify: `src/lib/config/sizes.ts`
- Test: `scripts/test-sizes.ts`

**Interfaces:**
- Consumes: yok (en alt katman).
- Produces:
  - `SIZE_PRESETS: readonly [{ key: "standart", heightMm: 150, labelKey: "sizes.standart", labelTr: "Standart" }]`
  - `SIZE_PRESET_KEYS: readonly ["standart"]`, `type SizePresetKey = "standart"`
  - `LEGACY_SIZE_PRESETS` — `kucuk`/`orta`/`buyuk`, salt gösterim
  - `isSizePreset(v: unknown): v is SizePresetKey` — yalnızca `"standart"` için true
  - `isLegacySizePreset(v: unknown): boolean`
  - `presetHeightMm(key: string): number | null` — **imza değişti**, artık `string` alıp `null` dönebiliyor
  - `sizeDisplay(size, d, opts?)` / `sizeDisplayTr(size, opts?)` — emekli key'leri de çözer

- [ ] **Step 1: Write the failing test**

`scripts/test-sizes.ts` dosyasının sonundaki çalıştırıcı bloğun ÜSTÜNE ekle (mevcut `test(...)` çağrılarının yanına). Dosyanın import bloğunu da genişlet:

```ts
import {
  SIZE_PRESETS,
  SIZE_PRESET_KEYS,
  LEGACY_SIZE_PRESETS,
  isSizePreset,
  isLegacySizePreset,
  presetHeightMm,
  sizeDisplayTr,
} from "../src/lib/config/sizes";
```

```ts
test("tek satılabilir preset: standart 15 cm", () => {
  assert.equal(SIZE_PRESETS.length, 1);
  assert.equal(SIZE_PRESETS[0].key, "standart");
  assert.equal(SIZE_PRESETS[0].heightMm, 150);
  assert.deepEqual([...SIZE_PRESET_KEYS], ["standart"]);
});

test("emekli tier'lar satılamaz ama çözülebilir", () => {
  for (const key of ["kucuk", "orta", "buyuk"]) {
    assert.equal(isSizePreset(key), false, `${key} satılabilir olmamalı`);
    assert.equal(isLegacySizePreset(key), true, `${key} emekli olarak tanınmalı`);
    assert.notEqual(presetHeightMm(key), null, `${key} yüksekliği çözülmeli`);
  }
  assert.equal(isSizePreset("standart"), true);
  assert.equal(isLegacySizePreset("standart"), false);
  assert.equal(presetHeightMm("standart"), 150);
  assert.equal(presetHeightMm("bilinmeyen"), null);
});

test("emekli boyutlar admin panelinde ham key olarak görünmez", () => {
  // Regresyon: sizeDisplay eskiden yalnızca SIZE_PRESETS'e bakıyordu; emekli
  // key'ler bulunamayınca fonksiyon ham "orta" string'ini döndürüyordu.
  assert.equal(sizeDisplayTr("orta"), "Orta (~8 cm)");
  assert.equal(sizeDisplayTr("buyuk", { short: true }), "~12 cm");
  assert.equal(sizeDisplayTr("standart"), "Standart (~15 cm)");
  // Serbest metin ölçü aynen geçer.
  assert.equal(sizeDisplayTr("17,5 cm"), "17,5 cm");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-sizes.ts`
Expected: FAIL — `SIZE_PRESETS.length` 3 (1 beklenirken), ve `LEGACY_SIZE_PRESETS` / `isLegacySizePreset` export edilmediği için TypeScript/runtime hatası.

- [ ] **Step 3: Write minimal implementation**

`src/lib/config/sizes.ts` — `SIZE_PRESETS` bloğundan `isSizePreset`/`presetHeightMm`/`sizeDisplay`/`sizeDisplayTr` sonuna kadarki kısmı şununla değiştir:

```ts
/**
 * The ONE sellable preset. Since 2026-08-24 the custom figurine is a single
 * product: 15 cm, SLA resin, professionally hand-painted. `heightMm` is the ONE
 * place the nominal height lives.
 */
export const SIZE_PRESETS = [
  { key: "standart", heightMm: 150, labelKey: "sizes.standart", labelTr: "Standart" },
] as const;

export const SIZE_PRESET_KEYS = ["standart"] as const;
export type SizePresetKey = (typeof SIZE_PRESET_KEYS)[number];

/**
 * Retired tiers. Orders, drafts and previews written before 2026-08-24 still
 * carry these keys, so display helpers MUST resolve them — otherwise the admin
 * panel renders a raw "orta". They are deliberately NOT sellable and NOT
 * priceable: `isSizePreset` rejects them, so `itemPriceKurus` throws
 * `UnpricedSizeError` and a reorder is re-quoted by hand.
 */
export const LEGACY_SIZE_PRESETS = [
  { key: "kucuk", heightMm: 60, labelKey: "sizes.kucuk", labelTr: "Küçük" },
  { key: "orta", heightMm: 80, labelKey: "sizes.orta", labelTr: "Orta" },
  { key: "buyuk", heightMm: 120, labelKey: "sizes.buyuk", labelTr: "Büyük" },
] as const;

/** Every preset ever sold — for display lookups only, never for pricing. */
const ALL_PRESETS = [...SIZE_PRESETS, ...LEGACY_SIZE_PRESETS] as ReadonlyArray<{
  key: string;
  heightMm: number;
  labelKey: string;
  labelTr: string;
}>;

/** Quick-fill chips (cm) for the bespoke size field in the admin panels. */
export const SIZE_PRESETS_CM = [6, 8, 10, 12, 15, 18, 20, 25] as const;

/** Max stored/typed length of a free-form size. */
export const SIZE_TEXT_MAX = 40;

/** True only for a size the public flow may sell and price. */
export function isSizePreset(v: unknown): v is SizePresetKey {
  return (
    typeof v === "string" && (SIZE_PRESET_KEYS as readonly string[]).includes(v)
  );
}

/** True for a retired tier — resolvable for display, never priceable. */
export function isLegacySizePreset(v: unknown): boolean {
  return (
    typeof v === "string" &&
    LEGACY_SIZE_PRESETS.some((p) => p.key === v)
  );
}

/** Nominal height for any preset key ever sold; null for free-form/unknown. */
export function presetHeightMm(key: string): number | null {
  return ALL_PRESETS.find((p) => p.key === key)?.heightMm ?? null;
}
```

Ardından `sizeDisplay` ve `sizeDisplayTr` içindeki `SIZE_PRESETS.find(...)` çağrılarını `ALL_PRESETS.find(...)` yap (her iki fonksiyonda birer tane).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-sizes.ts && npx tsc --noEmit`
Expected: test-sizes PASS. `tsc` bu aşamada `src/app/create/page.tsx` ve `src/lib/config/prices.ts` kaynaklı hatalar verebilir — Task 2 ve Task 4 onları kapatacak. **`tsc` hatası yalnızca bu iki dosyadan geliyorsa devam et; başka dosyadan geliyorsa dur ve incele.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/sizes.ts scripts/test-sizes.ts
git commit -m "feat(sizes): tek satılabilir boyut (15 cm), emekli tier'lar gösterimde kalır"
```

---

### Task 2: Fiyat config — sabit ₺3.499 ve boyacı payının açık sabiti

**Files:**
- Modify: `src/lib/config/prices.ts`
- Test: `scripts/test-prices.ts`

**Interfaces:**
- Consumes: Task 1'den `isSizePreset`, `SizePresetKey`.
- Produces:
  - `FIGURINE_PRICE_KURUS = 349900`
  - `PAINTING_PORTION_KURUS = 100000`
  - `figurinePriceKurus(size?: string, material?: string): number` — **her zaman** `FIGURINE_PRICE_KURUS`
  - `paintingPortionKurus(finish): number` — `hand_painted`/`luxe_display` için `PAINTING_PORTION_KURUS`, diğerlerinde 0
  - `FINISH_SURCHARGES_KURUS` — dört bitişin hepsi 0
  - `itemPriceKurus` — imza değişmedi

- [ ] **Step 1: Write the failing test**

`scripts/test-prices.ts` — mevcut `"resin base prices per size"`, `"filament base prices (₺899 floor, +₺300 steps)"` ve `"finish surcharges: paint +₺1.000, luxe +₺2.000, raw −₺100"` testlerini SİL, yerine ekle. Import bloğunu güncelle:

```ts
import assert from "node:assert/strict";
import {
  figurinePriceKurus,
  finishSurchargeKurus,
  paintingPortionKurus,
  itemPriceKurus,
  UnpricedSizeError,
  FIGURINE_PRICE_KURUS,
  PAINTING_PORTION_KURUS,
} from "../src/lib/config/prices";
```

```ts
test("kişiye özel figür tek fiyat: ₺3.499", () => {
  assert.equal(FIGURINE_PRICE_KURUS, 349900);
  assert.equal(figurinePriceKurus("standart", "resin"), 349900);
  // Argümanlar artık fiyatı etkilemiyor — tek ürün.
  assert.equal(figurinePriceKurus("standart", "filament"), 349900);
});

test("boyama taban fiyata dahil, bitiş ek ücreti yok", () => {
  assert.equal(finishSurchargeKurus("hand_painted"), 0);
  assert.equal(finishSurchargeKurus("paintable_kit"), 0);
  assert.equal(finishSurchargeKurus("luxe_display"), 0);
  assert.equal(finishSurchargeKurus("collector_raw"), 0);
  // Uçtan uca: standart figür + hand_painted = tam ₺3.499, ek yok.
  assert.equal(
    itemPriceKurus({ kind: "figure", size: "standart", material: "resin", finish: "hand_painted" }),
    349900
  );
});

test("boyacı payı bitiş ek ücretinden BAĞIMSIZ olarak korunur", () => {
  // Regresyon koruması: paintingPortionKurus eskiden değeri
  // FINISH_SURCHARGES_KURUS.hand_painted'tan okuyordu. Boyama taban fiyata
  // gömülüp o ek ücret 0'a indiği için, açık sabit olmasa boyacılar ₺0 alırdı.
  assert.equal(PAINTING_PORTION_KURUS, 100000);
  assert.equal(paintingPortionKurus("hand_painted"), 100000);
  assert.equal(paintingPortionKurus("luxe_display"), 100000);
  assert.notEqual(paintingPortionKurus("hand_painted"), finishSurchargeKurus("hand_painted"));
  // Boyama içermeyen eski bitişler 0 kalır.
  assert.equal(paintingPortionKurus("paintable_kit"), 0);
  assert.equal(paintingPortionKurus("collector_raw"), 0);
  assert.equal(paintingPortionKurus(null), 0);
});

test("emekli boyutlar fiyatlanamaz — elle teklife düşer", () => {
  for (const size of ["kucuk", "orta", "buyuk", "17,5 cm"]) {
    assert.throws(
      () => itemPriceKurus({ kind: "figure", size, material: "resin", finish: "hand_painted" }),
      UnpricedSizeError,
      `${size} için UnpricedSizeError beklenir`
    );
  }
});

test("Creative Lab düz fiyatları boyuttan etkilenmez", () => {
  // Creative Lab ürünleri figurineSize'ı nötr "orta" olarak saklıyor; "orta"
  // artık fiyatlanamaz olduğu için bu erken dönüşün korunması şart.
  assert.equal(
    itemPriceKurus({ kind: "keychain", size: "orta", material: "resin" }),
    14900
  );
  assert.equal(
    itemPriceKurus({ kind: "fridge_magnet", size: "orta", material: "resin" }),
    12900
  );
  assert.equal(itemPriceKurus({ kind: "lamp", size: "orta", material: "resin" }), 39900);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-prices.ts`
Expected: FAIL — `FIGURINE_PRICE_KURUS` ve `PAINTING_PORTION_KURUS` export edilmiyor.

- [ ] **Step 3: Write minimal implementation**

`src/lib/config/prices.ts` — `FIGURINE_PRICES_KURUS` / `PRICES_KURUS` / `figurinePriceKurus` bloğunu şununla değiştir:

```ts
/**
 * Custom character figurine — ONE product since 2026-08-24: 15 cm, SLA resin,
 * professionally hand-painted, display-ready, free domestic shipping. No size
 * tiers, no material choice, no paint-kit variant. A different size or a custom
 * design is quoted by hand over WhatsApp (see `UnpricedSizeError`).
 *
 * Tune freely — this is the single source.
 */
export const FIGURINE_PRICE_KURUS = 349900;

/**
 * The painting share of `FIGURINE_PRICE_KURUS` — the painter partner's earning
 * base.
 *
 * Painting used to be a ₺1.000 `hand_painted` surcharge and
 * `paintingPortionKurus()` read the number straight out of
 * `FINISH_SURCHARGES_KURUS`. Now that painting is bundled into the base price
 * that surcharge is 0, so the share MUST be stated explicitly here. Delete this
 * constant and every painter earns ₺0 on every order.
 */
export const PAINTING_PORTION_KURUS = 100000;

/**
 * Price of a custom figurine. `size` and `material` are accepted for call-site
 * compatibility but no longer affect the price — there is one product.
 */
export function figurinePriceKurus(_size?: string, _material?: string): number {
  return FIGURINE_PRICE_KURUS;
}
```

`FigurineFinish` tipini olduğu gibi bırak, `FINISH_SURCHARGES_KURUS`'u değiştir:

```ts
/**
 * Finish surcharges — all zero since 2026-08-24. The single product bundles
 * professional hand painting into `FIGURINE_PRICE_KURUS`, so there is no finish
 * price axis left. The table is kept (rather than deleted) because `finish` is
 * still stored per order and rows written before this date reference all four
 * values; `finishSurchargeKurus` must resolve them to 0 rather than `undefined`.
 */
export const FINISH_SURCHARGES_KURUS: Record<FigurineFinish, number> = {
  paintable_kit: 0,
  collector_raw: 0,
  hand_painted: 0,
  luxe_display: 0,
};
```

`paintingPortionKurus`'u değiştir:

```ts
/**
 * The part of an order that pays for PROFESSIONAL PAINTING, i.e. the painter
 * partner's earning base. Reads the explicit `PAINTING_PORTION_KURUS` constant,
 * NOT the finish surcharge table — the surcharge is 0 now that painting is
 * bundled into the base price.
 *
 * Legacy orders whose finish never included painting still resolve to 0.
 */
export function paintingPortionKurus(finish: string | null | undefined): number {
  if (finish === "hand_painted" || finish === "luxe_display") {
    return PAINTING_PORTION_KURUS;
  }
  return 0;
}
```

`PRICES_KURUS` export'unu kaldır. Kaldırdıktan sonra `grep -rn "PRICES_KURUS" src scripts` çalıştır ve kalan referansları temizle (`FIGURINE_PRICES_KURUS`, `OBJECT_PRICES_KURUS`, `UPSELL_PRICES_KURUS`, `CREATIVE_LAB_PRICES_KURUS` gibi başka isimlerle karışmamaya dikkat — yalnızca tam `PRICES_KURUS` eşleşmesi).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-prices.ts`
Expected: PASS (5 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/prices.ts scripts/test-prices.ts
git commit -m "feat(prices): kişiye özel figür sabit ₺3.499, boyacı payı açık sabite taşındı"
```

---

### Task 3: Sipariş doğrulama + reorder korumasında Creative Lab regresyonunu önle

**Files:**
- Modify: `src/lib/validators/order.ts:48-60` (`createOrderSchema` — `material` alanı)
- Modify: `src/app/api/customer/orders/[orderNumber]/reorder/route.ts:88-102` (reorderability guard)
- Test: `scripts/test-api-contracts.ts`

**Interfaces:**
- Consumes: Task 1'den `isSizePreset`, Task 2'den `itemPriceKurus`.
- Produces: davranış değişikliği, yeni export yok. `createOrderSchema` artık `material: "resin"` dışını reddeder. Reorder guard `priceKindForStyle` sonucuna göre dallanır.

- [ ] **Step 1: Write the failing test**

`scripts/test-api-contracts.ts` sonuna ekle (dosyanın mevcut `test()` yardımcısını kullan; yoksa `test-prices.ts`'teki aynı 6 satırlık yardımcıyı kopyala):

```ts
import { createOrderSchema } from "../src/lib/validators/order";

test("sipariş doğrulama: yalnızca reçine ve standart boyut kabul edilir", () => {
  const base = {
    photoKey: "uploads/x.webp",
    figurineSize: "standart",
    style: "realistic",
    material: "resin",
    finish: "hand_painted",
    shippingAddress: {
      adSoyad: "Test Kullanıcı",
      adres: "Test Mahallesi 1",
      il: "Ankara",
      ilce: "Etimesgut",
      postaKodu: "06790",
      telefon: "+905551112233",
    },
  };
  assert.equal(createOrderSchema("tr").safeParse(base).success, true);
  // Filament artık satılmıyor.
  assert.equal(
    createOrderSchema("tr").safeParse({ ...base, material: "filament" }).success,
    false
  );
  // Emekli tier'lar reddedilir.
  assert.equal(
    createOrderSchema("tr").safeParse({ ...base, figurineSize: "orta" }).success,
    false
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-api-contracts.ts`
Expected: FAIL — `material: "filament"` hâlâ geçerli sayılıyor (`success` true dönüyor, false bekleniyor).

- [ ] **Step 3: Write minimal implementation**

**3a.** `src/lib/validators/order.ts` — `createOrderSchema` içindeki `material` satırını değiştir:

```ts
    // One product, one material: 15 cm SLA resin. Filament is no longer sold.
    // Existing orders keep whatever they stored; this only gates NEW orders.
    material: z.enum(["resin"]).default("resin"),
```

Aynı fonksiyondaki `figurineSize` yorumunu güncelle (davranış Task 1'den otomatik geliyor, `SIZE_PRESET_KEYS` artık tek elemanlı):

```ts
    // One sellable size (`standart`, 15 cm). A bespoke measurement is quoted by
    // hand over WhatsApp, so it never reaches this schema.
    figurineSize: z.enum(SIZE_PRESET_KEYS, {
      error: d["validator.size.invalid"],
    }),
```

**3b.** `src/app/api/customer/orders/[orderNumber]/reorder/route.ts` — reorderability guard'ını değiştir. Mevcut blok (`if (order.orderType === "marketplace" || !order.figurineSize || !isPriceableSize(order.figurineSize))`) şununla değişir:

```ts
  // Creative Lab products (keychain / fridge magnet / lamp) are flat-priced and
  // store `figurineSize` as a neutral "orta". Since 2026-08-24 "orta" is a
  // retired tier and no longer priceable, so an unconditional isPriceableSize
  // guard here would wrongly block every Creative Lab reorder — itemPriceKurus
  // returns before it even looks at the size for those kinds.
  const reorderKind = priceKindForStyle(order.style);
  const isFlatPriced =
    reorderKind === "keychain" ||
    reorderKind === "fridge_magnet" ||
    reorderKind === "lamp";

  // A retired-tier or bespoke figurine has no catalogue price — itemPriceKurus
  // would throw, and before the guard existed it silently priced the reorder at
  // ₺0. Those are re-quoted by hand, so they are not self-service reorderable.
  if (
    order.orderType === "marketplace" ||
    (!isFlatPriced && (!order.figurineSize || !isPriceableSize(order.figurineSize)))
  ) {
    return NextResponse.json(
      { error: d["api.order.notReorderable"] },
      { status: 400 }
    );
  }
```

`priceKindForStyle` bu dosyada zaten import edilmiş durumda (aşağıda `amountKurus` hesabında kullanılıyor). Değilse `@/lib/create/design-templates`'ten ekle.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-api-contracts.ts && npx tsx scripts/test-prices.ts`
Expected: ikisi de PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/validators/order.ts "src/app/api/customer/orders/[orderNumber]/reorder/route.ts" scripts/test-api-contracts.ts
git commit -m "fix(orders): yeni siparişte tek malzeme/boyut, Creative Lab yeniden siparişi korundu"
```

---

### Task 4: `/create` akışı — tek ürün, seçici yok, özel tasarım WhatsApp'a

**Files:**
- Modify: `src/app/create/page.tsx:185-245` (SIZES / MATERIALS / FINISHES / priceLabel blokları) ve bunları render eden JSX
- Modify: `src/lib/i18n/dictionaries/tr.ts`, `src/lib/i18n/dictionaries/en.ts` (yeni anahtarlar)

**Interfaces:**
- Consumes: Task 1 `SIZE_PRESETS`, Task 2 `FIGURINE_PRICE_KURUS` / `figurinePriceKurus`.
- Produces: UI değişikliği, yeni export yok. Form state artık her zaman `size="standart"`, `material="resin"`, `finish="hand_painted"` gönderir.

- [ ] **Step 1: Sözlük anahtarlarını ekle**

`src/lib/i18n/dictionaries/tr.ts` — `"sizes.buyuk"` satırının hemen ardına:

```ts
  "sizes.standart": "Standart",
```

Aynı dosyada, `create.*` bloğuna:

```ts
  "create.product.title": "Kişiye Özel Figürün",
  "create.product.spec": "15 cm · SLA reçine · profesyonel el boyamalı",
  "create.product.included": "Ücretsiz kargo dahil. Önizleme onayından sonra 5-7 iş günü içinde üretilir, kargo 2-3 iş günü.",
  "create.product.customSize": "Farklı bir boyut mu istiyorsun?",
  "create.product.customSizeCta": "WhatsApp'tan teklif al",
  "create.customDesign.title": "Özel tasarım siparişi",
  "create.customDesign.body": "Kendi tasarımın ya da 2D çizimden üretim için fiyat, modelin karmaşıklığına ve baskı hacmine göre belirlenir. Tasarımını gönder, aynı gün fiyat verelim.",
  "create.customDesign.cta": "WhatsApp'tan teklif al",
```

`src/lib/i18n/dictionaries/en.ts` — **aynı anahtarları** İngilizce karşılıklarıyla ekle (`en.ts` `Dictionary` tipinin kaynağı; eksik anahtar `tsc` hatası verir):

```ts
  "sizes.standart": "Standard",
  "create.product.title": "Your custom figurine",
  "create.product.spec": "15 cm · SLA resin · professionally hand-painted",
  "create.product.included": "Free shipping included. Produced in 5-7 business days after preview approval, shipping 2-3 business days.",
  "create.product.customSize": "Want a different size?",
  "create.product.customSizeCta": "Get a quote on WhatsApp",
  "create.customDesign.title": "Custom design order",
  "create.customDesign.body": "For your own design or a 2D drawing, the price depends on model complexity and print volume. Send us your design and we will quote the same day.",
  "create.customDesign.cta": "Get a quote on WhatsApp",
```

- [ ] **Step 2: Seçici bloklarını sadeleştir**

`src/app/create/page.tsx` — `SIZES`, `MATERIALS`, `FINISHES`, `baseKurus`, `finishKurus`, `priceLabel` tanımlarını şununla değiştir:

```ts
  // One product since 2026-08-24: 15 cm SLA resin, professionally hand-painted.
  // No size / material / finish axis in the public flow — a different size or a
  // custom design goes to WhatsApp for a hand quote.
  const isObjectStyle = priceKindForStyle(selectedStyle) === "object";
  const FIXED_SIZE = SIZE_PRESETS[0].key;
  const FIXED_MATERIAL = "resin" as const;
  const FIXED_FINISH = "hand_painted" as const;

  const priceLabel = Math.round(FIGURINE_PRICE_KURUS / 100).toLocaleString("tr-TR");
```

`isMultiCapable` ve `needsCompatAck` satırlarını olduğu gibi bırak.

Import bloğunu güncelle: `figurinePriceKurus`, `objectPriceKurus`, `finishSurchargeKurus`, `objectFinishSurchargeKurus` ve `formatCm` artık kullanılmıyorsa kaldır; `FIGURINE_PRICE_KURUS` ekle. `SIZE_PRESETS` ve `sizeDisplay` kullanımlarını kontrol et.

- [ ] **Step 3: JSX'i güncelle**

Boyut seçici, malzeme seçici ve bitiş seçici bölümlerini kaldır. Yerine tek ürün kartı:

```tsx
<section className="...">   {/* mevcut kart sınıflarını koru */}
  <h3>{d["create.product.title"]}</h3>
  <p>{d["create.product.spec"]}</p>
  <p className="text-2xl font-semibold">₺{priceLabel}</p>
  <p>{d["create.product.included"]}</p>
  <p>{d["create.product.customSize"]}</p>
  <WhatsAppButton
    variant="outline"
    message={`Merhaba! ${d["create.product.title"]} için farklı bir boyut istiyorum.`}
    label={d["create.product.customSizeCta"]}
  />
</section>
```

`isObjectStyle === true` olduğunda ödeme akışının tamamı yerine teklif bloğu render edilir:

```tsx
{isObjectStyle ? (
  <section className="...">
    <h3>{d["create.customDesign.title"]}</h3>
    <p>{d["create.customDesign.body"]}</p>
    <WhatsAppButton
      message="Merhaba! Özel tasarım siparişi için fiyat almak istiyorum."
      label={d["create.customDesign.cta"]}
    />
  </section>
) : (
  /* mevcut sipariş/ödeme akışı */
)}
```

`WhatsAppButton`'ı `@/components/whatsapp/whatsapp-button` üzerinden import et. **Prop imzası doğrulandı** (`src/components/whatsapp/whatsapp-button.tsx:21-26`): `{ message?: string; label: string; variant?: "solid" | "outline"; className?: string }` — `label` ZORUNLU ve bileşen `children` KABUL ETMEZ, metin `label` ile geçilir. Hook kullanmıyor, server component'ten de render edilebilir.

Form submit payload'ında `figurineSize`, `material`, `finish` state'lerini sabitlerle değiştir: `figurineSize: FIXED_SIZE`, `material: FIXED_MATERIAL`, `finish: FIXED_FINISH`. Bu üç alanın `useState`'lerini ve setter'larını kaldır.

- [ ] **Step 4: Doğrula**

Run: `npx tsc --noEmit && npm run lint`
Expected: sıfır hata. `tsc` hâlâ hata veriyorsa kaldırılmamış bir seçici referansı kalmış demektir — hata satırını takip et.

Sonra yerel olarak aç (kullanıcının 3005 portundaki dev ortamını rahatsız etme — ayrı port kullan):

Run: `npx next dev --port 3099`
Elle kontrol: `http://localhost:3099/create` → tek ürün kartı, ₺3.499 yazıyor, boyut/malzeme/bitiş seçici YOK. `?path=` ile obje/tasarım yoluna geçince teklif bloğu görünüyor.

- [ ] **Step 5: Commit**

```bash
git add src/app/create/page.tsx src/lib/i18n/dictionaries/tr.ts src/lib/i18n/dictionaries/en.ts
git commit -m "feat(create): tek ürün kartı (15 cm, ₺3.499), özel tasarım teklif akışına yönlendirildi"
```

---

### Task 5: Metin katmanı — "boyama kiti" → "profesyonel el boyaması"

**Files:**
- Modify: `src/lib/i18n/dictionaries/tr.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`

**Interfaces:**
- Consumes: yok.
- Produces: yalnızca metin. Anahtar adları DEĞİŞMEZ (bileşenler onlara referans veriyor), yalnızca değerler.

- [ ] **Step 1: Etkilenen anahtarları listele**

Run:
```bash
cd /home/tarik/Projects/printer
grep -n "boyama kiti\|Boyama Kiti\|boyama seti\|Boyama Seti\|paint kit\|₺999\|₺899\|999'dan\|899'dan" src/lib/i18n/dictionaries/tr.ts src/lib/i18n/dictionaries/en.ts
```

Çıkan her satırı aşağıdaki kurala göre elden geçir. **Anahtar adını değiştirme.**

- [ ] **Step 2: Değerleri yeniden yaz**

Kurallar:
- "boyama kiti dahil" → "profesyonel el boyamasıyla, sergilemeye hazır"
- "boyama kitiyle kapına gönderelim" → "profesyonel el boyamasıyla boyayıp kapına gönderelim"
- "₺999'dan başlayan" / "₺899'dan başlayan" → "₺3.499" (tek sabit fiyat; "başlayan" ifadesi kalkar — artık tek fiyat var)
- Kutu içeriği anlatan metinlerde "boya seti + fırça + rehber" kalemleri kaldırılır, yerine "sertifikalı kutu + hatıra karekodu" gibi mevcut gerçek kalemler bırakılır (uydurma kalem EKLEME — `/on-bilgilendirme` ve `kargo` sayfalarındaki mevcut kutu içeriği listesini kaynak al)

Bilinen SSS anahtarları (`tr.ts:1269-1285`):
- `landing.faq.q3`/`a3` (boyut) → "Figürler tek ölçüde mi?" / "Standart figürümüz 15 cm. Farklı bir ölçü isterseniz WhatsApp'tan özel sipariş verebilirsiniz."
- `landing.faq.q4`/`a4` (boyama) → "Figürü ben mi boyuyorum?" / "Hayır. Figürünüz atölyemizde profesyonel olarak el ile boyanır ve sergilemeye hazır gelir."
- `landing.faq.a6` (malzeme) — "SLA 3D baskı ile yüksek kaliteli fotopolimer reçine" ifadesi DOĞRU, korunur.
- `landing.faq.a7` (iade) — **BU TASK'TA DOKUNULMAZ.** Ayrı hukuk araştırmasının çıktısını bekliyor (spec §4).

- [ ] **Step 3: Doğrula**

Run: `npx tsc --noEmit`
Expected: sıfır hata (anahtar adı değişmediği için tip kırılmaz).

Run:
```bash
grep -c "boyama kiti\|Boyama Kiti" src/lib/i18n/dictionaries/tr.ts
```
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/dictionaries/tr.ts src/lib/i18n/dictionaries/en.ts
git commit -m "copy: ürün vaadi profesyonel el boyaması olarak güncellendi, tek fiyat ₺3.499"
```

---

### Task 6: Yasal ve bilgilendirme sayfalarındaki fiyat/ürün tablosu

**Files:**
- Modify: `src/app/on-bilgilendirme/page.tsx` (§2 fiyat tablosu)
- Modify: `src/app/kargo/page.tsx` (ürün tanımı, kutu içeriği)
- Modify: `src/app/iade/page.tsx` (ürün tanımı — iade POLİTİKASI metnine dokunma)
- Modify: `src/app/mesafeli-satis/page.tsx` (ürün tanımı)

**Interfaces:**
- Consumes: Task 2 `FIGURINE_PRICE_KURUS`.
- Produces: yalnızca içerik.

- [ ] **Step 1: Mevcut fiyat tablosunu bul**

Run:
```bash
grep -rn "999\|1.399\|1.799\|899\|Küçük (~6 cm)\|Orta (~8 cm)\|Büyük (~12 cm)\|filament\|Filament" src/app/on-bilgilendirme/page.tsx src/app/kargo/page.tsx src/app/iade/page.tsx src/app/mesafeli-satis/page.tsx
```

- [ ] **Step 2: `/on-bilgilendirme` §2'yi yeniden yaz**

Üç satırlık boyut×malzeme tablosu tek satıra iner:

> **Ürün ve fiyat:** Kişiye özel figür — 15 cm, SLA reçine baskı, profesyonel el boyamalı, sergilemeye hazır. **3.499 TL (KDV dahil).** Türkiye içi kargo ücretsizdir. Farklı ölçü veya özel tasarım talepleri için fiyat, talebin kapsamına göre ayrıca belirlenir ve sipariş öncesi yazılı olarak bildirilir.

**Fiyatı elle yazmak yerine `FIGURINE_PRICE_KURUS`'tan türet** ki tek kaynak korunsun:

```tsx
import { FIGURINE_PRICE_KURUS } from "@/lib/config/prices";
// ...
const fiyat = (FIGURINE_PRICE_KURUS / 100).toLocaleString("tr-TR");
// JSX içinde: {fiyat} TL (KDV dahil)
```

- [ ] **Step 3: Diğer üç sayfada ürün tanımını hizala**

`kargo`, `iade`, `mesafeli-satis` sayfalarında geçen "boyama kiti", boyut tier'ları ve filament ifadelerini Task 5'teki kurallarla aynı şekilde güncelle. **`/iade` sayfasının iade politikası bölümüne DOKUNMA** — ayrı hukuk araştırmasının çıktısını bekliyor.

Dört sayfanın "son güncelleme" tarihini `24 Ağustos 2026` yap.

- [ ] **Step 4: Doğrula**

Run: `npx tsc --noEmit && npm run lint`
Expected: sıfır hata

Run: `npx next dev --port 3099` → `/on-bilgilendirme`, `/kargo`, `/iade`, `/mesafeli-satis` sayfalarını aç, fiyatın ₺3.499 ve tek satır olduğunu, eski tier tablosunun kalmadığını gör.

- [ ] **Step 5: Commit**

```bash
git add src/app/on-bilgilendirme/page.tsx src/app/kargo/page.tsx src/app/iade/page.tsx src/app/mesafeli-satis/page.tsx
git commit -m "docs(legal): ürün tanımı ve fiyat tablosu tek ürüne göre güncellendi"
```

---

### Task 7: `robots.ts` — alıntılayıcı botları aç, eğitim botlarını kapat, ürün görsellerini serbest bırak

**Files:**
- Modify: `src/app/robots.ts`
- Create: `scripts/test-robots.ts`
- Modify: `package.json` (`test:unit` zincirine ekle)

**Interfaces:**
- Consumes: yok.
- Produces: `robots()` default export'u — `MetadataRoute.Robots`, artık `rules` bir DİZİ (üç grup: retrieval / genel / training).

- [ ] **Step 1: Write the failing test**

Create `scripts/test-robots.ts`:

```ts
import assert from "node:assert/strict";
import robots from "../src/app/robots";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

const r = robots();
const rules = Array.isArray(r.rules) ? r.rules : [r.rules!];
const agentsOf = (rule: (typeof rules)[number]) =>
  Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent!];
const ruleFor = (ua: string) =>
  rules.find((rule) => agentsOf(rule).includes(ua));
const asList = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []);

// The bots that decide whether we appear in AI answers. OpenAI's own docs:
// "Sites that are opted out of OAI-SearchBot will not be shown in ChatGPT
// search answers." Blocking any of these makes the site uncitable.
const RETRIEVAL = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "Googlebot",
  "bingbot",
  "Applebot",
];

// Pure training crawlers — blocking them costs zero citations.
const TRAINING = ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Bytespider"];

test("her alıntılayıcı bot açıkça allow edilmiş", () => {
  for (const ua of RETRIEVAL) {
    const rule = ruleFor(ua);
    assert.ok(rule, `${ua} için kural yok`);
    assert.ok(
      asList(rule!.allow).includes("/"),
      `${ua} kök dizine allow almamış`
    );
  }
});

test("saf eğitim botları disallow edilmiş", () => {
  for (const ua of TRAINING) {
    const rule = ruleFor(ua);
    assert.ok(rule, `${ua} için kural yok`);
    assert.ok(
      asList(rule!.disallow).includes("/"),
      `${ua} disallow edilmemiş`
    );
  }
});

test("ürün görselleri taranabilir, diğer /api kapalı", () => {
  for (const ua of [...RETRIEVAL, "*"]) {
    const rule = ruleFor(ua);
    if (!rule) continue;
    assert.ok(
      asList(rule.allow).includes("/api/files/products/"),
      `${ua} ürün görsellerini çekemez`
    );
    assert.ok(asList(rule.disallow).includes("/api/"), `${ua} için /api/ açık kalmış`);
  }
});

test("partner panelleri ve işlemsel URL'ler kapalı", () => {
  const wildcard = ruleFor("*");
  assert.ok(wildcard, "* kuralı yok");
  const dis = asList(wildcard!.disallow);
  for (const p of ["/admin/", "/manufacturer/", "/painter/", "/cart", "/checkout"]) {
    assert.ok(dis.includes(p), `${p} disallow listesinde yok`);
  }
});

test("facebookexternalhit asla bloklanmaz", () => {
  // WhatsApp link önizlemesini öldürür; siparişler WhatsApp'tan geliyor.
  const rule = ruleFor("facebookexternalhit");
  if (rule) {
    assert.ok(!asList(rule.disallow).includes("/"), "facebookexternalhit bloklanmış");
  }
});

test("sitemap ve host beyan edilmiş", () => {
  assert.match(String(r.sitemap), /\/sitemap\.xml$/);
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
console.log(`\n${passed}/${cases.length} robots testi geçti`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-robots.ts`
Expected: FAIL — ilk test "OAI-SearchBot için kural yok" ile patlar (şu an tek `*` kuralı var).

- [ ] **Step 3: Write minimal implementation**

`src/app/robots.ts`'i tamamen değiştir:

```ts
import type { MetadataRoute } from "next";

/**
 * Crawl policy, split by what a bot actually DOES.
 *
 * The distinction that matters: a RETRIEVAL bot fetches a page so an AI
 * assistant can answer with it and cite us; a TRAINING crawler collects text
 * for a future model and never sends anyone here. OpenAI's own docs are
 * explicit — "Sites that are opted out of OAI-SearchBot will not be shown in
 * ChatGPT search answers", while GPTBot merely "indicates a site's content
 * should not be used in training". So we allow every retrieval bot by name and
 * disallow the pure training crawlers: we get cited without feeding training
 * corpora. Nine of the eleven retrieval bots are not training crawlers at all,
 * so this costs nothing.
 *
 * `facebookexternalhit` is deliberately absent from every disallow list — it
 * renders WhatsApp/Instagram link previews, and WhatsApp is where our orders
 * come from.
 *
 * Blocked for everyone: infra (`/admin`, `/api`, `/manufacturer`, `/painter`,
 * the Sentry tunnel `/monitoring`) and transactional / token-bearing customer
 * URLs. One carve-out: `/api/files/products/` — storefront product photos are
 * served from there and a `Product.image` pointing at a robots-blocked URL is
 * dropped by Google and disapproved by Merchant Center. robots.txt matching is
 * longest-match-wins, so the 21-character Allow beats `Disallow: /api/`.
 *
 * NOT blocked (deliberately): `/account`, `/login`, `/register`,
 * `/forgot-password`. Google keeps discovering these via nav links, and a
 * robots.txt block only lands them in Search Console's "Blocked by robots.txt"
 * bucket without ever de-indexing them (Google can't read a `noindex` it isn't
 * allowed to crawl). Instead they stay crawlable and the root layout emits
 * `noindex` for them (see `@/lib/seo` → NOINDEX_PREFIXES), which actually drops
 * them from the index and clears that report.
 */

/** Fetch pages so an AI assistant can answer with — and cite — them. */
const RETRIEVAL_BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "OAI-AdsBot",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "Googlebot",
  "Googlebot-Image",
  "bingbot",
  "Applebot",
  "meta-webindexer",
  "Amzn-SearchBot",
  "Amzn-User",
  "MistralAI-Index",
  "MistralAI-User",
  "DuckAssistBot",
  "YouBot",
] as const;

/** Collect text for model training. Blocking these costs zero citations. */
const TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "meta-externalagent",
  "Amazonbot",
  "MistralAI-Training",
  "Webzio-Extended",
  "Diffbot",
  "cohere-training-data-crawler",
] as const;

/** Storefront product photos — the one `/api/` path crawlers must reach. */
const PRODUCT_IMAGES = "/api/files/products/";

const DISALLOW = [
  "/admin/",
  "/api/",
  "/manufacturer/",
  "/painter/",
  "/monitoring",
  "/cart",
  "/checkout",
  "/pay/",
  "/track/",
  "/havale/",
  "/quote/",
  "/yolculuk/",
  "/reset-password/",
  "/verify-email/",
];

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";

  return {
    rules: [
      {
        userAgent: [...RETRIEVAL_BOTS],
        allow: ["/", PRODUCT_IMAGES],
        disallow: DISALLOW,
      },
      {
        userAgent: "*",
        allow: ["/", PRODUCT_IMAGES],
        disallow: DISALLOW,
      },
      {
        userAgent: [...TRAINING_BOTS],
        disallow: ["/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    // robots.txt's `Host` directive takes a bare hostname (Yandex-only, but be
    // correct); `baseUrl` is a full URL.
    host: new URL(baseUrl).host,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-robots.ts && npx tsc --noEmit`
Expected: 6/6 robots testi PASS, `tsc` sıfır hata

Ayrıca üretilen çıktıyı gözle doğrula:

Run: `npx next dev --port 3099` sonra `curl -s http://localhost:3099/robots.txt`
Beklenen: `User-Agent: OAI-SearchBot` grubu `Allow: /` ve `Allow: /api/files/products/` içeriyor; `User-Agent: GPTBot` grubu `Disallow: /`; `Disallow: /painter/` mevcut.

- [ ] **Step 5: `test:unit` zincirine ekle ve commit et**

`package.json` içindeki `test:unit` script'ine `&& npx tsx scripts/test-robots.ts` ekle (zincirin sonuna).

```bash
git add src/app/robots.ts scripts/test-robots.ts package.json
git commit -m "feat(seo): robots.txt alıntılayıcı/eğitim botu ayrımı, ürün görselleri taranabilir"
```

---

### Task 8: İmzasız kalıcı ürün görseli URL'i

**Files:**
- Create: `src/app/media/products/[...key]/route.ts`
- Modify: `src/lib/services/storage.ts` (yeni `getPublicImageUrl` export'u)
- Modify: `src/app/page.tsx`, `src/app/shop/[slug]/page.tsx`, `src/lib/services/shop-query.ts` (çağrı yerleri)
- Create: `scripts/test-media-url.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `storage.ts`'ten mevcut `getPublicUrl`, `getFileBuffer`.
- Produces:
  - `PUBLIC_UNSIGNED_PREFIXES: readonly ["products/"]`
  - `isPublicUnsignedKey(relativePath: string): boolean`
  - `getPublicImageUrl(relativePath: string): string` — `products/` için `${appUrl}/media/products/<rest>` (query YOK), diğerleri için `getPublicUrl`'e delege

- [ ] **Step 1: Write the failing test**

Create `scripts/test-media-url.ts`:

```ts
import assert from "node:assert/strict";
import {
  getPublicImageUrl,
  isPublicUnsignedKey,
} from "../src/lib/services/storage";

process.env.NEXT_PUBLIC_APP_URL ??= "https://figurunica.com";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

test("ürün görselleri imzasız ve kalıcı URL alır", () => {
  const url = getPublicImageUrl("products/abc123.webp");
  assert.equal(url, "https://figurunica.com/media/products/abc123.webp");
  // Kritik: imza parametresi YOK — süresi dolan URL crawler'a 401 döndürüyordu.
  assert.ok(!url.includes("sig="), "imza parametresi sızmış");
  assert.ok(!url.includes("exp="), "son kullanma parametresi sızmış");
});

test("aynı anahtar her zaman aynı URL'i verir", () => {
  // Cache ve og:image kararlılığı için: imzalı URL'ler 24 saatte bir rotasyona
  // giriyordu, bu da her taramada farklı bir görsel URL'i demekti.
  assert.equal(
    getPublicImageUrl("products/abc123.webp"),
    getPublicImageUrl("products/abc123.webp")
  );
});

test("ürün dışı her şey imzalı kalır", () => {
  for (const key of [
    "uploads/musteri-fotografi.webp",
    "meshes/model.glb",
    "chat/ek.png",
    "receipts/dekont.pdf",
  ]) {
    assert.equal(isPublicUnsignedKey(key), false, `${key} imzasız sayılmış`);
    const url = getPublicImageUrl(key);
    assert.ok(url.includes("sig="), `${key} imzasız servis ediliyor`);
    assert.ok(url.includes("/api/files/"), `${key} /media üzerinden çıkmış`);
  }
  assert.equal(isPublicUnsignedKey("products/x.webp"), true);
});

test("prefix kaçışı engellenir", () => {
  // "products" ile BAŞLAYAN ama products/ dizininde olmayan anahtarlar,
  // ve traversal denemeleri imzasız servis edilmemeli.
  for (const key of [
    "products-private/x.webp",
    "notproducts/x.webp",
    "products/../uploads/pii.webp",
  ]) {
    assert.equal(isPublicUnsignedKey(key), false, `${key} imzasız sayılmış`);
  }
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
console.log(`\n${passed}/${cases.length} media-url testi geçti`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-media-url.ts`
Expected: FAIL — `getPublicImageUrl` ve `isPublicUnsignedKey` export edilmiyor.

- [ ] **Step 3: `storage.ts`'e implementasyonu ekle**

`src/lib/services/storage.ts` — `getPublicUrl` fonksiyonunun hemen ARDINA ekle:

```ts
/**
 * Storage key prefixes served WITHOUT a signature, from `/media/...`.
 *
 * Only storefront product photos. They are already shown to every anonymous
 * visitor, so a signature adds no confidentiality — but it does add an
 * expiry, and an expiring URL is fatal for crawlers: Google/Bing re-fetch
 * images days-to-weeks after the crawl and got a 401 every time, so
 * `Product.image` and `og:image` were unusable.
 *
 * Everything else — customer photos (PII), GLB/STL meshes, chat attachments,
 * bank receipts — stays signed. Do NOT add a prefix here without checking that
 * every file under it is already public to anonymous visitors.
 */
export const PUBLIC_UNSIGNED_PREFIXES = ["products/"] as const;

/** True when `relativePath` may be served unsigned from `/media`. */
export function isPublicUnsignedKey(relativePath: string): boolean {
  // Reject traversal before prefix matching: "products/../uploads/pii.webp"
  // starts with "products/" but resolves outside it.
  if (relativePath.includes("..")) return false;
  return PUBLIC_UNSIGNED_PREFIXES.some((p) => relativePath.startsWith(p));
}

/**
 * URL for an image that may be embedded in JSON-LD, `og:image`, or a sitemap —
 * i.e. anywhere a crawler will re-fetch it later. Product keys get a stable
 * unsigned `/media` URL; anything else falls back to the signed URL.
 */
export function getPublicImageUrl(relativePath: string): string {
  if (!isPublicUnsignedKey(relativePath)) return getPublicUrl(relativePath);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://figurunica.com"
      : "http://localhost:3000");
  return `${appUrl}/media/${relativePath}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-media-url.ts`
Expected: 4/4 PASS

- [ ] **Step 5: `/media` route'unu oluştur**

Create `src/app/media/products/[...key]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { extname } from "path";
import { getFileBuffer, isPublicUnsignedKey } from "@/lib/services/storage";

/**
 * Public, unsigned, immutable delivery for storefront product photos.
 *
 * `/api/files/*` requires a signature in production (FILES_REQUIRE_SIGNATURE=1)
 * and is robots-disallowed, which made every product image unreachable for
 * crawlers. This route is the narrow carve-out: it serves ONLY keys that
 * `isPublicUnsignedKey` accepts (currently the `products/` prefix), so customer
 * photos, meshes, chat attachments and receipts are untouched and still signed.
 *
 * Filenames are nanoids written once by the upload pipeline and never mutated,
 * so the response is safely immutable for a year.
 */

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: segments } = await params;
  const relativePath = `products/${segments.join("/")}`;

  // Defence in depth: the route is already scoped to /media/products, but a
  // traversal segment could still climb out of it.
  if (!isPublicUnsignedKey(relativePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = extname(relativePath).toLowerCase();
  const contentType = MIME_TYPES[ext];
  // Only image types are public here. A .glb/.stl under products/ must not leak.
  if (!contentType) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await getFileBuffer(relativePath);
  if (!buffer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
```

`getFileBuffer`'ın gerçek imzasını `src/lib/services/storage.ts`'ten doğrula (dönüş tipi `Buffer | null` değilse çağrıyı ona göre uyarla).

- [ ] **Step 6: Çağrı yerlerini geçir**

Run:
```bash
grep -rn "getPublicUrl" src/app/page.tsx "src/app/shop/[slug]/page.tsx" src/lib/services/shop-query.ts
```

Bulunan her ÜRÜN GÖRSELİ çağrısını `getPublicImageUrl`'e çevir. **Müşteri fotoğrafı, mesh veya dekont çağrılarına DOKUNMA** — onlar imzalı kalmalı. Emin olmadığın bir çağrıda anahtarın hangi prefix'ten geldiğini izle.

- [ ] **Step 7: Doğrula**

Run: `npx tsc --noEmit && npx tsx scripts/test-media-url.ts`
Expected: sıfır hata, 4/4 PASS

Yerel uçtan uca (bir ürün görseli anahtarı gerekiyor):
```bash
npx next dev --port 3099 &
# Yerel DB'den bir anahtar al:
psql "$DATABASE_URL" -tAc "select storage_key from product_images limit 1;"
# İmzasız 200 dönmeli:
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:3099/media/<anahtar>"
# Traversal 404 dönmeli:
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3099/media/products/../../package.json"
```
Beklenen: birinci `200 image/webp`, ikinci `404` (veya Next'in normalize edip 404 vermesi).

- [ ] **Step 8: Commit**

`package.json` `test:unit` zincirine `&& npx tsx scripts/test-media-url.ts` ekle.

```bash
git add src/app/media src/lib/services/storage.ts src/app/page.tsx "src/app/shop/[slug]/page.tsx" src/lib/services/shop-query.ts scripts/test-media-url.ts package.json
git commit -m "feat(media): ürün görselleri için imzasız kalıcı /media route'u"
```

---

### Task 9: `sitemap.ts` — eksik sayfalar + DB'den ürün URL'leri

**Files:**
- Modify: `src/app/sitemap.ts`
- Create: `scripts/test-sitemap.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `@/lib/db` (drizzle `db`), `@/lib/db/schema`'dan `products`.
- Produces: `sitemap()` default export'u, `STATIC_ROUTES` sabiti export edilir (test edilebilmesi için).

- [ ] **Step 1: Write the failing test**

Create `scripts/test-sitemap.ts`:

```ts
import assert from "node:assert/strict";
import { STATIC_ROUTES } from "../src/app/sitemap";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

const paths = STATIC_ROUTES.map((r) => r.path);

test("her herkese açık sayfa sitemap'te", () => {
  // Denetimde eksik bulunan 11 route. Sitemap'te olmayan sayfa keşfedilmez.
  const required = [
    "",
    "/shop",
    "/create",
    "/figur",
    "/urunler",
    "/nasil-calisir",
    "/toplu-siparis",
    "/anahtarlik-kutusu",
    "/atolye",
    "/kargo",
    "/iade",
    "/cerez",
    "/mesafeli-satis",
    "/on-bilgilendirme",
    "/ticari-ileti",
    "/contact",
    "/privacy",
    "/terms",
  ];
  for (const p of required) {
    assert.ok(paths.includes(p), `${p || "/"} sitemap'te yok`);
  }
});

test("robots'ta engellenen hiçbir yol sitemap'te değil", () => {
  // Sitemap ile robots çelişirse Search Console uyarı üretir.
  const blocked = ["/admin", "/api", "/manufacturer", "/painter", "/cart", "/checkout"];
  for (const p of paths) {
    for (const b of blocked) {
      assert.ok(!p.startsWith(b), `${p} robots'ta engelli bir prefix altında`);
    }
  }
});

test("priority ve changeFrequency geçerli aralıkta", () => {
  const valid = new Set([
    "always", "hourly", "daily", "weekly", "monthly", "yearly", "never",
  ]);
  for (const r of STATIC_ROUTES) {
    assert.ok(r.priority >= 0 && r.priority <= 1, `${r.path} priority aralık dışı`);
    assert.ok(valid.has(String(r.changeFrequency)), `${r.path} changeFrequency geçersiz`);
  }
});

test("yol tekrarı yok", () => {
  assert.equal(new Set(paths).size, paths.length, "sitemap'te tekrarlanan yol var");
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
console.log(`\n${passed}/${cases.length} sitemap testi geçti`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-sitemap.ts`
Expected: FAIL — `STATIC_ROUTES` export edilmiyor (şu an dosya-yerel sabit).

- [ ] **Step 3: Write minimal implementation**

`src/app/sitemap.ts`'i tamamen değiştir:

```ts
import type { MetadataRoute } from "next";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";

/**
 * Sitemap of the public, indexable surface: the static routes plus every
 * active marketplace product.
 *
 * Product URLs were missing entirely, so the whole catalogue was undiscoverable
 * — a crawler could only reach the first 24 items rendered on /shop, and the
 * rest sat behind a robots-disallowed /api pagination call.
 *
 * Every path here must be crawlable per `src/app/robots.ts`; a sitemap entry
 * that robots blocks produces a Search Console warning. `scripts/test-sitemap.ts`
 * asserts that.
 */

/** Revalidate hourly so the product query does not run on every request. */
export const revalidate = 3600;

export const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "", changeFrequency: "daily", priority: 1.0 },
  { path: "/shop", changeFrequency: "daily", priority: 0.9 },
  // /create is a client component with no server-rendered body yet, so it is
  // deliberately NOT at 0.9 — raise it once the page has a server shell.
  { path: "/create", changeFrequency: "weekly", priority: 0.5 },
  { path: "/figur", changeFrequency: "weekly", priority: 0.8 },
  { path: "/urunler", changeFrequency: "weekly", priority: 0.7 },
  { path: "/nasil-calisir", changeFrequency: "monthly", priority: 0.7 },
  { path: "/toplu-siparis", changeFrequency: "monthly", priority: 0.6 },
  { path: "/anahtarlik-kutusu", changeFrequency: "monthly", priority: 0.6 },
  { path: "/atolye", changeFrequency: "monthly", priority: 0.5 },
  { path: "/kargo", changeFrequency: "monthly", priority: 0.4 },
  { path: "/iade", changeFrequency: "monthly", priority: 0.4 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/cerez", changeFrequency: "yearly", priority: 0.3 },
  { path: "/mesafeli-satis", changeFrequency: "yearly", priority: 0.3 },
  { path: "/on-bilgilendirme", changeFrequency: "yearly", priority: 0.3 },
  { path: "/ticari-ileti", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${baseUrl}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // `products.slug` is nullable (`text("slug").unique()`, no `.notNull()`), so a
  // row without one would produce `/shop/null`.
  let productEntries: MetadataRoute.Sitemap = [];
  try {
    const rows = await db
      .select({ slug: products.slug, updatedAt: products.updatedAt })
      .from(products)
      .where(and(eq(products.status, "active"), isNotNull(products.slug)));

    // `products.updatedAt` is `.notNull().defaultNow()` (schema.ts:1428), so it
    // is always a real Date — no fallback needed.
    productEntries = rows.map((row) => ({
      url: `${baseUrl}/shop/${row.slug}`,
      lastModified: row.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    // A DB hiccup must not make /sitemap.xml a 500 — search engines treat a
    // failing sitemap as a hard error and stop re-fetching it. Degrade to the
    // static routes instead.
    productEntries = [];
  }

  return [...staticEntries, ...productEntries];
}
```

**Şema doğrulandı:** `products.status` = `productStatusEnum("status").notNull().default("draft")` (schema.ts:1421); enum üyeleri `draft | pending_review | active | ...` (schema.ts:278-281), yani `eq(products.status, "active")` geçerli. `products.slug` = `text("slug").unique()` — `.notNull()` YOK, bu yüzden `isNotNull` filtresi zorunlu.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-sitemap.ts && npx tsc --noEmit`
Expected: 4/4 PASS, sıfır tsc hatası

Uçtan uca:
```bash
npx next dev --port 3099
curl -s http://localhost:3099/sitemap.xml | grep -c "<url>"
curl -s http://localhost:3099/sitemap.xml | grep -c "/shop/"
```
Beklenen: birinci sayı ≥ 18, ikinci sayı yerel DB'deki aktif ürün sayısına eşit (0 ise yerel DB'de aktif ürün yok — `psql "$DATABASE_URL" -tAc "select count(*) from products where status='active';"` ile teyit et).

- [ ] **Step 5: Commit**

`package.json` `test:unit` zincirine `&& npx tsx scripts/test-sitemap.ts` ekle.

```bash
git add src/app/sitemap.ts scripts/test-sitemap.ts package.json
git commit -m "feat(seo): sitemap'e eksik sayfalar ve DB'den ürün URL'leri eklendi"
```

---

### Task 10: Bütünsel doğrulama ve deploy öncesi kontrol

**Files:** yok (yalnızca doğrulama)

**Interfaces:**
- Consumes: Task 1-9'un tamamı.
- Produces: yeşil bir `npm run verify` ve deploy edilebilir bir dal.

- [ ] **Step 1: Tam doğrulama zinciri**

Run: `npm run verify`
Expected: lint temiz, `tsc --noEmit` sıfır hata, `next build` başarılı, `test:unit` içindeki 23 betik (20 mevcut + robots + media-url + sitemap) PASS.

Herhangi biri kırmızıysa **dur ve düzelt** — sonraki adıma geçme.

- [ ] **Step 2: Crawler gözünden ham HTML kontrolü**

```bash
npx next dev --port 3099
for ua in "OAI-SearchBot/1.4" "PerplexityBot/1.0" "bingbot/2.0"; do
  printf "%-22s " "$ua"
  curl -s -o /dev/null -w "%{http_code}\n" -A "Mozilla/5.0 (compatible; $ua)" http://localhost:3099/
done
# Fiyat ham HTML'de görünmeli (JS'siz crawler için):
curl -s http://localhost:3099/ | grep -o "3\.499" | head -1
```
Beklenen: üç bot da `200`; grep `3.499` bulur.

- [ ] **Step 3: Fiyat tutarlılığı taraması**

```bash
grep -rn "1\.399\|1\.799\|₺999\|₺899\|boyama kiti\|Boyama Kiti" src/ --include=*.ts --include=*.tsx
```
Beklenen: **sıfır sonuç.** Çıkan her satır Task 5/6'da atlanmış bir yer — düzelt.

- [ ] **Step 4: Migration eklenmediğini teyit et**

```bash
git diff --name-only main...HEAD -- drizzle/
```
Beklenen: **boş çıktı.** Bir şey çıkarsa dur — bu plan şema değişikliği öngörmüyor.

- [ ] **Step 5: Deploy sonrası el ile doğrulanacaklar (sahibine bırak)**

Kod tarafı bittiğinde canlıda kontrol edilecekler — bunlar bu makineden yapılamaz (kurumsal proxy her isteği kesiyor):

```bash
# Şebeke dışı bir makineden:
curl -s https://figurunica.com/robots.txt | head -40
curl -s https://figurunica.com/sitemap.xml | grep -c "<url>"
for ua in "OAI-SearchBot/1.4" "ChatGPT-User/1.0" "PerplexityBot/1.0" "Claude-SearchBot/1.0" "bingbot/2.0"; do
  printf "%-24s " "$ua"
  curl -s -o /dev/null -w "%{http_code}\n" -A "Mozilla/5.0 (compatible; $ua)" https://figurunica.com/
done
# Bir ürün görseli imzasız 200 dönmeli:
curl -s -o /dev/null -w "%{http_code}\n" https://figurunica.com/media/products/<anahtar>
```

Hepsi `200` dönmeli. 403 varsa sebep Cloudflare'dir (spec §5, madde 1) — kodda değil.

Canlı `robots.txt`'i build çıktısıyla karşılaştır; fark varsa Cloudflare'in "managed robots.txt" özelliği araya giriyor:
```bash
diff <(curl -s https://figurunica.com/robots.txt) .next/server/app/robots.txt.body
```

---

## Sonraki paketler (bu planın DIŞINDA)

Spec'teki B1-B4 ayrı planlara ayrılacak: B1 metadata + og:image + server-rendered yorumlar, B2 JSON-LD, B3 Türkçe içerik + iç link grafiği, B4 IndexNow + ölçüm. B2'deki `FAQPage` ve `hasMerchantReturnPolicy`, yürüyen hukuk araştırmasının çıktısına bağımlı (spec §4).
