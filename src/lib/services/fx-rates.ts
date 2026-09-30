/**
 * TCMB günlük döviz bülteni: çekme, ayrıştırma, `fx_rates`e yazma ve teklifin
 * dondurabileceği kur kümesini okuma.
 *
 * NOT: `import "server-only"` YOK — bu modülü BullMQ worker süreci
 * (`fx-refresh.worker.ts`) yükler ve `server-only` onu açılışta crash-loop'a
 * sokar (2026-06-13'te yaşandı). Yasak yalnız bu satır değil, bu dosyanın
 * ZİNCİRİ: bilinen sızıntı yolu `quote-checkout.ts` → `attribution-server.ts`
 * olduğu için bu dosya `quote-checkout.ts`i import ETMEZ. Kapıyı
 * `scripts/test-quote-maintenance-db.ts` (statik graf yürüyüşü) ve
 * `scripts/test-fx-rates.ts` (kaynak denetimi) birlikte tutar.
 *
 * ─── GÖSTERİM, YALNIZ GÖSTERİM ─────────────────────────────────────────────
 *
 * Buradaki kur ekranda ₺ tutarının YANINDA "≈ <döviz>" olarak gösterilen
 * yaklaşık bir ikinci kolonu besler. Bağlayıcı her tutar, saklanan her PARA
 * kolonu ve tahsil edilen her kuruş TÜRK LİRASIDIR (32 Sayılı Karar m.4/g +
 * 2008-32/34 Tebliğ m.8 — gerekçenin tamamı `quote-currency.ts` başlığında).
 * Bu dosya bir kuruş bile YAZMAZ, hiçbir tutarı çevirmez; çevirim
 * `quote-currency.ts`in işidir ve bu modül onu import etmez.
 *
 * ─── YÖN: TCMB DÖVİZ ALIŞ (`ForexBuying`) ──────────────────────────────────
 *
 * Müşteri ₺ ödeyecek; "≈ €120" gördüğünde kendi bankası ona TL'yi daha kötü
 * kurla satacak, yani gerçekte 120 €'dan FAZLASINA denk gelir. `ForexBuying`
 * (birim başına daha AZ lira) aynı kuruş için daha BÜYÜK bir döviz rakamı
 * üretir, yani maliyeti hafifçe FAZLA gösterir. Fiyatı eksik göstermek bir
 * sorumluluktur (müşteriye söylenen fiyat TKHK m.4 gereği bağlayıcı ön
 * bilgidir — aynı ilke `src/lib/agent/output-guard.ts` başlığında), fazla
 * göstermek değildir. Bu yüzden `ForexSelling` SEÇİLMEZ ve efektif
 * (`BanknoteBuying`) HİÇ kullanılmaz: efektif kur banknot işlemleriyle
 * ilgilidir, havale/kredi kartı akışıyla değil.
 *
 * ─── FAIL-CLOSED ───────────────────────────────────────────────────────────
 *
 * Hiçbir fonksiyon FIRLATMAZ: her biri etiketli bir sonuç döner ve hatayı
 * günlüğe yazar (`indexnow.ts` sözleşmesi). Başarısız tur DB'ye satır YAZMAZ,
 * son geçerli satır yerinde kalır. Kur eksik ya da BAYAT ise
 * `loadActiveFxSnapshot()` `null` döner; `null`, çağıran zincirin tamamında
 * "döviz gösterimi yok" demektir — yanlış kur göstermek, hiç göstermemekten
 * kötüdür.
 *
 * SÜREÇ İÇİ YENİDEN DENEME YOK: depoda böyle bir yardımcı yok ve buraya da
 * yazılmadı. Yeniden deneme BullMQ'nun işidir (`quote-queues.ts`
 * `DEFAULT_JOB_OPTIONS`: `attempts: 2`, 10 sn üstel gecikme); işçi başarısız
 * turda ATAR, böylece tur bir kez daha denenir ve iz `failed` listesinde kalır.
 */
import { desc, eq } from "drizzle-orm";
import { addBusinessDays, istanbulDateKey } from "@/lib/config/business-days";
import {
  FX_CURRENCIES,
  type FrozenFxRate,
  type FxCurrency,
  type QuoteFxSnapshot,
} from "@/lib/config/quote-types";
import { db } from "@/lib/db";
import { fxRates } from "@/lib/db/schema";

/** TCMB'nin günlük bülteni. Gün içinde geç yayımlanabilir (bkz. zamanlayıcı). */
export const TCMB_BULLETIN_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";

/** Emsal `indexnow.ts` (`TIMEOUT_MS = 8_000`) ve `paytr.ts`in adlandırılmış sabitleri. */
export const TCMB_TIMEOUT_MS = 8_000;

/**
 * Kur kaç İŞ GÜNÜ sonra bayat sayılır.
 *
 * TAKVİM GÜNÜ DEĞİL, İŞ GÜNÜ — ve bu tasarımdan bilinçli bir sapmadır
 * (tasarımın `FX_MAX_AGE_DAYS = 7` takvim günü sabiti KULLANILMAZ). Sebebi:
 * TCMB yalnız iş günü bülten yayımlar; üç günlük bir bayram + hafta sonu SIFIR
 * bültenle beş takvim gününü aşar. Takvim günü eşiği ya o pencerede yanlış
 * alarm verir ya da uzun tatili tolere etmek için gevşetildiğinde tatilin
 * ARDINDAN gelen gerçek bir TCMB arızasını sessizce kabul eder. İş günü eşiği
 * ikisini birden kapatır ve tatil listesini kim güncellerse bayatlık ölçüsü de
 * kendiliğinden güncellenir.
 *
 * Ölçü deponun KENDİ takvimiyle kurulur (`business-days.ts` +
 * `quote_pricing_settings.holidays`); ikinci bir takvim icat edilmedi.
 */
export const FX_MAX_AGE_BUSINESS_DAYS = 3;

/** Bültenden okunan tek satır. Kuruş taşımaz (bkz. dosya başlığı). */
export interface ParsedFxRate {
  currency: FxCurrency;
  /** 1 birim döviz = kaç mikro-TRY (TCMB döviz alış / `Unit`, ×1e6, tamsayı). */
  microTryPerUnit: number;
  /** Bültendeki `Unit` — kanıt olarak saklanır, bölme burada yapılmıştır. */
  bulletinUnit: number;
}

export interface ParsedFxBulletin {
  /** Bültenin KENDİ tarihi (YYYY-MM-DD), `new Date()`ten DEĞİL. */
  bulletinDate: string;
  /** Sıra `FX_CURRENCIES` sırasıdır; eksik birim varsa bülten hiç doğmaz. */
  rates: ParsedFxRate[];
}

export type FxBulletinFailure =
  | "network_error"
  | "http_error"
  | "empty_body"
  | "malformed_xml"
  | "invalid_bulletin_date"
  | "invalid_rate"
  | "missing_currency";

export type FxBulletinResult =
  | { ok: true; bulletin: ParsedFxBulletin }
  | { ok: false; reason: FxBulletinFailure };

export type FxRefreshResult =
  | { ok: true; bulletinDate: string; insertedRows: number }
  | { ok: false; reason: FxBulletinFailure | "db_error" };

/** Türkçe karşılıklar: admin ekranı ham etiketi değil bu cümleyi gösterir. */
export const FX_FAILURE_LABELS_TR: Record<FxBulletinFailure | "db_error", string> = {
  network_error: "TCMB'ye ulaşılamadı (ağ hatası ya da zaman aşımı).",
  http_error: "TCMB beklenmeyen bir HTTP durumu döndürdü.",
  empty_body: "TCMB boş bir bülten döndürdü.",
  malformed_xml: "TCMB bülteni beklenen XML biçiminde değil.",
  invalid_bulletin_date: "Bültenin tarihi okunamadı.",
  invalid_rate: "Bültendeki bir kur ya da birim değeri okunamadı.",
  missing_currency: "Bültende beklenen üç para biriminden biri yok; bülten tümden reddedildi.",
  db_error: "Kurlar veritabanına yazılamadı.",
};

// ─── Ayrıştırma (saf: ağ yok, saat yok) ─────────────────────────────────────

/**
 * Kök öğenin `Tarih` özniteliği: `GG.AA.YYYY`.
 *
 * Bülten tarihi DOSYADAN okunur, `new Date()`ten ASLA: hafta sonu ve resmî
 * tatilde TCMB ya 404 döner ya da DÜNKÜ bülteni verir; dünkü rakamı "bugünün
 * kuru" diye damgalamak bu özelliğin en sinsi hatası olurdu.
 */
const BULLETIN_DATE_RE = /<Tarih_Date\b[^>]*\bTarih="(\d{2})\.(\d{2})\.(\d{4})"/;

/** Tek bir `<Currency …>` bloğu; `CurrencyCode` özniteliğiyle eşlenir. */
const CURRENCY_BLOCK_RE = /<Currency\b[^>]*\bCurrencyCode="([A-Za-z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g;

function innerText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block);
  return match ? match[1].trim() : null;
}

/**
 * `GG.AA.YYYY` → `YYYY-AA-GG`, ya da takvimde olmayan bir gün ise `null`.
 *
 * `31.02.2026` gibi bir değer sessizce 3 Mart'a kaymamalı: kaysaydı bültenin
 * tarihi UYDURULMUŞ olurdu ve bayatlık ölçüsü yanlış günden sayardı.
 */
function bulletinDateKey(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Ondalık bir kuru MİKRO-TRY tamsayısına çevirir — kayan noktaya uğramadan.
 *
 * `Number("48.7412") * 1e6` kayan nokta artığı üretir; kesir basamakları
 * DİZGİ olarak ölçeklenir, böylece aynı bülten her turda AYNI tamsayıyı verir.
 * TCMB dört basamak yayımlar; altıya kadar kabul edilir (biçim bir gün
 * değişirse tur kırılmasın), daha fazlası reddedilir çünkü sessizce kırpmak
 * gösterilen rakamı bozardı.
 */
function parseMicroTry(raw: string | null): number | null {
  if (raw === null) return null;
  const match = /^(\d{1,9})(?:[.,](\d{1,6}))?$/.exec(raw);
  if (!match) return null;
  const micro = Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"));
  return micro > 0 ? micro : null;
}

function parseUnit(raw: string | null): number | null {
  if (raw === null || !/^\d{1,6}$/.test(raw)) return null;
  const unit = Number(raw);
  return unit > 0 ? unit : null;
}

/**
 * Bülten XML'ini ayrıştırır. Saati OKUMAZ, ağa çıkmaz, FIRLATMAZ.
 *
 * Beklenen üç birimden biri eksikse BÜLTENİN TAMAMI reddedilir: yarım bir
 * bülten, seçicide bir birimin sessizce kaybolması demek olurdu.
 */
export function parseTcmbBulletin(xml: string): FxBulletinResult {
  if (xml.trim().length === 0) return { ok: false, reason: "empty_body" };

  const dateMatch = BULLETIN_DATE_RE.exec(xml);
  if (!dateMatch) {
    // Kök öğe yok: TCMB bakım sayfası, hata gövdesi ya da biçim değişikliği.
    return { ok: false, reason: /<Tarih_Date\b/.test(xml) ? "invalid_bulletin_date" : "malformed_xml" };
  }
  const bulletinDate = bulletinDateKey(dateMatch[1], dateMatch[2], dateMatch[3]);
  if (bulletinDate === null) return { ok: false, reason: "invalid_bulletin_date" };

  const blocks = new Map<string, string>();
  for (const match of xml.matchAll(CURRENCY_BLOCK_RE)) {
    blocks.set(match[1].toUpperCase(), match[2]);
  }
  if (blocks.size === 0) return { ok: false, reason: "malformed_xml" };

  const rates: ParsedFxRate[] = [];
  for (const currency of FX_CURRENCIES) {
    const block = blocks.get(currency);
    if (block === undefined) return { ok: false, reason: "missing_currency" };
    const buying = parseMicroTry(innerText(block, "ForexBuying"));
    const unit = parseUnit(innerText(block, "Unit"));
    if (buying === null || unit === null) return { ok: false, reason: "invalid_rate" };
    rates.push({
      currency,
      microTryPerUnit: Math.round(buying / unit),
      bulletinUnit: unit,
    });
  }
  return { ok: true, bulletin: { bulletinDate, rates } };
}

// ─── Çekme ──────────────────────────────────────────────────────────────────

/**
 * Bülteni TCMB'den çeker ve ayrıştırır. FIRLATMAZ: her arıza etiketli bir
 * sonuçtur ve `console.warn`a yazılır (`indexnow.ts` sözleşmesi).
 */
export async function fetchTcmbBulletin(): Promise<FxBulletinResult> {
  let body: string;
  try {
    const response = await fetch(TCMB_BULLETIN_URL, {
      signal: AbortSignal.timeout(TCMB_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[fx-rates] TCMB ${response.status}`);
      return { ok: false, reason: "http_error" };
    }
    body = await response.text();
  } catch (err) {
    console.warn("[fx-rates] TCMB bülteni çekilemedi", err);
    return { ok: false, reason: "network_error" };
  }
  const parsed = parseTcmbBulletin(body);
  if (!parsed.ok) console.warn(`[fx-rates] bülten reddedildi: ${parsed.reason}`);
  return parsed;
}

// ─── Yazma ──────────────────────────────────────────────────────────────────

/**
 * Bülteni `fx_rates`e yazar ve YAZILAN satır sayısını döner.
 *
 * `ON CONFLICT (currency, bulletin_date) DO NOTHING` (tekil indeks
 * `fx_rates_currency_date_uq`): aynı bültenin ikinci kez çekilmesi zararsızdır
 * — hafta sonu ve tatilde TCMB dünkü bülteni tekrar verir, ve zamanlayıcı günde
 * birden fazla tur koşar.
 *
 * Hata YAKALAMA ile ayıklamak seçenek DEĞİLDİ: drizzle 0.45 pg hatalarını
 * sarıyor, yakalanan hatanın `.code` alanı `undefined` oluyor (gerçek kod
 * `.cause` üstünde). Bu yüzden tekillik veritabanına bırakıldı.
 */
export async function upsertFxBulletin(bulletin: ParsedFxBulletin): Promise<number> {
  const inserted = await db
    .insert(fxRates)
    .values(
      bulletin.rates.map((rate) => ({
        currency: rate.currency,
        bulletinDate: bulletin.bulletinDate,
        microTryPerUnit: rate.microTryPerUnit,
        bulletinUnit: rate.bulletinUnit,
        source: "tcmb" as const,
      }))
    )
    .onConflictDoNothing({ target: [fxRates.currency, fxRates.bulletinDate] })
    .returning({ id: fxRates.id });
  return inserted.length;
}

/**
 * Tek bir çekme turu: çek → ayrıştır → yaz.
 *
 * Bayrağı OKUMAZ. Bayrak kapısı iki ayrı yerde yaşıyor ve sebebi ayrı: otomatik
 * turu `fx-refresh.worker.ts` ilk satırında keser (kapalı özellik için TCMB'ye
 * çıkılmaz), admin'in "Şimdi çek"i ise bilerek kapısızdır — operatör bayrağı
 * AÇMADAN ÖNCE TCMB erişimini doğrulayabilmeli.
 */
export async function refreshFxRates(): Promise<FxRefreshResult> {
  const parsed = await fetchTcmbBulletin();
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  try {
    const insertedRows = await upsertFxBulletin(parsed.bulletin);
    return { ok: true, bulletinDate: parsed.bulletin.bulletinDate, insertedRows };
  } catch (err) {
    console.error("[fx-rates] kurlar yazılamadı", err);
    return { ok: false, reason: "db_error" };
  }
}

// ─── Okuma + bayatlık kapısı ────────────────────────────────────────────────

/**
 * Bültenin geçerli sayıldığı SON gün (İstanbul gün anahtarı).
 *
 * `addBusinessDays`in `cutoffHour` parametresine **24** verilmesi ZORUNLUDUR:
 * fonksiyon `istanbulHour(start) >= cutoffHour` iken günü bir ileri atıyor
 * (akşam verilen sipariş o gün tezgâha girmez kuralı). Saat hiç 24 olmadığı
 * için 24, "akşam kesimi yok" demektir — bir bültenin YAŞI onun günüyle
 * ölçülür, günün hangi saatinde yayımlandığıyla değil. Daha küçük bir değer
 * ölçüyü bir iş günü kaydırırdı.
 */
function staleAfterKey(bulletinDate: string, holidays: string[]): string {
  return istanbulDateKey(
    addBusinessDays(
      new Date(`${bulletinDate}T12:00:00.000Z`),
      FX_MAX_AGE_BUSINESS_DAYS,
      holidays,
      24
    )
  );
}

/**
 * Bülten bayat mı — ölçü İŞ GÜNÜ (gerekçe `FX_MAX_AGE_BUSINESS_DAYS`).
 *
 * `holidays` teklifin/kataloğun KENDİ tatil listesidir
 * (`quote_pricing_settings.holidays`); ikinci bir takvim yoktur. Gün anahtarları
 * `YYYY-AA-GG` olduğu için dizgi karşılaştırması takvim karşılaştırmasıdır.
 */
export function isFxBulletinStale(
  bulletinDate: string,
  holidays: string[],
  now: Date = new Date()
): boolean {
  return istanbulDateKey(now) > staleAfterKey(bulletinDate, holidays);
}

/**
 * Teklifin dondurabileceği kur kümesi, ya da `null` = **döviz gösterimi yok**.
 *
 * `null` dönen üç hâl, hepsi "yanlış kur göstermek hiç göstermemekten kötüdür"
 * kuralının sonucu:
 *  1. `fx_rates` boş (hiç tur başarılı olmamış),
 *  2. en yeni bülten BAYAT (`isFxBulletinStale`),
 *  3. en yeni bülten YARIM (üç birimden biri eksik) — yarım bir küme,
 *     seçicide bir birimin sessizce kaybolması demek olurdu.
 *
 * `holidays` çağıranın verdiği listedir, bu modül kataloğu OKUMAZ: teklifin
 * kendi DONMUŞ snapshot'ıyla ölçülmesi daha tutarlıdır (teklif dondurulduğu
 * günün takvimiyle yaşar) ve bu dosya `quote-catalog.ts`e bağlanmaz.
 *
 * Bu bir OKUMADIR: hiçbir `updated_at`e dokunmaz, yani `catalogUpdatedAt()`
 * tuzağını tetiklemez ("Katalog güncellendi — yeniden fiyatla" bandı yanmaz).
 */
export async function loadActiveFxSnapshot(
  holidays: string[],
  now: Date = new Date()
): Promise<QuoteFxSnapshot | null> {
  const latest = await loadLatestFxBulletin();
  if (latest === null) return null;
  if (isFxBulletinStale(latest.bulletinDate, holidays, now)) return null;

  const rates: FrozenFxRate[] = [];
  for (const currency of FX_CURRENCIES) {
    const row = latest.rates.find((r) => r.currency === currency);
    if (!row) return null;
    rates.push({ currency, microTryPerUnit: row.microTryPerUnit });
  }
  return {
    version: 1,
    source: "tcmb",
    bulletinDate: latest.bulletinDate,
    takenAt: now.toISOString(),
    rates,
  };
}

export interface LatestFxBulletin {
  bulletinDate: string;
  /** Sıra `FX_CURRENCIES` sırasıdır; EKSİK birim olabilir (okuyucu karar verir). */
  rates: Array<{ currency: FxCurrency; microTryPerUnit: number; bulletinUnit: number }>;
  /** Son başarılı turun damgası — operatörün "kur güncel mi" sorusunun cevabı. */
  fetchedAt: Date;
}

/** En yeni bülten tarihine ait satırlar, ya da hiç satır yoksa `null`. */
export async function loadLatestFxBulletin(): Promise<LatestFxBulletin | null> {
  const [newest] = await db
    .select({ bulletinDate: fxRates.bulletinDate })
    .from(fxRates)
    .orderBy(desc(fxRates.bulletinDate))
    .limit(1);
  if (!newest) return null;

  const rows = await db
    .select({
      currency: fxRates.currency,
      microTryPerUnit: fxRates.microTryPerUnit,
      bulletinUnit: fxRates.bulletinUnit,
      fetchedAt: fxRates.fetchedAt,
    })
    .from(fxRates)
    .where(eq(fxRates.bulletinDate, newest.bulletinDate));
  if (rows.length === 0) return null;

  // Sıra ekranda ve snapshot'ta SABİT olmalı: seçici bu sırayı çizer.
  const ordered = FX_CURRENCIES.flatMap((currency) => {
    const row = rows.find((r) => r.currency === currency);
    return row
      ? [{ currency, microTryPerUnit: row.microTryPerUnit, bulletinUnit: row.bulletinUnit }]
      : [];
  });
  const fetchedAt = rows.reduce(
    (latest, row) => (row.fetchedAt > latest ? row.fetchedAt : latest),
    rows[0].fetchedAt
  );
  return { bulletinDate: newest.bulletinDate, rates: ordered, fetchedAt };
}

/** Admin ekranının tek okuması: son kurlar + bülten tarihi + bayat mı. */
export interface FxAdminOverview {
  bulletin: LatestFxBulletin | null;
  /** Bülten yoksa `true`: ikisi de "döviz gösterimi yok" demektir. */
  stale: boolean;
  /** Eşik, ekranda AYNEN yazılır ki operatör neyi okuduğunu bilsin. */
  maxAgeBusinessDays: number;
  /** Bültenin geçerli sayıldığı son gün (`YYYY-AA-GG`), bülten yoksa `null`. */
  staleAfter: string | null;
}

export async function loadFxAdminOverview(
  holidays: string[],
  now: Date = new Date()
): Promise<FxAdminOverview> {
  const bulletin = await loadLatestFxBulletin();
  return {
    bulletin,
    stale: bulletin === null || isFxBulletinStale(bulletin.bulletinDate, holidays, now),
    maxAgeBusinessDays: FX_MAX_AGE_BUSINESS_DAYS,
    staleAfter: bulletin === null ? null : staleAfterKey(bulletin.bulletinDate, holidays),
  };
}
