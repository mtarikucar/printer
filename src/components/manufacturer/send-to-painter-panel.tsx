"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PAINTER_SCORE_KEYS,
  PAINTER_SCORE_LABELS_TR,
  PAINTER_SCORE_SHORT_LABELS_TR,
  type PainterScoreKey,
} from "@/app/admin/scoring-evaluations/painter-evaluation-view";

interface PainterOption {
  id: string;
  companyName: string;
  il: string | null;
  capabilities: string[];
  contactPerson: string;
  phone: string;
  address: {
    adres: string;
    mahalle: string;
    ilce: string;
    il: string;
    postaKodu: string;
  } | null;
  /** Already refused this order (declinedPainterIds): shown, but not pickable. */
  declined?: boolean;
  /**
   * GÖSTERİM: tezgâhtaki ayrı kutu sayısı. KAPI DEĞİLDİR — bir parti işi tek
   * "iş"tir ama tezgâhın tamamını doldurabilir.
   */
  currentLoad: number;
  maxConcurrentOrders: number;
  /**
   * KAPI: ağırlıklı yük (sipariş başına 1, parti işlerinde her 20 birim için 1
   * — capacity-unit kararı). Uçların kabul/ret ölçüsü BUDUR; `currentLoad`
   * değil. Eskiden bu panel iş sayısını kapı sanıyordu ve "1/5 iş" yazan bir
   * boyacıyı sunuyordu, uç ise onu "kapasitesi dolu" diye reddediyordu.
   */
  loadUnits: number | null;
  /** Kapının ölçüsüyle yazılmış tek yük etiketi: "6/2 birim · 1 iş". */
  loadLabel?: string;
  /** Sıralayıcının insan okuyacağı kısa gerekçeleri. */
  reasons: string[];
  /** Sıralayıcının sırası (1 = en iyi); sıralama üretilemediyse null. */
  rank: number | null;
  /** 100 en iyi, 0 en kötü. Sırasızsa null — sıfır DEĞİL. */
  score: number | null;
  /** Skorun bileşenleri: rota, yük, güvenilirlik, QC kalitesi, zamanında. */
  parts: Partial<Record<PainterScoreKey, number>> | null;
  eligible: boolean;
  /** Seçilemiyorsa sebebi (Türkçe). */
  ineligibleReason: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "refunded" }
  | { kind: "ready"; painters: PainterOption[]; rankingUnavailable: boolean };

/** Skor bileşenleri: "neden bu boyacı önde" sorusunun tek satırlık cevabı. */
function ScoreParts({ parts }: { parts: Partial<Record<PainterScoreKey, number>> }) {
  const keys = PAINTER_SCORE_KEYS.filter((k) => typeof parts[k] === "number");
  if (keys.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {keys.map((k) => (
        <span
          key={k}
          title={PAINTER_SCORE_LABELS_TR[k]}
          className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-gray-600 ring-1 ring-gray-200"
        >
          {PAINTER_SCORE_SHORT_LABELS_TR[k]} {parts[k]}
        </span>
      ))}
    </div>
  );
}

// Shown on a manufacturer's order detail when the order carries the
// professional-painting add-on and has passed QC: instead of shipping, the
// manufacturer hands the figurine to a painter, who paints and ships.
//
// Liste SIRALIDIR ve sıralamayı otomatik atamayı yapan sıralayıcı üretir
// (P4-C1): rota (size olan mesafe + boyacıdan müşteriye olan mesafe), yük,
// güvenilirlik, QC kalitesi ve zamanında teslim. Eskiden burada sırasız,
// yüksüz bir rehber vardı; tanıdık ilk ad seçiliyordu, oysa iki kargo bacağını
// da platform ödüyor ve dolu bir atölyenin kuyruğu işi günlerce bekletebiliyor.
export function SendToPainterPanel({
  orderId,
  setWarning,
}: {
  orderId: string;
  /**
   * DEVİR OLDU ama bir yan adım tamamlanamadı (uçların `warning` alanı).
   *
   * Uyarı BU KARTIN DIŞINDA, üretici sipariş ekranının kendi hâlinde tutulur.
   * Ölçülen kusur: uyarı burada, kartın kendi state'indeydi ve yarım saniye
   * yaşıyordu — kart yalnız sipariş HENÜZ DEVREDİLMEMİŞKEN çiziliyor
   * (manufacturer/orders/[id]/client.tsx), devir ucu kendi order-changed
   * olayını yayınlıyor ve ManufacturerRealtimeShell her sipariş olayında
   * router.refresh() çağırıyor: tazeleme kartı ekrandan kaldırınca uyarı da
   * onunla birlikte gidiyordu (24 denemenin 1'inde okunabildi). Üretici admin
   * notlarını göremediği için bu ekran onun TEK kanalı; bu yüzden cümle,
   * kaldırılan kartın değil, kartı kaldıran tazelemeden sağ çıkan hâlin
   * içinde durur.
   */
  setWarning: (message: string) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selected, setSelected] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // orderId lets the API rank for THIS job and mark painters who already
    // refused it, so they show greyed out here instead of failing with a 409.
    fetch(`/api/manufacturer/painters?orderId=${encodeURIComponent(orderId)}`)
      .then(async (r) => {
        if (!r.ok) return { failed: true } as const;
        return (await r.json()) as {
          painters?: PainterOption[];
          rankingUnavailable?: boolean;
          refunded?: boolean;
        };
      })
      .then((d) => {
        // Okuma ARIZASI ile "boyacı yok" AYRI hâllerdir. Eskiden ikisi de boş
        // listeye düşüyordu: geçici bir arızada üreticiye "uygun boyacı yok"
        // yazıyordu, oysa liste boş değil BİLİNMİYORdu.
        if ("failed" in d) {
          setState({ kind: "failed" });
          return;
        }
        if (d.refunded) {
          setState({ kind: "refunded" });
          return;
        }
        setState({
          kind: "ready",
          painters: d.painters ?? [],
          rankingUnavailable: d.rankingUnavailable === true,
        });
      })
      .catch(() => setState({ kind: "failed" }));
  }, [orderId]);

  const painters = state.kind === "ready" ? state.painters : [];
  // ÖN SEÇİM: sıralamanın birincisi. Kullanıcı bir şey seçmediyse önerilen
  // geçerlidir — "boş seçim" hâli, sıralamayı gösterip yine de en üstteki adı
  // elle tıklatmaktan ibaret olurdu.
  const suggestedId =
    state.kind === "ready" && !state.rankingUnavailable
      ? painters.find((p) => p.eligible && p.rank !== null)?.id ?? ""
      : "";
  const effectiveId = selected || suggestedId;
  const chosen = painters.find((p) => p.id === effectiveId) ?? null;
  const anyPickable = painters.some((p) => p.eligible);

  const send = async () => {
    if (!effectiveId) {
      setError("Bir boyacı seçin");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manufacturer/orders/${orderId}/send-to-painter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          painterId: effectiveId,
          carrier: carrier || undefined,
          trackingNumber: tracking.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gönderilemedi");
        return;
      }
      const warn =
        typeof data.warning === "string" && data.warning.trim()
          ? (data.warning as string)
          : null;
      if (warn) {
        // Uyarı ÜST BİLEŞENE yazılır ve bu kart burada biter: tazelemeyi
        // buradan çağırmak gereksiz (devir ucu kendi order-changed olayını
        // yayınladı, kabuk zaten tazeleyecek) ve zararlı olurdu — kart kalkar,
        // uyarı ise artık kartın değil sayfanın hâlinde olduğu için sağ kalır.
        setWarning(warn);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-5">
      <h3 className="text-sm font-semibold text-purple-900 mb-1">
        Profesyonel boyama gerekiyor
      </h3>
      <p className="text-xs text-purple-700/80 mb-3">
        Bu sipariş için müşteri profesyonel boyama seçti. Kargolamak yerine bir
        boyacıya gönderin; boyacı boyayıp müşteriye kargolayacak.
      </p>

      {state.kind === "loading" && (
        <p className="text-sm text-gray-400">Boyacılar yükleniyor…</p>
      )}

      {/* Arıza: liste BOŞ değil, BİLİNMİYOR. Yanlış olan cümleyi ("uygun boyacı
          yok") kurmak, üreticiyi olmayan bir soruna göre davranmaya iter. */}
      {state.kind === "failed" && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Boyacı listesi şu anda okunamadı (geçici sistem arızası). Bu,
          &quot;uygun boyacı yok&quot; demek DEĞİLDİR. Birkaç dakika sonra
          sayfayı yenileyin; sorun sürerse yöneticiye bildirin.
        </p>
      )}

      {/* İade edilmiş sipariş hiçbir şey sunmaz: devir ucu zaten reddediyor. */}
      {state.kind === "refunded" && (
        <p className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
          Bu sipariş <strong>iade edilmiş</strong>. İade edilen bir sipariş
          boyacıya devredilemez; bu işi kapatmak için yöneticiyle iletişime
          geçin.
        </p>
      )}

      {state.kind === "ready" && (
        <>
          {/* Sıralama üretilemediyse liste ALFABETİKTİR ve bu söylenir: sırasız
              bir listenin ilk satırı "önerilen" gibi okunmamalı. */}
          {state.rankingUnavailable && painters.length > 0 && (
            <p
              role="alert"
              className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            >
              Boyacı sıralaması şu anda hesaplanamadı (geçici sistem arızası):
              aşağıdaki liste <strong>sırasızdır</strong> ve önerilen boyacı
              gösterilemiyor. Yine de seçim yapabilirsiniz; yük bilgisi
              gerçektir.
            </p>
          )}

          {painters.length === 0 || !anyPickable ? (
            <p className="text-sm text-amber-700">
              {painters.length === 0
                ? "Şu an uygun (aktif, kabul açık) boyacı yok. Lütfen daha sonra tekrar deneyin."
                : "Uygun boyacıların hepsi bu işi daha önce reddetti ya da kapasitesi dolu. Lütfen admin ekibiyle iletişime geçin."}
            </p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {painters.map((p) => {
                  const isChosen = p.id === effectiveId;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={!p.eligible}
                        onClick={() => setSelected(p.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                          isChosen
                            ? "border-purple-400 bg-white ring-2 ring-purple-200"
                            : "border-gray-200 bg-white hover:border-purple-300"
                        } ${p.eligible ? "" : "cursor-not-allowed opacity-60"}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-900">
                            {p.rank !== null && (
                              <span className="mr-1 text-xs text-gray-500">
                                {p.rank}.
                              </span>
                            )}
                            {p.companyName}
                            {p.il ? (
                              <span className="ml-1 text-xs font-normal text-gray-500">
                                · {p.il}
                              </span>
                            ) : null}
                            {p.id === suggestedId && (
                              <span className="ml-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-purple-700">
                                önerilen
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-gray-600">
                            {/* Yük, KAPININ ölçüsüyle yazılır (ortak etiket:
                                "6/2 birim · 1 iş"). Burada iş sayısını tek
                                başına göstermek, uç ağırlıklı yükle reddederken
                                ekranda "1/5" okutmak olurdu. */}
                            {p.loadLabel ??
                              `${p.currentLoad}/${p.maxConcurrentOrders} iş`}
                            {p.score !== null && (
                              <span className="ml-2 font-semibold text-gray-700">
                                skor {p.score}
                              </span>
                            )}
                          </span>
                        </div>
                        {p.parts && <ScoreParts parts={p.parts} />}
                        {p.reasons?.length > 0 && (
                          <p className="mt-1 text-[11px] text-gray-500">
                            {p.reasons.join(" · ")}
                          </p>
                        )}
                        {!p.eligible && p.ineligibleReason && (
                          <p className="mt-1 text-[11px] font-medium text-amber-700">
                            {p.ineligibleReason}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[11px] text-gray-500">
                Sıra, işi otomatik yerleştiren sıralamanın kendisidir: rota (size
                olan mesafe + boyacıdan müşteriye olan mesafe), yük,
                güvenilirlik, QC kalitesi ve zamanında teslim. 100 en iyi, 0 en
                kötüdür. Başka bir boyacı seçmekte serbestsiniz.
              </p>
            </>
          )}
        </>
      )}

      {/* You have to physically post the figure to this workshop, so the
          address has to be on this screen. */}
      {chosen && (
        <div className="mt-3 rounded-lg border border-purple-200 bg-white p-3 text-xs text-gray-700">
          <p className="mb-1 font-semibold text-gray-500">
            Baz baskıyı bu adrese gönderin
          </p>
          <p className="font-medium text-gray-900">{chosen.companyName}</p>
          {chosen.contactPerson && <p>Yetkili: {chosen.contactPerson}</p>}
          {chosen.address ? (
            <>
              <p>{chosen.address.adres}</p>
              {chosen.address.mahalle && <p>{chosen.address.mahalle}</p>}
              <p>
                {chosen.address.ilce} / {chosen.address.il}{" "}
                {chosen.address.postaKodu}
              </p>
            </>
          ) : (
            <p className="text-amber-700">
              Adres kayıtlı değil — admin ekibinden isteyin.
            </p>
          )}
          <p className="mt-1">Tel: {chosen.phone}</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
            >
              <option value="">Kargo firması (opsiyonel)</option>
              <option value="yurtici">Yurtiçi Kargo</option>
              <option value="aras">Aras Kargo</option>
              <option value="mng">MNG Kargo</option>
              <option value="ptt">PTT Kargo</option>
              <option value="surat">Sürat Kargo</option>
              <option value="other">Diğer</option>
              <option value="elden">Elden teslim</option>
            </select>
            <input
              type="text"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="Takip numarası (opsiyonel)"
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Kargo bilgisini girerseniz kayıp/hasar durumunda gönderi takip
            edilebilir ve boyacı teslim aldığını işaretleyebilir.
          </p>
          <button
            onClick={send}
            disabled={busy || !effectiveId}
            className="mt-3 w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {busy ? "Gönderiliyor…" : `Boyacıya gönder: ${chosen.companyName}`}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
