"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * TCMB kur kartı: son çekilen kurlar, bülten tarihi, BAYAT uyarısı ve
 * "Şimdi çek".
 *
 * Neden istemci tarafında okuyor: kur bir ayar değil bir DURUMDUR ("kur güncel
 * mi"), ve operatör "Şimdi çek"e bastıktan sonra sonucu AYNI kartta görmeli.
 * Sunucu bileşeninde okunsaydı, kur okuması patladığı gün bayrak ekranını da
 * (aynı sayfa) götürürdü; burada arıza kartın içinde kalır.
 *
 * Metinler hardcode Türkçe (ev emsali: admin ekranları sözlük anahtarı
 * açmıyor).
 */

/**
 * Tel üzerindeki biçim — `FxAdminOverview`ın JSON hâli.
 *
 * `fetchedAt` sunucuda `Date`, telde DİZGİDİR; tipi burada yeniden yazmak o
 * farkı görünür kılar (aksi hâlde `new Date(...)` gerektiği yerde bir dizgi
 * üstünde `.getTime()` çağrılırdı).
 */
interface FxOverviewWire {
  bulletin: {
    bulletinDate: string;
    rates: Array<{ currency: string; microTryPerUnit: number; bulletinUnit: number }>;
    fetchedAt: string;
  } | null;
  stale: boolean;
  maxAgeBusinessDays: number;
  staleAfter: string | null;
}

/** 1 birim döviz = kaç ₺ (mikro-TRY tamsayısı dörde yuvarlanarak okunur). */
const RATE_FORMAT = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const DAY_FORMAT = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Istanbul",
});

const STAMP_FORMAT = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});

/**
 * `YYYY-AA-GG` → okunabilir gün. Gün anahtarı beklenmedik bir şey olursa
 * OLDUĞU GİBİ yazılır: `Intl` geçersiz bir tarihte `RangeError` atar ve o hata
 * bir bilgi satırı uğruna bütün kartı götürürdü.
 */
function formatDay(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  return DAY_FORMAT.format(new Date(`${key}T12:00:00.000Z`));
}

/** Aynı gerekçe: telden gelen damga okunamıyorsa kart çökmez, ham değeri yazar. */
function formatStamp(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : STAMP_FORMAT.format(at);
}

export function FxClient() {
  const [overview, setOverview] = useState<FxOverviewWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const read = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/admin/fx-rates");
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Kurlar okunamadı (HTTP ${response.status}).`);
      return;
    }
    setOverview((await response.json()) as FxOverviewWire);
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/fx-rates", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        bulletinDate?: string;
        insertedRows?: number;
      };
      if (!response.ok) {
        setError(body.error ?? `Çekme tamamlanamadı (HTTP ${response.status}).`);
        return;
      }
      setNote(
        body.insertedRows === 0
          ? `${formatDay(body.bulletinDate ?? "")} bülteni zaten kayıtlıydı; yeni satır yazılmadı.`
          : `${formatDay(body.bulletinDate ?? "")} bülteni alındı (${body.insertedRows} satır).`
      );
      await read();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 max-w-3xl rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">TCMB döviz kuru (gösterim)</h2>
      <p className="mt-1 text-xs text-gray-500">
        Teklif yüzeyinde ₺ tutarının yanında gösterilen <strong>yaklaşık</strong> döviz
        karşılıkları bu kurdan hesaplanır. Bağlayıcı her tutar ve tahsil edilen her kuruş
        Türk lirasıdır. Kaynak: TCMB günlük bülteni, <strong>döviz alış</strong> kuru.
        Tur kendiliğinden altı saatte bir koşar.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {note && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {note}
        </div>
      )}

      {overview === null ? (
        !error && <p className="mt-4 text-sm text-gray-400">Kurlar okunuyor…</p>
      ) : overview.bulletin === null ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Kayıtlı kur yok.</strong> Döviz gösterimi kapalı davranır: müşteri yalnız ₺
          görür. Aşağıdaki düğmeyle ilk bülteni çekebilirsiniz.
        </div>
      ) : (
        <>
          {overview.stale && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Kur bayat.</strong> En yeni bülten {formatDay(overview.bulletin.bulletinDate)}{" "}
              tarihli ve {overview.maxAgeBusinessDays} iş gününü aştı
              {overview.staleAfter && ` (son geçerli gün: ${formatDay(overview.staleAfter)})`}.
              Döviz gösterimi kapalı davranır: müşteri yalnız ₺ görür, hiçbir fiyat yanlış
              olmaz.
            </div>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-500">TCMB bülten tarihi</dt>
              <dd className="font-medium text-gray-900">
                {formatDay(overview.bulletin.bulletinDate)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Son çekme</dt>
              <dd className="font-medium text-gray-900">
                {formatStamp(overview.bulletin.fetchedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Bayatlık eşiği</dt>
              <dd className="font-medium text-gray-900">
                {overview.maxAgeBusinessDays} iş günü
              </dd>
            </div>
          </dl>

          <table className="mt-4 w-full max-w-md text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1 font-medium">Para birimi</th>
                <th className="py-1 font-medium">1 birim = ₺</th>
                <th className="py-1 font-medium">Bülten birimi</th>
              </tr>
            </thead>
            <tbody>
              {overview.bulletin.rates.map((rate) => (
                <tr key={rate.currency} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-gray-900">{rate.currency}</td>
                  <td className="py-1.5 text-gray-700">
                    {RATE_FORMAT.format(rate.microTryPerUnit / 1_000_000)} ₺
                  </td>
                  <td className="py-1.5 text-gray-500">{rate.bulletinUnit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="mt-5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Çekiliyor…" : "Şimdi çek"}
      </button>
      <p className="mt-2 text-xs text-gray-400">
        Çekme turu kuyruğa girmez, bu istekte koşar: sonucu hemen burada görürsünüz. Tur
        başarısız olursa hiçbir satır yazılmaz ve son geçerli kur yerinde kalır.
      </p>
    </section>
  );
}
