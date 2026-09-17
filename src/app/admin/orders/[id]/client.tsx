"use client";

import { OrderMoneySplitEditor } from "@/components/admin/order-money-split-editor";
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ModelViewer } from "@/components/model-viewer";
import { OrderChat } from "@/components/order-chat";
import { PhoneInput, phoneInputToE164, e164ToPhoneInput } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, formatPhoneDisplay, type CountryCode } from "@/lib/phone";

import { useDictionary } from "@/lib/i18n/locale-context";
import { manufacturerBaseKurus, carvePaintingShare } from "@/lib/services/earning-base";
import {
  SIZE_PRESETS_CM,
  SIZE_TEXT_MAX,
  normalizeSizeInput,
  sizeDisplay,
  sizeDisplayTr,
} from "@/lib/config/sizes";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import { MESSAGE_TEMPLATES } from "@/lib/config/message-templates";
import { OrderModelUploader } from "@/components/admin/order-model-uploader";
import { formatModelSize } from "@/lib/config/order-model";
import { parseTryToKurus } from "@/lib/config/cost-lines";
import { currentModelUrl } from "@/lib/config/order-model-presence";
import { REJECTABLE_STATUSES, isRefunded } from "@/lib/config/order-status-policy";
// Kolinin yolda olup olmadığını söyleyen ÖLÇÜ uçlarla AYNI satırdan gelir
// (assign-painter, swap-painter, send-to-painter ve otomatik yollar da bunu
// çağırıyor). Ekran kendi kuralını kurarsa panel "gerek yok" derken uç 409
// döndürür — bu kartın kapattığı kusur tam olarak buydu. flags.ts saf modüldür
// (db yok, "server-only" yok), bu yüzden istemci bileşeni onu import edebilir.
import { painterParcelOnTheWay } from "@/lib/config/flags";
import type {
  ModelUploadSideEffects,
  ModelUploadStage,
  QcRoundProof,
  QcRoundProofFailure,
} from "@/lib/config/order-model-policy";
// Turun neden onaylanamadığını anlatan CÜMLELER ekranda uydurulmaz: uç hangi
// cümleyi 409 gövdesinde döndürüyorsa kart da onu gösterir. Saf modül (db yok,
// "server-only" yok), bu yüzden istemci bileşeni onu import edebilir.
import {
  QC_PROOF_FAILURE_LABEL_TR,
  qcRoundProofErrorTr,
} from "@/lib/config/order-model-policy";
// Eski sürümün baskısını bilerek onaylama kapısının sabitleri. Saf modül
// (db yok, "server-only" yok), bu yüzden istemci bileşeni sunucunun KENDİ
// eşiğini ve KENDİ cümlesini kullanır; iki taraf ayrışamaz.
import {
  PARTNER_MODEL_ACK_ACTION,
  PARTNER_MODEL_REVISION_ACTION,
  STALE_QC_OVERRIDE_REASON_ERROR,
  STALE_QC_OVERRIDE_REASON_MIN,
  staleQcRevisionErrorTr,
} from "@/lib/config/partner-model-ack";
import { CARRIERS, trackingUrl } from "@/lib/services/carriers";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import {
  MONEY_LINE_KIND_LABELS_TR,
  cashCollectedKurus,
  type OrderMoneyBreakdown,
  type MoneyLine,
  type PartyShare,
  type PartnerEarningRow,
} from "@/lib/config/order-money";
import {
  DISTANCE_MODEL_LABELS_TR,
  SCORE_KEYS,
  SCORE_LABELS_TR,
  SCORE_SHORT_LABELS_TR,
  comparisonTitleTr,
  placementDivergence,
  placementLabel,
  sideVersionLabel,
  type EvaluationDecision,
  type EvaluationSide,
  type ScoreKey,
} from "@/app/admin/scoring-evaluations/evaluation-view";
// Boyacı kararının okunuşu: aynı saf modülü sunucu (page.tsx) ve bu bileşen
// birlikte kullanır, yoksa "kim seçildi / kim işi aldı" iki yerde iki ayrı
// biçimde yorumlanırdı.
import {
  PAINTER_SCORE_KEYS,
  PAINTER_SCORE_LABELS_TR,
  PAINTER_SCORE_SHORT_LABELS_TR,
  painterOutcomeReasonLabelTr,
  painterPlacementDivergence,
  painterPlacementLabel,
  painterTriggerLabelTr,
  type PainterEvaluation,
  type PainterScoreKey,
} from "@/app/admin/scoring-evaluations/painter-evaluation-view";

/**
 * Canlı QC turunun KANIT durumu — sayfanın serileştirdiği hâli
 * (src/app/admin/orders/[id]/page.tsx · qcProof).
 */
type QcProofData = {
  failure: QcRoundProofFailure | null;
  oldestStampedRevision: number | null;
  unstampedCount: number;
  photoCount: number;
  currentRevision: number | null;
};

/** Kartın bir turu reddederken söylediği her cümle, TEK sebepten türer. */
type QcProofRefusalView = {
  /** Kırmızı kutu: uçun aynı hâl için döndürdüğü cümlenin ta kendisi. */
  banner: string;
  /** Kapalı onay düğmesinin başlığı (sebebin kısa hâli). */
  gateTitle: string;
  /** Denetimli istisnayı açan bağlantı: NEYİ kabul ettiğini söyler. */
  overrideLink: string;
  /** Onayın ne açtığı + gerekçenin denetim kaydına hangi adla geçeceği. */
  overrideEffect: string;
};

/**
 * Tur neden onaylanamıyor?
 *
 * Kart eskiden dört ayrı hâlin HEPSİNE "GÜNCEL sürümden daha eski bir baskı"
 * diyordu. Damgasız bir tur "eski" DEĞİL "bilinmiyor" demektir; fotoğrafsız
 * turda ortada baskı bile yoktur; sürüm okunamadığında kıyas hiç yapılamamıştır.
 * Ekran ancak kaydın GERÇEKTEN yazdığı sebebi söyleyebilir — yoksa admin'den,
 * verinin doğrulamadığı bir olguyu gerekçeyle imzalaması isteniyordu.
 *
 * Cümleler bu yüzden burada yazılmaz, uçla ORTAK saf modüllerden okunur
 * (qcRoundProofErrorTr · staleQcRevisionErrorTr): ekran ile uç aynı hâle aynı
 * adı verir, ayrışmaları imkânsızdır.
 *
 * Sebep hiç gelmediyse (alan taşımayan eski yük) kart sebep UYDURMAZ: kapının
 * kapalı olduğunu ve sebebi okuyamadığını birlikte söyler.
 */
function qcProofRefusalView(proof: QcProofData | null | undefined): QcProofRefusalView {
  const failure = proof?.failure ?? null;
  const current = proof?.currentRevision ?? null;
  // Gerekçenin nereye, hangi ADLA yazılacağı: denetim kaydındaki etiket ile
  // ekrandaki istisna aynı şeyi anmalı.
  const auditNote = failure
    ? `Gerekçe denetim kaydına [${QC_PROOF_FAILURE_LABEL_TR[failure]}] olarak, QC turu kaydına ve üreticiye giden bildirime aynen yazılır.`
    : "Gerekçe denetim kaydına, QC turu kaydına ve üreticiye giden bildirime aynen yazılır.";
  const accrual = "üreticinin hakedişi tahakkuk eder";
  // Uçun cümle üreticisi tam kanıt nesnesi ister; ekranın elindeki alanlar
  // (sayım + en eski damga) bunun için yeterlidir.
  const asProof = (f: QcRoundProofFailure): QcRoundProof => ({
    proven: false,
    failure: f,
    oldestStampedRevision: proof?.oldestStampedRevision ?? null,
    unstampedCount: proof?.unstampedCount ?? 0,
    photoCount: proof?.photoCount ?? 0,
  });

  switch (failure) {
    case "stale":
      return {
        banner: staleQcRevisionErrorTr(current, proof?.oldestStampedRevision ?? null),
        gateTitle: "Bu tur ESKİ bir sürümün baskısını gösteriyor; onaylanamaz.",
        overrideLink: "Yine de onayla: eski sürümün baskısını gerekçeyle kabul et",
        overrideEffect: `Bu onay ESKİ modelin baskısını kargoya açar ve ${accrual}. ${auditNote}`,
      };
    case "unstamped":
      return {
        banner: qcRoundProofErrorTr(asProof("unstamped"), current),
        gateTitle:
          "Bu turdaki fotoğraflar sürüm damgası taşımıyor; hangi baskı olduğu doğrulanamadan onaylanamaz.",
        overrideLink: "Yine de onayla: sürümü doğrulanamayan baskıyı gerekçeyle kabul et",
        overrideEffect: `Bu onay, hangi sürümün basıldığı DOĞRULANMADAN baskıyı kargoya açar ve ${accrual}. ${auditNote}`,
      };
    case "no_photos":
      return {
        banner: qcRoundProofErrorTr(asProof("no_photos"), current),
        gateTitle: "Bu turda hiç QC fotoğrafı yok; onaylanacak bir kanıt bulunmuyor.",
        overrideLink: "Yine de onayla: fotoğrafsız turu gerekçeyle kabul et",
        overrideEffect: `Bu onay, turun TEK bir QC fotoğrafı olmadan baskıyı kargoya açar ve ${accrual}. ${auditNote}`,
      };
    case "revision_unreadable":
      return {
        banner: qcRoundProofErrorTr(asProof("revision_unreadable"), current),
        gateTitle: "Siparişin güncel model sürümü okunamadı; hangi sürümün basıldığı doğrulanamıyor.",
        overrideLink: "Yine de onayla: sürümü okunamayan turu gerekçeyle kabul et",
        overrideEffect: `Bu onay, güncel sürüm OKUNAMADAN baskıyı kargoya açar ve ${accrual}. ${auditNote}`,
      };
    default:
      // Kapı kapalı ama sebebi bu ekran okuyamadı: ikisi de söylenir, biri
      // diğerinin yerine uydurulmaz.
      return {
        banner:
          "Bu turun GÜNCEL sürümün baskısını gösterdiği doğrulanamadı; tur onaylanamaz. " +
          "Ret sebebi bu ekranda okunamadı (sayfayı yenileyin); yine de onaylayacaksanız " +
          "gerekçe yazarak bilinçli onayı kullanın.",
        gateTitle: "Bu turun güncel sürümün baskısı olduğu doğrulanamadı; onaylanamaz.",
        overrideLink: "Yine de onayla: doğrulanamayan turu gerekçeyle kabul et",
        overrideEffect: `Bu onay, tur DOĞRULANMADAN baskıyı kargoya açar ve ${accrual}. ${auditNote}`,
      };
  }
}

/**
 * Everything the painting leg of an order is doing. Populated only for orders
 * that need painting or already have a painter; an ordinary print job gets an
 * empty shell and the panel stays hidden.
 */
interface PaintingData {
  needsPainting: boolean;
  /** Siparişin toplamı — boyama payı eklerken önizleme için. */
  amountKurus: number;
  /** Boyama kalemi henüz yoksa eklenebilir mi (route ile aynı kural). */
  canAddPainting: boolean;
  addPaintingBlockedReason: string | null;
  paintingPriceKurus: number;
  productionBaseKurus: number | null;
  painterStatus: string | null;
  qcRound: number;
  assignedAt: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  paintedAt: string | null;
  handoffCarrier: string | null;
  handoffTrackingNumber: string | null;
  earning: {
    grossKurus: number;
    netKurus: number;
    commissionKurus: number;
    status: string;
  } | null;
  actions: { id: string; action: string; notes: string | null; createdAt: string }[];
  /** Boyacının işlem günlüğü okunamadı: liste BOŞ değil, BİLİNMİYOR. */
  actionsUnreadable: boolean;
  /** HER turun fotoğrafları; ekran canlı turu ayırır. */
  qcPhotos: {
    id: string;
    url: string;
    reviewStatus: string;
    round: number;
    createdAt: string;
  }[];
  qcReviews: {
    id: string;
    round: number;
    decision: string;
    reason: string | null;
    adminEmail: string;
    createdAt: string;
  }[];
  candidates: {
    id: string;
    companyName: string;
    contactPerson: string | null;
    phone: string | null;
    /**
     * GÖSTERİM: tezgâhtaki ayrı kutu sayısı. KAPI DEĞİLDİR — bir parti işi tek
     * "iş"tir ama tezgâhın tamamını doldurabilir.
     */
    currentLoad: number;
    maxConcurrentOrders: number;
    /** Kapının ölçüsüyle yazılmış tek yük etiketi: "6/2 birim · 1 iş". */
    loadLabel: string;
    acceptingOrders: boolean;
    declined: boolean;
    eligible: boolean;
    /** Sıralayıcının sırası (1 = en iyi); sıralama okunamadıysa null. */
    rank: number | null;
    /** 100 en iyi, 0 en kötü. Sırasızsa null — sıfır DEĞİL. */
    score: number | null;
    /** Skorun bileşenleri: rota, yük, güvenilirlik, QC kalitesi, zamanında. */
    parts: Partial<Record<PainterScoreKey, number>> | null;
    /**
     * KAPI: ağırlıklı yük (sipariş başına 1, parti işlerinde her 20 birim için
     * 1 — capacity-unit kararı). Atama/devir uçlarının kabul-ret ölçüsü BUDUR;
     * `currentLoad` değil. İkisi ayrıştığında ekranın iş sayısını göstermesi,
     * uç reddederken "1/5 iş" okutmak olurdu (ölçüm: P4F-2).
     */
    loadUnits: number | null;
    /** Sıralayıcının insan okuyacağı kısa gerekçeleri. */
    reasons: string[];
    /** Seçilemiyorsa sebebi (Türkçe). */
    ineligibleReason: string | null;
    /** Sıralamanın önerdiği boyacı: kutuda ön seçili gelir. */
    suggested: boolean;
  }[];
  declined: { id: string; companyName: string }[];
}

// Painter-side order states, in the order they actually happen, so the panel
// can render a timeline instead of a bare enum value.
const PAINTER_STEPS: { key: string; label: string }[] = [
  { key: "assigned", label: "Atandı" },
  { key: "accepted", label: "Kabul etti" },
  { key: "painting", label: "Boyuyor" },
  { key: "painted", label: "Boyandı" },
  { key: "qc_pending", label: "QC'de" },
  { key: "qc_approved", label: "QC onaylı" },
  { key: "shipped", label: "Kargolandı" },
];

const PAINTER_STATUS_LABEL: Record<string, string> = {
  unassigned: "Atanmadı",
  assigned: "Atandı, kabul bekleniyor",
  accepted: "Kabul edildi",
  painting: "Boyanıyor",
  painted: "Boyandı",
  qc_pending: "QC onayı bekliyor",
  qc_rejected: "QC reddedildi — yeniden boyuyor",
  qc_approved: "QC onaylandı",
  shipped: "Kargolandı",
};

/**
 * Boyacının HESAP durumu (painters.status) — sipariş içindeki iş durumu
 * (PAINTER_STATUS_LABEL) ile karıştırılmamalı. Kart bunu ham enum olarak
 * basıyordu: admin Türkçe bir kartın ortasında "active" / "suspended" okuyordu.
 */
const PARTNER_ACCOUNT_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Onay bekliyor",
  conditionally_approved: "Şartlı onaylı",
  active: "Aktif",
  suspended: "Askıya alındı",
  rejected: "Reddedildi",
};

const PAINTER_ACTION_LABEL: Record<string, string> = {
  assigned: "Atandı",
  admin_assigned: "Admin tarafından atandı",
  admin_swapped_out: "Admin başka boyacıya devretti",
  accept: "İşi kabul etti",
  decline: "İşi reddetti",
  received: "Baskıyı teslim aldı",
  painted: "Boyamayı bitirdi",
  submit_qc: "QC fotoğrafı gönderdi",
  ship: "Kargoladı",
  admin_revoked: "Admin geri aldı",
  // Anahtarlar, satırı YAZAN modülün sabitlerinden gelir: elle kopyalanan bir
  // dize bir gün yazanla ayrışır ve ekran yine ham İngilizce eylem adını basar.
  [PARTNER_MODEL_REVISION_ACTION]: "Yeni model sürümü duyuruldu",
  [PARTNER_MODEL_ACK_ACTION]: "Yeni sürümü gördüğünü onayladı",
};

/**
 * Üreticinin sipariş durumu (manufacturer_order_status) — ekranda TÜRKÇE.
 *
 * Bu değerler ham enum olarak basılıyordu: admin "printed", "qc approved",
 * "shipped" ve üretici yokken düpedüz "unassigned" okuyordu — üstelik biri
 * Türkçe bir cümlenin ortasında ("üretici: printing"). Boyacı tarafının
 * sözlüğü (PAINTER_STATUS_LABEL) zaten vardı; bu onun üretici ikizidir.
 */
const MANUFACTURER_STATUS_LABEL: Record<string, string> = {
  unassigned: "Atanmadı",
  assigned: "Atandı, kabul bekleniyor",
  accepted: "Kabul edildi",
  printing: "Basılıyor",
  printed: "Baskı bitti",
  qc_pending: "QC onayı bekliyor",
  qc_rejected: "QC reddedildi — yeniden basıyor",
  qc_approved: "QC onaylandı",
  shipped: "Kargolandı",
};

/** Üretici atanmamışsa da bir cümle gerekir; tanınmayan değer ham basılmaz. */
function manufacturerStatusLabel(status: string | null | undefined): string {
  if (!status) return MANUFACTURER_STATUS_LABEL.unassigned;
  return MANUFACTURER_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

/** Üretici eylem günlüğü satırları — PAINTER_ACTION_LABEL'ın üretici ikizi. */
const MANUFACTURER_ACTION_LABEL: Record<string, string> = {
  assigned: "Atandı",
  admin_assigned: "Admin tarafından atandı",
  admin_revoked: "Admin atamayı geri aldı",
  admin_swapped_out: "Admin başka üreticiye devretti",
  accept: "İşi kabul etti",
  decline: "İşi reddetti",
  cancel_after_accept: "Kabul ettikten sonra bıraktı",
  start_printing: "Baskıya başladı",
  finish_printing: "Baskıyı bitirdi",
  submit_qc: "QC fotoğrafı gönderdi",
  send_to_painter: "Boyacıya devretti",
  ship: "Kargoladı",
  [PARTNER_MODEL_REVISION_ACTION]: "Yeni model sürümü duyuruldu",
  [PARTNER_MODEL_ACK_ACTION]: "Yeni sürümü gördüğünü onayladı",
};

function manufacturerActionLabel(action: string): string {
  return MANUFACTURER_ACTION_LABEL[action] ?? action.replace(/_/g, " ");
}

/**
 * Boyacı eylem günlüğü satırı — manufacturerActionLabel'ın boyacı ikizi.
 * Sözlük doğrudan indekslenince tanınmayan bir değer ham enum olarak ("submit_qc")
 * basılıyordu; etiketin TEK okuma yolu bu yardımcıdır.
 */
function painterActionLabel(action: string): string {
  return PAINTER_ACTION_LABEL[action] ?? action.replace(/_/g, " ");
}

/**
 * Kargo kaydının kuralı hakkında SUNUCUNUN cevabı
 * (GET /api/admin/orders/[id]/ship). `reason` doğrudan gösterilebilir Türkçe
 * bir cümledir; ekran kendi gerekçesini yazmaz.
 *
 * `unknown`: cevap alınamadı. Bu durumda düğmeler AÇILMAZ — bilinmeyen bir
 * kuralı "serbest" saymak, ekranın kendi (daha dar) kopyasını tutmasının başka
 * bir biçimi olurdu.
 */
type ShipRuleState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "unknown" }
  | { phase: "ready"; canRevert: boolean; code: string; reason: string | null };

/** Cevap HANGİ duruma ait: sipariş değiştiyse bayat cevapla düğme açılmasın. */
interface ShipRuleAnswer {
  key: string;
  value: ShipRuleState;
}

/**
 * Mülkiyet devri gerekçesini soran kutu (hem atama hem geri alma kullanır).
 *
 * BARAJIN SAYISI BU DOSYADA YAZILI DEĞİLDİR. Baraj, aşmayı kabul eden kapının
 * sabitidir (SELLER_OVERRIDE_REASON_MIN_LENGTH, manufacturer-assign.ts) ve bu
 * dosya bir istemci bileşeni: o modül DB + iş kuyruğu import ettiği için
 * tarayıcı paketine giremez (bu ekranın DB modülünü değer olarak import
 * etmemesi scripts/test-order-model-files.ts'te ayrıca kurala bağlanmıştır).
 * Sayıyı buraya elle kopyalamak ekranla kapının ayrı düşmesi demekti; regresyon
 * tam olarak öyle doğdu: ekran üç karakteri yeterli sandı, kapı on istedi ve
 * admin çıkışı olmayan bir 400'e kilitlendi. Bu yüzden sayıyı SUNUCUNUN kendi
 * cümlesi taşır — kısa gerekçe 400 ile döner ve kutu bu kez o cümleyle yeniden
 * açılır, yani admin her hâlde bir sonraki adımı görür.
 */
const SELLER_OVERRIDE_REASON_PROMPT =
  "Mülkiyet devrinin gerekçesi — denetim kaydına yazılacak ve satıcıya bildirim gidecek:";

function promptSellerOverrideReason(
  message: string,
  current: string
): string | null {
  const typed = window.prompt(message, current);
  // Vazgeçmek de boş bırakmak da "aşma yapma" demektir: gerekçesiz bir devri
  // kapı zaten reddeder, isteği hiç göndermeyiz.
  if (typed === null) return null;
  const trimmed = typed.trim();
  return trimmed ? trimmed : null;
}

/**
 * 3D önizlemeyi sayfanın geri kalanından yalıtır.
 *
 * Sunucu, yüklemede yalnız GLB İMZASINI doğrular (dosyalar yüz MB'ye çıkabildiği
 * için tamamı ayrıştırılmaz — config/order-model.ts · verifyModelHead). Yani
 * imzası doğru ama içi bozuk/yarım bir GLB görüntüleyiciye kadar gelir;
 * ayrıştırma sahne üretmezse sahne klonlanırken hata fırlar. Yakalanmazsa bu
 * hata sipariş sayfasının tamamını düşürür: admin ne dosyaları indirebilir ne
 * de siparişi ilerletebilir. Burada durur, admin önizlemenin oluşturulamadığını
 * okur; sürüm listesi, dosya bağlantıları ve para dökümü yerinde kalır.
 *
 * Görüntüleyicinin KENDİSİ de artık eksik ya da okunamayan dosyayı içeride
 * yakalayıp aynı kutuyu basıyor (ModelViewer · errorFallback); bu sınır dış ağ
 * olarak kalır. Hangisi yakalarsa yakalasın admin aynı cümleyi okur.
 *
 * `key` olarak model adresi verilir: yeni bir sürüm yüklendiğinde sınır
 * sıfırlanır, yoksa bir kez düşen önizleme sayfa yenilense de kapalı kalırdı.
 */
function ModelPreviewFallback({ downloadUrl }: { downloadUrl?: string | null }) {
  return (
    <div className="flex h-72 w-full flex-col items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 text-center">
      <p className="text-xs text-amber-900">
        3D önizleme oluşturulamadı: dosya okunamıyor ya da bozuk olabilir. Dosyayı
        indirip kontrol edin, gerekirse yeni bir sürüm yükleyin.
      </p>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download
          className="text-xs font-semibold text-amber-900 underline"
        >
          Model dosyasını indir
        </a>
      )}
    </div>
  );
}

class ModelPreviewBoundary extends Component<
  { children: ReactNode; downloadUrl?: string | null },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[admin order] 3D önizleme oluşturulamadı:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <ModelPreviewFallback downloadUrl={this.props.downloadUrl} />;
  }
}

// ─── Types ───────────────────────────────────────────────────
interface OrderData {
  id: string;
  orderNumber: string;
  orderType: "custom" | "marketplace" | "upload";
  /**
   * Sipariş bir atölye partisiyle sevk edildiyse parti kimliği. Kargo geri alma
   * (DELETE /ship) atölye siparişini her zaman 409 ile reddeder; düğme bu alana
   * bakarak gizlenir.
   */
  workshopSessionId: string | null;
  sellerManufacturerId: string | null;
  painterStatus: string | null;
  needsPainting: boolean;
  paintingPriceKurus: number;
  productionBaseKurus: number | null;
  productTitleSnapshot: string | null;
  email: string;
  customerName: string;
  phone: string | null;
  figurineSize: string | null;
  material: string;
  finish: string;
  style: string;
  modifiers: string[] | null;
  selectedOptions: { groupName: string; choiceName: string }[];
  shippingAddress: { adres: string; mahalle?: string; ilce: string; il: string; postaKodu: string; telefon: string } | null;
  status: string;
  amountKurus: number;
  giftCardAmountKurus: number;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  adminNotes: string | null;
  failureReason: string | null;
  retryCount: number;
  createdAt: string;
  paymentMethod: "card" | "bank_transfer" | "gift_card_full" | null;
  paymentStatus: "succeeded" | "refunded";
  havaleDiscountKurus: number;
  bankTransferReceiptUrl: string | null;
  customerNote: string | null;
  modelGlbKey: string | null;
  modelGlbUrl: string | null;
  modelStlKey: string | null;
  modelStlUrl: string | null;
  modelUploadedAt: string | null;
  modelSource: string | null;
}

/**
 * The print gate's ruling on an automatically produced model. Null for every
 * other kind of order — a hand-sculpted mesh was never measured, so there is
 * no verdict to show.
 */
interface PrintGateData {
  mode: "shadow" | "enforce";
  verdict: "pass" | "warn" | "fail" | null;
  reasons: string[];
  /** True only in enforce mode on a failing verdict: approving needs a reason. */
  requiresOverride: boolean;
  round: number;
  turntableUrl: string | null;
  measurements: {
    heightMm: number | null;
    volumeCm3: number | null;
    faceCount: number;
    componentCount: number;
    minWallP1Mm: number | null;
    minWallP5Mm: number | null;
    fillRatio: number | null;
    baseAdded: boolean;
  } | null;
}

interface Props {
  data: {
    order: OrderData;
    printGate?: PrintGateData | null;
    approvedImageUrl?: string | null;
    photos: { id: string; originalUrl: string; thumbnailUrl: string | null }[];
    modelRevisions: {
      id: string;
      revision: number;
      glbUrl: string | null;
      stlUrl: string | null;
      uploadedByEmail: string | null;
      note: string | null;
      createdAt: string;
      /**
       * Siparişin GEÇERLİ modeli bu sürüm mü. Kararı sunucu verir ve tek kural
       * vardır: en yüksek numaralı sürüm (resolveCurrentRevision). Sürümü
       * değiştiren her yol en üste yeni bir sürüm yazar, bu yüzden "en yenisi
       * ama geçerli değil" diye bir hâl yoktur.
       */
      isCurrent: boolean;
      /** Yüklemenin denetim satırı: kim, ne zaman, sipariş hangi durumdayken. */
      audit: { notes: string | null; adminEmail: string; createdAt: string } | null;
      /** Sürümün TÜM parçaları; bir iş 12-13 ayrı STL olabilir. */
      files: { id: string; name: string; kind: string; sizeBytes: number | null; url: string }[];
    }[];
    /**
     * Sürüm tablosu okunamadı: liste BOŞ değil, BİLİNMİYOR. Aynı arıza QC
     * turunu da kanıtlanamaz yapar (qcProof.failure = "revision_unreadable").
     */
    modelRevisionsUnreadable?: boolean;
    latestGeneration: { id: string; provider: string; status: string; outputGlbUrl: string | null; outputStlUrl: string | null; costCents: number | null; durationMs: number | null; createdAt: string } | null;
    latestReport: { isWatertight: boolean; isVolume: boolean; vertexCount: number; faceCount: number; componentCount: number; boundingBox: any; baseAdded: boolean; repairsApplied: string[] | null } | null;
    generationAttempts: { id: string; provider: string; status: string; outputGlbUrl: string | null; outputStlUrl: string | null; errorMessage: string | null; costCents: number | null; durationMs: number | null; createdAt: string }[];
    adminActions: { id: string; action: string; adminEmail: string; notes: string | null; createdAt: string }[];
    adminMessages: { id: string; subject: string | null; body: string; templateKey: string | null; adminEmail: string; sentAt: string }[];
    manufacturer?: {
      id: string;
      companyName: string;
      contactPerson: string;
      status: string;
      phone: string | null;
      email: string | null;
      city: string | null;
      district: string | null;
    } | null;
    painter?: {
      id: string;
      companyName: string;
      contactPerson: string | null;
      phone: string | null;
      email: string;
      status: string;
      acceptingOrders: boolean;
    } | null;
    painting?: PaintingData;
    /**
     * Para dökümü, built server-side by buildOrderMoneyBreakdown. Null when the
     * loader failed: the card says so instead of taking the whole page down.
     */
    money?: OrderMoneyBreakdown | null;
    journey?: {
      eligible: boolean;
      blockedBy: "no_photo" | "no_model" | null;
      url: string | null;
      qrUrl: string | null;
    };
    manufacturerActions?: { id: string; action: string; notes: string | null; createdAt: string }[];
    /** Üreticinin işlem günlüğü okunamadı: liste BOŞ değil, BİLİNMİYOR. */
    manufacturerActionsUnreadable?: boolean;
    manufacturerStatus?: string | null;
    qcRound?: number;
    qcPhotos?: {
      id: string;
      url: string;
      reviewStatus: string;
      round: number;
      /** Fotoğrafın gösterdiği baskının model sürümü (eski satırlarda null). */
      modelRevision: number | null;
      createdAt: string;
    }[];
    /**
     * Canlı QC turu, GÜNCEL sürümün baskısı olduğunu KANITLAYAMIYOR (kapı
     * fail-closed). Sebebi tek başına söylemez; onu `qcProof` taşır.
     */
    qcRevisionMismatch?: boolean;
    /** Aynı kapının SEBEBİ: tur neden kanıtlanamadı (dört hâl, adıyla). */
    qcProof?: QcProofData;
    qcReviews?: { id: string; round: number; decision: string; reason: string | null; adminEmail: string; createdAt: string }[];
    assignedToManufacturerAt?: string | null;
    manufacturerAcceptedAt?: string | null;
    manufacturerPrintedAt?: string | null;
    assignmentAgeHours?: number | null;
    /** Bu siparişi reddetmiş üreticiler (kimlik değil, ad). */
    declinedManufacturers?: { id: string; companyName: string }[];
    /** P2-C1: yükleme bu aşamada neyi tetikler (sunucu hesaplar). */
    modelUpload?: {
      stage: ModelUploadStage;
      allowed: boolean;
      effects: ModelUploadSideEffects;
    };
    /** Müşterinin model onay turları ve kararları. */
    modelApproval?: {
      open: boolean;
      url: string | null;
      approvedAt: string | null;
      revisionNote: string | null;
      rounds: {
        id: string;
        revision: number;
        channel: string;
        shownAt: string;
        reminderSentAt: string | null;
        decidedAt: string | null;
        decision: string | null;
        note: string | null;
      }[];
    };
    /** Partner yeni model sürümünü gördüğünü onayladı mı. */
    partnerAck?: {
      manufacturer: PartnerAckState;
      painter: PartnerAckState;
    };
    /** Siparişi şu an tutan partner (on-behalf adımları buna göre). */
    onBehalfHolder?: "manufacturer" | "painter" | "none";
    activeManufacturers?: { id: string; companyName: string }[];
    candidates?: {
      manufacturerId: string;
      companyName: string;
      city: string | null;
      district: string | null;
      phone: string | null;
      email: string;
      iban: string | null;
      currentLoad: number;
      maxConcurrentOrders: number;
      acceptingOrders: boolean;
      scores: Record<ScoreKey, number>;
      totalScore: number;
      reasons: string[];
      eligible: boolean;
      ineligibleReason?: string;
    }[];
    /**
     * Atama KARARLARI, en yenisi başta (kayıt satırları değil: bir karar birden
     * çok satır yazar, sunucu onları eşleyip gönderir). Boş dizi = bu sipariş
     * için hiç değerlendirme yazılmamış: elle atanmış, otomatik atamadan önce
     * açılmış eski bir sipariş, ya da satıcının KENDİ atölyesine yerleştirilmiş
     * olabilir — mülkiyet yerleştirmesi sıralayıcıya hiç girmez, bu yüzden
     * otomatik olsa bile değerlendirme satırı yazmaz (order-confirm.ts).
     */
    assignmentDecisions?: EvaluationDecision[];
    /**
     * Boyacı atama KARARLARI, en yenisi başta. Boyacı tarafında bir karar TEK
     * satır yazar (gölge sıralama yok). Boş dizi = bu sipariş için hiç boyacı
     * kararı yazılmamış: elle atanmış eski bir sipariş olabilir, ya da üretici
     * kendi boyadığı için sıralama hiç çalışmamıştır.
     */
    painterAssignmentDecisions?: PainterEvaluation[];
    /**
     * Hangi GÖSTERİM tablosu OKUNAMADI (sunucu doldurur: page.tsx · displayRead).
     *
     * Bayrak olmadan bu ekran, yapılmamış bir okumanın sonucunu gerçek bir kayıt
     * gibi gösteriyordu: boş liste "kayıt yok", eksik sayı "tahakkuk etmedi"
     * diye okunuyordu. Her bayrak, veriyi gösteren KARTIN kendi yerinde yazılır.
     */
    readFailures?: {
      /** Sipariş fotoğrafları okunamadı: kart "boş" değil, bilinmiyor. */
      photos?: boolean;
      /** Üretici KAYDI okunamadı: sipariş atanmamış SAYILMAZ. */
      manufacturer?: boolean;
      /** QC fotoğrafları okunamadı: tur "fotoğrafsız" değil, bilinmiyor. */
      qcPhotos?: boolean;
      /** Ölçüm kaydı okunamadı: baskı kapısı gerekçeli onaya çekilir. */
      printGateReport?: boolean;
      candidates?: boolean;
      activeManufacturers?: boolean;
      modelFiles?: boolean;
      modelApprovalRounds?: boolean;
      manufacturerDeclined?: boolean;
      assignmentDecisions?: boolean;
      journey?: boolean;
      painterQcPhotos?: boolean;
      painterQcReviews?: boolean;
      painterEarning?: boolean;
      painterCandidates?: boolean;
      painterDeclined?: boolean;
      /** Boyacı sıralaması üretilemedi: liste SIRASIZ, öneri gösterilemez. */
      painterRanking?: boolean;
      /** Boyacı kararları okunamadı: gerekçe kartı BOŞ değil, bilinmiyor. */
      painterAssignmentDecisions?: boolean;
    };
  };
  locale: string;
}

/**
 * GÖSTERİM amaçlı bir tablo okunamadığında kartın KENDİ yerinde söylenen cümle.
 *
 * Ayrı bir bileşen, çünkü kural tek: boş bir liste "kayıt yok" demek değildir
 * ve sessizlik de bir iddiadır. Sunucu artık her gösterim okumasını koruyor
 * (page.tsx · displayRead), yani sayfa arızada da AÇILIYOR — açılan sayfanın
 * yalan söylememesi bu uyarıya bağlı.
 */
function ReadFailedNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      {children}
    </p>
  );
}

// Each status keeps the hue it has in the orders list (orders-client.tsx), in
// this page's lighter ring style, so an order reads the same colour on both
// screens.
const STATUS_COLORS: Record<string, string> = {
  paid: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  awaiting_model: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  generating: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  processing_mesh: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  review: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
  awaiting_customer_approval: "bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200",
  approved: "bg-green-50 text-green-700 ring-1 ring-green-200",
  printing: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  quality_check: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  painting: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200",
  shipped: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  failed_generation: "bg-red-50 text-red-700 ring-1 ring-red-200",
  failed_mesh: "bg-red-50 text-red-700 ring-1 ring-red-200",
  rejected: "bg-red-50 text-red-700 ring-1 ring-red-200",
};

// Module level, not inside the page component, because the money card labels
// its cart sibling orders with the same words as the header and the stepper.
/** admin.status.<status>; the readable enum only for a status tr.ts lacks. */
function orderStatusLabel(d: Dictionary, status: string): string {
  return d[`admin.status.${status}` as keyof Dictionary] || status.replace(/_/g, " ");
}

/** admin.payment.status.<status>; the raw value only for a status tr.ts lacks. */
function paymentStatusLabel(d: Dictionary, status: string): string {
  return d[`admin.payment.status.${status}` as keyof Dictionary] || status;
}

/**
 * Print-gate verdict palette. Green / amber / red, and a neutral slate for the
 * case where the pipeline produced a model but no report row — that is missing
 * evidence, not a pass, and must not be painted as one.
 */
const GATE_TONE = {
  pass: {
    card: "bg-gradient-to-br from-green-50 to-emerald-50 border-green-200",
    badge: "bg-green-600 text-white",
    heading: "text-green-900",
    body: "text-green-800",
    chip: "bg-white/70 text-green-900 ring-1 ring-green-200",
  },
  warn: {
    card: "bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200",
    badge: "bg-amber-500 text-white",
    heading: "text-amber-900",
    body: "text-amber-800",
    chip: "bg-white/70 text-amber-900 ring-1 ring-amber-200",
  },
  fail: {
    card: "bg-gradient-to-br from-red-50 to-rose-50 border-red-200",
    badge: "bg-red-600 text-white",
    heading: "text-red-900",
    body: "text-red-800",
    chip: "bg-white/70 text-red-900 ring-1 ring-red-200",
  },
  unknown: {
    card: "bg-gradient-to-br from-slate-50 to-gray-50 border-gray-200",
    badge: "bg-gray-500 text-white",
    heading: "text-gray-900",
    body: "text-gray-600",
    chip: "bg-white/70 text-gray-700 ring-1 ring-gray-200",
  },
} as const;

/** Millimetre reading, or an em dash when the pipeline could not measure it. */
function gateMm(value: number | null | undefined, digits: number): string {
  return value == null ? "—" : `${value.toFixed(digits)} mm`;
}

const TIMELINE_STEPS = [
  "paid",
  "awaiting_model",
  // Auto-3D orders park here after the admin's one click: the model is made and
  // approved internally, and the CUSTOMER still has to approve the turntable
  // before anything is printed.
  "awaiting_customer_approval",
  "approved",
  "printing",
  // The manufacturer's QC gate (printed, QC photos, admin approval). The order
  // sits at quality_check through all of it; before this step existed such
  // orders fell off the stepper and were drawn as "paid".
  "quality_check",
  // The painter's leg. Only orders that go to a painter show it (filtered per
  // order in the component), so a plain print job keeps a short stepper.
  "painting",
  "shipped",
  "delivered",
];

// ─── Step Icons ──────────────────────────────────────────────
function StepIcon({ step, className = "w-4 h-4" }: { step: string; className?: string }) {
  switch (step) {
    case "paid":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>;
    case "generating":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
    case "processing_mesh":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>;
    case "review":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>;
    case "awaiting_customer_approval":
      // Waiting on the buyer, not on us — a hand, not a spinner.
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" /></svg>;
    case "approved":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>;
    case "printing":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>;
    case "quality_check":
      // A checked badge: photos are being inspected before anything moves on.
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>;
    case "painting":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>;
    case "shipped":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
    case "delivered":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
    default:
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  }
}

// ─── Para dökümü ─────────────────────────────────────────────
// Everything below only DISPLAYS numbers that buildOrderMoneyBreakdown derived
// through earning-base / cost-lines. No share is computed in this file: a
// second hand-rolled copy of the commission math is exactly the drift the kalem
// model was introduced to end.

// Only the colours live here. The kind names come from MONEY_LINE_KIND_LABELS_TR,
// next to the MoneyLine type, so this badge cannot drift from what the module
// that emits the lines calls them.
const MONEY_KIND_TONE: Record<MoneyLine["kind"], string> = {
  production: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  painting: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200",
  addon: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  discount: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  // A price row is part of the customer's price build-up and is shared between
  // production and painting (its split sits under it). Blue or fuchsia would
  // hand the whole row to one party, so it stays neutral.
  price: "bg-gray-100 text-gray-700 ring-1 ring-gray-200",
};

const PARTY_LABEL: Record<PartyShare["party"], string> = {
  manufacturer: "Üretici",
  painter: "Boyacı",
};

/**
 * A manufacturer who paints in house earns the painting kalem as well, and the
 * derivation then emits no painter share at all. The label has to say so, or
 * the admin reads a base that looks too big and goes looking for a painter.
 */
function partyLabel(s: PartyShare): string {
  const base = PARTY_LABEL[s.party] ?? s.party;
  return s.party === "manufacturer" && s.includesPainting ? `${base} (boyama dahil)` : base;
}

// earning_status: pending = accrued but not paid out yet.
const EARNING_STATUS_LABEL: Record<string, string> = {
  pending: "Ödenmedi",
  paid: "Ödendi",
  reversed: "Geri alındı",
};

const EARNING_STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  paid: "bg-green-50 text-green-700 ring-1 ring-green-200",
  reversed: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
};

const PAYOUT_STATUS_LABEL: Record<string, string> = {
  pending: "Ödeme partisinde, havale bekliyor",
  paid: "Ödendi",
};

const MONEY_SECTION_HEADING =
  "text-[11px] font-semibold uppercase tracking-wider text-gray-500";

/** "%40", "%37,5": Turkish writes the sign before the number. */
function formatRateBps(bps: number): string {
  return `%${(bps / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

/**
 * True for an earning a refund will NOT claw back. reverseEarning and
 * reversePainterEarning skip rows already marked paid (that money has left the
 * platform). Rows merely batched into a still-pending payout ARE reversed and
 * deducted from that payout, so they do not count here.
 */
function isPaidOut(e: PartnerEarningRow | null): boolean {
  return !!e && (e.status === "paid" || e.payout?.status === "paid");
}

const VOIDED_MUTED = "bg-gray-100 text-gray-600 ring-1 ring-gray-200";
const VOIDED_ALERT = "bg-red-50 text-red-700 ring-1 ring-red-200";

/**
 * A partner share on a refunded order (PartyShare.voided). No expected figure
 * applies any more, so only the earning row itself is left to report: the
 * refund reverses unpaid rows and cannot touch paid ones. A row still pending
 * here escaped the reversal (it accrued after the refund, say) and would be
 * paid out, so it is flagged instead of muted.
 */
function voidedShareState(e: PartnerEarningRow | null): {
  badge: string;
  accrual: string;
  tone: string;
  note: string;
} {
  if (!e) {
    return {
      badge: "Hakediş yok",
      accrual: "İade nedeniyle tahakkuk olmayacak",
      tone: VOIDED_MUTED,
      note: "İade edildi — hakediş oluşmaz.",
    };
  }
  if (e.status === "reversed") {
    return {
      badge: "Geri alındı",
      accrual: "Geri alındı",
      tone: VOIDED_MUTED,
      note: "İade edildi — hakediş oluşmaz; tahakkuk etmiş satır geri alındı.",
    };
  }
  if (isPaidOut(e)) {
    return {
      badge: "Ödenmiş, geri alınmadı",
      accrual: "Ödenmiş, geri alınmadı",
      tone: VOIDED_ALERT,
      note: "İade edildi ama bu hakediş zaten ödenmişti. Sistem geri almaz; tutar platform zararı olarak kalır.",
    };
  }
  return {
    badge: "Geri alınmadı",
    accrual: "Tahakkuk etti, geri alınmadı",
    tone: VOIDED_ALERT,
    note: "İade edildi ama bu hakediş geri alınmadı; ödeme partisine girerse partnere ödenir. Elle kontrol edilmeli.",
  };
}

/** One label/amount line of a money list. Must sit directly inside a <dl>. */
function MoneyRow({
  label,
  value,
  strong = false,
  divider = false,
  valueClass,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  divider?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        strong ? "font-semibold text-gray-900" : ""
      } ${divider ? "border-t border-gray-100 pt-1.5" : ""}`}
    >
      <dt className={strong ? "" : "text-gray-500"}>{label}</dt>
      <dd className={`text-right tabular-nums ${valueClass ?? (strong ? "" : "text-gray-800")}`}>
        {value}
      </dd>
    </div>
  );
}

/** The earning row that really accrued: gross, commission, net and payout. */
function EarningRows({ e, loc }: { e: PartnerEarningRow; loc: Locale }) {
  const fc = (k: number) => formatCurrency(k, loc);
  return (
    <dl className="mt-1 space-y-1 text-sm">
      <MoneyRow label="Brüt" value={fc(e.grossKurus)} />
      <MoneyRow label="Komisyon oranı" value={formatRateBps(e.rateBps)} />
      <MoneyRow label="Komisyon" value={`−${fc(e.commissionKurus)}`} />
      <MoneyRow label="Net" value={fc(e.netKurus)} strong divider />
      <MoneyRow
        label="Ödeme"
        value={
          e.payout ? (
            <span className="text-xs">
              <Link href="/admin/payouts" className="text-blue-700 hover:underline">
                {PAYOUT_STATUS_LABEL[e.payout.status] ?? e.payout.status}
              </Link>
              {e.payout.reference && (
                <span className="block font-mono text-[11px] text-gray-500">
                  {e.payout.reference}
                </span>
              )}
              {e.payout.paidAt && (
                <span className="block text-[11px] text-gray-500">
                  {formatDateTime(e.payout.paidAt, loc)}
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs text-gray-500">Ödeme partisine girmedi</span>
          )
        }
      />
    </dl>
  );
}

/** Expected share (from the stored bases) next to the earning row that really accrued. */
function PartyShareBlock({ share: s, loc }: { share: PartyShare; loc: Locale }) {
  const fc = (k: number) => formatCurrency(k, loc);
  const e = s.earning;

  // Refunded: the expected base, rate and net read as money still on its way
  // to the partner, while the Platform block and the warnings on the same card
  // already treat the order as closed. Only the real earning row, if any, is
  // left to show.
  if (s.voided) {
    const v = voidedShareState(e);
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-500">
            {partyLabel(s)}
            <span className="ml-1 font-normal text-gray-400">· {s.partnerName ?? "atanmadı"}</span>
          </p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${v.tone}`}>
            {v.badge}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">{v.note}</p>
        {e && (
          <div className={`mt-2 ${e.status === "reversed" ? "opacity-60" : ""}`}>
            <p className="text-[11px] font-medium text-gray-400">Gerçekleşen</p>
            <EarningRows e={e} loc={loc} />
          </div>
        )}
      </div>
    );
  }

  // A reversed row is history (refund, revoke); comparing it with today's
  // expectation would only raise false alarms.
  const differs =
    !!e &&
    e.status !== "reversed" &&
    (e.grossKurus !== s.baseKurus || e.netKurus !== s.expectedNetKurus);
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">
          {partyLabel(s)}
          <span className="ml-1 font-normal text-gray-500">· {s.partnerName ?? "atanmadı"}</span>
        </p>
        {e ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              EARNING_STATUS_TONE[e.status] ?? "bg-gray-100 text-gray-700"
            }`}
          >
            {EARNING_STATUS_LABEL[e.status] ?? e.status}
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            Hakediş satırı yok
          </span>
        )}
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium text-gray-400">Beklenen</p>
          <dl className="mt-1 space-y-1 text-sm">
            <MoneyRow label="Taban" value={fc(s.baseKurus)} />
            <MoneyRow
              label="Komisyon oranı"
              value={
                <span className="inline-flex items-center gap-1.5">
                  {formatRateBps(s.rateBps)}
                  {s.rateIsEstimate ? (
                    <span
                      title="Oran siparişe henüz sabitlenmedi; bugünkü oran gösteriliyor."
                      className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200"
                    >
                      tahmini
                    </span>
                  ) : (
                    <span
                      title="Siparişe sabitlenmiş oran"
                      className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
                    >
                      sabit
                    </span>
                  )}
                </span>
              }
            />
            <MoneyRow label="Komisyon" value={`−${fc(s.expectedCommissionKurus)}`} />
            <MoneyRow label="Net" value={fc(s.expectedNetKurus)} strong divider />
          </dl>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-400">Gerçekleşen</p>
          {e ? (
            <EarningRows e={e} loc={loc} />
          ) : (
            <p className="mt-1 text-xs text-gray-500">Henüz tahakkuk etmedi.</p>
          )}
        </div>
      </div>
      {differs && e && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          Gerçekleşen hakediş beklenenden farklı: brüt {fc(e.grossKurus)} (beklenen{" "}
          {fc(s.baseKurus)}), net {fc(e.netKurus)} (beklenen {fc(s.expectedNetKurus)}).
          Tahakkuktan sonra kalemler ya da oran değişmiş olabilir; tahakkuk eden satır
          kendiliğinden düzelmez.
        </p>
      )}
    </div>
  );
}

/**
 * Para dökümü: every line of the order and its value, what was collected, who
 * gets what, and what has accrued or been paid out. Read-only; rows rebuilt from
 * today's constants (no frozen copy on the order) are marked as such.
 */
function MoneyBreakdownCard({
  money,
  loc,
}: {
  money: OrderMoneyBreakdown | null | undefined;
  loc: Locale;
}) {
  const d = useDictionary();
  // Fold negative zero, and only that: formatCurrency prints its sign, so a
  // refunded order's platform net of −0 read as "-₺0,00". `k || 0` also turned
  // NaN into ₺0,00, which would hide a broken figure behind a plausible one.
  const fc = (k: number) => formatCurrency(Object.is(k, -0) ? 0 : k, loc);

  if (!money) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Para dökümü</h3>
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          Para dökümü hesaplanamadı (hata sunucu günlüğünde). Siparişin diğer işlemleri
          etkilenmez.
        </p>
      </div>
    );
  }

  const { lines, totals, collection, shares: allShares, platform, warnings } = money;
  const recomputedCount = lines.filter((l) => l.recomputed).length;
  const hasPriceRows = lines.some((l) => l.kind === "price");
  // C2'' emits no painter share when the manufacturer paints in house; this
  // only guards the display. A painter share with a ₺0 base, nobody assigned
  // and no earning row would render as "Boyacı · atanmadı" plus a pending
  // accrual that can never happen.
  const inHousePainting = allShares.some((s) => s.party === "manufacturer" && s.includesPainting);
  const shares = inHousePainting
    ? allShares.filter(
        (s) => s.party !== "painter" || s.earning !== null || s.partnerName !== null || s.baseKurus !== 0
      )
    : allShares;
  const refunded = isRefunded(collection);
  const paymentMethodLabel =
    collection.paymentMethod === "card"
      ? d["admin.payment.method.card"]
      : collection.paymentMethod === "bank_transfer"
        ? d["admin.payment.method.bankTransfer"]
        : collection.paymentMethod === "gift_card_full"
          ? d["admin.payment.method.giftCardFull"]
          : collection.paymentMethod ?? "—";

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Para dökümü</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {totals.legacySplit && (
            <span
              title="Sipariş kalem modelinden önce açıldı: üretim tabanı siparişe yazılmamış, eski kurala göre (tutar eksi boyama payı) türetildi."
              className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200"
            >
              kalem öncesi sipariş
            </span>
          )}
          {recomputedCount > 0 && (
            <span
              title="Bu satırlar siparişte saklanmadı; bugünkü fiyat sabitlerinden yeniden hesaplandı ve satış anındaki değerden farklı olabilir."
              className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200"
            >
              {recomputedCount} satır yeniden hesaplandı
            </span>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Salt okunur: satırlar, tahsilat, kim ne alır, ne tahakkuk etti ve ne ödendi.
      </p>

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {warnings.map((w, i) => (
            <li key={`${i}-${w}`} className="flex gap-2">
              <span aria-hidden>⚠</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Kalemler */}
      <section className="mt-5">
        <h4 className={MONEY_SECTION_HEADING}>Kalemler</h4>
        {!totals.splitMatches && (
          <p
            role="alert"
            className="mt-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
          >
            <strong>Kalem toplamı sipariş tutarını tutmuyor.</strong> Üretim{" "}
            {fc(totals.productionBaseKurus)} + boyama {fc(totals.paintingPriceKurus)}, sipariş
            tutarı ise {fc(totals.amountKurus)}. Partner hakediş tabanları bu ikisinden
            türediği için elle düzeltilmesi gerekir.
          </p>
        )}
        {lines.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">Bu sipariş için kalem bulunamadı.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100">
            {lines.map((l, i) => {
              const badgeLabel = MONEY_LINE_KIND_LABELS_TR[l.kind] ?? l.kind;
              const badgeCls = MONEY_KIND_TONE[l.kind] ?? "bg-gray-100 text-gray-700";
              const isDiscount = l.kind === "discount";
              // "qty × unit" only where it IS the row's amount. A row carrying one
              // party's share of a line (or a remainder) used to print "2 × ₺450"
              // next to ₺522,22, which reads as an arithmetic error.
              const unitShown =
                l.qty != null && l.unitKurus != null && l.qty * l.unitKurus === l.amountKurus
                  ? { qty: l.qty, unitKurus: l.unitKurus }
                  : null;
              return (
                <li key={`${l.kind}-${i}`} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeCls}`}
                      >
                        {badgeLabel}
                      </span>
                      <span className="text-sm text-gray-900">{l.label}</span>
                      {l.recomputed && (
                        <span
                          title="Siparişte saklanmadı; bugünkü sabitlerden yeniden hesaplandı."
                          className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200"
                        >
                          yeniden hesaplandı
                        </span>
                      )}
                    </div>
                    {unitShown ? (
                      <p className="mt-0.5 text-xs text-gray-500 tabular-nums">
                        {unitShown.qty} × {fc(unitShown.unitKurus)}
                      </p>
                    ) : l.qty != null && l.qty !== 1 ? (
                      <p className="mt-0.5 text-xs text-gray-500">{l.qty} adet</p>
                    ) : null}
                    {l.split && (
                      <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] tabular-nums text-gray-500">
                        <span>
                          Üretim <span className="text-blue-700">{fc(l.split.productionKurus)}</span>
                        </span>
                        <span aria-hidden>·</span>
                        <span>
                          Boyama <span className="text-fuchsia-700">{fc(l.split.paintingKurus)}</span>
                        </span>
                      </p>
                    )}
                    {l.note && <p className="mt-0.5 text-xs text-gray-500">{l.note}</p>}
                  </div>
                  <span
                    className={`shrink-0 text-sm font-medium tabular-nums ${
                      isDiscount ? "text-amber-700" : "text-gray-900"
                    }`}
                  >
                    {isDiscount ? `−${fc(Math.abs(l.amountKurus))}` : fc(l.amountKurus)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {/* Pay dağılımı: where the rows above land. Production, add-on and the
            production part of every price row add up to the production base;
            painting rows and painting parts add up to the painting base. */}
        <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-[11px] font-medium text-gray-500">Pay dağılımı</p>
          <dl className="mt-1 space-y-1 text-sm">
            <MoneyRow label="Üretim tabanı" value={fc(totals.productionBaseKurus)} />
            <MoneyRow label="Boyama tabanı" value={fc(totals.paintingPriceKurus)} />
            <MoneyRow label="Sipariş tutarı" value={fc(totals.amountKurus)} strong divider />
          </dl>
          {hasPriceRows && (
            <p className="mt-1 text-[11px] text-gray-500">
              Her fiyat satırının altındaki üretim / boyama payı bu iki tabana eklenir.
            </p>
          )}
        </div>
        {totals.splitMatches && (
          <p className="mt-1 text-[11px] text-green-700">✓ Üretim + boyama sipariş tutarına eşit.</p>
        )}
      </section>

      {/* Tahsilat */}
      <section className="mt-5 border-t border-gray-100 pt-4">
        <h4 className={MONEY_SECTION_HEADING}>Tahsilat</h4>
        <dl className="mt-2 space-y-1.5 text-sm">
          <MoneyRow label="Sipariş tutarı" value={fc(collection.amountKurus)} />
          {collection.giftCardKurus > 0 && (
            <MoneyRow
              label="Hediye kartı"
              value={`−${fc(collection.giftCardKurus)}`}
              valueClass="text-green-700"
            />
          )}
          {collection.havaleDiscountKurus > 0 && (
            <MoneyRow
              label="Havale indirimi"
              value={`−${fc(collection.havaleDiscountKurus)}`}
              valueClass="text-amber-700"
            />
          )}
          <MoneyRow
            label="Tahsil edilen (nakit)"
            value={fc(collection.cashCollectedKurus)}
            strong
            divider
          />
          {/* C3: cash counts as revenue only while the payment stands, so a
              refund drops revenueKurus to 0 while the cash above stays what was
              taken. Shown only when the two differ; otherwise it would repeat the
              row above. */}
          {collection.revenueKurus !== collection.cashCollectedKurus && (
            <MoneyRow
              label="Ciroya sayılan"
              value={fc(collection.revenueKurus)}
              valueClass={refunded ? "text-red-700" : undefined}
            />
          )}
          <MoneyRow label="Ödeme yöntemi" value={paymentMethodLabel} />
          <MoneyRow
            label="Ödeme durumu"
            value={
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  refunded
                    ? "bg-red-600 text-white"
                    : "bg-green-50 text-green-700 ring-1 ring-green-200"
                }`}
              >
                {paymentStatusLabel(d, collection.paymentStatus)}
              </span>
            }
          />
        </dl>
        {collection.siblings.length > 0 && (
          <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium text-gray-600">Aynı sepetin diğer siparişleri</p>
            <ul className="mt-1 divide-y divide-gray-200">
              {collection.siblings.map((sib) => (
                <li key={sib.id} className="py-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Link
                        href={`/admin/orders/${sib.id}`}
                        className="font-mono text-blue-700 hover:underline"
                      >
                        {sib.orderNumber}
                      </Link>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          STATUS_COLORS[sib.status] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {orderStatusLabel(d, sib.status)}
                      </span>
                      {isRefunded(sib) && (
                        <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {paymentStatusLabel(d, sib.paymentStatus)}
                        </span>
                      )}
                    </div>
                    <span className="tabular-nums text-gray-700">{fc(sib.amountKurus)}</span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap justify-end gap-x-3 tabular-nums text-[11px] text-gray-500">
                    {sib.giftCardKurus > 0 && <span>Hediye kartı −{fc(sib.giftCardKurus)}</span>}
                    {sib.havaleDiscountKurus > 0 && (
                      <span>Havale indirimi −{fc(sib.havaleDiscountKurus)}</span>
                    )}
                    <span className="font-medium text-gray-700">
                      Nakit {fc(sib.cashCollectedKurus)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-gray-500">
              Tek sepet ödemesi satıcıya göre alt siparişlere bölündü. Hediye kartı, havale
              indirimi ve nakit her alt siparişin kendi kaydından okunur.
            </p>
          </div>
        )}
      </section>

      {/* Kim ne alır */}
      <section className="mt-5 border-t border-gray-100 pt-4">
        <h4 className={MONEY_SECTION_HEADING}>Kim ne alır</h4>
        <div className="mt-2 space-y-3">
          {shares.length === 0 && (
            <p className="text-sm text-gray-400">Bu siparişte partner payı yok.</p>
          )}
          {shares.map((s) => (
            <PartyShareBlock key={s.party} share={s} loc={loc} />
          ))}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-semibold text-gray-900">Platform</p>
            {refunded ? (
              // Refunded: nothing counts as revenue and pending earnings were
              // reversed, so the platform is left with only the paid-out,
              // unrecoverable partner earnings (as a loss).
              <>
                <dl className="mt-2 space-y-1 text-sm">
                  <MoneyRow
                    label="Platform net (iade)"
                    value={fc(platform.netKurus)}
                    strong
                    valueClass={platform.netKurus < 0 ? "text-red-700" : undefined}
                  />
                </dl>
                <p className="mt-1 text-[11px] text-gray-500">
                  İadede tahsilat ciroya sayılmaz; geriye yalnız ödenmiş ve geri alınamayan partner
                  hakedişi platform zararı olarak kalır.
                </p>
              </>
            ) : (
              <dl className="mt-2 space-y-1 text-sm">
                <MoneyRow label="Partner komisyonları" value={fc(platform.commissionKurus)} />
                {/* Shown whenever non-zero: a negative value means partner
                    earnings exceed the order total and must be looked at. */}
                {platform.unassignedBaseKurus !== 0 && (
                  <MoneyRow
                    label="Partneri olmayan taban"
                    value={fc(platform.unassignedBaseKurus)}
                    valueClass={platform.unassignedBaseKurus < 0 ? "text-red-700" : undefined}
                  />
                )}
                {/* Geri alınmış hakediş tabanı AYRI bir satırdır: "partneri
                    olmayan taban" hiç kimsenin kazanmadığı tabandır, bu ise
                    kazanılmış sonra geri alınmış olandır. Türetim (order-money.ts)
                    bu tutarı platform NET'ine KATMAZ; satır da bunu söyler.
                    Satır olmadan tutar yalnızca uyarı cümlesinde geçiyordu:
                    admin "Platform net ₺0,00" okuyup parayı kartın hiçbir
                    yerinde göremiyordu. Hiçbir tutar değişmez, yalnız görünür. */}
                {platform.reversedBaseKurus !== 0 && (
                  <MoneyRow
                    label="Geri alınmış hakediş tabanı (gelire yazılmadı)"
                    value={fc(platform.reversedBaseKurus)}
                    valueClass="text-amber-700"
                  />
                )}
                {collection.giftCardKurus > 0 && (
                  <MoneyRow label="Hediye kartı" value={`−${fc(collection.giftCardKurus)}`} />
                )}
                {collection.havaleDiscountKurus > 0 && (
                  <MoneyRow
                    label="Havale indirimi"
                    value={`−${fc(collection.havaleDiscountKurus)}`}
                  />
                )}
                <MoneyRow
                  label="Platform net"
                  value={fc(platform.netKurus)}
                  strong
                  divider
                  valueClass={platform.netKurus < 0 ? "text-red-700" : undefined}
                />
              </dl>
            )}
          </div>
        </div>
      </section>

      {/* Tahakkuk */}
      <section className="mt-5 border-t border-gray-100 pt-4">
        <h4 className={MONEY_SECTION_HEADING}>Tahakkuk</h4>
        {shares.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">Tahakkuk edecek partner yok.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {shares.map((s) => {
              // Refunded: "Henüz tahakkuk etmedi" would promise an accrual the
              // refund has ruled out; an existing row reports its own state.
              const voided = s.voided ? voidedShareState(s.earning) : null;
              return (
              <li key={s.party} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className={`font-medium ${voided ? "text-gray-500" : "text-gray-900"}`}>
                    {partyLabel(s)}
                    {s.partnerName && (
                      <span className="ml-1 font-normal text-gray-500">· {s.partnerName}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{s.accrualEvent}</p>
                </div>
                {voided ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${voided.tone}`}>
                    {voided.accrual}
                  </span>
                ) : s.accrualMissing ? (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                    tahakkuk eksik
                  </span>
                ) : s.earning ? (
                  s.earning.status === "reversed" ? (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                      Tahakkuk geri alındı
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700 ring-1 ring-green-200">
                      Tahakkuk etti
                    </span>
                  )
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    Henüz tahakkuk etmedi
                  </span>
                )}
              </li>
              );
            })}
          </ul>
        )}
        {shares.some((s) => s.accrualMissing) && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
          >
            Sipariş kargolandı ya da boyacıya devredildi ama hakediş satırı yok. Tahakkuk
            arka planda sessizce başarısız olmuş olabilir; bu satır olmadan partner bu iş için
            ödeme partisine girmez. Elle düzeltilmesi gerekir.
          </p>
        )}
      </section>
    </div>
  );
}

/** Bir adayın alt skorları. Kaydedilmemiş bileşen hiç çizilmez. */
function ScoreBars({ scores }: { scores: Partial<Record<ScoreKey, number>> }) {
  const present = SCORE_KEYS.filter((k) => scores[k] !== undefined);
  if (present.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {present.map((k) => {
        const value = scores[k] ?? 0;
        return (
          <div key={k} className="space-y-1">
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>{SCORE_SHORT_LABELS_TR[k]}</span>
              <span className="font-medium text-gray-700">{value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full bg-indigo-500"
                style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Değerlendirmenin bir tarafı: kazanan + ilk üç adayın skor dökümü.
 *
 * "İşi alan" rozeti KARARIN KENDİ damgasından okunur, siparişin bugünkü
 * üreticisinden değil. Eski rozet ("atanan") bugünkü üreticiye bakıyordu: iş
 * karardan sonra devredildiğinde aynı kart kendisiyle çelişiyor, üstünde "iş bu
 * karardan sonra devredildi" yazarken dökümde o yeni atölyeyi bu kararın
 * seçimiymiş gibi işaretliyordu. Kayıt bilmiyorsa rozet de yoktur.
 */
function EvaluationSideBlock({
  side,
  title,
  placedManufacturerId,
}: {
  side: EvaluationSide;
  title: string;
  /** Kararın işi verdiği atölye; null = kayıt bunu hiç yazmamış. */
  placedManufacturerId: string | null;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-gray-800">{title}</p>
        <span className="text-[10px] text-gray-500">
          <code className="rounded bg-gray-100 px-1">{sideVersionLabel(side)}</code>
          {side.distanceModel
            ? ` · ${DISTANCE_MODEL_LABELS_TR[side.distanceModel] ?? side.distanceModel}`
            : ""}
        </span>
      </div>
      {side.candidates.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          {side.winnerName
            ? `Seçilen: ${side.winnerName} — skor dökümü kaydedilmemiş.`
            : "Bu taraf için kayıt yok."}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {side.candidates.map((c, i) => {
            const isWinner =
              !!c.manufacturerId && c.manufacturerId === side.winnerId;
            const isPlaced =
              !!c.manufacturerId && c.manufacturerId === placedManufacturerId;
            return (
              <li
                key={c.manufacturerId ?? i}
                className={`rounded-lg p-2 ${
                  isWinner
                    ? "bg-emerald-50 ring-1 ring-emerald-200"
                    : "bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium text-gray-800">
                    {c.companyName ?? "—"}
                    {isWinner && (
                      <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">
                        seçilen
                      </span>
                    )}
                    {isPlaced && !isWinner && (
                      <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">
                        işi alan
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-bold text-gray-700">
                    {c.totalScore ?? "—"}
                  </span>
                </div>
                <ScoreBars scores={c.scores} />
              </li>
            );
          })}
        </ul>
      )}
      {/* Rozetin YOKLUĞU da bir iddiadır ("kimse almadı" gibi okunur): kayıt
          işi kime verdiğini yazmamışsa bu açıkça söylenir. */}
      {side.candidates.length > 0 && !placedManufacturerId && (
        <p className="mt-2 text-[11px] text-gray-500">
          Bu kararın işi hangi atölyeye verdiği kayıtlı değil; “işi alan”
          işareti gösterilemiyor.
        </p>
      )}
    </div>
  );
}

/**
 * "Bu iş neden bu atölyeye gitti?"
 *
 * Kaynak, atama kararının ANINDA yazılmış değerlendirme kayıtlarıdır; bu kart
 * onları okur, yeniden hesaplamaz. Sayfa açılışında yeniden sıralasaydı yük,
 * güvenilirlik ve etki alanı o günden beri değiştiği için admin'e kararı
 * açıklamayan — hatta onunla çelişen — bir tablo gösterirdi.
 *
 * MANŞET KARARDIR, KAYIT SATIRI DEĞİL. Bir karar tabloya birden çok satır yazar
 * (ağırlık karşılaştırması + sürekli mesafe gölgesi) ve bu satırlar
 * mikrosaniyelerle ayrılır. "En yeni satırı" manşete almak, hangi
 * karşılaştırmanın öne çıkacağını iki eşzamanlı INSERT'ün yarışına bırakıyordu;
 * kardeş satır da "önceki değerlendirme" diye görünüyordu — oysa öncesi değil,
 * aynı anın öbür yarısıydı. Sunucu satırları karara eşlediği için burada canlı
 * seçim BİR KEZ yazılır, her gölge karşılaştırması adıyla etiketlenir ve
 * "önceki" başlığı yalnızca gerçekten daha eski KARARLARA ayrılır.
 */
function AssignmentEvaluationCard({
  decisions,
  assignedManufacturerId,
  loc,
}: {
  decisions: EvaluationDecision[];
  assignedManufacturerId: string | null;
  loc: Locale;
}) {
  const current = decisions[0];
  if (!current) return null;
  const earlier = decisions.slice(1);
  // "Bu karar işi kime verdi" sorusunu YALNIZ kararın kendi damgası cevaplar.
  // Siparişin bugünkü üreticisine düşen eski davranış, karardan çok sonra elle
  // yapılan bir devri bu kararın sonucu sanıyor ve sıralamayı "birincisini
  // seçmedi" diye suçluyordu. Kayıt bilmiyorsa ekran da bilmediğini söyler.
  const placedId = current.placedManufacturerId;
  /**
   * Kararın işi verdiği atölyenin ekran karşılığı: ad çözüldü mü, yalnız kimlik
   * mi var, yoksa kayıt yerleştirmeyi hiç yazmamış mı.
   */
  const placement = placementLabel(current);
  /** Kayıt, işin kime gittiğini hiç yazmamış (damgadan önceki kayıt). */
  const placementUnknown = !current.placedManufacturerId;
  // Karardan sonra el değiştirmiş mi?
  const handedOff =
    !!current.placedManufacturerId &&
    !!assignedManufacturerId &&
    current.placedManufacturerId !== assignedManufacturerId;
  // Sıralamanın birincisi ile işi gerçekten alan atölye ayrıştıysa admin bunu
  // görmeli — ama SEBEP, kaydın söyleyebildiği kadar söylenir: aynı ayrışmayı
  // geri alma sonrası dışlama da (otomatik, çok sık) elle atama da üretir.
  const divergence = placementDivergence({
    placedManufacturerId: placedId,
    liveWinnerId: current.live.winnerId,
    liveWinnerName: current.live.winnerName,
    excludedManufacturerIds: current.excludedManufacturerIds,
  });
  const comparisons = current.comparisons.filter(
    (c) => !!c.shadow.winnerId || c.shadow.candidates.length > 0
  );

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-900">
          Bu iş neden bu atölyeye gitti?
        </h3>
        <span className="text-xs text-gray-500">
          {formatDateTime(current.createdAt, loc)}
        </span>
      </div>

      <p className="mt-2 text-xs text-indigo-900/80">
        Skorlar atama anında kaydedildi; bugünkü yük ve güvenilirlik
        değerleriyle yeniden hesaplanmaz. 100 en iyi, 0 en kötüdür.
      </p>

      {placement.kind === "named" && (
        <p className="mt-2 text-xs text-indigo-900">
          Bu karar işi <strong>{placement.name}</strong> atölyesine verdi.
        </p>
      )}

      {/* Kayıt bir atölye YAZMIŞ ama adı çözülemiyor (atölye kaydı silinmiş
          olabilir). Cümle adın varlığına bağlıyken kart burada tamamen
          susuyordu: kimlik yazılı olduğu için aşağıdaki "kayıtlı değil" notu da
          çıkmıyor, karar bir atölyeye iş vermişken ekran hiçbir şey
          söylemiyordu. Bilinen şey yazılır, eksik olan da adıyla söylenir. */}
      {placement.kind === "unnamed" && (
        <p className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700">
          Bu karar işi bir atölyeye verdi, ama o atölyenin{" "}
          <strong>adı çözülemedi</strong> (atölye kaydı silinmiş olabilir).
          Kayıttaki atölye kimliği:{" "}
          <code className="rounded bg-gray-100 px-1">{placement.shortId}…</code>
        </p>
      )}

      {divergence && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {divergence.kind === "excluded" ? (
            <>
              İşi alan üretici, sıralamanın birincisi değil: birinci sıradaki{" "}
              <strong>{divergence.winnerName ?? "atölye"}</strong> bu
              yerleştirmede hariç tutulmuştu (iş az önce o atölyeden geri
              alınmıştı), bu yüzden karar sıradaki uygun atölyeye verildi. Elle
              atama değildir.
            </>
          ) : (
            <>
              İşi alan üretici, sıralamanın birincisi değil. İki sebebi olabilir:
              sıralamanın birincisi bu yerleştirmede hariç tutulmuş olabilir (iş
              az önce o atölyeden geri alındıysa) ya da iş elle atanmış olabilir.
              Kayıt hangisi olduğunu söylemiyor.
            </>
          )}
        </p>
      )}

      {/* Damgasız eski kayıt: sapma VAR MI, YOK MU bilinmiyor. Buradaki
          sessizlik de bir iddiadır ("sapma yok" gibi okunur), o yüzden
          bilinmediği açıkça yazılır. */}
      {placementUnknown && current.live.winnerId && (
        <p className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700">
          Bu kararın işi hangi atölyeye verdiği <strong>kayıtlı değil</strong>
          {" "}(damgadan önce yazılmış kayıt), bu yüzden sıralamanın birincisinden
          sapıp sapmadığı da bilinmiyor.
          {assignedManufacturerId
            ? " Siparişte şu an duran üretici bu kararın sonucu olmayabilir."
            : ""}
        </p>
      )}

      {/* Ne yerleştirme damgası ne de bir sıralama kazananı var. Kart bu hâlde
          manşette HİÇBİR ŞEY yazmıyordu: ekran "kayıt bu karar hakkında hiçbir
          şey söylemiyor" ile "söylenecek bir sapma yok"u aynı sessizlikle
          gösteriyordu. Kartın geri kalanı gibi burada da bilinen yazılır,
          eksik olan adıyla söylenir. */}
      {placementUnknown && !current.live.winnerId && (
        <p className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700">
          Bu kararda ne sıralamanın seçtiği atölye ne de işi alan atölye{" "}
          <strong>kayıtlı değil</strong>: kayıt kazanan yazmamış (o an uygun
          aday çıkmamış olabilir) ve yerleştirme damgası da yok. Bilinenler,
          kararın yazıldığı an ve aşağıdaki karşılaştırma kayıtlarıdır.
          {assignedManufacturerId
            ? " Siparişte şu an duran üretici bu kararın sonucu olmayabilir."
            : ""}
        </p>
      )}

      {/* Aynı karar birden çok kez yazılmışsa: satırlar hemfikir olduğunda bu
          hiçbir yerde görünmüyordu. Hata değil, veri kalitesi notu. */}
      {current.supersededRowCount > 0 && (
        <p className="mt-2 text-[11px] text-gray-600">
          Bu kararın aynı karşılaştırması {current.supersededRowCount} kez daha
          kaydedilmiş; aşağıda her karşılaştırmanın en yeni kaydı gösteriliyor.
        </p>
      )}

      {/* Devir, sıralamanın hatası değildir: kararın kendi damgası varken
          "sıralama yanlış seçti" demek yanlış suçlama olurdu. */}
      {handedOff && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          İş bu karardan sonra başka bir atölyeye devredildi; siparişte şu an
          duran üretici bu kararın sonucu değildir.
        </p>
      )}

      {/* Aynı kararın kayıtları canlı kazanan konusunda ayrışıyorsa, birini
          doğruymuş gibi manşete almak kararı yanlış anlatır. */}
      {!current.liveConsistent && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Bu kararın kayıtları canlı seçim konusunda ayrışıyor; aşağıdaki
          karşılaştırmaları tek tek okuyun.
        </p>
      )}

      <div className="mt-3 space-y-3">
        <EvaluationSideBlock
          side={current.live}
          title="Karar veren sıralama"
          placedManufacturerId={placedId}
        />

        {/* Her gölge karşılaştırması KENDİ adıyla: hangisinin sürekli mesafe,
            hangisinin ağırlık denemesi olduğu sürüm kodundan okunmamalı. */}
        {comparisons.map((c) => (
          <div key={c.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-indigo-900">
                {comparisonTitleTr(c)}
              </span>
              <code className="rounded bg-white px-1 text-[10px] text-gray-600">
                {c.weightsVersion}
              </code>
              {c.agrees && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
                  aynı atölyeyi seçti
                </span>
              )}
              {c.differs && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
                  başka bir atölye seçti
                </span>
              )}
              {!c.agrees && !c.differs && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
                  yalnız bir taraf atölye seçebildi
                </span>
              )}
            </div>
            <EvaluationSideBlock
              side={c.shadow}
              title={`${comparisonTitleTr(c)} (karara etki etmedi)`}
              placedManufacturerId={placedId}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
        <span>
          Bu kararın karşılaştırmaları:{" "}
          {current.comparisons.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <code className="rounded bg-white px-1">{c.weightsVersion}</code>
            </span>
          ))}
        </span>
        <Link
          href="/admin/scoring-evaluations"
          className="font-medium text-indigo-700 hover:underline"
        >
          Tüm değerlendirmeler →
        </Link>
      </div>

      {earlier.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-600 hover:text-gray-900">
            Önceki atama kararları ({earlier.length})
          </summary>
          <div className="mt-2 space-y-2">
            {earlier.map((d) => (
              <div
                key={d.key}
                className="rounded-xl border border-gray-200 bg-white p-3"
              >
                <p className="text-[11px] text-gray-500">
                  {formatDateTime(d.createdAt, loc)}
                </p>
                <p className="mt-1 text-xs text-gray-700">
                  Sıralamanın birincisi:{" "}
                  <strong>{d.live.winnerName ?? "—"}</strong>
                </p>
                {/* Satırlar biriktiği için bu liste artık gerçek geçmiştir:
                    "bu iş kaç kez el değiştirdi" sorusunu ancak kararın İŞİ
                    KİME VERDİĞİ cevaplar, sıralamanın birincisi değil. */}
                {(() => {
                  const p = placementLabel(d);
                  if (p.kind === "named") {
                    return (
                      <p className="text-xs text-gray-700">
                        İşi alan: <strong>{p.name}</strong>
                      </p>
                    );
                  }
                  if (p.kind === "unnamed") {
                    return (
                      <p className="text-xs text-gray-700">
                        İşi alan: <strong>adı çözülemedi</strong> (kayıttaki
                        kimlik:{" "}
                        <code className="rounded bg-gray-100 px-1">
                          {p.shortId}…
                        </code>
                        )
                      </p>
                    );
                  }
                  return (
                    <p className="text-xs text-gray-500">
                      İşi alan: bilinmiyor (kayıtta yok)
                    </p>
                  );
                })()}
                <ul className="mt-1 space-y-0.5">
                  {d.comparisons.map((c) => (
                    <li key={c.id} className="text-[11px] text-gray-600">
                      {comparisonTitleTr(c)} ({c.weightsVersion}):{" "}
                      {c.shadow.winnerName ?? "—"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * "Bu iş neden bu boyacıya gitti?"
 *
 * Kaynak, atama kararının ANINDA yazılmış değerlendirme satırıdır; kart onu
 * OKUR, yeniden hesaplamaz. Sayfa açılışında yeniden sıralasaydı yük,
 * güvenilirlik ve QC geçmişi o günden beri değiştiği için admin'e kararı
 * açıklamayan — hatta onunla çelişen — bir tablo gösterirdi.
 *
 * Üretici ikizinden (AssignmentEvaluationCard) iki farkı var ve ikisi de
 * tabloda sütun: boyacı tarafında bir karar TEK satır yazar (gölge sıralama
 * yok), ama kararın NEDEN o an alındığı değişir — QC onayı, ret sonrası,
 * 24 saat cevapsızlık, elle atama. O yüzden manşette karşılaştırma değil
 * TETİKLEYİCİ durur.
 *
 * "Kimse yerleşmedi" hâli sessizce geçilmez: o sipariş admin kuyruğunda
 * bekliyordur ve kartın işi tam da bunu söylemektir.
 */
function PainterEvaluationCard({
  decisions,
  assignedPainterId,
  refunded,
  assignBoxOnScreen,
  loc,
}: {
  decisions: PainterEvaluation[];
  /** Siparişte ŞU AN duran boyacı — kararın sonucu olmayabilir. */
  assignedPainterId: string | null;
  /** İade edilmiş sipariş: bu siparişe artık boyacı ATANMAZ. */
  refunded: boolean;
  /**
   * Elle atama kutusu ŞU ANDA ekranda mı? Kart tavsiye verirken sayfanın
   * gerçeğine bakmalı: kutu iade edilmiş siparişte hiç render edilmiyor.
   */
  assignBoxOnScreen: boolean;
  loc: Locale;
}) {
  const current = decisions[0];
  if (!current) return null;
  const earlier = decisions.slice(1);
  const placement = painterPlacementLabel(current);
  const outcome = painterOutcomeReasonLabelTr(current.outcomeReason);
  // Sıralamanın birincisi ile işi ALAN boyacı ayrıştıysa sebep, kaydın
  // söyleyebildiği kadar söylenir: dışlanmış, elle atanmış ya da bilinmiyor.
  const divergence = painterPlacementDivergence({
    placedPainterId: current.placedPainterId,
    winnerPainterId: current.winnerPainterId,
    winnerName: current.winnerName,
    excludedPainterIds: current.excludedPainterIds,
    trigger: current.trigger,
  });
  // Karardan sonra el değiştirmiş mi? Devir, sıralamanın hatası DEĞİLDİR.
  const handedOff =
    !!current.placedPainterId &&
    !!assignedPainterId &&
    current.placedPainterId !== assignedPainterId;

  return (
    <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fuchsia-900">
          Bu iş neden bu boyacıya gitti?
        </h3>
        <span className="text-xs text-gray-500">
          {formatDateTime(current.createdAt, loc)}
        </span>
      </div>

      <p className="mt-2 text-xs text-fuchsia-900/80">
        Karar sebebi: <strong>{painterTriggerLabelTr(current.trigger)}</strong>.
        Skorlar atama anında kaydedildi; bugünkü yük ve güvenilirlik
        değerleriyle yeniden hesaplanmaz. 100 en iyi, 0 en kötüdür.
      </p>

      {placement.kind === "named" && (
        <p className="mt-2 text-xs text-fuchsia-900">
          Bu karar işi <strong>{placement.name}</strong> atölyesine verdi.
        </p>
      )}

      {/* Kayıt bir boyacı YAZMIŞ ama adı çözülemiyor: bilinen yazılır, eksik
          olan da adıyla söylenir. */}
      {placement.kind === "unnamed" && (
        <p className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700">
          Bu karar işi bir boyacıya verdi, ama o boyacının{" "}
          <strong>adı çözülemedi</strong> (kaydı silinmiş olabilir). Kayıttaki
          kimlik:{" "}
          <code className="rounded bg-gray-100 px-1">{placement.shortId}…</code>
        </p>
      )}

      {/* Kimse yerleşmedi: sessizlik burada "karar yok" diye okunurdu, oysa iş
          admin kuyruğunda bekliyor olabilir.

          TALİMAT EKRANDA OLANI TARİF EDER. Ölçülen kusur: cümle koşulsuzca
          "yukarıdaki Boyacı ata kutusundan elle atayabilirsiniz" diyordu, ama o
          kutu yalnız canlı ve QC'den geçmiş bir siparişte render ediliyor —
          iade edilmiş siparişte ekranda hiç yok. Admin, var olmayan bir kutuya
          yönlendiriliyordu. */}
      {placement.kind === "unrecorded" && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Bu kararda <strong>hiçbir boyacıya iş verilmedi</strong>
          {outcome ? `: ${outcome}` : " (sebep kayıtta yok)"}.{" "}
          {refunded
            ? "Sipariş iade edildiği için artık boyacı atanmaz: ekranda elle atama kutusu yok ve otomatik atama da iade edilmiş siparişi geçmez. Bu kayıt yalnızca o günkü kararı gösterir; yapmanız gereken bir işlem yok."
            : assignBoxOnScreen
              ? "Sipariş, bir boyacı atanana kadar bekler — yukarıdaki “Boyacı ata” kutusundan elle atayabilirsiniz."
              : "Sipariş, bir boyacı atanana kadar bekler. Elle atama kutusu şu anda ekranda değil (iş bir boyacıda duruyor, baskı henüz QC onayından geçmedi ya da boyacı listesi getirilemedi); yukarıdaki boyacı bölümü hangi adımın beklendiğini söylüyor."}
        </p>
      )}

      {divergence && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {divergence.kind === "excluded" ? (
            <>
              İşi alan boyacı, sıralamanın birincisi değil: birinci sıradaki{" "}
              <strong>{divergence.winnerName ?? "boyacı"}</strong> bu denemede
              hariç tutulmuştu (işi daha önce reddetmiş ya da 24 saat cevapsız
              kalmış), bu yüzden iş sıradaki uygun boyacıya verildi.
            </>
          ) : divergence.kind === "manual" ? (
            <>
              İşi alan boyacı, sıralamanın birincisi değil:{" "}
              <strong>admin elle</strong> başka bir boyacı seçti. Sıralamanın
              birincisi{" "}
              <strong>{divergence.winnerName ?? "—"}</strong> idi.
            </>
          ) : (
            <>
              İşi alan boyacı, sıralamanın birincisi değil. İki sebebi olabilir:
              birinci bu denemede hariç tutulmuş olabilir ya da iş elle atanmış
              olabilir. Kayıt hangisi olduğunu söylemiyor.
            </>
          )}
        </p>
      )}

      {handedOff && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          İş bu karardan sonra başka bir boyacıya devredildi; siparişte şu an
          duran boyacı bu kararın sonucu değildir.
        </p>
      )}

      <div className="mt-3">
        <PainterCandidateBreakdownCard decision={current} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
        <span>
          Ağırlık sürümü:{" "}
          <code className="rounded bg-white px-1">
            {current.weightsVersion ?? "—"}
          </code>
        </span>
        <Link
          href="/admin/scoring-evaluations?taraf=boyaci"
          className="font-medium text-fuchsia-700 hover:underline"
        >
          Tüm boyacı kararları →
        </Link>
      </div>

      {earlier.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-600 hover:text-gray-900">
            Önceki boyacı kararları ({earlier.length})
          </summary>
          <div className="mt-2 space-y-2">
            {earlier.map((d) => {
              const p = painterPlacementLabel(d);
              const reason = painterOutcomeReasonLabelTr(d.outcomeReason);
              return (
                <div
                  key={d.id}
                  className="rounded-xl border border-gray-200 bg-white p-3"
                >
                  <p className="text-[11px] text-gray-500">
                    {formatDateTime(d.createdAt, loc)} ·{" "}
                    {painterTriggerLabelTr(d.trigger)}
                  </p>
                  <p className="mt-1 text-xs text-gray-700">
                    Sıralamanın birincisi:{" "}
                    <strong>{d.winnerName ?? "—"}</strong>
                  </p>
                  {p.kind === "named" && (
                    <p className="text-xs text-gray-700">
                      İşi alan: <strong>{p.name}</strong>
                    </p>
                  )}
                  {p.kind === "unnamed" && (
                    <p className="text-xs text-gray-700">
                      İşi alan: <strong>adı çözülemedi</strong> (kimlik:{" "}
                      <code className="rounded bg-gray-100 px-1">
                        {p.shortId}…
                      </code>
                      )
                    </p>
                  )}
                  {p.kind === "unrecorded" && (
                    <p className="text-xs text-gray-500">
                      Kimse yerleşmedi{reason ? `: ${reason}` : " (sebep kayıtta yok)"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Kararın aday dökümü: kim kaçıncı, hangi bileşenden kaç puan aldı.
 *
 * "Seçilen" ile "işi alan" AYRI işaretlenir; admin elle başkasını seçtiğinde
 * ikisi ayrışır ve tek bir rozet kararı yanlış anlatırdı. Elenen adayın SEBEBİ
 * de yazılır: listede sessizce duran bir boyacı, "neden bu skorla seçilmedi"
 * sorusunu cevapsız bırakıyordu.
 */
function PainterCandidateBreakdownCard({
  decision,
}: {
  decision: PainterEvaluation;
}) {
  if (decision.candidates.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <p className="text-[11px] text-gray-500">
          Bu karar için aday dökümü kaydedilmemiş.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <ul className="space-y-2">
        {decision.candidates.map((c, i) => {
          const isWinner =
            !!c.painterId && c.painterId === decision.winnerPainterId;
          const isPlaced =
            !!c.painterId && c.painterId === decision.placedPainterId;
          return (
            <li
              key={c.painterId ?? i}
              className={`rounded-lg p-2 ${
                isWinner ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-800">
                  {c.companyName ?? "—"}
                  {isWinner && (
                    <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">
                      seçilen
                    </span>
                  )}
                  {isPlaced && !isWinner && (
                    <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">
                      işi alan
                    </span>
                  )}
                  {c.eligible === false && (
                    <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                      elendi
                    </span>
                  )}
                </span>
                <span className="text-xs font-bold text-gray-700">
                  {c.totalScore ?? "—"}
                </span>
              </div>
              {c.eligible === false && c.ineligibleReason && (
                <p className="mt-0.5 text-[10px] text-amber-700">
                  {c.ineligibleReason}
                </p>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {PAINTER_SCORE_KEYS.filter((k) => c.scores[k] !== undefined).map(
                  (k) => (
                    <span
                      key={k}
                      title={PAINTER_SCORE_LABELS_TR[k]}
                      className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-gray-600 ring-1 ring-gray-200"
                    >
                      {PAINTER_SCORE_SHORT_LABELS_TR[k]} {c.scores[k]}
                    </span>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {decision.excludedPainterIds.length > 0 && (
        <p className="mt-2 text-[10px] text-gray-500">
          Bu denemede {decision.excludedPainterIds.length} boyacı sıralamaya hiç
          sokulmadı (daha önce reddetmiş ya da 24 saat cevapsız kalmış).
        </p>
      )}
    </div>
  );
}

/** Partnerin sürüm onay durumu (sunucuda partner-model-ack.ts hesaplar). */
interface PartnerAckState {
  announcedRevision: number | null;
  acknowledgedRevision: number | null;
  pending: boolean;
  /**
   * Partnerin eylem günlüğü OKUNAMADI (geçici arıza). `pending: true` ile
   * birlikte gelir ama ikisi AYNI ŞEY DEĞİLDİR: bekleyen onay gerçek bir
   * duyuruya dayanır, bu ise hiçbir şey bilmediğimiz anlamına gelir. Kart önce
   * buna bakar; yoksa "null. sürümü onaylamadı" gibi olmamış bir olayı
   * anlatırdı.
   */
  readFailed?: boolean;
}

// ─── Faz 2: her aşamada model yükleme ────────────────────────
// Kuralın kendisi SUNUCUDA (config/order-model-policy.ts) ve sayfaya hazır
// geliyor; burada yalnız ekran karşılıkları durur. İstemcide ikinci bir kural
// kopyası tutmak, kapıyla ekranın ayrı düşmesi demekti — aynı hata "Reddet"
// butonunda bir kez yaşandı (order-status-policy.ts).
const MODEL_UPLOAD_STAGE_LABEL: Record<ModelUploadStage, string> = {
  before_production: "Üretim başlamadı",
  printing: "Üretici basıyor",
  printed_or_qc: "Baskı bitti / kalite kontrol",
  painting: "Parça boyacıda",
  awaiting_customer_approval: "Müşteri onayı bekleniyor",
  shipped_or_delivered: "Kargolandı / teslim edildi",
  blocked: "Yükleme kapalı",
};

/**
 * Yeni sürümün bu aşamada NE yaptığı. Kutu (önce) ile sonuç paneli (sonra) aynı
 * cümleleri kullanır: admin ne olacağını okuyup onayladıysa, ne olduğunu da
 * aynı kelimelerle görür.
 */
function sideEffectLines(e: ModelUploadSideEffects): string[] {
  const lines: string[] = [];
  if (e.resetsQc) {
    lines.push(
      "Kalite kontrol sıfırlanır: tur artar, bekleyen QC fotoğrafları reddedilir, üretici baskı aşamasına döner ve yeni sürüm QC geçmeden kargolayamaz."
    );
  }
  if (e.needsManufacturerAck) {
    // Hangi adımların kapandığı TAM olarak yazılır: kapıyı uygulayan liste
    // MANUFACTURER_ACK_BLOCKED_ACTIONS (partner-model-ack.ts). "Baskı, QC ve
    // kargo" demek kabul/ret adımlarını da kapalı sanmaya yol açıyordu.
    lines.push(
      "Üreticinin yeni sürümü gördüğünü onaylaması istenir; onaylayana kadar baskıya başlama, baskıyı bitirme, QC'ye gönderme, boyacıya devretme ve kargolama adımları kapalıdır (üretici adına yapılan işlemler dahil). İşi kabul etmesi ve reddetmesi kapanmaz."
    );
  }
  if (e.notifiesPainter) {
    lines.push("Boyacı bilgilendirilir: elindeki baskı eski sürüme ait olabilir.");
  }
  if (e.newApprovalRound) {
    lines.push("Müşteriye yeni bir onay turu açılır; eski onay geçerli sayılmaz.");
  }
  if (e.recordOnly) {
    lines.push(
      "Üretim etkilenmez; yükleme kayda geçer ve dijital dosya satın alan müşteri yeni sürümü indirebilir."
    );
  }
  return lines;
}

/**
 * Sunucunun GERÇEKTEN uyguladığı yan etkiler (upload-model yanıtı, P2-C2).
 *
 * Politika "ne olmalı"yı söyler, bu nesne "ne oldu"yu — ve ikisi ayrılabilir:
 * QC sıfırlaması tek bir koşullu UPDATE'tir, sipariş o arada QC aşamasından
 * çıktıysa uygulanmaz. Paneli politikadan yeniden kurmak, tam da bu durumu
 * admin'e "başarılı" diye gösteriyordu.
 */
interface AppliedModelSideEffects {
  qcReset: boolean;
  qcRound: number | null;
  approvalRoundOpened: boolean;
  manufacturerAckRequired: boolean;
  painterNotified: boolean;
}

interface ModelUploadServerResult {
  stage: ModelUploadStage | null;
  warning: string | null;
  /** Yayımlanan (CANLI) sürüm. */
  revision: number | null;
  /** Geri getirmede KAYNAK sürüm (upload-model PATCH); yüklemede yoktur. */
  sourceRevision: number | null;
  /**
   * Geri getirme gerçekten yeni bir sürüm yayımladı mı? `false` = sürüm zaten
   * geçerliydi, sunucu HİÇBİR yan etki uygulamadı. Yüklemede alan yoktur.
   */
  republished: boolean | null;
  applied: AppliedModelSideEffects | null;
}

/** Yükleyicinin ilettiği ham yanıtı okur; tanımadığı her şeyi düşürür. */
function parseUploadResult(raw: unknown): ModelUploadServerResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const stage =
    typeof o.stage === "string" && o.stage in MODEL_UPLOAD_STAGE_LABEL
      ? (o.stage as ModelUploadStage)
      : null;
  const a = (o.appliedSideEffects ?? null) as Record<string, unknown> | null;
  return {
    stage,
    warning: typeof o.warning === "string" && o.warning ? o.warning : null,
    revision: typeof o.revision === "number" ? o.revision : null,
    sourceRevision: typeof o.sourceRevision === "number" ? o.sourceRevision : null,
    republished: typeof o.republished === "boolean" ? o.republished : null,
    applied: a
      ? {
          qcReset: a.qcReset === true,
          qcRound: typeof a.qcRound === "number" ? a.qcRound : null,
          approvalRoundOpened: a.approvalRoundOpened === true,
          manufacturerAckRequired: a.manufacturerAckRequired === true,
          painterNotified: a.painterNotified === true,
        }
      : null,
  };
}

/** Sunucunun bildirdiği sonucun ekran karşılıkları: ne OLDU. */
function appliedEffectLines(a: AppliedModelSideEffects): string[] {
  const lines: string[] = [];
  if (a.qcReset) {
    lines.push(
      `Kalite kontrol sıfırlandı${a.qcRound != null ? ` (tur ${a.qcRound})` : ""}: bekleyen QC fotoğrafları düştü, üretici baskı aşamasına döndü.`
    );
  }
  if (a.manufacturerAckRequired) {
    lines.push("Üreticiden yeni sürümü gördüğüne dair onay istendi.");
  }
  if (a.painterNotified) lines.push("Boyacı bilgilendirildi.");
  if (a.approvalRoundOpened) lines.push("Müşteriye yeni onay turu açıldı.");
  return lines;
}

/**
 * Beklenen ama UYGULANMAYAN yan etkiler. P2-C2 tam olarak bunun için var:
 * sessizce "başarılı" demek, eski modelin baskısını onaya açık bırakır.
 */
function missedEffectLines(
  expected: ModelUploadSideEffects | null,
  a: AppliedModelSideEffects
): string[] {
  const lines: string[] = [];
  if (expected?.resetsQc && !a.qcReset) {
    lines.push(
      "Kalite kontrol SIFIRLANMADI: sipariş bu sırada QC aşamasından çıkmış olabilir (ör. kargolandı). Üretim tarafını elle kontrol edin."
    );
  }
  if (expected?.needsManufacturerAck && !a.manufacturerAckRequired) {
    lines.push("Üretici onayı İSTENMEDİ: siparişte işi tutan bir üretici görünmüyor.");
  }
  if (expected?.notifiesPainter && !a.painterNotified) {
    lines.push("Boyacıya bildirim GİTMEDİ: siparişte işi tutan bir boyacı görünmüyor.");
  }
  return lines;
}

/**
 * Sonuç panelinin başlığı. Yükleme ile GERİ GETİRME aynı paneli kullanır (uç de
 * aynı: upload-model POST/PATCH), ama üç ayrı sonucu vardır ve üçü de admin'e
 * farklı şey söyler: yeni sürüm yüklendi, eski sürüm yeni numarayla yayımlandı,
 * ya da sürüm zaten geçerliydi ve hiçbir şey olmadı.
 */
function uploadResultTitle(r: {
  kind: "upload" | "restore";
  server: ModelUploadServerResult | null;
}): string {
  const live = r.server?.revision ?? null;
  const source = r.server?.sourceRevision ?? null;
  if (r.kind === "restore") {
    if (r.server?.republished === false) {
      return source != null
        ? `Sürüm ${source} zaten geçerliydi; değişiklik yapılmadı`
        : "Sürüm zaten geçerliydi; değişiklik yapılmadı";
    }
    if (source != null && live != null) {
      return `Sürüm ${source} geri getirildi (sürüm ${live} olarak yayımlandı)`;
    }
    return live != null ? `Sürüm geri getirildi (sürüm ${live})` : "Sürüm geri getirildi";
  }
  return live != null ? `Yeni sürüm kaydedildi (sürüm ${live})` : "Yeni sürüm kaydedildi";
}

/**
 * Sunucu hiçbir yan etki uygulamadığında yazılacak cümle. Yayımlamayan bir geri
 * getirmede "doğrudan geçerli model oldu" demek, OLMAYAN bir değişikliği
 * anlatmak olurdu.
 */
function noAppliedEffectsLine(
  kind: "upload" | "restore",
  republished: boolean | null
): string {
  if (kind === "restore" && republished === false) {
    return "Bu sürüm zaten geçerliydi: dosyalar değişmedi, QC sıfırlanmadı, üretici ve boyacıya bildirim gitmedi.";
  }
  if (kind === "restore") {
    return "Sunucu başka bir yan etki uygulamadı; geri getirilen sürüm doğrudan geçerli model oldu.";
  }
  return "Sunucu başka bir yan etki uygulamadı; yeni sürüm doğrudan geçerli model oldu.";
}

/** Admin'in partner adına yapabileceği adımlar (P2-C4 ile aynı adlar). */
type OnBehalfAction = "accept" | "start_printing" | "printed" | "submit_qc" | "ship";

const ON_BEHALF_LABELS: Record<"manufacturer" | "painter", Record<OnBehalfAction, string>> = {
  manufacturer: {
    accept: "İşi kabul etti olarak işaretle",
    start_printing: "Baskıya başladı olarak işaretle",
    printed: "Baskıyı bitirdi olarak işaretle",
    submit_qc: "Kalite kontrole gönder",
    ship: "Kargoladı olarak işaretle (takip numarasıyla)",
  },
  painter: {
    accept: "İşi kabul etti olarak işaretle",
    // Boyacıda "baskıyı başlat" adımı YOK: servis bunu unsupported_step ile
    // reddeder ve aşağıdaki seçenek listesi boyacı için hiç önermez. Etiket
    // yalnız tipin bütünlüğü için durur.
    start_printing: "—",
    printed: "Boyamayı bitirdi olarak işaretle",
    submit_qc: "Kalite kontrole gönder",
    ship: "Kargoladı olarak işaretle (takip numarasıyla)",
  },
};

/** Gerekçe barajı: sunucudaki ON_BEHALF_REASON_MIN_LENGTH ile aynı sayı. */
const ON_BEHALF_REASON_MIN = 10;

const APPROVAL_DECISION_LABEL: Record<string, string> = {
  approved: "Onayladı",
  revision: "Revizyon istedi",
  cancelled: "İptal etti",
  auto_approved: "Süre doldu, otomatik onaylandı",
};

const CARRIER_LABEL: Record<string, string> = {
  yurtici: "Yurtiçi Kargo",
  aras: "Aras Kargo",
  mng: "MNG Kargo",
  ptt: "PTT Kargo",
  surat: "Sürat Kargo",
  other: "Diğer",
  elden: "Elden teslim",
};

interface PartnerChatMessage {
  id: string;
  sender: string;
  senderEmail: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
}

/**
 * Boyacı ↔ yönetici sohbeti.
 *
 * Neden OrderChat DEĞİL: o bileşen `messages` tablosunun kanallarını konuşur
 * (senderType + FormData + görsel eki). Boyacı kanalı ayrı bir tabloda yaşıyor
 * (order_partner_messages — `messages.channel` bir pg enum ve geri alınabilir
 * olması gereken bir şey için enum'a değer eklenmez), gövdesi düz JSON ve eki
 * yok. Tek bileşene sığdırmak ikisini de yanlış anlatırdı.
 */
function PartnerChatPanel({ orderId, loc }: { orderId: string; loc: Locale }) {
  const [messages, setMessages] = useState<PartnerChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const url = `/api/admin/orders/${orderId}/partner-messages?partner=painter`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(url);
      const data = (await res.json().catch(() => ({}))) as {
        messages?: PartnerChatMessage[];
        unavailable?: string;
        error?: string;
      };
      if (!res.ok) {
        setNotice(data.error ?? "Mesajlar okunamadı.");
        setLoaded(true);
        return;
      }
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setNotice(data.unavailable ?? null);
      setLoaded(true);
    } catch {
      setNotice("Mesajlar okunamadı.");
      setLoaded(true);
    }
  }, [url]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice(data.error ?? "Mesaj gönderilemedi.");
        return;
      }
      setText("");
      await load();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="h-80 space-y-3 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3">
        {!loaded ? (
          <p className="py-8 text-center text-sm text-gray-400">Yükleniyor…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">Henüz mesaj yok.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.mine
                    ? "bg-indigo-600 text-white"
                    : "border border-gray-200 bg-white text-gray-800"
                }`}
              >
                {!m.mine && (
                  <p className="mb-0.5 text-[10px] font-semibold opacity-70">Boyacı</p>
                )}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-0.5 text-[10px] ${m.mine ? "text-indigo-200" : "text-gray-400"}`}>
                  {formatDateTime(m.createdAt, loc)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      {notice && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{notice}</p>
      )}
      <div className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          maxLength={4000}
          placeholder="Boyacıya mesaj yaz…"
          className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!text.trim() || sending}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300"
        >
          {sending ? "Gönderiliyor…" : "Gönder"}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────
export function OrderDetailClient({ data, locale }: Props) {
  const { order, printGate, approvedImageUrl, photos, modelRevisions, modelRevisionsUnreadable, latestGeneration, latestReport, generationAttempts, adminActions, adminMessages, manufacturer, painter, manufacturerActions: mfgActions, manufacturerActionsUnreadable, manufacturerStatus, painting, journey, qcPhotos, qcReviews, qcRound, qcRevisionMismatch, qcProof, assignedToManufacturerAt, manufacturerAcceptedAt, manufacturerPrintedAt, assignmentAgeHours, activeManufacturers, candidates, assignmentDecisions, painterAssignmentDecisions, declinedManufacturers, modelUpload, modelApproval, partnerAck, onBehalfHolder, money, readFailures } = data;
  // Turun onaylanamama sebebi TEK yerde cümleye çevrilir: kırmızı kutu, kapalı
  // onay düğmesinin başlığı, denetimli istisnanın bağlantısı ve onay kutusu
  // aynı sebebi anlatsın. Dördü ayrı ayrı yazıldığında ekran "eski baskı"
  // derken veri yalnızca "doğrulanamadı" diyordu.
  const qcProofView = qcProofRefusalView(qcProof);
  // FOTOĞRAF TABLOSU OKUNAMADIĞINDA DENETİMİN ADI DA DEĞİŞİR.
  //
  // qcProof okunamayan tabloyu SIFIR fotoğraf olarak görür ve hâli "fotoğrafsız
  // tur" diye adlandırır; oysa ortada yapılmamış bir okuma vardır. Kapı iki
  // hâlde de kapalı, ama admin'e imzalatılan cümle aynı olamaz: "tek bir
  // fotoğraf olmadan onayladım" ile "fotoğrafları göremeden onayladım" farklı
  // şeylerdir ve gerekçe denetim kaydına bu adla düşer. Uç da aynı ayrımı
  // yapıyor (qc-approve · proof: "photos_unreadable") ve gerekçeli onayı bu
  // arızada da KABUL ediyor — yani ekranın sunduğu denetimin çalışan bir ucu var.
  const qcCardView: QcProofRefusalView = readFailures?.qcPhotos
    ? {
        banner: qcProofView.banner,
        gateTitle:
          "Bu turun QC fotoğrafları okunamadı; kanıt görülemediği için onay kapalı tutuldu.",
        overrideLink: "Yine de onayla: fotoğrafları okunamayan turu gerekçeyle kabul et",
        overrideEffect:
          "Bu onay, turun QC fotoğrafları GÖRÜLMEDEN baskıyı kargoya açar ve üreticinin hakedişi " +
          "tahakkuk eder. Fotoğraflar silinmedi, yalnızca okunamıyor. Gerekçe denetim kaydına " +
          "[QC fotoğrafları okunamadı] olarak, QC turu kaydına ve üreticiye giden bildirime aynen yazılır.",
      }
    : qcProofView;
  const router = useRouter();
  const d = useDictionary();
  const loc = locale as Locale;
  const statusLabel = (status: string): string => orderStatusLabel(d, status);

  const [loading, setLoading] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  // Elle kargolama taşıyıcısı: POST /ship şemasında `carrier` ZORUNLU (firmasız
  // takip numarası müşteriye açılmayan bir bağlantı demek), o yüzden alan
  // ekranda da vardır — düğme onsuz 400 alıyordu.
  const [manualShipCarrier, setManualShipCarrier] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedManufacturerId, setSelectedManufacturerId] = useState("");
  // Revoke controls (unresponsive / wrong manufacturer).
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeStrike, setRevokeStrike] = useState(false);
  const [revokeBlocklist, setRevokeBlocklist] = useState(true);
  // "Kuyruğumda kalsın": geri alınan sipariş otomatik olarak yeniden
  // yerleştirilmesin. Varsayılan kapalı, çünkü fazın amacı tıklama beklemeyen
  // siparişler; admin tersini isterse (müşteriyle konuşulacak, iade
  // düşünülüyor, üretici elle seçilecek) bilerek işaretler.
  const [revokeKeepInQueue, setRevokeKeepInQueue] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  // Revoke-from-painter controls (bad hand-off → back to assignment queue).
  const [revokePainterReason, setRevokePainterReason] = useState("");
  const [revokePainterOpen, setRevokePainterOpen] = useState(false);
  const [revokePainterBlocklist, setRevokePainterBlocklist] = useState(true);
  // "Kuyruğumda kalsın": boyacıdan geri alınan sipariş de otomatik olarak yeni
  // bir üreticiye yerleşiyor (revoke-after-painter.ts, para mutabakatından
  // sonra). Üretici geri almasıyla aynı seçenek, aynı varsayılan: kapalı.
  const [revokePainterKeepInQueue, setRevokePainterKeepInQueue] = useState(false);
  // Güvenilirlik cezası (strike) — üretici geri almasındaki `revokeStrike`in
  // ikizi. Varsayılan KAPALI: geri alma her zaman boyacının kusuru değildir
  // (müşteri vazgeçti, adres değişti, iş acele başkasına verildi), o yüzden
  // cezayı admin AÇIKÇA ister. Rota bu alanı Faz 1'den beri kabul ediyordu
  // (revoke-painter/route.ts · şema `.strict()`, `strike: z.boolean()`) ama
  // panel onu hiç GÖNDERMİYORDU: boyacı tarafında ceza fiilen hiç yazılmadı ve
  // askıya alma eşiği (3) hiç dolmadı.
  const [revokePainterStrike, setRevokePainterStrike] = useState(false);
  // Admin-side painter hand-off (used when the manufacturer never sent it, or
  // after a revoke/decline left the job with nobody).
  const [painterPick, setPainterPick] = useState("");
  const [painterCarrier, setPainterCarrier] = useState("");
  const [painterTracking, setPainterTracking] = useState("");
  // Boyama kalemi olmadan satılmış siparişe boyacı payı ekleme.
  const [paintingAmount, setPaintingAmount] = useState("");
  const [addPaintingReason, setAddPaintingReason] = useState("");
  const [addPaintingError, setAddPaintingError] = useState<string | null>(null);
  const [showAddPainting, setShowAddPainting] = useState(false);
  const [journeyCopied, setJourneyCopied] = useState(false);
  const [qcRejectReason, setQcRejectReason] = useState("");
  // Denetimli ESKİ SÜRÜM onayı (qc-approve · overrideStaleRevision): gerekçe
  // zorunlu olduğu için kutu bilerek açılır, tek tıkla geçilemez.
  const [staleOverrideOpen, setStaleOverrideOpen] = useState(false);
  const [staleOverrideReason, setStaleOverrideReason] = useState("");
  // Boyacı kanalı ayrı bir tabloda yaşıyor (order_partner_messages); sekme
  // aynı yerde durur, bileşen farklıdır.
  const [chatTab, setChatTab] = useState<"customer_admin" | "manufacturer_admin" | "painter_admin">(
    "customer_admin"
  );
  // Refund card: collapsed by default; opens to the warning + reason field.
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  // ─── Faz 2: her aşamada model yükleme ────────────────────
  // Yükleyici doğrudan açılmaz: aşama uyarısı okunur, kutu bilerek açılır ve
  // gereken aşamalarda gerekçe yazılmadan dosya seçilemez.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [uploadResult, setUploadResult] = useState<{
    /** Yeni dosya yüklemesi mi, eski bir sürümün geri getirilmesi mi? */
    kind: "upload" | "restore";
    stage: ModelUploadStage;
    /** Yükleme anında BEKLENEN etkiler; sunucununkiyle karşılaştırmak için. */
    effects: ModelUploadSideEffects;
    note: string;
    /** Sunucunun bildirdiği sonuç (P2-C2). Okunamazsa null. */
    server: ModelUploadServerResult | null;
  } | null>(null);
  // Sürüm yönetimi: not düzenleme kutusu (tek seferde tek sürüm).
  const [revisionNoteDraft, setRevisionNoteDraft] = useState<{
    revision: number;
    text: string;
  } | null>(null);
  // Müşteri bilgileri (ad, e-posta, telefon, müşteri notu).
  const [customerEditing, setCustomerEditing] = useState(false);
  const [custName, setCustName] = useState(order.customerName);
  const [custEmail, setCustEmail] = useState(order.email);
  const [custPhoneCountry, setCustPhoneCountry] = useState<CountryCode>(
    () => e164ToPhoneInput(order.phone).country
  );
  const [custPhoneNational, setCustPhoneNational] = useState(
    () => e164ToPhoneInput(order.phone).nationalNumber
  );
  const [custNote, setCustNote] = useState(order.customerNote ?? "");
  // Kargo: taşıyıcı + takip numarası düzeltme, kargo/teslim kaydını geri alma.
  const [shipEditing, setShipEditing] = useState(false);
  const [shipCarrier, setShipCarrier] = useState(order.carrier ?? "");
  const [shipTracking, setShipTracking] = useState(order.trackingNumber ?? "");
  const [shipNotify, setShipNotify] = useState(true);
  const [revertOpen, setRevertOpen] = useState(false);
  const [revertReason, setRevertReason] = useState("");
  // Müşteri model onayı: telefonla/WhatsApp ile gelen kararı kaydetme.
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordDecision, setRecordDecision] = useState<"approved" | "revision">("approved");
  const [recordChannel, setRecordChannel] = useState<"phone" | "whatsapp">("phone");
  const [recordNote, setRecordNote] = useState("");
  // Partner adına işlem (P2-C4): gerekçe ZORUNLU.
  const [onBehalfAction, setOnBehalfAction] = useState<OnBehalfAction | "">("");
  const [onBehalfReason, setOnBehalfReason] = useState("");
  const [onBehalfTracking, setOnBehalfTracking] = useState("");
  const [onBehalfCarrier, setOnBehalfCarrier] = useState("");
  // Boyacı QC kararı + yalnız boyacıyı değiştirme.
  const [painterQcReason, setPainterQcReason] = useState("");
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapPainterId, setSwapPainterId] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [swapBlocklist, setSwapBlocklist] = useState(false);
  // Devirde parçanın YENİ sevkiyatı — atama kutusundaki iki alanın aynısı.
  // Bu alanlar yokken devir, kolisi yolda olan HER siparişte 409
  // (parcel_in_transit) ile geri dönüyordu ve admin'in panelden uyabileceği
  // bir yol kalmıyordu: geriye yalnız "boyacıdan geri al" kalıyor, o da iki
  // partneri birden koparıyordu. Devir kutusu, koliyi açıkça devretmenin yeri.
  const [swapCarrier, setSwapCarrier] = useState("");
  const [swapTracking, setSwapTracking] = useState("");
  // Yeni uçların hatası: sayfanın üstünde tek bir yerde görünür.
  const [actionError, setActionError] = useState<string | null>(null);
  // BAŞARILI ama EKSİK kalan işlemin uyarısı (uçların `warning` alanı).
  // Ölçülen kusur: uç 200 + Türkçe uyarı dönüyordu ("karar kaydı yazılamadı"),
  // panel gövdeyi yalnız hata dalında okuduğu için uyarı yere düşüyordu; admin
  // işlemin eksik tamamlandığını hiçbir yerde görmüyordu. Hata KUTUSUNDAN AYRI
  // durur: işlem geçerlidir, kırmızı bir kutu onu başarısız gösterirdi.
  const [actionWarning, setActionWarning] = useState<string | null>(null);


  // Edit state
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState(order.adminNotes || "");
  const [editAddress, setEditAddress] = useState(order.shippingAddress);
  // Technical spec (size / material / finish + free-form rows like colour).
  const [specSize, setSpecSize] = useState(order.figurineSize || "");
  const [specSizeError, setSpecSizeError] = useState<string | null>(null);
  const [specSizePreview, setSpecSizePreview] = useState<string | null>(null);
  const [specMaterial, setSpecMaterial] = useState(order.material || "");
  const [specFinish, setSpecFinish] = useState(order.finish || "");
  // The typed fields above own Boyut/Malzeme/Boyama — seeding them as editable
  // rows too would write duplicate, contradictory spec lines on every save.
  const [specAttrs, setSpecAttrs] = useState<{ name: string; value: string }[]>(
    () => {
      const owned = ["boyut", "malzeme", "boyama / yüzey"];
      const rows = order.selectedOptions
        .filter((o) => !owned.includes(o.groupName.toLocaleLowerCase("tr")))
        .map((o) => ({ name: o.groupName, value: o.choiceName }));
      return rows.length > 0 ? rows : [{ name: "Renk", value: "" }];
    }
  );
  const [editTelefonCountry, setEditTelefonCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [editTelefonNational, setEditTelefonNational] = useState("");

  // Messaging state (email-only after WhatsApp removal)
  const [selectedTemplate, setSelectedTemplate] = useState("custom");
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [msgSent, setMsgSent] = useState(false);

  // Collapsible sections
  const [messagingOpen, setMessagingOpen] = useState(false);
  const [meshReportOpen, setMeshReportOpen] = useState(false);

  // Print-gate override: in enforce mode a failing verdict may only be approved
  // with a written reason, which the approve route demands (409
  // `gate_override_required`) and files into the admin action log.
  const [gateOverrideReason, setGateOverrideReason] = useState("");

  // Detail view tab (Özet / Üretim / İletişim / Geçmiş)
  const [tab, setTab] = useState<"summary" | "production" | "communication" | "history">("summary");

  // ─── Actions ─────────────────────────────────────────────
  /**
   * A refused action usually means the order changed under this page: refunded
   * in another tab, re-assigned, shipped by the partner. Showing only the error
   * left the stale page offering the same button again (a refund answered 409
   * "Sipariş zaten iade edilmiş." and still showed "İade et"), so every failure
   * also reloads the server data.
   */
  const reportFailure = (message: string) => {
    alert(message);
    router.refresh();
  };

  const performAction = async (action: string, body: Record<string, any> = {}) => {
    setLoading(action);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, notes: notes || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        reportFailure(data.error || `${action} ${d["admin.orderDetail.actionFailed"]}`);
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  /**
   * Denetimli ESKİ SÜRÜM QC onayı (POST qc-approve · overrideStaleRevision).
   *
   * Normal onay yolu uyuşmazlıkta kapalıdır ve öyle kalır. Karar
   * (late-model-upload) yine de bilinçli bir istisnaya izin veriyor: tek bir
   * yanlış damgalanmış fotoğraf yüzünden turun tek çıkışı qc-reject olmasın.
   * Bedava değildir — gerekçeyi SUNUCU şart koşar
   * (STALE_QC_OVERRIDE_REASON_MIN) ve denetim kaydına, QC turu kaydına ve
   * üreticiye giden bildirime aynen yazar. Buradaki kontrol yalnız, reddedileceği
   * baştan belli bir isteği hiç göndermemek içindir.
   */
  const approveStaleQc = async () => {
    const reason = staleOverrideReason.trim();
    if (reason.length < STALE_QC_OVERRIDE_REASON_MIN) {
      alert(STALE_QC_OVERRIDE_REASON_ERROR);
      return;
    }
    const ok = window.confirm(
      [
        // Damgasız ya da fotoğrafsız bir tura "eski baskı" demek, admin'e
        // olmayan bir olguyu imzalatmak olurdu: cümle sebebe göre değişir.
        qcCardView.gateTitle,
        qcCardView.overrideEffect,
        `Gerekçe: ${reason}`,
        "",
        "Devam edilsin mi?",
      ].join("\n")
    );
    if (!ok) return;
    await performAction("qc-approve", {
      overrideStaleRevision: true,
      overrideReason: reason,
    });
    setStaleOverrideOpen(false);
    setStaleOverrideReason("");
  };

  /**
   * Faz 2 uçları tek tek yayına giriyor. Eksik bir uç 404 + HTML döndürür ve
   * JSON'a çevrilemeyen yanıt eskiden ekranda hiçbir iz bırakmıyordu
   * ("tıkladım, bir şey olmadı"). Sebep her hâlde yazılır.
   */
  const callApi = async (
    path: string,
    init: RequestInit
  ): Promise<{ ok: boolean; error: string; data: Record<string, unknown> }> => {
    let res: Response;
    try {
      res = await fetch(path, init);
    } catch {
      return { ok: false, error: "Sunucuya ulaşılamadı.", data: {} };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, error: "", data };
    const message =
      typeof data.error === "string" && data.error
        ? data.error
        : res.status === 404
          ? "Bu işlemin sunucu ucu bu kurulumda yok."
          : `${d["admin.orderDetail.actionFailed"]} (HTTP ${res.status})`;
    return { ok: false, error: message, data };
  };

  /** Uçların başarı gövdesindeki Türkçe uyarı (yoksa null). */
  const responseWarning = (data: Record<string, unknown>): string | null =>
    typeof data.warning === "string" && data.warning.trim() ? data.warning : null;

  const jsonInit = (body: unknown, method = "POST"): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  /** Tek bir uç çağrısı: kilit, hata kutusu ve tazeleme aynı yerde. */
  const runApi = async (
    key: string,
    path: string,
    init: RequestInit,
    // Sunucunun yanıtı çağırana GEÇER: bir işlemin gerçekte ne yaptığını
    // (aşama, uygulanan yan etkiler) yalnız yanıt biliyor.
    onDone?: (data: Record<string, unknown>) => void
  ): Promise<boolean> => {
    setLoading(key);
    setActionError(null);
    // Yeni bir işlem, bir öncekinin uyarısını da kapatır: bayat uyarı, az önce
    // yapılan işleme aitmiş gibi okunurdu.
    setActionWarning(null);
    try {
      const r = await callApi(path, init);
      if (!r.ok) {
        setActionError(r.error);
        // Reddin dayandığı durumu göster: sayfa büyük ihtimalle bayat.
        router.refresh();
        return false;
      }
      onDone?.(r.data);
      router.refresh();
      return true;
    } finally {
      setLoading(null);
    }
  };

  // ─── Müşteri bilgileri ───────────────────────────────────────────
  const saveCustomer = async () => {
    const phoneE164 = phoneInputToE164(custPhoneCountry, custPhoneNational);
    if (custPhoneNational.trim() !== "" && phoneE164 === null) {
      alert("Geçerli bir telefon numarası girin.");
      return;
    }
    if (!custName.trim() || !custEmail.trim()) {
      alert("Ad ve e-posta boş bırakılamaz.");
      return;
    }
    if (custEmail.trim() !== order.email) {
      const ok = window.confirm(
        [
          "E-posta adresi değişiyor.",
          `${order.email} → ${custEmail.trim()}`,
          "",
          "Bundan sonraki sipariş bildirimleri (kargo, teslim, onay bağlantısı) yeni adrese gider.",
          "",
          "Devam edilsin mi?",
        ].join("\n")
      );
      if (!ok) return;
    }
    await runApi(
      "customer",
      `/api/admin/orders/${order.id}/edit`,
      jsonInit({
        customerName: custName.trim(),
        email: custEmail.trim(),
        phone: phoneE164,
        customerNote: custNote,
      }),
      () => setCustomerEditing(false)
    );
  };

  // ─── Kargo ───────────────────────────────────────────────────────
  /**
   * Kargo kaydının düzeltilmesi: PATCH /ship (F-C1'in tek yolu).
   *
   * Yalnız DEĞİŞTİRİLEN alan gönderilir: sunucu `undefined` alanı "bu istekte
   * düzenlenmiyor" sayar, boş bir takip numarasını ve tanımadığı bir taşıyıcıyı
   * 400 ile geri çevirir. Bu yüzden boş değerler hiç yollanmaz — eskiden
   * `carrier: null` gönderiliyordu ve uç bunu geçersiz firma sayardı.
   *
   * Taşıyıcı DEĞİŞMEDİYSE hiç gönderilmez: PATCH /ship taşıyıcıyı isCarrier()
   * ile doğrular ve kayıtta duran değer o listede olmayabilir (`elden` — elden
   * teslimin takip bağlantısı yok). Değişmemiş taşıyıcıyı da yollamak, admin
   * yalnız takip numarasını düzeltirken bile "Geçersiz kargo firması." ile
   * reddettiriyordu.
   *
   * NOT: bunu ilk ortaya çıkaran atölye siparişiydi, ama atölye siparişi artık
   * bu forma HİÇ gelmiyor (uç onu 409 code "workshop" ile reddediyor, form da
   * açılmıyor); düzeltmesi seans ekranındaki parti sevkiyatındadır. Kural
   * burada eski/elle girilmiş kayıtlar için durur.
   */
  const saveShipping = async () => {
    const tracking = shipTracking.trim();
    const body: Record<string, unknown> = { notify: shipNotify };
    if (shipCarrier && shipCarrier !== order.carrier) body.carrier = shipCarrier;
    if (tracking && tracking !== order.trackingNumber) body.trackingNumber = tracking;
    await runApi(
      "shipping",
      `/api/admin/orders/${order.id}/ship`,
      jsonInit(body, "PATCH"),
      () => setShipEditing(false)
    );
  };

  const revertShipping = async (target: "shipped" | "in_production") => {
    const reason = revertReason.trim();
    if (reason.length < 3) {
      alert("Geri alma gerekçesi zorunludur.");
      return;
    }
    const ok = window.confirm(
      [
        target === "shipped"
          ? "Teslim kaydı geri alınacak; sipariş kargolandı durumuna döner."
          : "Kargo kaydı geri alınacak; sipariş üretim tarafına döner ve takip numarası kaldırılır.",
        "Müşteriye gönderilmiş kargo/teslim e-postası geri alınamaz.",
        "İşlem denetim kaydına yazılır.",
        "",
        "Devam edilsin mi?",
      ].join("\n")
    );
    if (!ok) return;
    // İki ayrı uç, tek düğme grubu (F-C1): teslim kaydı DELETE /deliver ile,
    // kargo kaydı DELETE /ship ile geri alınır. Gerekçe her ikisinde de gövdede
    // gider ve denetim kaydına yazılır.
    await runApi(
      "ship-revert",
      target === "shipped"
        ? `/api/admin/orders/${order.id}/deliver`
        : `/api/admin/orders/${order.id}/ship`,
      jsonInit({ reason }, "DELETE"),
      () => {
        setRevertOpen(false);
        setRevertReason("");
      }
    );
  };

  // ─── Müşteri model onayı ─────────────────────────────────────────
  const resendApproval = async () => {
    await runApi(
      "approval-resend",
      `/api/admin/orders/${order.id}/model-approval/resend`,
      jsonInit({})
    );
  };

  const recordApprovalDecision = async () => {
    const note = recordNote.trim();
    if (recordDecision === "revision" && note.length < 3) {
      alert("Müşterinin istediği değişikliği yazın; boyacıya ve üreticiye bu metin gider.");
      return;
    }
    const ok = window.confirm(
      [
        recordDecision === "approved"
          ? "Müşterinin ONAYI kaydedilecek: sipariş üretime açılır."
          : "Müşterinin REVİZYON isteği kaydedilecek: sipariş incelemeye döner.",
        `Kanal: ${recordChannel === "phone" ? "Telefon" : "WhatsApp"}`,
        "Kararı müşterinin kendisi tıklamadı; kaydı siz giriyorsunuz ve denetim kaydında adınız kalır.",
        "",
        "Devam edilsin mi?",
      ].join("\n")
    );
    if (!ok) return;
    await runApi(
      "approval-record",
      `/api/admin/orders/${order.id}/model-approval/record`,
      jsonInit({
        decision: recordDecision,
        channel: recordChannel,
        note: note || undefined,
      }),
      () => {
        setRecordOpen(false);
        setRecordNote("");
      }
    );
  };

  // ─── Sürüm yönetimi ──────────────────────────────────────────────
  // Not: "geçerli yap" ile "sil", yükleme ucunun PATCH/DELETE yöntemleridir;
  // ikisi de aynı politikayı (gerekçe zorunluluğu dahil) uygular.
  const makeRevisionCurrent = async (revision: number) => {
    const needsNote = modelUpload?.effects.requiresNote ?? false;
    const typed = window.prompt(
      needsNote
        ? `Sürüm ${revision} geçerli model yapılacak. Bu aşamada gerekçe ZORUNLU (denetim kaydına yazılır, partnerlere bildirilir):`
        : `Sürüm ${revision} geçerli model yapılacak. Gerekçe (isteğe bağlı):`,
      ""
    );
    if (typed === null) return;
    if (needsNote && typed.trim().length < 3) {
      alert("Bu aşamada gerekçe zorunludur.");
      return;
    }
    const note = typed.trim();
    await runApi(
      `rev-current-${revision}`,
      `/api/admin/orders/${order.id}/upload-model`,
      jsonInit({ revision, note: note || undefined }, "PATCH"),
      // Geri getirme de bir YÜKLEMEDİR ve uç bunu öyle yanıtlar: aşama +
      // GERÇEKTEN uygulanan yan etkiler (QC sıfırlaması dahil, yayımlanmadıysa
      // hiçbiri). Kuru bir "başarılı", QC'nin sıfırlanıp sıfırlanmadığını
      // admin'den saklıyordu; panel yüklemeyle aynı cümleleri bassın.
      (data) => {
        if (!modelUpload) return;
        const server = parseUploadResult(data);
        setUploadResult({
          kind: "restore",
          stage: server.stage ?? modelUpload.stage,
          effects: modelUpload.effects,
          note,
          server,
        });
      }
    );
  };

  const deleteRevision = async (revision: number) => {
    const ok = window.confirm(
      [
        `Sürüm ${revision} ve dosyaları kalıcı olarak silinecek.`,
        "Üretici bu sürümü basıyorsa işlem reddedilir.",
        "",
        "Devam edilsin mi?",
      ].join("\n")
    );
    if (!ok) return;
    await runApi(
      `rev-delete-${revision}`,
      `/api/admin/orders/${order.id}/upload-model`,
      jsonInit({ revision }, "DELETE")
    );
  };

  const saveRevisionNote = async (revision: number, text: string) => {
    await runApi(
      `rev-note-${revision}`,
      `/api/admin/orders/${order.id}/model-revisions/${revision}`,
      jsonInit({ note: text.trim() }, "PATCH"),
      () => setRevisionNoteDraft(null)
    );
  };

  /**
   * Yükleme bittikten sonra: sonuç paneli açılır ve sayfa tazelenir.
   *
   * Panel, yükleme ANINDAKİ aşamanın yan etkilerini gösterir (tazelenen sayfa
   * artık yeni aşamayı taşır), altında da siparişin GÜNCEL durumu okunur.
   */
  const afterUpload = (raw?: unknown) => {
    // Aşama ve yan etkiler SUNUCUDAN okunur (P2-C2). Yükleyici eski sürümse
    // (sonucu iletmiyorsa) politikaya düşülür ve panel bunu açıkça söyler.
    const server = raw === undefined || raw === null ? null : parseUploadResult(raw);
    if (modelUpload) {
      setUploadResult({
        kind: "upload",
        stage: server?.stage ?? modelUpload.stage,
        effects: modelUpload.effects,
        note: uploadNote.trim(),
        server,
      });
    }
    setUploadOpen(false);
    setUploadNote("");
    setTab("production");
    router.refresh();
  };

  // ─── Partner adına işlem (P2-C4) ─────────────────────────────────
  const runOnBehalf = async () => {
    if (!onBehalfAction) return;
    const reason = onBehalfReason.trim();
    if (reason.length < ON_BEHALF_REASON_MIN) {
      alert(
        `Gerekçe en az ${ON_BEHALF_REASON_MIN} karakter olmalı; denetim kaydına ve partnerin kendi zaman çizelgesine bu metin yazılır.`
      );
      return;
    }
    if (onBehalfAction === "ship" && !onBehalfTracking.trim()) {
      alert("Kargo takip numarası zorunludur.");
      return;
    }
    // Taşıyıcı da ZORUNLU (services/on-behalf.ts · carrier_required):
    // firmasız bir takip numarasından müşteriye takip bağlantısı kurulamıyor.
    // Form bunu "ops." diye gösterdiği sürece her tıklama garanti 400'dü.
    if (onBehalfAction === "ship" && !onBehalfCarrier) {
      alert(
        "Kargo firmasını seçin; firmasız takip numarasından müşteriye takip bağlantısı kurulamıyor."
      );
      return;
    }
    const who = onBehalfHolder === "painter" ? "boyacı" : "üretici";
    const ok = window.confirm(
      [
        `Bu adım ${who.toUpperCase()} ADINA yapılacak ve partnerin kendi işlemiyle aynı sonucu doğuracak (hakediş dahil).`,
        `İşlem: ${ON_BEHALF_LABELS[onBehalfHolder === "painter" ? "painter" : "manufacturer"][onBehalfAction]}`,
        `Gerekçe: ${reason}`,
        "Gerekçe denetim kaydına ve partnerin zaman çizelgesine yazılır.",
        "",
        "Devam edilsin mi?",
      ].join("\n")
    );
    if (!ok) return;
    await runApi(
      "on-behalf",
      `/api/admin/orders/${order.id}/on-behalf`,
      jsonInit({
        action: onBehalfAction,
        reason,
        ...(onBehalfAction === "ship"
          ? { trackingNumber: onBehalfTracking.trim(), carrier: onBehalfCarrier }
          : {}),
      }),
      () => {
        setOnBehalfAction("");
        setOnBehalfReason("");
        setOnBehalfTracking("");
        setOnBehalfCarrier("");
      }
    );
  };

  // ─── Boyacı QC + boyacı değiştirme ───────────────────────────────
  const painterQcDecision = async (decision: "approve" | "reject") => {
    if (decision === "reject" && painterQcReason.trim().length < 3) {
      alert("Ret gerekçesi zorunludur; boyacıya aynen iletilir.");
      return;
    }
    await runApi(
      `painter-qc-${decision}`,
      `/api/admin/painter-qc/${order.id}/${decision}`,
      jsonInit(decision === "reject" ? { reason: painterQcReason.trim() } : {}),
      (data) => {
        setPainterQcReason("");
        // KARAR GEÇTİ, FOTOĞRAF DAMGALAMASI DÜŞTÜ.
        //
        // Uç bunu bilerek ayrı bir bayrakla söylüyor (photoStampFailed) çünkü
        // kararın kendisi UYGULANDI ve onu "başarısız" diye anlatmak admin'i
        // yapılmış bir işi tekrar yapmaya iterdi. Ama bayrağı hiçbir ekran
        // okumuyordu: arıza, turun fotoğraf satırlarında "bekliyor" olarak
        // sessizce kalıyor ve sonraki bakan bunun arıza mı gerçek bir durum mu
        // olduğunu ayırt edemiyordu. Her arıza, bir ekranın gösterebileceği bir
        // cümle taşımalı — bu onun yeri.
        if (Boolean(data.photoStampFailed)) {
          setActionError(
            decision === "approve"
              ? "Boyama onayı UYGULANDI: boyacının kargosu açıldı. Ancak turun QC fotoğraf satırları damgalanamadı; fotoğraflar 'bekliyor' görünmeye devam edebilir. Karar geçerlidir, tekrar onaylamayın."
              : "Boyama reddi UYGULANDI: boyacı yeniden boyamaya gönderildi ve gerekçeniz kendisine iletildi. Ancak turun QC fotoğraf satırları damgalanamadı; fotoğraflar 'bekliyor' görünmeye devam edebilir. Karar geçerlidir, tekrar reddetmeyin."
          );
        }
      }
    );
  };

  // ─── ÖN SEÇİM ────────────────────────────────────────────────────────────
  // Sunucu sıralamanın birincisini işaretliyor (page.tsx · suggested). Kullanıcı
  // bir şey seçmediyse öneri GEÇERLİDİR; yoksa sıralamayı gösterip yine de en
  // üstteki adı elle tıklatmış olurduk. Öneri yalnız sıralama gerçekten
  // okunduğunda gelir: sırasız listede hiçbir satır "önerilen" değildir.
  const suggestedPainterId = painting?.candidates.find((c) => c.suggested)?.id ?? "";
  const effectivePainterPick = painterPick || suggestedPainterId;
  const chosenPainterCard =
    painting?.candidates.find((c) => c.id === effectivePainterPick) ?? null;
  // Devirde öneri FARKLIDIR: şu anki boyacı hariç, sıradaki ilk uygun boyacı.
  // Ama KURAL ATAMA KUTUSUYLA AYNIDIR: sıra gerçekten okunmadıysa (rank null)
  // hiçbir satır önerilmez. Sırasız listenin ilk uygun adını ön seçili
  // getirmek, "liste sırasızdır" uyarısının hemen altında alfabetik bir adı
  // tavsiye diye satmak olurdu — üstelik devirde seçim tek tıkla uygulanıyor.
  const suggestedSwapPainterId =
    painting?.candidates.find(
      (c) => c.eligible && c.rank !== null && c.id !== painter?.id
    )?.id ?? "";
  const effectiveSwapPainterId = swapPainterId || suggestedSwapPainterId;

  // BASKI ŞU AN DIŞARIDA MI? Ölçü uçların kullandığının AYNISIDIR
  // (flags.ts · painterParcelOnTheWay): kargo FİRMASI kanıt sayılmaz, takip
  // numarası ya da boyacının teslim damgası kanıttır. Ekranın kendi kuralını
  // kurması, panelin "sorun yok" dediği bir devri ucun reddetmesi demekti.
  const painterParcelOut = painterParcelOnTheWay({
    painterHandoffTrackingNumber: painting?.handoffTrackingNumber ?? null,
    receivedByPainterAt: painting?.receivedAt ? new Date(painting.receivedAt) : null,
  });
  // Koli yoldayken devir, YENİ sevkiyat bildirilmeden kabul edilmez (uç:
  // 409 · parcel_in_transit). Kural ekranda da uygulanır ki admin reddi
  // yemeden önce ne istendiğini görsün.
  const swapNeedsTracking = painterParcelOut && !swapTracking.trim();

  const swapPainter = async () => {
    if (!effectiveSwapPainterId) return;
    if (swapReason.trim().length < 3) {
      alert("Gerekçe zorunludur.");
      return;
    }
    if (swapNeedsTracking) {
      alert(
        "Baskı boyacıya gönderilmiş ya da onun elinde görünüyor: devir için parçanın yeni sevkiyatını girin. Takip numarası zorunludur (elden teslimde teslim notunu yazın)."
      );
      return;
    }
    const ok = window.confirm(
      [
        "İş yalnız YENİ BOYACIYA geçecek.",
        "Üretici, üretici durumu ve tahakkuk etmiş baskı hakedişi olduğu gibi kalır.",
        painterParcelOut
          ? `Baskı eski boyacıda: yeni sevkiyat ${swapCarrier || "-"} / ${swapTracking.trim()} olarak kaydedilecek, eski kargo kaydı da sipariş notuna yazılacak.`
          : "Baskı hâlâ eski boyacının elinde: devir kargosu ve gerekirse yeniden baskı elle mutabakatla kapatılır.",
        "",
        "Devam edilsin mi?",
      ].join("\n")
    );
    if (!ok) return;
    await runApi(
      "swap-painter",
      `/api/admin/orders/${order.id}/swap-painter`,
      jsonInit({
        painterId: effectiveSwapPainterId,
        reason: swapReason.trim(),
        blocklistPainter: swapBlocklist,
        // Atama kutusuyla AYNI iki alan (handleAssignPainter): uç ikisini de
        // aynı adla bekliyor ve koli yoldayken takip numarası ZORUNLU.
        carrier: swapCarrier || undefined,
        trackingNumber: swapTracking.trim() || undefined,
      }),
      (data) => {
        setSwapOpen(false);
        setSwapPainterId("");
        setSwapReason("");
        setSwapCarrier("");
        setSwapTracking("");
        // Devir geçerli, ama kararın gerekçe kaydı yazılamamış olabilir: uç bunu
        // `warning` ile söyler ve bu callback onu YERE DÜŞÜRÜYORDU.
        setActionWarning(responseWarning(data));
      }
    );
  };

  // ─── Reference photo management (admin-fulfilled / WhatsApp orders) ───
  const [photoBusy, setPhotoBusy] = useState(false);
  const addOrderPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPhotoBusy(true);
    try {
      const keys: string[] = [];
      // A refused upload used to be dropped silently. The first reason is kept;
      // the rest of a batch almost always fails for the same one.
      let failure: string | null = null;
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/admin/orders/upload-photo`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.key) keys.push(data.key);
        else failure ??= data.error || d["admin.orderDetail.actionFailed"];
      }
      if (keys.length > 0) {
        const res = await fetch(`/api/admin/orders/${order.id}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoKeys: keys }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failure = data.error || d["admin.orderDetail.actionFailed"];
        }
      }
      if (failure) reportFailure(failure);
      else if (keys.length > 0) router.refresh();
    } finally {
      setPhotoBusy(false);
    }
  };
  const removeOrderPhoto = async (photoId: string) => {
    setPhotoBusy(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/photos`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        reportFailure(data.error || d["admin.orderDetail.actionFailed"]);
        return;
      }
      router.refresh();
    } finally {
      setPhotoBusy(false);
    }
  };

  const saveEdit = async () => {
    const telefonE164 = phoneInputToE164(editTelefonCountry, editTelefonNational);
    if (editTelefonNational.trim() !== "" && telefonE164 === null) {
      alert("Geçerli bir telefon numarası girin");
      return;
    }
    const addressToSave = editAddress
      ? { ...editAddress, telefon: telefonE164 ?? editAddress.telefon }
      : editAddress;
    setLoading("edit");
    try {
      // Kargolandıktan sonra adres değişikliği sunucuda ayrı onay ister
      // (409 + code=address_after_shipping): paket yola çıkmıştır, yeni adres
      // kutunun gideceği yeri değiştirmez. Admin bunu bilerek yapıyorsa kayıt
      // tutulur; tek tıkla sessizce olmaz.
      const send = (confirmAfterShipping: boolean) =>
        callApi(
          `/api/admin/orders/${order.id}/edit`,
          jsonInit({
            adminNotes: editNotes,
            shippingAddress: addressToSave,
            ...(confirmAfterShipping ? { confirmAfterShipping: true } : {}),
          })
        );
      let r = await send(false);
      if (!r.ok && r.data.code === "address_after_shipping") {
        const ok = window.confirm(
          `${r.error}\n\nDevam edilsin mi?`
        );
        if (!ok) return;
        r = await send(true);
      }
      if (r.ok) {
        setEditing(false);
        router.refresh();
      } else {
        reportFailure(r.error);
      }
    } finally {
      setLoading(null);
    }
  };

  // ─── Technical spec editor ───────────────────────────────────────
  // Manual/WhatsApp orders are created without a spec, and any order may need a
  // correction after the customer clarifies something. This writes the same
  // fields the manufacturer panel reads.
  /** Canonicalises the typed size ("17.5cm" → "17,5 cm") and echoes it back. */
  const applySpecSize = (raw: string) => {
    if (!raw.trim()) {
      setSpecSizeError(null);
      setSpecSizePreview(null);
      return;
    }
    const normalized = normalizeSizeInput(raw);
    if (!normalized.ok) {
      setSpecSizeError(normalized.error);
      setSpecSizePreview(null);
      return;
    }
    setSpecSizeError(null);
    setSpecSize(normalized.value);
    setSpecSizePreview(sizeDisplayTr(normalized.value));
  };

  const saveSpec = async () => {
    setLoading("spec");
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          figurineSize: specSize || null,
          material: specMaterial || null,
          finish: specFinish || null,
          attributes: specAttrs
            .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
            .filter((a) => a.name && a.value),
        }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        reportFailure(data.error || d["admin.orderDetail.actionFailed"]);
      }
    } finally {
      setLoading(null);
    }
  };

  // Template handling
  const applyTemplate = (key: string) => {
    setSelectedTemplate(key);
    if (key === "custom") {
      setMsgBody("");
      setMsgSubject("");
      return;
    }
    const tpl = MESSAGE_TEMPLATES.find(t => t.key === key);
    if (!tpl) return;
    const subjectKey = tpl.subjectKey as keyof typeof d;
    const bodyKey = tpl.bodyKey as keyof typeof d;
    let subject = subjectKey ? (d[subjectKey] || "") : "";
    let body = bodyKey ? (d[bodyKey] || "") : "";
    subject = subject.replace("{orderNumber}", order.orderNumber).replace("{customerName}", order.customerName).replace("{trackingNumber}", order.trackingNumber || "");
    body = body.replace("{orderNumber}", order.orderNumber).replace("{customerName}", order.customerName).replace("{trackingNumber}", order.trackingNumber || "");
    setMsgSubject(subject);
    setMsgBody(body);
  };

  const sendEmail = async () => {
    if (!msgBody.trim()) return;
    setMsgSending(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: msgSubject || undefined, body: msgBody, templateKey: selectedTemplate }),
      });
      if (res.ok) {
        setMsgSent(true);
        setMsgBody("");
        setMsgSubject("");
        setTimeout(() => setMsgSent(false), 3000);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        reportFailure(data.error || d["admin.orderDetail.actionFailed"]);
      }
    } finally {
      setMsgSending(false);
    }
  };

  // Prefer the admin-uploaded 3D model; fall back to the legacy generation
  // output so historical orders still show their mesh + download links.
  // Eski auto-3D denemesine yalnız siparişin KENDİ modeli hiç yoksa düşülür:
  // yalnız-STL bir sürüm, eskimiş bir GLB'yi görüntüleyicide diriltmesin.
  const displayGlbUrl = currentModelUrl(order, "glb", latestGeneration);
  const displayStlUrl = currentModelUrl(order, "stl", latestGeneration);
  // Güncel sürüm çok parçalıysa başlıktaki tek "STL İndir" yalnız İLK parçayı
  // (birincil dosyayı) verirdi; 13 parçalık bir işte admin 12'sini hiç görmezdi.
  const latestStlParts = (modelRevisions[0]?.files ?? []).filter((f) => f.kind === "stl");

  const hasManufacturer = !!manufacturer;
  // A refunded order keeps its status (decision refund-end-state), so the status
  // alone would still offer approval, model upload, printing, shipping and
  // assignment. Every forward card below checks this, and the routes behind them
  // refuse a refunded order with a 409. Deliver and reject stay: they close the
  // order instead of pushing it forward.
  const refunded = isRefunded(order);
  const canApprove = order.status === "review" && !refunded;
  // Same source drives the badge and whether the approve button needs a reason.
  const gateTone = GATE_TONE[printGate?.verdict ?? "unknown"];
  const gateOverrideNeeded = canApprove && printGate?.requiresOverride === true;
  // One list for this button and the reject route (order-status-policy). The
  // button used to offer awaiting_model while the route refused it with a 400.
  const canReject = REJECTABLE_STATUSES.includes(order.status);
  // İade edilmiş sipariş HİÇBİR YÖNE kımıldamaz: incelemeye çekmek de bir
  // ilerletmedir (paid/generating → review) ve bu satır, kardeşlerinin
  // (canApprove, canStartPrinting, canShip) taşıdığı iade şartını taşımıyordu.
  const canForceReview =
    ["paid", "generating", "processing_mesh"].includes(order.status) && !refunded;
  const canStartPrinting = order.status === "approved" && !hasManufacturer && !refunded;
  const canShip = order.status === "printing" && !hasManufacturer && !refunded;
  // Teslim DAMGASI da bir harekettir ve iade edilmiş siparişte atılmaz: müşteriye
  // parası geri verilmiş bir gönderi için "siparişiniz teslim edildi" bildirimi
  // ve e-postası gidiyordu, üstelik damga geri de alınamıyordu (DELETE /deliver
  // iadeyi 409 ile reddediyor). Paket yine de ulaştıysa kaydı denetim notuna
  // yazmak doğru yoldur.
  const canDeliver = order.status === "shipped" && !refunded;
  // Düzeltilecek bir kargo kaydı ancak kargolanmış/teslim edilmiş siparişte
  // vardır — PATCH /ship de tam olarak bu iki durumu kabul eder. Düğmeyi daha
  // erken göstermek, admin'e sunucunun 400 ile kapattığı bir form açıyordu.
  const hasShippingRecord = order.status === "shipped" || order.status === "delivered";
  // ─── Kargo kaydının kuralını SUNUCU söyler ─────────────────────────
  //
  // Geri almanın koşulu TEK yerde yaşıyor: GET /api/admin/orders/[id]/ship
  // (loadShipRevertState) — iade, durum, atölye partisi ve ÖDENMİŞ hakediş.
  // Sayfa aynı kuralı kendi içinde yeniden kuruyordu ve kopya DARDI: ödenmiş
  // hakedişi hiç bilmiyordu. Hakedişi ödenmiş bir siparişte "Kargoyu geri al"
  // açık görünüyor, admin gerekçesini yazıp onay kutusunu da geçtikten sonra
  // 409 alıyordu — tam olarak bu ucun engellemek için var olduğu ayrışma.
  // Kopya kaldırıldı: hem düğme hem reddin gerekçesi sunucunun cevabından gelir.
  const [shipRuleAnswer, setShipRuleAnswer] = useState<ShipRuleAnswer | null>(null);
  // Yeniden sorma sayacı: cevap alınamazsa admin'in elinde bir "tekrar dene"
  // olmalı, yoksa geçici bir ağ hatası kargo kutusunu kalıcı kilitler.
  const [shipRuleReload, setShipRuleReload] = useState(0);
  // Cevabın ait olduğu durum: sipariş değiştiyse (iade, geri alma, teslim) eski
  // cevap "yükleniyor" sayılır — bayat bir "evet" düğmeyi açmasın.
  const shipRuleKey = `${order.id}|${order.status}|${order.paymentStatus}|${shipRuleReload}`;
  useEffect(() => {
    // Kargo kaydı yoksa sorulacak bir şey de yok (uç 400 döner).
    if (order.status !== "shipped" && order.status !== "delivered") return;
    let alive = true;
    void (async () => {
      let value: ShipRuleState;
      try {
        const res = await fetch(`/api/admin/orders/${order.id}/ship`);
        const data = (await res.json().catch(() => ({}))) as {
          canRevert?: boolean;
          code?: string;
          reason?: string | null;
        };
        value = res.ok
          ? {
              phase: "ready",
              canRevert: data.canRevert === true,
              code: typeof data.code === "string" ? data.code : "ok",
              reason: typeof data.reason === "string" ? data.reason : null,
            }
          : { phase: "unknown" };
      } catch {
        value = { phase: "unknown" };
      }
      if (alive) setShipRuleAnswer({ key: shipRuleKey, value });
    })();
    return () => {
      alive = false;
    };
  }, [order.id, order.status, shipRuleKey]);

  const shipRule: ShipRuleState = !hasShippingRecord
    ? { phase: "idle" }
    : shipRuleAnswer && shipRuleAnswer.key === shipRuleKey
      ? shipRuleAnswer.value
      : { phase: "loading" };
  const shipRuleCode = shipRule.phase === "ready" ? shipRule.code : null;
  const canRevertShipping = shipRule.phase === "ready" && shipRule.canRevert;
  // Atölye partisi: PATCH /ship de DELETE /ship de reddeder. GET /ship bunu
  // yalnız "kargolandı" durumunda `workshop` koduyla söyler (teslim edilmişte
  // önce durum kapısına düşer), bu yüzden partinin varlığı siparişin KENDİ
  // satırından okunur — bu bir kural kopyası değil, rotanın baktığı alanın ta
  // kendisi (`order.workshopSessionId`).
  const workshopShippingLocked = hasShippingRecord && !!order.workshopSessionId;
  // Düzeltmenin (PATCH /ship) kapıları geri almanınkiyle AYNI değildir: durum ve
  // ödenmiş hakediş yalnız geri almayı kapatır — takip numarasını düzeltmek ne
  // parayı ne aşamayı hareket ettirir ve teslim edilmiş siparişte de serbesttir.
  // Düzeltmeyi kapatan iki şey: iade ve atölye partisi (ucun kendi iki kapısı).
  const canEditShipping =
    hasShippingRecord &&
    shipRule.phase === "ready" &&
    shipRuleCode !== "refunded" &&
    !workshopShippingLocked;
  // Reddin GEREKÇESİ de sunucudan gelir; ekran kendi cümlesini uydurmaz.
  const shipRuleBlockNotice =
    shipRule.phase === "ready" &&
    !shipRule.canRevert &&
    shipRule.reason &&
    (shipRuleCode === "refunded" ||
      shipRuleCode === "workshop" ||
      shipRuleCode === "earning_paid")
      ? shipRule.reason
      : null;
  // Teslim kaydını geri almanın kuralı BAŞKA bir ucun (DELETE /deliver) ve o uç
  // da iade edilmiş siparişi 409 ile reddeder.
  const canRevertDelivery = order.status === "delivered" && !refunded;
  const shipRuleSectionVisible =
    hasShippingRecord &&
    (shipRule.phase !== "ready" ||
      canRevertDelivery ||
      canRevertShipping ||
      workshopShippingLocked ||
      shipRuleBlockNotice !== null);
  // Uç, taşıyıcıyı isCarrier() ile doğrular: "elden" geçmez. Kayıtta bunlardan
  // biri yoksa (eski elden teslim) o değer listede KALIR, yoksa düzenleme onu
  // sessizce başka bir firmaya çevirirdi.
  const shipCarrierOptions: string[] =
    order.carrier && !(CARRIERS as string[]).includes(order.carrier)
      ? [...CARRIERS, order.carrier]
      : [...CARRIERS];
  // Mirror the API's own gate (assign-manufacturer route): marketplace orders
  // are assignable straight from "paid".
  const statusAssignable =
    order.status === "approved" ||
    (order.status === "paid" && order.orderType === "marketplace");
  // Üretici KAYDI okunamadığında `manufacturer` null gelir ve bu kapı, atanmış
  // bir siparişe yeniden atama açardı — "kaydı okuyamadım" ile "atanmamış" aynı
  // şey değildir. Bilinmezlikte kapı kapalı tarafta kalır (uç zaten reddeder).
  const canAssignManufacturer =
    !refunded &&
    !readFailures?.manufacturer &&
    statusAssignable && (!manufacturerStatus || manufacturerStatus === "unassigned");
  // Refund is possible at every stage the money is still with us. It used to sit
  // in the reject/force-review row and vanished once an order was printing, in
  // QC, painting, awaiting the customer, shipped or delivered.
  const canRefund = order.paymentStatus === "succeeded";
  // Cash that actually came in: amount − gift card − havale discount, through the
  // pure helper the money breakdown uses too (C3). The dashboard and analytics
  // compute the same figure in SQL with its twin, CASH_COLLECTED_KURUS
  // (src/lib/services/admin-order-sql.ts); the two must stay identical.
  // Computed here instead of read from `money` because the details card and the
  // refund dialog must still work when the breakdown loader failed. (The old
  // "Kalan" line ignored the havale discount.)
  const collectedKurus = cashCollectedKurus(order);
  // Partner earnings as the refund service will treat them: paid-out rows stay
  // paid (silently, before this card), rows batched into a still-pending payout
  // are reversed and deducted from it.
  const moneyShares = money?.shares ?? [];
  // The manufacturer paints in house: the painting kalem is in its earning, and
  // no painter accrual will ever happen (C2'' includesPainting).
  const paintsInHouseShare = moneyShares.some(
    (s) => s.party === "manufacturer" && s.includesPainting
  );
  const paidOutShares = moneyShares.filter((s) => isPaidOut(s.earning));
  const batchedShares = moneyShares.filter(
    (s) =>
      !!s.earning &&
      s.earning.status === "pending" &&
      s.earning.payout?.status === "pending"
  );
  // The admin action that refunded it (adminActions arrive newest first). The
  // refund row wins; a reject only counts when there is none, because rejecting
  // a paid order refunds it too, while a reject AFTER a refund is not the refund.
  const refundRecord = refunded
    ? adminActions.find((a) => a.action === "refund") ??
      adminActions.find((a) => a.action === "reject")
    : undefined;
  // Taking an order back is safe up to and INCLUDING qc_approved, as long as it
  // has not shipped and has not been handed to a painter — the manufacturer's
  // earning only attaches at ship / send-to-painter (see manufacturer-revoke.ts).
  const REVOCABLE_STATUSES = [
    "assigned",
    "accepted",
    "printing",
    "printed",
    "qc_pending",
    "qc_rejected",
    "qc_approved",
  ];
  const canRevokeManufacturer =
    !!manufacturer &&
    REVOCABLE_STATUSES.includes(manufacturerStatus ?? "") &&
    (!order.painterStatus || order.painterStatus === "unassigned");
  // Once handed to a painter the manufacturer revoke refuses (earning accrued),
  // so a dedicated "pull back from painter" path takes over: valid while the
  // painter has not shipped (painter-ship sets shippedAt + status "shipped").
  const canRevokePainter =
    !!order.painterStatus &&
    order.painterStatus !== "unassigned" &&
    order.painterStatus !== "shipped" &&
    !order.shippedAt;
  // CEVAPSIZ İŞ = CEZASIZ İŞ (sahibin kararı). `painterStatus === "assigned"`
  // boyacının işi henüz ÜSTLENMEDİĞİ hâldir; kabul ettiği an "accepted" olur.
  // 24 saatlik süpürme cevapsız işi sıradaki boyacıya geçirir ve ceza YAZMAZ
  // (painter-accept-sla.worker.ts; strikes.ts'in başındaki not da bunu yazıyor).
  // Admin süpürmeden ÖNCE elle geri alırsa kural değişmemeli: yoksa aynı olgu
  // (boyacı hiç cevap vermedi) kimin önce davrandığına göre cezalanırdı.
  const painterJobUnanswered = order.painterStatus === "assigned";
  // İade edilmiş siparişte de ceza yoktur: orada işi bitiren iadedir, boyacının
  // kusuru yoktur (order-status-policy). Rota ikinci savunma hattıdır
  // (`strike && !refunded` + strikes.ts'in kendi iade kapısı); burası cezanın
  // SORULDUĞU yer olduğu için kuralı ekranda da uygular.
  const canStrikePainter = !refunded && !painterJobUnanswered;
  // Gerekçe kartının ("Bu iş neden bu boyacıya gitti?") adres verebilmesi için
  // elle atama kutusunun GERÇEKTEN ekranda olması gerekir. Kutu yalnız bu beş
  // koşulun hepsi doğruyken render ediliyor (aşağıdaki "Boyacı ata" bloğu);
  // kart ise yalnız karar sayısına bakıp "yukarıdaki kutudan atayın" diyordu ve
  // iade edilmiş siparişte var olmayan bir kutuyu adres gösteriyordu.
  // `painting` sayfadan gelmeyebilir (boyama bölümü hiç render edilmemiş
  // sipariş); o hâlde kutu da yok, yani hesap `false` vermeli — kartın tavsiyesi
  // "kutu ekranda" diye okunmamalı.
  const painterAssignBoxOnScreen =
    !refunded &&
    (!painting?.painterStatus || painting.painterStatus === "unassigned") &&
    manufacturerStatus === "qc_approved" &&
    !readFailures?.painterCandidates &&
    (painting?.candidates.length ?? 0) > 0;
  const waitingHours = assignmentAgeHours ?? 0;
  const isStaleAssignment =
    manufacturerStatus === "assigned" && waitingHours >= 24;
  // Model upload shows for awaiting_model, and also for admin-fulfilled WhatsApp
  // orders (marketplace, no seller) still sitting at "paid" — so the admin can
  // attach a model, reach "approved", and assign a manufacturer.
  // A refunded order gets neither uploader: an upload moves the order toward
  // "approved", the assignable shape the refund guard exists to stop, and the
  // upload route refuses it with a 409.
  const canUploadModel =
    !refunded &&
    (order.status === "awaiting_model" ||
      (order.status === "paid" && order.orderType === "marketplace" && !hasManufacturer));
  // Faz 2 (late-model-upload): sürüm yükleme bir durum listesine değil
  // POLİTİKAYA bağlı — reddedilmiş ve iade edilmiş sipariş dışında her
  // aşamada açıktır, yan etkileri aşamaya göre değişir (P2-C1).
  const canUploadRevision = modelUpload?.allowed ?? false;
  const uploadEffects = modelUpload?.effects ?? null;
  const uploadNoteRequired = uploadEffects?.requiresNote ?? false;
  // Gerekçe gereken aşamada dosya seçtirmeden önce gerekçe istenir; sunucu
  // da aynı kuralı uygular (upload-model route, effects.requiresNote).
  const uploadReady = uploadOpen && (!uploadNoteRequired || uploadNote.trim().length >= 10);
  // Güncel sürümün PARÇA listesi bilinmiyor mu: sürüm başlıkları ya da parça
  // tablosu okunamadıysa "önceki parçaları koru" kararının dayanağı yoktur.
  const revisionPartsUnknown = !!modelRevisionsUnreadable || !!readFailures?.modelFiles;
  // QC fotoğrafları artık HER turu taşıyor; kartlar kendi turunu süzer.
  const liveQcPhotos = (qcPhotos ?? []).filter((p) => p.round === (qcRound ?? 1));
  const painterLiveQc = (painting?.qcPhotos ?? []).filter(
    (p) => p.round === (painting?.qcRound ?? 1)
  );
  const painterOldQc = (painting?.qcPhotos ?? []).filter(
    (p) => p.round !== (painting?.qcRound ?? 1)
  );
  // Siparişi şu an tutan partner: adım onun adına yapılır (sunucudaki
  // partnerHoldingOrder ile aynı cevap — sayfa onu çağırıp gönderiyor).
  const holder = onBehalfHolder ?? "none";
  const holderLabel = holder === "painter" ? "Boyacı" : "Üretici";
  // Hangi adım sırada: sunucu son sözü söyler, bu liste yalnız öneridir.
  const onBehalfOptions: OnBehalfAction[] = refunded
    ? []
    : holder === "painter"
      ? ((): OnBehalfAction[] => {
          switch (painting?.painterStatus ?? order.painterStatus ?? "") {
            case "assigned":
              return ["accept"];
            case "accepted":
            case "painting":
              return ["printed"];
            case "painted":
            case "qc_rejected":
              return ["submit_qc"];
            case "qc_approved":
              return ["ship"];
            default:
              return [];
          }
        })()
      : holder === "manufacturer"
        ? ((): OnBehalfAction[] => {
            switch (manufacturerStatus ?? "") {
              case "assigned":
                return ["accept"];
              // Üretici işi aldı ama başlamadı: sıradaki adım BASKIYI BAŞLATMA
              // (on-behalf.ts: accepted → printing). "Baskıyı bitirdi" adımını
              // sunucu yalnız "baskıda" durumundan kabul ettiği için burada
              // onu önermek garanti reddedilen bir tıklamaydı.
              case "accepted":
                return ["start_printing"];
              case "printing":
                return ["printed"];
              case "printed":
              case "qc_rejected":
                return ["submit_qc"];
              case "qc_approved":
                return ["ship"];
              default:
                return [];
            }
          })()
        : [];
  const addr = order.shippingAddress;

  /**
   * Satıcının kendi katalog ürünü: atama ekranı bunu ÖNCEDEN söylemeli.
   *
   * Kuralı sunucu uyguluyor (yalnız sahibi atölye basabilir), ama admin'in onu
   * ancak reddi görünce öğrenmesi ekranı "neden olmadı" oyununa çeviriyordu.
   */
  const sellerOwnedNotice = order.sellerManufacturerId ? (
    <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
      Bu sipariş satıcının kendi kataloğundan çıktı: normalde yalnız satıcının
      kendi atölyesi basabilir. Başka bir atölye seçerseniz ayrıca onay ve
      gerekçe istenir; gerekçe denetim kaydına yazılır ve satıcıya bildirim
      gider.
    </p>
  ) : null;

  const assignManufacturer = async (
    manufacturerId?: string,
    sellerOverrideReason?: string
  ) => {
    // Accept the id as an argument so call sites that just did a
    // `setSelectedManufacturerId(...)` then call us can pass it directly —
    // otherwise we'd read the stale closure value (`""` on first click).
    const id = manufacturerId ?? selectedManufacturerId;
    if (!id) return;
    setLoading("assign-manufacturer");
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/assign-manufacturer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manufacturerId: id,
          // Mülkiyet aşması: yalnız admin aşağıdaki onayı verip gerekçe
          // yazdığında gönderilir. Gerekçesiz bir aşmayı sunucu da reddeder.
          ...(sellerOverrideReason
            ? {
                allowSellerOverride: true,
                overrideReason: sellerOverrideReason,
              }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // MÜLKİYET REDDİ bir yarış hatası değil: aynı isteği tekrar denemek
        // hiçbir zaman işe yaramaz, admin'in KARAR vermesi gerekir. Satıcının
        // atölyesi temelli kapandığında elinde bir çıkış kalsın diye onay +
        // gerekçe istenir; ikisi de yoksa sipariş rakibe gitmez.
        if (data.requiresSellerOverride && !sellerOverrideReason) {
          const seller = data.sellerName
            ? `${data.sellerName} atölyesinin`
            : "bir satıcının";
          const confirmed = window.confirm(
            [
              `Bu sipariş ${seller} kendi kataloğundan çıktı: ürünü normalde yalnız o atölye basabilir.`,
              "",
              "Yine de başka bir atölyeye atamak istiyor musunuz?",
              "Devam ederseniz gerekçe istenir; gerekçe denetim kaydına yazılır ve satıcıya bildirim gider.",
            ].join("\n")
          );
          if (!confirmed) return;
          const typed = promptSellerOverrideReason(SELLER_OVERRIDE_REASON_PROMPT, "");
          if (!typed) return;
          await assignManufacturer(id, typed);
          return;
        }
        // Gerekçe kapının barajını geçmediyse (400) admin'i orada bırakmayız:
        // kutu bu kez SUNUCUNUN cümlesiyle yeniden açılır (baraj sayısını o
        // taşır, bkz. promptSellerOverrideReason). Eskiden buradaki tek çıkış
        // hata mesajıydı ve yazılan gerekçe de kayboluyordu.
        if (sellerOverrideReason && res.status === 400) {
          const retyped = promptSellerOverrideReason(
            data.error || SELLER_OVERRIDE_REASON_PROMPT,
            sellerOverrideReason
          );
          if (retyped) {
            await assignManufacturer(id, retyped);
            return;
          }
        }
        reportFailure(data.error || d["admin.orderDetail.actionFailed"]);
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  /**
   * Take the order back from the current manufacturer. With a target id it is
   * handed over in the same call; without one it returns to the queue.
   */
  const revokeManufacturer = async (
    targetManufacturerId?: string,
    sellerOverrideReason?: string
  ) => {
    // Mülkiyet devrinde denetim satırına geçen metin, kutuya yazılan kısa
    // "sebep" değil ayrıca sorulan gerekçedir — atama ekranındaki akışın aynısı.
    const effectiveReason = sellerOverrideReason ?? revokeReason.trim();
    if (effectiveReason.length < 3) {
      alert("Geri alma sebebi zorunludur.");
      return;
    }
    setLoading(targetManufacturerId ? `revoke-${targetManufacturerId}` : "revoke");
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/revoke-manufacturer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: effectiveReason,
          // The strike box is hidden on a refunded order; a tick made before a
          // refund arrived live must not ride along with the cleanup.
          strike: !refunded && revokeStrike,
          blocklist: revokeBlocklist,
          // Yalnız hedefsiz geri almada anlamlı: bir üreticiye devrederken
          // zaten otomatik atama çalışmaz.
          keepInQueue: !targetManufacturerId && revokeKeepInQueue,
          ...(targetManufacturerId ? { targetManufacturerId } : {}),
          // Mülkiyet aşması: yalnız admin aşağıdaki uyarıyı okuyup kabul ettiğinde
          // ve AYRICA bir gerekçe yazdığında gönderilir; o gerekçe denetim
          // kaydına aynen yazılır.
          ...(sellerOverrideReason ? { allowSellerOverride: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Mülkiyet reddi: tekrar denemek işe yaramaz, karar admin'indir.
        // Sipariş bu noktada HÂLÂ eski üreticisinde — devir reddedildiğinde
        // geri alma da çalışmadı, yani yarım bir işlem kalmaz.
        if (data.requiresSellerOverride && !sellerOverrideReason) {
          const seller = data.sellerName
            ? `${data.sellerName} atölyesinin`
            : "bir satıcının";
          const confirmed = window.confirm(
            [
              `Bu sipariş ${seller} kendi kataloğundan çıktı: ürünü normalde yalnız o atölye basabilir.`,
              "",
              "Yine de başka bir üreticiye devretmek istiyor musunuz?",
              "Devam ederseniz gerekçe istenir; gerekçe denetim kaydına yazılır ve satıcıya bildirim gider.",
            ].join("\n")
          );
          if (!confirmed) return;
          // Kutudaki kısa "sebep"i aşmanın gerekçesi diye GERİ GÖNDERMEK, kapı
          // barajı uygulamaya başladıktan sonra admin'i çıkışı olmayan bir 400'e
          // kilitliyordu (aynı gerekçeyle tekrar denemek hiçbir zaman geçmez).
          // Atama ekranındaki gibi ayrıca sorulur; yazdığı sebep kutuya
          // önceden doldurulur ki uzatsın, sıfırdan yazmasın.
          const typed = promptSellerOverrideReason(
            SELLER_OVERRIDE_REASON_PROMPT,
            revokeReason.trim()
          );
          if (!typed) return;
          await revokeManufacturer(targetManufacturerId, typed);
          return;
        }
        // Gerekçe barajı geçmediyse (400): kutu sunucunun cümlesiyle yeniden
        // açılır — bkz. promptSellerOverrideReason.
        if (sellerOverrideReason && res.status === 400) {
          const retyped = promptSellerOverrideReason(
            data.error || SELLER_OVERRIDE_REASON_PROMPT,
            sellerOverrideReason
          );
          if (retyped) {
            await revokeManufacturer(targetManufacturerId, retyped);
            return;
          }
        }
        reportFailure(data.error || d["admin.orderDetail.actionFailed"]);
        return;
      }
      // One message for the whole outcome. A refunded order is never
      // re-assigned: the route answers reason "refunded" (also when a refund
      // landed while this page was open). The old text blamed a race ("başkası
      // tarafından alındı") and invited a retry that can only fail.
      const tookOver = !!data.prevStatus && data.prevStatus !== "assigned";
      // Otomatik yerleştirme satıcının kendi ürününde SIRALAMA sonucu değildir:
      // mülkiyet kuralı gereği tek olası atölye satıcının kendisidir
      // (autoAssignPlacementPlan → "seller"), yani sipariş "sıradaki uygun
      // atölyeye" değil SAHİBİNE geri döner. Tek cümle ikisini birbirine
      // karıştırıyordu ve admin siparişi rakip bir atölyede sanabiliyordu.
      const autoPlacedCopy = order.sellerManufacturerId
        ? "Atama geri alındı ve sipariş, ürünün sahibi olan satıcının kendi atölyesine geri verildi (sıralamayla değil, mülkiyet kuralıyla)."
        : "Atama geri alındı ve sipariş otomatik olarak sıradaki uygun atölyeye atandı.";
      // Otomatik atama devredeyken "geri al" tıklaması işi saniyeler içinde
      // BAŞKA bir atölyeye gönderebiliyor. Bu yüzden sonuç artık her hâlde
      // söylenir: sessiz kalmak, admin'in siparişi kuyrukta sandığı hâlde
      // üretime girmiş olmasına yol açardı.
      const outcome =
        data.reason === "refunded" || refunded
          ? "Üretici siparişten ayrıldı. Sipariş iade edildiği için yeniden atanmadı; atama kuyruğuna da dönmez."
          : targetManufacturerId && data.reassigned === false
            ? // Sunucu devrin neden olmadığını söylüyorsa onu göster: her
              // başarısız devri yarışa yormak, tekrarlanamayacak bir denemeyi
              // (ör. mülkiyet) tekrar ettiriyordu.
              `Atama geri alındı ancak yeni üreticiye devredilemedi. ${
                data.handoffError ??
                "Sipariş bu sırada başkası tarafından alınmış olabilir."
              } Listeden tekrar seçin.`
            : targetManufacturerId
              ? sellerOverrideReason
                ? "Atama geri alındı ve sipariş seçtiğiniz üreticiye devredildi. Mülkiyet devri denetim kaydına yazıldı; satıcıya bildirim gitti."
                : "Atama geri alındı ve sipariş seçtiğiniz üreticiye devredildi."
              : data.autoAssigned
                ? autoPlacedCopy
                : data.heldForSeller
                  ? // Satıcının kendi ürünü: kuyrukta kalmasının sebebi aday
                    // yokluğu ya da kapalı anahtar DEĞİL, mülkiyet kuralı.
                    "Atama geri alındı. Bu ürünü yalnız satıcının kendi atölyesi basabilir, bu yüzden sipariş otomatik olarak başka bir atölyeye verilmedi; kuyrukta kararınızı bekliyor."
                  : data.keptInQueue
                    ? "Atama geri alındı. Sipariş, isteğiniz üzerine otomatik atanmadan kuyrukta bekliyor."
                    : "Atama geri alındı; sipariş atama kuyruğunda bekliyor (uygun aday bulunamadı ya da otomatik atama kapalı).";
      if (outcome) {
        alert(
          tookOver
            ? `${outcome}\nNot: üretici bu sırada siparişi "${data.prevStatus}" durumuna almıştı.`
            : outcome
        );
      }
      setRevokeReason("");
      setRevokeKeepInQueue(false);
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  /**
   * Pull a painting order back from the painter to the assignment queue. Detaches
   * both the painter and the manufacturer and reverses the manufacturer's accrued
   * print earning (server-side).
   *
   * İADE EDİLMİŞ siparişte yol BAŞKADIR (revoke-painter/route.ts ·
   * detachRefundedFromPainter): yalnız koparır — durum korunur, kuyruğa dönmez,
   * otomatik atama yapılmaz, kara liste yazılmaz ve PARAYA DOKUNULMAZ. Kartın
   * metni de, gönderilen alanlar da bu ayrımı izler.
   */
  const revokePainter = async () => {
    if (revokePainterReason.trim().length < 3) {
      alert("Geri alma sebebi zorunludur.");
      return;
    }
    setLoading("revoke-painter");
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/revoke-painter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: revokePainterReason.trim(),
          // İade edilmiş siparişte ceza YOKTUR: rota bu alanı hiç okumaz ve
          // ekran da onu sormaz (kutu gizli). Gönderilen değer, kaydın
          // gerçeğiyle aynı kalsın diye burada da kapatılır.
          blocklistManufacturer: refunded ? false : revokePainterBlocklist,
          // Admin'in açık isteği: yerleştirme yapılmasın. Rotanın kabul ettiği
          // alan (revoke-painter/route.ts) buraya kadar bağlanmamıştı, bu yüzden
          // seçenek ekranda hiç yoktu.
          keepInQueue: revokePainterKeepInQueue,
          // GÜVENİLİRLİK CEZASI — ölçülen kusur: rota `strike`i kabul ediyor ve
          // işliyordu (POST edildiğinde boyacının strike_count'u 0 → 1 oldu), ama
          // panel alanı HİÇ göndermiyordu; boyacı cezaları bu yüzden hiç
          // ateşlenmedi. Kapılar burada da uygulanır ki gönderilen değer kaydın
          // gerçeğiyle aynı olsun: iade edilmiş siparişte ceza yok, işi henüz
          // üstlenmemiş (cevapsız) boyacıya ceza yok. Kutu o hâllerde zaten
          // ekranda değil; canlıda araya giren bir iade için ikinci kapı budur.
          strike: canStrikePainter && revokePainterStrike,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        reportFailure(data.error || d["admin.orderDetail.actionFailed"]);
        return;
      }
      // Sonuç her hâlde söylenir. Bu tık, işi boyacıdan alırken siparişi
      // saniyeler içinde BAŞKA bir üreticiye gönderebiliyor; sessiz kalmak,
      // admin'in siparişi kuyrukta sandığı hâlde üretime girmiş olmasına yol
      // açardı. Dallar üretici geri almasındakilerin AYNISIDIR — aynı cümleler,
      // aynı sıra: iade, satıcıya geri dönüş, sıralamadan gelen atölye,
      // mülkiyet yüzünden kuyrukta tutma, admin isteğiyle kuyrukta bırakma,
      // uygun aday yok. Eski metin satıcı dallarını hiç tanımıyordu: mülkiyet
      // kuralıyla kuyrukta kalan bir mağaza siparişi "uygun aday bulunamadı"
      // diye okunuyor ve admin, aslında kural gereği kapalı olan atamayı
      // üretici havuzunda ya da anahtarda arıyordu.
      alert(
        data.reason === "refunded" || refunded
          ? "Boyacı ve üretici siparişten ayrıldı. Sipariş iade edildiği için yeniden atanmadı; atama kuyruğuna da dönmez."
          : data.autoAssigned
            ? order.sellerManufacturerId
              ? "Boyacı ve üretici çıkarıldı; sipariş, ürünün sahibi olan satıcının kendi atölyesine geri verildi (sıralamayla değil, mülkiyet kuralıyla). Yeni üretici baskıya sıfırdan başlar."
              : "Boyacı ve üretici çıkarıldı; sipariş otomatik olarak sıradaki uygun atölyeye atandı. Yeni üretici baskıya sıfırdan başlar."
            : data.heldForSeller
              ? "Boyacı ve üretici çıkarıldı. Bu ürünü yalnız satıcının kendi atölyesi basabilir, bu yüzden sipariş otomatik olarak başka bir atölyeye verilmedi; kuyrukta kararınızı bekliyor."
              : data.keptInQueue
                ? "Boyacı ve üretici çıkarıldı. Sipariş, isteğiniz üzerine otomatik atanmadan kuyrukta bekliyor."
                : "Boyacı ve üretici çıkarıldı; sipariş atama kuyruğunda bekliyor (uygun aday bulunamadı ya da otomatik atama kapalı)."
      );
      // İşlem BAŞARILI ama eksik kalan bir şey varsa (koli hâlâ dışarıda) uç
      // bunu `warning` ile söyler. Uyarı kutusu hata kutusundan ayrıdır: geri
      // alma geçerlidir, kırmızı bir kutu onu başarısız gösterirdi.
      setActionWarning(responseWarning(data));
      setRevokePainterReason("");
      setRevokePainterKeepInQueue(false);
      setRevokePainterStrike(false);
      setRevokePainterOpen(false);
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  /**
   * Hand the job to a painter on the manufacturer's behalf. Server-side this is
   * the same operation as the manufacturer's "send to painter": same guards,
   * same status transition, and it accrues the manufacturer's print earning.
   */
  // Canlı önizleme: route ile AYNI saf fonksiyon (carvePaintingShare), yani
  // ekranda görülen bölüşüm sunucunun yazacağıyla birebir aynıdır.
  const paintingPreview = useMemo(() => {
    if (!painting || painting.needsPainting || !paintingAmount.trim()) return null;
    return carvePaintingShare(
      {
        amountKurus: painting.amountKurus,
        productionBaseKurus: painting.productionBaseKurus,
        paintingPriceKurus: painting.paintingPriceKurus,
      },
      parseTryToKurus(paintingAmount)
    );
  }, [painting, paintingAmount]);

  const handleAddPainting = async () => {
    if (!paintingPreview?.ok || !painting) return;
    if (addPaintingReason.trim().length < 10) {
      setAddPaintingError("Değişiklik gerekçesi en az 10 karakter olmalıdır.");
      return;
    }
    // Para taşıyan, üreticiye bildirim giden bir işlem: tek tıkla değil, bölüşümü
    // görüp onaylayarak.
    const ok = window.confirm(
      [
        `Boyacı payı ${formatCurrency(paintingPreview.paintingAfter, loc)} üretim payından ayrılacak.`,
        `Üretim payı: ${formatCurrency(paintingPreview.productionBefore, loc)} → ${formatCurrency(paintingPreview.productionAfter, loc)}`,
        `Müşteri toplamı değişmez (${formatCurrency(painting.amountKurus, loc)}). Üreticiye bildirim gider.`,
        "",
        "Devam edilsin mi?",
      ].join("\n")
    );
    if (!ok) return;
    setLoading("add-painting");
    setAddPaintingError(null);
    setActionWarning(null);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/add-painting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: paintingAmount, reason: addPaintingReason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Inline, next to the amount; the refresh shows the state the route
        // refused against (e.g. the earning accrued meanwhile).
        setAddPaintingError(body.error ?? "Boyama kalemi eklenemedi.");
        router.refresh();
        return;
      }
      setPaintingAmount("");
      setAddPaintingReason("");
      setActionWarning(responseWarning(body));
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  const handleAssignPainter = async () => {
    if (!effectivePainterPick) return;
    setLoading("assign-painter");
    setActionWarning(null);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/assign-painter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          painterId: effectivePainterPick,
          carrier: painterCarrier || undefined,
          trackingNumber: painterTracking.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        reportFailure(data.error || d["admin.orderDetail.actionFailed"]);
        return;
      }
      setPainterPick("");
      setPainterCarrier("");
      setPainterTracking("");
      // Atama yapıldı; uç eksik kalan bir şey bildirdiyse (gerekçe kaydı
      // yazılamadı) admin bunu SAYFANIN ÜSTÜNDE okur — eskiden gövde yalnız
      // hata dalında okunduğu için uyarı hiçbir yere ulaşmıyordu.
      setActionWarning(responseWarning(data));
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  // ─── Refund ──────────────────────────────────────────────
  // There is no PayTR refund integration: the button only marks the order
  // refunded, detaches the partners, reverses UNPAID earnings and restores the
  // gift card. Both the card and the confirm dialog say so, and name every
  // partner earning that is already paid out and will therefore stay paid.
  const refundMoneyInstruction =
    order.paymentMethod === "bank_transfer"
      ? `Tahsil edilen ${formatCurrency(collectedKurus, loc)} müşteriye bankadan elle havale edilmeli.`
      : order.paymentMethod === "gift_card_full"
        ? "Nakit tahsilat yok; ödemenin tamamı hediye kartıyla yapıldı."
        : `Tahsil edilen ${formatCurrency(collectedKurus, loc)} PayTR panelinden elle iade edilmeli.`;

  const describeEarning = (s: PartyShare): string => {
    const e = s.earning;
    if (!e) return "";
    const who = `${partyLabel(s)}${s.partnerName ? ` (${s.partnerName})` : ""}`;
    const ref = e.payout?.reference ? `, ref ${e.payout.reference}` : "";
    const when = e.payout?.paidAt ? `, ${formatDateTime(e.payout.paidAt, loc)}` : "";
    return `• ${who}: net ${formatCurrency(e.netKurus, loc)}${ref}${when}`;
  };

  const handleRefund = async () => {
    const text = [
      `${order.orderNumber} iade edildi olarak işaretlenecek.`,
      "",
      "PARA OTOMATİK İADE EDİLMEZ.",
      refundMoneyInstruction,
      ...(order.giftCardAmountKurus > 0
        ? [`Hediye kartından karşılanan ${formatCurrency(order.giftCardAmountKurus, loc)} karta otomatik geri yüklenir.`]
        : []),
      "",
      ...(paidOutShares.length > 0
        ? ["Zaten ödenmiş, GERİ ALINMAYACAK hakedişler:", ...paidOutShares.map(describeEarning), ""]
        : []),
      ...(batchedShares.length > 0
        ? ["Bekleyen ödeme partisinden düşülecek hakedişler:", ...batchedShares.map(describeEarning), ""]
        : []),
      ...(money
        ? []
        : ["Partner hakediş durumu yüklenemedi; iadeden önce Ödemeler sayfasını kontrol edin.", ""]),
      "Üretici ve boyacı siparişten ayrılır, ödenmemiş hakedişler geri alınır. Sipariş durumu korunur ama ileri işlemler kapanır.",
      "",
      "Devam edilsin mi?",
    ].join("\n");
    if (!window.confirm(text)) return;
    await performAction("refund", { reason: refundReason.trim() || "Admin iadesi" });
  };

  // ─── Timeline ────────────────────────────────────────────
  const isFailed = order.status.startsWith("failed") || order.status === "rejected";
  // Map legacy / non-timeline statuses to the closest current timeline step so
  // historical orders still render on the new stepper without crashing.
  const LEGACY_STEP_MAP: Record<string, string> = {
    generating: "awaiting_model",
    processing_mesh: "awaiting_model",
    review: "awaiting_model",
    failed_generation: "awaiting_model",
    failed_mesh: "awaiting_model",
    rejected: "approved",
  };
  // The painting step only exists for orders that go to a painter.
  const timelineSteps = TIMELINE_STEPS.filter(
    (s) => s !== "painting" || order.needsPainting || order.status === "painting"
  );
  const effectiveStatus = LEGACY_STEP_MAP[order.status] || order.status;
  const rawStepIndex = timelineSteps.indexOf(effectiveStatus);
  // Guard: any unmapped/unknown status returns -1 — fall back to the first step
  // so the stepper never crashes.
  const currentStepIndex = rawStepIndex === -1 ? 0 : rawStepIndex;

  // Determine primary action
  const primaryAction = canApprove ? "approve"
    : canStartPrinting ? "start-printing"
    : canShip ? "ship-section"
    : canDeliver ? "deliver"
    : null;

  const hasAnyAction = canApprove || canReject || canForceReview || canStartPrinting || canShip || canDeliver;

  // Customer initials
  const initials = order.customerName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div>
      {/* ─── Header ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between pb-5 mb-5 border-b border-gray-100 gap-3 sm:gap-4">
        <div className="flex items-start gap-4">
          <Link href="/admin/orders" className="mt-1.5 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-2xl font-bold text-gray-900 font-mono tracking-tight">
                {order.orderNumber}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
                {statusLabel(order.status)}
              </span>
              {refunded && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-600 text-white">
                  {paymentStatusLabel(d, order.paymentStatus)}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{order.customerName} &middot; {order.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {displayGlbUrl && (
            <a href={displayGlbUrl} download className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 rounded-full text-sm font-medium text-white transition-colors shadow-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              {d["admin.orderDetail.downloadGlb"]}
            </a>
          )}
          {latestStlParts.length > 1 ? (
            <a
              href={`/api/admin/orders/${order.id}/model-files/zip?kind=stl`}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-full text-sm font-medium text-white transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              STL parçaları (ZIP · {latestStlParts.length})
            </a>
          ) : (
            displayStlUrl && (
              <a href={displayStlUrl} download className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-full text-sm font-medium text-white transition-colors shadow-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                {d["admin.orderDetail.downloadStl"]}
              </a>
            )
          )}
        </div>
      </div>

      {/* ─── İade edildi ─────────────────────────────────────
          A refunded order keeps its status, so without this the page read as a
          live job. The forward cards below are hidden and their routes refuse a
          refunded order as well. */}
      {refunded && (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-rose-50 p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" /></svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-red-900">
                {paymentStatusLabel(d, order.paymentStatus)}
              </h2>
              <p className="mt-0.5 text-sm text-red-800">
                Bu siparişin ödemesi iade edildi. Durumu ({statusLabel(order.status)}) kayıt için
                korunur; onay, model yükleme, üretici atama, baskı, kargo, boyacı atama, boyama
                ekleme ve TESLİM damgası kapalıdır — iade edilmiş sipariş hiçbir yöne kımıldamaz.
                Paket müşteriye ulaştıysa bunu denetim notuna yazın. Yalnız siparişi reddetme
                (kapatma) açık kalır.
              </p>
              {refundRecord && (
                <p className="mt-2 text-xs text-red-700">
                  {formatDateTime(refundRecord.createdAt, loc)} · {refundRecord.adminEmail}
                  {refundRecord.notes ? ` · ${refundRecord.notes}` : ""}
                </p>
              )}
              {paidOutShares.length > 0 && (
                <div className="mt-3 rounded-xl border border-red-200 bg-white/70 px-3 py-2 text-xs text-red-900">
                  <p className="font-semibold">Zaten ödenmiş, geri alınmamış hakediş</p>
                  <ul className="mt-1 space-y-0.5">
                    {paidOutShares.map((s) => (
                      <li key={s.party}>
                        {partyLabel(s)}
                        {s.partnerName ? ` (${s.partnerName})` : ""}: net{" "}
                        {formatCurrency(s.earning?.netKurus ?? 0, loc)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-red-700">Bu tutar partnerde kaldı; sistem geri almaz.</p>
                </div>
              )}
              <p className="mt-2 text-xs text-red-700">
                Bu panel parayı geri göndermez: kartla ödemede PayTR panelinden, havalede bankadan
                elle iade edildiğini doğrulayın.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Yeni uçların hatası ────────────────────────────
          Reddin sebebi tek yerde toplanır: her kart kendi hatasını ayrı ayrı
          saklayınca admin "tıkladım, bir şey olmadı" ile kalıyordu. */}
      {actionError && (
        <div
          role="alert"
          className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 text-xs font-medium underline"
          >
            Kapat
          </button>
        </div>
      )}

      {/* ─── Yapıldı ama EKSİK: uçların `warning` alanı ────
          Hata kutusundan ayrı ve sarı: işlem GERÇEKLEŞTİ, yalnız bir yan adım
          (çoğunlukla karar kaydı) tamamlanamadı. */}
      {actionWarning && (
        <div
          role="status"
          className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span>{actionWarning}</span>
          <button
            type="button"
            onClick={() => setActionWarning(null)}
            className="shrink-0 text-xs font-medium underline"
          >
            Kapat
          </button>
        </div>
      )}

      {/* ─── Müşteri notu ───────────────────────────────────
          Sipariş verilirken yazılan not (hediye paketi, fatura istemiyorum,
          teslimat saati…) sayfaya GELİYOR ama hiçbir yerde basılmıyordu. En
          üstte durur: üretimi ve kargoyu doğrudan etkileyen tek müşteri
          cümlesi odur. */}
      {order.customerNote && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-900">
            Müşteri notu
          </h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{order.customerNote}</p>
        </div>
      )}

      {/* ─── Horizontal Stepper Timeline ────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
        <div className="flex items-center justify-between overflow-x-auto">
          {timelineSteps.map((step, i) => {
            const isActive = i < currentStepIndex;
            const isCurrent = step === effectiveStatus;
            const isFailedStep = isCurrent && isFailed;
            return (
              <div key={step} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center min-w-[72px]">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isFailedStep
                      ? "bg-red-500 text-white ring-4 ring-red-100 shadow-sm"
                      : isCurrent
                        ? "bg-blue-600 text-white ring-4 ring-blue-100 shadow-sm"
                        : isActive
                          ? "bg-green-500 text-white"
                          : "bg-gray-100 text-gray-400"
                  }`}>
                    {isFailedStep ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    ) : (
                      <StepIcon step={step} className="w-4 h-4" />
                    )}
                  </div>
                  <span className={`text-[10px] mt-1.5 text-center leading-tight whitespace-nowrap ${
                    isFailedStep ? "font-semibold text-red-600" :
                    isCurrent ? "font-semibold text-blue-700" :
                    isActive ? "text-green-700 font-medium" :
                    "text-gray-400"
                  }`}>
                    {statusLabel(step)}
                  </span>
                </div>
                {i < timelineSteps.length - 1 && (
                  <div className="flex-1 mx-1 h-0.5 min-w-[16px]">
                    <div className={`h-full rounded-full transition-colors duration-300 ${i < currentStepIndex ? "bg-green-400" : "bg-gray-200"}`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ Print gate card (auto-generated models only) ════════ */}
      {/* The admin's whole job for an auto model is one click, so this sits
          directly above the action zone: verdict, why, the 360° video and the
          measurements that back the ruling — all before the button. */}
      {printGate && (
        <div className={`rounded-2xl border p-5 mb-6 ${gateTone.card}`}>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className={`text-base font-semibold ${gateTone.heading}`}>
              {d["admin.gate.title"]}
            </h3>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${gateTone.badge}`}>
              {printGate.verdict
                ? d[`admin.gate.verdict.${printGate.verdict}` as keyof typeof d]
                : d["admin.gate.verdictUnknown"]}
            </span>
            {printGate.round > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${gateTone.chip}`}>
                {d["admin.gate.round"]}: {printGate.round}
              </span>
            )}
          </div>
          {/* Named explicitly so nobody reads a shadow-mode "fail" as a block. */}
          <p className={`mt-1 text-sm ${gateTone.body}`}>
            {printGate.mode === "enforce"
              ? d["admin.gate.mode.enforce"]
              : d["admin.gate.mode.shadow"]}
          </p>
          {/* Ölçüm kaydı OKUNAMADI: "ölçüm yok" (yeni sipariş) ile aynı şey
              değil. Sunucu kapıyı gerekçeli onaya çekti; kart sebebini söyler,
              yoksa admin boş bir karara bakıp "ölçülmemiş" sanırdı. */}
          {readFailures?.printGateReport && (
            <ReadFailedNotice>
              Bu siparişin ölçüm kaydı (baskı raporu) şu anda okunamadı (geçici sistem
              arızası). Aşağıdaki karar ve ölçümler EKSİK değil, BİLİNMİYOR: hiçbir
              ölçüm yapılmamış gibi görünmesi bir okuma arızasıdır. Onay bu yüzden
              gerekçe ister; birkaç dakika sonra sayfayı yenileyin.
            </ReadFailedNotice>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {/* Reasons */}
            <div>
              <h4 className={`text-xs font-semibold uppercase tracking-wider ${gateTone.body}`}>
                {d["admin.gate.reasons"]}
              </h4>
              {printGate.reasons.length > 0 ? (
                <ul className={`mt-2 space-y-1.5 text-sm ${gateTone.heading}`}>
                  {printGate.reasons.map((reason, i) => (
                    <li key={`${reason}-${i}`} className="flex gap-2">
                      <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-60" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`mt-2 text-sm ${gateTone.body}`}>
                  {printGate.measurements
                    ? d["admin.gate.noReasons"]
                    : d["admin.gate.noReport"]}
                </p>
              )}

              {/* Turntable */}
              <h4 className={`mt-4 text-xs font-semibold uppercase tracking-wider ${gateTone.body}`}>
                {d["admin.gate.turntable"]}
              </h4>
              {printGate.turntableUrl ? (
                <video
                  src={printGate.turntableUrl}
                  controls
                  loop
                  muted
                  playsInline
                  className="mt-2 w-full max-w-sm rounded-xl border border-white/60 bg-black/5"
                />
              ) : (
                <p className={`mt-2 text-sm ${gateTone.body}`}>
                  {d["admin.gate.noTurntable"]}
                </p>
              )}
            </div>

            {/* Measurements */}
            <div>
              <h4 className={`text-xs font-semibold uppercase tracking-wider ${gateTone.body}`}>
                {d["admin.gate.measurements"]}
              </h4>
              {printGate.measurements ? (
                <table className="mt-2 w-full text-sm">
                  <tbody className={gateTone.heading}>
                    {[
                      [d["admin.gate.measuredHeight"], gateMm(printGate.measurements.heightMm, 1)],
                      [
                        d["admin.gate.volume"],
                        printGate.measurements.volumeCm3 == null
                          ? "—"
                          : `≈ ${formatNumber(Math.round(printGate.measurements.volumeCm3 * 10) / 10, loc)} cm³`,
                      ],
                      [d["admin.gate.faceCount"], formatNumber(printGate.measurements.faceCount, loc)],
                      [d["admin.gate.componentCount"], String(printGate.measurements.componentCount)],
                      [d["admin.gate.minWallP1"], gateMm(printGate.measurements.minWallP1Mm, 2)],
                      [d["admin.gate.minWallP5"], gateMm(printGate.measurements.minWallP5Mm, 2)],
                      [
                        d["admin.gate.fillRatio"],
                        printGate.measurements.fillRatio == null
                          ? "—"
                          : printGate.measurements.fillRatio.toFixed(3),
                      ],
                      [
                        d["admin.gate.baseAdded"],
                        printGate.measurements.baseAdded ? d["common.yes"] : d["common.no"],
                      ],
                    ].map(([label, value]) => (
                      <tr key={label} className="border-b border-white/60 last:border-0">
                        <th scope="row" className={`py-1.5 pr-3 text-left font-normal ${gateTone.body}`}>
                          {label}
                        </th>
                        <td className="py-1.5 text-right font-medium tabular-nums">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className={`mt-2 text-sm ${gateTone.body}`}>{d["admin.gate.noReport"]}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Persistent Action Zone (what do I do now) ═══════════ */}
      {/* Blocks below are mutually exclusive by order state, so at most one shows. */}
      <div className="space-y-3 mb-6">

        {/* ─── 3D Model Upload (awaiting_model + admin-fulfilled paid) ─────── */}
        {canUploadModel && (
          <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-2xl border border-indigo-200 p-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-indigo-900">3D Modeli Yükle</h3>
                <p className="text-sm text-indigo-700 mt-0.5">Müşterinin onayladığı görselden 3D modeli üretip yükleyin. Çok parçalı işlerde tüm parçaları ya da ZIP&apos;i tek seferde yükleyebilirsin.</p>
                <div className="mt-3">
                  {/* Yükleme bitince sipariş "onaylandı"ya geçer ve bu kart kaybolur;
                      yeni sürüm yalnız Üretim sekmesinde listelenir. Oraya geçmezsek
                      admin yüklemenin olup olmadığını göremez. */}
                  <OrderModelUploader
                    orderId={order.id}
                    variant="initial"
                    onUploaded={() => {
                      setTab("production");
                      router.refresh();
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Primary Action Panel ─────────────────── */}
        {hasAnyAction && (
          <div className="space-y-3">
            {primaryAction === "approve" && (
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-green-900">{d["admin.orderDetail.approve"]}</h3>
                    <p className="text-sm text-green-700 mt-0.5">{d["admin.orderDetail.adminNote"]}</p>
                    <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-3 px-3 py-2 bg-white border border-green-200 rounded-xl text-sm placeholder:text-green-400 focus:outline-none focus:ring-2 focus:ring-green-300 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                    {/* Enforce mode + a failing gate: the route answers 409
                        `gate_override_required` unless the admin says, in
                        writing, that they looked and want it printed anyway. */}
                    {gateOverrideNeeded && (
                      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
                        <label className="block text-sm font-semibold text-red-900" htmlFor="gate-override-reason">
                          {d["admin.gate.overrideTitle"]}
                        </label>
                        <p className="mt-0.5 text-xs text-red-700">{d["admin.gate.overrideHint"]}</p>
                        <textarea
                          id="gate-override-reason"
                          rows={2}
                          value={gateOverrideReason}
                          onChange={(e) => setGateOverrideReason(e.target.value)}
                          className="w-full mt-2 px-3 py-2 bg-white border border-red-200 rounded-xl text-sm placeholder:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-300 transition-shadow"
                          placeholder={d["admin.gate.overridePlaceholder"]}
                        />
                      </div>
                    )}
                    <button
                      onClick={() =>
                        performAction(
                          "approve",
                          gateOverrideNeeded
                            ? { overrideGateFail: true, overrideReason: gateOverrideReason.trim() }
                            : {}
                        )
                      }
                      disabled={!!loading || (gateOverrideNeeded && gateOverrideReason.trim().length === 0)}
                      className="mt-3 px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:bg-gray-400 transition-colors shadow-sm"
                    >
                      {loading === "approve" ? d["admin.orderDetail.approving"] : d["admin.orderDetail.approve"]}
                    </button>
                    {gateOverrideNeeded && gateOverrideReason.trim().length === 0 && (
                      <p className="mt-2 text-xs text-red-700">{d["admin.gate.overrideRequired"]}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {primaryAction === "start-printing" && (
              <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-2xl border border-purple-200 p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-500 text-white flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-purple-900">{d["admin.orderDetail.startPrint"]}</h3>
                    <p className="text-sm text-purple-700 mt-0.5">{d["admin.orderDetail.adminNote"]}</p>
                    <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-3 px-3 py-2 bg-white border border-purple-200 rounded-xl text-sm placeholder:text-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                    <button onClick={() => performAction("start-printing")} disabled={!!loading} className="mt-3 px-6 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:bg-gray-400 transition-colors shadow-sm">
                      {loading === "start-printing" ? d["admin.orderDetail.startingPrint"] : d["admin.orderDetail.startPrint"]}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {primaryAction === "deliver" && (
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-green-900">{d["admin.orderDetail.deliver"]}</h3>
                    <p className="text-sm text-green-700 mt-0.5">{d["admin.orderDetail.adminNote"]}</p>
                    <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-3 px-3 py-2 bg-white border border-green-200 rounded-xl text-sm placeholder:text-green-400 focus:outline-none focus:ring-2 focus:ring-green-300 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                    <button onClick={() => performAction("deliver")} disabled={!!loading} className="mt-3 px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:bg-gray-400 transition-colors shadow-sm">
                      {loading === "deliver" ? d["admin.orderDetail.delivering"] : d["admin.orderDetail.deliver"]}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Ship section */}
            {primaryAction === "ship-section" && (
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-emerald-900">{d["admin.orderDetail.kargoShip"]}</h3>
                    <p className="text-sm text-emerald-700 mt-0.5">{d["admin.orderDetail.adminNote"]}</p>
                    <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-3 px-3 py-2 bg-white border border-emerald-200 rounded-xl text-sm placeholder:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                    <button onClick={() => performAction("ship-kargo")} disabled={!!loading} className="mt-3 w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:bg-gray-400 transition-colors shadow-sm">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>
                      {loading === "ship-kargo" ? d["admin.orderDetail.kargoCreating"] : d["admin.orderDetail.kargoShip"]}
                    </button>
                    <div className="flex items-center gap-3 mt-4">
                      <div className="flex-1 border-t border-emerald-200" />
                      <span className="text-xs text-emerald-500 font-medium">{d["admin.orderDetail.orManual"]}</span>
                      <div className="flex-1 border-t border-emerald-200" />
                    </div>
                    <div className="mt-3 space-y-2">
                      <select
                        value={manualShipCarrier}
                        onChange={(e) => setManualShipCarrier(e.target.value)}
                        aria-label="Kargo firması"
                        className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 transition-shadow"
                      >
                        <option value="">Kargo firmasını seçin…</option>
                        {CARRIERS.map((c) => (
                          <option key={c} value={c}>
                            {CARRIER_LABEL[c] ?? c}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <input type="text" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className="flex-1 px-3 py-2 bg-white border border-emerald-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 transition-shadow" placeholder={d["admin.orderDetail.trackingPlaceholder"]} />
                        <button
                          onClick={() => {
                            if (trackingNumber.trim() && manualShipCarrier) {
                              performAction("ship", {
                                trackingNumber: trackingNumber.trim(),
                                carrier: manualShipCarrier,
                              });
                            }
                          }}
                          disabled={!!loading || !trackingNumber.trim() || !manualShipCarrier}
                          className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-xl hover:bg-gray-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
                        >
                          {loading === "ship" ? d["admin.orderDetail.shipping"] : d["admin.orderDetail.ship"]}
                        </button>
                      </div>
                    </div>
                    {/* Undo an accidental self-print: back to the assignment stage
                        so the admin can hand the job to a manufacturer instead. */}
                    <button
                      onClick={() => { if (confirm("Baskıyı geri alıp siparişi 'onaylı' (atama) aşamasına döndür? Sonra bir üreticiye atayabilirsiniz.")) performAction("unstart-printing"); }}
                      disabled={!!loading}
                      className="mt-3 text-xs font-medium text-emerald-700 hover:text-emerald-900 hover:underline disabled:text-gray-400"
                    >
                      {loading === "unstart-printing" ? "Geri alınıyor…" : "↩ Baskıyı geri al (onaya döndür)"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* No primary action but notes input needed for secondary actions */}
            {!primaryAction && hasAnyAction && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{d["admin.orderDetail.adminNote"]}</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
              </div>
            )}

            {/* Secondary actions */}
            {(canReject || canForceReview) && (
              <div className="flex items-center gap-3 flex-wrap px-1">
                {canForceReview && (
                  <button onClick={() => performAction("force-review")} disabled={!!loading} className="text-sm text-yellow-600 hover:text-yellow-800 font-medium hover:underline transition-colors disabled:text-gray-400">
                    {loading === "force-review" ? d["admin.orderDetail.forcingReview"] : d["admin.orderDetail.forceReview"]}
                  </button>
                )}
                {canReject && (
                  <button onClick={() => { if (confirm(d["admin.orderDetail.rejectConfirm"])) performAction("reject", { reason: notes || d["admin.orderDetail.rejectDefault"] }); }} disabled={!!loading} className="text-sm text-red-500 hover:text-red-700 font-medium hover:underline transition-colors disabled:text-gray-400">
                    {loading === "reject" ? d["admin.orderDetail.rejecting"] : d["admin.orderDetail.reject"]}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sıralama ÜRETİLEMEDİ: aday listesi boş değil, YOK. Bu ayrımı
            söylemeyen ekran, "hiç uygun atölye yok" diye hiç yapılmamış bir
            değerlendirmenin sonucunu duyurmuş olurdu. */}
        {canAssignManufacturer && readFailures?.candidates && (
          <ReadFailedNotice>
            Üretici öneri sıralaması şu anda üretilemedi (geçici sistem arızası): atölye skorları
            hesaplanamadığı için öneri kartı gösterilemiyor. Bu, &quot;uygun atölye yok&quot; demek
            DEĞİLDİR. Atama kapalı değil — aşağıdaki listeden elle atayabilirsiniz; atama ucu
            skorlardan bağımsız çalışır. Birkaç dakika sonra sayfayı yenileyin.
          </ReadFailedNotice>
        )}
        {canAssignManufacturer && readFailures?.activeManufacturers && (
          <ReadFailedNotice>
            Aktif üretici listesi şu anda okunamadı (geçici sistem arızası); atama kutusu bu yüzden
            boş görünüyor. Kayıtlı atölyeler silinmedi. Birkaç dakika sonra sayfayı yenileyin.
          </ReadFailedNotice>
        )}

        {/* Manufacturer Assignment — ranked recommendations */}
        {canAssignManufacturer && candidates && candidates.length > 0 && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-5 space-y-3">
            <h3 className="text-xs font-semibold text-blue-800 uppercase tracking-wider">{d["admin.orderDetail.assignManufacturer"]}</h3>
            {/* Cümle, aşağıdaki çubuklarla AYNI kaynaktan (SCORE_KEYS) kurulur.
                Elle sayılan liste, sıralayıcıya zamanında teslim ile parti
                uyumu eklendiğinde sessizce yalan söylemeye başlamıştı: cümle
                dört ad sayarken kartlarda altı çubuk çiziliyordu. Tek kaynak
                olunca bileşen eklemek cümleyi de günceller. */}
            <p className="text-xs text-blue-700/80">
              {SCORE_KEYS.map((k) => SCORE_LABELS_TR[k]).join(" · ")} skorlarının
              ağırlıklı toplamına göre sıralandı. En iyi adaylar üstte.
            </p>
            {sellerOwnedNotice}
            <div className="space-y-2">
              {candidates
                .filter((c) => c.eligible)
                .slice(0, 5)
                .map((c, idx) => (
                  <div
                    key={c.manufacturerId}
                    className={`bg-white rounded-xl border p-4 ${
                      idx === 0 && c.totalScore >= 60 ? "border-emerald-300 ring-1 ring-emerald-100" : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-gray-900 truncate">{c.companyName}</h4>
                          {idx === 0 && c.totalScore >= 60 && (
                            <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5">
                              En uygun
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {c.city || "Şehir yok"}{c.district ? ` / ${c.district}` : ""} ·
                          {" "}Yük {c.currentLoad}/{c.maxConcurrentOrders}
                          {c.phone ? (
                            <>
                              {" "}· <a href={`tel:${c.phone}`} className="text-blue-600 hover:underline">{c.phone}</a>
                            </>
                          ) : null}
                        </p>
                        {c.reasons.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {c.reasons.map((r) => (
                              <span key={r} className="text-[10px] bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">
                                {r}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Sıralayıcının BÜTÜN bileşenleri. Dördü gösterilip
                            zamanında teslim ile parti uyumu gizlendiğinde,
                            toplam skor ekrandaki çubuklardan çıkmıyordu ve
                            admin "bu atölye neden önde?" sorusunu buradan
                            cevaplayamıyordu. */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                          {SCORE_KEYS.map((k) => (
                            <div key={k} className="space-y-1">
                              <div className="flex justify-between text-[10px] text-gray-500">
                                <span>{SCORE_SHORT_LABELS_TR[k]}</span>
                                <span>{c.scores[k]}</span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, c.scores[k]))}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="text-2xl font-bold text-blue-700">{c.totalScore}</div>
                        <button
                          onClick={() => {
                            setSelectedManufacturerId(c.manufacturerId);
                            // Pass the id directly to avoid the stale-closure
                            // race where `selectedManufacturerId` is still ""
                            // on this click (React state hasn't flushed yet).
                            assignManufacturer(c.manufacturerId);
                          }}
                          disabled={!!loading}
                          className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                        >
                          {loading === "assign-manufacturer" && selectedManufacturerId === c.manufacturerId
                            ? "Atanıyor..."
                            : "Bu üreticiye ata"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>

            {candidates.some((c) => !c.eligible) && (
              <details className="text-xs text-blue-700/80">
                <summary className="cursor-pointer hover:text-blue-900">
                  Uygun olmayan üreticiler ({candidates.filter((c) => !c.eligible).length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {candidates
                    .filter((c) => !c.eligible)
                    .map((c) => (
                      <li key={c.manufacturerId} className="bg-white/50 rounded-lg px-3 py-1.5 flex justify-between">
                        <span className="text-gray-700">{c.companyName}</span>
                        <span className="text-gray-500">{c.ineligibleReason}</span>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Fallback: classic dropdown if no candidates ranked (no active manufacturers yet) */}
        {canAssignManufacturer && (!candidates || candidates.length === 0) && activeManufacturers && activeManufacturers.length > 0 && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-5">
            <h3 className="text-xs font-semibold text-blue-800 uppercase tracking-wider mb-3">{d["admin.orderDetail.assignManufacturer"]}</h3>
            {sellerOwnedNotice && <div className="mb-3">{sellerOwnedNotice}</div>}
            <div className="flex gap-2">
              <select
                value={selectedManufacturerId}
                onChange={(e) => setSelectedManufacturerId(e.target.value)}
                className="flex-1 px-3 py-2 bg-white border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 transition-shadow"
              >
                <option value="">{d["admin.orderDetail.selectManufacturer"]}</option>
                {activeManufacturers.map((m) => (
                  <option key={m.id} value={m.id}>{m.companyName}</option>
                ))}
              </select>
              <button
                onClick={() => assignManufacturer()}
                disabled={!selectedManufacturerId || !!loading}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors shadow-sm"
              >
                {loading === "assign-manufacturer" ? d["admin.orderDetail.assigning"] : d["admin.orderDetail.assign"]}
              </button>
            </div>
          </div>
        )}

        {/* ─── Atamayı geri al / başka üreticiye devret ───────
            An assigned manufacturer who never answers used to freeze the order:
            the assign endpoint only matches unassigned orders. */}
        {canRevokeManufacturer && (
          <div
            className={`rounded-2xl border p-5 ${
              refunded
                ? "border-gray-200 bg-gray-50/60"
                : isStaleAssignment
                  ? "border-red-200 bg-red-50/60"
                  : "border-amber-200 bg-amber-50/60"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                Üretici ataması
              </h3>
              <span className="text-xs text-gray-500">
                {manufacturer?.companyName} · {manufacturerStatusLabel(manufacturerStatus)}
              </span>
            </div>

            {assignedToManufacturerAt && (
              <p className="mt-2 text-sm">
                {/* A refunded order waits for nobody's answer: the 24h SLA
                    warning would urge chasing a job that is cancelled. */}
                {manufacturerStatus === "assigned" && !refunded ? (
                  <span
                    className={
                      isStaleAssignment
                        ? "font-semibold text-red-700"
                        : waitingHours >= 12
                          ? "font-medium text-amber-700"
                          : "text-gray-600"
                    }
                  >
                    {isStaleAssignment
                      ? `⚠ ${waitingHours} saattir yanıt yok — 24 saatlik süre aşıldı`
                      : `${waitingHours} saattir kabul bekliyor`}
                  </span>
                ) : (
                  <span className="text-gray-600">
                    Atandı: {formatDateTime(assignedToManufacturerAt, loc)}
                  </span>
                )}
              </p>
            )}

            {/* Refunded with a manufacturer still attached: the only thing left
                is to detach them. Re-assignment is closed (refund-end-state)
                and the route refuses a hand-off. */}
            {refunded && (
              <p className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
                Sipariş iade edildi ama üretici hâlâ bağlı. Geri aldığınızda üretici siparişten
                ayrılır; sipariş atama kuyruğuna dönmez ve başka bir üreticiye verilmez.
              </p>
            )}
            {!refunded && order.orderType === "marketplace" && order.sellerManufacturerId && (
              <p className="mt-2 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
                Bu bir mağaza siparişi — ürünü yalnızca sahibi üretici basabilir.
                Önce iptal/iade değerlendirin. Yine de başka bir üreticiye
                devretmek gerekiyorsa (ör. satıcının atölyesi kapandıysa) devir
                sırasında ayrıca onay istenir; yazdığınız sebep denetim kaydına
                geçer ve satıcıya bildirim gider.
              </p>
            )}
            {!refunded &&
              ["printed", "qc_pending", "qc_rejected", "qc_approved"].includes(
                manufacturerStatus ?? ""
              ) && (
              <p className="mt-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-900">
                Bu üreticinin yüklediği QC fotoğrafları yeni üreticiye
                gösterilmeyecek (yeni QC turu başlar); denetim kaydında kalır.
              </p>
            )}

            {!revokeOpen ? (
              <button
                onClick={() => setRevokeOpen(true)}
                className="mt-3 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-gray-800 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
              >
                {refunded ? "Üreticiden geri al" : "Atamayı geri al / başka üreticiye ver"}
              </button>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Sebep <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="örn. 36 saattir yanıt vermedi, telefonla da ulaşılamadı"
                    className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                  />
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-gray-700">
                  {/* Nothing is suggested for a refunded order again, so this
                      switch would change nothing there. */}
                  {!refunded && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={revokeBlocklist}
                        onChange={(e) => setRevokeBlocklist(e.target.checked)}
                      />
                      Bu üreticiyi bu sipariş için bir daha önerme
                    </label>
                  )}
                  {/* No strike either: on a refunded order the refund ended the
                      job, and taking the manufacturer off is cleanup, not a
                      verdict on how they handled it. */}
                  {!refunded && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={revokeStrike}
                        onChange={(e) => setRevokeStrike(e.target.checked)}
                      />
                      Güvenilirlik cezası (strike) uygula
                    </label>
                  )}
                  {/* İade edilen siparişte hiçbir şekilde atama yapılmaz, bu
                      yüzden orada seçeneğin karşılığı yok. */}
                  {!refunded && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={revokeKeepInQueue}
                        onChange={(e) => setRevokeKeepInQueue(e.target.checked)}
                      />
                      Kuyruğumda kalsın (otomatik atama yapılmasın)
                    </label>
                  )}
                </div>
                {!refunded && (
                  <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600">
                    {/* Otomatik atama artık KOŞULLU: sipariş türünün kendi
                        anahtarı (config/flags.ts) kapalıysa, uygun aday
                        çıkmazsa ya da ürün satıcının kendi kataloğundansa
                        yerleştirme olmaz. "Birinci atölyeye atanır" diyen eski
                        cümle, sonuç kutusunun (aşağıdaki alert) zaten ayırdığı
                        bu dalları admin'e önceden yanlış vaat ediyordu. */}
                    {revokeKeepInQueue
                      ? "Sipariş geri alındıktan sonra atanmadan kuyrukta bekler; üreticiyi kendiniz seçersiniz."
                      : order.sellerManufacturerId
                        ? "Bu ürün satıcının kendi kataloğundan çıktı: geri aldığınızda sipariş başka bir atölyeye verilmez — yalnız satıcının kendi atölyesine atanabilir, o da mümkün değilse kuyrukta kararınızı bekler."
                        : "Geri aldığınız anda sipariş, sıralamanın uygun ilk atölyesine otomatik olarak atanmaya çalışılır (az önce çıkardığınız üretici bu denemede hariç tutulur). Bu sipariş türünde otomatik atama kapalıysa ya da uygun aday çıkmazsa kuyrukta bekler. Önce müşteriyle konuşacaksanız ya da iade düşünüyorsanız yukarıdaki kutuyu işaretleyin."}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => revokeManufacturer()}
                    disabled={!!loading || revokeReason.trim().length < 3}
                    className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500"
                  >
                    {loading === "revoke"
                      ? "Geri alınıyor…"
                      : refunded
                        ? "Üreticiden geri al"
                        : revokeKeepInQueue
                          ? "Geri al ve kuyrukta bırak"
                          : "Geri al ve yeniden ata"}
                  </button>
                  <button
                    onClick={() => {
                      setRevokeOpen(false);
                      setRevokeReason("");
                      setRevokeKeepInQueue(false);
                    }}
                    className="rounded-xl bg-white px-4 py-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                  >
                    Vazgeç
                  </button>
                </div>

                {/* Direct hand-off. The unresponsive manufacturer is filtered
                    out — the ranker would otherwise put them first, since
                    their load just dropped. Never on a refunded order: the
                    route refuses the hand-off there, so a target list would
                    promise a re-assignment that cannot happen. */}
                {!refunded && (() => {
                  const targets = (candidates ?? []).filter(
                    (c) => c.eligible && c.manufacturerId !== manufacturer?.id
                  );
                  const fallback = (activeManufacturers ?? []).filter(
                    (m) => m.id !== manufacturer?.id
                  );
                  if (targets.length === 0 && fallback.length === 0) return null;
                  return (
                    <div className="border-t border-gray-200 pt-3">
                      <p className="mb-2 text-xs font-semibold text-gray-600">
                        Doğrudan yeni üreticiye devret
                      </p>
                      {targets.length > 0 ? (
                        <ul className="space-y-1.5">
                          {targets.slice(0, 5).map((c) => (
                            <li
                              key={c.manufacturerId}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs"
                            >
                              <span className="font-medium text-gray-800">
                                {c.companyName}
                                {c.city ? (
                                  <span className="ml-1 font-normal text-gray-500">
                                    · {c.city}
                                  </span>
                                ) : null}
                              </span>
                              <button
                                onClick={() => revokeManufacturer(c.manufacturerId)}
                                disabled={
                                  !!loading || revokeReason.trim().length < 3
                                }
                                className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
                              >
                                {loading === `revoke-${c.manufacturerId}`
                                  ? "Devrediliyor…"
                                  : "Geri al ve ata"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="flex gap-2">
                          <select
                            value={selectedManufacturerId}
                            onChange={(e) =>
                              setSelectedManufacturerId(e.target.value)
                            }
                            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                          >
                            <option value="">Üretici seçin…</option>
                            {fallback.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.companyName}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() =>
                              revokeManufacturer(selectedManufacturerId)
                            }
                            disabled={
                              !selectedManufacturerId ||
                              !!loading ||
                              revokeReason.trim().length < 3
                            }
                            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
                          >
                            Geri al ve ata
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* ─── Atama gerekçesi: kararın kendi anındaki skorları ───────────── */}
        {readFailures?.assignmentDecisions && (
          <ReadFailedNotice>
            Atama değerlendirme kayıtları şu anda okunamadı (geçici sistem arızası): bu siparişin
            &quot;neden bu atölyeye gitti&quot; dökümü gösterilemiyor. Kayıtlar silinmedi; bu kart boş
            DEĞİL, bilinmiyor.
          </ReadFailedNotice>
        )}
        {assignmentDecisions && assignmentDecisions.length > 0 && (
          <AssignmentEvaluationCard
            decisions={assignmentDecisions}
            assignedManufacturerId={manufacturer?.id ?? null}
            loc={loc}
          />
        )}

        {/* ─── Journey QR: the code itself, in the order, not behind a link ── */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-700">
              Yolculuk karekodu
            </h3>
            {journey?.url && (
              <a
                href={`/admin/orders/${order.id}/kart`}
                className="text-xs font-medium text-fuchsia-700 hover:underline"
              >
                Kartı yazdır →
              </a>
            )}
          </div>

          {readFailures?.journey && (
            <ReadFailedNotice>
              Hatıra karekodu kaydı şu anda okunamadı (geçici sistem arızası): bu siparişin
              karekodu var mı, yok mu söyleyemiyoruz. Kutuya konmuş bir karekod geçerliliğini
              YİTİRMEDİ. Birkaç dakika sonra sayfayı yenileyin.
            </ReadFailedNotice>
          )}
          {journey?.qrUrl && journey.url ? (
            <div className="mt-3 flex flex-wrap items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={journey.qrUrl}
                alt="Yolculuk sayfası karekodu"
                className="h-32 w-32 shrink-0 rounded-lg border border-gray-200 bg-white p-1"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-600">
                  Müşteri bunu okutunca fotoğrafının figüre nasıl dönüştüğünü
                  görür. Kargo e-postasına da otomatik eklenir.
                </p>
                <p className="mt-2 break-all rounded-lg bg-gray-50 px-2 py-1.5 font-mono text-[11px] text-gray-700">
                  {journey.url}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard
                        .writeText(journey.url!)
                        .catch(() => {});
                      setJourneyCopied(true);
                      setTimeout(() => setJourneyCopied(false), 2000);
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                  >
                    {journeyCopied ? "Kopyalandı ✓" : "Bağlantıyı kopyala"}
                  </button>
                  <a
                    href={journey.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                  >
                    Sayfayı aç →
                  </a>
                  <a
                    href={journey.qrUrl}
                    download={`karekod-${order.orderNumber}.png`}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                  >
                    Karekodu indir
                  </a>
                </div>
              </div>
            </div>
          ) : (
            /* No code yet. Say which of the two reasons it is — a blank space
               here reads as a broken feature, which is how this first landed. */
            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {journey?.blockedBy === "no_photo" ? (
                <>
                  Bu siparişe müşteri fotoğrafı eklenmemiş. Anlatılacak bir
                  yolculuk olmadığı için karekod da çıkmıyor — karekod
                  fotoğraftan üretilen siparişlere özel. Fotoğrafı siparişe
                  yükleyin, karekod burada belirir.
                </>
              ) : (
                <>
                  Karekod, <strong>3D model yüklendikten sonra</strong> otomatik
                  oluşur. Modeli yükleyin, bu alanda görünecek.
                </>
              )}
            </p>
          )}
        </div>

        {/* ─── Boyama kalemi yok: ekle, sonra boyacı ata ───────────────────
            Boyacı hattı `needsPainting`'e bağlı; boyama kalemi olmadan satılan
            bir siparişte aşağıdaki kart hiç görünmüyordu ve üreticinin bastığı
            işi boyacıya vermenin yolu yoktu. */}
        {/* Varsayılan KAPALI tek satır: her boyamasız siparişte (kit alan müşteri
            dahil) büyük bir form göstermek hem kalabalık hem de yanlışlıkla boyama
            eklemeye davetiye. Üreticinin bastığı işi boyacıya vermek tek tıklık
            uzaklıkta kalır. */}
        {painting &&
          !refunded &&
          !painting.needsPainting &&
          !order.shippedAt &&
          !["shipped", "delivered", "rejected"].includes(order.status) &&
          (!!manufacturer || painting.canAddPainting) && (
          <div
            className={`rounded-2xl border bg-white ${
              showAddPainting ? "border-fuchsia-200 p-5" : "border-gray-200 px-5 py-3"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                  Boyama
                </h3>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  Boyama kalemi yok
                </span>
              </div>
              {painting.canAddPainting && !showAddPainting && (
                <button
                  type="button"
                  onClick={() => setShowAddPainting(true)}
                  className="rounded-lg border border-fuchsia-300 px-3 py-1 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-50"
                >
                  Boyama ekle
                </button>
              )}
            </div>
            {!painting.canAddPainting && (
              <>
                <p className="mt-2 text-xs text-gray-600">{painting.addPaintingBlockedReason}</p>
                {/* A refused add refreshes the page, which can close the form;
                    the route's own words stay visible next to the new reason. */}
                {addPaintingError && <p className="mt-1 text-xs text-red-600">{addPaintingError}</p>}
              </>
            )}
            {painting.canAddPainting && showAddPainting && (
              <>
                <p className="mt-3 text-sm text-gray-700">
                  Bu sipariş boyama kalemi olmadan açılmış, bu yüzden boyacıya atanamıyor. Boyacı payını
                  buradan eklediğinde &quot;Boyacı ata&quot; bölümü açılır.
                </p>
              <div className="mt-3 space-y-2">
                <label htmlFor="painting-amount" className="block text-xs font-medium text-gray-600">
                  Boyacı payı (₺)
                </label>
                <input
                  id="painting-amount"
                  value={paintingAmount}
                  onChange={(e) => {
                    setPaintingAmount(e.target.value);
                    setAddPaintingError(null);
                  }}
                  inputMode="decimal"
                  placeholder="ör. 450"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {paintingPreview?.ok && (
                  <p className="rounded-lg bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-900">
                    Toplam {formatCurrency(painting.amountKurus, loc)} değişmez. Üretim payı{" "}
                    {formatCurrency(paintingPreview.productionBefore, loc)} →{" "}
                    <strong>{formatCurrency(paintingPreview.productionAfter, loc)}</strong>, boyacı payı{" "}
                    <strong>{formatCurrency(paintingPreview.paintingAfter, loc)}</strong>.
                  </p>
                )}
                {paintingPreview && !paintingPreview.ok && (
                  <p className="text-xs text-red-600">
                    {paintingPreview.reason === "exceeds_production"
                      ? "Boyacı payı üretim payından küçük olmalı."
                      : "Geçerli bir tutar girin (ör. 450 ya da 1.250,50)."}
                  </p>
                )}
                <p className="text-[11px] text-gray-500">
                  Müşteriden ek ücret alınmaz; boyacı payı üretim payından ayrılır. Üreticiye bildirim
                  gider ve siparişin yüzeyi &quot;El boyaması&quot; olur.
                </p>
                <label htmlFor="add-painting-reason" className="block text-xs font-medium text-gray-600">
                  Değişiklik gerekçesi
                </label>
                <textarea
                  id="add-painting-reason"
                  value={addPaintingReason}
                  onChange={(e) => setAddPaintingReason(e.target.value)}
                  minLength={10}
                  maxLength={1000}
                  placeholder="En az 10 karakter"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {addPaintingError && <p className="text-xs text-red-600">{addPaintingError}</p>}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <button
                      onClick={handleAddPainting}
                      disabled={!paintingPreview?.ok || addPaintingReason.trim().length < 10 || loading === "add-painting"}
                      className="w-full rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-700 disabled:opacity-50"
                    >
                      {loading === "add-painting" ? "Ekleniyor…" : "Boyama kalemi ekle"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddPainting(false);
                      setPaintingAmount("");
                      setAddPaintingReason("");
                      setAddPaintingError(null);
                    }}
                    className="text-xs text-gray-500 underline hover:text-gray-700"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
              </>
            )}
          </div>
        )}

        {/* ─── Painting leg: who has it, where it is, what they earn ─────── */}
        {painting?.needsPainting && (
          <div className="rounded-2xl border border-fuchsia-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                Boyama
              </h3>
              <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-800">
                {PAINTER_STATUS_LABEL[painting.painterStatus ?? "unassigned"] ??
                  painting.painterStatus ??
                  "Atanmadı"}
              </span>
            </div>

            {/* Who */}
            {painter ? (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-gray-900">{painter.companyName}</p>
                  <span
                    className={`text-xs ${painter.status === "active" ? "text-green-700" : "text-red-700"}`}
                  >
                    {PARTNER_ACCOUNT_STATUS_LABEL[painter.status] ??
                      painter.status.replace(/_/g, " ")}
                    {!painter.acceptingOrders && " · iş almıyor"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">
                  {[painter.contactPerson, painter.phone, painter.email]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            ) : refunded ? (
              <p className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                Sipariş iade edildi; boyacı hattı kapalı.
              </p>
            ) : paintsInHouseShare ? (
              // In-house painting: nobody is missing. The amber "not assigned
              // yet, assign one below" text contradicted the money line under
              // it ("Boyama üreticide").
              <p className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                Boyamayı üretici kendi atölyesinde yapıyor; boyacı ataması gerekmez.
                İşi yine de bir boyacıya verirseniz boyama payı boyacıya geçer.
              </p>
            ) : (
              <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Bu sipariş boyama içeriyor ama <strong>henüz bir boyacıya
                atanmadı</strong>. Normalde üretici QC onayından sonra
                gönderir; takıldıysa aşağıdan siz atayabilirsiniz.
              </p>
            )}

            {/* Money — the painter's cut of the painting add-on. */}
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-gray-500">Boyama ücreti</p>
                <p className="font-medium text-gray-900">
                  {formatCurrency(painting.paintingPriceKurus, loc)}
                </p>
              </div>
              {painting.earning ? (
                <>
                  <div>
                    <p className="text-xs text-gray-500">Boyacı net hakediş</p>
                    <p className="font-medium text-gray-900">
                      {formatCurrency(painting.earning.netKurus, loc)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Hakediş durumu</p>
                    <p className="font-medium text-gray-900">
                      {EARNING_STATUS_LABEL[painting.earning.status] ?? painting.earning.status}
                    </p>
                  </div>
                </>
              ) : (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">Boyacı hakedişi</p>
                  <p className="text-gray-600">
                    {/* Okunamayan kayıt "tahakkuk etmedi" DEĞİLDİR: tahakkuk
                        etmiş bir parayı "henüz oluşmadı" diye göstermek, para
                        hakkında yapılmamış bir okumanın iddiasıdır. */}
                    {readFailures?.painterEarning
                      ? "Hakediş kaydı şu anda okunamadı (geçici sistem arızası) — tahakkuk edip etmediği bilinmiyor"
                      : refunded
                        ? "İade edildi — hakediş oluşmaz"
                        : paintsInHouseShare
                          ? "Boyama üreticide — boyama payı üreticinin hakedişinde"
                          : "Henüz tahakkuk etmedi (boyacı kargoladığında oluşur)"}
                  </p>
                </div>
              )}
            </div>

            {/* Where it physically is */}
            {painting.painterStatus && painting.painterStatus !== "unassigned" && (
              <div className="mt-4">
                <div className="flex flex-wrap gap-1.5">
                  {PAINTER_STEPS.map((step) => {
                    const idx = PAINTER_STEPS.findIndex(
                      (s) => s.key === painting.painterStatus
                    );
                    const myIdx = PAINTER_STEPS.findIndex((s) => s.key === step.key);
                    const done = idx >= 0 && myIdx <= idx;
                    return (
                      <span
                        key={step.key}
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          done
                            ? "bg-fuchsia-600 text-white"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {step.label}
                      </span>
                    );
                  })}
                </div>

                <dl className="mt-3 space-y-1 text-xs text-gray-600">
                  {painting.sentAt && (
                    <div className="flex gap-2">
                      <dt className="w-32 shrink-0 text-gray-500">Gönderildi</dt>
                      <dd>
                        {formatDateTime(painting.sentAt, loc)}
                        {painting.handoffCarrier && (
                          <>
                            {" · "}
                            {painting.handoffCarrier}
                            {painting.handoffTrackingNumber &&
                              ` / ${painting.handoffTrackingNumber}`}
                          </>
                        )}
                      </dd>
                    </div>
                  )}
                  {painting.receivedAt ? (
                    <div className="flex gap-2">
                      <dt className="w-32 shrink-0 text-gray-500">Teslim alındı</dt>
                      <dd>{formatDateTime(painting.receivedAt, loc)}</dd>
                    </div>
                  ) : (
                    painting.sentAt && (
                      <div className="flex gap-2">
                        <dt className="w-32 shrink-0 text-gray-500">Teslim alındı</dt>
                        <dd className="text-amber-700">
                          Boyacı henüz teslim aldığını işaretlemedi
                        </dd>
                      </div>
                    )
                  )}
                  {painting.paintedAt && (
                    <div className="flex gap-2">
                      <dt className="w-32 shrink-0 text-gray-500">Boyama bitti</dt>
                      <dd>{formatDateTime(painting.paintedAt, loc)}</dd>
                    </div>
                  )}
                  {painting.qcRound > 1 && (
                    <div className="flex gap-2">
                      <dt className="w-32 shrink-0 text-gray-500">QC turu</dt>
                      <dd className="text-amber-700">
                        {painting.qcRound}. tur (önceki turlar reddedildi)
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {/* Boyacı yeni model sürümünü gördü mü. Günlük okunamadıysa kapı
                yine kapalı ama SEBEP başkadır: duyurulan sürüm numarasını
                bilmiyoruz, o yüzden burada bir numara YAZILMAZ. */}
            {partnerAck?.painter.readFailed ? (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                Boyacının model onay kaydı şu anda okunamadı (geçici sistem arızası): yeni bir
                sürümün duyurulup duyurulmadığını ve boyacının onaylayıp onaylamadığını
                söyleyemiyoruz. Güvenlik gereği boyacının QC&apos;ye gönderme ve kargolama adımları
                — boyacı adına yapılanlar dahil — kapalı tutuldu. Birkaç dakika sonra sayfayı
                yenileyin.
              </p>
            ) : partnerAck?.painter.pending ? (
              <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Boyacı {partnerAck.painter.announcedRevision}. sürümü henüz onaylamadı; elindeki
                baskı eski sürüme ait olabilir. QC&apos;ye gönderme ve kargolama adımları onaya
                kadar kapalı — boyacı adına yapılan işlemler dahil.
              </p>
            ) : null}

            {/* ─── Boyacı QC: fotoğraflar + YERİNDE onay / ret ──────────
                Karar buradan verilebilmeli: admin siparişi bırakıp QC kuyruğuna
                gidiyor, orada da hangi siparişe baktığını başka bir ekrandan
                hatırlamak zorunda kalıyordu. */}
            {(painterLiveQc.length > 0 || painting.painterStatus === "qc_pending") && (
              <div className="mt-4 rounded-xl border border-gray-200 p-3">
                <p className="mb-1.5 text-xs font-medium text-gray-600">
                  Boyacı QC fotoğrafları ({painting.qcRound}. tur)
                </p>
                {painterLiveQc.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {painterLiveQc.map((p) => (
                      <a
                        key={p.id}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        title={formatDateTime(p.createdAt, loc)}
                        className="block h-20 w-20 overflow-hidden rounded-lg border border-gray-200"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                ) : readFailures?.painterQcPhotos ? (
                  <ReadFailedNotice>
                    Bu turun boyacı QC fotoğrafları şu anda okunamadı (geçici sistem arızası); bu,
                    &quot;fotoğraf yüklenmedi&quot; demek DEĞİLDİR. Görmediğiniz fotoğraflara dayanarak
                    onaylamayın — birkaç dakika sonra sayfayı yenileyin.
                  </ReadFailedNotice>
                ) : (
                  <p className="text-xs text-gray-500">Bu turda henüz fotoğraf yüklenmedi.</p>
                )}

                {/* KONTROL YA ÇALIŞIR YA DA SEBEBİYLE KAYBOLUR.
                    Kart, fotoğraflar okunamazken yukarıda "görmediğiniz
                    fotoğraflara dayanarak onaylamayın" diyor ve hemen altında
                    aynı onayı tek tıkla sunuyordu: ekran kendi uyarısının
                    tersini öneriyordu. Onay boyacının kargosunu ve hakedişine
                    giden yolu açar, ret ise turu artırıp işi yeniden boyamaya
                    yollar; ikisinin de tek dayanağı bu fotoğraflar. Kapı bu
                    yüzden kapanır — uç çalışıyor, sunulacak KANIT yok. */}
                {!refunded &&
                  painting.painterStatus === "qc_pending" &&
                  (readFailures?.painterQcPhotos ? (
                    <div
                      role="alert"
                      className="mt-3 border-t border-gray-100 pt-3 text-xs text-amber-900"
                    >
                      <p className="font-semibold">Boyama onayı ve reddi kapatıldı</p>
                      <p className="mt-0.5 text-amber-900/80">
                        Fotoğraflar okunana kadar bu turda karar verilemez. Boyacıya
                        hiçbir şey iletilmedi ve iş QC kuyruğunda duruyor; okuma
                        düzelince karar burada ya da boyacı QC kuyruğunda verilebilir.
                        Karar acilse önce arızanın geçmesini bekleyin — ret gerekçesi de
                        onay da geri alınamaz.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                      <button
                        type="button"
                        onClick={() => painterQcDecision("approve")}
                        disabled={!!loading}
                        className="w-full rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-gray-300"
                      >
                        {loading === "painter-qc-approve"
                          ? "İşleniyor…"
                          : "Boyamayı onayla (boyacının kargosu açılır)"}
                      </button>
                      <textarea
                        value={painterQcReason}
                        onChange={(e) => setPainterQcReason(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        placeholder="Ret gerekçesi — boyacıya aynen iletilir"
                        className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                      />
                      <button
                        type="button"
                        onClick={() => painterQcDecision("reject")}
                        disabled={!!loading || painterQcReason.trim().length < 3}
                        className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500"
                      >
                        {loading === "painter-qc-reject" ? "İşleniyor…" : "Reddet ve yeniden boyat"}
                      </button>
                    </div>
                  ))}

                <a
                  href="/admin/painter-qc-queue"
                  className="mt-2 inline-block text-xs text-blue-700 hover:underline"
                >
                  Boyacı QC kuyruğu →
                </a>
              </div>
            )}

            {/* QC geçmişi: kararlar + reddedilen turların fotoğrafları. Bir
                reddin NEYE bakılarak verildiği sayfada kalmalı. */}
            {(readFailures?.painterQcPhotos || readFailures?.painterQcReviews) && (
              <ReadFailedNotice>
                Boyacı QC geçmişi şu anda okunamadı (geçici sistem arızası): önceki turların
                fotoğrafları ve onay/ret kararları gösterilemiyor. Bu kart boş DEĞİL, bilinmiyor.
              </ReadFailedNotice>
            )}
            {(painting.qcReviews.length > 0 || painterOldQc.length > 0) && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-gray-600">Boyacı QC geçmişi</p>
                {painting.qcReviews.length > 0 && (
                  <ul className="space-y-1.5">
                    {painting.qcReviews.map((r) => (
                      <li key={r.id} className="flex items-start gap-2 text-xs">
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${
                            r.decision === "approved"
                              ? "bg-green-50 text-green-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {r.decision === "approved" ? "Onaylandı" : "Reddedildi"}
                        </span>
                        <div className="min-w-0">
                          <p className="text-gray-500">
                            {r.round}. tur · {formatDateTime(r.createdAt, loc)} · {r.adminEmail}
                          </p>
                          {r.reason && <p className="mt-0.5 text-gray-700">{r.reason}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {painterOldQc.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {painterOldQc.map((p) => (
                      <a
                        key={p.id}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        title={`${p.round}. tur · ${formatDateTime(p.createdAt, loc)}`}
                        className="block h-14 w-14 overflow-hidden rounded-lg border border-gray-200 opacity-70"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Günlük okunamadıysa liste boş kalır; sessizlik de bir iddiadır
                ("boyacı hiçbir şey yapmamış"), o yüzden sebep yazılır. */}
            {painting.actionsUnreadable && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                Boyacı hareketleri şu anda okunamadı (geçici sistem arızası); bu kart boş DEĞİL,
                bilinmiyor. Sayfanın geri kalanı gerçek kayıtlardır. Birkaç dakika sonra sayfayı
                yenileyin.
              </p>
            )}

            {/* What has happened, in the painter's own log */}
            {painting.actions.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-gray-600">
                  Boyacı hareketleri
                </p>
                <ul className="space-y-1 text-xs text-gray-600">
                  {painting.actions.map((x) => (
                    <li key={x.id} className="flex flex-wrap gap-2">
                      <span className="text-gray-400">
                        {formatDateTime(x.createdAt, loc)}
                      </span>
                      <span className="font-medium text-gray-800">
                        {painterActionLabel(x.action)}
                      </span>
                      {x.notes && <span className="text-gray-500">{x.notes}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {readFailures?.painterDeclined && (
              <ReadFailedNotice>
                Bu işi reddeden boyacıların listesi şu anda okunamadı (geçici sistem arızası);
                burada kimsenin görünmemesi &quot;kimse reddetmedi&quot; demek DEĞİLDİR. Ret kaydı
                sunucuda duruyor ve atama yine reddedenleri atlar.
              </ReadFailedNotice>
            )}
            {painting.declined.length > 0 && (
              <p className="mt-3 text-xs text-gray-500">
                Reddedenler:{" "}
                {painting.declined.map((p) => p.companyName).join(", ")} — bu
                boyacılara tekrar atanamaz.
              </p>
            )}

            {/* ─── Yalnız boyacıyı değiştir ──────────────────────────────
                Tek çıkış yolu "boyacıdan geri al" idi: o yol ÜRETİCİYİ de
                koparır ve tahakkuk etmiş baskı hakedişini geri alır. Oysa çoğu
                vakada üreticide sorun yoktur. Bu kart yalnız boyacıyı değiştirir;
                parça hâlâ eski boyacıdadır ve devir kargosu ile (gerekirse)
                yeniden baskı bugün ELLE mutabakatla kapatılır — bu ekran para
                sözü vermez. */}
            {!refunded &&
              !!painting.painterStatus &&
              painting.painterStatus !== "unassigned" &&
              painting.painterStatus !== "shipped" && (
                <div className="mt-4 border-t border-gray-200 pt-4">
                  {!swapOpen ? (
                    <button
                      type="button"
                      onClick={() => setSwapOpen(true)}
                      className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-gray-800 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
                    >
                      Boyacıyı değiştir (üretici kalsın)
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-[11px] text-fuchsia-900">
                        Üretici, üretici durumu ve tahakkuk etmiş baskı hakedişi olduğu gibi kalır;
                        iş yalnız yeni boyacıya geçer ve boyacı QC turu sıfırlanır. Baskı hâlâ eski
                        boyacının elinde: devir kargosu ve gerekirse yeniden baskı elle mutabakatla
                        kapatılır.
                      </p>
                      {/* Devir kutusu da SIRALIDIR ve aynı sıralayıcıyı okur:
                          iki ekranda iki ayrı sıra olsaydı, admin işi "daha
                          iyi" sandığı boyacıya taşırken sistemin başkasını
                          seçtiğini hiç göremezdi. */}
                      {readFailures?.painterRanking && (
                        <ReadFailedNotice>
                          Boyacı sıralaması şu anda hesaplanamadı (geçici sistem arızası): aşağıdaki
                          liste <strong>sırasızdır</strong>. Devir kapanmadı; yük bilgisi gerçektir.
                        </ReadFailedNotice>
                      )}
                      <select
                        value={effectiveSwapPainterId}
                        onChange={(e) => setSwapPainterId(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">Yeni boyacı seçin…</option>
                        {painting.candidates
                          .filter((c) => c.id !== painter?.id)
                          .map((c) => (
                            <option key={c.id} value={c.id} disabled={!c.eligible}>
                              {`${c.rank !== null ? `${c.rank}. ` : ""}${c.companyName} — ${c.loadLabel}${c.score !== null ? ` · skor ${c.score}` : ""}${c.eligible ? "" : ` (${c.ineligibleReason ?? "uygun değil"})`}`}
                            </option>
                          ))}
                      </select>
                      <textarea
                        value={swapReason}
                        onChange={(e) => setSwapReason(e.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder="Gerekçe (zorunlu) — örn. boyacı işi bıraktı, iki haftadır cevap yok"
                        className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                      />
                      <label className="flex items-center gap-1.5 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={swapBlocklist}
                          onChange={(e) => setSwapBlocklist(e.target.checked)}
                        />
                        Eski boyacıyı bu sipariş için bir daha önerme
                      </label>
                      {/* PARÇANIN YENİ SEVKİYATI — atama kutusundaki iki alanın
                          aynısı. Koli yoldayken uç, takip numarası olmadan
                          devri REDDEDER (409 · parcel_in_transit); bu alanlar
                          olmadığı için o ret panelden kapatılamıyordu ve
                          admin'e yalnız iki partneri birden koparan düğme
                          kalıyordu. Sebep burada, adminin durduğu yerde
                          yazılıdır. */}
                      {painterParcelOut ? (
                        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                          Bu siparişin baskısı boyacıya gönderilmiş ya da onun elinde görünüyor
                          (kargo kaydı: {painting.handoffCarrier ?? "-"} /{" "}
                          {painting.handoffTrackingNumber ?? "-"}
                          {painting.receivedAt ? ", boyacı teslim aldı" : ""}). Devir için parçanın{" "}
                          <strong>yeni sevkiyatını</strong> girin:{" "}
                          <strong>takip numarası zorunludur</strong> (elden teslimde teslim notunu
                          yazın). Numarasız devir, kutunun nerede olduğunu söyleyen tek kaydın
                          üstüne yazardı; üstelik sipariş otomatik yolların gözünde &quot;kolisi
                          yola çıkmamış&quot; hâle gelir ve sıradaki ret ya da 24 saatlik sessizlik
                          işi bir sonraki boyacıya taşırken baskı ilk boyacıda kalırdı. Eski kargo
                          kaydı silinmez: sipariş notuna &quot;önceki sevkiyat → yeni sevkiyat&quot;
                          olarak yazılır.
                        </p>
                      ) : (
                        <p className="text-[11px] text-gray-500">
                          Parça henüz kargoya verilmemiş görünüyor (takip numarası ve teslim
                          damgası yok): sevkiyat alanları isteğe bağlı. Yine de yeni boyacıya bir
                          kargo çıkacaksa buraya yazın — kolinin tek kaydı bu iki alandır.
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={swapCarrier}
                          onChange={(e) => setSwapCarrier(e.target.value)}
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        >
                          <option value="">
                            {painterParcelOut ? "Teslim şekli" : "Teslim şekli (ops.)"}
                          </option>
                          <option value="elden">Elden</option>
                          <option value="yurtici">Yurtiçi</option>
                          <option value="aras">Aras</option>
                          <option value="mng">MNG</option>
                          <option value="ptt">PTT</option>
                          <option value="surat">Sürat</option>
                          <option value="other">Diğer</option>
                        </select>
                        <input
                          value={swapTracking}
                          onChange={(e) => setSwapTracking(e.target.value)}
                          maxLength={60}
                          placeholder={
                            painterParcelOut ? "Takip no (zorunlu)" : "Takip no (ops.)"
                          }
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={swapPainter}
                          disabled={
                            !!loading ||
                            !effectiveSwapPainterId ||
                            swapReason.trim().length < 3 ||
                            // Ucun kapısının ekrandaki karşılığı: koli yoldayken
                            // takip numarası olmadan devir yok.
                            swapNeedsTracking
                          }
                          className="rounded-xl bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white hover:bg-fuchsia-700 disabled:bg-gray-300 disabled:text-gray-500"
                        >
                          {loading === "swap-painter" ? "Değiştiriliyor…" : "Boyacıyı değiştir"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSwapOpen(false);
                            setSwapPainterId("");
                            setSwapReason("");
                            setSwapCarrier("");
                            setSwapTracking("");
                          }}
                          className="rounded-xl bg-white px-4 py-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                        >
                          Vazgeç
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

            {/* Assign / reassign. Only while nobody holds the job and the print
                has cleared QC — the same gate the manufacturer's hand-off uses. */}
            {!refunded &&
              (!painting.painterStatus ||
              painting.painterStatus === "unassigned") && (
              <div className="mt-4 border-t border-gray-200 pt-4">
                <p className="mb-2 text-xs font-medium text-gray-600">
                  Boyacı ata
                </p>
                {manufacturerStatus !== "qc_approved" ? (
                  <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    Atama, üretici QC onayından sonra açılır. Şu anki üretici
                    durumu: <strong>{manufacturerStatusLabel(manufacturerStatus)}</strong>.{" "}
                    <a href="/admin/qc-queue" className="text-blue-700 hover:underline">
                      QC kuyruğuna git
                    </a>
                  </p>
                ) : readFailures?.painterCandidates ? (
                  <ReadFailedNotice>
                    Boyacı listesi şu anda okunamadı (geçici sistem arızası); bu, &quot;aktif boyacı
                    yok&quot; demek DEĞİLDİR. Atama kutusu doldurulamadığı için boyacı ataması geçici
                    olarak yapılamıyor. Birkaç dakika sonra sayfayı yenileyin.
                  </ReadFailedNotice>
                ) : painting.candidates.length === 0 ? (
                  <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    Aktif boyacı yok.{" "}
                    <a href="/admin/painters" className="text-blue-700 hover:underline">
                      Boyacılar
                    </a>
                  </p>
                ) : (
                  <div className="space-y-2">
                    {/* Sıralama üretilemediyse liste ALFABETİKTİR ve bu
                        SÖYLENİR: sırasız bir listenin ilk satırı "önerilen"
                        gibi okunmamalı. Atama kapanmaz — sıralama bir
                        tavsiyedir, kapı değil. */}
                    {readFailures?.painterRanking && (
                      <ReadFailedNotice>
                        Boyacı sıralaması şu anda hesaplanamadı (geçici sistem arızası): aşağıdaki
                        liste <strong>sırasızdır</strong> ve önerilen boyacı gösterilemiyor. Atama
                        kapanmadı ve yük bilgisi gerçektir; seçimi siz yapın.
                      </ReadFailedNotice>
                    )}
                    <ul className="space-y-1.5">
                      {painting.candidates.map((c) => {
                        const isChosen = c.id === effectivePainterPick;
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              disabled={!c.eligible}
                              onClick={() => setPainterPick(c.id)}
                              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                                isChosen
                                  ? "border-fuchsia-400 bg-white ring-2 ring-fuchsia-200"
                                  : "border-gray-200 bg-white hover:border-fuchsia-300"
                              } ${c.eligible ? "" : "cursor-not-allowed opacity-60"}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm font-medium text-gray-900">
                                  {c.rank !== null && (
                                    <span className="mr-1 text-xs text-gray-500">
                                      {c.rank}.
                                    </span>
                                  )}
                                  {c.companyName}
                                  {c.suggested && (
                                    <span className="ml-1 rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-fuchsia-700">
                                      önerilen
                                    </span>
                                  )}
                                </span>
                                <span className="text-xs text-gray-600">
                                  {/* Yük, KAPININ ölçüsüyle yazılır (ortak
                                      etiket: "6/2 birim · 1 iş"). İş sayısını
                                      tek başına göstermek, uç ağırlıklı yükle
                                      reddederken ekranda "1/5 iş" okutmak
                                      olurdu — kilitli satırın sebebi de
                                      anlaşılmazdı. */}
                                  {c.loadLabel}
                                  {c.score !== null && (
                                    <span className="ml-2 font-semibold text-gray-700">
                                      skor {c.score}
                                    </span>
                                  )}
                                </span>
                              </div>
                              {c.parts && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {PAINTER_SCORE_KEYS.filter(
                                    (k) => typeof c.parts?.[k] === "number"
                                  ).map((k) => (
                                    <span
                                      key={k}
                                      title={PAINTER_SCORE_LABELS_TR[k]}
                                      className="rounded-full bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600 ring-1 ring-gray-200"
                                    >
                                      {PAINTER_SCORE_SHORT_LABELS_TR[k]} {c.parts?.[k]}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {c.reasons.length > 0 && (
                                <p className="mt-1 text-[11px] text-gray-500">
                                  {c.reasons.join(" · ")}
                                </p>
                              )}
                              {!c.eligible && c.ineligibleReason && (
                                <p className="mt-1 text-[11px] font-medium text-amber-700">
                                  {c.ineligibleReason}
                                </p>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-[11px] text-gray-500">
                      Sıra, işi otomatik yerleştiren sıralamanın kendisidir: rota
                      (üreticiden boyacıya + boyacıdan müşteriye), yük,
                      güvenilirlik, QC kalitesi ve zamanında teslim. 100 en iyi,
                      0 en kötüdür.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={painterCarrier}
                        onChange={(e) => setPainterCarrier(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">Teslim şekli (ops.)</option>
                        <option value="elden">Elden</option>
                        <option value="yurtici">Yurtiçi</option>
                        <option value="aras">Aras</option>
                        <option value="mng">MNG</option>
                        <option value="ptt">PTT</option>
                        <option value="surat">Sürat</option>
                        <option value="other">Diğer</option>
                      </select>
                      <input
                        value={painterTracking}
                        onChange={(e) => setPainterTracking(e.target.value)}
                        placeholder="Takip no (ops.)"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      onClick={handleAssignPainter}
                      disabled={!effectivePainterPick || loading === "assign-painter"}
                      className="w-full rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-700 disabled:opacity-50"
                    >
                      {loading === "assign-painter"
                        ? "Atanıyor…"
                        : chosenPainterCard
                          ? `Boyacıya ata ve gönder: ${chosenPainterCard.companyName}`
                          : "Boyacıya ata ve gönder"}
                    </button>
                    <p className="text-[11px] text-gray-500">
                      Atama, üreticinin baskı hakedişini tahakkuk ettirir ve
                      siparişi &quot;boyanıyor&quot; durumuna alır — üreticinin
                      kendi &quot;boyacıya gönder&quot; işlemiyle aynı sonuç.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── Boyacı atama gerekçesi: kararın kendi anındaki skorları ───── */}
        {readFailures?.painterAssignmentDecisions && (
          <ReadFailedNotice>
            Boyacı atama değerlendirme kayıtları şu anda okunamadı (geçici sistem arızası): bu
            siparişin &quot;neden bu boyacıya gitti&quot; dökümü gösterilemiyor. Kayıtlar
            silinmedi; bu kart boş DEĞİL, bilinmiyor.
          </ReadFailedNotice>
        )}
        {painterAssignmentDecisions && painterAssignmentDecisions.length > 0 && (
          <PainterEvaluationCard
            decisions={painterAssignmentDecisions}
            assignedPainterId={painter?.id ?? null}
            refunded={refunded}
            assignBoxOnScreen={painterAssignBoxOnScreen}
            loc={loc}
          />
        )}

        {/* ─── Revoke from painter (bad hand-off → assignment queue) ─────── */}
        {canRevokePainter && (
          <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                Boyacı devri
              </h3>
              <span className="text-xs text-gray-500">
                {painter?.companyName ?? "Boyacı"} · {order.painterStatus}
              </span>
            </div>

            {/* İade edilmiş siparişte kart ne YAPILDIĞINI söyler. Eski metin
                kuyruğa dönüş, otomatik yeniden atama ve hakedişin geri
                alınmasını vaat ediyordu; iade dalı (revoke-painter/route.ts ·
                detachRefundedFromPainter) bunların HİÇBİRİNİ yapmaz — yalnız
                koparır. En ağırı para cümlesiydi: admin, geri alınmamış bir
                baskı hakedişini geri alınmış sanıyordu. */}
            {refunded ? (
              <p className="mt-2 rounded-lg border border-fuchsia-300 bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-900">
                ⚠ Sipariş iade edilmiş: bu işlem yalnız <strong>koparır</strong>. Boyacı ve üretici
                siparişten çıkarılır; sipariş durumu ({statusLabel(order.status)}) DEĞİŞMEZ, atama
                kuyruğuna dönmez ve otomatik olarak yeni bir üreticiye gitmez. Hiçbir hakediş geri
                alınmaz, ters kayıt atılmaz (iadenin parası kendi akışında görülür) ve hiçbir
                partner cezalandırılmaz — kimsenin kusuru yok. İz kalır: iki partnerin de işlem
                geçmişine &quot;admin geri aldı&quot; kaydı, sipariş notlarına da sebebiyle
                birlikte bir satır yazılır.
              </p>
            ) : (
            <p className="mt-2 rounded-lg border border-fuchsia-300 bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-900">
              ⚠ Bu işlem hem <strong>boyacıyı</strong> hem <strong>üreticiyi</strong> çıkarır ve
              sipariş tekrar atama kuyruğuna (onaylı) döner; aşağıdaki kutuyu
              işaretlemezseniz oradan <strong>otomatik olarak</strong> yeni bir
              üreticiye gitmeye çalışır (bu sipariş türünde otomatik atama
              kapalıysa ya da uygun aday yoksa kuyrukta bekler).
              Üreticinin baskı hakedişi
              {" "}(<strong>
                {formatCurrency(
                  manufacturerBaseKurus({
                    amountKurus: order.amountKurus,
                    productionBaseKurus: order.productionBaseKurus,
                    paintingPriceKurus: order.paintingPriceKurus,
                    // Bu kart yalnızca sipariş bir boyacıdayken gösteriliyor,
                    // yani taban her zaman üretim payıdır.
                    painterId: "handed-off",
                    paintsInHouse: false,
                  }),
                  loc
                )}
              </strong>
              {" "}brüt) geri alınır; yeni bir üretici sıfırdan basar. Hakediş zaten
              ödenmişse (ödeme partisi kapanmış) işlem reddedilir — iade akışını kullanın.
            </p>
            )}

            {/* KOLİ HÂLÂ DIŞARIDA OLABİLİR. Geri alma iki partneri de koparır ve
                devir/kargo alanlarını temizler — tam koparma meşrudur, ama
                fiziksel kutu bu tıkla yerinden kımıldamaz. Alanlar silindikten
                sonra kutunun nerede olduğunu söyleyen tek kayıt sipariş notudur;
                uç oraya yazar, bu cümle de admin'i tıklamadan önce uyarır. */}
            {painterParcelOut && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                ⚠ Baskı şu anda boyacıda ya da ona giden yolda görünüyor (kargo kaydı:{" "}
                {painting?.handoffCarrier ?? "-"} / {painting?.handoffTrackingNumber ?? "-"}
                {painting?.receivedAt ? ", boyacı teslim aldı" : ""}). Geri alma bu kutuyu
                taşımaz: siparişteki devir/kargo alanları temizlenir, kaydın kendisi sipariş
                notlarına yazılır. Kutunun geri gelmesini ya da yeni partnere ulaşmasını elle
                takip edin. Yalnız BOYACIYI değiştirecekseniz yukarıdaki &quot;Boyacıyı
                değiştir&quot; kutusunu kullanın: orası koliyi yeni sevkiyat numarasıyla devreder
                ve üreticiyi yerinde bırakır.
              </p>
            )}
            {!revokePainterOpen ? (
              <button
                onClick={() => setRevokePainterOpen(true)}
                className="mt-3 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-gray-800 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
              >
                Boyacıdan geri al (atamaya döndür)
              </button>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Sebep <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={revokePainterReason}
                    onChange={(e) => setRevokePainterReason(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="örn. boyacı işi teslim almadı / yanlış boyacıya gönderildi"
                    className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                  />
                </div>
                {/* İade edilen siparişte İKİ kutunun da karşılığı yok: kara
                    liste bir SONRAKİ partner içindir ve sonraki partner
                    olmayacak; atama da hiç yapılmaz. Rota ikisini de okumaz
                    (detachRefundedFromPainter), yani ekranda durmaları
                    yapılmayacak bir işi vaat etmek olurdu. */}
                {!refunded && (
                  <div className="flex flex-wrap gap-4 text-xs text-gray-700">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={revokePainterBlocklist}
                        onChange={(e) => setRevokePainterBlocklist(e.target.checked)}
                      />
                      Bu üreticiyi bu sipariş için bir daha önerme
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={revokePainterKeepInQueue}
                        onChange={(e) =>
                          setRevokePainterKeepInQueue(e.target.checked)
                        }
                      />
                      Kuyruğumda kalsın (otomatik atama yapılmasın)
                    </label>
                    {/* Üretici geri almasındaki ceza kutusunun ikizi. İşi henüz
                        üstlenmemiş (cevapsız) boyacıda SORULMAZ: sahibin kararı
                        gereği cevapsızlık ceza değildir, sebebi hemen altında
                        yazıyor. */}
                    {canStrikePainter && (
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={revokePainterStrike}
                          onChange={(e) => setRevokePainterStrike(e.target.checked)}
                        />
                        Güvenilirlik cezası (strike) uygula
                      </label>
                    )}
                  </div>
                )}
                {/* Kutunun YOKLUĞU da açıklanır: eksik bir seçenek, unutulmuş
                    bir alan gibi okunmamalı. */}
                {!refunded && painterJobUnanswered && (
                  <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600">
                    Bu boyacı işi henüz üstlenmedi (durum: <strong>atandı</strong>, kabul yok). Sahibin
                    kararı gereği cevapsız kalan iş sıradaki boyacıya geçer ama{" "}
                    <strong>ceza yazılmaz</strong> — 24 saatlik otomatik süpürme de aynı kuralı
                    uygular. Bu yüzden burada ceza kutusu yok; cevapsızlık yine de siparişin üç
                    denemelik sınırına sayılır.
                  </p>
                )}
                {!refunded && (
                  <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600">
                    {/* Üretici geri almasındaki kuralın aynısı: yerleştirme
                        koşulludur (tür anahtarı, uygun aday, satıcı mülkiyeti),
                        bu yüzden burada da vaat edilmez. */}
                    {revokePainterKeepInQueue
                      ? "Sipariş geri alındıktan sonra atanmadan kuyrukta bekler; üreticiyi kendiniz seçersiniz."
                      : order.sellerManufacturerId
                        ? "Bu ürün satıcının kendi kataloğundan çıktı: geri aldığınızda sipariş başka bir atölyeye verilmez — yalnız satıcının kendi atölyesine atanabilir, o da mümkün değilse kuyrukta kararınızı bekler."
                        : "Geri aldığınız anda sipariş, sıralamanın uygun ilk atölyesine otomatik olarak atanmaya çalışılır (az önce çıkarılan üretici bu denemede hariç tutulur). Bu sipariş türünde otomatik atama kapalıysa ya da uygun aday çıkmazsa kuyrukta bekler. Önce müşteriyle konuşacaksanız ya da iade düşünüyorsanız yukarıdaki kutuyu işaretleyin."}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={revokePainter}
                    disabled={!!loading || revokePainterReason.trim().length < 3}
                    className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500"
                  >
                    {/* Düğme ne yapacağını söyler: eski metin ("atama
                        kuyruğuna") otomatik yerleştirmeden hiç söz etmiyordu. */}
                    {loading === "revoke-painter"
                      ? "Geri alınıyor…"
                      : refunded
                        ? "Boyacıdan geri al"
                        : revokePainterKeepInQueue
                          ? "Geri al ve kuyrukta bırak"
                          : "Geri al ve yeniden ata"}
                  </button>
                  <button
                    onClick={() => {
                      setRevokePainterOpen(false);
                      setRevokePainterReason("");
                      setRevokePainterKeepInQueue(false);
                      setRevokePainterStrike(false);
                    }}
                    className="rounded-xl bg-white px-4 py-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── QC Review (admin gate before shipping) ─────── */}
        {manufacturerStatus === "qc_pending" && (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-200 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">{d["admin.qc.title"]}</h3>
                <p className="text-xs text-gray-500">{d["admin.qc.description"]}</p>
              </div>
            </div>

            {/* Tur onaylanamıyorsa SEBEBİNİ yazar. Kart eskiden dört ayrı hâle
                de "GÜNCEL sürümden daha eski bir baskı" diyordu: damgasız tur
                "eski" değil "bilinmiyor" demek, fotoğrafsız turda ise ortada
                baskı bile yok. Cümle uçla ortak modülden gelir
                (qcProofRefusalView), yani ekran kaydın yazmadığı bir sebebi
                iddia edemez. Fotoğrafın hangi sürüme ait olduğu ayrıca her
                rozette yazar. */}
            {qcRevisionMismatch && (
              <p role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                {/* Fotoğraf tablosu OKUNAMADIYSA kanıt "yok" değil BİLİNMİYOR:
                    qcProof sıfır fotoğraf gördüğü için "fotoğrafsız tur" der,
                    oysa ortada yapılmamış bir okuma var. Kapı iki dalda da
                    kapalı; ayrışan yalnız anlatılan sebep. */}
                {readFailures?.qcPhotos
                  ? "Bu turun QC fotoğrafları şu anda okunamadı (geçici sistem arızası): tur FOTOĞRAFSIZ DEĞİL, kaç fotoğraf olduğu bilinmiyor. Kanıt görülemediği için onay kapalı tutuldu. Fotoğraflar silinmedi — üreticiden yeniden yükleme istemeyin, birkaç dakika sonra sayfayı yenileyin."
                  : qcProofView.banner}
              </p>
            )}
            {readFailures?.qcPhotos ? (
              <ReadFailedNotice>
                QC fotoğrafları okunamadı; bu alan boş DEĞİL, bilinmiyor.
              </ReadFailedNotice>
            ) : liveQcPhotos.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                {liveQcPhotos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="relative block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="w-full h-32 object-cover rounded-lg border border-gray-200 hover:opacity-90 transition-opacity" />
                    <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {p.modelRevision != null ? `Sürüm ${p.modelRevision}` : "Sürüm bilinmiyor"}
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-4">{d["admin.qc.noPhotos"]}</p>
            )}

            <div className="flex flex-col gap-3">
              {/* Eski sürümün baskısı NORMAL yoldan onaylanamaz: sunucu da bu
                  turu reddeder, ekran da açmaz. Tek taraflı bir "uyarı"
                  bırakmak, onayı tek tıkla geçilebilir kılıyordu.
                  Kararın (late-model-upload) izin verdiği DENETİMLİ istisna
                  aşağıda ayrı bir düğmededir: uç onu overrideStaleRevision +
                  gerekçe ile destekliyor ve ret mesajı admin'e "yine de
                  onaylayacaksanız eski sürüm onayını kullanın" diyordu — ama
                  ekranda o yol hiç yoktu, yani yanlış damgalanmış tek bir
                  fotoğrafın tek çıkışı qc-reject oluyordu. */}
              <button
                onClick={() => performAction("qc-approve")}
                disabled={!!loading || qcRevisionMismatch}
                title={
                  qcRevisionMismatch ? qcCardView.gateTitle : undefined
                }
                className="w-full px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:bg-gray-400 transition-colors shadow-sm"
              >
                {loading === "qc-approve" ? d["admin.qc.processing"] : d["admin.qc.approve"]}
              </button>

              {qcRevisionMismatch && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  {!staleOverrideOpen ? (
                    <button
                      type="button"
                      onClick={() => setStaleOverrideOpen(true)}
                      className="text-xs font-semibold text-red-800 underline hover:text-red-900"
                    >
                      {qcCardView.overrideLink}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] text-red-900">{qcCardView.overrideEffect}</p>
                      <label
                        htmlFor="stale-qc-reason"
                        className="block text-xs font-medium text-red-900"
                      >
                        Gerekçe <span className="text-red-600">*</span>
                      </label>
                      <textarea
                        id="stale-qc-reason"
                        rows={2}
                        maxLength={500}
                        value={staleOverrideReason}
                        onChange={(e) => setStaleOverrideReason(e.target.value)}
                        placeholder="örn. fark yalnız kaide altında, müşteri gördü ve onayladı; yeniden baskı yapılmayacak"
                        className="w-full resize-none rounded-xl border border-red-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                      />
                      <p className="text-[11px] text-red-800">
                        En az {STALE_QC_OVERRIDE_REASON_MIN} karakter.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={approveStaleQc}
                          disabled={
                            !!loading ||
                            staleOverrideReason.trim().length < STALE_QC_OVERRIDE_REASON_MIN
                          }
                          className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500"
                        >
                          {loading === "qc-approve"
                            ? d["admin.qc.processing"]
                            : "Gerekçeli onayı uygula"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setStaleOverrideOpen(false);
                            setStaleOverrideReason("");
                          }}
                          className="rounded-xl bg-white px-4 py-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                        >
                          Vazgeç
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="border-t border-gray-100 pt-3">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">{d["admin.qc.rejectReason"]}</label>
                <textarea
                  value={qcRejectReason}
                  onChange={(e) => setQcRejectReason(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  className="w-full text-sm border border-gray-200 rounded-lg p-2 mb-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                />
                <button
                  onClick={() => { if (qcRejectReason.trim()) performAction("qc-reject", { reason: qcRejectReason.trim() }); }}
                  disabled={!!loading || !qcRejectReason.trim()}
                  className="w-full px-6 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {loading === "qc-reject" ? d["admin.qc.processing"] : d["admin.qc.reject"]}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── İade ───────────────────────────────────────────
            One line until opened: a destructive action should be reachable at
            every stage, not loud on every order. */}
        {canRefund && (
          <div
            className={`rounded-2xl border bg-white ${
              refundOpen ? "border-red-200 p-5" : "border-gray-200 px-5 py-3"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-700">İade</h3>
                <span className="text-xs text-gray-500">
                  Tahsil edilen {formatCurrency(collectedKurus, loc)}
                </span>
              </div>
              {!refundOpen && (
                <button
                  type="button"
                  onClick={() => setRefundOpen(true)}
                  className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  İade et
                </button>
              )}
            </div>
            {refundOpen && (
              <div className="mt-3 space-y-3">
                <div className="space-y-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                  <p>
                    <strong>Bu işlem parayı geri göndermez.</strong> {refundMoneyInstruction}
                  </p>
                  <p>
                    Üretici ve boyacı siparişten ayrılır, ödenmemiş hakedişleri geri alınır
                    {order.giftCardAmountKurus > 0 ? ", hediye kartı bakiyesi karta geri yüklenir" : ""}.
                    Müşteriye iade bildirimi gider. Sipariş durumu korunur, ileri işlemler kapanır.
                  </p>
                </div>
                {paidOutShares.length > 0 && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p className="font-semibold">Zaten ödenmiş, geri ALINMAYACAK:</p>
                    <ul className="mt-1 space-y-0.5">
                      {paidOutShares.map((s) => (
                        <li key={s.party}>{describeEarning(s)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {batchedShares.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                    <p className="font-semibold">Bekleyen ödeme partisinden düşülecek:</p>
                    <ul className="mt-1 space-y-0.5">
                      {batchedShares.map((s) => (
                        <li key={s.party}>{describeEarning(s)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!money && (
                  <p className="text-xs text-amber-700">
                    Partner hakediş durumu yüklenemedi; iadeden önce{" "}
                    <Link href="/admin/payouts" className="underline">Ödemeler</Link> sayfasını kontrol edin.
                  </p>
                )}
                <div>
                  <label htmlFor="refund-reason" className="mb-1 block text-xs font-medium text-gray-600">
                    İade sebebi
                  </label>
                  <input
                    id="refund-reason"
                    type="text"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    maxLength={500}
                    placeholder="örn. müşteri vazgeçti, ürün hasarlı geldi"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleRefund}
                    disabled={!!loading}
                    className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500"
                  >
                    {loading === "refund" ? "İade ediliyor…" : "İadeyi onayla"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRefundOpen(false);
                      setRefundReason("");
                    }}
                    className="rounded-xl bg-white px-4 py-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ Tab bar ═════════════════════════════════════════════ */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          ["summary", "admin.orderDetail.tab.summary"],
          ["production", "admin.orderDetail.tab.production"],
          ["communication", "admin.orderDetail.tab.communication"],
          ["history", "admin.orderDetail.tab.history"],
        ] as const).map(([key, labelKey]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {d[labelKey]}
          </button>
        ))}
      </div>

      {/* ═══ Özet (summary) ══════════════════════════════════════ */}
      {tab === "summary" && (
        <div className="grid lg:grid-cols-3 gap-5">
          {/* Left column (2/3) */}
          <div className="lg:col-span-2 space-y-5">

            {/* ─── Referans Fotoğraflar (ekle / kaldır) ───────────────────── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Referans Fotoğraflar
                </h3>
                <label
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${
                    photoBusy ? "bg-gray-400" : "bg-gray-900 hover:bg-gray-800"
                  }`}
                >
                  {photoBusy ? "Yükleniyor…" : "+ Fotoğraf ekle"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    multiple
                    className="hidden"
                    disabled={photoBusy}
                    onChange={(e) => {
                      void addOrderPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {readFailures?.photos ? (
                <ReadFailedNotice>
                  Referans fotoğraflar şu anda okunamadı (geçici sistem arızası); bu kart BOŞ
                  DEĞİL, bilinmiyor. Fotoğraflar silinmedi — yeniden yüklemeyin, birkaç dakika
                  sonra sayfayı yenileyin.
                </ReadFailedNotice>
              ) : photos.length === 0 ? (
                <p className="text-sm text-gray-400">Henüz fotoğraf yok.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {photos.map((p) => (
                    <div
                      key={p.id}
                      className="relative h-28 w-28 overflow-hidden rounded-xl border border-gray-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.originalUrl} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeOrderPhoto(p.id)}
                        disabled={photoBusy}
                        className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs leading-none text-white hover:bg-black/80 disabled:opacity-50"
                        aria-label="Fotoğrafı kaldır"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ─── Photo + Model Card ───────────────────── */}
            {(photos[0] || displayGlbUrl) && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className={`flex flex-col ${photos[0] && displayGlbUrl ? "sm:flex-row" : ""}`}>
                  {photos[0] && (
                    <div className={`p-5 ${displayGlbUrl ? "sm:w-1/2 sm:border-r sm:border-gray-100" : "w-full"}`}>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{d["admin.orderDetail.originalPhoto"]}</h3>
                      <div className="bg-gray-50 rounded-xl overflow-hidden">
                        <img src={photos[0].originalUrl} alt={d["admin.orderDetail.customerPhoto"]} className="w-full max-h-72 object-contain" />
                      </div>
                    </div>
                  )}
                  {displayGlbUrl && (
                    <div className={`p-5 ${photos[0] ? "sm:w-1/2" : "w-full"}`}>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{d["admin.orderDetail.modelPreview"]}</h3>
                      <ModelPreviewBoundary key={displayGlbUrl} downloadUrl={displayGlbUrl}>
                        <ModelViewer
                          url={displayGlbUrl}
                          className="w-full h-72 rounded-xl"
                          // Dosya eksikse ya da okunamıyorsa görüntüleyici
                          // kendi içinde durur; WebGL teşhisi yerine (tarayıcıyı
                          // suçlayan yanlış cümle) bu kutuyu basar.
                          errorFallback={<ModelPreviewFallback downloadUrl={displayGlbUrl} />}
                        />
                      </ModelPreviewBoundary>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Customer-approved design image ───────── */}
            {approvedImageUrl && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Onaylanan tasarım (müşteri)</h3>
                <div className="bg-gray-50 rounded-xl overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={approvedImageUrl} alt="Onaylanan tasarım" className="w-full max-h-72 object-contain" />
                </div>
              </div>
            )}

            {/* ─── Para dökümü ─────────────────────────── */}
            <MoneyBreakdownCard money={money} loc={loc} />
            <OrderMoneySplitEditor orderId={order.id} />
          </div>

          {/* Right column (1/3) */}
          <div className="space-y-5">

            {/* Customer Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{d["admin.orderDetail.customerInfo"]}</h3>
                {!customerEditing && (
                  <button
                    type="button"
                    onClick={() => setCustomerEditing(true)}
                    className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-800"
                  >
                    Düzenle
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{order.customerName}</p>
                  <p className="text-xs text-gray-500 truncate">{order.email}</p>
                  {(order.phone || addr?.telefon) && (
                    <p className="text-xs text-gray-500">{order.phone || addr?.telefon}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {(order.phone || addr?.telefon) && (
                  <a href={`tel:${order.phone || addr?.telefon}`} title={d["admin.orderDetail.callCustomer"]} className="w-9 h-9 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  </a>
                )}
                <a href={`mailto:${order.email}`} title={d["admin.orderDetail.emailCustomer"]} className="w-9 h-9 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                </a>
              </div>

              {/* Müşteri kimliği satır içi düzenlenir: elle açılan ve WhatsApp
                  siparişlerinde ad/e-posta/telefon eksik ya da yanlış girilir ve
                  bugüne kadar düzeltmenin yolu yoktu — fatura yanlış isme
                  kesiliyor, bildirimler yanlış adrese gidiyordu. */}
              {customerEditing ? (
                <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                  <div>
                    <label className="mb-1 block text-xs text-gray-400" htmlFor="cust-name">
                      Ad Soyad
                    </label>
                    <input
                      id="cust-name"
                      type="text"
                      value={custName}
                      onChange={(e) => setCustName(e.target.value)}
                      maxLength={120}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400" htmlFor="cust-email">
                      E-posta
                    </label>
                    <input
                      id="cust-email"
                      type="email"
                      value={custEmail}
                      onChange={(e) => setCustEmail(e.target.value)}
                      maxLength={200}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Telefon</label>
                    <PhoneInput
                      country={custPhoneCountry}
                      nationalNumber={custPhoneNational}
                      onCountryChange={setCustPhoneCountry}
                      onNationalNumberChange={setCustPhoneNational}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400" htmlFor="cust-note">
                      Müşteri notu
                    </label>
                    <textarea
                      id="cust-note"
                      rows={3}
                      maxLength={2000}
                      value={custNote}
                      onChange={(e) => setCustNote(e.target.value)}
                      placeholder="Müşterinin siparişte belirttiği istek"
                      className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                  </div>
                  <p className="text-[11px] text-gray-500">
                    E-posta değişirse bundan sonraki bildirimler (kargo, teslim, onay bağlantısı)
                    yeni adrese gider. Yalnız gerçekten değişen alanlar kaydedilir.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={saveCustomer}
                      disabled={loading === "customer"}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {loading === "customer" ? d["admin.orderDetail.saving"] : d["admin.orderDetail.saveChanges"]}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerEditing(false);
                        setCustName(order.customerName);
                        setCustEmail(order.email);
                        const seed = e164ToPhoneInput(order.phone);
                        setCustPhoneCountry(seed.country);
                        setCustPhoneNational(seed.nationalNumber);
                        setCustNote(order.customerNote ?? "");
                      }}
                      className="rounded-xl bg-gray-100 px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200"
                    >
                      {d["admin.orderDetail.cancel"]}
                    </button>
                  </div>
                </div>
              ) : (
                order.customerNote && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <p className="text-xs font-medium text-gray-400">Müşteri notu</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                      {order.customerNote}
                    </p>
                  </div>
                )
              )}
            </div>

            {/* Order Details Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{d["admin.orderDetail.orderDetails"]}</h3>
                {!editing && (
                  <button onClick={() => {
                    const seed = e164ToPhoneInput(order.shippingAddress?.telefon);
                    setEditTelefonCountry(seed.country);
                    setEditTelefonNational(seed.nationalNumber);
                    setEditing(true);
                  }} className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
                    {d["admin.orderDetail.editOrder"]}
                  </button>
                )}
              </div>
              <dl className="space-y-3 text-sm">
                {order.orderType === "upload" && (
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">3D Model</dt>
                    <dd>
                      <a
                        href={`/api/admin/orders/${order.id}/download-upload`}
                        className="font-medium text-blue-600 hover:text-blue-800"
                      >
                        Modeli indir (STL/OBJ)
                      </a>
                    </dd>
                  </div>
                )}
                {order.orderType === "marketplace" ? (
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">
                      {d["admin.orderDetail.product" as keyof typeof d] || "Ürün"}
                    </dt>
                    <dd className="font-medium text-gray-900 flex items-center gap-2">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                        {d["shop.title" as keyof typeof d] || "Mağaza"}
                      </span>
                      {order.productTitleSnapshot}
                    </dd>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center">
                      <dt className="text-gray-400">{d["admin.orderDetail.size"]}</dt>
                      <dd className="font-medium text-gray-900">{sizeDisplay(order.figurineSize, d) || "—"}</dd>
                    </div>
                    <div className="flex justify-between items-center">
                      <dt className="text-gray-400">{d["admin.orderDetail.style"]}</dt>
                      <dd className="font-medium text-gray-900 capitalize">{d[`create.style.${order.style}` as keyof typeof d] || order.style}</dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between items-center">
                  <dt className="text-gray-400">{d["admin.orderDetail.material"]}</dt>
                  <dd className="font-medium text-gray-900">{d[`material.${order.material}` as keyof typeof d] || order.material}</dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-gray-400">{d["admin.orderDetail.amount"]}</dt>
                  <dd className="font-semibold text-gray-900">{formatCurrency(order.amountKurus, loc)}</dd>
                </div>
                {order.giftCardAmountKurus > 0 && (
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.giftCardAmount"]}</dt>
                    <dd className="font-medium"><span className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-green-200">-{formatCurrency(order.giftCardAmountKurus, loc)}</span></dd>
                  </div>
                )}
                {order.havaleDiscountKurus > 0 && (
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.payment.havaleDiscount"]}</dt>
                    <dd className="font-medium">
                      <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-amber-200">
                        -{formatCurrency(order.havaleDiscountKurus, loc)}
                      </span>
                    </dd>
                  </div>
                )}
                {/* Replaces the old "Kalan" (amount − gift card), which ignored
                    the havale discount, so no line matched the cash that came in. */}
                {(order.giftCardAmountKurus > 0 || order.havaleDiscountKurus > 0) && (
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">Tahsil edilen</dt>
                    <dd className="font-semibold text-gray-900">{formatCurrency(collectedKurus, loc)}</dd>
                  </div>
                )}
                {order.paymentMethod && (
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.payment.method"]}</dt>
                    <dd className="text-gray-700">
                      {order.paymentMethod === "card" && d["admin.payment.method.card"]}
                      {order.paymentMethod === "bank_transfer" && d["admin.payment.method.bankTransfer"]}
                      {order.paymentMethod === "gift_card_full" && d["admin.payment.method.giftCardFull"]}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <dt className="text-gray-400">{d["admin.payment.status"]}</dt>
                  <dd className="text-gray-700 text-xs">
                    {refunded ? (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 font-semibold text-white">
                        {paymentStatusLabel(d, order.paymentStatus)}
                      </span>
                    ) : (
                      paymentStatusLabel(d, order.paymentStatus)
                    )}
                  </dd>
                </div>
                {order.paymentMethod === "bank_transfer" && order.bankTransferReceiptUrl && (
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.payment.receiptUploaded"]}</dt>
                    <dd>
                      <a
                        href={order.bankTransferReceiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                      >
                        Görüntüle
                      </a>
                    </dd>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <dt className="text-gray-400">{d["admin.orderDetail.payment"]}</dt>
                  <dd className="text-gray-700">{order.paidAt ? formatDateTime(order.paidAt, loc) : <span className="text-amber-600 font-medium">{d["admin.orderDetail.notPaid"]}</span>}</dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-gray-400">{d["admin.orderDetail.createdAt"]}</dt>
                  <dd className="text-gray-700">{formatDateTime(order.createdAt, loc)}</dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-gray-400">{d["admin.orderDetail.retryCount"]}</dt>
                  <dd className="text-gray-700">{order.retryCount}</dd>
                </div>
                {order.trackingNumber && (
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.trackingNumber"]}</dt>
                    <dd className="font-mono text-xs text-gray-900 bg-gray-50 px-2 py-0.5 rounded">{order.trackingNumber}</dd>
                  </div>
                )}
                {order.failureReason && (
                  <div className="pt-3 border-t border-gray-100">
                    <dt className="text-red-600 font-medium text-xs">{d["admin.orderDetail.failureReason"]}</dt>
                    <dd className="text-red-700 mt-1 text-xs break-all bg-red-50 px-3 py-2 rounded-lg">{order.failureReason}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* ─── Kargo ─────────────────────────────────────────
                Taşıyıcı ve takip numarası düzeltilebilir olmalı: numara elle
                giriliyor ve yanlış girildiğinde müşteriye çalışmayan bir takip
                bağlantısı gidiyordu, düzeltmenin de yolu yoktu. Yanlışlıkla
                kargolandı/teslim edildi işaretlenen sipariş de geri alınabilir. */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Kargo
                </h3>
                {!shipEditing && canEditShipping && (
                  <button
                    type="button"
                    onClick={() => setShipEditing(true)}
                    className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-800"
                  >
                    Düzenle
                  </button>
                )}
              </div>

              {shipEditing && canEditShipping ? (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-xs text-gray-400" htmlFor="ship-carrier">
                      Taşıyıcı
                    </label>
                    <select
                      id="ship-carrier"
                      value={shipCarrier}
                      onChange={(e) => setShipCarrier(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                    >
                      {/* Boş seçenek SEÇİLEMEZ: uç taşıyıcıyı temizlemeyi
                          desteklemiyor, yalnız değiştirmeyi. */}
                      <option value="" disabled>
                        Seçin…
                      </option>
                      {shipCarrierOptions.map((c) => (
                        <option key={c} value={c}>
                          {CARRIER_LABEL[c] ?? c}
                        </option>
                      ))}
                    </select>
                    {/* Uç taşıyıcıyı isCarrier() ile doğrular; atölye toplu
                        tesliminin yazdığı "elden" o listede yok. Kayıt olduğu
                        gibi bırakılırsa korunur (istek taşıyıcıyı hiç
                        taşımaz), o yüzden burada ne olduğu açıkça yazılır. */}
                    {order.carrier && !(CARRIERS as string[]).includes(order.carrier) && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        Bu siparişin taşıyıcısı ({CARRIER_LABEL[order.carrier] ?? order.carrier})
                        standart kargo firmalarından biri değil (atölye teslimi). Olduğu gibi
                        bırakırsanız korunur; takip numarasını yine de düzeltebilirsiniz.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400" htmlFor="ship-tracking">
                      Takip numarası
                    </label>
                    <input
                      id="ship-tracking"
                      type="text"
                      value={shipTracking}
                      onChange={(e) => setShipTracking(e.target.value)}
                      maxLength={60}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={shipNotify}
                      onChange={(e) => setShipNotify(e.target.checked)}
                    />
                    Müşteriye güncel takip bilgisini yeniden gönder
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={saveShipping}
                      disabled={loading === "shipping"}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {loading === "shipping" ? d["admin.orderDetail.saving"] : d["admin.orderDetail.saveChanges"]}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShipEditing(false);
                        setShipCarrier(order.carrier ?? "");
                        setShipTracking(order.trackingNumber ?? "");
                      }}
                      className="rounded-xl bg-gray-100 px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200"
                    >
                      {d["admin.orderDetail.cancel"]}
                    </button>
                  </div>
                </div>
              ) : (
                <dl className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-400">Taşıyıcı</dt>
                    <dd className="font-medium text-gray-900">
                      {order.carrier ? CARRIER_LABEL[order.carrier] ?? order.carrier : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-gray-400">Takip numarası</dt>
                    <dd className="text-right">
                      {order.trackingNumber ? (
                        (() => {
                          const url = trackingUrl(order.carrier, order.trackingNumber);
                          return url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded bg-gray-50 px-2 py-0.5 font-mono text-xs text-blue-700 hover:underline"
                            >
                              {order.trackingNumber}
                            </a>
                          ) : (
                            <span className="rounded bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-900">
                              {order.trackingNumber}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-400">Kargolandı</dt>
                    <dd className="text-gray-700">
                      {order.shippedAt ? formatDateTime(order.shippedAt, loc) : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-400">Teslim edildi</dt>
                    <dd className="text-gray-700">
                      {order.deliveredAt ? formatDateTime(order.deliveredAt, loc) : "—"}
                    </dd>
                  </div>
                </dl>
              )}

              {/* Geri alma, uçların kendi koşuluyla aynı: DELETE /deliver yalnız
                  "teslim edildi", DELETE /ship yalnız "kargolandı" durumunda
                  çalışır. Zaman damgasına bakmak, geri alınmış bir siparişte
                  çalışmayan düğme bırakıyordu. Atölye partisiyle sevk edilmiş
                  sipariş de ucun kendi kapısına uyar: kargo geri alınamaz,
                  kutuda düğme yerine nereden düzeltileceği yazar. */}
              {shipRuleSectionVisible && (
                <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                  {workshopShippingLocked && (
                    <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
                      {/* Yönerge TEK kez yazılır. Sunucunun gerekçesi zaten
                          WORKSHOP_BATCH_FIX_HINT ile bitiyor ("düzeltmeyi atölye
                          seansı ekranından, parti sevkiyatı üzerinden yapın");
                          ekran onu ikinci kez tekrarlamaz, yalnız işi GERÇEKTEN
                          yapabilen yere — seans ekranının parti sevkiyatı
                          bölümüne — bağlantı verir (düzeltme ucu artık var:
                          PATCH /api/admin/workshop-sessions/[id]/batch-shipping).
                          Sunucu cevabı okunamadıysa cümlenin tek kopyası aşağıdaki
                          yedek metindir. */}
                      {shipRuleBlockNotice ??
                        "Bu sipariş bir atölye partisiyle sevk edildi; kargo bilgisi tek tek düzeltilemez. Takip numarası ve kargo firması partinin kendi kaydından gelir: düzeltmeyi atölye seansı ekranından, parti sevkiyatı üzerinden yapın."}{" "}
                      {order.workshopSessionId && (
                        <Link
                          href={`/admin/workshops/sessions/${order.workshopSessionId}#parti-sevkiyati`}
                          className="font-medium underline"
                        >
                          Parti sevkiyatını düzelt
                        </Link>
                      )}
                    </p>
                  )}
                  {shipRule.phase === "loading" ? (
                    <p className="text-[11px] text-gray-500">
                      Kargo kaydının geri alınıp alınamayacağı sunucuya soruluyor…
                    </p>
                  ) : shipRule.phase === "unknown" ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                      Kargo kuralı sunucudan okunamadı; düzeltme ve geri alma bu yüzden
                      kapalı — ekran bu kararı kendi başına vermez.{" "}
                      <button
                        type="button"
                        onClick={() => setShipRuleReload((n) => n + 1)}
                        className="font-medium underline"
                      >
                        Tekrar dene
                      </button>
                    </p>
                  ) : shipRuleBlockNotice && !workshopShippingLocked ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
                      <p>{shipRuleBlockNotice}</p>
                      {shipRuleCode === "refunded" && (
                        <p className="mt-1">
                          Paket yine de ulaştıysa kaydı denetim notuna yazın: iade edilmiş
                          sipariş hiçbir yöne kımıldamaz, teslim damgası da atılmaz.
                        </p>
                      )}
                    </div>
                  ) : !canRevertDelivery && !canRevertShipping ? null : !revertOpen ? (
                    <button
                      type="button"
                      onClick={() => setRevertOpen(true)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Kargo / teslim kaydını geri al
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-900">
                        Yalnız yanlış işaretlenmiş bir kaydı düzeltmek içindir. Müşteriye gitmiş
                        kargo ya da teslim e-postası geri alınmaz; işlem denetim kaydına yazılır.
                      </p>
                      <textarea
                        value={revertReason}
                        onChange={(e) => setRevertReason(e.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder="Gerekçe (zorunlu) — örn. yanlış siparişte kargolandı işaretlendi"
                        className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                      />
                      <div className="flex flex-wrap gap-2">
                        {canRevertDelivery && (
                          <button
                            type="button"
                            onClick={() => revertShipping("shipped")}
                            disabled={!!loading || revertReason.trim().length < 3}
                            className="rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500"
                          >
                            Teslimi geri al
                          </button>
                        )}
                        {canRevertShipping && (
                          <button
                            type="button"
                            onClick={() => revertShipping("in_production")}
                            disabled={!!loading || revertReason.trim().length < 3}
                            className="rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500"
                          >
                            Kargoyu geri al
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRevertOpen(false);
                            setRevertReason("");
                          }}
                          className="rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                        >
                          Vazgeç
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Shipping Address */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.orderDetail.shippingAddress"]}</h3>
              {editing ? (
                <div className="space-y-2">
                  <input type="text" value={editAddress?.adres || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, adres: e.target.value } : null)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Adres" />
                  <input type="text" value={editAddress?.mahalle || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, mahalle: e.target.value } : null)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Mahalle" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={editAddress?.ilce || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, ilce: e.target.value } : null)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Ilce" />
                    <input type="text" value={editAddress?.il || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, il: e.target.value } : null)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Il" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input type="text" value={editAddress?.postaKodu || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, postaKodu: e.target.value } : null)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Posta Kodu" />
                    <PhoneInput
                      country={editTelefonCountry}
                      nationalNumber={editTelefonNational}
                      onCountryChange={setEditTelefonCountry}
                      onNationalNumberChange={setEditTelefonNational}
                    />
                  </div>
                  {(order.shippedAt || order.deliveredAt) && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                      Bu sipariş kargolandı. Adres değişikliği gönderilen paketin gideceği yeri
                      DEĞİŞTİRMEZ; kayıt için kaydedebilirsiniz, kaydetmeden önce ayrıca onay
                      istenir.
                    </p>
                  )}
                  {/* Admin notes */}
                  <div className="pt-2">
                    <label className="block text-xs text-gray-400 mb-1">{d["admin.orderDetail.adminNote"]}</label>
                    <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={saveEdit} disabled={loading === "edit"} className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-400 transition-colors shadow-sm">
                      {loading === "edit" ? d["admin.orderDetail.saving"] : d["admin.orderDetail.saveChanges"]}
                    </button>
                    <button onClick={() => { setEditing(false); setEditAddress(order.shippingAddress); setEditNotes(order.adminNotes || ""); }} className="px-4 py-2 bg-gray-100 text-gray-700 text-xs font-medium rounded-xl hover:bg-gray-200 transition-colors">
                      {d["admin.orderDetail.cancel"]}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {addr && (
                    <div className="text-sm text-gray-700 space-y-0.5">
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        <div>
                          {addr.mahalle && <p className="text-gray-600">{addr.mahalle}</p>}
                          <p>{addr.adres}</p>
                          <p>{addr.ilce} / {addr.il}</p>
                          <p className="text-gray-500">{addr.postaKodu}</p>
                          <p className="mt-1 text-gray-500">Tel: {addr.telefon ? formatPhoneDisplay(addr.telefon) : "—"}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {order.adminNotes && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-xs text-gray-400 font-medium">{d["admin.orderDetail.adminNote"]}</p>
                      <p className="text-sm text-gray-700 mt-1">{order.adminNotes}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Üretim (production) ═════════════════════════════════ */}
      {tab === "production" && (
        <div className="space-y-5 max-w-3xl">

          {/* ─── Teknik özellikler (üreticiye gider) ─────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Teknik özellikler</h3>
            <p className="text-xs text-gray-500 mb-4">
              Üretici panelinde &quot;Teknik Özellikler&quot; kartında görünür. Boş
              bırakılan alanlar gösterilmez; kaydedince atanmış üreticiye bildirim
              gider.
            </p>
            {/* Size is a real measurement, not one of three tiers — a bespoke
                figure is whatever was agreed with the customer. */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">
                Boyut (yükseklik, cm)
              </label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SIZE_PRESETS_CM.map((cm) => (
                  <button
                    key={cm}
                    type="button"
                    onClick={() => applySpecSize(String(cm))}
                    className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-900 hover:text-gray-900"
                  >
                    {cm} cm
                  </button>
                ))}
              </div>
              <input
                type="text"
                inputMode="decimal"
                maxLength={SIZE_TEXT_MAX}
                value={specSize}
                onChange={(e) => {
                  setSpecSize(e.target.value);
                  setSpecSizeError(null);
                  setSpecSizePreview(null);
                }}
                onBlur={(e) => applySpecSize(e.target.value)}
                placeholder="örn. 18 · 17,5 · 15×10×22"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
              />
              {specSizeError ? (
                <p className="mt-1 text-xs text-red-600">{specSizeError}</p>
              ) : specSizePreview ? (
                <p className="mt-1 text-xs text-green-600">
                  ✓ Üreticiye şöyle görünecek: {specSizePreview}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Malzeme</label>
                <select
                  value={specMaterial}
                  onChange={(e) => setSpecMaterial(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                >
                  <option value="">Belirtilmedi</option>
                  <option value="resin">Reçine</option>
                  <option value="filament">Filament</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Boyama / Yüzey</label>
                <select
                  value={specFinish}
                  onChange={(e) => setSpecFinish(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                >
                  <option value="">Belirtilmedi</option>
                  <option value="paintable_kit">Boyanabilir Kit</option>
                  <option value="hand_painted">El Boyaması</option>
                  <option value="painted">Boyalı (tek renk / temel)</option>
                  <option value="luxe_display">Lüks Vitrin</option>
                  <option value="collector_raw">Collector Raw (boyasız)</option>
                  <option value="raw">Ham baskı</option>
                  <option value="smoothed">Pürüzsüz</option>
                </select>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {specAttrs.map((a, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    value={a.name}
                    onChange={(e) =>
                      setSpecAttrs((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p))
                      )
                    }
                    placeholder="Özellik (örn. Renk)"
                    className="w-2/5 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                  />
                  <input
                    type="text"
                    value={a.value}
                    onChange={(e) =>
                      setSpecAttrs((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, value: e.target.value } : p))
                      )
                    }
                    placeholder="Değer (örn. Mavi ceket, altın kaide)"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setSpecAttrs((prev) => prev.filter((_, i) => i !== idx))}
                    className="px-2 text-gray-400 hover:text-red-600"
                    aria-label="Özelliği sil"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSpecAttrs((prev) => [...prev, { name: "", value: "" }])}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                + Özellik ekle
              </button>
              <button
                type="button"
                onClick={saveSpec}
                disabled={loading === "spec"}
                className="ml-auto px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-400 transition-colors shadow-sm"
              >
                {loading === "spec" ? "Kaydediliyor…" : "Özellikleri kaydet"}
              </button>
            </div>
          </div>

          {/* ─── Model dosyaları ve sürümler ─────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">3D Model dosyaları</h3>
            <p className="text-xs text-gray-500 mb-4">
              STL/GLB indirin, düzeltip yeni sürüm olarak yükleyin. Her yükleme
              sürüm olarak saklanır; eski dosyalar silinmez.
            </p>

            {/* Okunamayan sürüm tablosu "model yok" DEMEK DEĞİLDİR: boş listeyi
                "Henüz model yüklenmedi" diye basmak, yapılmamış bir okumanın
                iddiasıdır. Aynı arızada sunucu QC turunu da kanıtlanamaz
                sayar (qcProof.failure = revision_unreadable), yani onay kapısı
                da kapalıdır — yukarıdaki QC kutusu sebebi ayrıca yazar. */}
            {/* Sürüm BAŞLIKLARI okunabildi ama PARÇA listesi okunamadı: sürümler
                gerçek, parçaları bilinmiyor. Ayrı bayrak, çünkü ayrı tablo. */}
            {!modelRevisionsUnreadable && readFailures?.modelFiles && (
              <ReadFailedNotice>
                Sürümlerin parça listesi şu anda okunamadı (geçici sistem arızası): aşağıdaki
                sürümler gerçek, ama hangi dosyalardan oluştukları gösterilemiyor ve toplu indirme
                bağlantıları bu yüzden görünmüyor. Dosyalar SİLİNMEDİ. Birkaç dakika sonra sayfayı
                yenileyin.
              </ReadFailedNotice>
            )}
            {modelRevisionsUnreadable ? (
              <p
                role="alert"
                className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                Model sürümleri şu anda okunamadı (geçici sistem arızası). Bu siparişin sürüm
                listesi gösterilemiyor; bu, &quot;model yüklenmedi&quot; demek DEĞİLDİR. Güncel
                sürümün hangisi olduğu bilinmediği için QC turu onayı da kapalı tutuldu. Birkaç
                dakika sonra sayfayı yenileyin.
              </p>
            ) : modelRevisions.length === 0 ? (
              <p className="text-sm text-gray-400 mb-4">Henüz model yüklenmedi.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {modelRevisions.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-100 p-3"
                  >
                    <span className="text-sm font-medium text-gray-900">
                      Sürüm {r.revision}
                      {/* "GÜNCEL" = en yüksek numaralı sürüm; tek kural bu
                          (config/order-model.ts · resolveCurrentRevision) ve
                          sunucu da aynı sayıyı kullanır. Sürümü değiştiren her
                          yol en üste YENİ bir sürüm yazdığından "en yenisi ama
                          geçerli değil" diye bir hâl kalmadı; o hâli anlatan
                          rozet, hiç görünemeyeceği için kaldırıldı. */}
                      {r.isCurrent && (
                        <span className="ml-1.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                          GÜNCEL
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-400">{formatDateTime(r.createdAt, loc)}</span>
                    <span className="text-xs text-gray-400">
                      · Yükleyen: {r.uploadedByEmail ?? r.audit?.adminEmail ?? "bilinmiyor"}
                    </span>
                    {r.note ? (
                      <span className="basis-full text-xs italic text-gray-600">Not: {r.note}</span>
                    ) : (
                      <span className="basis-full text-[11px] text-gray-400">Not yazılmamış.</span>
                    )}
                    {/* Siparişin yükleme ANINDAKİ durumu: denetim satırı aşama,
                        sipariş durumu, üretici ve boyacı durumunu birlikte yazar. */}
                    {r.audit?.notes && (
                      <span className="basis-full text-[11px] text-gray-500">
                        Yükleme kaydı: {r.audit.notes}
                      </span>
                    )}
                    <div className="flex gap-2 ml-auto">
                      {r.files.length > 1 && (
                        <a
                          href={`/api/admin/orders/${order.id}/model-files/zip?revision=${r.revision}`}
                          className="px-3 py-1 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800"
                        >
                          Tümünü indir (ZIP · {r.files.length})
                        </a>
                      )}
                      {/* Parça kaydı olmayan eski sürümler: birincil dosyalar. */}
                      {r.files.length === 0 && r.glbUrl && (
                        <a href={r.glbUrl} download className="px-3 py-1 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800">
                          GLB indir
                        </a>
                      )}
                      {r.files.length === 0 && r.stlUrl && (
                        <a href={r.stlUrl} download className="px-3 py-1 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700">
                          STL indir
                        </a>
                      )}
                    </div>
                    {r.files.length > 0 && (
                      <ul className="basis-full mt-1 grid gap-1 sm:grid-cols-2">
                        {r.files.map((f) => (
                          <li key={f.id}>
                            <a
                              href={f.url}
                              download={f.name}
                              className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-800 hover:bg-gray-100"
                            >
                              <span
                                className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold uppercase ${
                                  f.kind === "stl" ? "bg-emerald-100 text-emerald-800" : "bg-indigo-100 text-indigo-800"
                                }`}
                              >
                                {f.kind}
                              </span>
                              <span className="min-w-0 flex-1 truncate" title={f.name}>
                                {f.name}
                              </span>
                              {f.sizeBytes != null && (
                                <span className="shrink-0 text-gray-400">{formatModelSize(f.sizeBytes)}</span>
                              )}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Bu sürümün baskısından çekilmiş QC fotoğrafları: hangi
                        turun hangi modeli gösterdiği ancak burada okunur. */}
                    {(qcPhotos ?? []).filter((p) => p.modelRevision === r.revision).length > 0 && (
                      <div className="basis-full mt-2">
                        <p className="text-[11px] text-gray-500">
                          Bu sürümün baskısından QC fotoğrafları
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {(qcPhotos ?? [])
                            .filter((p) => p.modelRevision === r.revision)
                            .map((p) => (
                              <a
                                key={p.id}
                                href={p.url}
                                target="_blank"
                                rel="noreferrer"
                                title={`${p.round}. tur · ${formatDateTime(p.createdAt, loc)}`}
                                className="block h-16 w-16 overflow-hidden rounded-lg border border-gray-200"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.url} alt="" className="h-full w-full object-cover" />
                              </a>
                            ))}
                        </div>
                      </div>
                    )}

                    {!refunded && (
                      <div className="basis-full mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                        {revisionNoteDraft?.revision === r.revision ? (
                          <>
                            <input
                              type="text"
                              value={revisionNoteDraft.text}
                              onChange={(e) =>
                                setRevisionNoteDraft({ revision: r.revision, text: e.target.value })
                              }
                              maxLength={500}
                              placeholder="Sürüm notu"
                              className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-200"
                            />
                            <button
                              type="button"
                              onClick={() => saveRevisionNote(r.revision, revisionNoteDraft.text)}
                              disabled={!!loading}
                              className="rounded-lg bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300"
                            >
                              Notu kaydet
                            </button>
                            <button
                              type="button"
                              onClick={() => setRevisionNoteDraft(null)}
                              className="text-[11px] text-gray-500 underline"
                            >
                              Vazgeç
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setRevisionNoteDraft({ revision: r.revision, text: r.note ?? "" })
                            }
                            className="text-[11px] font-medium text-blue-700 hover:underline"
                          >
                            {r.note ? "Notu düzenle" : "Not ekle"}
                          </button>
                        )}
                        {!r.isCurrent && (
                          <button
                            type="button"
                            onClick={() => makeRevisionCurrent(r.revision)}
                            disabled={!!loading}
                            className="rounded-lg border border-emerald-300 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {loading === `rev-current-${r.revision}`
                              ? "Uygulanıyor…"
                              : "Bu sürümü geçerli yap"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteRevision(r.revision)}
                          disabled={!!loading}
                          className="rounded-lg border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {loading === `rev-delete-${r.revision}` ? "Siliniyor…" : "Yanlış yüklemeyi sil"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ─── Yeni model sürümü: HER aşamada ────────────────────────
                Karar (late-model-upload): model her aşamada yüklenebilir ve
                herkes haberdar edilir. Aşamanın ne tetiklediğini SUNUCU söyler
                (P2-C1); kutu önce onu okutur, sonra bilerek açtırır, gereken
                yerde gerekçe ister. Yeniden baskının bedeli bu ekranda VAAT
                EDİLMEZ: düzeltme kaydı Faz 6'da geliyor, bugün elle çözülüyor. */}
            {modelUpload && (
              <div className="border-t border-gray-100 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-gray-700">Yeni sürüm yükle</p>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    Aşama: {MODEL_UPLOAD_STAGE_LABEL[modelUpload.stage]}
                  </span>
                </div>

                {!canUploadRevision ? (
                  <p className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    {modelUpload.effects.warningTr}
                  </p>
                ) : (
                  <>
                    <p
                      className={`mt-2 rounded-xl px-3 py-2 text-xs ${
                        uploadEffects?.resetsQc || uploadEffects?.notifiesPainter
                          ? "border border-amber-300 bg-amber-50 text-amber-900"
                          : uploadEffects?.recordOnly
                            ? "border border-gray-200 bg-gray-50 text-gray-700"
                            : "border border-indigo-200 bg-indigo-50 text-indigo-900"
                      }`}
                    >
                      {modelUpload.effects.warningTr}
                    </p>

                    {sideEffectLines(modelUpload.effects).length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-gray-700">
                        {sideEffectLines(modelUpload.effects).map((line) => (
                          <li key={line} className="flex gap-2">
                            <span aria-hidden>•</span>
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {!uploadOpen ? (
                      <button
                        type="button"
                        onClick={() => setUploadOpen(true)}
                        className="mt-3 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-gray-800 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
                      >
                        Yeni sürüm yüklemeyi aç
                      </button>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <div>
                          <label
                            htmlFor="upload-note"
                            className="mb-1 block text-xs font-medium text-gray-600"
                          >
                            Sürüm notu{" "}
                            {uploadNoteRequired && <span className="text-red-500">*</span>}
                          </label>
                          <textarea
                            id="upload-note"
                            rows={2}
                            maxLength={500}
                            value={uploadNote}
                            onChange={(e) => setUploadNote(e.target.value)}
                            placeholder="örn. kaide kalınlaştırıldı, sol kol yeniden modellendi"
                            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                          />
                          <p className="mt-1 text-[11px] text-gray-500">
                            {uploadNoteRequired
                              ? "Bu aşamada gerekçe zorunlu (en az 10 karakter): not sürüme yazılır, üretici ve boyacı bildirimlerinde görünür."
                              : "İsteğe bağlı. Not sürüme yazılır ve partner bildirimlerinde görünür."}
                          </p>
                        </div>

                        {uploadReady && revisionPartsUnknown ? (
                          /* TAŞIMA KARARI, SAYFANIN SAHİP OLMADIĞI VERİYLE
                             VERİLEMEZ. "Önceki parçaları koru" güncel sürümün
                             PARÇA listesine bakar; liste okunamadığında bu ekran
                             yükleyiciye boş bir liste geçiyor, yükleyici taşımayı
                             sessizce kapatıyor ve yeni sürüm yalnızca yüklenen
                             dosyalardan oluşuyordu: 13 parçalı bir işten 12 parça,
                             kimseye söylenmeden düşebilirdi. Kapı kapalı tarafa
                             düşer ve sebebi burada yazılır. */
                          <p
                            role="alert"
                            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                          >
                            Güncel sürümün parça listesi şu anda okunamıyor (geçici sistem arızası),
                            bu yüzden yeni sürüm yükleme geçici olarak kapatıldı.{" "}
                            <strong>&quot;Önceki parçaları koru&quot; kararı bu listeye dayanır</strong>:
                            liste bilinmeden yüklenen bir sürüm, taşınması gereken parçaları sessizce
                            düşürebilir ve üretici eksik dosyayla baskıya başlayabilirdi. Birkaç
                            dakika sonra sayfayı yenileyin; liste okunur okunmaz yükleme yeniden
                            açılır.
                          </p>
                        ) : uploadReady ? (
                          <>
                            <p className="text-[11px] text-gray-600">
                              Yalnız değişen parçaları yükleyebilirsin. &quot;Önceki parçaları
                              koru&quot; açıkken aynı adlı parça yenisiyle değişir, diğerleri aynen
                              taşınır; kapatırsan yüklediğin dosyalar tüm setin yerine geçer.
                              Üretici yalnız güncel sürümün dosyalarını görür.
                            </p>
                            <OrderModelUploader
                              orderId={order.id}
                              variant="revision"
                              previousFiles={(modelRevisions[0]?.files ?? []).map((f) => ({
                                name: f.name,
                                kind: f.kind,
                              }))}
                              // Gerekçe yükleyiciye GEÇER: yoksa POST notsuz
                              // gider ve üretici `accepted`'ın ötesindeyken
                              // (baskı, QC, boyama, kargo sonrası) uç 400 ile
                              // reddeder — yani yukarıdaki kutuya yazılan not
                              // hiçbir işe yaramaz. Zorunluluğu da veriyoruz
                              // çünkü dosyalar son POST'tan ÖNCE parça parça
                              // yükleniyor: notsuz bir denemede yüzlerce MB
                              // boşuna gider ve admin reddi dakikalar sonra
                              // görürdü. Son söz yine SUNUCUNUN: aşama
                              // değiştiyse isteği o reddeder.
                              note={uploadNote}
                              noteRequired={uploadNoteRequired}
                              onUploaded={afterUpload}
                            />
                          </>
                        ) : (
                          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            Devam etmek için en az 10 karakterlik bir gerekçe yazın.
                          </p>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setUploadOpen(false);
                            setUploadNote("");
                          }}
                          className="text-xs text-gray-500 underline hover:text-gray-700"
                        >
                          Vazgeç
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Sonuç: yüklemenin GERÇEKTEN ne yaptığı, aşamanın kendi
                    cümleleriyle + siparişin tazelenmiş durumu. */}
                {uploadResult && (
                  <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                    <p className="text-sm font-semibold text-emerald-900">
                      {uploadResultTitle(uploadResult)}
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-800">
                      {uploadResult.kind === "restore"
                        ? "Geri getirme anındaki aşama: "
                        : "Yükleme anındaki aşama: "}
                      {MODEL_UPLOAD_STAGE_LABEL[uploadResult.stage]}
                      {uploadResult.note ? ` · Not: ${uploadResult.note}` : ""}
                    </p>
                    {uploadResult.server?.applied ? (
                      <>
                        {appliedEffectLines(uploadResult.server.applied).length > 0 ? (
                          <ul className="mt-2 space-y-1 text-xs text-emerald-900">
                            {appliedEffectLines(uploadResult.server.applied).map((line) => (
                              <li key={line}>✓ {line}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-emerald-800">
                            {noAppliedEffectsLine(
                              uploadResult.kind,
                              uploadResult.server.republished
                            )}
                          </p>
                        )}
                        {missedEffectLines(
                          // Yayımlamayan bir geri getirmede BEKLENEN etki yoktur:
                          // "QC SIFIRLANMADI" alarmı, hiç yapılmamış bir
                          // değişikliğin eksiğini bağırırdı.
                          uploadResult.server.republished === false
                            ? null
                            : uploadResult.effects,
                          uploadResult.server.applied
                        ).map(
                          (line) => (
                            <p
                              key={line}
                              role="alert"
                              className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
                            >
                              {line}
                            </p>
                          )
                        )}
                        {uploadResult.server.warning && (
                          <p className="mt-2 text-xs text-emerald-900">
                            {uploadResult.server.warning}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        {sideEffectLines(uploadResult.effects).length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-emerald-900">
                            {sideEffectLines(uploadResult.effects).map((line) => (
                              <li key={line}>• {line}</li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          Sunucunun uyguladığı yan etkiler okunamadı; yukarıdakiler bu aşamada
                          BEKLENEN etkilerdir. Aşağıdaki güncel durumu esas alın.
                        </p>
                      </>
                    )}
                    <p className="mt-2 text-xs text-emerald-800">
                      Şu anki durum: QC turu {qcRound ?? 1}
                      {manufacturerStatus
                        ? `, üretici: ${manufacturerStatusLabel(manufacturerStatus)}`
                        : ""}
                      {/* Okunamayan günlük "onay bekleniyor" DEĞİLDİR: kapı
                          aynı kapı, bilgi yok. */}
                      {partnerAck?.manufacturer.readFailed
                        ? ", üretici onay kaydı okunamadı"
                        : partnerAck?.manufacturer.pending
                          ? ", üretici onayı bekleniyor"
                          : ""}
                      {partnerAck?.painter.readFailed
                        ? ", boyacı onay kaydı okunamadı"
                        : partnerAck?.painter.pending
                          ? ", boyacı onayı bekleniyor"
                          : ""}
                      {modelApproval && modelApproval.rounds.length > 0
                        ? `, müşteri onay turu: ${modelApproval.rounds[0].revision}`
                        : ""}
                      .
                    </p>
                    <button
                      type="button"
                      onClick={() => setUploadResult(null)}
                      className="mt-2 text-xs text-emerald-800 underline"
                    >
                      Kapat
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── Müşteri model onayı ──────────────────────────────────
              Turlar, kararlar ve müşterinin revizyon notu sipariş sayfasında
              hiç görünmüyordu: onayın izi yalnız /onay ekranında ve e-postadaydı,
              telefonla gelen bir karar da hiçbir yere yazılamıyordu. */}
          {modelApproval &&
            (modelApproval.rounds.length > 0 ||
              modelApproval.open ||
              !!modelApproval.url ||
              // Turlar OKUNAMADIYSA kartın hiç çıkmaması, "onay turu yok"
              // demenin sessiz hâli olurdu.
              !!readFailures?.modelApprovalRounds) && (
              <div className="bg-white rounded-2xl shadow-sm border border-cyan-200 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Müşteri model onayı</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      modelApproval.open
                        ? "bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200"
                        : modelApproval.approvedAt
                          ? "bg-green-50 text-green-700 ring-1 ring-green-200"
                          : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {modelApproval.open
                      ? "Müşterinin kararı bekleniyor"
                      : modelApproval.approvedAt
                        ? "Onaylandı"
                        : "Açık tur yok"}
                  </span>
                </div>

                {modelApproval.approvedAt && (
                  <p className="mt-1 text-xs text-gray-600">
                    Onay: {formatDateTime(modelApproval.approvedAt, loc)}
                  </p>
                )}

                {modelApproval.revisionNote && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-semibold text-amber-900">
                      Müşterinin istediği değişiklik
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-amber-900">
                      {modelApproval.revisionNote}
                    </p>
                  </div>
                )}

                {readFailures?.modelApprovalRounds ? (
                  <ReadFailedNotice>
                    Müşteri onay turları şu anda okunamadı (geçici sistem arızası): bu siparişte tur
                    açılıp açılmadığını ve müşterinin ne karar verdiğini söyleyemiyoruz. Bu,
                    &quot;onay turu yok&quot; demek DEĞİLDİR. Birkaç dakika sonra sayfayı yenileyin.
                  </ReadFailedNotice>
                ) : modelApproval.rounds.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-400">
                    Bu siparişte müşteriye hiç onay turu açılmadı.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {modelApproval.rounds.map((r) => (
                      <li key={r.id} className="rounded-xl border border-gray-100 p-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-900">{r.revision}. tur</span>
                          <span
                            className={`rounded-full px-2 py-0.5 font-semibold ${
                              r.decision === "approved" || r.decision === "auto_approved"
                                ? "bg-green-50 text-green-700"
                                : r.decision === "revision"
                                  ? "bg-amber-50 text-amber-700"
                                  : r.decision
                                    ? "bg-red-50 text-red-700"
                                    : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {r.decision
                              ? APPROVAL_DECISION_LABEL[r.decision] ?? r.decision
                              : "Karar yok"}
                          </span>
                        </div>
                        <p className="mt-1 text-gray-500">
                          Gönderildi: {formatDateTime(r.shownAt, loc)} ·{" "}
                          {r.channel === "whatsapp" ? "WhatsApp" : "E-posta"}
                          {r.reminderSentAt
                            ? ` · hatırlatma: ${formatDateTime(r.reminderSentAt, loc)}`
                            : ""}
                          {r.decidedAt ? ` · karar: ${formatDateTime(r.decidedAt, loc)}` : ""}
                        </p>
                        {r.note && <p className="mt-1 text-gray-700">Müşteri notu: {r.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}

                {modelApproval.url && (
                  <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2">
                    <p className="text-[11px] text-gray-500">Müşterinin onay bağlantısı</p>
                    <p className="mt-0.5 break-all font-mono text-[11px] text-gray-700">
                      {modelApproval.url}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(modelApproval.url ?? "").catch(() => {});
                        }}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                      >
                        Bağlantıyı kopyala
                      </button>
                      {/* Yeniden gönderme yalnız AÇIK turda çalışır: uç,
                          sipariş `awaiting_customer_approval` değilse 400
                          döner. Jeton karar verildikten sonra da duruyor, o
                          yüzden bağlantı görünür kalır ama düğme kapanır —
                          eskiden her kapanmış onayda canlı görünüp her
                          tıklamada reddediliyordu. */}
                      {!refunded && modelApproval.open && (
                        <button
                          type="button"
                          onClick={resendApproval}
                          disabled={!!loading}
                          className="rounded-lg border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-800 hover:bg-cyan-50 disabled:opacity-50"
                        >
                          {loading === "approval-resend"
                            ? "Gönderiliyor…"
                            : "Onay bağlantısını yeniden gönder"}
                        </button>
                      )}
                    </div>
                    {!refunded && !modelApproval.open && (
                      <p className="mt-2 text-[11px] text-gray-500">
                        Açık onay turu yok; bağlantı yeniden gönderilemez. Yeni bir tur ancak
                        müşteriye gösterilen modeli değiştiren bir yükleme ile açılır.
                      </p>
                    )}
                  </div>
                )}

                {!refunded && modelApproval.open && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    {!recordOpen ? (
                      <button
                        type="button"
                        onClick={() => setRecordOpen(true)}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Telefonla ya da WhatsApp ile gelen kararı kaydet
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
                          Kararı müşterinin kendisi tıklamadı; kaydı siz giriyorsunuz. Denetim
                          kaydında sizin adınız kalır ve onay turu bu kararla kapanır.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <select
                            value={recordDecision}
                            onChange={(e) =>
                              setRecordDecision(e.target.value === "revision" ? "revision" : "approved")
                            }
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          >
                            <option value="approved">Müşteri onayladı</option>
                            <option value="revision">Müşteri revizyon istedi</option>
                          </select>
                          <select
                            value={recordChannel}
                            onChange={(e) =>
                              setRecordChannel(e.target.value === "whatsapp" ? "whatsapp" : "phone")
                            }
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          >
                            <option value="phone">Telefon</option>
                            <option value="whatsapp">WhatsApp</option>
                          </select>
                        </div>
                        <textarea
                          value={recordNote}
                          onChange={(e) => setRecordNote(e.target.value)}
                          rows={2}
                          maxLength={1000}
                          placeholder="Müşterinin söyledikleri (revizyon isteğinde zorunlu)"
                          className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={recordApprovalDecision}
                            disabled={!!loading}
                            className="rounded-xl bg-cyan-700 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-800 disabled:bg-gray-300"
                          >
                            {loading === "approval-record" ? "Kaydediliyor…" : "Kararı kaydet"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRecordOpen(false);
                              setRecordNote("");
                            }}
                            className="rounded-xl bg-white px-4 py-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                          >
                            Vazgeç
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          {/* ─── Manufacturer Section ─────────────────── */}
          {hasManufacturer && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900">{manufacturer.companyName}</h3>
                  <p className="text-xs text-gray-500">{manufacturer.contactPerson}</p>
                </div>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  manufacturerStatus === "printing" || manufacturerStatus === "accepted" ? "bg-purple-50 text-purple-700 ring-1 ring-purple-200" :
                  manufacturerStatus === "printed" || manufacturerStatus === "shipped" ? "bg-green-50 text-green-700 ring-1 ring-green-200" :
                  manufacturerStatus === "assigned" ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" :
                  "bg-gray-50 text-gray-700 ring-1 ring-gray-200"
                }`}>
                  {manufacturerStatusLabel(manufacturerStatus)}
                </span>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-xs text-blue-700 font-medium">{d["admin.orderDetail.managedByManufacturer"]}</p>
              </div>

              {/* Atölyeye ULAŞMAK için gerekenler ve işin damgaları. Admin
                  bugüne kadar üreticiyi aramak için /admin/manufacturers'a gidip
                  aratıyor, "ne zaman kabul etti / ne zaman bitirdi" sorusunu ise
                  hiçbir yerden okuyamıyordu. */}
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-gray-400">Telefon</dt>
                  <dd className="text-gray-900">
                    {manufacturer.phone ? (
                      <a href={`tel:${manufacturer.phone}`} className="text-blue-700 hover:underline">
                        {manufacturer.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-gray-400">E-posta</dt>
                  <dd className="truncate text-gray-900">
                    {manufacturer.email ? (
                      <a
                        href={`mailto:${manufacturer.email}`}
                        className="text-blue-700 hover:underline"
                      >
                        {manufacturer.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">Şehir</dt>
                  <dd className="text-gray-900">
                    {manufacturer.city ?? "—"}
                    {manufacturer.district ? ` / ${manufacturer.district}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">Atandı</dt>
                  <dd className="text-gray-900">
                    {assignedToManufacturerAt ? formatDateTime(assignedToManufacturerAt, loc) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">Kabul etti</dt>
                  <dd className="text-gray-900">
                    {manufacturerAcceptedAt ? formatDateTime(manufacturerAcceptedAt, loc) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">Baskıyı bitirdi</dt>
                  <dd className="text-gray-900">
                    {manufacturerPrintedAt ? formatDateTime(manufacturerPrintedAt, loc) : "—"}
                  </dd>
                </div>
              </dl>

              {/* Yeni model sürümünü gördüğünü onayladı mı: onaylamadan baskı,
                  QC ve kargo adımları kapalıdır (late-model-upload kararı). */}
              {partnerAck?.manufacturer.readFailed ? (
                <p
                  role="alert"
                  className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                >
                  Üreticinin model onay kaydı şu anda okunamadı (geçici sistem arızası): yeni bir
                  sürümün duyurulup duyurulmadığını ve üreticinin onaylayıp onaylamadığını
                  söyleyemiyoruz. Güvenlik gereği baskıya başlama, baskıyı bitirme, QC&apos;ye
                  gönderme, boyacıya devretme ve kargolama adımları — üretici adına yapılanlar
                  dahil — kapalı tutuldu. Birkaç dakika sonra sayfayı yenileyin.
                </p>
              ) : partnerAck?.manufacturer.pending ? (
                <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Üretici {partnerAck.manufacturer.announcedRevision}. sürümü henüz onaylamadı;
                  onaylayana kadar baskıya başlama, baskıyı bitirme, QC&apos;ye gönderme, boyacıya
                  devretme ve kargolama adımları kapalı. Bu kapı ÜRETİCİ ADINA yapılan işlemlerde
                  de geçerlidir: onay gelmeden bu adımlar buradan da ilerletilemez. Üreticiye
                  ulaşıp yeni sürümü kendi ekranından onaylamasını isteyin.
                </p>
              ) : null}
              {partnerAck?.manufacturer.acknowledgedRevision != null &&
                !partnerAck.manufacturer.pending && (
                  <p className="mt-3 text-xs text-green-700">
                    Üretici {partnerAck.manufacturer.acknowledgedRevision}. sürümü gördüğünü
                    onayladı.
                  </p>
                )}

              {declinedManufacturers && declinedManufacturers.length > 0 && (
                <p className="mt-3 text-xs text-gray-500">
                  Bu siparişi reddedenler:{" "}
                  {declinedManufacturers.map((m) => m.companyName).join(", ")} — bu atölyelere
                  tekrar önerilmez.
                </p>
              )}
              {readFailures?.manufacturerDeclined && (
                <ReadFailedNotice>
                  Bu siparişi reddeden üreticilerin listesi şu anda okunamadı (geçici sistem
                  arızası); burada kimsenin görünmemesi &quot;kimse reddetmedi&quot; demek DEĞİLDİR.
                  Otomatik atama yine de reddedenleri atlar — ret kaydı sunucuda duruyor.
                </ReadFailedNotice>
              )}
              {manufacturerActionsUnreadable && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                >
                  Üreticinin işlem geçmişi şu anda okunamadı (geçici sistem arızası); bu kart boş
                  DEĞİL, bilinmiyor. Aynı arıza yüzünden model onay durumu da bilinmiyor. Sayfanın
                  geri kalanı gerçek kayıtlardır. Birkaç dakika sonra sayfayı yenileyin.
                </p>
              )}
              {mfgActions && mfgActions.length > 0 && (
                <div className="mt-4 space-y-0">
                  {mfgActions.map((action, i) => (
                    <div key={action.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-2 h-2 rounded-full bg-purple-400 mt-1.5 flex-shrink-0" />
                        {i < mfgActions.length - 1 && <div className="w-px flex-1 bg-purple-200 my-0.5" />}
                      </div>
                      <div className="pb-3 min-w-0">
                        <p className="text-xs font-medium text-gray-700">
                          {manufacturerActionLabel(action.action)}
                        </p>
                        {action.notes && <p className="text-xs text-gray-500 mt-0.5">{action.notes}</p>}
                        <p className="text-[10px] text-gray-400 mt-0.5">{formatDateTime(action.createdAt, loc)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Üretici yokken de reddedenler görünmeli: sipariş kuyrukta
              beklerken "kimse almıyor mu, kimler reddetti" sorusu tam burada
              soruluyor. */}
          {!hasManufacturer && readFailures?.manufacturerDeclined && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Bu siparişi reddeden üreticiler
              </h3>
              <ReadFailedNotice>
                Liste şu anda okunamadı (geçici sistem arızası); bu kart boş DEĞİL, bilinmiyor.
                Otomatik atama yine de reddedenleri atlar.
              </ReadFailedNotice>
            </div>
          )}

          {!hasManufacturer && declinedManufacturers && declinedManufacturers.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Bu siparişi reddeden üreticiler
              </h3>
              <p className="mt-2 text-sm text-gray-700">
                {declinedManufacturers.map((m) => m.companyName).join(", ")}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Otomatik atama bu atölyeleri bu sipariş için atlar.
              </p>
            </div>
          )}

          {/* ─── Partner adına işlem (P2-C4) ────────────────────────────
              Admin, siparişi tutan partnerin KENDİ adımını onun yerine yapar ve
              adım partnerin kendi servisinden geçer: hakediş birebir aynı şekilde
              tahakkuk eder. Bu yüzden gerekçe zorunludur ve gerekçe hem denetim
              kaydına hem partnerin kendi zaman çizelgesine yazılır. */}
          {holder !== "none" && !refunded && (
            <div className="bg-white rounded-2xl shadow-sm border border-orange-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  {holderLabel} adına işlem
                </h3>
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-800 ring-1 ring-orange-200">
                  Partner adına
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-600">
                Bu adımlar {holderLabel.toLocaleLowerCase("tr")}nin kendi ekranındaki adımlarla
                AYNI işlemi çalıştırır: durum, bildirimler ve hakediş birebir aynı şekilde oluşur.
                Yalnız partner ulaşılamadığında ya da ekranı kullanamadığında kullanın.
              </p>

              {onBehalfOptions.length === 0 ? (
                <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  Şu anki durumda {holderLabel.toLocaleLowerCase("tr")} adına yapılacak bir adım
                  yok. Sıradaki adım sizde olabilir (ör. QC onayı) ya da iş zaten ilerlemiş
                  olabilir.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  <select
                    value={onBehalfAction}
                    onChange={(e) => setOnBehalfAction((e.target.value || "") as OnBehalfAction | "")}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">İşlem seçin…</option>
                    {onBehalfOptions.map((a) => (
                      <option key={a} value={a}>
                        {ON_BEHALF_LABELS[holder === "painter" ? "painter" : "manufacturer"][a]}
                      </option>
                    ))}
                  </select>

                  {onBehalfAction === "ship" && (
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={onBehalfCarrier}
                        onChange={(e) => setOnBehalfCarrier(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">Taşıyıcı seçin… (zorunlu)</option>
                        {CARRIERS.map((c) => (
                          <option key={c} value={c}>
                            {CARRIER_LABEL[c] ?? c}
                          </option>
                        ))}
                      </select>
                      <input
                        value={onBehalfTracking}
                        onChange={(e) => setOnBehalfTracking(e.target.value)}
                        maxLength={60}
                        placeholder="Takip numarası (zorunlu)"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="on-behalf-reason"
                      className="mb-1 block text-xs font-medium text-gray-600"
                    >
                      Gerekçe <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      id="on-behalf-reason"
                      rows={2}
                      maxLength={500}
                      value={onBehalfReason}
                      onChange={(e) => setOnBehalfReason(e.target.value)}
                      placeholder="örn. üretici telefonla bildirdi, panele giremiyor"
                      className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                      En az {ON_BEHALF_REASON_MIN} karakter. Gerekçe denetim kaydına ve partnerin
                      kendi zaman çizelgesine yazılır; partner bu adımı sizin yaptığınızı görür.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={runOnBehalf}
                    disabled={
                      !!loading ||
                      !onBehalfAction ||
                      onBehalfReason.trim().length < ON_BEHALF_REASON_MIN ||
                      // Kargo adımında taşıyıcı ve takip numarası olmadan
                      // servis zaten reddediyor (carrier_required /
                      // tracking_required); düğme de o isteği hiç göndermez.
                      (onBehalfAction === "ship" &&
                        (!onBehalfCarrier || !onBehalfTracking.trim()))
                    }
                    className="w-full rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:bg-gray-300 disabled:text-gray-500"
                  >
                    {loading === "on-behalf"
                      ? "Uygulanıyor…"
                      : `${holderLabel} adına uygula`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* QC review history */}
          {qcReviews && qcReviews.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{d["admin.qc.history"]}</h3>
              <div className="space-y-2">
                {qcReviews.map((r) => (
                  <div key={r.id} className="flex items-start gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full font-semibold shrink-0 ${r.decision === "approved" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {r.decision === "approved" ? d["admin.qc.approved"] : d["admin.qc.rejected"]}
                    </span>
                    <div className="min-w-0">
                      <p className="text-gray-500">{d["admin.qc.round"]} {r.round} · {formatDateTime(r.createdAt, loc)}</p>
                      {r.reason && <p className="text-gray-600 mt-0.5">{r.reason}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mesh Report (Collapsible) */}
          {latestReport && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <button
                onClick={() => setMeshReportOpen(!meshReportOpen)}
                className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
              >
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{d["admin.orderDetail.meshReport"]}</h3>
                <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${meshReportOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              <div className={`transition-all duration-300 ease-in-out ${meshReportOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"} overflow-hidden`}>
                <dl className="px-5 pb-5 space-y-3 text-sm border-t border-gray-100 pt-4">
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.watertight"]}</dt>
                    <dd className="flex items-center gap-1.5">
                      {latestReport.isWatertight ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span className={latestReport.isWatertight ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {latestReport.isWatertight ? d["common.yes"] : d["common.no"]}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.solidVolume"]}</dt>
                    <dd className="flex items-center gap-1.5">
                      {latestReport.isVolume ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span className={latestReport.isVolume ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {latestReport.isVolume ? d["common.yes"] : d["common.no"]}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.vertex"]}</dt>
                    <dd className="text-gray-700">{formatNumber(latestReport.vertexCount, loc)}</dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.face"]}</dt>
                    <dd className="text-gray-700">{formatNumber(latestReport.faceCount, loc)}</dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.component"]}</dt>
                    <dd className="text-gray-700">{latestReport.componentCount}</dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.baseAdded"]}</dt>
                    <dd className="text-gray-700">{latestReport.baseAdded ? d["common.yes"] : d["common.no"]}</dd>
                  </div>
                  {latestReport.boundingBox && typeof latestReport.boundingBox === "object" && (
                    <div className="flex justify-between items-center">
                      <dt className="text-gray-400">{d["admin.orderDetail.dimensions"]}</dt>
                      <dd className="font-mono text-xs text-gray-700 bg-gray-50 px-2 py-0.5 rounded">{latestReport.boundingBox.size?.map((v: number) => v.toFixed(1)).join(" x ")}</dd>
                    </div>
                  )}
                  {latestReport.repairsApplied && latestReport.repairsApplied.length > 0 && (
                    <div className="pt-3 border-t border-gray-100">
                      <dt className="text-gray-400 mb-2">{d["admin.orderDetail.repairsApplied"]}</dt>
                      <dd className="flex flex-wrap gap-1">
                        {latestReport.repairsApplied.map((r) => (
                          <span key={r} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-blue-200">{r}</span>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ İletişim (communication) ════════════════════════════ */}
      {tab === "communication" && (
        <div className="space-y-5 max-w-3xl">

          {/* ─── Order conversations (customer + manufacturer channels) ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{d["admin.chat.title"]}</h3>
            <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
              <button
                onClick={() => setChatTab("customer_admin")}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${chatTab === "customer_admin" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                {d["admin.chat.customerTab"]}
              </button>
              <button
                onClick={() => setChatTab("manufacturer_admin")}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${chatTab === "manufacturer_admin" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                {d["admin.chat.manufacturerTab"]}
              </button>
              <button
                onClick={() => setChatTab("painter_admin")}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${chatTab === "painter_admin" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                Boyacı
              </button>
            </div>
            {chatTab === "manufacturer_admin" && !manufacturer ? (
              <p className="text-sm text-gray-400 py-4">{d["admin.chat.noManufacturer"]}</p>
            ) : chatTab === "painter_admin" ? (
              painter ? (
                <PartnerChatPanel orderId={order.id} loc={loc} />
              ) : (
                <p className="py-4 text-sm text-gray-400">
                  Bu siparişte boyacı yok; kanal boyacı atandığında açılır.
                </p>
              )
            ) : (
              <OrderChat
                key={chatTab}
                basePath={`/api/admin/orders/${order.id}/messages`}
                query={`?channel=${chatTab}`}
                orderId={order.id}
              />
            )}
          </div>

          {/* ─── Messaging Panel (Collapsible) ────────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button
              onClick={() => setMessagingOpen(!messagingOpen)}
              className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                </div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{d["admin.messaging.title"]}</h3>
              </div>
              <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${messagingOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            <div className={`transition-all duration-300 ease-in-out ${messagingOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"} overflow-hidden`}>
              <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
                {/* Template selector */}
                <select value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow">
                  {MESSAGE_TEMPLATES.map(tpl => (
                    <option key={tpl.key} value={tpl.key}>{d[tpl.labelKey as keyof typeof d] || tpl.key}</option>
                  ))}
                </select>
                <input type="text" value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder={d["admin.messaging.subjectPlaceholder"]} />
                <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} rows={4} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder={d["admin.messaging.bodyPlaceholder"]} />
                <button onClick={sendEmail} disabled={!msgBody.trim() || msgSending} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors shadow-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  {msgSending ? d["admin.messaging.sending"] : msgSent ? d["admin.messaging.sent"] : d["admin.messaging.send"]}
                </button>
              </div>
            </div>
          </div>

          {/* Message History */}
          {adminMessages.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.messaging.history"]}</h3>
              <div className="space-y-0">
                {adminMessages.map((msg, i) => (
                  <div key={msg.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 bg-blue-400" />
                      {i < adminMessages.length - 1 && <div className="w-px flex-1 bg-gray-200 my-0.5" />}
                    </div>
                    <div className="pb-4 min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700">
                            {d["admin.messaging.via.email"]}
                          </span>
                          {msg.subject && <span className="text-sm font-medium text-gray-700 truncate">{msg.subject}</span>}
                        </div>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDateTime(msg.sentAt, loc)}</span>
                      </div>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-3 mt-1">{msg.body}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{msg.adminEmail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Geçmiş (history) ════════════════════════════════════ */}
      {tab === "history" && (
        <div className="space-y-5 max-w-3xl">

          {/* Generation History */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.orderDetail.generationHistory"]}</h3>
            <div className="space-y-0">
              {generationAttempts.map((attempt, i) => (
                <div key={attempt.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${
                      attempt.status === "succeeded" ? "bg-green-400" :
                      attempt.status === "failed" ? "bg-red-400" :
                      "bg-yellow-400"
                    }`} />
                    {i < generationAttempts.length - 1 && <div className="w-px flex-1 bg-gray-200 my-0.5" />}
                  </div>
                  <div className="pb-3 flex-1 min-w-0 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-gray-700 capitalize">{attempt.provider}</span>
                      <span className={`ml-2 text-xs font-medium ${attempt.status === "succeeded" ? "text-green-600" : attempt.status === "failed" ? "text-red-600" : "text-yellow-600"}`}>
                        {attempt.status === "succeeded" ? d["admin.orderDetail.succeeded"] : attempt.status === "failed" ? d["admin.orderDetail.generationFailed"] : attempt.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 whitespace-nowrap">
                      {attempt.durationMs ? `${(attempt.durationMs / 1000).toFixed(1)}s` : ""}
                      {attempt.costCents ? ` · $${(attempt.costCents / 100).toFixed(2)}` : ""}
                    </div>
                  </div>
                </div>
              ))}
              {generationAttempts.length === 0 && (
                <p className="text-sm text-gray-400">{d["admin.orderDetail.noAttempts"]}</p>
              )}
            </div>
          </div>

          {/* Admin Action History */}
          {adminActions.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.orderDetail.adminActions"]}</h3>
              <div className="space-y-0">
                {adminActions.map((action, i) => (
                  <div key={action.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-400 mt-1 flex-shrink-0" />
                      {i < adminActions.length - 1 && <div className="w-px flex-1 bg-gray-200 my-0.5" />}
                    </div>
                    <div className="pb-3 flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-700">{d[`admin.timeline.${action.action}` as keyof typeof d] || action.action.replace(/_/g, " ")}</span>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDateTime(action.createdAt, loc)}</span>
                      </div>
                      <p className="text-[10px] text-gray-400">{action.adminEmail}</p>
                      {action.notes && <p className="text-xs text-gray-500 mt-0.5">{action.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Üretici kartı yokken günlük okunamazsa hiçbir şey render edilmez
              ve ekran "üretici hiç işlem yapmamış" izlenimi bırakırdı. */}
          {!hasManufacturer && manufacturerActionsUnreadable && (
            <div className="bg-white rounded-2xl shadow-sm border border-amber-200 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {d["admin.orderDetail.manufacturerActions"]}
              </h3>
              <p
                role="alert"
                className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                Üreticinin işlem geçmişi şu anda okunamadı (geçici sistem arızası); bu kart boş
                DEĞİL, bilinmiyor. Birkaç dakika sonra sayfayı yenileyin.
              </p>
            </div>
          )}

          {/* Manufacturer Actions (standalone, when no manufacturer card rendered above) */}
          {!hasManufacturer && mfgActions && mfgActions.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.orderDetail.manufacturerActions"]}</h3>
              <div className="space-y-0">
                {mfgActions.map((action, i) => (
                  <div key={action.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-purple-400 mt-1 flex-shrink-0" />
                      {i < mfgActions.length - 1 && <div className="w-px flex-1 bg-gray-200 my-0.5" />}
                    </div>
                    <div className="pb-3 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-700">
                          {manufacturerActionLabel(action.action)}
                        </span>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDateTime(action.createdAt, loc)}</span>
                      </div>
                      {action.notes && <p className="text-xs text-gray-500 mt-0.5">{action.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
