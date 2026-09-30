"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModelViewer } from "@/components/model-viewer";
import { OrderChat } from "@/components/order-chat";
import { dfmMessage } from "@/components/quote/dfm-list";
import { decimal2, mm } from "@/components/quote/format";
import type { QuoteStatus } from "@/lib/config/quote-types";
import { formatCurrency, formatDateTime } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { AdminQuoteDetail, AdminQuotePartView } from "@/lib/services/quote-admin";
import type { FrameworkEntryGate } from "@/lib/services/quote-framework";
import {
  daysOrNaN,
  fromKurus,
  rowsOf,
  successNotice,
  toKurus,
  type AdminQuoteActionKey,
} from "./price-values";

/**
 * Tek teklifin karar ekranı.
 *
 * Üç şeyi aynı sayfada tutar, çünkü karar üçünü birden görmeden verilemez:
 * parçanın NE olduğu (küçük resim, 3D, ölçü, DfM, konfigürasyon), motorun ne
 * dediği (hesaplanan fiyat) ve admin'in ne dediği (manuel fiyat / hedef fiyat).
 *
 * Tutarlar ekranda ₺, telde KURUŞ: dönüşüm tek yerde (`toKurus`) ve yalnız
 * gönderim anında yapılır — her tuş vuruşunda çevirmek "7,50" yazılmasını
 * imkânsız kılardı (katalog ekranında birebir aynı hata düzeltildi).
 */

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Taslak",
  needs_review: "İncelemede",
  quoted: "Fiyatlandı",
  ordered: "Siparişe dönüştü",
  expired: "Süresi doldu",
  cancelled: "İptal",
};

const REVIEW_KIND_LABELS: Record<string, string> = {
  manual: "Manuel fiyat talebi",
  rfq: "RFQ (özel talep)",
  target_price: "Hedef fiyat önerisi",
};

const ACTION_LABELS: Record<string, string> = {
  manual_price: "Manuel fiyat",
  target_accept: "Hedef fiyat kabul",
  target_counter: "Karşı teklif",
  target_reject: "Hedef fiyat reddi",
  review_reject: "İnceleme kapatıldı",
  extend_expiry: "Süre uzatıldı",
  reopen: "Yeniden açıldı",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right text-gray-900">{children}</span>
    </div>
  );
}

function Card({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <section
      className={`rounded-2xl border p-5 ${
        tone === "warning" ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
      }`}
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function QuoteDetailClient({
  quote,
  frameworkEntry = null,
  frameworkEntryUnreadable = false,
}: {
  quote: AdminQuoteDetail;
  /**
   * Çerçeve giriş kapısı — `null` = bayrak KAPALI (ya da kapı okunamadı) ve
   * ekranda çerçeveye dair tek kelime geçmez.
   */
  frameworkEntry?: FrameworkEntryGate | null;
  frameworkEntryUnreadable?: boolean;
}) {
  const d = useDictionary();
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(false);

  // Manuel fiyat taslağı HAM METİN taşır (bkz. dosya başlığı).
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(quote.parts.map((p) => [p.id, fromKurus(p.manualUnitPriceKurus)]))
  );
  const [counters, setCounters] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      quote.parts.map((p) => [p.id, fromKurus(p.targetUnitPriceKurus ?? p.computedUnitKurus)])
    )
  );
  const [days, setDays] = useState(String(quote.quoteValidDays));
  const [reason, setReason] = useState("");
  const [extendDays, setExtendDays] = useState("15");
  const [extendReason, setExtendReason] = useState("");

  const locked = quote.liveDraftReference !== null;
  const isTargetReview = quote.status === "needs_review" && quote.reviewKind === "target_price";

  const totalManual = useMemo(
    () =>
      quote.parts.reduce((sum, part) => {
        const value = toKurus(prices[part.id] ?? "");
        return typeof value === "number" && value > 0 ? sum + value * part.config.quantity : sum;
      }, 0),
    [prices, quote.parts]
  );

  /**
   * Yedi düğmenin ortak isteği. Başarı cümlesi İŞLEMDEN gelir
   * (`successNotice`): cevabın `quoted` alanı yalnız fiyat değiştiren üç işlem
   * için anlamlıdır, diğer dörtte her zaman `false`tur.
   */
  const call = async (key: AdminQuoteActionKey, path: string, body: unknown) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/quotes/${quote.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        quoted?: boolean;
        blockers?: string[];
      };
      if (!response.ok) {
        setError(data.error ?? `İşlem tamamlanamadı (HTTP ${response.status}).`);
        return;
      }
      const success = successNotice(key, data, { anonymous: quote.anonymous });
      setBlockers(success.showBlockers ? (data.blockers ?? []) : []);
      setNotice(success.text);
      setReason("");
      setExtendReason("");
      router.refresh();
    } catch {
      setError("Sunucuya ulaşılamadı; işlemin geçip geçmediğini görmek için sayfayı yenileyin.");
    } finally {
      setBusy(null);
    }
  };

  /** Taslak → satırlar; okunamayan bir alan varsa İSTEK GÖNDERİLMEZ. */
  const draftRows = (draft: Record<string, string>, only: "all" | "filled") =>
    rowsOf(quote.parts, draft, only);

  return (
    <div className="p-4 sm:p-8">
      <Link href="/admin/teklifler" className="text-sm text-green-700 hover:underline">
        ← Teklif kuyruğu
      </Link>

      <header className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{quote.number}</h1>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
          {STATUS_LABELS[quote.status]}
        </span>
        {quote.reviewKind && (
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              quote.staleReviewKind ? "bg-gray-100 text-gray-500" : "bg-amber-100 text-amber-800"
            }`}
          >
            {REVIEW_KIND_LABELS[quote.reviewKind] ?? quote.reviewKind}
            {quote.staleReviewKind ? " (geçmiş talep)" : ""}
          </span>
        )}
        {quote.title && <span className="text-sm text-gray-500">{quote.title}</span>}
      </header>

      {locked && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <strong>Bu teklif için açık bir ödeme var.</strong> Müşteriye gönderilen{" "}
          <code>/pay/{quote.liveDraftReference}</code> bağlantısı ESKİ tutarı taşıyor, bu yüzden
          fiyat değiştirilemez. Süre uzatma çalışır.
        </div>
      )}

      {quote.anonymous && (
        <div className="mt-4 rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Bu teklif giriş yapmamış bir ziyaretçiye ait: <strong>e-posta bildirimi
          gönderilemez</strong>. Müşteri teklifi yalnız kendi tarayıcısından görebilir.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
          {blockers.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ─── Parçalar ───────────────────────────────────────────────── */}
          {quote.parts.map((part) => (
            <PartCard key={part.id} part={part} />
          ))}
          {quote.parts.length === 0 && (
            <Card title="Parçalar">
              <p className="text-sm text-gray-500">Bu teklifte parça yok.</p>
            </Card>
          )}

          {/* ─── Manuel fiyatlama ───────────────────────────────────────── */}
          <Card title="Manuel fiyatlama">
            <p className="text-sm text-gray-600">
              Girilen tutar <strong>KDV dahil nihai birim fiyattır</strong> ve yalnız teklifin
              şu anki teslim kademesi ({quote.leadTierName}) için geçerlidir: müşteri kademeyi,
              malzemeyi, adedi ya da ölçeği değiştirirse fiyat düşer ve teklif yeniden
              incelemeye gelir. Alanı <strong>boş bırakmak</strong> manuel fiyatı kaldırır
              (parça otomatik fiyata döner).
            </p>
            <div className="mt-4 space-y-2">
              {quote.parts.map((part) => (
                <div key={part.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-48 shrink-0 truncate text-gray-700">
                    P{String(part.position).padStart(2, "0")} · {part.name}
                  </span>
                  <span className="text-xs text-gray-500">
                    hesaplanan:{" "}
                    {part.computedUnitKurus === null
                      ? (part.computedRefusal ?? "—")
                      : formatCurrency(part.computedUnitKurus, "tr")}
                  </span>
                  <input
                    inputMode="decimal"
                    value={prices[part.id] ?? ""}
                    onChange={(e) => setPrices({ ...prices, [part.id]: e.target.value })}
                    placeholder="₺ birim"
                    className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-right"
                  />
                  <span className="text-xs text-gray-500">× {part.config.quantity} adet</span>
                  {part.manualPriceStale && (
                    <span className="text-xs text-amber-700">
                      kayıtlı manuel fiyat artık geçersiz (konfigürasyon değişmiş)
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-xs text-gray-500">Geçerlilik (gün)</span>
                <input
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="mt-1 w-24 rounded-lg border border-gray-300 px-2 py-1"
                />
              </label>
              <span className="text-sm text-gray-600">
                Yukarıya ELLE yazılan satırların toplamı:{" "}
                <strong>{formatCurrency(totalManual, "tr")}</strong> — otomatik fiyatlı
                parçalar, ek hizmetler ve asgari tamamlama HARİÇ. Teklifin gerçek toplamı
                sağdaki kartta.
              </span>
            </div>
            <ReasonField value={reason} onChange={setReason} />
            <button
              type="button"
              disabled={busy !== null || locked || quote.parts.length === 0}
              onClick={() => {
                const rows = draftRows(prices, "all");
                if (typeof rows === "string") {
                  setNotice(null);
                  setError(rows);
                  return;
                }
                void call("price", "price", {
                  expectedUpdatedAt: quote.updatedAt,
                  parts: rows,
                  expiresInDays: daysOrNaN(days),
                  reason,
                });
              }}
              className="mt-3 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy === "price" ? "Kaydediliyor…" : "Fiyatı kaydet ve müşteriye bildir"}
            </button>
          </Card>

          {/* ─── Hedef fiyat kararı ─────────────────────────────────────── */}
          {isTargetReview && (
            <Card title="Hedef fiyat kararı">
              <p className="text-sm text-gray-600">
                Müşterinin önerdiği birim fiyatlar parçaların yanında duruyor.{" "}
                <strong>Kabul</strong> onları olduğu gibi manuel fiyat yapar;{" "}
                <strong>karşı teklif</strong> aşağıya yazdığınız tutarları yazar;{" "}
                <strong>ret</strong> teklifi taslağa döndürür ve gerekçeniz müşterinin teklif
                sayfasındaki nota işlenir.
              </p>
              <div className="mt-4 space-y-2">
                {quote.parts.map((part) => (
                  <div key={part.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="w-48 shrink-0 truncate text-gray-700">
                      P{String(part.position).padStart(2, "0")} · {part.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      müşteri hedefi:{" "}
                      {part.targetUnitPriceKurus === null
                        ? "—"
                        : formatCurrency(part.targetUnitPriceKurus, "tr")}
                    </span>
                    <input
                      inputMode="decimal"
                      value={counters[part.id] ?? ""}
                      onChange={(e) => setCounters({ ...counters, [part.id]: e.target.value })}
                      placeholder="₺ karşı teklif"
                      className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-right"
                    />
                  </div>
                ))}
              </div>
              <ReasonField value={reason} onChange={setReason} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null || locked}
                  onClick={() =>
                    call("target-accept", "target", {
                      decision: "accept",
                      reason,
                      expectedUpdatedAt: quote.updatedAt,
                    })
                  }
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Hedefi kabul et
                </button>
                <button
                  type="button"
                  disabled={busy !== null || locked}
                  onClick={() => {
                    const rows = draftRows(counters, "filled");
                    if (typeof rows === "string") {
                      setNotice(null);
                      setError(rows);
                      return;
                    }
                    void call("target-counter", "target", {
                      decision: "counter",
                      counters: rows,
                      reason,
                      expectedUpdatedAt: quote.updatedAt,
                    });
                  }}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Karşı teklif ver
                </button>
                <button
                  type="button"
                  disabled={busy !== null || locked}
                  onClick={() =>
                    call("target-reject", "target", {
                      decision: "reject",
                      reason,
                      expectedUpdatedAt: quote.updatedAt,
                    })
                  }
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-40"
                >
                  Hedefi reddet
                </button>
              </div>
            </Card>
          )}

          {/* ─── Denetim geçmişi ────────────────────────────────────────── */}
          <Card title="Denetim geçmişi">
            {quote.audit.length === 0 ? (
              <p className="text-sm text-gray-500">Bu teklifte henüz admin kararı yok.</p>
            ) : (
              <ul className="space-y-3">
                {quote.audit.map((entry) => (
                  <li key={entry.id} className="border-b border-gray-100 pb-2 last:border-0">
                    <div className="flex flex-wrap justify-between gap-2 text-sm">
                      <span className="font-medium text-gray-900">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                      <span className="text-xs text-gray-500">
                        {entry.adminEmail} · {formatDateTime(entry.createdAt, "tr")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{entry.reason}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-gray-400">
                        Önce / sonra
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-[11px] text-gray-600">
                        {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ─── Sağ sütun ─────────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Card title="Teklif">
            <Row label="Durum">{STATUS_LABELS[quote.status]}</Row>
            <Row label="Sürüm">{quote.version}</Row>
            <Row label="Teslim kademesi">{quote.leadTierName}</Row>
            <Row label="İş günü">{quote.leadDays ?? "—"}</Row>
            <Row label="Parça tutarı">{formatCurrency(quote.partsKurus, "tr")}</Row>
            {quote.addonsKurus > 0 && (
              <Row label="Ek hizmetler">{formatCurrency(quote.addonsKurus, "tr")}</Row>
            )}
            {quote.minOrderTopUpKurus > 0 && (
              <Row label="Asgari tamamlama">
                {formatCurrency(quote.minOrderTopUpKurus, "tr")}
              </Row>
            )}
            <Row label="Toplam (KDV dahil)">
              {quote.totalKurus === null ? (
                <span className="text-amber-700">fiyatlanamadı</span>
              ) : (
                <strong>{formatCurrency(quote.totalKurus, "tr")}</strong>
              )}
            </Row>
            {quote.kdvKurus !== null && (
              <Row label="KDV">{formatCurrency(quote.kdvKurus, "tr")}</Row>
            )}
            <Row label="Oluşturuldu">{formatDateTime(quote.createdAt, "tr")}</Row>
            <Row label="Geçerlilik">
              <span className={quote.expired ? "text-red-600" : undefined}>
                {formatDateTime(quote.expiresAt, "tr")}
              </span>
            </Row>
            {quote.reviewRequestedAt && (
              <Row label="Talep">{formatDateTime(quote.reviewRequestedAt, "tr")}</Row>
            )}
            {quote.reviewedAt && (
              <Row label="Cevaplandı">
                {formatDateTime(quote.reviewedAt, "tr")}
                {quote.reviewedByEmail ? ` · ${quote.reviewedByEmail}` : ""}
              </Row>
            )}
            {quote.orderNumber && quote.orderId && (
              <Row label="Sipariş">
                <Link
                  href={`/admin/orders/${quote.orderId}`}
                  className="text-indigo-600 hover:underline"
                >
                  {quote.orderNumber}
                </Link>
              </Row>
            )}
            <Link
              href={`/teklif/${quote.number}`}
              className="mt-3 block text-sm text-green-700 hover:underline"
            >
              Müşterinin gördüğü teklif sayfası →
            </Link>
          </Card>

          <Card title="Müşteri">
            <Row label="Ad">{quote.customerName ?? "—"}</Row>
            <Row label="E-posta">{quote.customerEmail ?? "—"}</Row>
            <Row label="Telefon">{quote.customerPhone ?? "—"}</Row>
            <Row label="Fatura">
              {quote.invoiceType === "corporate" ? "Kurumsal" : "Bireysel"}
            </Row>
            {quote.companyName && <Row label="Firma">{quote.companyName}</Row>}
            {quote.taxId && (
              <Row label="Vergi no">
                {quote.taxId}
                {quote.taxOffice ? ` · ${quote.taxOffice}` : ""}
              </Row>
            )}
            {quote.poNumber && <Row label="PO">{quote.poNumber}</Row>}
            {quote.customerNote && (
              <p className="mt-2 rounded bg-gray-50 p-2 text-sm text-gray-700">
                <span className="block text-xs text-gray-500">Müşteri notu</span>
                {quote.customerNote}
              </p>
            )}
            {quote.reviewNote && (
              <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
                <span className="block text-xs text-amber-700">Talep / karar notu</span>
                {quote.reviewNote}
              </p>
            )}
          </Card>

          {quote.blockers.length > 0 && (
            <Card title="Fiyatlanamayan parçalar" tone="warning">
              <ul className="list-disc pl-5 text-sm text-amber-900">
                {quote.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Card>
          )}

          {/* Teklif DÜZEYİNDEKİ konular (tavan aşımı gibi): `blockers` yalnız
              parça başına fiyatsızlığı sayar, bu yüzden tavanı ayrı göstermek
              şart — aksi hâlde admin ekranda "Fiyatlandı" görür ve sınırı ilk
              öğrenen müşteri olurdu. */}
          {quote.quoteIssues.length > 0 && (
            <Card title="Teklif düzeyinde konular" tone="warning">
              <ul className="list-disc pl-5 text-sm text-amber-900">
                {quote.quoteIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{dfmMessage(d, issue)}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Diğer kararlar">
            <label className="block text-sm">
              <span className="block text-xs text-gray-500">Süre uzatma (gün)</span>
              <input
                inputMode="numeric"
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
                className="mt-1 w-24 rounded-lg border border-gray-300 px-2 py-1"
              />
            </label>
            <ReasonField value={extendReason} onChange={setExtendReason} />
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  call("extend", "extend", {
                    days: daysOrNaN(extendDays),
                    reason: extendReason,
                  })
                }
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-40"
              >
                Süreyi uzat
              </button>
              {quote.status === "needs_review" && (
                <button
                  type="button"
                  disabled={busy !== null || locked}
                  onClick={() => call("reject", "reject-review", { reason: extendReason })}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-40"
                >
                  İncelemeyi fiyat vermeden kapat
                </button>
              )}
              {(quote.status === "expired" || quote.status === "cancelled") && (
                <button
                  type="button"
                  disabled={busy !== null || locked}
                  onClick={() => call("reopen", "reopen", { reason: extendReason })}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-40"
                >
                  Teklifi yeniden aç
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Bu üç işlem yukarıdaki gerekçe alanını değil, buradaki gerekçeyi kullanır.
            </p>
          </Card>

          {/* ─── Çerçeve anlaşma girişi ─────────────────────────────────
              Bayrak KAPALIYKEN bu blok HİÇ render edilmez (`frameworkEntry`
              null iner). Açıkken kapı ucun kapısıyla AYNI kaynaktan gelir:
              ekran, ucun reddettiği bir düğme göstermez. */}
          {(frameworkEntry || frameworkEntryUnreadable) && (
            <FrameworkEntryCard
              quoteId={quote.id}
              quoteNumber={quote.number}
              entry={frameworkEntry}
              unreadable={frameworkEntryUnreadable}
            />
          )}

          <Card title={d["instantQuote.chat.title"]}>
            {chatOpen ? (
              <OrderChat
                basePath={`/api/admin/quotes/${quote.id}/messages`}
                orderId={quote.id}
                heightClass="h-64"
              />
            ) : (
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700"
              >
                Sohbeti aç
              </button>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * "Çerçeve anlaşmaya dönüştür" — giriş noktası.
 *
 * ─── PARA GÖVDEDEN GİTMEZ ──────────────────────────────────────────────────
 *
 * Form yalnız KİLİT TARİHİ, adres, başlık, çapalı atölye ve gerekçe taşır:
 * taahhüt adetleri ve kilitli birim fiyatlar kaynak teklifin DONMUŞ anlık
 * görüntüsünden kopyalanır. Bir tutar alanı gönderilmesi hâlinde uç isteği
 * 400 ile REDDEDER (sessizce yok saymaz), o yüzden burada böyle bir alan
 * hiç yoktur.
 *
 * Adres teklifin FATURA adresinden ön doldurulur — çerçeve tek adres kilitler
 * ve admin'e altı alanı elle yazdırmak, en olası veri girişi hatasıydı.
 */
function FrameworkEntryCard({
  quoteId,
  quoteNumber,
  entry,
  unreadable,
}: {
  quoteId: string;
  quoteNumber: string;
  entry: FrameworkEntryGate | null;
  unreadable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [lockDate, setLockDate] = useState("");
  const [anchor, setAnchor] = useState("");
  const [reason, setReason] = useState("");
  const prefill = entry?.defaultShippingAddress ?? null;
  const [address, setAddress] = useState({
    adres: prefill?.adres ?? "",
    mahalle: prefill?.mahalle ?? "",
    ilce: prefill?.ilce ?? "",
    il: prefill?.il ?? "",
    postaKodu: prefill?.postaKodu ?? "",
    telefon: prefill?.telefon ?? "",
  });

  if (unreadable) {
    return (
      <Card title="Çerçeve anlaşma" tone="warning">
        <p className="text-sm text-amber-900">
          Bu teklifin çerçeve anlaşmaya dönüştürülebilirliği şu anda okunamadı.
          Düğmenin yokluğu &quot;dönüştürülemez&quot; anlamına GELMEZ; birkaç dakika
          sonra sayfayı yenileyin.
        </p>
      </Card>
    );
  }
  if (!entry) return null;

  if (entry.existingFramework) {
    return (
      <Card title="Çerçeve anlaşma">
        <p className="text-sm text-gray-700">
          Bu teklifin çerçeve anlaşması var:{" "}
          <Link
            href={`/admin/cerceve/${entry.existingFramework.id}`}
            className="font-medium text-green-700 hover:underline"
          >
            {entry.existingFramework.number} →
          </Link>
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Bir teklifin EN FAZLA bir anlaşması olur. İkinci bir taahhüt için teklifi
          yeniden fiyatlayıp ayrı bir anlaşma kurun.
        </p>
      </Card>
    );
  }

  if (!entry.eligible) {
    return (
      <Card title="Çerçeve anlaşma">
        <p className="text-sm text-gray-700">
          Bu teklif çerçeve anlaşmaya dönüştürülemez:
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-gray-600">
          {entry.refusals.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-gray-500">
          Aynı kapılar uçta da uygulanır: bu liste ekranın yorumu değil, isteğin
          alacağı cevaptır.
        </p>
      </Card>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/frameworks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId,
          priceLockedUntil: lockDate,
          shippingAddress: address,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(anchor ? { preferredManufacturerId: anchor } : {}),
          reason,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        refusals?: Array<{ message: string }>;
      };
      if (!response.ok || !data.id) {
        setError(
          data.refusals?.map((r) => r.message).join(" ") ??
            data.error ??
            `Anlaşma kurulamadı (HTTP ${response.status}).`
        );
        return;
      }
      router.push(`/admin/cerceve/${data.id}`);
    } catch {
      setError("Sunucuya ulaşılamadı; işlemin geçip geçmediğini görmek için sayfayı yenileyin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Çerçeve anlaşma">
      <p className="text-sm text-gray-600">
        {quoteNumber} fiyatlı ve çerçeveye uygun. Anlaşma, bu teklifin{" "}
        <strong>parça tanımını, birim fiyatlarını ve katalog anlık görüntüsünü
        DONDURUR</strong>; teslim partiler hâlinde planlanır ve{" "}
        <strong>ödeme parti başına</strong> alınır. Anlaşmanın kendisi bir satış
        değildir: burada hiçbir tahsilat yapılmaz.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white"
        >
          Çerçeve anlaşmaya dönüştür
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <label className="block text-sm">
            <span className="block text-xs text-gray-500">Başlık (isteğe bağlı)</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-gray-500">
              Fiyat kilidinin son günü
            </span>
            <input
              type="date"
              value={lockDate}
              onChange={(e) => setLockDate(e.target.value)}
              className="mt-1 rounded-lg border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-gray-500">
              Çapalı atölye (isteğe bağlı — yalnız atamanın ilk adayı)
            </span>
            <select
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1"
            >
              <option value="">— çapa yok (sıralama seçsin) —</option>
              {entry.manufacturers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.companyName}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="rounded-xl border border-gray-200 p-3">
            <legend className="px-1 text-xs text-gray-500">
              Teslim adresi (anlaşma TEK adres kilitler)
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["adres", "Adres"],
                  ["mahalle", "Mahalle"],
                  ["ilce", "İlçe"],
                  ["il", "İl"],
                  ["postaKodu", "Posta kodu"],
                  ["telefon", "Telefon"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-sm">
                  <span className="block text-xs text-gray-500">{label}</span>
                  <input
                    value={address[key]}
                    onChange={(e) => setAddress({ ...address, [key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1"
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <ReasonField value={reason} onChange={setReason} />
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? "Kuruluyor…" : "Anlaşmayı kur (taslak)"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-40"
            >
              Vazgeç
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Anlaşma <strong>taslak</strong> doğar: parti planlayabilirsiniz ama
            aktifleştirmeden parti serbest bırakılamaz.
          </p>
        </div>
      )}
    </Card>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="mt-3 block text-sm">
      <span className="block text-xs text-gray-500">
        Gerekçe (en az 10 karakter — denetim izine yazılır)
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1"
      />
    </label>
  );
}

function PartCard({ part }: { part: AdminQuotePartView }) {
  const d = useDictionary();
  const [show3d, setShow3d] = useState(false);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start gap-4">
        {part.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={part.thumbnailUrl}
            alt=""
            className="h-24 w-24 rounded-xl border border-gray-100 object-contain"
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-gray-50 text-xs text-gray-400">
            önizleme yok
          </div>
        )}
        <div className="min-w-[14rem] flex-1">
          <h3 className="font-semibold text-gray-900">
            P{String(part.position).padStart(2, "0")} · {part.name}
          </h3>
          <p className="text-xs text-gray-500">
            {part.fileName} · {part.sourceFormat.toUpperCase()} ·{" "}
            {Math.round(part.sourceBytes / 1024)} KB
          </p>
          <p className="mt-2 text-sm text-gray-700">
            {part.technologyName} · {part.materialName} · {part.colorName} · {part.finishName}
            {part.config.layerUm !== null ? ` · ${part.config.layerUm} µm` : ""}
            {part.config.infillPct !== null ? ` · %${part.config.infillPct} doluluk` : ""}
            {part.config.scale !== 1 ? ` · ölçek ×${part.config.scale}` : ""}
            {part.config.criticalTolerance ? " · kritik tolerans" : ""}
          </p>
          <p className="text-sm text-gray-700">
            Adet: <strong>{part.config.quantity}</strong>
            {part.dimensionsMm && (
              <>
                {" · "}
                {mm(part.dimensionsMm.x)} × {mm(part.dimensionsMm.y)} × {mm(part.dimensionsMm.z)}{" "}
                mm
              </>
            )}
            {part.volumeCm3 !== null && <> · {decimal2(part.volumeCm3)} cm³</>}
            {part.areaCm2 !== null && <> · {decimal2(part.areaCm2)} cm²</>}
            {part.bodyCount !== null && part.bodyCount > 1 && <> · {part.bodyCount} gövde</>}
          </p>
          {part.note && <p className="mt-1 text-sm text-gray-600">Not: {part.note}</p>}
          {part.drawingUrl && (
            <a
              href={part.drawingUrl}
              className="mt-1 inline-block text-sm text-indigo-600 hover:underline"
            >
              Teknik çizim: {part.drawingName ?? "indir"}
            </a>
          )}
        </div>
        <div className="min-w-[12rem] text-right text-sm">
          <div className="text-xs text-gray-500">Hesaplanan birim</div>
          <div className="text-gray-900">
            {part.computedUnitKurus === null
              ? (part.computedRefusal ?? "—")
              : formatCurrency(part.computedUnitKurus, "tr")}
          </div>
          <div className="mt-2 text-xs text-gray-500">Yürürlükteki birim</div>
          <div className="text-gray-900">
            {part.effectiveUnitKurus === null ? (
              <span className="text-amber-700">fiyat yok</span>
            ) : (
              <>
                {formatCurrency(part.effectiveUnitKurus, "tr")}{" "}
                <span className="text-xs text-gray-500">
                  ({part.effectiveSource === "manual" ? "manuel" : "otomatik"})
                </span>
              </>
            )}
          </div>
          {part.lineKurus !== null && (
            <div className="mt-1 text-xs text-gray-500">
              satır: {formatCurrency(part.lineKurus, "tr")}
            </div>
          )}
          {part.manualPricedAt && (
            <div className="mt-1 text-[11px] text-gray-400">
              manuel: {formatDateTime(part.manualPricedAt, "tr")}
              {part.manualPricedByEmail ? ` · ${part.manualPricedByEmail}` : ""}
            </div>
          )}
          {part.targetUnitPriceKurus !== null && (
            <div className="mt-1 text-[11px] text-indigo-600">
              müşteri hedefi: {formatCurrency(part.targetUnitPriceKurus, "tr")}
            </div>
          )}
        </div>
      </div>

      {part.analysisErrorText && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Analiz başarısız: {part.analysisErrorText}. Manuel fiyat bu parçayı{" "}
          <strong>kurtarmaz</strong>; müşterinin dosyayı yeniden yüklemesi gerekir.
        </p>
      )}

      {part.dfm.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {part.dfm.map((issue, index) => (
            <li
              key={`${issue.code}-${index}`}
              className={
                issue.severity === "error"
                  ? "text-red-700"
                  : issue.severity === "warning"
                    ? "text-amber-700"
                    : "text-gray-600"
              }
            >
              • {dfmMessage(d, issue)}
            </li>
          ))}
        </ul>
      )}

      {part.previewGlbUrl && (
        <div className="mt-3">
          {show3d ? (
            <ModelViewer
              url={part.previewGlbUrl}
              className="h-72 w-full rounded-xl"
              dimensionsMm={part.dimensionsMm}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShow3d(true)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
            >
              3B önizlemeyi aç
            </button>
          )}
        </div>
      )}
    </section>
  );
}
