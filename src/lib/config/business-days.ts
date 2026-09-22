/**
 * İş günü aritmetiği — İstanbul takvimiyle.
 *
 * Konteynerler UTC'de koşar. Saat dilimi verilmezse "bugün" gece yarısından
 * sonraki üç saat boyunca bir gün GERİ yazılır ve müşteriye yanlış teslim
 * tarihi gider (2026-06'da yaşandı, bkz. `config/timezone.ts`). Bu yüzden tüm
 * gün hesabı `YYYY-MM-DD` İstanbul gün anahtarları üzerinden yürür.
 *
 * SAF MODÜL: DB yok, `server-only` yok, `node:` import'u yok.
 */
import { APP_TIME_ZONE } from "@/lib/config/timezone";

const DATE_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const HOUR_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

/** Bir anın İstanbul takvim günü, `YYYY-MM-DD`. */
export function istanbulDateKey(d: Date): string {
  const parts = DATE_PARTS.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Bir anın İstanbul saati (0–23). */
function istanbulHour(d: Date): number {
  const value = HOUR_PARTS.formatToParts(d).find((p) => p.type === "hour")?.value ?? "0";
  return Number(value);
}

/** Gün anahtarını UTC öğlene sabitler — hangi ofsette okunursa okunsun aynı gün. */
function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

function nextKey(key: string): string {
  const d = keyToDate(key);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isWeekend(key: string): boolean {
  const day = keyToDate(key).getUTCDay();
  return day === 0 || day === 6;
}

/** Sonsuz döngü kalkanı: tatil listesi hatalı doldurulursa hesap durmalı. */
const MAX_STEPS = 4000;

/**
 * `start` anından itibaren `days` İŞ GÜNÜ sonrası (hafta sonu ve resmi tatiller
 * atlanır).
 *
 * Sayım "gün 0"dan başlar: `days = 0` ilk iş gününü verir. Başlangıç bir iş günü
 * değilse (hafta sonu/tatil) ya da `cutoffHour`'dan sonraysa, gün 0 bir sonraki
 * iş günüdür — akşam 18:00'de verilen sipariş o gün tezgâha girmez.
 *
 * Dönen `Date` bir GÜNÜ temsil eder (günün ortasına sabitlenmiştir); saatine
 * değil, `istanbulDateKey` ile gününe bakılmalıdır.
 */
export function addBusinessDays(
  start: Date,
  days: number,
  holidays: string[],
  cutoffHour: number
): Date {
  const holiday = new Set(holidays);
  const isBusinessDay = (key: string) => !isWeekend(key) && !holiday.has(key);

  let key = istanbulDateKey(start);
  if (istanbulHour(start) >= cutoffHour) key = nextKey(key);

  let steps = 0;
  while (!isBusinessDay(key) && steps++ < MAX_STEPS) key = nextKey(key);

  const remaining = Math.max(0, Math.floor(days));
  for (let i = 0; i < remaining; i++) {
    key = nextKey(key);
    while (!isBusinessDay(key) && steps++ < MAX_STEPS) key = nextKey(key);
  }

  return keyToDate(key);
}
