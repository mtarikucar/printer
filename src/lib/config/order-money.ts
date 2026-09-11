/**
 * Sipariş para dökümü — SAF türetim (Faz 3, salt okunur).
 *
 * Bir sipariş için "hangi kalem ne kadar, üretici / boyacı / platform ne alır,
 * ne tahakkuk etti, ne ödendi" sorusunun tek cevabı. Admin sipariş sayfasındaki
 * "Para dökümü" kartı, testler ve ileride partner ekranları aynı fonksiyonu
 * okur; hiçbiri kendi komisyon hesabını yapmaz.
 *
 * Yeni bir para kuralı YOKTUR. Her sayı mevcut tek-kaynak yardımcılardan gelir:
 *   - tabanlar  → orderMoneySplit / manufacturerBaseKurus / painterBaseKurus
 *                 (services/earning-base.ts)
 *   - komisyon  → computeEarning (services/finance.ts)
 *   - ek hizmet → UPSELL_PRICES_KURUS + calculateUpsellAmount (config/prices.ts)
 *   - kalem türü→ isCostLineKind (config/cost-lines.ts)
 *
 * Kalem ANLIK GÖRÜNTÜSÜ (order_cost_lines) bu fazda YOK. Satırlar siparişte
 * saklananlardan YENİDEN KURULUR:
 *   - donmuş kaynaktan birebir okunan satırlar (order_items, manuel siparişin
 *     selectedAddons kalemleri, tek ürünlü siparişin opsiyon/ek anlık
 *     görüntüsü, siparişin kayıtlı tutar/boyama kolonları) `recomputed`
 *     taşımaz;
 *   - bugünkü sabitlerden (UPSELL_PRICES_KURUS) ya da kayıtlı toplamlardan
 *     türetilen satırlar `recomputed: true` taşır — ekran bunları
 *     "yeniden hesaplandı" diye etiketler, çünkü satış anındaki değer olduğu
 *     kanıtlanamaz.
 *
 * Fiyat kırılımı (sözleşme C2''): ürünün kalem ORANI bir satır tutarının
 * tamamını — opsiyon farkları ve ürün ekleri dahil — üretim ve boyama olarak
 * böldüğünde (boyama kalemli tek ürünlü sipariş, boyama payı olan sepet
 * satırı), satır bir "boyama payı" kalanıyla değil, fiyatın NASIL oluştuğuyla
 * gösterilir: taban (adet × birim), her opsiyon farkı, her ürün eki. Hepsi
 * `price` türündedir ve her biri kendi üretim/boyama payını (`split`) taşır;
 * "El boyaması" opsiyonunun ne kadarının boyacı tabanına girdiği o satırda
 * okunur. Oranla bölünmeyen satırlar gerçek türünü korur: kişiye özel figür,
 * manuel kalemler, boyamasız sepet satırı ve boyama payı ürünün kaleminden
 * DEĞİL sonradan admin "Boyama ekle"siyle üretimden ayrılmış tek ürünlü
 * sipariş (o pay tek bir boyama satırıdır, bkz. storedSplitLines).
 *
 * Paylar (C2''): üretici boyamayı kendi atölyesinde yapıyorsa ayrı boyacı payı
 * yoktur. Üretici payının `includesPainting`'i YALNIZCA üretici kendi boyarken
 * VE siparişte boyama tabanı varken true'dur; boyamasız siparişte "kendim
 * boyarım" üreticisi false alır.
 *
 * Saf modül: DB yok, `server-only` yok. Yükleyici services/order-money.ts'tedir.
 */

import { PLATFORM_COMMISSION_RATE_BPS, UPSELL_PRICES_KURUS, calculateUpsellAmount } from "@/lib/config/prices";
import { allocateBases, isCostLineKind } from "@/lib/config/cost-lines";
import { isRefunded } from "@/lib/config/order-status-policy";
import { computeEarning } from "@/lib/services/finance";
import {
  manufacturerBaseKurus,
  orderMoneySplit,
  type OrderMoneySplit,
} from "@/lib/services/earning-base";

// ─── Sözleşme C2 tipleri (paralel geliştirilen ekranlar bunlara göre yazılır) ──

export interface MoneyLine {
  label: string;
  /**
   * - `production` / `painting`: satırın tamamı o tabana yazılır.
   * - `addon`: ek hizmetler (hediye paketi, hızlı kargo…) ve boyama payı AYRI
   *   duran tek ürünlü siparişin ürün ekleri; bugünkü kurala göre ÜRETİM
   *   tabanının içindedir.
   * - `price`: kalem oranıyla bölünen bir satır tutarının fiyat kırılımı
   *   (taban, opsiyon farkı, ürün eki); bölüşüm `split`'tedir.
   * - `discount` şimdilik üretilmez; iskonto müşteri tahsilatında (collection)
   *   görünür.
   *
   * Satırlar toplandığında:
   *   Σ amountKurus                                   = sipariş tutarı
   *   Σ(production + addon) + Σ price.split.production = üretim tabanı
   *   Σ painting + Σ price.split.painting              = boyama tabanı
   */
  kind: "production" | "painting" | "addon" | "discount" | "price";
  /** Bu satırın payı. Satırlar toplandığında sipariş tutarını verir. */
  amountKurus: number;
  /**
   * Müşteri satırının adedi / birim fiyatı. İkisi birlikte varsa
   * qty × unitKurus === amountKurus — line() başka türlü birimi yazmaz, ekran
   * "2 × ₺450" yazıp yanında başka bir tutar göstermesin.
   */
  qty?: number;
  unitKurus?: number;
  note?: string;
  /** Satış anındaki değer değil, bugünkü sabitlerden / toplamlardan kuruldu. */
  recomputed?: boolean;
  /**
   * Yalnızca — ve her zaman — `price` satırlarında: bu satırın üretim ve boyama
   * payı, siparişin kullandığı allocateBases bölüşümüyle.
   * productionKurus + paintingKurus === amountKurus.
   */
  split?: { productionKurus: number; paintingKurus: number };
}

export interface PartnerEarningRow {
  grossKurus: number;
  commissionKurus: number;
  netKurus: number;
  rateBps: number;
  status: string;
  payout: null | { id: string; status: string; reference: string | null; paidAt: string | null };
}

export interface PartyShare {
  party: "manufacturer" | "painter";
  partnerName: string | null;
  baseKurus: number;
  rateBps: number;
  rateIsEstimate: boolean;
  expectedCommissionKurus: number;
  expectedNetKurus: number;
  earning: PartnerEarningRow | null;
  accrualEvent: string;
  accrualMissing: boolean;
  /**
   * "refunded": sipariş iade edildi. Beklenen rakamlar partnerin iade olmasaydı
   * alacağı paydır; ÖDENECEK bir şey değildir ve tahakkuk beklenmez
   * (accrualMissing false). Hakediş satırı varsa kendi durumunu korur: geri
   * alındıysa `reversed`, iadeden önce ödendiyse `paid`.
   */
  voided: null | "refunded";
  /**
   * Yalnızca üretici payında ve YALNIZCA iki koşul birlikteyken true: üretici
   * boyamayı kendi atölyesinde yapıyor (split.paintsItself) VE siparişin
   * boyama tabanı var (paintingBaseKurus > 0). O zaman taban boyama kalemini
   * de kapsar ve ayrı bir boyacı payı YOKTUR — aynı boyama payı iki partnere
   * gösterilmez. Boyamasız siparişte "kendim boyarım" üreticisi false alır:
   * "(boyama dahil)" etiketi tabanda olmayan bir boyamayı vaat ederdi. Sözleşme
   * C2'' bu dar anlamla düzeltildi; admin ekranı buna dayanır.
   */
  includesPainting: boolean;
}

/** Aynı sepet ödemesinden doğan kardeş alt sipariş — kendi kolonlarından. */
export interface MoneySibling {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  amountKurus: number;
  /** Sepetin hediye çekinden bu alt siparişe düşen pay (ödemede dağıtıldı). */
  giftCardKurus: number;
  /** Sepetin havale indiriminden bu alt siparişe düşen pay. */
  havaleDiscountKurus: number;
  /** Bu alt siparişin kendi tahsilatı — iadeden bağımsız, bkz. collection. */
  cashCollectedKurus: number;
}

export interface OrderMoneyBreakdown {
  lines: MoneyLine[];
  totals: {
    amountKurus: number;
    productionBaseKurus: number;
    paintingPriceKurus: number;
    splitMatches: boolean;
    legacySplit: boolean;
  };
  collection: {
    amountKurus: number;
    giftCardKurus: number;
    havaleDiscountKurus: number;
    /**
     * Müşteriden fiilen tahsil edilen nakit (tutar − hediye çeki − havale
     * indirimi), İADEDEN BAĞIMSIZ: iade edilen siparişte de alınmış parayı
     * gösterir — iade ekranı neyin geri ödeneceğini buradan okur.
     */
    cashCollectedKurus: number;
    /**
     * Ciroya sayılan nakit (C3): yalnızca paymentStatus='succeeded' iken
     * cashCollectedKurus'a eşit, aksi hâlde 0. Panel ve analitik aynı kuralı
     * SQL'de uygular (services/admin-order-sql.ts).
     */
    revenueKurus: number;
    paymentMethod: string | null;
    paymentStatus: string;
    siblings: MoneySibling[];
  };
  shares: PartyShare[];
  platform: { commissionKurus: number; unassignedBaseKurus: number; netKurus: number };
  warnings: string[];
}

// ─── Etiketler (admin arayüzü Türkçe ve sabit kodlu) ─────────────────────────

export const MONEY_LINE_KIND_LABELS_TR: Record<MoneyLine["kind"], string> = {
  production: "Üretim",
  painting: "Boyama",
  addon: "Ek hizmet",
  discount: "İndirim",
  price: "Fiyat",
};

/** Ek hizmet anahtarlarının Türkçe adları (sözlükteki upsell.<key>.label ile aynı). */
export const UPSELL_LABELS_TR: Record<string, string> = {
  extra_paint: "Ekstra boya katmanı",
  gift_wrap: "Hediye paketi",
  rush_shipping: "Hızlı kargo",
  digital_files: "Dijital dosyalar (STL + OBJ)",
};

// ─── C3: tek ciro tanımı ────────────────────────────────────────────────────

/**
 * Müşteriden fiilen tahsil edilen nakit: brüt tutar − hediye çeki − havale
 * indirimi. `amountKurus` indirim ÖNCESİ tutardır; admin ekranındaki eski
 * "Kalan" satırı havale indirimini atladığı için havale müşterisinin ödediğini
 * olduğundan yüksek gösteriyordu.
 */
export function cashCollectedKurus(o: {
  amountKurus: number;
  giftCardAmountKurus: number;
  havaleDiscountKurus: number;
}): number {
  return Math.max(0, o.amountKurus - o.giftCardAmountKurus - o.havaleDiscountKurus);
}

/** Ciroya sayılır mı: yalnızca başarılı ödeme. İade edilen sipariş ciro değildir. */
export function countsAsRevenue(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === "succeeded";
}

/**
 * Sözleşme C3 — panel, analitik ve para dökümü AYNI sayıyı göstersin diye tek
 * tanım: tahsil edilen nakit, yalnızca paymentStatus='succeeded' için.
 */
export function revenueKurus(o: {
  amountKurus: number;
  giftCardAmountKurus: number;
  havaleDiscountKurus: number;
  paymentStatus: string | null | undefined;
}): number {
  return countsAsRevenue(o.paymentStatus) ? cashCollectedKurus(o) : 0;
}

// ─── Girdi: siparişin saklanan hâli (yükleyici DB'den doldurur) ──────────────

export interface MoneyOptionSnapshot {
  groupName: string;
  choiceName: string;
  priceDeltaKurus: number;
}

export interface MoneyAddonSnapshot {
  name: string;
  priceKurus: number;
  /** Yalnızca admin manuel siparişlerinde: kalem türü (production / painting). */
  kind?: string;
}

/** Bir order_items satırı — ödeme anında dondurulmuş. */
export interface OrderItemMoneySnapshot {
  title: string;
  quantity: number;
  unitPriceKurus: number;
  lineTotalKurus: number;
  /** Kademe öncesi birim fiyat — yalnızca gösterim, ASLA toplama girmez. */
  listUnitPriceKurus: number | null;
  appliedTierMinQuantity: number | null;
  /** Satırın donmuş üretim payı; NULL = kalem öncesi satır (tamamı üretim). */
  productionBaseKurus: number | null;
  isBoxItem: boolean;
  selectedOptions: MoneyOptionSnapshot[] | null;
  selectedAddons: MoneyAddonSnapshot[] | null;
}

export interface EarningMoneySnapshot {
  partnerId: string;
  partnerName: string | null;
  grossKurus: number;
  commissionKurus: number;
  netKurus: number;
  rateBps: number;
  status: string;
  payout: PartnerEarningRow["payout"];
}

/** Kardeş alt siparişin saklanan kolonları; tahsilatı saf tarafta türetilir. */
export interface MoneySiblingSnapshot {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  amountKurus: number;
  giftCardAmountKurus: number;
  havaleDiscountKurus: number;
}

export interface OrderMoneySnapshot {
  orderType: string;
  amountKurus: number;
  productionBaseKurus: number | null;
  paintingPriceKurus: number;
  giftCardAmountKurus: number;
  havaleDiscountKurus: number;
  upsells: string[] | null;
  upsellAmountKurus: number;
  quantity: number;
  productId: string | null;
  productTitleSnapshot: string | null;
  /**
   * Tek ürünlü siparişin ürününün BUGÜNKÜ kalem toplamları (product_cost_lines
   * → splitCostLines). Tutar hesabına girmez; yalnızca boyama payının ürünün
   * kaleminden mi yoksa sonradan admin "Boyama ekle"sinden mi geldiğini ayırt
   * eder (bkz. storedSplitLines):
   *   - undefined: yüklenmedi → bilinmiyor, satırlar kalem oranıyla bölünür;
   *   - null: ürünün hiç kalemi yok (kırılımsız ürün) → boyama kalemi yok;
   *   - nesne: paintingKurus 0 → boyama kalemi yok.
   * SINIR: sipariş anındaki değil bugünkü kırılımdır (kalem anlık görüntüsü
   * yok); ürün satıştan sonra düzenlendiyse ayrım yanlış olabilir.
   */
  productCostBases?: { productionKurus: number; paintingKurus: number } | null;
  parentReference: string | null;
  workshopSessionId: string | null;
  selectedOptions: MoneyOptionSnapshot[] | null;
  selectedAddons: MoneyAddonSnapshot[] | null;
  paymentMethod: string | null;
  paymentStatus: string;
  /** Üretici kabulünde dondurulan oran; NULL = henüz kabul yok. */
  commissionRateBps: number | null;
  manufacturerId: string | null;
  manufacturerName: string | null;
  /** Atanmış üreticinin "kendim boyarım" bayrağı; üretici yoksa false. */
  paintsInHouse: boolean;
  manufacturerStatus: string | null;
  painterId: string | null;
  painterName: string | null;
  painterStatus: string | null;
  shippedAt: string | null;
  /** order_items (sepet alt siparişi). Diğer sipariş türlerinde boş. */
  items: OrderItemMoneySnapshot[];
  /** Aynı sepetten doğan kardeş alt siparişler (bu sipariş hariç). */
  siblings: MoneySiblingSnapshot[];
  /** Sepet ödeme taslağının tutarı — alt sipariş toplamıyla karşılaştırmak için. */
  cartDraftAmountKurus: number | null;
  manufacturerEarning: EarningMoneySnapshot | null;
  painterEarning: EarningMoneySnapshot | null;
}

// ─── Sipariş türü ───────────────────────────────────────────────────────────

export type MoneyOrderKind = "workshop" | "cart" | "manual" | "product" | "upload" | "custom";

/**
 * Satırların nereden kurulacağını söyler. Manuel admin siparişi bir
 * "marketplace" taslağıdır (AI üretimine girmesin diye) ama ürün satırı yoktur;
 * içeriği `selectedAddons` kalemleridir. Sepet alt siparişi order_items taşır.
 */
export function classifyMoneyOrder(
  s: Pick<OrderMoneySnapshot, "orderType" | "workshopSessionId" | "items" | "parentReference" | "productId">
): MoneyOrderKind {
  if (s.workshopSessionId) return "workshop";
  if (s.orderType === "upload") return "upload";
  if (s.orderType === "marketplace") {
    if (s.items.length > 0 || s.parentReference) return "cart";
    if (s.productId) return "product";
    return "manual";
  }
  // Web'deki kişiye özel figür VE WhatsApp AI siparişi (ikisi de "custom").
  return "custom";
}

// ─── Biçimleme ──────────────────────────────────────────────────────────────

/** ₺1.234,56 — negatifte başa eksi. Uyarı ve not metinleri için. */
export function formatTry(kurus: number): string {
  const s = `₺${(Math.abs(kurus) / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return kurus < 0 ? `−${s}` : s;
}

function signedTry(kurus: number): string {
  return kurus >= 0 ? `+${formatTry(kurus)}` : formatTry(kurus);
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * -0'ı +0 yapar. `-x` ya da `a * b` 0'da -0 üretebilir; React Flight -0'ı
 * istemciye aynen taşır ve formatCurrency onu "-₺0,00" yazar. (-0 === 0
 * doğrudur, dolayısıyla dönen 0 düz +0 sabitidir.)
 */
function nz(n: number): number {
  return n === 0 ? 0 : n;
}

/** Opsiyonel alanları yalnızca doluysa ekler — JSON yükü sade kalsın. */
function line(
  base: { label: string; kind: MoneyLine["kind"]; amountKurus: number },
  extra: {
    qty?: number;
    unitKurus?: number;
    note?: string | null;
    recomputed?: boolean;
    split?: { productionKurus: number; paintingKurus: number };
  } = {}
): MoneyLine {
  const out: MoneyLine = { ...base, amountKurus: nz(base.amountKurus) };
  if (extra.qty !== undefined) out.qty = extra.qty;
  // Birim yalnızca adet × birim satırın tutarını veriyorsa yazılır (bkz.
  // MoneyLine.qty); vermiyorsa ekran yalnız adedi gösterir.
  if (
    extra.unitKurus !== undefined &&
    extra.qty !== undefined &&
    extra.qty * extra.unitKurus === base.amountKurus
  ) {
    out.unitKurus = extra.unitKurus;
  }
  if (extra.note) out.note = extra.note;
  if (extra.recomputed) out.recomputed = true;
  if (extra.split) {
    out.split = {
      productionKurus: nz(extra.split.productionKurus),
      paintingKurus: nz(extra.split.paintingKurus),
    };
  }
  return out;
}

// Fiyatı değiştiren opsiyonlar (sıfır farklı olanlar para değil tanımdır —
// üretim kartında zaten görünürler).
function optionNotes(opts: readonly MoneyOptionSnapshot[] | null): string[] {
  return (opts ?? [])
    .filter((o) => o.priceDeltaKurus !== 0)
    .map((o) => `${o.groupName}: ${o.choiceName} (${signedTry(o.priceDeltaKurus)}/adet)`);
}

function addonNotes(addons: readonly MoneyAddonSnapshot[] | null): string[] {
  return (addons ?? []).map((a) => `Ek: ${a.name} (${formatTry(a.priceKurus)}/adet)`);
}

// ─── Satırlar ───────────────────────────────────────────────────────────────

/**
 * Ek hizmet satırları, bugünkü UPSELL_PRICES_KURUS'tan. Siparişte yalnızca
 * TOPLAM (upsellAmountKurus) saklandığı için tek tek fiyatlar yeniden
 * hesaplanır; fark varsa (fiyat sonradan değişti / bilinmeyen anahtar) ayrı
 * bir fark satırı ek hizmet toplamını kayıtlı değere eşitler.
 */
function upsellLines(s: OrderMoneySnapshot): { lines: MoneyLine[]; todayKurus: number; driftKurus: number } {
  const keys = Array.from(new Set(s.upsells ?? []));
  const lines: MoneyLine[] = [];
  for (const key of keys) {
    const price = UPSELL_PRICES_KURUS[key];
    if (!price) continue;
    lines.push(
      line(
        { label: UPSELL_LABELS_TR[key] ?? key, kind: "addon", amountKurus: price },
        { recomputed: true, note: "Bugünkü ek hizmet fiyatından" }
      )
    );
  }
  const todayKurus = calculateUpsellAmount(keys);
  const driftKurus = s.upsellAmountKurus - todayKurus;
  if (driftKurus !== 0) {
    lines.push(
      line(
        { label: "Ek hizmet fiyat farkı", kind: "addon", amountKurus: driftKurus },
        {
          recomputed: true,
          note: `Kayıtlı ek hizmet toplamı ${formatTry(s.upsellAmountKurus)}; bugünkü fiyatlarla ${formatTry(todayKurus)}`,
        }
      )
    );
  }
  return { lines, todayKurus, driftKurus };
}

const SELECTION_SKIPPED = "Opsiyon/ek farkları ayrı satır olarak gösterilmedi";

function skipSelection(why: string): { ok: false; reason: string } {
  return { ok: false, reason: `${SELECTION_SKIPPED}: ${why}` };
}

/** Fiyatı değiştiren seçimler — sıfır farklı olanlar para değil tanımdır (optionNotes ile aynı kural). */
function pricedSelection(
  options: readonly MoneyOptionSnapshot[] | null,
  addons: readonly MoneyAddonSnapshot[] | null
): { options: MoneyOptionSnapshot[]; addons: MoneyAddonSnapshot[]; perUnitKurus: number } {
  const o = (options ?? []).filter((x) => x.priceDeltaKurus !== 0);
  const a = (addons ?? []).filter((x) => x.priceKurus !== 0);
  return {
    options: o,
    addons: a,
    perUnitKurus: sum(o.map((x) => x.priceDeltaKurus)) + sum(a.map((x) => x.priceKurus)),
  };
}

/** Türü ve bölüşümü henüz verilmemiş bir tutar satırı. */
interface PriceRow {
  label: string;
  amountKurus: number;
  qty?: number;
  unitKurus?: number;
  note?: string;
}

/** Bir seçimin kendi tutar satırı: birim fark × adet. */
interface SelectionRow extends PriceRow {
  source: "option" | "addon";
  qty: number;
  unitKurus: number;
}

type SelectionRows =
  | {
      ok: true;
      /** Seçimsiz birim fiyat (liste ya da kademe fiyatı). */
      unitBaseKurus: number;
      /** Birim başına seçim farkları toplamı. */
      perUnitKurus: number;
      rows: SelectionRow[];
    }
  | {
      ok: false;
      /** null: ayrılacak fiyatlı seçim yok (not gerekmez). */
      reason: string | null;
    };

/**
 * Opsiyon farklarını ve ürün eklerini KENDİ tutar satırlarına ayırır. Kaynak,
 * donmuş seçim anlık görüntüsüdür: `selectedOptions[].priceDeltaKurus` ve
 * `selectedAddons[].priceKurus` birim başınadır ve computeSelectionPrice onları
 * (kademe fiyatı dahil) taban birim fiyatın üstüne değişmeden ekler — satır =
 * birim fark × adet, satış anındaki değerdir (yeniden hesaplanmış değil); taban
 * birim = ödenen birim − seçim farkları.
 *
 * Kayıtlı veri kesin bir satır değeri vermiyorsa AYIRMAZ, nedeni döner —
 * tahmini rakam göstermek, göstermemekten kötüdür:
 *   - adet geçersiz, tutar birim × adet değil, ya da 0 (eksi birim fiyat 0'a
 *     çekilir; o zaman farkların ne kadarının alındığı bilinmez);
 *   - seçim farkları ödenen birim fiyatı aşıyor (anlık görüntü tutarla uyuşmuyor).
 */
function selectionRows(args: {
  qty: number;
  amountKurus: number;
  /** Saklanan (seçimler dahil) birim fiyat; saklanmıyorsa null → tutar / adet. */
  unitKurus: number | null;
  options: readonly MoneyOptionSnapshot[] | null;
  addons: readonly MoneyAddonSnapshot[] | null;
  /** Nedenlerde tutarın adı: "ürün tutarı" / "satır tutarı". */
  amountNoun: string;
  /** Sepette seçimin ait olduğu ürün (notta); tek ürünlü siparişte null. */
  owner: string | null;
}): SelectionRows {
  const sel = pricedSelection(args.options, args.addons);
  if (sel.options.length === 0 && sel.addons.length === 0) return { ok: false, reason: null };
  const { qty, amountKurus } = args;
  if (!Number.isInteger(qty) || qty <= 0) return skipSelection("adet geçersiz");
  if (amountKurus <= 0) return skipSelection(`${args.amountNoun} 0 — birim fiyat 0'a çekilmiş olabilir`);
  if (amountKurus % qty !== 0 || (args.unitKurus !== null && args.unitKurus * qty !== amountKurus)) {
    return skipSelection(`${args.amountNoun} birim fiyat × adet değil`);
  }
  const unitBaseKurus = amountKurus / qty - sel.perUnitKurus;
  if (unitBaseKurus < 0) return skipSelection("seçim farkları ödenen birim fiyatı aşıyor");

  const of = args.owner ? ` (${args.owner})` : "";
  return {
    ok: true,
    unitBaseKurus,
    perUnitKurus: sel.perUnitKurus,
    rows: [
      ...sel.options.map(
        (o): SelectionRow => ({
          source: "option",
          label: `${o.groupName}: ${o.choiceName}`,
          qty,
          unitKurus: o.priceDeltaKurus,
          amountKurus: o.priceDeltaKurus * qty,
          note: `Opsiyon farkı${of} — sipariş anındaki seçimden`,
        })
      ),
      ...sel.addons.map(
        (a): SelectionRow => ({
          source: "addon",
          label: a.name,
          qty,
          unitKurus: a.priceKurus,
          amountKurus: a.priceKurus * qty,
          note: `Ürün eki${of} — sipariş anındaki fiyattan`,
        })
      ),
    ],
  };
}

type SelectionCarve =
  | {
      ok: true;
      /** Ana ürün satırının payı: üretim payı − opsiyon − ek satırları. */
      baseKurus: number;
      /** Opsiyonsuz, eksiz birim fiyat (liste ya da kademe fiyatı). */
      unitBaseKurus: number;
      lines: MoneyLine[];
    }
  | { ok: false; reason: string | null };

/**
 * Boyama payı KENDİ satırında duran tek ürünlü sipariş (boyama kalemi yok, ya
 * da kalem oranı kurulamıyor): opsiyon farkları ve ürün ekleri kendi
 * satırlarına ayrılır, ana ürün satırı KALANDIR — üretim payı − opsiyon − ek
 * satırları. Böylece satırlar sipariş tutarına, üretim + ek satırları üretim
 * tabanına birebir eşit kalır. selectionRows'un nedenlerine ek olarak kalem
 * bölüşümü tutmuyorsa (üretim payının kendisi şüpheli) ya da kalan eksiye
 * düşecekse ayırmaz.
 */
function carveProductSelection(
  s: OrderMoneySnapshot,
  itemAmount: number,
  production: number,
  split: OrderMoneySplit
): SelectionCarve {
  const sel = pricedSelection(s.selectedOptions, s.selectedAddons);
  if (sel.options.length === 0 && sel.addons.length === 0) return { ok: false, reason: null };
  if (!split.splitMatches) return skipSelection("kalem bölüşümü tutmuyor");
  const rows = selectionRows({
    qty: s.quantity,
    amountKurus: itemAmount,
    unitKurus: null,
    options: s.selectedOptions,
    addons: s.selectedAddons,
    amountNoun: "ürün tutarı",
    owner: null,
  });
  if (!rows.ok) return rows;
  const baseKurus = production - rows.perUnitKurus * s.quantity;
  if (baseKurus < 0) return skipSelection("üretim payı opsiyon ve ekleri karşılamıyor");
  return {
    ok: true,
    baseKurus,
    unitBaseKurus: rows.unitBaseKurus,
    lines: rows.rows.map((r) =>
      line(
        { label: r.label, kind: r.source === "option" ? "production" : "addon", amountKurus: r.amountKurus },
        { qty: r.qty, unitKurus: r.unitKurus, note: r.note }
      )
    ),
  };
}

/**
 * Tutar satırlarını siparişin KENDİ kalem bölüşümüyle üretim / boyama olarak
 * böler.
 *
 * Bölüşüm, siparişin kullandığı allocateBases'tir (üretim aşağı yuvarlanır,
 * artan kuruş boyamaya) ve oran siparişte donmuş iki tabandır: ürünün kırılımı
 * sonradan düzenlenmiş olabilir, satış anındaki oran bu iki sayıdadır.
 *
 * Satırları tek tek yuvarlamak kuruş kaybettirir (Σ ≠ taban). Onun yerine
 * BİRİKİMLİ toplam bölünür ve her satır, birikimli toplamının üretim payından
 * bir öncekinin üretim payını çıkararak alır: yuvarlama birikmez. Son birikimli
 * toplam iki tabanın toplamıdır, orada sonuç tanım gereği üretim tabanıdır —
 * allocateBases'e sorulmadan doğrudan yazılır ki büyük tutarlarda kayan nokta
 * çarpımı 1 kuruş kaydıramasın; Σ üretim böylece TAM üretim tabanıdır.
 *
 * Eksi satırlar (ucuzlatan opsiyon) artılardan SONRA birikir. Birikimli toplam
 * böylece hiç eksiye düşmez (allocateBases eksi tutar almaz), her satırın iki
 * payı satırla aynı işarette kalır ve satırı aşmaz, ve bir satırın üretim payı
 * tam orantılı payından 1 kuruştan az sapar. Sıra yalnızca satırlara bağlıdır:
 * aynı sipariş her seferinde aynı bölüşümü verir.
 */
function splitByOrderRatio(
  amounts: readonly number[],
  productionKurus: number,
  paintingKurus: number
): Array<{ productionKurus: number; paintingKurus: number }> {
  const total = productionKurus + paintingKurus;
  const productionUpTo = (cumulative: number): number =>
    cumulative === total
      ? productionKurus
      : allocateBases({ productionKurus, paintingKurus, totalKurus: cumulative }).productionKurus;
  const order = amounts
    .map((_, i) => i)
    .sort((a, b) => Number(amounts[a] < 0) - Number(amounts[b] < 0) || a - b);
  const out = amounts.map(() => ({ productionKurus: 0, paintingKurus: 0 }));
  let cumulative = 0;
  let before = 0;
  for (const i of order) {
    cumulative += amounts[i];
    const upTo = productionUpTo(cumulative);
    out[i] = { productionKurus: upTo - before, paintingKurus: amounts[i] - (upTo - before) };
    before = upTo;
  }
  return out;
}

/** Fiyat satırları: hepsi `price`, her biri kendi üretim/boyama payıyla. */
function ratioSplitLines(
  rows: readonly PriceRow[],
  productionKurus: number,
  paintingKurus: number,
  recomputed: boolean
): MoneyLine[] {
  const splits = splitByOrderRatio(
    rows.map((r) => r.amountKurus),
    productionKurus,
    paintingKurus
  );
  return rows.map((r, i) =>
    line(
      { label: r.label, kind: "price", amountKurus: r.amountKurus },
      { qty: r.qty, unitKurus: r.unitKurus, note: r.note, recomputed, split: splits[i] }
    )
  );
}

function ratioNote(what: string, amountKurus: number, productionKurus: number, paintingKurus: number): string {
  return `${what} ${formatTry(amountKurus)} = üretim ${formatTry(productionKurus)} + boyama ${formatTry(paintingKurus)}; her fiyat satırı bu kalem oranıyla bölündü`;
}

/**
 * Boyama kalemli tek ürünlü siparişin fiyat kırılımı. api/orders ürünün kalem
 * oranını ürün tutarının TAMAMINA — opsiyon farkları ve ürün ekleri dahil —
 * uyguladı (basesForLineTotal); siparişte o bölüşümün iki toplamı donmuştur.
 * Satırlar: taban (adet × seçimsiz birim), her opsiyon farkı, her ürün eki;
 * seçimler kesin ayrılamıyorsa tek fiyat satırı ve notta nedeni. Boyama her
 * durumda satırların `split`'indedir; ayrı "boyama payı" kalan satırı yoktur.
 *
 * Yalnızca boyama payı ürünün KALEMİNDEN geldiğinde (ya da nereden geldiği
 * bilinmediğinde) çağrılır. Sonradan admin "Boyama ekle"siyle ayrılmış pay
 * oranla bölünmez (bkz. storedSplitLines): o pay üretimden tek parça ayrıldı;
 * oran uydurmak her satıra hiç olmamış bir boyama payı yazardı.
 */
function productPriceLines(
  s: OrderMoneySnapshot,
  itemAmount: number,
  production: number,
  painting: number,
  legacy: boolean
): MoneyLine[] {
  const label = s.productTitleSnapshot ?? "Ürün";
  const qty = s.quantity;
  const sel = selectionRows({
    qty,
    amountKurus: itemAmount,
    unitKurus: null,
    options: s.selectedOptions,
    addons: s.selectedAddons,
    amountNoun: "ürün tutarı",
    owner: null,
  });
  const notes: string[] = [];
  if (sel.ok) {
    notes.push("Opsiyon ve ekler hariç taban fiyat");
  } else {
    notes.push(...optionNotes(s.selectedOptions), ...addonNotes(s.selectedAddons));
    if (sel.reason) notes.push(sel.reason);
  }
  notes.push(ratioNote("Ürün tutarı", itemAmount, production, painting));
  if (legacy) notes.push("Kalem öncesi sipariş: üretim payı eski kuralla (tutar − boyama)");

  const head: PriceRow = sel.ok
    ? { label, qty, unitKurus: sel.unitBaseKurus, amountKurus: sel.unitBaseKurus * qty, note: notes.join(" · ") }
    : {
        label,
        qty,
        // Birim fiyat saklanmaz; tek ürünlü siparişte ürün tutarı = birim × adet.
        unitKurus: qty > 0 && itemAmount % qty === 0 ? itemAmount / qty : undefined,
        amountKurus: itemAmount,
        note: notes.join(" · "),
      };
  return ratioSplitLines([head, ...(sel.ok ? sel.rows : [])], production, painting, legacy);
}

/**
 * Tutarı ve bölüşümü SİPARİŞİN KENDİ KOLONLARINDA duran türler: kişiye özel
 * figür (web + WhatsApp AI), yüklenen model, tek ürünlü mağaza siparişi ve
 * atölye koltuğu. Ana satır = üretim tabanı − ek hizmetler (ek hizmetler
 * üretim tarafında durur), boyama satırı = kayıtlı boyama payı. Boyama kalemli
 * tek ürünlü siparişte ürün tutarı kalem oranıyla bölündüğü için satırlar
 * fiyat kırılımıdır (productPriceLines); boyamasızda opsiyon farkları ve ürün
 * ekleri, ayrılabildiklerinde ana satırdan çıkıp kendi satırlarında durur
 * (carveProductSelection).
 *
 * Sonradan ayrılan boyama: ürünün kendi kaleminde boyama yokken
 * (productCostBases) siparişte boyama tabanı varsa, o pay admin "Boyama
 * ekle"siyle üretimden TEK PARÇA ayrılmıştır (carvePaintingShare). Satırlar
 * gerçek türlerini korur — taban ve opsiyon farkı üretim, ürün eki ek — ve
 * ayrılan tutar tek bir boyama satırıdır; taban satırı o tutar düşülmüş
 * kalandır. Toplamlar ve iki taban yine birebir tutar.
 * SINIR: ayrım ürünün BUGÜNKÜ kırılımından okunur. Ürüne satıştan sonra boyama
 * kalemi eklendiyse "Boyama ekle"li sipariş yine oranla bölünür (eski
 * gösterim); boyama kalemi satıştan sonra silindiyse kalemden gelen pay
 * "sonradan ayrıldı" diye gösterilir. Yanlış olabilen yalnızca payın hangi
 * satırdan geldiğidir; kesin ayrım bir kalem anlık görüntüsü ya da siparişte
 * kalıcı bir işaret (migration) ister.
 */
function storedSplitLines(
  s: OrderMoneySnapshot,
  kind: "custom" | "product" | "upload" | "workshop",
  split: OrderMoneySplit
): { lines: MoneyLine[]; todayUpsellKurus: number; upsellDriftKurus: number } {
  const ups = upsellLines(s);
  const itemAmount = s.amountKurus - s.upsellAmountKurus;
  const production = split.productionBaseKurus - s.upsellAmountKurus;
  const painting = split.paintingBaseKurus;
  const withUpsells = (lines: MoneyLine[]) => ({
    lines: [...lines, ...ups.lines],
    todayUpsellKurus: ups.todayKurus,
    upsellDriftKurus: ups.driftKurus,
  });

  // Ürünün kaleminde boyama yok ama siparişte boyama tabanı var → pay oranla
  // değil, sonradan üretimden ayrıldı. Yüklenmemiş kırılım (undefined)
  // bilinmez sayılır. Kalem öncesi (legacy) sipariş hariç: "Boyama ekle"
  // üretim tabanını her zaman yazar, yani o şekil bir ayırma değildir.
  const paintingCarved =
    kind === "product" &&
    painting > 0 &&
    !split.legacySplit &&
    s.productCostBases !== undefined &&
    (s.productCostBases?.paintingKurus ?? 0) === 0;

  // Oran ancak iki taban ürün tutarını tam verirken ve üretim payı eksi
  // değilken kurulur; aksi hâlde kayıtlı üretim + boyama satırlarına düşülür
  // (bölüşüm uyarısı zaten çıkar).
  if (kind === "product" && painting > 0 && !paintingCarved && split.splitMatches && production >= 0) {
    return withUpsells(productPriceLines(s, itemAmount, production, painting, split.legacySplit));
  }

  let label: string;
  let paintingLabel: string;
  const notes: string[] = [];
  let qty: number | undefined;
  let unitKurus: number | undefined;
  let carved: Extract<SelectionCarve, { ok: true }> | null = null;
  switch (kind) {
    case "product": {
      label = s.productTitleSnapshot ?? "Ürün";
      paintingLabel = `${label} — boyama payı`;
      qty = s.quantity;
      const carve = carveProductSelection(s, itemAmount, production, split);
      if (carve.ok) {
        carved = carve;
        unitKurus = carve.unitBaseKurus;
        notes.push("Opsiyon ve ekler hariç taban fiyat");
      } else {
        // Birim fiyat saklanmaz; tek ürünlü siparişte ürün tutarı = birim × adet.
        if (s.quantity > 0 && itemAmount % s.quantity === 0) unitKurus = itemAmount / s.quantity;
        notes.push(...optionNotes(s.selectedOptions), ...addonNotes(s.selectedAddons));
        if (carve.reason) notes.push(carve.reason);
      }
      break;
    }
    case "upload":
      label = "Yüklenen model baskısı";
      paintingLabel = "Boyama payı";
      notes.push("Müşterinin yüklediği STL/OBJ; fiyat baskı hacminden");
      break;
    case "workshop":
      label = "Atölye katılımı — figür";
      paintingLabel = "Boyama payı";
      notes.push("Seans koltuk fiyatı");
      break;
    default:
      label = "Kişiye özel figür";
      paintingLabel = "Profesyonel boyama payı";
  }
  if (painting > 0) {
    notes.push(
      `Ürün tutarı ${formatTry(itemAmount)} = üretim ${formatTry(production)} + boyama ${formatTry(painting)}`
    );
  }
  if (paintingCarved) {
    notes.push(
      `Ürünün bugünkü kalem kırılımında boyama yok: boyama payı sonradan (admin "Boyama ekle") üretim payından tek parça ayrıldı, bu satırdan düşüldü`
    );
  }
  if (split.legacySplit) notes.push("Kalem öncesi sipariş: üretim payı eski kuralla (tutar − boyama)");

  const lines: MoneyLine[] = [
    line(
      { label, kind: "production", amountKurus: carved ? carved.baseKurus : production },
      { qty, unitKurus, note: notes.join(" · "), recomputed: split.legacySplit }
    ),
    ...(carved ? carved.lines : []),
  ];
  if (painting > 0) {
    // Taban, boyamayı KİM yapıyorsa onundur. Üretici kendi boyuyorsa ayrı
    // boyacı payı yoktur (includesPainting); "boyacının tabanı" demek aynı
    // kartın paylar kısmıyla çelişirdi (QA b1-01).
    const payee = split.paintsItself
      ? "Üreticinin hakediş tabanında (boyamayı kendi atölyesinde yapıyor)"
      : "Boyacının hakediş tabanı";
    lines.push(
      line(
        { label: paintingLabel, kind: "painting", amountKurus: painting },
        { note: paintingCarved ? `Sonradan üretim payından ayrıldı · ${payee}` : payee }
      )
    );
  }
  return withUpsells(lines);
}

/**
 * Kademe notu. Fiyat kırılımında taban satırı seçimsiz birimi gösterdiği için
 * liste ve kademe fiyatları da seçim farkları çıkarılmış hâliyle yazılır —
 * computeSelectionPrice farkları iki fiyata da aynen ekler.
 */
function tierNotes(it: OrderItemMoneySnapshot, perUnitKurus: number): string[] {
  if (it.appliedTierMinQuantity === null) return [];
  const unit = it.unitPriceKurus - perUnitKurus;
  const list = it.listUnitPriceKurus === null ? null : it.listUnitPriceKurus - perUnitKurus;
  if (list !== null && list >= 0 && list !== unit) {
    return [`Liste ${formatTry(list)}/adet → ${it.appliedTierMinQuantity}+ adet kademesi ${formatTry(unit)}/adet`];
  }
  return [`${it.appliedTierMinQuantity}+ adet kademesi`];
}

/**
 * Sepet alt siparişinin bir order_items satırı, ödeme anında donmuş üretim /
 * boyama payıyla. Boyama payı olan satırın iki payı, ürünün kalem oranının
 * satır tutarının TAMAMINA uygulanmasından gelir (api/orders
 * basesForLineTotal) → fiyat kırılımı. Boyamasız ya da kalem öncesi satır tek
 * üretim satırıdır.
 */
function cartItemLines(it: OrderItemMoneySnapshot): MoneyLine[] {
  const frozen = it.productionBaseKurus !== null;
  const production = Math.min(Math.max(0, it.productionBaseKurus ?? it.lineTotalKurus), it.lineTotalKurus);
  const painting = it.lineTotalKurus - production;
  const boxNote = it.isBoxItem ? ["Anahtarlık kutusu fiyatı"] : [];

  if (painting > 0) {
    const sel = selectionRows({
      qty: it.quantity,
      amountKurus: it.lineTotalKurus,
      unitKurus: it.unitPriceKurus,
      options: it.selectedOptions,
      addons: it.selectedAddons,
      amountNoun: "satır tutarı",
      owner: it.title,
    });
    const notes = [...boxNote, ...tierNotes(it, sel.ok ? sel.perUnitKurus : 0)];
    if (sel.ok) {
      notes.push("Opsiyon ve ekler hariç taban fiyat");
    } else {
      notes.push(...optionNotes(it.selectedOptions), ...addonNotes(it.selectedAddons));
      if (sel.reason) notes.push(sel.reason);
    }
    notes.push(ratioNote("Satır", it.lineTotalKurus, production, painting));
    const head: PriceRow = sel.ok
      ? {
          label: it.title,
          qty: it.quantity,
          unitKurus: sel.unitBaseKurus,
          amountKurus: sel.unitBaseKurus * it.quantity,
          note: notes.join(" · "),
        }
      : {
          label: it.title,
          qty: it.quantity,
          unitKurus: it.unitPriceKurus,
          amountKurus: it.lineTotalKurus,
          note: notes.join(" · "),
        };
    return ratioSplitLines([head, ...(sel.ok ? sel.rows : [])], production, painting, false);
  }

  const notes = [
    ...boxNote,
    ...tierNotes(it, 0),
    ...optionNotes(it.selectedOptions),
    ...addonNotes(it.selectedAddons),
  ];
  if (!frozen) notes.push("Kalem öncesi satır: tamamı üretim sayıldı");
  return [
    line(
      { label: it.title, kind: "production", amountKurus: production },
      { qty: it.quantity, unitKurus: it.unitPriceKurus, note: notes.join(" · "), recomputed: !frozen }
    ),
  ];
}

/** Manuel admin siparişi: selectedAddons satırları, siparişin kalemleridir. */
function manualLines(s: OrderMoneySnapshot): MoneyLine[] {
  return (s.selectedAddons ?? []).map((a) =>
    line({
      label: a.name,
      // Kalem türü olmayan eski satır üretimdir — splitCostLines ile aynı kural.
      kind: isCostLineKind(a.kind) && a.kind === "painting" ? "painting" : "production",
      amountKurus: a.priceKurus,
    })
  );
}

/**
 * Donmuş kaynaktan (order_items / manuel kalemler) kurulan satırlar, sonradan
 * yapılan bölüşüm değişikliğini bilmez: admin'in "Boyama ekle" işlemi boyama
 * payını SİPARİŞİN kolonlarında üretimden ayırır ama satırlara dokunmaz.
 * Toplam aynıyken tür dağılımı kayıtlı bölüşümden farklıysa, bir çift
 * düzeltme satırı satırları kayıtlı bölüşüme eşitler (toplam değişmez).
 * Fiyat satırlarının boyama payı (`split`) da boyamadır.
 */
function reconcileKinds(lines: MoneyLine[], split: OrderMoneySplit): MoneyLine[] {
  const painting = sum(
    lines.map((l) => (l.kind === "painting" ? l.amountKurus : (l.split?.paintingKurus ?? 0)))
  );
  const total = sum(lines.map((l) => l.amountKurus));
  if (total !== split.productionBaseKurus + split.paintingBaseKurus) return lines;
  const diff = split.paintingBaseKurus - painting;
  if (diff === 0) return lines;
  const note = "Kayıtlı bölüşüme eşitleme — kalemler ödeme anındaki hâlinden";
  return [
    ...lines,
    line(
      {
        label: diff > 0 ? "Sonradan ayrılan boyama payı" : "Üretime aktarılan boyama payı",
        kind: "painting",
        amountKurus: diff,
      },
      { note, recomputed: true }
    ),
    line(
      {
        label: diff > 0 ? "Boyama payı için üretimden düşülen" : "Boyamadan gelen üretim payı",
        kind: "production",
        amountKurus: 0 - diff,
      },
      { note, recomputed: true }
    ),
  ];
}

// ─── Kim ne alır ────────────────────────────────────────────────────────────

interface InternalShare {
  share: PartyShare;
  /** Şu an atanmış bir partner var mı (yoksa taban platformda bekler). */
  assigned: boolean;
  assignedPartnerId: string | null;
  earningPartnerId: string | null;
}

function toEarningRow(e: EarningMoneySnapshot | null): PartnerEarningRow | null {
  if (!e) return null;
  return {
    grossKurus: e.grossKurus,
    commissionKurus: e.commissionKurus,
    netKurus: e.netKurus,
    rateBps: e.rateBps,
    status: e.status,
    payout: e.payout,
  };
}

/**
 * Bir payın platform hesabına etkisi: tahakkuk etmiş (geri alınmamış) satır
 * varsa GERÇEK rakamları, yoksa atanmış partnerin BEKLENEN rakamları; partner
 * yoksa ya da hakediş geri alındıysa hiçbir şey (taban platformda kalır).
 */
function effectiveOf(s: InternalShare): { gross: number; commission: number; net: number } {
  const e = s.share.earning;
  if (e) {
    if (e.status === "reversed") return { gross: 0, commission: 0, net: 0 };
    return { gross: e.grossKurus, commission: e.commissionKurus, net: e.netKurus };
  }
  if (!s.assigned) return { gross: 0, commission: 0, net: 0 };
  return {
    gross: s.share.baseKurus,
    commission: s.share.expectedCommissionKurus,
    net: s.share.expectedNetKurus,
  };
}

// ─── Ana türetim ────────────────────────────────────────────────────────────

export function deriveOrderMoneyBreakdown(s: OrderMoneySnapshot): OrderMoneyBreakdown {
  const warnings: string[] = [];
  const kind = classifyMoneyOrder(s);
  const succeeded = countsAsRevenue(s.paymentStatus);
  const refunded = isRefunded(s);

  // Üretici boyamayı KENDİSİ yaptı mı? Kargoladıktan sonra bu bir olgudur: ship
  // kapısı boyamalı siparişi yalnızca "kendim boyarım" üreticisine, boyacıya
  // devredilmemişse kargolatır. Profil bayrağı sonradan değişse de tahakkuk
  // etmiş tabanla karşılaştırma bu olguya göre yapılmalı.
  //
  // İade partnerleri koparır (manufacturerId/painterId null, iki durum da
  // 'unassigned'), yani iade edilmiş siparişte bu olgu kolonlardan okunamaz.
  // O zaman hakediş satırı olgudur: boyama kalemini de kapsayan bir üretici
  // hakedişi, üreticinin kendi boyadığını söyler. Boyacı hakedişi varsa
  // boyamayı boyacı yapmıştır ve kendi boyama hiç varsayılmaz — varsayılsaydı
  // ödenmiş bir boyacı hakedişi karttan düşerdi.
  const painterPainted = s.painterId !== null || s.painterEarning !== null;
  const mfrEarningCoversPainting =
    s.paintingPriceKurus > 0 &&
    s.manufacturerEarning !== null &&
    s.manufacturerEarning.grossKurus ===
      manufacturerBaseKurus({
        amountKurus: s.amountKurus,
        productionBaseKurus: s.productionBaseKurus,
        paintingPriceKurus: s.paintingPriceKurus,
        painterId: null,
        paintsInHouse: true,
      });
  const paintsInHouse = painterPainted
    ? false
    : s.manufacturerStatus === "shipped" || mfrEarningCoversPainting
      ? true
      : s.paintsInHouse;
  const split = orderMoneySplit({
    amountKurus: s.amountKurus,
    productionBaseKurus: s.productionBaseKurus,
    paintingPriceKurus: s.paintingPriceKurus,
    painterId: s.painterId,
    paintsInHouse,
  });

  // ── Kalemler
  let lines: MoneyLine[];
  let upsellDriftKurus = 0;
  let todayUpsellKurus = 0;
  if (kind === "cart") {
    lines = reconcileKinds(s.items.flatMap(cartItemLines), split);
  } else if (kind === "manual") {
    lines = reconcileKinds(manualLines(s), split);
  } else {
    const r = storedSplitLines(s, kind, split);
    lines = r.lines;
    upsellDriftKurus = r.upsellDriftKurus;
    todayUpsellKurus = r.todayUpsellKurus;
  }

  if (!split.splitMatches) {
    warnings.push(
      `Kalem bölüşümü tutmuyor: üretim ${formatTry(split.productionBaseKurus)} + boyama ${formatTry(split.paintingBaseKurus)} = ${formatTry(split.productionBaseKurus + split.paintingBaseKurus)}, sipariş tutarı ${formatTry(s.amountKurus)}.`
    );
  }
  if (split.legacySplit) {
    warnings.push(
      "Kalem öncesi sipariş: üretim tabanı kayıtlı değil; eski kuralla (tutar − boyama) türetildi."
    );
  }
  const linesTotal = sum(lines.map((l) => l.amountKurus));
  if (split.splitMatches && linesTotal !== s.amountKurus) {
    warnings.push(
      `Kalemlerin toplamı ${formatTry(linesTotal)}, sipariş tutarı ${formatTry(s.amountKurus)} ile tutmuyor.`
    );
  }
  if (upsellDriftKurus !== 0) {
    warnings.push(
      `Ek hizmetler bugünkü fiyatlardan yeniden hesaplandı: kayıtlı toplam ${formatTry(s.upsellAmountKurus)}, bugünkü toplam ${formatTry(todayUpsellKurus)}.`
    );
  }
  if (kind !== "cart" && kind !== "manual" && split.productionBaseKurus < s.upsellAmountKurus) {
    warnings.push("Üretim tabanı ek hizmet toplamından küçük — ana ürün satırı eksiye düştü.");
  }

  // ── Kim ne alır
  const rateBps = s.commissionRateBps ?? PLATFORM_COMMISSION_RATE_BPS;
  const rateIsEstimate = s.commissionRateBps === null;

  // İade edilmiş siparişte iki pay da kapanır: beklenen rakamlar ödenecek bir
  // şey değildir ve tahakkuk beklenmez. Hakediş satırı kendi durumunu korur.
  const voided: PartyShare["voided"] = refunded ? "refunded" : null;

  const mfrExpected = computeEarning(split.manufacturerBaseKurus, rateBps);
  const mfrEventHappened =
    s.manufacturerId !== null &&
    (s.painterId !== null || s.shippedAt !== null || s.manufacturerStatus === "shipped");
  const mfrEarning = toEarningRow(s.manufacturerEarning);
  const manufacturer: InternalShare = {
    share: {
      party: "manufacturer",
      partnerName: s.manufacturerEarning?.partnerName ?? s.manufacturerName,
      baseKurus: split.manufacturerBaseKurus,
      rateBps,
      rateIsEstimate,
      expectedCommissionKurus: nz(mfrExpected.commissionKurus),
      expectedNetKurus: nz(mfrExpected.netKurus),
      earning: mfrEarning,
      accrualEvent:
        kind === "workshop"
          ? "Atölye partisi toplu sevk edildiğinde"
          : split.paintingBaseKurus > 0 && !split.paintsItself
            ? "Boyacıya devredildiğinde (baskı payı)"
            : split.paintingBaseKurus > 0
              ? "Kendi boyayıp kargoladığında"
              : "Üretici kargoladığında",
      // `succeeded` iade edilmiş siparişte yanlıştır: kapanmış pay için eksik
      // tahakkuk alarmı çıkmaz.
      accrualMissing:
        succeeded && mfrEventHappened && split.manufacturerBaseKurus > 0 && mfrEarning === null,
      voided,
      includesPainting: split.paintsItself && split.paintingBaseKurus > 0,
    },
    assigned: s.manufacturerId !== null,
    assignedPartnerId: s.manufacturerId,
    earningPartnerId: s.manufacturerEarning?.partnerId ?? null,
  };

  const internal: InternalShare[] = [manufacturer];
  // Üretici kendi boyuyorsa boyama payı ONUN tabanındadır (includesPainting).
  // ₺0 tabanlı bir "Boyacı · atanmadı" payı, hiç gerçekleşmeyecek bir tahakkuku
  // bekliyormuş gibi görünürdü.
  if (
    !split.paintsItself &&
    (split.paintingBaseKurus > 0 || s.painterId !== null || s.painterEarning !== null)
  ) {
    const pExpected = computeEarning(split.painterBaseKurus, rateBps);
    const pEventHappened =
      s.painterId !== null && (s.painterStatus === "shipped" || s.shippedAt !== null);
    const pEarning = toEarningRow(s.painterEarning);
    internal.push({
      share: {
        party: "painter",
        partnerName: s.painterEarning?.partnerName ?? s.painterName,
        baseKurus: split.painterBaseKurus,
        rateBps,
        rateIsEstimate,
        expectedCommissionKurus: nz(pExpected.commissionKurus),
        expectedNetKurus: nz(pExpected.netKurus),
        earning: pEarning,
        accrualEvent: "Boyacı kargoladığında",
        accrualMissing:
          succeeded && pEventHappened && split.painterBaseKurus > 0 && pEarning === null,
        voided,
        includesPainting: false,
      },
      assigned: s.painterId !== null,
      assignedPartnerId: s.painterId,
      earningPartnerId: s.painterEarning?.partnerId ?? null,
    });
  }

  for (const i of internal) {
    const who = i.share.party === "manufacturer" ? "Üretici" : "Boyacı";
    const name = i.share.partnerName ? ` (${i.share.partnerName})` : "";
    const e = i.share.earning;
    if (i.share.accrualMissing) {
      warnings.push(
        `Tahakkuk eksik: ${who}${name} için tahakkuk olayı gerçekleşti (${i.share.accrualEvent.toLocaleLowerCase("tr")}) ama hakediş satırı yok.`
      );
    }
    if (e && e.status === "reversed") {
      warnings.push(`${who} hakedişi geri alındı (iade / itiraz) — ${formatTry(e.netKurus)} ödenmeyecek.`);
    }
    if (
      e &&
      e.status !== "reversed" &&
      i.assignedPartnerId !== null &&
      i.earningPartnerId !== null &&
      i.earningPartnerId !== i.assignedPartnerId
    ) {
      warnings.push(`${who} hakedişi şu an atanmış olandan farklı bir partnere yazılmış${name}.`);
    } else if (succeeded && e && e.status !== "reversed" && e.grossKurus !== i.share.baseKurus) {
      warnings.push(
        `${who} hakedişi brütü ${formatTry(e.grossKurus)}, beklenen taban ${formatTry(i.share.baseKurus)} (fark ${formatTry(e.grossKurus - i.share.baseKurus)}).`
      );
    }
  }

  const activeGross = sum(
    internal.map((i) => (i.share.earning && i.share.earning.status !== "reversed" ? i.share.earning.grossKurus : 0))
  );
  if (activeGross > s.amountKurus) {
    warnings.push(
      `Partner hakedişlerinin brüt toplamı ${formatTry(activeGross)} sipariş tutarını (${formatTry(s.amountKurus)}) aşıyor.`
    );
  }

  // ── Platform
  let platform: OrderMoneyBreakdown["platform"];
  if (succeeded) {
    const eff = internal.map(effectiveOf);
    const commissionKurus = sum(eff.map((e) => e.commission));
    // Hiçbir partnerin kazanmadığı taban (atanmamış boyacı payı, geri alınmış
    // hakediş…) şimdilik platformda durur.
    const unassignedBaseKurus = s.amountKurus - sum(eff.map((e) => e.gross));
    platform = {
      commissionKurus: nz(commissionKurus),
      unassignedBaseKurus: nz(unassignedBaseKurus),
      netKurus: nz(commissionKurus + unassignedBaseKurus - s.giftCardAmountKurus - s.havaleDiscountKurus),
    };
  } else {
    // İade: tahsilat ciroya sayılmaz, bekleyen hakedişler geri alındı; yalnızca
    // ÖDENMİŞ (geri alınamayan) hakediş kalır ve o, platformun zararıdır.
    const paidOut = sum(
      internal.map((i) => (i.share.earning && i.share.earning.status !== "reversed" ? i.share.earning.netKurus : 0))
    );
    // `-paidOut` ödenmiş hakediş yokken -0 verirdi → ekranda "-₺0,00".
    platform = { commissionKurus: 0, unassignedBaseKurus: 0, netKurus: nz(0 - paidOut) };
    warnings.push(
      `Sipariş iade edildi: tahsil edilen ${formatTry(cashCollectedKurus(s))} ciroya sayılmaz; para PayTR / banka üzerinden elle iade edilir.`
    );
    if (paidOut > 0) {
      warnings.push(`İadeye rağmen ödenmiş partner hakedişi geri alınmadı: ${formatTry(paidOut)} platform zararı.`);
    }
  }

  // ── Sepet: alt siparişlerin toplamı ödeme taslağını tutmalı. Tutmuyorsa fark
  // hiçbir alt siparişe yazılmamıştır (ör. sepette seçilen ek hizmet).
  if (kind === "cart" && s.cartDraftAmountKurus !== null) {
    const subTotal = s.amountKurus + sum(s.siblings.map((x) => x.amountKurus));
    if (subTotal !== s.cartDraftAmountKurus) {
      warnings.push(
        `Sepet alt siparişlerinin toplamı ${formatTry(subTotal)}, ödeme taslağı ${formatTry(s.cartDraftAmountKurus)} — fark ${formatTry(s.cartDraftAmountKurus - subTotal)} hiçbir alt siparişe yazılmamış.`
      );
    }
  }

  return {
    lines,
    totals: {
      amountKurus: s.amountKurus,
      productionBaseKurus: split.productionBaseKurus,
      paintingPriceKurus: s.paintingPriceKurus,
      splitMatches: split.splitMatches,
      legacySplit: split.legacySplit,
    },
    collection: {
      amountKurus: s.amountKurus,
      giftCardKurus: s.giftCardAmountKurus,
      havaleDiscountKurus: s.havaleDiscountKurus,
      cashCollectedKurus: cashCollectedKurus(s),
      revenueKurus: revenueKurus(s),
      paymentMethod: s.paymentMethod,
      paymentStatus: s.paymentStatus,
      // Her kardeş KENDİ kolonlarından: sepetin hediye çeki / havale indirimi
      // ödemede alt siparişlere orantılı dağıtıldı, burada paylaştırılmaz.
      siblings: s.siblings.map((x) => ({
        id: x.id,
        orderNumber: x.orderNumber,
        status: x.status,
        paymentStatus: x.paymentStatus,
        amountKurus: x.amountKurus,
        giftCardKurus: x.giftCardAmountKurus,
        havaleDiscountKurus: x.havaleDiscountKurus,
        cashCollectedKurus: cashCollectedKurus(x),
      })),
    },
    shares: internal.map((i) => i.share),
    platform,
    warnings,
  };
}
