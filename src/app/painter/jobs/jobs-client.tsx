"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/types";
import { sizeDisplayTr } from "@/lib/config/sizes";
import { QC_MIN_PHOTOS } from "@/lib/config/qc";
import {
  uploadWithProgress,
  type UploadProgress,
  type UploadError,
} from "@/lib/upload-with-progress";
import { UploadProgressBar } from "@/components/ui/UploadProgressBar";
import { ModelViewer } from "@/components/model-viewer";
import { formatCurrency, formatDateTime } from "@/lib/i18n/format";
import { isRefunded } from "@/lib/config/order-status-policy";
import { JobChat } from "./job-chat";

interface Job {
  id: string;
  orderNumber: string;
  orderType: string;
  productTitleSnapshot: string | null;
  customerName: string | null;
  figurineSize: string | null;
  style: string | null;
  finish: string | null;
  modifiers: string[] | null;
  painterStatus: string | null;
  /** "refunded" → cancelled job: no actions, no earning promised. */
  paymentStatus: string | null;
  assignedAt: string | null;
  /** Colour and other spec the customer/admin agreed on. */
  specRows: { label: string; value: string }[];
  material: string | null;
  /**
   * The painter's payout for this job, computed on the server with the
   * accrual's own functions (painterBaseKurus + computeEarning at the order's
   * frozen rate). Display only: this component never redoes the commission.
   */
  commissionRateBps: number;
  grossKurus: number;
  commissionKurus: number;
  netKurus: number;
  handoffCarrier: string | null;
  handoffTrackingNumber: string | null;
  receivedAt: string | null;
  /** QC photos already uploaded for the current round (server truth). */
  qcPhotoCount: number;
  qcPhotoUrls: string[];
  glbUrl: string | null;
  /**
   * Yeni model sürümü duyurusu ve boyacının onayı (partner-model-ack.ts).
   * `pending` iken elindeki baskı ESKİ sürüme ait olabilir: QC'ye gönderme ve
   * kargo kapalıdır (sunucu da aynı kapıyı uygular).
   */
  modelAck: {
    announcedRevision: number | null;
    acknowledgedRevision: number | null;
    pending: boolean;
    /**
     * Onay günlüğü OKUNAMADI (geçici arıza). `pending` bu durumda da true'dur
     * — kapı temkinle kapalı kalır — ama sebebi bir KARAR değil ARIZAdır ve
     * sürüm numarası BİLİNMEZ. İkisini ayırmayan kart, olmamış bir yüklemeyi
     * ("Modelin yeni sürümü yüklendi (v)") duyurup boyacıyı hiçbir şey
     * yapmayan bir onay düğmesine yolluyordu.
     */
    readFailed: boolean;
  };
  /** Yöneticiden gelen okunmamış mesaj sayısı. */
  adminUnreadCount: number;
  /**
   * Boyacının kendi eylem günlüğü (painter_actions), yeniden eskiye.
   *
   * Üretici panelinde bu günlük "İşlem geçmişi" kartı olarak zaten vardı;
   * boyacıda hiç yoktu. Yönetici bir adımı boyacı ADINA kaydedebildiği için
   * (on-behalf) bu eksik, boyacının kendi işinde ne olduğunu panelinden
   * göremediği anlamına geliyordu — yalnızca bildirim kutusunu okursa.
   */
  actions: {
    id: string;
    action: string;
    notes: string | null;
    createdAt: string;
    /** Yönetici bu adımı boyacı adına kaydetti (notun "[Admin adına:" damgası). */
    byAdmin: boolean;
  }[];
  customerNote: string | null;
  quantity: number;
  /** The styled image the customer signed off on — the painting reference. */
  approvedImageUrl: string | null;
  photoUrls: string[];
  shippingAddress: {
    adres: string;
    mahalle?: string;
    ilce: string;
    il: string;
    postaKodu: string;
    telefon: string;
  } | null;
}

const CARRIER_LABELS: Record<string, string> = {
  yurtici: "Yurtiçi",
  aras: "Aras",
  mng: "MNG",
  ptt: "PTT",
  surat: "Sürat",
  other: "Diğer",
  elden: "Elden",
};

const STATUS_BADGE: Record<string, string> = {
  assigned: "bg-amber-100 text-amber-700",
  accepted: "bg-blue-100 text-blue-700",
  painting: "bg-indigo-100 text-indigo-700",
  painted: "bg-green-100 text-green-700",
  qc_pending: "bg-purple-100 text-purple-700",
  qc_rejected: "bg-red-100 text-red-700",
  qc_approved: "bg-emerald-100 text-emerald-700",
  shipped: "bg-emerald-100 text-emerald-700",
};
const STATUS_LABEL: Record<string, string> = {
  assigned: "Atandı",
  accepted: "Kabul edildi",
  painting: "Boyanıyor",
  painted: "Boyandı",
  qc_pending: "QC onayında",
  qc_rejected: "QC reddedildi",
  qc_approved: "QC onaylandı",
  shipped: "Kargolandı",
};

/**
 * Eylem günlüğü etiketleri. Metinler KİŞİSİZ ("kabul edildi", "kargolandı")
 * çünkü aynı satırı yönetici de boyacı adına yazmış olabilir; "kabul ettiniz"
 * demek o satırda yalan olurdu. Kimin yaptığı ayrı bir rozette söylenir.
 */
const PAINTER_ACTION_LABELS: Record<string, string> = {
  accept: "İş kabul edildi",
  decline: "İş reddedildi",
  received: "Baskı teslim alındı",
  painted: "Boyama tamamlandı",
  submit_qc: "Kalite kontrole gönderildi",
  ship: "Kargolandı",
  admin_assigned: "Yönetici işi size atadı",
  admin_revoked: "Yönetici işi sizden geri aldı",
  admin_swapped_out: "Yönetici işi başka bir boyacıya verdi",
  // partner-model-ack.ts sabitleri (model_revision / model_ack).
  model_revision: "Yeni model sürümü duyuruldu",
  model_ack: "Yeni model sürümü onaylandı",
};

const PAINTER_ACTION_DOTS: Record<string, string> = {
  accept: "bg-indigo-500",
  decline: "bg-red-500",
  received: "bg-blue-500",
  painted: "bg-amber-500",
  submit_qc: "bg-purple-500",
  ship: "bg-emerald-500",
  admin_assigned: "bg-indigo-500",
  admin_revoked: "bg-red-500",
  admin_swapped_out: "bg-red-500",
  model_revision: "bg-amber-500",
  model_ack: "bg-emerald-500",
};

const TABS: { value: string | null; label: string }[] = [
  { value: null, label: "Tümü" },
  { value: "assigned", label: "Atandı" },
  { value: "accepted", label: "Kabul edildi" },
  { value: "qc_pending", label: "QC onayında" },
  { value: "qc_rejected", label: "QC reddedildi" },
  { value: "qc_approved", label: "QC onaylandı" },
  { value: "shipped", label: "Kargolandı" },
];

const CARRIERS: { value: string; label: string }[] = [
  { value: "yurtici", label: "Yurtiçi Kargo" },
  { value: "aras", label: "Aras Kargo" },
  { value: "mng", label: "MNG Kargo" },
  { value: "ptt", label: "PTT Kargo" },
  { value: "surat", label: "Sürat Kargo" },
  { value: "other", label: "Diğer" },
];

export function PainterJobsClient({
  jobs,
  total,
  page,
  pageSize,
  filterStatus,
  locale,
}: {
  jobs: Job[];
  total: number;
  page: number;
  pageSize: number;
  filterStatus: string | null;
  locale: Locale;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState<Record<string, string>>({});
  const [qcProgress, setQcProgress] = useState<{
    id: string;
    p: UploadProgress;
  } | null>(null);
  const [qcUploaded, setQcUploaded] = useState<Record<string, number>>(() =>
    Object.fromEntries(jobs.map((j) => [j.id, j.qcPhotoCount]))
  );
  // Sunucunun dürüst cevabı ekranda KALIR. İade edilmiş bir işi bırakınca kart
  // listeden düşüyor ve "iş kapandı, başka boyacıya gitmeyecek, ceza yazılmadı"
  // cümlesini taşıyan tek şey o cevap: yenileme onu da siliyordu.
  const [notice, setNotice] = useState<string | null>(null);

  const call = async (id: string, action: string, payload?: Record<string, unknown>) => {
    setBusy(`${action}-${id}`);
    try {
      const res = await fetch(`/api/painter/orders/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "İşlem başarısız");
        return;
      }
      const data = await res.json().catch(() => null);
      if (data && typeof data.message === "string" && data.message) {
        setNotice(data.message);
      }
      router.refresh();
    } finally {
      setQcProgress(null);
      setBusy(null);
    }
  };

  const decline = (id: string) => {
    const reason = prompt("Reddetme sebebi (opsiyonel):") ?? undefined;
    call(id, "decline", { reason });
  };

  // İade edilmiş işin TEK çalışan çıkışı — ve panelde hiç yoktu: iade dalı
  // bütün düğmeleri birden gizlediği için boyacı, sunucunun KABUL ettiği bu
  // işlemi hiçbir yerden yapamıyordu. Sunucuda ret bir temizliktir: iş
  // boyacıdan koparılır, başka bir boyacıya yönlendirilmez ve sicile ceza
  // yazılmaz. Sebep SORULMAZ — gerekçelendirilecek bir ret yok, sipariş zaten
  // kapandı; cümlenin tamamı onay kutusunda ve sunucunun cevabında duruyor.
  const releaseRefunded = (id: string) => {
    if (
      !confirm(
        "Bu sipariş iade edildi. İşi bırakırsanız iş listenizden düşer; " +
          "başka bir boyacıya yönlendirilmez ve bu bırakma güvenilirlik " +
          "puanınıza işlenmez."
      )
    ) {
      return;
    }
    call(id, "decline");
  };

  // "Yeni sürümü gördüm": onay, boyacının kendi eylem günlüğüne yazılır ve
  // QC/kargo kapısını açar. Sürüm numarası gönderilir ki iki sekme açıkken
  // görülmemiş bir sürüm onaylanmasın (sunucu eşleşmezse 409 döner).
  const ackModel = (j: Job) => {
    if (j.modelAck.announcedRevision == null) return;
    call(j.id, "ack-model", { revision: j.modelAck.announcedRevision });
  };

  const uploadQcPhoto = async (id: string, file: File) => {
    setBusy(`qc-upload-${id}`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const ok = await uploadWithProgress(`/api/painter/orders/${id}/qc-photos`, fd, {
        onProgress: (p) => setQcProgress({ id, p }),
      })
        .then(() => true)
        .catch((e: UploadError) => {
          alert(e?.message || "Fotoğraf yüklenemedi");
          return false;
        });
      if (!ok) return;
      setQcUploaded((s) => ({ ...s, [id]: (s[id] ?? 0) + 1 }));
    } finally {
      setBusy(null);
    }
  };

  const submitQc = (id: string) => {
    if ((qcUploaded[id] ?? 0) < QC_MIN_PHOTOS) {
      alert(
        `Önce en az ${QC_MIN_PHOTOS} QC fotoğrafı yükleyin: genel ön, arka/yan, ` +
          `yüz veya en detaylı bölgenin yakın çekimi ve kaide/taban.`
      );
      return;
    }
    call(id, "submit-qc");
  };

  const ship = (id: string) => {
    const t = (tracking[id] ?? "").trim();
    if (!t) {
      alert("Takip numarası girin");
      return;
    }
    call(id, "ship", { trackingNumber: t, carrier: carrier[id] || undefined });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Boyama İşleri</h1>
        <p className="text-sm text-gray-500 mt-1">
          Size atanan profesyonel boyama işleri.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800"
        >
          <p className="flex-1">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Kapat
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => {
          const active = (t.value ?? null) === (filterStatus ?? null);
          const href = t.value ? `/painter/jobs?status=${t.value}` : "/painter/jobs";
          return (
            <Link
              key={t.label}
              href={href}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          Bu durumda iş yok.
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-indigo-600">{j.orderNumber}</span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      STATUS_BADGE[j.painterStatus ?? ""] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {STATUS_LABEL[j.painterStatus ?? ""] || j.painterStatus}
                  </span>
                  {isRefunded(j) && (
                    <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      İade edildi
                    </span>
                  )}
                </div>
                <span className="text-right text-sm font-semibold text-gray-800">
                  {/* Net is the payout (commission is deducted at accrual); all
                      three figures come from the server's computeEarning and
                      are formatted like the Kazançlar page (formatCurrency, two
                      decimals, commission shown as an amount too). */}
                  <span className={isRefunded(j) ? "text-gray-400 line-through" : undefined}>
                    {formatCurrency(j.netKurus, locale)}
                  </span>
                  <span className="block text-[11px] font-normal text-gray-400">
                    brüt {formatCurrency(j.grossKurus, locale)} · komisyon %{j.commissionRateBps / 100}{" "}
                    (−{formatCurrency(j.commissionKurus, locale)})
                  </span>
                </span>
              </div>
              <div className="text-sm text-gray-700 mb-1">
                {j.productTitleSnapshot || j.style || "Özel figür"}
                {j.figurineSize &&
                  ` · ${sizeDisplayTr(j.figurineSize, { short: true })}`}
                {j.material && ` · ${j.material === "filament" ? "Filament" : "Reçine"}`}
              </div>
              {/* Finish decides what actually has to be in the box. */}
              <div className="mb-1 text-xs text-gray-600">
                {j.finish === "luxe_display"
                  ? "Lüks Vitrin — tam el boyaması + premium kaide, isim plakası ve sert kutu"
                  : j.finish === "hand_painted"
                    ? "El Boyaması — tam el boyaması + QC fotoğrafı + hediye kutusu"
                    : j.finish || ""}
              </div>
              {j.modifiers && j.modifiers.length > 0 && (
                <div className="mb-1 text-xs text-gray-600">
                  Stil düzenleyici:{" "}
                  {j.modifiers
                    .map((m) => (m === "pixel_art" ? "Piksel Art — düz bloklu renkler, sınırlı palet" : m))
                    .join(", ")}
                </div>
              )}
              {j.customerName && (
                <div className="text-xs text-gray-500 mb-3">Müşteri: {j.customerName}</div>
              )}

              {/* The brief. Without these the painter was guessing the colours
                  and could not post the parcel. */}
              {(j.approvedImageUrl || j.photoUrls.length > 0) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {j.approvedImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={j.approvedImageUrl}
                      alt="Onaylı görsel"
                      className="h-28 w-28 rounded-lg border-2 border-green-300 object-cover"
                      title="Müşterinin onayladığı görsel"
                    />
                  )}
                  {j.photoUrls.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={u}
                      alt="Müşteri fotoğrafı"
                      className="h-28 w-28 rounded-lg border border-gray-200 object-cover"
                      title="Müşteri fotoğrafı"
                    />
                  ))}
                </div>
              )}

              {j.glbUrl && (
                <details className="mb-3 rounded-lg border border-gray-200 p-2">
                  <summary className="cursor-pointer text-xs font-medium text-gray-600">
                    3D modeli aç (tüm açılar)
                  </summary>
                  <div className="mt-2">
                    <ModelViewer url={j.glbUrl} className="h-64 w-full rounded-lg" />
                  </div>
                </details>
              )}

              {(j.specRows.length > 0 || j.quantity > 1) && (
                <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-gray-50 p-3 sm:grid-cols-3">
                  {j.specRows.map((row, i) => (
                    <div key={i}>
                      <dt className="text-[11px] text-gray-400">{row.label}</dt>
                      <dd className="text-xs font-medium text-gray-900">{row.value}</dd>
                    </div>
                  ))}
                  {j.quantity > 1 && (
                    <div>
                      <dt className="text-[11px] text-gray-400">Adet</dt>
                      <dd className="text-xs font-medium text-gray-900">{j.quantity}</dd>
                    </div>
                  )}
                </dl>
              )}

              {j.customerNote && (
                <p className="mb-3 whitespace-pre-line rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <span className="font-semibold">Müşteri notu: </span>
                  {j.customerNote}
                </p>
              )}

              {/* The painter ships to the customer directly, so they need the
                  address — it was never sent to this panel. */}
              {j.shippingAddress &&
                !isRefunded(j) &&
                ["accepted", "painting", "painted", "qc_approved"].includes(
                  j.painterStatus ?? ""
                ) && (
                  <div className="mb-3 rounded-lg border border-gray-200 p-3 text-xs text-gray-700">
                    <p className="mb-1 font-semibold text-gray-500">Teslimat adresi</p>
                    <p>{j.shippingAddress.adres}</p>
                    {j.shippingAddress.mahalle && <p>{j.shippingAddress.mahalle}</p>}
                    <p>
                      {j.shippingAddress.ilce} / {j.shippingAddress.il}{" "}
                      {j.shippingAddress.postaKodu}
                    </p>
                    <p className="mt-1">Tel: {j.shippingAddress.telefon}</p>
                  </div>
                )}

              {/* Physical hand-off: courier record and the receipt confirmation
                  that starts the defect-reporting window. */}
              {(j.handoffTrackingNumber || j.handoffCarrier || !j.receivedAt) &&
                !isRefunded(j) &&
                ["assigned", "accepted"].includes(j.painterStatus ?? "") && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    <span>
                      {j.handoffCarrier === "elden"
                        ? "Elden teslim"
                        : j.handoffTrackingNumber
                          ? `Kargo: ${CARRIER_LABELS[j.handoffCarrier ?? ""] ?? j.handoffCarrier ?? "—"} · ${j.handoffTrackingNumber}`
                          : "Üretici kargo bilgisi girmedi"}
                    </span>
                    {j.receivedAt ? (
                      <span className="font-semibold text-green-700">
                        ✓ Teslim alındı
                      </span>
                    ) : (
                      <button
                        onClick={() => call(j.id, "received")}
                        disabled={busy !== null}
                        className="rounded-lg bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Teslim aldım
                      </button>
                    )}
                  </div>
                )}

              {/* Yeni model sürümü: dosya SESSİZCE değişmez. Boyacı, elindeki
                  baskının eski sürüme ait olabileceğini okur ve onaylayana
                  kadar QC/kargo kapalıdır. */}
              {/* Onay günlüğü OKUNAMADI: kapı yine kapalı ama gerekçe ayrı.
                  Buraya "Modelin yeni sürümü yüklendi (v)" yazmak sistemin
                  BİLMEDİĞİ bir olayı anlatmak olurdu — kartların çoğunda öyle
                  bir duyuru hiç yok. Onay düğmesi de bilerek YOK: sürüm
                  numarası bilinmediği için tıklama sessizce hiçbir şey
                  yapmıyordu (ackModel null sürümde erken dönüyor) ve yazma ucu
                  aynı arızada zaten 503 veriyor. Üretici panelindeki ikizi:
                  manufacturer/orders/[id]/client.tsx · ackUnreadable. */}
              {!isRefunded(j) && j.modelAck.pending && j.modelAck.readFailed && (
                <div
                  role="alert"
                  className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
                >
                  <p className="font-semibold">
                    Model onay kaydınız şu anda okunamıyor (geçici sistem arızası)
                  </p>
                  <p className="mt-1">
                    Bu iş için yeni bir model sürümü yüklenip yüklenmediğini şu
                    anda söyleyemiyoruz. Güvenlik gereği QC&apos;ye gönderme ve
                    kargolama kapatıldı. Onaylanacak bir sürüm bilinmediği için
                    onay düğmesi de gösterilmiyor; birkaç dakika sonra sayfayı
                    yenileyin.
                  </p>
                </div>
              )}
              {!isRefunded(j) && j.modelAck.pending && !j.modelAck.readFailed && (
                <div
                  role="alert"
                  className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
                >
                  <p className="font-semibold">
                    Modelin yeni sürümü yüklendi (v{j.modelAck.announcedRevision})
                  </p>
                  <p className="mt-1">
                    Elinizdeki baskı ESKİ sürüme ait olabilir. Devam etmeden önce
                    yeni sürümü gördüğünüzü onaylayın; gerekiyorsa yönetici ile
                    aşağıdaki mesajlaşmadan teyitleşin. Onaylayana kadar QC&apos;ye
                    gönderme ve kargolama kapalıdır.
                  </p>
                  <button
                    onClick={() => ackModel(j)}
                    disabled={busy !== null}
                    className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    Yeni sürümü gördüm (v{j.modelAck.announcedRevision})
                  </button>
                </div>
              )}
              {!isRefunded(j) &&
                !j.modelAck.pending &&
                j.modelAck.acknowledgedRevision != null && (
                  <p className="mb-3 text-[11px] text-gray-500">
                    Onayladığınız model sürümü: v{j.modelAck.acknowledgedRevision}
                  </p>
                )}

              {/* Refunded: the job is cancelled. Same treatment as the
                  manufacturer order page — a clear banner instead of accept /
                  QC / ship buttons, and no earning promised. */}
              {isRefunded(j) ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  <p className="font-medium">
                    Bu sipariş iade edildi. İş iptal; hakediş oluşmaz.
                  </p>
                  {/* İleri adım yok ama ÇIKIŞ var: ret ucu iade edilmiş işte
                      bilerek açık (temizlik) ve yalnız `assigned` iken çalışır —
                      sonraki alt durumlarda sunucu 400 verir, o yüzden orada
                      düğme de yok. */}
                  {j.painterStatus === "assigned" && (
                    <div className="mt-3">
                      <p className="text-xs text-red-800/80">
                        Bu işi bırakabilirsiniz: iş listenizden düşer, başka bir
                        boyacıya yönlendirilmez ve bırakma güvenilirlik puanınıza
                        işlenmez.
                      </p>
                      <button
                        onClick={() => releaseRefunded(j.id)}
                        disabled={busy !== null}
                        className="mt-2 rounded-lg bg-gray-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
                      >
                        İşi bırak
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {j.painterStatus === "assigned" && (
                    <>
                      <button
                        onClick={() => call(j.id, "accept")}
                        disabled={busy !== null}
                        className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        Kabul et
                      </button>
                      <button
                        onClick={() => decline(j.id)}
                        disabled={busy !== null}
                        className="px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
                      >
                        Reddet
                      </button>
                    </>
                  )}
                  {/* Paint done → submit QC photos for admin review. Also the
                      re-submit path after a QC rejection. */}
                  {["accepted", "painting", "painted", "qc_rejected"].includes(
                    j.painterStatus ?? ""
                  ) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {j.painterStatus === "qc_rejected" && (
                        <span className="w-full text-xs text-red-600">
                          QC reddedildi — düzeltip yeni fotoğraflarla tekrar gönderin.
                        </span>
                      )}
                      <label className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg cursor-pointer hover:bg-gray-200">
                        QC fotoğrafı ekle
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={busy !== null}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadQcPhoto(j.id, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {qcProgress?.id === j.id && (
                        <UploadProgressBar
                          progress={qcProgress.p}
                          processingLabel="Fotoğraf işleniyor…"
                          className="w-full"
                        />
                      )}
                      {j.qcPhotoUrls.length > 0 && (
                        <span className="flex gap-1">
                          {j.qcPhotoUrls.slice(0, 4).map((u) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={u}
                              src={u}
                              alt="QC"
                              className="h-10 w-10 rounded border border-gray-200 object-cover"
                            />
                          ))}
                        </span>
                      )}
                      {(qcUploaded[j.id] ?? 0) > 0 && (
                        <span className="text-xs text-green-600">
                          {qcUploaded[j.id]} fotoğraf eklendi
                        </span>
                      )}
                      <button
                        onClick={() => submitQc(j.id)}
                        disabled={
                          busy !== null ||
                          (qcUploaded[j.id] ?? 0) < QC_MIN_PHOTOS ||
                          // Onaylanmamış yeni model sürümü varsa QC turu
                          // açılmamalı: onaylanan tur işi kargoya açar.
                          j.modelAck.pending
                        }
                        className="px-4 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
                      >
                        QC&apos;ye gönder
                      </button>
                    </div>
                  )}
                  {j.painterStatus === "qc_pending" && (
                    <span className="text-sm text-purple-700">
                      QC onayında — admin incelemesi bekleniyor.
                    </span>
                  )}
                  {j.painterStatus === "qc_approved" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={tracking[j.id] ?? ""}
                        onChange={(e) => setTracking((s) => ({ ...s, [j.id]: e.target.value }))}
                        placeholder="Takip no"
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                      />
                      <select
                        value={carrier[j.id] ?? ""}
                        onChange={(e) => setCarrier((s) => ({ ...s, [j.id]: e.target.value }))}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                      >
                        <option value="">Kargo firması</option>
                        {CARRIERS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => ship(j.id)}
                        disabled={busy !== null || j.modelAck.pending}
                        className="px-4 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Kargola
                      </button>
                    </div>
                  )}
                  {j.painterStatus === "shipped" && (
                    <span className="text-sm text-gray-400">Tamamlandı</span>
                  )}
                </div>
              )}

              {/* Üretici panelindeki "İşlem geçmişi" kartının boyacı karşılığı:
                  yöneticinin boyacı adına yaptığı adımların görünür olduğu tek
                  yer. */}
              <JobTimeline actions={j.actions} locale={locale} />

              {/* Boyacının yöneticiye ulaşacak tek kanalı buydu eksik: hasarlı
                  parça, eksik bilgi ya da renk sorusu artık iş kartından
                  yazılıyor. */}
              <JobChat orderId={j.id} unreadCount={j.adminUnreadCount} />
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <Link
              href={`/painter/jobs?${filterStatus ? `status=${filterStatus}&` : ""}page=${page - 1}`}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
            >
              Önceki
            </Link>
          )}
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/painter/jobs?${filterStatus ? `status=${filterStatus}&` : ""}page=${page + 1}`}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
            >
              Sonraki
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * İş kartındaki işlem geçmişi (painter_actions).
 *
 * KAPALI başlar: iş listesinde 20 kart olabiliyor ve her birinin geçmişi
 * kartı uzatırdı. Başlık her zaman görünür; yönetici adına yapılmış adım
 * varsa başlıkta sayısıyla birlikte bir rozet durur, böylece boyacı paneli
 * açmadan da "burada benim yapmadığım bir şey olmuş" diyebilir.
 */
function JobTimeline({
  actions,
  locale,
}: {
  actions: Job["actions"];
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const adminCount = actions.filter((a) => a.byAdmin).length;

  return (
    <div className="mt-3 rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-gray-600 hover:bg-gray-50"
      >
        <span>İşlem geçmişi{actions.length > 0 ? ` (${actions.length})` : ""}</span>
        <span className="flex items-center gap-2">
          {adminCount > 0 && !open && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
              {adminCount} yönetici işlemi
            </span>
          )}
          <span className="text-gray-400">{open ? "Kapat" : "Aç"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-3">
          {actions.length === 0 ? (
            <p className="text-xs text-gray-400">Bu işte henüz kayıtlı işlem yok.</p>
          ) : (
            <div className="relative">
              {actions.map((a, i) => (
                <div key={a.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                        PAINTER_ACTION_DOTS[a.action] ?? "bg-gray-400"
                      }`}
                    />
                    {i < actions.length - 1 && (
                      <div className="my-1 w-px flex-1 bg-gray-200" />
                    )}
                  </div>
                  <div className="min-w-0 pb-3">
                    <p className="text-xs font-semibold leading-tight text-gray-900">
                      {PAINTER_ACTION_LABELS[a.action] ?? a.action.replace(/_/g, " ")}
                    </p>
                    {a.byAdmin && (
                      <p className="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        Yönetici sizin adınıza yaptı
                      </p>
                    )}
                    {a.notes && (
                      <p className="mt-0.5 break-words text-[11px] text-gray-500">{a.notes}</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {formatDateTime(a.createdAt, locale)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
