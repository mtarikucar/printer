"use client";

import { useState } from "react";
// YALNIZ TİP: servis modülü `ioredis`e ve `PAGE_UPDATED_AT`e dokunuyor;
// `import type` derlemede SİLİNDİĞİ için istemci paketine hiçbiri girmez.
import type {
  AnnounceOutcome,
  AnnounceScope,
  IndexNowPageStatus,
} from "@/lib/services/indexnow-pages";

/**
 * IndexNow kartı — statik sayfaların Bing'e haber verilme durumu + elle tetik.
 *
 * NİÇİN BU EKRANDA BİR UYARI VAR. `indexnow.ts` anahtar yokken sessizce
 * `{ok:false, reason:"no_key"}` dönüyor; fonksiyonun sözleşmesi bu ve
 * DEĞİŞTİRİLMEDİ (gönderim bir isteği düşürmemeli). Ama o sessizlik bir
 * operatör ekranında yanılgıya dönüşür: düğmeye basan kişi iş yaptığını sanır.
 * Yüzey bu yüzden `INDEXNOW_KEY`in yokluğunu AÇIKÇA yazıyor.
 *
 * DURUM SUNUCUDAN PROP OLARAK GELİYOR (mount'ta `fetch` ile okunmuyor):
 * uyarının ilk HTML'de bulunması gerekiyor, yoksa ekran bir an "yükleniyor"
 * der ve uyarı hiç görünmeden karar verilebilir. İkinci fayda: kart
 * `renderToStaticMarkup` ile sınanabiliyor (`scripts/test-indexnow.ts`).
 *
 * Metinler hardcode Türkçe (ev emsali: admin ekranları sözlük anahtarı açmıyor).
 */

export interface IndexNowCardProps {
  status: IndexNowPageStatus;
}

/** Tel üzerindeki biçim — `POST /api/admin/indexnow` cevabı. */
interface SubmitWire {
  outcome?: AnnounceOutcome;
  status?: IndexNowPageStatus;
  error?: string;
}

const REFUSAL_LABELS_TR: Record<string, string> = {
  no_key: "INDEXNOW_KEY tanımlı değil — gönderim yapılmadı.",
  no_store: "Hafıza (Redis) okunamadı — otomatik tur neyin değiştiğini bilemez.",
  no_urls: "Gönderilecek URL kalmadı (host süzgeci hepsini eledi).",
  http_error: "IndexNow isteği reddedildi. Hiçbir sayfa duyurulmuş sayılmadı.",
  network_error: "IndexNow'a ulaşılamadı. Hiçbir sayfa duyurulmuş sayılmadı.",
};

function outcomeMessage(outcome: AnnounceOutcome): { tone: "ok" | "warn"; text: string } {
  if (!outcome.ok) {
    return {
      tone: "warn",
      text: REFUSAL_LABELS_TR[outcome.reason] ?? `Gönderim yapılmadı (${outcome.reason}).`,
    };
  }
  if (outcome.kind === "baseline") {
    return {
      tone: "warn",
      text:
        "Hafıza boştu: bugünkü tarihler temel olarak yazıldı, hiçbir sayfa " +
        "gönderilmedi. İlk kayıt için aşağıdaki “Tümünü gönder” düğmesini kullanın.",
    };
  }
  if (outcome.kind === "no_change") {
    return { tone: "ok", text: "Değişen sayfa yok; gönderim yapılmadı." };
  }
  return {
    tone: "ok",
    text: `${outcome.submitted} sayfa gönderildi: ${outcome.paths
      .map((p) => p || "/")
      .join(", ")}`,
  };
}

export function IndexNowCard({ status: initial }: IndexNowCardProps) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<AnnounceScope | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (scope: AnnounceScope) => {
    setBusy(scope);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const body = (await response.json().catch(() => ({}))) as SubmitWire;
      if (!response.ok) {
        setError(body.error ?? `Gönderim tamamlanamadı (HTTP ${response.status}).`);
        return;
      }
      if (body.status) setStatus(body.status);
      if (body.outcome) setNote(outcomeMessage(body.outcome));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-6 max-w-3xl rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">
        IndexNow — arama motoruna haber verme
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Bing, Yandex ve Naver bir URL&apos;nin <strong>değiştiğini</strong> buradan
        öğrenir; Google katılmıyor (onun için sitemap var). ChatGPT&apos;nin kaynak
        araması Bing indeksinde çalıştığı için bu yol, sayfalarımızın bir AI cevabında
        alıntılanabilmesinin ön koşulu. Tur kendiliğinden saatte bir koşar ve{" "}
        <strong>yalnız “son güncelleme” tarihi değişen</strong> sayfaları gönderir.
      </p>

      {!status.keyConfigured && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>INDEXNOW_KEY tanımlı değil, gönderim yapılmıyor.</strong> Anahtar
          olmadan her gönderim sessizce başarısız olur. Bing Webmaster Tools&apos;tan
          bir anahtar alın, ortam değişkenine yazın ve aynı değeri{" "}
          <code className="font-mono text-xs">{status.keyLocation}</code> adresinde
          yayınlayın.
        </div>
      )}

      {!status.storeAvailable && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Hafıza okunamadı.</strong> Otomatik tur neyin değiştiğini
          bilemediği için gönderim yapmaz; aşağıdaki düğmeler çalışmaya devam eder.
        </div>
      )}

      {status.baseline && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Henüz hiçbir sayfa duyurulmadı.</strong> Otomatik turun ilk koşusu
          yalnız bugünkü tarihleri temel olarak yazar (bilinmeyen bir geçmişte her
          şeyi göndermek gürültü olurdu). İlk kaydı{" "}
          <strong>“Tümünü gönder”</strong> ile yapın.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {note && (
        <div
          className={
            note.tone === "ok"
              ? "mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              : "mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          }
        >
          {note.text}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-gray-500">Kayıtlı sayfa</dt>
          <dd className="font-medium text-gray-900">{status.rows.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Duyurulmayı bekleyen</dt>
          <dd className="font-medium text-gray-900">{status.pendingCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Anahtar</dt>
          <dd className="font-medium text-gray-900">
            {status.keyConfigured ? "tanımlı" : "YOK"}
          </dd>
        </div>
      </dl>

      {status.rows.length > 0 && (
        <div className="mt-4 max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1 font-medium">Sayfa</th>
                <th className="py-1 font-medium">Son güncelleme</th>
                <th className="py-1 font-medium">Duyurulan</th>
              </tr>
            </thead>
            <tbody>
              {status.rows.map((row) => (
                <tr key={row.path} className="border-t border-gray-100">
                  <td className="py-1.5 font-mono text-xs text-gray-900">
                    {row.path || "/"}
                  </td>
                  <td className="py-1.5 text-gray-700">{row.updatedAt}</td>
                  <td
                    className={
                      row.pending ? "py-1.5 font-medium text-amber-700" : "py-1.5 text-gray-500"
                    }
                  >
                    {row.announcedFor ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => submit("changed")}
          disabled={busy !== null || !status.keyConfigured}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "changed" ? "Gönderiliyor…" : "Değişenleri gönder"}
        </button>
        <button
          type="button"
          onClick={() => submit("all")}
          disabled={busy !== null || !status.keyConfigured}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
        >
          {busy === "all" ? "Gönderiliyor…" : "Tümünü gönder"}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        “Tümünü gönder” kayıttaki bütün sayfaları duyurur; ilk kayıt anında ve bir
        içerik turundan sonra doğru olan budur. Her dağıtımda tümünü göndermek ise
        gürültüdür, o yüzden otomatik tur yalnız değişenleri gönderir.
      </p>
    </section>
  );
}
