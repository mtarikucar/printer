/**
 * Çerçeve anlaşmanın TEK serileştiricisi (müşteri yüzeyi).
 *
 * `/cerceve/[number]` sayfasının RSC props'u, `GET /api/customer/frameworks`,
 * `GET /api/customer/frameworks/[number]` ve yazdırılabilir anlaşma belgesi
 * anlaşmayı BURADAN alır. İkinci bir serileştirici olsaydı fiyat kapısı iki
 * yerde ayrı ayrı uygulanır ve biri bir gün unutulurdu; fiyat gizleme bir
 * görünüm ayarı değil güvenlik sınırıdır (`quote-present.ts`in aynı kuralı).
 *
 * ─── KURAL 1: `canSeePrices` yanlışken hiçbir fiyat ANAHTARI yoktur ─────────
 *
 * `null` bile değil, anahtarın KENDİSİ yoktur. `undefined` atamak yetmez:
 * `JSON.stringify` onu atsa da RSC props'unda ve `Object.keys`te görünürdü, bu
 * yüzden alanlar hiç EKLENMEZ. Çerçeve tutarlarının adları `…Kurus` ile BİTER
 * (f-1 §F1.5) — hem bu dosyanın yapısal kapısı hem `quote-present.ts`in ad
 * tabanlı kapısı aynı sözleşmeyi okuyor.
 *
 * ─── KURAL 2: EKRANDA PARA ARİTMETİĞİ YOKTUR ───────────────────────────────
 *
 * Gösterilecek her rakam BURADA türetilir ve hazır iner: KDV hariç görünüm de
 * (`computeKdv`), partinin beklenen sevk günü de (`addBusinessDays`). Ekran
 * yalnız biçimler. Aynı sebeple İKİ TOPLAM AYRI alanlardadır ve biri ötekinin
 * yerine YAZILMAZ; farkları da hesaplanmaz (bir çıkarma, "kayıp para" gibi
 * okunacak üçüncü bir sayı üretirdi).
 *
 * ─── SAF: DB okuması yoktur ────────────────────────────────────────────────
 *
 * Girdi `loadFrameworkDetail`in çıktısıdır; imzalayıcı (`sign`) dışarıdan
 * verilir, böylece hem rota hem test aynı işlevi çağırır.
 */
import { KDV_RATE_BPS } from "@/lib/config/prices";
import type {
  FrameworkBatchStatus,
  FrameworkPartProgress,
  FrameworkProgress,
  FrameworkStatus,
} from "@/lib/config/quote-framework";
import type { DfmCode, LeadTierKey, Vec3 } from "@/lib/config/quote-types";
import type { TurkishAddress } from "@/lib/db/schema";
import { computeKdv } from "@/lib/services/finance";
import type { FrameworkDetail } from "@/lib/services/quote-framework";
import type { FrameworkViewer } from "@/lib/services/quote-access";

/** Taahhüt satırı: anlaşmanın DONMUŞ parça tanımı + taahhüt edilen adet. */
export interface PresentedFrameworkPart {
  partId: string;
  position: number;
  name: string;
  fileName: string;
  technologyName: string;
  materialName: string;
  colorName: string;
  colorHex: string;
  finishName: string;
  layerUm: number | null;
  infillPct: number | null;
  /** TAAHHÜT edilen adet (`parts_snapshot[].quantity`). */
  quantity: number;
  dimensionsMm: Vec3;
  volumeCm3: number | null;
  /** Üçgenleme sapması (mm); mesh parçalarında null. Bir FİYAT değil, nitelik. */
  tessellationMm: number | null;
  thumbnailUrl: string | null;
  /**
   * Anlaşma kurulurken bu parçada duran üretim uyarıları.
   *
   * GÖSTERİM, ONAY DEĞİL: onay MÜŞTERİNİN kaydıdır ve `copyPartInto`
   * `dfm_ack_key`i klona KOPYALAMAZ, yani `checkoutBlockers`in
   * `unacknowledged` kapısı HER PARTİDE yeniden sorar
   * (`instantQuote.framework.warningsPerBatch`).
   */
  dfmWarnings: DfmCode[];
  note: string | null;
  /** YALNIZ `viewer.canSeePrices` iken var. */
  unitKurus?: number;
  /** YALNIZ `viewer.canSeePrices` iken var. */
  lineKurus?: number;
}

export interface PresentedFrameworkAddon {
  key: string;
  name: string;
  /** YALNIZ `viewer.canSeePrices` iken var. */
  kurus?: number;
}

export interface PresentedFrameworkBatchLine {
  partId: string;
  position: number;
  quantity: number;
  /** YALNIZ `viewer.canSeePrices` iken var. */
  unitKurus?: number;
  /** YALNIZ `viewer.canSeePrices` iken var. */
  lineKurus?: number;
}

export interface PresentedFrameworkBatch {
  id: string;
  position: number;
  status: FrameworkBatchStatus;
  plannedShipDate: string;
  units: number;
  /**
   * Serbest bırakılmış ve henüz sevk edilmemiş partinin BEKLENEN kargoya
   * teslim günü; başka hâllerde null. İş günü aritmetiği SERVİSTE yapılır
   * (`loadFrameworkDetail`, gerekçe orada) — bu dosya yalnız taşır.
   */
  shipByDate: string | null;
  /** Serbest bırakılan partinin KLON teklifi (`/teklif/<no>` ödeme yolu). */
  quoteNumber: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  releasedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  /**
   * Müşterinin ÖDEMESİ bekleniyor mu: parti serbest bırakılmış, klon teklifi
   * var ve henüz siparişe dönmemiş.
   *
   * Kapı SUNUCUDA ölçülür; ekran "ödenebilir mi" sorusunu kendi kurallarıyla
   * yanıtlamaz. Ödeme yolu klon teklifin KENDİ sayfasıdır
   * (`/teklif/<no>/odeme`) — orada `checkoutBlockers` ve uyarı onayı aynen
   * çalışır, yani bu alan bir ödeme İZNİ değil bir GÖSTERİM kararıdır.
   */
  payable: boolean;
  lines: PresentedFrameworkBatchLine[];
  /** YALNIZ `viewer.canSeePrices` iken var. */
  amountKurus?: number;
}

export interface PresentedFramework {
  id: string;
  number: string;
  status: FrameworkStatus;
  title: string | null;
  /** Anlaşmanın türediği teklif — müşterinin kendi teklifi. */
  quoteNumber: string;
  leadTier: LeadTierKey;
  /** Anlaşmanın teslim süresi (iş günü); kademe katalogda yoksa null. */
  leadDays: number | null;
  committedUnits: number;
  /** İptal EDİLMEMİŞ parti sayısı — "Parti 3/8"in ikinci yarısı. */
  batchCount: number;
  priceLockedUntil: string;
  lockExpired: boolean;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  shippingAddress: TurkishAddress;
  createdAt: string;
  viewer: FrameworkViewer;
  parts: PresentedFrameworkPart[];
  addons: PresentedFrameworkAddon[];
  batches: PresentedFrameworkBatch[];
  progress: { total: FrameworkProgress; byPart: FrameworkPartProgress[] };
  /** parça kimliği → ekranda görünen ad; kova tablosu bunu okur. */
  partNames: Record<string, string>;
  /**
   * TEK-SEVKİYAT PROJEKSİYONU: taahhüdün TAMAMI tek siparişte sevk edilseydi
   * ödenecek tutar. `Σ batch.amountKurus` DEĞİLDİR.
   * YALNIZ `viewer.canSeePrices` iken var.
   */
  committedTotalKurus?: number;
  /**
   * İptal edilmemiş partilerin tutar toplamı. Yukarıdakinin YERİNE GEÇMEZ:
   * her parti KENDİ teklifi olduğu için `fixed` ve `per_part` ek hizmetler her
   * partide yeniden işler (`instantQuote.framework.perBatchBilling`).
   * YALNIZ `viewer.canSeePrices` iken var.
   */
  batchesTotalKurus?: number;
  /** Taahhüt toplamının KDV hariç tabanı. YALNIZ `viewer.canSeePrices`. */
  committedKdvExcludedKurus?: number;
  /** Taahhüt toplamının KDV'si. YALNIZ `viewer.canSeePrices`. */
  committedKdvKurus?: number;
  /**
   * KDV oranı YÜZDE olarak (ör. 20) — `bps` DEĞİL.
   *
   * Çevrim SUNUCUDA yapılır çünkü ekranda hiçbir bölme olmayacak (program
   * değişmezi §5; `scripts/test-quote-ui.ts` müşteri ekranlarında `/ 100`
   * arıyor). Bir oran tutar değildir ama tutarlarla birlikte anlam taşır, o
   * yüzden fiyat kapısından GEÇER: fiyatsız bir belgede "KDV (%20)" satırı
   * yazacak bir rakam da yok.
   */
  kdvRatePercent?: number;
}

export interface PresentFrameworkInput {
  detail: FrameworkDetail;
  viewer: FrameworkViewer;
  now: Date;
  /** Depolama anahtarını imzalı URL'ye çevirir (`getPublicUrl`). */
  sign: (key: string) => string;
}

export function presentFramework(input: PresentFrameworkInput): PresentedFramework {
  const { detail, viewer, now } = input;
  const canSeePrices = viewer.canSeePrices;

  const parts: PresentedFrameworkPart[] = detail.partsSnapshot.map((p) => {
    const part: PresentedFrameworkPart = {
      partId: p.partId,
      position: p.position,
      name: p.name,
      fileName: p.fileName,
      technologyName: p.technologyName,
      materialName: p.materialName,
      colorName: p.colorName,
      colorHex: p.colorHex,
      finishName: p.finishName,
      layerUm: p.layerUm,
      infillPct: p.infillPct,
      quantity: p.quantity,
      dimensionsMm: p.dimensionsMm,
      volumeCm3: p.volumeCm3,
      tessellationMm: p.tessellationMm,
      // İMZALI 3B DOSYA ADRESİ YOK: yalnız küçük resim. İmzalı bir URL
      // saatlerce geçerli bir taşıyıcı bilettir ve anlaşma belgesi paylaşılan
      // bir çıktıdır (`quote-present.ts` ile aynı duruş).
      thumbnailUrl: p.thumbnailKey ? input.sign(p.thumbnailKey) : null,
      dfmWarnings: p.dfmWarnings,
      note: p.note,
    };
    if (canSeePrices) {
      part.unitKurus = p.unitKurus;
      part.lineKurus = p.lineKurus;
    }
    return part;
  });

  const addons: PresentedFrameworkAddon[] = detail.addonsSnapshot.map((a) => {
    const addon: PresentedFrameworkAddon = { key: a.key, name: a.name };
    if (canSeePrices) addon.kurus = a.kurus;
    return addon;
  });

  const batches: PresentedFrameworkBatch[] = detail.batches.map((b) => {
    const batch: PresentedFrameworkBatch = {
      id: b.id,
      position: b.position,
      status: b.status,
      plannedShipDate: b.plannedShipDate,
      units: b.units,
      shipByDate: b.shipByDate,
      quoteNumber: b.quoteNumber,
      orderNumber: b.orderNumber,
      trackingNumber: b.trackingNumber,
      releasedAt: b.releasedAt,
      shippedAt: b.shippedAt,
      deliveredAt: b.deliveredAt,
      cancelledAt: b.cancelledAt,
      payable: b.status === "released" && b.quoteNumber !== null && b.orderId === null,
      lines: b.lines.map((l) => {
        const line: PresentedFrameworkBatchLine = {
          partId: l.partId,
          position: l.position,
          quantity: l.quantity,
        };
        if (canSeePrices) {
          line.unitKurus = l.unitKurus;
          line.lineKurus = l.lineKurus;
        }
        return line;
      }),
    };
    if (canSeePrices) batch.amountKurus = b.amountKurus;
    return batch;
  });

  const view: PresentedFramework = {
    id: detail.id,
    number: detail.number,
    status: detail.status,
    title: detail.title,
    quoteNumber: detail.quoteNumber,
    leadTier: detail.leadTier,
    leadDays: detail.leadDays,
    committedUnits: detail.committedUnits,
    batchCount: detail.batches.filter((b) => b.status !== "cancelled").length,
    priceLockedUntil: detail.priceLockedUntil,
    // Kilidin süresi TARİHE bakılarak ölçülür, bakım turunun ne zaman koştuğuna
    // bakılarak değil: `releaseBatch` de öyle ölçüyor, yani ekran ile uç aynı
    // cümleyi söyler (`instantQuote.framework.lockExpired`).
    lockExpired: new Date(detail.priceLockedUntil).getTime() < now.getTime(),
    termsVersion: detail.termsVersion,
    termsAcceptedAt: detail.termsAcceptedAt,
    shippingAddress: detail.shippingAddress,
    createdAt: detail.createdAt,
    viewer,
    parts,
    addons,
    batches,
    progress: detail.progress,
    partNames: Object.fromEntries(
      detail.partsSnapshot.map((p) => [
        p.partId,
        `P${String(p.position).padStart(2, "0")} · ${p.name}`,
      ])
    ),
  };

  if (canSeePrices) {
    view.committedTotalKurus = detail.committedTotalKurus;
    view.batchesTotalKurus = detail.batchesTotalKurus;
    // KDV HARİÇ GÖRÜNÜM SUNUCUDA: fiyatlar KDV DAHİLDİR ve hariç taban tek
    // yerde (`computeKdv`) türetilir. Ekranda bir bölme, ikinci bir vergi
    // kuralı kurmak olurdu.
    const kdv = computeKdv(detail.committedTotalKurus, KDV_RATE_BPS);
    view.committedKdvExcludedKurus = kdv.subtotalKurus;
    view.committedKdvKurus = kdv.kdvKurus;
    view.kdvRatePercent = KDV_RATE_BPS / 100;
  }

  return view;
}

/** `/account/cerceve` satırı — liste fiyat kapısını AYNI kuralla uygular. */
export interface CustomerFrameworkListItem {
  id: string;
  number: string;
  status: FrameworkStatus;
  title: string | null;
  committedUnits: number;
  priceLockedUntil: string;
  lockExpired: boolean;
  batchCount: number;
  plannedBatchCount: number;
  createdAt: string;
  /** YALNIZ `canSeePrices` iken var (liste de telden geçen bir gövdedir). */
  committedTotalKurus?: number;
}

/**
 * Admin/müşteri ortak liste satırını MÜŞTERİ gövdesine çevirir.
 *
 * `listCustomerFrameworks` servis satırı tutarı KOŞULSUZ taşıyor (admin listesi
 * de aynı işlevi kullanıyor), bu yüzden kapı burada uygulanır: fiyat kapısı
 * detay sayfasında tutuyorsa listede de tutmak zorunda — aksi hâlde aynı rakam
 * bir ekranda gizli, ötekinde açık olurdu.
 */
export function presentCustomerFrameworkList(
  items: readonly {
    id: string;
    number: string;
    status: FrameworkStatus;
    title: string | null;
    committedUnits: number;
    committedTotalKurus: number;
    priceLockedUntil: string;
    lockExpired: boolean;
    batchCount: number;
    plannedBatchCount: number;
    createdAt: string;
  }[],
  viewer: { canSeePrices: boolean }
): CustomerFrameworkListItem[] {
  return items.map((item) => {
    const row: CustomerFrameworkListItem = {
      id: item.id,
      number: item.number,
      status: item.status,
      title: item.title,
      committedUnits: item.committedUnits,
      priceLockedUntil: item.priceLockedUntil,
      lockExpired: item.lockExpired,
      batchCount: item.batchCount,
      plannedBatchCount: item.plannedBatchCount,
      createdAt: item.createdAt,
    };
    if (viewer.canSeePrices) row.committedTotalKurus = item.committedTotalKurus;
    return row;
  });
}
