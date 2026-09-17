"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormField, Input, Select } from "@/components/ui";
import {
  WORKSHOP_SESSION_STATUS_LABELS,
  WORKSHOP_PARTICIPANT_STATUS_LABELS,
  WORKSHOP_CANCEL_SHIPPED_STATUSES,
  assessSessionRisk,
  sessionCancellable,
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
 * Parti kargo bilgisi düzeltme ucunun raporu.
 *
 * `untouched`: partide sevk edilmiş ama DÜZELTİLEN kaydı taşımayan sipariş
 * sayısı — kısmi sevkte önceki konsinye kendi takip numarasını korur. Sessizce
 * atlanırsa admin hepsini düzelttiğini sanır.
 */
interface BatchCorrectionResult {
  changed: string[];
  corrected: number;
  untouched: number;
  customersNotified: boolean;
}

/**
 * Seans iptal ucunun raporu. `alreadyShipped` ve `failed` boş DEĞİLSE bu
 * ekranda uyarı olarak durur: sessizce yutulan bir iade, geri ödenmemiş
 * müşteri parası demektir.
 */
interface CancelReport {
  refunded: string[];
  alreadyRefunded: string[];
  alreadyShipped: string[];
  failed: string[];
  /**
   * PayTR'de ELLE yapılacak iadelerin iş listesi (isim + sipariş no + tutar).
   * Bu kod tabanında PayTR iade API'si yok: `refundOrder` defteri yazıp
   * müşteriye "iadeniz işleme alındı" der, parayı gerçekten gönderen adım
   * admin'in panelde yaptığı işlemdir. Yirmi kişilik bir seansta bu yükümlülük
   * ekrandan KOPYALANABİLİR biçimde çıkmalı, yoksa kimse listeyi tutamaz.
   */
  refundedOrders: Array<{ fullName: string; orderNumber: string; amountKurus: number }>;
}

/**
 * Seans detayında toplu devir için seçilebilecek üretici.
 *
 * Sıralama alanları (rank/skor/yük) sunucuda, CANLI atamanın sıralayıcısıyla
 * hesaplanır; burada yalnız gösterilir ve kutuyu ön seçer. Sıralamaya hiç
 * girmemiş bir atölyede bu alanlar `null`'dur — "0" DEĞİL: bilinmeyen bir yükü
 * sıfır göstermek, kapasitesi dolu bir atölyeyi boş gibi okuturdu.
 */
interface ManufacturerOption {
  id: string;
  companyName: string;
  acceptingOrders: boolean;
  city: string | null;
  /** Sıralamadaki sırası (1 = en uygun); sıralamaya girmediyse null. */
  rank: number | null;
  totalScore: number | null;
  eligible: boolean;
  ineligibleReason: string | null;
  /** Ağırlıklı yük birimi; yalnız canlı sinyal açıkken kapıdır (ortak ölçüdeki `loadUnits`). */
  currentLoad: number | null;
  maxConcurrentOrders: number | null;
  /**
   * Ağırlıklı eşiğin boolean cevabı (`manufacturerHasRoom`), sunucudan HAZIR gelir —
   * istemci ortak kapasite modülünü (manufacturer-capacity.ts) import edemez,
   * `pg`yi paketine sürüklerdi. Yük okunamadıysa null: "bilinmiyor", yani
   * "dolu değil" DEĞİL.
   */
  hasRoom: boolean | null;
  /** Ortak yük etiketi: "6/5 birim · 2 iş"; okunamadıysa null. */
  loadLabel: string | null;
  /** Son işlerdeki ortalama atama→baskı süresi (gün); okunamadıysa null. */
  avgPrintDays: number | null;
  reasons: string[];
}

/** Seans iptal ucunun makine okunur hata kodları → admin'e Türkçe karşılık. */
const SESSION_CANCEL_ERRORS: Record<string, string> = {
  not_found: "Seans bulunamadı.",
  not_cancellable:
    "Parti mekana teslim edilmiş; bu seans artık iptal edilemez. Tek tek iade gerekiyorsa siparişlerin kendi iade ekranını kullanın.",
};

/** Katılımcı iptal ucunun makine okunur hata kodları → admin'e Türkçe karşılık. */
const PARTICIPANT_CANCEL_ERRORS: Record<string, string> = {
  not_found: "Katılımcı bulunamadı.",
  already_shipped:
    "Bu katılımcının figürü sevk edilmiş; otomatik iade edilmez. Normal iade ekranından tek tek halledin.",
  refund_failed:
    "İade işlenemedi — katılımcı İPTAL EDİLMEDİ. Tekrar deneyin ya da normal iade ekranını kullanın.",
  expire_failed:
    "Ödeme taslağı sonlandırılamadı — katılımcı İPTAL EDİLMEDİ (ödemesi hâlâ tamamlanabilirdi). Tekrar deneyin.",
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
  manufacturerOptions,
  weightedLoadLive,
  suggestionBasedOnOrderNumber,
}: {
  session: SessionData;
  participants: ParticipantRow[];
  readyCount: number;
  totalCount: number;
  missingNames: string[];
  netTotalKurus: number | null;
  daysUntilSession: number;
  /**
   * BOŞ DEĞİLSE bu seans üreticisiz kapanmıştır ve toplu devir kartı gösterilir.
   * Kararı sunucu verir (bkz. page.tsx `needsManufacturerPick`): liste yalnızca
   * gerçekten gerektiğinde yüklenir, istemci ayrıca durum yorumlamaz.
   */
  manufacturerOptions: ManufacturerOption[];
  weightedLoadLive: boolean;
  /**
   * Sıralamanın hangi parti siparişine bakarak hesaplandığı. Mesafe skoru o
   * siparişin teslimat adresinden geliyor; yazmazsak skorun neye göre çıktığı
   * okunamaz. Parti boşsa (ya da siparişler okunamadıysa) null.
   */
  suggestionBasedOnOrderNumber: string | null;
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
  // Katılım durumu (taslak ↔ açık) kendi hata alanını taşır: admin hatayı
  // bastığı butonun yanında görmeli.
  const [statusError, setStatusError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ─── Toplu sevk formu ───────────────────────────────────────────────────
  const [carrier, setCarrier] = useState("yurtici");
  const [trackingNumber, setTrackingNumber] = useState("");

  // ─── Yapılmış sevkiyatın kargo bilgisi düzeltmesi ───────────────────────
  //
  // Atölye siparişinin kargosu TEK TEK düzeltilemez: siparişin kendi ucu
  // (PATCH /api/admin/orders/[id]/ship), kargo geri alma ve üreticinin kendi
  // kargo ucu atölye siparişini reddeder, çünkü takip numarası siparişin değil
  // PARTİNİN kaydıdır. O kapılar konduğunda düzeltmenin yapılabileceği hiçbir
  // yer kalmamıştı — her ret "parti sevkiyatı üzerinden düzeltin" diyordu ama
  // partiyi yazan bu ekran onu yalnızca gösteriyordu. Düzeltme, kaydın
  // yaşadığı yerde: burada.
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctCarrier, setCorrectCarrier] = useState(session.batchCarrier ?? "yurtici");
  const [correctTracking, setCorrectTracking] = useState(session.batchTrackingNumber ?? "");
  // Müşteriye haber verme KARARI admin'indir ve varsayılan HAYIR: katılımcı
  // figürünü kargodan değil seansta mekandan alır ve ona hiç takip numarası
  // gönderilmemiştir.
  const [correctNotify, setCorrectNotify] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [correctResult, setCorrectResult] = useState<BatchCorrectionResult | null>(null);

  // ─── Üretici devri (üreticisiz kapanmış parti) ──────────────────────────
  //
  // KUTU ÖN SEÇİLİ AÇILIR: sıralamanın en uygun bulduğu atölye hazır gelir,
  // admin boş bir listeye bakıp "hangi atölye?" diye düşünmesin. Yalnız ilk
  // render'da kurulur (lazy initializer), sonrasında admin'in seçimi kazanır.
  //
  // ÖN SEÇİM BİR ATAMA DEĞİLDİR: atölye seansı hiçbir zaman otomatik atanmaz
  // (sahibin kararı — parti bir TARİHE taahhütlü). Partiyi devreden şey aşağıdaki
  // düğme ve onun onay kutusudur.
  //
  // Yalnız canlı ağırlıklı kapasite doluysa ön seçimden çıkarılır.
  // Gölge ve okunamayan yük, canlı sıralamanın önerisini değiştirmez.
  const [assignManufacturerId, setAssignManufacturerId] = useState(
    () => manufacturerOptions.find((m) => m.eligible && (!weightedLoadLive || m.hasRoom !== false))?.id ?? ""
  );

  const selectedManufacturer =
    manufacturerOptions.find((m) => m.id === assignManufacturerId) ?? null;
  /**
   * Seçilen atölye bu tarihe yetişir mi?
   *
   * Kural SAF ve DB'siz (config/workshop.ts · assessSessionRisk) ve mekân
   * ekranındakiyle AYNI fonksiyondur — ikinci bir risk ölçüsü yazılmaz.
   * Girdilerden biri bilinmiyorsa (atölye sıralamaya girmemiş ya da baskı
   * geçmişi okunamamış) uyarı GÖSTERİLMEZ: eksik veriyle "yetişir" demek,
   * partiyi zamanında teslim edilecek sanmak olurdu.
   */
  const assignRisk =
    selectedManufacturer &&
    selectedManufacturer.avgPrintDays !== null &&
    selectedManufacturer.currentLoad !== null &&
    selectedManufacturer.maxConcurrentOrders !== null &&
    selectedManufacturer.hasRoom !== null &&
    selectedManufacturer.loadLabel !== null
      ? assessSessionRisk({
          daysUntilSession,
          avgPrintDays: selectedManufacturer.avgPrintDays,
          currentLoad: selectedManufacturer.currentLoad,
          maxConcurrentOrders: selectedManufacturer.maxConcurrentOrders,
          capacity: {
            hasRoom: selectedManufacturer.hasRoom,
            loadLabel: selectedManufacturer.loadLabel,
            // Toplu devir yalnız canlı ağırlıklı kapasite açıkken engellenir.
            whenFull: weightedLoadLive ? "blocked" : "shadow",
          },
        })
      : null;

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
  // Teslim edilmiş/tamamlanmış seansta iptal anlamsız (parti mekanda, hakediş
  // tahakkuk etti). Kural `sessionCancellable`dan OKUNUR, burada tekrar
  // yazılmaz: uç da aynı fonksiyonu çağırıyor, böylece buton ile 409 asla
  // ayrışamaz. Zaten `cancelled` seansta buton DURUR: uç aynı zamanda
  // başarısız çıkışların yeniden deneme yoludur.
  const canCancelSession = sessionCancellable(session.status);
  const isCancelled = session.status === "cancelled";

  // Katılım anahtarı. `createSession` her seansı `draft` yazar; `open`ı yazan
  // TEK yer PATCH ucudur, yani bu iki buton olmadan seans hiç açılamaz.
  // Kapanmış/iptal edilmiş seansta anlamsız: kartı hiç göstermiyoruz, uç da
  // aynı geçişleri zaten reddeder (fiyatlanmış seans yeniden açılamaz).
  const canOpen = session.status === "draft";
  const canDraft = session.status === "open";

  /**
   * Seansın katılım durumunu değiştirir (`draft` ↔ `open`).
   *
   * Bu, akışın AÇMA anahtarıdır: `createSession` her seansı `draft` yazar ve
   * `open`ı yazan tek yer bu PATCH ucudur. Buton olmadığında seans hiç
   * açılamıyordu — katılım sayfası "katılıma kapalı" diyor, koltuk rezerve
   * edilemiyor, kapanış süpürmesi (yalnızca `open` seansları tarar) seansı hiç
   * görmüyor ve üreticiye giden 5 günlük taahhüt çağrısı hiç gitmiyordu.
   *
   * Uç zaten üç kapıyı taşıyor (fiyatlanmış seans yeniden açılamaz, siparişli
   * seans taslağa çekilemez, kapanış seans tarihinin ötesine taşınamaz) ve
   * gerekçeli TÜRKÇE metin döndürüyor — burada yeniden yazılmaz, olduğu gibi
   * gösterilir. Ship/cancel handler'larıyla aynı kalıp: ağ hatası ayrı dalda.
   */
  const submitStatus = async (status: "open" | "draft") => {
    if (
      status === "draft" &&
      !confirm(
        "Seans taslağa çekilsin mi? Katılım linki kapanır ve yeni kimse " +
          "katılamaz. (Ödenmiş siparişi olan seans taslağa çekilemez.)"
      )
    )
      return;
    setStatusError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workshops/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatusError(
          payload.error ||
            (status === "open" ? "Seans katılıma açılamadı." : "Seans taslağa çekilemedi.")
        );
        return;
      }
      router.refresh();
    } catch {
      setStatusError("Ağ hatası — bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  /** Üreticisiz kapanmış partiyi topluca bir üreticiye devreder. */
  const submitAssignManufacturer = async () => {
    if (!assignManufacturerId) {
      setAssignError("Bir üretici seçin.");
      return;
    }
    const picked = manufacturerOptions.find((m) => m.id === assignManufacturerId);
    if (
      !confirm(
        `Bu seansın tüm partisi ${picked?.companyName ?? "seçilen üretici"} üzerine ` +
          "aktarılsın mı? Siparişler doğrudan \"kabul edildi\" olarak düşer ve " +
          "üreticiye bildirim gider."
      )
    )
      return;
    setAssignError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/workshops/sessions/${session.id}/assign-manufacturer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manufacturerId: assignManufacturerId }),
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAssignError(payload.error || "Üretici atanamadı.");
        return;
      }
      router.refresh();
    } catch {
      setAssignError("Ağ hatası — bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

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

  /**
   * Yapılmış parti sevkiyatının firmasını/takip numarasını düzeltir.
   *
   * Gönderilen alanlar sunucuda mevcut kayıtla kıyaslanır; değişen yoksa uç
   * hiçbir şey yazmaz. Sipariş aşaması ve para DEĞİŞMEZ — bu bir hareket değil,
   * yanlış yazılmış bir numaranın düzeltilmesidir.
   */
  const submitShipCorrection = async () => {
    setCorrectError(null);
    const tracking = correctTracking.trim();
    if (correctCarrier !== "elden" && !tracking) {
      setCorrectError("Kargoyla sevkte takip numarası zorunludur.");
      return;
    }
    if (
      correctNotify &&
      !confirm(
        "Düzeltme katılımcılara bildirilsin mi?\n\n" +
          "Katılımcı figürünü seansta MEKANDAN alır ve kendisine hiç takip " +
          "numarası gönderilmedi; bildirim yalnızca gerçekten kargoyla giden " +
          "bir partide anlamlıdır."
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workshop-sessions/${session.id}/batch-shipping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier: correctCarrier,
          // "elden"de numara anlamsız; uç da onu temizler.
          trackingNumber: correctCarrier === "elden" ? "" : tracking,
          notifyCustomers: correctNotify,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCorrectError(payload.error || "Kargo bilgisi düzeltilemedi.");
        return;
      }
      setCorrectResult({
        changed: Array.isArray(payload.changed) ? payload.changed : [],
        corrected: Number(payload.corrected) || 0,
        untouched: Number(payload.untouched) || 0,
        customersNotified: payload.customersNotified === true,
      });
      setCorrectOpen(false);
      router.refresh();
    } catch {
      setCorrectError("Ağ hatası — bağlantınızı kontrol edip tekrar deneyin.");
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
          : "Seans iptal edilsin mi?\n\n" +
              "• Ödemiş katılımcılara \"iadeniz işleme alındı\" e-postası GİDER.\n" +
              "• Parayı PayTR panelinden GERİ GÖNDERMEK SİZE DÜŞER — bu ekran " +
              "iade emrini PayTR'ye iletmez.\n" +
              "• İşlem sonunda iade edilecek kişilerin listesi (sipariş no + " +
              "tutar) burada gösterilir; kopyalayıp PayTR'de tek tek işleyin.\n\n" +
              "Bu işlem geri alınamaz. Devam edilsin mi?"
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
        setCancelError(
          SESSION_CANCEL_ERRORS[payload.error] ||
            payload.error ||
            "Seans iptali başarısız."
        );
        return;
      }
      setCopied(false);
      setCancelReport({
        refunded: Array.isArray(payload.refunded) ? payload.refunded : [],
        alreadyRefunded: Array.isArray(payload.alreadyRefunded)
          ? payload.alreadyRefunded
          : [],
        alreadyShipped: Array.isArray(payload.alreadyShipped) ? payload.alreadyShipped : [],
        failed: Array.isArray(payload.failed) ? payload.failed : [],
        refundedOrders: Array.isArray(payload.refundedOrders)
          ? payload.refundedOrders
          : [],
      });
      router.refresh();
    } catch {
      setCancelError("Ağ hatası — bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * PayTR'de elle işlenecek iadelerin toplamı — admin'in üstlendiği
   * yükümlülüğün büyüklüğü ekranda bir sayı olarak durmalı.
   */
  const refundObligationKurus = (cancelReport?.refundedOrders ?? []).reduce(
    (sum, r) => sum + r.amountKurus,
    0
  );

  /**
   * İade iş listesini panoya kopyalar. Yükümlülük ekrandan ÇIKMALI: sayfa
   * yenilendiğinde bu rapor kaybolur (client state) ve geriye yalnızca
   * "iadeniz işleme alındı" e-postasını almış N kişi kalır.
   */
  const copyRefundWorklist = async () => {
    const rows = cancelReport?.refundedOrders ?? [];
    if (rows.length === 0) return;
    const text = [
      `Atölye seansı iptali — PayTR'de elle iade edilecekler (${session.venueName}, ${formatDateTime(session.startsAt)})`,
      ...rows.map((r) => `${r.orderNumber}\t${r.fullName}\t${formatKurus(r.amountKurus)}`),
      `TOPLAM\t${rows.length} iade\t${formatKurus(refundObligationKurus)}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Pano izni yoksa (ya da güvensiz bağlamda) sessiz kalmak yerine
      // listeyi zaten ekranda gösteriyoruz; buton "kopyalandı" demez.
      setCopied(false);
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

      {/* Katılım durumu — seansın AÇMA anahtarı */}
      {(canOpen || canDraft) && (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Katılım</h3>
          <p className="text-xs text-gray-500 mb-3">
            {session.status === "draft" ? (
              <>
                Seans <strong>taslak</strong>: katılım linki &quot;katılıma
                kapalı&quot; gösterir, kimse koltuk alamaz ve kapanış süpürmesi bu
                seansı hiç görmez. Katılıma açıldığında üreticiye tarih taahhüdü
                çağrısı gider. Katılım {formatDateTime(session.joinClosesAt)}{" "}
                tarihinde otomatik kapanır.
              </>
            ) : (
              <>
                Seans <strong>katılıma açık</strong>: {session.bookedCount}/
                {session.capacity} koltuk dolu. Katılım{" "}
                {formatDateTime(session.joinClosesAt)} tarihinde otomatik kapanır
                ve parti üreticiye düşer.
              </>
            )}
          </p>
          {statusError && <p className="text-xs text-red-600 mb-2">{statusError}</p>}
          <div className="flex flex-wrap gap-2">
            {canOpen && (
              <button
                type="button"
                onClick={() => submitStatus("open")}
                disabled={busy}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? "İşleniyor…" : "Katılıma aç"}
              </button>
            )}
            {canDraft && (
              <button
                type="button"
                onClick={() => submitStatus("draft")}
                disabled={busy}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {busy ? "İşleniyor…" : "Taslağa çek"}
              </button>
            )}
          </div>
          {canOpen && !session.manufacturerName && (
            <p className="mt-2 text-xs text-amber-700">
              Bu seansta üretici seçilmemiş; katılıma açmadan önce mekan
              ekranından bir üretici atayın — parti kapanışta ona düşecek.
            </p>
          )}
        </div>
      )}

      {/* Üreticisiz kapanmış parti — kurtarma yolu */}
      {manufacturerOptions.length > 0 && (
        <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50/60 p-5">
          <h3 className="text-sm font-semibold text-amber-900 mb-1">
            Bu partinin üreticisi yok
          </h3>
          <p className="text-xs text-amber-800/90 mb-3">
            Seans kapandı ve komisyon oranı donduruldu, ama parti hiçbir
            üreticiye düşmedi — kimse basmıyor. Bir üretici seçin: seansın tüm
            partisi ona aktarılır, siparişler &quot;kabul edildi&quot; olarak
            panelinde belirir ve donmuş oranla bildirim gider. Oran DEĞİŞMEZ.
          </p>
          {assignError && <p className="text-xs text-red-600 mb-2">{assignError}</p>}

          {/* Sıralı öneri: KARAR değil, hazırlık. Partiyi devreden şey aşağıdaki
              düğmedir — atölye seansı hiçbir zaman otomatik atanmaz. */}
          <div className="mb-3 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-xs text-amber-900">
            <p className="font-semibold">Sıralama önerisi — onay sizde</p>
            <ol className="mt-1 space-y-0.5">
              {manufacturerOptions
                .filter((m) => m.eligible)
                .slice(0, 3)
                .map((m) => (
                  <li key={m.id}>
                    {m.rank}. {m.companyName}
                    {m.city ? ` · ${m.city}` : ""}
                    {m.totalScore !== null ? ` · skor ${m.totalScore}` : ""}
                    {/* Yük, devir ucunun uyguladığı ÖLÇÜYLE yazılır; burada
                        sıralayıcının ham iş sayısı duruyordu. */}
                    {m.loadLabel ? ` · ${m.loadLabel}` : ""}
                    {weightedLoadLive && m.hasRoom === false ? " · TEZGÂH DOLU" : ""}
                    {m.id === assignManufacturerId ? " — seçili" : ""}
                  </li>
                ))}
              {manufacturerOptions.filter((m) => m.eligible).length === 0 && (
                <li>
                  Sıralama uygun aday bulamadı; liste alfabetik duruyor. Seçimi
                  kendiniz yapın.
                </li>
              )}
            </ol>
            <p className="mt-1 text-amber-900/80">
              {suggestionBasedOnOrderNumber
                ? `${suggestionBasedOnOrderNumber} numaralı parti siparişinin teslimat adresine göre hesaplandı. `
                : "Partide sipariş okunamadığı için mesafe hesaplanamadı. "}
              Atölye seansı hiçbir zaman otomatik atanmaz: parti bir tarihe
              taahhütlü olduğu için son sözü siz verirsiniz.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <FormField label="Üretici">
              <Select
                value={assignManufacturerId}
                onChange={(e) => setAssignManufacturerId(e.target.value)}
              >
                <option value="">— Seçilmedi —</option>
                {manufacturerOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.rank !== null ? `${m.rank}. ` : ""}
                    {m.companyName}
                    {m.totalScore !== null ? ` · skor ${m.totalScore}` : ""}
                    {m.loadLabel ? ` · ${m.loadLabel}` : ""}
                    {/* Uç yalnız canlı sinyal açıkken kapasiteden reddeder. */}
                    {weightedLoadLive && m.hasRoom === false ? " — TEZGÂH DOLU, devir reddedilir" : ""}
                    {!m.acceptingOrders ? " — sipariş almıyor" : ""}
                    {!m.eligible && m.ineligibleReason
                      ? ` — sıralamada uygun değil: ${m.ineligibleReason}`
                      : ""}
                  </option>
                ))}
              </Select>
            </FormField>
            <button
              type="button"
              onClick={submitAssignManufacturer}
              disabled={busy || !assignManufacturerId}
              className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? "Atanıyor…" : "Partiyi bu üreticiye ver"}
            </button>
          </div>

          {/* Yetişme uyarısı ENGELLEMEZ: admin bilerek riskli bir devir
              yapabilir (atölyeyle telefonda anlaşmış olabilir). Girdisi
              eksikse hiç gösterilmez — bkz. assignRisk. */}
          {assignRisk && (
            <p
              className={`mt-2 text-xs ${
                assignRisk.level === "danger"
                  ? "font-semibold text-red-700"
                  : assignRisk.level === "warn"
                    ? "text-amber-800"
                    : "text-emerald-700"
              }`}
            >
              {selectedManufacturer?.companyName}: {assignRisk.message}
            </p>
          )}
        </div>
      )}

      {/* Toplu sevk / teslim */}
      {/* id: atölye siparişinin kendi ekranı kargo düzeltmesini reddederken
          buraya bağlanır (#parti-sevkiyati) — yönergeyi tekrar etmek yerine işi
          yapabilen bölümü açar. scroll-mt, çıpayla gelindiğinde başlığın yapışkan
          üst çubuğun altında kalmamasını sağlar. */}
      <div id="parti-sevkiyati" className="mt-6 scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Sevkiyat</h3>

        {session.batchShippedAt && (
          <>
            <p className="text-sm text-gray-700 mb-2">
              Sevk edildi: {formatDateTime(session.batchShippedAt)} ·{" "}
              {session.batchCarrier ? CARRIER_LABELS[session.batchCarrier] ?? session.batchCarrier : "—"}
              {session.batchTrackingNumber ? ` · Takip: ${session.batchTrackingNumber}` : ""}
              {!correctOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setCorrectCarrier(session.batchCarrier ?? "yurtici");
                    setCorrectTracking(session.batchTrackingNumber ?? "");
                    setCorrectNotify(false);
                    setCorrectError(null);
                    setCorrectResult(null);
                    setCorrectOpen(true);
                  }}
                  className="ml-2 text-xs font-medium text-blue-600 hover:text-blue-800"
                >
                  Düzelt
                </button>
              )}
            </p>

            {correctResult && (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                <p className="font-medium">
                  {correctResult.changed.length > 0
                    ? `Parti kargo bilgisi düzeltildi (${correctResult.changed.join(", ")}).`
                    : "Değişen bir bilgi yoktu."}
                </p>
                <p className="mt-0.5">
                  {correctResult.corrected} siparişin kaydı güncellendi.
                  {/* Eski metin "onları kendi sevkiyatları üzerinden düzeltin"
                      diyordu; böyle bir yol YOK: atölye siparişinin kargosu
                      tek tek düzeltilemez (siparişin kendi ucu da, geri alma da,
                      üreticinin ucu da reddeder). Ekran olmayan bir ekrana
                      yollamaz; ne olduğunu söyler. */}
                  {correctResult.untouched > 0
                    ? ` ${correctResult.untouched} sipariş bu kaydı taşımıyordu (önceki konsinye) ve dokunulmadı: onlar kendi konsinyelerinin takip numarasını taşımaya devam eder. Bu düzeltme yalnızca yukarıdaki parti kaydını taşıyan siparişleri kapsar.`
                    : ""}
                </p>
                <p className="mt-0.5">
                  {correctResult.customersNotified
                    ? "Katılımcılara bildirim gönderildi."
                    : "Katılımcılara bildirim gönderilmedi."}
                </p>
              </div>
            )}

            {correctOpen && (
              <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                <p className="mb-2 text-xs text-blue-900">
                  Yanlış girilmiş takip numarası ya da firma buradan düzeltilir. Parti kaydı ve
                  AYNI kaydı taşıyan siparişler birlikte güncellenir; siparişlerin aşaması,
                  durumu ve hakedişler değişmez. İşlem her siparişin denetim kaydına yazılır.
                  İade edilmiş siparişler partinin dışındadır: kayıtları olduğu gibi kalır ve
                  aşağıdaki sayılara girmez.
                </p>
                {correctError && <p className="mb-2 text-xs text-red-600">{correctError}</p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr] sm:items-end">
                  <FormField label="Kargo">
                    <Select
                      value={correctCarrier}
                      onChange={(e) => setCorrectCarrier(e.target.value)}
                    >
                      {Object.entries(CARRIER_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField
                    label={`Takip numarası${correctCarrier === "elden" ? " (gerekmez)" : ""}`}
                  >
                    <Input
                      value={correctTracking}
                      onChange={(e) => setCorrectTracking(e.target.value)}
                      disabled={correctCarrier === "elden"}
                      placeholder={
                        correctCarrier === "elden"
                          ? "Elden teslimde gerekmez"
                          : "Takip numarası"
                      }
                    />
                  </FormField>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-blue-900">
                  <input
                    type="checkbox"
                    checked={correctNotify}
                    onChange={(e) => setCorrectNotify(e.target.checked)}
                  />
                  Katılımcılara güncel sevkiyat bilgisini bildir (varsayılan: bildirme —
                  figürler seansta mekanda teslim edilir)
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={submitShipCorrection}
                    disabled={busy}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy ? "Kaydediliyor…" : "Kargo bilgisini düzelt"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCorrectOpen(false);
                      setCorrectError(null);
                    }}
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
          </>
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
          <p className="text-xs text-gray-500 mb-2">
            Ödemiş katılımcıların siparişi iade işaretlenir, ödemeye hiç
            gelmemişler iptal edilir ve seans &quot;İptal edildi&quot; olur.
            Figürü zaten sevk edilmiş katılımcılar otomatik iade EDİLMEZ —
            aşağıda isimle raporlanır, onları normal iade ekranından tek tek
            halledin.
          </p>
          {/* Bu uyarı süs değil: kod tabanında PayTR iade API'si YOK. */}
          <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>Para PayTR&apos;den otomatik geri gitmez.</strong> Bu işlem
            siparişleri iade olarak kaydeder ve katılımcılara &quot;iadeniz
            işleme alındı&quot; e-postası gönderir; parayı geri gönderme adımı
            PayTR panelinde SİZİN yapacağınız işlemdir. Bir seansın toplu
            iptali, kişi başı {formatKurus(session.pricePerSeatKurus)} olmak
            üzere aynı anda birden çok iade yükümlülüğü doğurur — aşağıdaki
            listeyi kopyalayıp PayTR&apos;de tek tek işleyin.
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
                    {cancelReport.refunded.length} katılımcının iadesi işleme alındı
                    {refundObligationKurus > 0
                      ? ` — PayTR'de iade edilecek toplam ${formatKurus(refundObligationKurus)}:`
                      : ":"}
                  </p>
                  {/* İş listesi: PayTR'de aranacak şey İSİM değil sipariş
                      numarasıdır, o yüzden satır satır ve kopyalanabilir. */}
                  {cancelReport.refundedOrders.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                      {cancelReport.refundedOrders.map((r) => (
                        <li key={r.orderNumber}>
                          {r.orderNumber} · {r.fullName} · {formatKurus(r.amountKurus)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-0.5">{cancelReport.refunded.join(", ")}</p>
                  )}
                  {cancelReport.refundedOrders.length > 0 && (
                    <button
                      type="button"
                      onClick={copyRefundWorklist}
                      className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      {copied ? "Kopyalandı ✓" : "İade listesini kopyala"}
                    </button>
                  )}
                </div>
              )}
              {cancelReport.alreadyRefunded.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700">
                  <p className="font-medium">
                    {cancelReport.alreadyRefunded.length} katılımcının parası zaten
                    DAHA ÖNCE iade edilmişti:
                  </p>
                  <p className="mt-0.5">{cancelReport.alreadyRefunded.join(", ")}</p>
                  <p className="mt-0.5 text-gray-500">
                    Bu çağrıda yeni bir para hareketi olmadı; yalnızca katılımları
                    kapatıldı.
                  </p>
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
                    {cancelReport.failed.length} katılımcının çıkışı BAŞARISIZ — parası
                    hâlâ bizde (ya da ödemesi hâlâ tamamlanabilir):
                  </p>
                  <p className="mt-0.5">{cancelReport.failed.join(", ")}</p>
                  <p className="mt-0.5 text-red-700/80">
                    Bu kişiler iptal edilmedi. &quot;Başarısız iadeleri tekrar
                    dene&quot; ile yalnızca onlar yeniden denenir.
                  </p>
                </div>
              )}
              {cancelReport.refunded.length === 0 &&
                cancelReport.alreadyRefunded.length === 0 &&
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
