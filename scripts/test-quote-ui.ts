/**
 * Anlık teklif motorunun MÜŞTERİ YÜZEYİ testleri.
 *
 * Buradaki sınav "bir şey render oluyor mu" değil, ekranın müşteriye DOĞRU
 * ŞEYİ söyleyip söylemediğidir: sözlük her DfM kodunu Türkçe bir cümleye
 * çeviriyor mu, başarısız analiz ile manuel fiyat bekleyen parça birbirinden
 * ayrılıyor mu, fiyat kapısı kapalıyken rakam sızıyor mu.
 *
 * Faz 3'ün sonraki görevleri (3.2 / 3.3) bu dosyayı GENİŞLETİR.
 *
 * Çalıştırma: npx tsx scripts/test-quote-ui.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LocaleProvider } from "../src/lib/i18n/locale-context";
import { PriceGateModal } from "../src/components/quote/price-gate-modal";
import en from "../src/lib/i18n/dictionaries/en";
import tr from "../src/lib/i18n/dictionaries/tr";
import { DFM_CODES, QUOTE_STATUSES } from "../src/lib/config/quote-types";
import { EVENTS, isEventName } from "../src/lib/analytics/events";
import { isNoindexPath } from "../src/lib/seo/policy";
import robots from "../src/app/robots";

const PREFIX = "instantQuote.";
const trKeys = Object.keys(tr).filter((k) => k.startsWith(PREFIX));
const enKeys = Object.keys(en).filter((k) => k.startsWith(PREFIX));

// ─── Sözlük bloğu ───────────────────────────────────────────────────────────

test("instantQuote bloğu iki sözlükte de aynı anahtarları taşır", () => {
  assert.ok(trKeys.length > 100, `instantQuote bloğu çok küçük: ${trKeys.length}`);
  assert.deepEqual(new Set(trKeys), new Set(enKeys));
  for (const key of trKeys) {
    assert.ok(
      (tr as Record<string, string>)[key].trim().length > 0,
      `${key} Türkçe karşılığı boş`
    );
  }
});

test("instantQuote bloğu tek parça hâlinde ve dosyanın ORTASINDA duruyor", () => {
  // Blok bölünürse sonraki görevler (3.2 / 3.3) anahtarı nereye ekleyeceğini
  // bilemez; dosyanın SONUNA taşınırsa diğer oturumun eklemeleriyle çakışır.
  for (const name of ["tr.ts", "en.ts"]) {
    const lines = fs
      .readFileSync(path.resolve("src/lib/i18n/dictionaries", name), "utf8")
      .split("\n");
    const hits = lines.flatMap((line, i) => (line.includes(`"${PREFIX}`) ? [i] : []));
    assert.ok(hits.length > 100, `${name}: instantQuote anahtarı bulunamadı`);
    const [first, last] = [hits[0], hits[hits.length - 1]];
    for (let i = first; i <= last; i++) {
      const line = lines[i].trim();
      const inBlock =
        line.startsWith(`"${PREFIX}`) || line.startsWith("//") || line === "" ||
        // çok satırlı bir değerin devamı (anahtar bir üst satırda)
        line.startsWith('"') || line.startsWith("'");
      assert.ok(inBlock, `${name}:${i + 1} blok yabancı bir satırla bölünmüş: ${line}`);
    }
    assert.ok(last < lines.length - 40, `${name}: blok dosyanın sonuna yapışmış`);
    assert.ok(first > 40, `${name}: blok dosyanın başına yapışmış`);
  }
});

// ─── DfM mesajları ──────────────────────────────────────────────────────────

test("her DfM kodunun Türkçe bir cümlesi var", () => {
  for (const code of DFM_CODES) {
    const key = `${PREFIX}dfm.${code}`;
    assert.ok(trKeys.includes(key), `${key} eksik`);
  }
});

test("okunamayan dosya, manuel fiyat bekleyen parçadan AYRI anlatılır", () => {
  const t = tr as Record<string, string>;
  // Taşıma notu (c): analizi ÇÖKEN parçanın çözümü yeniden yüklemek, elle
  // fiyatlanacak parçanınki beklemek. Aynı cümle ikisini birden anlatamaz.
  assert.equal(t[`${PREFIX}dfm.analysis_failed`], "Dosya okunamadı — lütfen yeniden yükleyin.");
  assert.doesNotMatch(t[`${PREFIX}dfm.analysis_failed`], /manuel|elle/i);
  assert.match(t[`${PREFIX}part.badge.manualPrice`], /manuel/i);
  assert.notEqual(t[`${PREFIX}dfm.analysis_failed`], t[`${PREFIX}part.badge.manualPrice`]);
});

test("katalogdan düşen malzeme müşteriyi malzeme seçimine yönlendirir", () => {
  // 2.4a: yeniden fiyatlama sonrası malzemesi kalkan parçada uç, geçerli bir
  // malzeme seçilmeden HİÇBİR alanı güncellemiyor. Ekran bunu söylemezse
  // müşteri adet kutusunu döndürüp durur.
  const t = tr as Record<string, string>;
  assert.equal(t[`${PREFIX}part.config.materialPlaceholder`], "Malzeme seçin");
  assert.match(t[`${PREFIX}dfm.config_invalid`], /malzeme/i);
});

test("parametreli DfM cümleleri yer tutucularını kaybetmemiş", () => {
  const t = tr as Record<string, string>;
  const expected: Record<string, string[]> = {
    "dfm.too_large": ["{maxX}", "{maxY}", "{maxZ}"],
    "dfm.too_large.fitScale": ["{scale}"],
    "dfm.too_large.fitsTechnology": ["{technology}"],
    "dfm.too_small": ["{largestMm}", "{minMm}"],
    "dfm.thin_walls": ["{wallMm}", "{minMm}"],
    "dfm.multiple_bodies": ["{count}"],
    "dfm.qty_over_auto": ["{quantity}", "{maxQuantity}"],
    "dfm.qty_over_auto.total": ["{maxTotal}"],
  };
  for (const [suffix, params] of Object.entries(expected)) {
    const value = t[PREFIX + suffix];
    assert.ok(value, `${PREFIX}${suffix} eksik`);
    for (const p of params) {
      assert.ok(value.includes(p), `${PREFIX}${suffix} içinde ${p} yok`);
    }
  }
});

test("her teklif durumunun bir rozeti var ve fiyat kapısı yer tutucusu rakamsız", () => {
  for (const status of QUOTE_STATUSES) {
    assert.ok(trKeys.includes(`${PREFIX}status.${status}`), `status.${status} eksik`);
  }
  const hidden = (tr as Record<string, string>)[`${PREFIX}price.hidden`];
  assert.equal(hidden, "–₺–,––");
  assert.doesNotMatch(hidden, /\d/);
});

// ─── Analitik ───────────────────────────────────────────────────────────────

test("teklif hunisinin olayları kataloğa kayıtlı", () => {
  // /api/analytics/collect tanımadığı adı SESSİZCE düşürür; kayıtlı olmayan
  // olay hiç ölçülmez.
  for (const name of ["quote_upload", "sign_up", "generate_lead"] as const) {
    assert.ok(isEventName(name), `${name} EventName değil`);
    assert.ok(EVENTS[name], `${name} EVENTS içinde yok`);
  }
  assert.equal(EVENTS.quote_upload.client.ga4, "quote_upload");
  assert.equal(EVENTS.quote_upload.server.ga4, null);
  assert.equal(EVENTS.sign_up.client.ga4, "sign_up");
  assert.equal(EVENTS.sign_up.client.meta, "CompleteRegistration");
  // generate_lead'in doğrusu SUNUCUDA: manuel teklif / hedef fiyat isteği uç
  // tarafında kaydedilir, tarayıcı yenilemesi şişiremez.
  assert.equal(EVENTS.generate_lead.server.ga4, "generate_lead");
  assert.equal(EVENTS.generate_lead.client.ga4, null);
});

// ─── SEO ────────────────────────────────────────────────────────────────────

test("çalışma alanı noindex, açılış sayfası indexlenebilir", () => {
  assert.ok(isNoindexPath("/teklif"));
  assert.ok(isNoindexPath("/teklif/T-000001"));
  assert.ok(isNoindexPath("/teklif/T-000001/belge"));
  assert.ok(!isNoindexPath("/3d-baski"));
  assert.ok(!isNoindexPath("/3d-baski/malzemeler"));
});

// ─── Fiyat kapısı modalı ────────────────────────────────────────────────────

const noop = () => {};
const router = {
  back: noop, forward: noop, push: noop, replace: noop,
  refresh: noop, prefetch: noop, hmrRefresh: noop,
};

// `LocaleProvider` çocuklarını ZORUNLU bir prop olarak yazar; createElement'in
// üçüncü argümanı çalışma zamanında aynı şeyi yapar ama imza bunu bilmez.
const Locale = LocaleProvider as unknown as FunctionComponent<{ locale: "tr" }>;

function renderModal(
  props: Partial<Parameters<typeof PriceGateModal>[0]> = {}
): string {
  const full = {
    open: true,
    onClose: noop,
    onAuthenticated: noop,
    redirectPath: "/teklif/T-000001",
    ...props,
  };
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(Locale, { locale: "tr" }, createElement(PriceGateModal, full))
    )
  );
}

test("kapalı modal hiçbir şey çizmez", () => {
  assert.equal(renderModal({ open: false }), "");
});

test("modal neden açıldığını söyler ve iki yolu birden sunar", () => {
  const html = renderModal();
  assert.match(html, /Teklifinizi görmek için/);
  assert.match(html, /Kayıt ol/);
  assert.match(html, /Giriş yap/);
  // Kaydolmanın bedeli görünür olmalı: ad, e-posta, telefon, şifre.
  for (const label of ["Ad soyad", "E-posta", "Telefon", "Şifre"]) {
    assert.ok(html.includes(label), `${label} alanı yok`);
  }
  // İzin ve aydınlatma bağlantıları (İYS + KVKK) formun içinde.
  assert.match(html, /href="\/ticari-ileti"/);
  assert.match(html, /href="\/privacy"/);
  // Ticari ileti onayı VARSAYILAN OLARAK KAPALI olmalı.
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
});

test("Google düğmesi kullanıcıyı teklifin kendisine geri getirir", () => {
  assert.match(
    renderModal(),
    /href="\/api\/auth\/google\?redirect=%2Fteklif%2FT-000001"/
  );
});

test("giriş sekmesiyle açılan modal kayıt alanlarını göstermez", () => {
  const html = renderModal({ initialTab: "login" });
  assert.match(html, /Teklifinizi görmek için giriş yapın/);
  assert.ok(!html.includes("Ad soyad"), "giriş sekmesinde ad alanı var");
  assert.match(html, /href="\/forgot-password"/);
});

test("modal fiyat göstermez — kapının arkasında rakam sızmaz", () => {
  assert.doesNotMatch(renderModal(), /₺\s?\d/);
});

test("robots teklif çalışma alanını kapatır, açılış sayfasına dokunmaz", () => {
  const rules = robots().rules;
  const list = Array.isArray(rules) ? rules : [rules];
  const all = list.find((r) => r.userAgent === "*");
  assert.ok(all, "* kuralı yok");
  const disallow = Array.isArray(all.disallow) ? all.disallow : [all.disallow ?? ""];
  assert.ok(disallow.includes("/teklif/"), "/teklif/ engellenmemiş");
  for (const path of disallow) {
    assert.ok(!"/3d-baski".startsWith(path), `açılış sayfası ${path} ile engellenmiş`);
  }
});
