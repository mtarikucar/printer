/**
 * KOLİ KAPISI — yazma uçlarının yarısı (Faz 4).
 *
 * NEDEN AYRI BİR TEST. "Basılmış parça yoldayken iş sessizce başka bir boyacıya
 * yazılmaz" kuralı BEŞ yerde yaşıyor: saf ölçü (src/lib/config/flags.ts ·
 * painterParcelOnTheWay), otomatik yerleştirici, 24 saatlik süpürme ve ÜÇ YAZMA
 * UCU (admin ata / admin değiştir / üretici devret). scripts/ bugüne kadar yalnız
 * OTOMATİK yarıyı pinliyordu (test-painter-auto-assign.ts): uçlardaki
 * `trackingNumber || null` silmesi geri gelse hiçbir test kırmızı yanmazdı.
 * Ölçülen canlı kusur da buydu — takip numarası verilmeyen bir devir, kolinin
 * nerede olduğunu söyleyen TEK kaydı siliyor, sipariş otomatik yolların gözünde
 * "kolisi yola çıkmamış" hâle geliyor ve sıradaki ret ya da sessizlik işi bir
 * sonraki boyacıya yazarken baskı ilk boyacıda kalıyordu.
 *
 * Bu dosya üç şeyi kilitler:
 *   1. ÖLÇÜ: gerçek fonksiyonun davranışı (kargo firması kanıt değildir).
 *   2. ÜÇ UÇ: kapı duruyor, reddi Türkçe ve `code: "parcel_in_transit"`, ve
 *      kargo alanları YALNIZ yeni sevkiyat bildirildiğinde yazılıyor.
 *   3. ÇIKIŞ YOLU + KAYIT: panel kapıya UYABİLİYOR (devir kutusunda kargo +
 *      takip alanları var ve gönderiliyor), ve iki koparma yolu da kutunun
 *      kaydını silmeden önce GERÇEĞİ kalıcı nota taşıyıp admin'i uyarıyor.
 *
 * Koparma ENGELLENMEZ: iki partneri birden koparmak meşru bir işlemdir. Test,
 * dört alanın hâlâ temizlendiğini de pinler — "düzeltme" diye koparmanın
 * kapatılması da bir kusur olurdu.
 *
 * DB YOK, Redis YOK: saf yarı çalıştırılır, geri kalanı kaynak denetimidir.
 *
 * Çalıştır: npx tsx scripts/test-parcel-guard.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { painterParcelOnTheWay } from "../src/lib/config/flags";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const ASSIGN = "src/app/api/admin/orders/[id]/assign-painter/route.ts";
const SWAP = "src/app/api/admin/orders/[id]/swap-painter/route.ts";
const SEND = "src/app/api/manufacturer/orders/[id]/send-to-painter/route.ts";
const CLIENT = "src/app/admin/orders/[id]/client.tsx";
const REVOKE_ROUTE = "src/app/api/admin/orders/[id]/revoke-painter/route.ts";
const REVOKE_SERVICE = "src/lib/services/revoke-after-painter.ts";
const WRITE_ROUTES = [ASSIGN, SWAP, SEND];

let pass = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log("  ok  ", name);
  } else {
    failures.push(name + (detail ? ` — ${String(detail)}` : ""));
    console.error("  FAIL", name, detail ?? "");
  }
}

/**
 * Yorumları at: yargı KODA bakmalı, kodun anlatısına değil. Bu uçlardaki
 * açıklamalar "trackingNumber || null" gibi dizeleri ANLATTIĞI için, yorumları
 * saymayan bir tarama kendi anlatısını kod sanardı.
 * (scripts/test-painter-capacity.ts ve test-painter-auto-assign.ts'teki
 * kanıtlanmış yardımcının aynısı.)
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** İki kilometre taşı arasını kes; bulunamazsa testi düşür. */
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) return "";
  const b = src.indexOf(to, a + from.length);
  return b > a ? src.slice(a, b) : "";
}

const code: Record<string, string> = {};
for (const rel of [...WRITE_ROUTES, CLIENT, REVOKE_ROUTE, REVOKE_SERVICE]) {
  code[rel] = stripComments(read(rel));
}

// ── 1. ÖLÇÜNÜN KENDİSİ ─────────────────────────────────────────────────────
// Kural tek cümledir: takip numarası ya da boyacının teslim damgası kanıttır,
// kargo FİRMASI değildir (firma, paket çıkmadan da panelden seçilebilir).
console.log("\n1) koli ölçüsü — gerçek fonksiyon");
ok(
  "takip numarası varsa koli yolda",
  painterParcelOnTheWay({ painterHandoffTrackingNumber: "ABC123", receivedByPainterAt: null })
);
ok(
  "boyacının teslim damgası varsa koli yolda",
  painterParcelOnTheWay({ painterHandoffTrackingNumber: null, receivedByPainterAt: new Date() })
);
ok(
  "ikisi de yoksa koli yolda DEĞİL",
  !painterParcelOnTheWay({ painterHandoffTrackingNumber: null, receivedByPainterAt: null })
);
ok(
  "yalnız boşluktan ibaret takip numarası kanıt sayılmaz",
  !painterParcelOnTheWay({ painterHandoffTrackingNumber: "   ", receivedByPainterAt: null })
);

// ── 2. ÜÇ YAZMA UCU: KAPI DURUYOR ──────────────────────────────────────────
console.log("\n2) üç yazma ucu — kapı ve reddin dili");
for (const rel of WRITE_ROUTES) {
  const c = code[rel];
  ok(`${rel}: ORTAK ölçüyü çağırıyor (kendi kuralını kurmuyor)`, /painterParcelOnTheWay\(order\)/.test(c));
  ok(
    `${rel}: ölçüyü flags.ts'ten alıyor`,
    /import \{[^}]*painterParcelOnTheWay[^}]*\} from "@\/lib\/config\/flags"/.test(c)
  );
  ok(
    `${rel}: numarasız devir reddi (parcelOnTheWay && !newTracking)`,
    /parcelOnTheWay && !newTracking/.test(c) && /code: "parcel_in_transit"/.test(c)
  );
  ok(`${rel}: ret 409 ile döner`, /code: "parcel_in_transit"[\s\S]{0,120}status: 409/.test(c));
  ok(
    `${rel}: ret Türkçe ve NE İSTENDİĞİNİ söylüyor (takip numarası)`,
    /parcel_in_transit/.test(c) && /takip/i.test(slice(c, "parcelOnTheWay && !newTracking", "}\n\n"))
  );
  ok(
    `${rel}: kanıt YALNIZ takip numarası (kargo firması kapıyı açmıyor)`,
    /const newTracking = parsed\.data\.trackingNumber\?\.trim\(\) \|\| null;/.test(c)
  );
}

// ── 3. SİLME GERİ GELEMEZ ──────────────────────────────────────────────────
// Eski davranış: her devir `painterHandoffTrackingNumber: trackingNumber || null`
// yazıyordu, yani numara girilmeyen devir kaydı SİLİYORDU. Alanlar artık yalnız
// yeni sevkiyat bildirildiğinde yazılır.
console.log("\n3) hayatta kalan kargo kaydının üstüne null yazılmıyor");
for (const rel of WRITE_ROUTES) {
  const c = code[rel];
  ok(
    `${rel}: 'trackingNumber || null' silmesi yok`,
    !/painterHandoffTrackingNumber:\s*[^,\n]*\|\|\s*null/.test(c),
    c.match(/.*painterHandoffTrackingNumber:.*\|\|.*/)?.[0]
  );
  ok(
    `${rel}: kargo alanları YALNIZ yeni sevkiyat dalında yazılıyor`,
    /\.\.\.\(newTracking[\s\S]{0,200}painterHandoffTrackingNumber: newTracking/.test(c)
  );
  // Sütun seçimi (`: true`) ve yeni sevkiyat dışında bu alana yazan BAŞKA bir
  // satır kalmamalı; kalırsa silme başka bir kılıkta geri gelmiş demektir.
  const writes = (c.match(/painterHandoffTrackingNumber:\s*[^,\n]+/g) ?? []).filter(
    (m) => !/:\s*(true|newTracking|orders\.painterHandoffTrackingNumber)\b/.test(m)
  );
  ok(`${rel}: bu alana yazan başka satır yok`, writes.length === 0, writes.join(" | "));
  ok(
    `${rel}: eski sevkiyat nota geçiyor (kayıt kaybolmuyor)`,
    /order\.painterHandoffTrackingNumber \?\? "-"/.test(c)
  );
}

// ── 4. PANEL KAPIYA UYABİLİYOR ─────────────────────────────────────────────
// ASIL KUSUR BUYDU: uçlar reddediyordu ama admin panelinde uyacak bir yol
// yoktu. Devir kutusunda kargo + takip alanı olmadığı için, kolisi yolda olan
// HER sipariş 409'a çarpıyor ve admin'e yalnız iki partneri birden koparan
// düğme kalıyordu.
console.log("\n4) devir kutusu: kapıya uymanın yolu panelde VAR");
{
  const c = code[CLIENT];
  ok(
    `${CLIENT}: ekran ölçüyü flags.ts'ten alıyor (kendi kuralını kurmuyor)`,
    /import \{ painterParcelOnTheWay \} from "@\/lib\/config\/flags"/.test(c) &&
      /painterParcelOnTheWay\(\{/.test(c)
  );
  ok(
    `${CLIENT}: devir kutusunun kargo + takip durumu var`,
    /const \[swapCarrier, setSwapCarrier\]/.test(c) && /const \[swapTracking, setSwapTracking\]/.test(c)
  );
  ok(
    `${CLIENT}: iki alan da ekranda ve duruma bağlı`,
    /value=\{swapCarrier\}/.test(c) && /value=\{swapTracking\}/.test(c)
  );
  const swapPayload = slice(c, "swap-painter`,", "(data) => {");
  ok(`${CLIENT}: devir yükü okunabildi`, swapPayload.length > 0);
  ok(
    `${CLIENT}: devir yükü carrier + trackingNumber GÖNDERİYOR`,
    /carrier: swapCarrier/.test(swapPayload) && /trackingNumber: swapTracking\.trim\(\)/.test(swapPayload),
    swapPayload.slice(0, 400)
  );
  // Düğmenin KENDİ gövdesi kesilir: "disabled={…}" ile kuralın arasındaki
  // mesafeye bakan bir tarama, araya bir yorum girdiğinde sessizce körelirdi.
  const swapButton = slice(c, "onClick={swapPainter}", "Boyacıyı değiştir");
  ok(
    `${CLIENT}: koli yoldayken numarasız devir ekranda da kapalı`,
    /const swapNeedsTracking = painterParcelOut && !swapTracking\.trim\(\);/.test(c) &&
      swapButton.length > 0 &&
      /swapNeedsTracking/.test(swapButton),
    swapButton.slice(0, 300)
  );
  ok(
    `${CLIENT}: neden zorunlu olduğu adminin durduğu yerde yazıyor`,
    /takip numarası zorunludur/.test(read(CLIENT))
  );
  // Atama kutusu bu iki alanı ZATEN gönderiyordu; devir kutusu onun ikizidir.
  const assignPayload = slice(c, "assign-painter`, {", "const data = await res.json()");
  ok(
    `${CLIENT}: atama kutusu da iki alanı göndermeye devam ediyor`,
    /carrier: painterCarrier/.test(assignPayload) &&
      /trackingNumber: painterTracking\.trim\(\)/.test(assignPayload)
  );
}

// ── 5. KOPARMA: KAYIT SAĞ ÇIKAR, ADMİN UYARILIR ────────────────────────────
// Koparma iki partneri de çıkarır ve devir izlerini temizler — bu DOĞRU. Yanlış
// olan, kutunun nerede olduğunu söyleyen tek kaydın sessizce silinmesiydi.
console.log("\n5) geri alma yolları: koparma serbest, kayıt korunur");
{
  const svc = code[REVOKE_SERVICE];
  const rt = code[REVOKE_ROUTE];
  ok(
    `${REVOKE_SERVICE}: ortak iz yardımcısı dışa açık`,
    /export function painterParcelRevokeTrace\(/.test(svc)
  );
  ok(
    `${REVOKE_SERVICE}: yardımcı ORTAK ölçüyü kullanıyor`,
    /painterParcelRevokeTrace\([\s\S]{0,400}painterParcelOnTheWay\(o\)/.test(svc)
  );
  ok(
    `${REVOKE_SERVICE}: koli yoksa uyarı da yok (gürültü yapmıyor)`,
    /if \(!painterParcelOnTheWay\(o\)\) return \{ noteClause: "", warningTr: null \};/.test(svc)
  );
  for (const [rel, c] of [
    [REVOKE_SERVICE, svc],
    [REVOKE_ROUTE, rt],
  ] as const) {
    ok(`${rel}: koparmadan önce izi alıyor`, /painterParcelRevokeTrace\(order\)/.test(c));
    ok(`${rel}: kalıcı admin notu koli kaydını taşıyor`, /\$\{parcel\.noteClause\}/.test(c));
    ok(`${rel}: sonuç Türkçe uyarıyı taşıyor`, /parcelWarningTr: parcel\.warningTr/.test(c));
    // KOPARMA ENGELLENMİYOR: dört alan hâlâ temizleniyor. "Düzeltme" diye
    // koparmanın kapatılması, admin'i yine çıkışsız bırakırdı.
    ok(
      `${rel}: tam koparma duruyor (dört alan da temizleniyor)`,
      /receivedByPainterAt: null/.test(c) &&
        /paintedAt: null/.test(c) &&
        /painterHandoffCarrier: null/.test(c) &&
        /painterHandoffTrackingNumber: null/.test(c)
    );
  }
  ok(
    `${REVOKE_ROUTE}: iade dalı kargo alanlarını SİLMEDEN ÖNCE okuyor`,
    /painterHandoffCarrier: orders\.painterHandoffCarrier/.test(rt) &&
      /painterHandoffTrackingNumber: orders\.painterHandoffTrackingNumber/.test(rt) &&
      /receivedByPainterAt: orders\.receivedByPainterAt/.test(rt)
  );
  ok(
    `${REVOKE_ROUTE}: uyarı 200'ün gövdesinde admin'e çıkıyor`,
    /result\.parcelWarningTr \? \{ warning: result\.parcelWarningTr \}/.test(rt)
  );
  ok(
    `${REVOKE_SERVICE}: uyarı Türkçe ve kutunun dışarıda olduğunu söylüyor`,
    /BASKI HÂLÂ DIŞARIDA/.test(read(REVOKE_SERVICE))
  );
  const c = code[CLIENT];
  const revokeHandler = slice(c, "revoke-painter`, {", "router.refresh();");
  ok(
    `${CLIENT}: ucun uyarısı yere düşmüyor (uyarı kutusuna basılıyor)`,
    /setActionWarning\(responseWarning\(data\)\)/.test(revokeHandler)
  );
  ok(
    `${CLIENT}: geri alma kartı, tıklamadan ÖNCE de uyarıyor`,
    /\{painterParcelOut && \(/.test(c)
  );
}

console.log(`\n${pass} geçti, ${failures.length} düştü`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
