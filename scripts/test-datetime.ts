/**
 * Saat dilimi regresyon testi.
 *
 * Sunucu ve worker konteynerleri UTC'de koşuyor. Saat dilimi belirtilmeyen her
 * sunucu-taraflı tarih biçimlendiricisi müşteriye 3 saat GERİDE bir saat yazar:
 * ödeme son tarihi, teslim tarihi, atölye seans saati. Bu, canlıda gerçekleşti.
 *
 * İki kapı: (1) paylaşılan biçimlendiriciler bilinen bir anı İstanbul saatiyle
 * yazıyor mu, (2) sunucu tarafında saat dilimi BELİRTMEYEN yeni bir tarih
 * biçimlendiricisi eklenmiş mi.
 */
import fs from "node:fs";
import path from "node:path";
import { APP_TIME_ZONE } from "../src/lib/config/timezone";
import { formatDate, formatDateLong, formatDateTime } from "../src/lib/i18n/format";

let passed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (!cond) {
    console.error(`  ✗ ${name}`, extra ?? "");
    process.exitCode = 1;
    return;
  }
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("\n1) Sabit");
ok("APP_TIME_ZONE Europe/Istanbul", APP_TIME_ZONE === "Europe/Istanbul", APP_TIME_ZONE);

console.log("\n2) Paylaşılan biçimlendiriciler İstanbul saatinde yazar");
// 2026-09-20T23:30:00Z → İstanbul'da 21 Eylül 02:30. Hem SAAT hem GÜN kayar:
// saat dilimi düşerse tarih de yanlış gider, sadece saat değil.
const instant = new Date("2026-09-20T23:30:00Z");
const dt = formatDateTime(instant, "tr");
ok("formatDateTime günü İstanbul'a göre 21'e taşır", dt.includes("21"), dt);
ok("formatDateTime saati 02:30 yazar", dt.includes("02:30"), dt);
ok("formatDateTime UTC saatini (23:30) YAZMAZ", !dt.includes("23:30"), dt);

const d1 = formatDate(instant, "tr");
ok("formatDate günü 21 yazar", d1.includes("21"), d1);
const d2 = formatDateLong(instant, "tr");
ok("formatDateLong günü 21 yazar", d2.includes("21"), d2);

console.log("\n3) Saat dilimi belirtmeyen sunucu-taraflı biçimlendirici kalmadı");

const DATE_CALL = /\.(toLocaleDateString|toLocaleTimeString|toLocaleString)\s*\(/g;
const DATE_OPT = /\b(day|month|year|weekday|hour|minute|second|dateStyle|timeStyle)\s*:/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, out);
    } else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const file of [...walk("src"), ...walk("workers")]) {
  const src = fs.readFileSync(file, "utf8");
  // Client bileşenleri kullanıcının TARAYICISINDA çalışır; oradaki yerel saat
  // zaten doğrudur ve saat dilimi sabitlemek gereksizdir.
  if (/^\s*["']use client["']/m.test(src.slice(0, 200))) continue;

  for (const m of src.matchAll(DATE_CALL)) {
    const start = m.index ?? 0;
    // Çağrının argüman listesini kabaca çıkar: parantez dengesi.
    let depth = 0;
    let end = start;
    for (let i = src.indexOf("(", start); i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
      if (i - start > 800) { end = i; break; }
    }
    const call = src.slice(start, end + 1);
    const isDate =
      m[1] !== "toLocaleString" || DATE_OPT.test(call);
    if (!isDate) continue; // sayı/para biçimlendirmesi
    if (call.includes("timeZone")) continue;
    const line = src.slice(0, start).split("\n").length;
    offenders.push(`${file}:${line}`);
  }
}

ok(
  "saat dilimsiz sunucu-taraflı tarih biçimlendiricisi yok",
  offenders.length === 0,
  offenders
);

console.log(`\n${passed} passed${process.exitCode ? " (HATA VAR)" : ""}`);
