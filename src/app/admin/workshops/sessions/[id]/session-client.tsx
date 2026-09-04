"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormField, Input, Select } from "@/components/ui";
import {
  WORKSHOP_SESSION_STATUS_LABELS,
  WORKSHOP_PARTICIPANT_STATUS_LABELS,
  WORKSHOP_CANCEL_SHIPPED_STATUSES,
} from "@/lib/config/workshop";

interface SessionData {
  id: string;
  venueName: string;
  venueAddress: { adres: string; ilce: string; il: string };
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  bookedCount: number;
  pricePerSeatKurus: number;
  manufacturerName: string | null;
  commissionRateBps: number | null;
  status: string;
  batchCarrier: string | null;
  batchTrackingNumber: string | null;
  batchShippedAt: string | null;
  batchDeliveredAt: string | null;
  joinClosesAt: string;
  deliverBy: string;
  adminNotes: string | null;
}

interface ParticipantRow {
  id: string;
  fullName: string;
  email: string;
  status: string;
  orderId: string | null;
  orderNumber: string | null;
  /**
   * Siparişin KENDİ `status` kolonu (sunucudan) — bir "Toplu sevk" çağrısının
   * `leftBehind` yanıtı yalnızca CLIENT state'tir ve sayfa yenilendiğinde
   * kaybolur. Bu alan kaybolmaz: kısmi bir partinin "kim gerçekten sevk
   * edildi" sorusunun TEK kalıcı görünümü budur.
   */
  orderStatus: string | null;
  modelReady: boolean;
}

/** Ship ucunun döndürdüğü, henüz QC onayı almadığı için sevk edilmeyen satır. */
interface LeftBehindRow {
  orderNumber: string;
  participantName: string | null;
}

/**
 * Seans iptal ucunun raporu. `alreadyShipped` ve `failed` boş DEĞİLSE bu
 * ekranda uyarı olarak durur: sessizce yutulan bir iade, geri ödenmemiş
 * müşteri parası demektir.
 */
interface CancelReport {
  refunded: string[];
  alreadyShipped: string[];
  failed: string[];
}

/** Katılımcı iptal ucunun makine okunur hata kodları → admin'e Türkçe karşılık. */
const PARTICIPANT_CANCEL_ERRORS: Record<string, string> = {
  not_found: "Katılımcı bulunamadı.",
  already_shipped:
    "Bu katılımcının figürü sevk edilmiş; otomatik iade edilmez. Normal iade ekranından tek tek halledin.",
  refund_failed:
    "İade işlenemedi — katılımcı İPTAL EDİLMEDİ. Tekrar deneyin ya da normal iade ekranını kullanın.",
};

// Aynı desen: admin/workshops/[venueId]/venue-client.tsx'teki SESSION_STATUS_BADGE
// ile birebir aynı renk sözlüğü (her ekran kendi kopyasını tutar).
const SESSION_STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  open: "bg-green-100 text-green-700",
  closed: "bg-amber-100 text-amber-700",
  in_production: "bg-blue-100 text-blue-700",
  shipped: "bg-indigo-100 text-indigo-700",
  delivered: "bg-teal-100 text-teal-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-gray-200 text-gray-600",
};

const PARTICIPANT_STATUS_BADGE: Record<string, string> = {
  pending_payment: "bg-gray-100 text-gray-600",
  paid: "bg-blue-100 text-blue-700",
  model_ready: "bg-indigo-100 text-indigo-700",
  in_production: "bg-blue-100 text-blue-700",
  delivered: "bg-teal-100 text-teal-700",
  cancelled: "bg-gray-200 text-gray-600",
};

// jobs-client.tsx'teki (painter panel) aynı sözlük — merkezi bir kaynağı yok,
// her ekran kendi kopyasını tutuyor.
const CARRIER_LABELS: Record<string, string> = {
  yurtici: "Yurtiçi",
  aras: "Aras",
  mng: "MNG",
  ptt: "PTT",
  surat: "Sürat",
  other: "Diğer",
  elden: "Elden",
};

function formatKurus(kurus: number): string {
  return `₺${(kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

function sessionStatusLabel(status: string): string {
  return (WORKSHOP_SESSION_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

function participantStatusLabel(status: string): string {
  return (WORKSHOP_PARTICIPANT_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/** "Sevkiyat" kolonu — siparişin KENDİ durumundan türetilir, client state'e bağlı değildir. */
function ShipmentCell({ orderId, orderStatus }: { orderId: string | null; orderStatus: string | null }) {
  if (!orderId) return <span className="text-gray-400">—</span>;
  if (orderStatus === "delivered") return <span className="text-teal-700">Teslim edildi</span>;
  if (orderStatus === "shipped") return <span className="text-indigo-700">Sevk edildi</span>;
  return <span className="text-amber-700">Sevk bekliyor</span>;
}

/**
 * Katılımcı tek tek iptal edilebilir mi? Sevk edilmiş figür için uç zaten 409
 * döner (otomatik iade ürünü bedava vermek olurdu); butonu hiç göstermemek
 * admin'i o duvara çarpmadan doğru yere — siparişin kendi iade ekranına —
 * yönlendirir.
 */
function canCancelParticipant(p: ParticipantRow): boolean {
  if (p.status === "cancelled") return false;
  return !(WORKSHOP_CANCEL_SHIPPED_STATUSES as readonly string[]).includes(
    p.orderStatus ?? ""
  );
}

export function SessionClient({
  session,
  participants,
  readyCount,
  totalCount,
  missingNames,
  netTotalKurus,
  daysUntilSession,
}: {
  session: SessionData;
  participants: ParticipantRow[];
  readyCount: number;
  totalCount: number;
  missingNames: string[];
  netTotalKurus: number | null;
  daysUntilSession: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Son "Toplu sevk" çağrısının QC onayı bekleyen, dokunulmadan bırakılan
  // satırları — bir sayı yetmez, admin İSİMLE görmeli (bkz. task-12a-report.md
  // "Finding 1" düzeltmesi). Bu, yalnızca son işlemin ANLIK yanıtıdır; kalıcı
  // görünüm katılımcı tablosundaki "Sevkiyat" kolonudur (orderStatus).
  const [leftBehind, setLeftBehind] = useState<LeftBehindRow[]>([]);
  // Son iptal çağrısının raporu (client state; kalıcı görünüm katılımcı
  // tablosundaki durum kolonudur).
  const [cancelReport, setCancelReport] = useState<CancelReport | null>(null);
  // İptal hataları sevkiyat kartındaki `error` ile PAYLAŞILMAZ: admin hatayı
  // bastığı butonun yanında görmeli, üç kart yukarıda değil.
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);

  // ─── Toplu sevk formu ───────────────────────────────────────────────────
  const [carrier, setCarrier] = useState("yurtici");
  const [trackingNumber, setTrackingNumber] = useState("");

  const statusBadge =
    SESSION_STATUS_BADGE[session.status] ?? "bg-gray-100 text-gray-700";
  const sharePercent =
    session.commissionRateBps != null ? (10000 - session.commissionRateBps) / 100 : null;

  // Sevk henüz yapılmadıysa formu göster; sonrasında salt okunur sevk
  // bilgisine geç. `draft`/`open` seansta henüz fiyatlanmış/üretilmiş bir
  // parti olmadığı için sevk butonu da hiç anlamlı değil.
  const canShowShipAction =
    !["draft", "open", "shipped", "delivered", "completed", "cancelled"].includes(
      session.status
    );
  const canShowDeliverAction = session.status === "shipped";
  // Tamamlanmış bir seansta iptal anlamsız (parti teslim edildi, hakediş
  // ödendi). Zaten `cancelled` seansta buton DURUR: uç aynı zamanda başarısız
  // iadelerin yeniden deneme yoludur.
  const canCancelSession = session.status !== "completed";
  const isCancelled = session.status === "cancelled";

  const submitShip = async () => {
    setError(null);
    if (carrier !== "elden" && !trackingNumber.trim()) {
      setError("Kargoyla sevkte takip numarası zorunludur.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workshops/sessions/${session.id}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier,
          trackingNumber: trackingNumber.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      // Kısmi sevkte bile (200 dönse de) geride kalanlar var olabilir —
      // hem başarı hem hata dalında aynı alanı okuyoruz.
      setLeftBehind(Array.isArray(payload.leftBehind) ? payload.leftBehind : []);
      if (!res.ok) {
        setError(payload.error || "Toplu sevk başarısız.");
        return;
      }
      router.refresh();
    } catch {
      // fetch'in kendisi reddedilirse (ağ hatası) `res` hiç dönmez —
      // catch olmadan `finally` yine de busy'yi kapatır ama hata mesajı
      // hiç görünmez, admin buton neden pasifleşti anlamaz.
      setError("Ağ hatası — bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  const submitDeliver = async () => {
    if (!confirm("Parti mekana teslim edildi mi? Bu işlem geri alınamaz.")) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workshops/sessions/${session.id}/deliver`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Toplu teslim başarısız.");
        return;
      }
      router.refresh();
    } catch {
      setError("Ağ hatası — bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  const submitCancelSession = async () => {
    if (
      !confirm(
        isCancelled
          ? "Bu seans zaten iptal. Yalnızca iadesi başarısız kalan katılımcılar yeniden denenecek. Devam edilsin mi?"
          : "Seans iptal edilsin mi? Ödemiş katılımcıların parası iade edilir, seans \"İptal edildi\" olur. Bu işlem geri alınamaz."
      )
    )
      return;
    setCancelError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workshops/sessions/${session.id}/cancel`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCancelError(payload.error || "Seans iptali başarısız.");
        return;
      }
      setCancelReport({
        refunded: Array.isArray(payload.refunded) ? payload.refunded : [],
        alreadyShipped: Array.isArray(payload.alreadyShipped) ? payload.alreadyShipped : [],
        failed: Array.isArray(payload.failed) ? payload.failed : [],
      });
      router.refresh();
    } catch {
      setCancelError("Ağ hatası — bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  const submitCancelParticipant = async (p: ParticipantRow) => {
    if (
      !confirm(
        `${p.fullName} partiden çıkarılsın mı? Ödemesi varsa iade edilir. Bu işlem geri alınamaz.`
      )
    )
      return;
    setParticipantError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/workshops/sessions/${session.id}/participants/${p.id}/cancel`,
        { method: "POST" }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParticipantError(
          PARTICIPANT_CANCEL_ERRORS[payload.error] ||
            payload.error ||
            "Katılımcı iptali başarısız."
        );
        return;
      }
      router.refresh();
    } catch {
      setParticipantError("Ağ hatası — bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <Link href="/admin/workshops" className="text-sm text-gray-500 hover:text-gray-800">
        ← Atölyeler
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{session.venueName}</h1>
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge}`}>
          {sessionStatusLabel(session.status)}
        </span>
        {session.status !== "delivered" &&
          session.status !== "completed" &&
          session.status !== "cancelled" && (
            <span className="text-xs text-gray-500">
              {daysUntilSession > 0
                ? `Seansa ${daysUntilSession} gün var`
                : daysUntilSession === 0
                  ? "Seans bugün"
                  : "Seans tarihi geçti"}
            </span>
          )}
      </div>

      <p className="text-sm text-gray-600 mb-6">
        {formatDateTime(session.startsAt)} · {session.durationMinutes} dk ·{" "}
        {session.venueAddress.adres} ({session.venueAddress.ilce}/{session.venueAddress.il})
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Model hazırlığı — sistemin çözemediği tek darboğaz burada görünür */}
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-800">
            Model hazırlığı
          </h3>
          <p className="mt-2 text-2xl font-bold text-indigo-900">
            {readyCount}/{totalCount} model hazır
          </p>
          {missingNames.length > 0 && (
            <p className="mt-1 text-xs text-indigo-800/80">
              Eksik: {missingNames.join(", ")}
            </p>
          )}
          {totalCount === 0 && (
            <p className="mt-1 text-xs text-indigo-800/80">Bu seansta henüz ödenmiş sipariş yok.</p>
          )}
        </div>

        {/* Komisyon */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Komisyon
          </h3>
          <p className="mt-2 text-sm text-gray-700">
            {totalCount} sipariş · Üretici:{" "}
            {session.manufacturerName ?? <span className="text-gray-400">atanmadı</span>}
          </p>
          {sharePercent != null ? (
            <>
              <p className="mt-1 text-sm text-gray-700">Üretici payı: %{sharePercent}</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {netTotalKurus != null ? formatKurus(netTotalKurus) : "—"}
              </p>
              <p className="text-xs text-gray-400">üreticinin toplam net payı (donmuş oran)</p>
            </>
          ) : (
            <p className="mt-1 text-xs text-gray-400">
              Oran henüz donmadı — seans kapanmadan komisyon belirlenmez.
            </p>
          )}
        </div>
      </div>

      {/* Toplu sevk / teslim */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Sevkiyat</h3>

        {session.batchShippedAt && (
          <p className="text-sm text-gray-700 mb-2">
            Sevk edildi: {formatDateTime(session.batchShippedAt)} ·{" "}
            {session.batchCarrier ? CARRIER_LABELS[session.batchCarrier] ?? session.batchCarrier : "—"}
            {session.batchTrackingNumber ? ` · Takip: ${session.batchTrackingNumber}` : ""}
          </p>
        )}
        {session.batchDeliveredAt && (
          <p className="text-sm text-gray-700 mb-2">
            Mekana teslim edildi: {formatDateTime(session.batchDeliveredAt)}
          </p>
        )}

        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

        {leftBehind.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-medium">
              QC onayı bekleyen {leftBehind.length} sipariş sevk EDİLMEDİ:
            </p>
            <p className="mt-0.5">
              {leftBehind
                .map((r) => `${r.participantName ?? "—"} (${r.orderNumber})`)
                .join(", ")}
            </p>
            <p className="mt-0.5 text-amber-700/80">
              Üretici QC onayını verdiğinde &quot;Toplu sevk&quot;i tekrar çalıştırın —
              yalnızca bunlar (kendi takip numarasıyla, ikinci bir konsinye
              olarak) sevk edilir.
            </p>
          </div>
        )}

        {canShowShipAction && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
            <FormField label="Kargo">
              <Select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                {Object.entries(CARRIER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={`Takip numarası${carrier === "elden" ? " (gerekmez)" : ""}`}>
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                disabled={carrier === "elden"}
                placeholder={carrier === "elden" ? "Elden teslimde gerekmez" : "Takip numarası"}
              />
            </FormField>
            <button
              type="button"
              onClick={submitShip}
              disabled={busy}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Sevk ediliyor…" : "Toplu sevk"}
            </button>
          </div>
        )}

        {canShowDeliverAction && (
          <button
            type="button"
            onClick={submitDeliver}
            disabled={busy}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? "Teslim ediliyor…" : "Toplu teslim"}
          </button>
        )}

        {!canShowShipAction && !canShowDeliverAction && !session.batchShippedAt && (
          <p className="text-xs text-gray-400">
            Seans henüz üretime girmedi; sevk işlemi kapanış + üretici ataması sonrası açılır.
          </p>
        )}
      </div>

      {/* Seans iptali */}
      {canCancelSession && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Seans iptali</h3>
          <p className="text-xs text-gray-500 mb-3">
            Ödemiş katılımcıların parası iade edilir, ödemeye hiç gelmemişler
            iptal edilir ve seans &quot;İptal edildi&quot; olur. Figürü zaten
            sevk edilmiş katılımcılar otomatik iade EDİLMEZ — aşağıda isimle
            raporlanır, onları normal iade ekranından tek tek halledin.
          </p>
          {cancelError && <p className="text-xs text-red-600 mb-2">{cancelError}</p>}
          <button
            type="button"
            onClick={submitCancelSession}
            disabled={busy}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {busy
              ? "İşleniyor…"
              : isCancelled
                ? "Başarısız iadeleri tekrar dene"
                : "Seansı iptal et ve iade et"}
          </button>

          {cancelReport && (
            <div className="mt-3 space-y-2 text-xs">
              {cancelReport.refunded.length > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                  <p className="font-medium">
                    {cancelReport.refunded.length} katılımcının iadesi işleme alındı:
                  </p>
                  <p className="mt-0.5">{cancelReport.refunded.join(", ")}</p>
                </div>
              )}
              {cancelReport.alreadyShipped.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                  <p className="font-medium">
                    Figürü sevk edilmiş {cancelReport.alreadyShipped.length} katılımcı
                    iade EDİLMEDİ:
                  </p>
                  <p className="mt-0.5">{cancelReport.alreadyShipped.join(", ")}</p>
                  <p className="mt-0.5 text-amber-700/80">
                    Figür yola çıktığı için otomatik iade edilmez. Gerekiyorsa
                    siparişin kendi iade ekranından tek tek işleyin.
                  </p>
                </div>
              )}
              {cancelReport.failed.length > 0 && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">
                  <p className="font-medium">
                    {cancelReport.failed.length} katılımcının iadesi BAŞARISIZ — parası
                    hâlâ bizde:
                  </p>
                  <p className="mt-0.5">{cancelReport.failed.join(", ")}</p>
                  <p className="mt-0.5 text-red-700/80">
                    Bu kişiler iptal edilmedi. &quot;Başarısız iadeleri tekrar
                    dene&quot; ile yalnızca onlar yeniden denenir.
                  </p>
                </div>
              )}
              {cancelReport.refunded.length === 0 &&
                cancelReport.alreadyShipped.length === 0 &&
                cancelReport.failed.length === 0 && (
                  <p className="text-gray-500">
                    İade edilecek ödenmiş sipariş yoktu; seans iptal edildi.
                  </p>
                )}
            </div>
          )}
        </div>
      )}

      {/* Katılımcılar */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Katılımcılar</h3>
        {participantError && (
          <p className="text-xs text-red-600 mb-2">{participantError}</p>
        )}
        {participants.length === 0 ? (
          <p className="text-sm text-gray-500">Bu seansa henüz katılım yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Ad</th>
                  <th className="py-2 pr-3 font-medium">E-posta</th>
                  <th className="py-2 pr-3 font-medium">Durum</th>
                  <th className="py-2 pr-3 font-medium">Sipariş</th>
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Sevkiyat</th>
                  <th className="py-2 pr-3 font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {participants.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3 text-gray-900">{p.fullName}</td>
                    <td className="py-2 pr-3 text-gray-700">{p.email}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          PARTICIPANT_STATUS_BADGE[p.status] ?? "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {participantStatusLabel(p.status)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-700">
                      {p.orderNumber ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {!p.orderId ? (
                        <span className="text-gray-400">—</span>
                      ) : p.modelReady ? (
                        <span className="text-emerald-700">Hazır</span>
                      ) : (
                        <span className="text-amber-700">Bekliyor</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <ShipmentCell orderId={p.orderId} orderStatus={p.orderStatus} />
                    </td>
                    <td className="py-2 pr-3">
                      {canCancelParticipant(p) ? (
                        <button
                          type="button"
                          onClick={() => submitCancelParticipant(p)}
                          disabled={busy}
                          className="text-xs font-medium text-red-700 hover:text-red-800 hover:underline disabled:opacity-50"
                        >
                          İptal et + iade
                        </button>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {session.adminNotes && (
        <p className="mt-4 text-xs text-gray-500">İç not: {session.adminNotes}</p>
      )}
    </div>
  );
}
