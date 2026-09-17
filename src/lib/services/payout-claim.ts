import { assessAdjustmentGroup, type AdjustmentSourceKind } from "@/lib/config/partner-adjustments";
/**
 * ÖDEME PARTİSİ KURMANIN TEK ALGORİTMASI — "bir hakediş, tam olarak bir parti".
 *
 * ÖLÇÜLEN HATA (yarış, canlı koşuda üretildi): partnerin "Ödeme talep et"i ile
 * admin'in "Ödeme oluştur"u aynı partner için aynı anda çalıştığında İKİSİ DE
 * 200 dönüyor ve İKİ parti kuruluyordu. Sıra şuydu: iki işlem de aynı 6
 * hakedişi okuyor (READ COMMITTED, okuma kilit almaz), ikisi de kendi partisini
 * INSERT ediyor, sonra ikisi de aynı satırlara `payout_id` yazıyordu. İkinci
 * UPDATE satır kilidinde bekleyip sonra yüklemi YALNIZCA `id` üzerinden
 * denetlediği için damgayı üzerine yazıyordu: bütün satırlar ikinci partiye
 * kaçıyor, birinci parti ise "6 sipariş · ₺12.600,00" diyen ama ARKASINDA TEK
 * SATIR OLMAYAN bir hayalet parti olarak kuyrukta kalıyordu. Hayalet parti
 * "Ödendi işaretle" ile ödenebiliyordu: ₺12.600,00 ödenmiş sayılıyor, karşılık
 * gelen hakedişlerin hiçbiri kapanmıyordu.
 *
 * ÇÖZÜMÜN İKİ PARÇASI — ikisi birlikte olmazsa kusur geri gelir:
 *
 *  1) SAYIM KİLİTLİ OKUNUR. Talep edilebilir satırlar `select … for update of
 *     <hakediş tablosu>` ile okunur. İkinci işlem ilk satırda bloke olur; ilki
 *     commit edince Postgres yüklemi GÜNCEL satır üzerinde yeniden değerlendirir
 *     (EvalPlanQual), `payout_id is null` artık tutmaz ve satır kümeden DÜŞER.
 *     İkinci taraf böylece "ödenecek hak ediş yok" der — iki parti kurulamaz.
 *     Kilit `of` ile yalnız hakediş tablosuna verilir: kural siparişle sol
 *     birleşim ister ve Postgres dış birleşimin NULL üretebilen tarafını
 *     kilitlemeye izin vermez.
 *
 *  2) PARTİNİN TOPLAMI, DAMGANIN KENDİSİNDEN YAZILIR. Parti önce 0/0 açılır,
 *     damga `returning` ile geri okunur ve toplam YALNIZCA gerçekten damgalanan
 *     satırlardan hesaplanıp partiye yazılır. Böylece "saydığı ama damgalamadığı"
 *     ya da "damgaladığı ama saymadığı" bir satır fiziksel olarak mümkün
 *     değildir: parti toplamı, tanım gereği tuttuğu paradır.
 *
 * Sayım ile damga yine de ayrışırsa (kilit bir gün kaldırılırsa, ya da bu
 * modülün dışında başka bir yol damgalarsa) işlem FIRLATIR ve geri alınır:
 * yarım parti kurmaktansa hiç parti kurmamak doğrudur. Sessizce düzeltmek,
 * kusuru yine görünmez kılardı.
 *
 * SAF MODÜL: `@/lib/db` ve `server-only` İMPORT ETMEZ (worker zinciri + DB'siz
 * birim testi). Algoritma burada yaşar, SQL'i çağıran verir; scripts/test-cost-
 * lines.ts bu fonksiyonu sahte `ops` ile çağırıp yarışın her hâlini sınar.
 */

/** Partiye girecek/giren hakediş satırının parti için gereken iki alanı. */
export interface ClaimedEarning {
  id: string;
  netKurus: number;
}

/**
 * Algoritmanın DB'ye dokunan dört adımı. Hepsi ÇAĞIRANIN işlemi (transaction)
 * içinde çalışmalıdır: kilit ancak işlem sonuna kadar tutulursa iki partiyi
 * engeller.
 */
export interface PayoutClaimOps {
  /** Talep edilebilir satırları KİLİTLEYEREK okur (`for update of`). */
  lockClaimable: () => Promise<ClaimedEarning[]>;
  /** Partiyi 0/0 açar ve id'sini döner (damga için id şart: FK). */
  openBatch: () => Promise<string>;
  /** Sayılan id'leri damgalar ve GERÇEKTEN damgalanan satırları döner. */
  stamp: (payoutId: string, ids: string[]) => Promise<ClaimedEarning[]>;
  /** Partinin toplamını damgalanan satırlardan yazar. */
  writeBatchTotals: (payoutId: string, totalKurus: number, earningCount: number) => Promise<void>;
}

export interface PayoutBatch {
  payoutId: string;
  totalKurus: number;
  count: number;
}

/**
 * Sayım ile damganın ayrıştığı hâl. Fırlatılır ki işlem geri alınsın: yanlış
 * toplamlı ya da boş bir parti kuyrukta kalmasın.
 */
export class PayoutClaimRaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutClaimRaceError";
  }
}

/** Mixed earning/adjustment claims compare namespaced identities and EACH amount. */
export function verifyClaimedPayableMembers(
  expected: readonly { sourceKind: string; id: string; netKurus: number }[],
  actual: readonly { sourceKind: string; id: string; netKurus: number }[],
): void {
  const keyed = (rows: typeof expected) => new Map(rows.map(row => [`${row.sourceKind}:${row.id}`, row.netKurus]));
  const wanted = keyed(expected), found = keyed(actual);
  if (wanted.size !== expected.length || found.size !== actual.length || wanted.size !== found.size
    || [...wanted].some(([key, net]) => found.get(key) !== net)) {
    throw new PayoutClaimRaceError("Payable membership or amount changed while claiming");
  }
}

const sumKurus = (rows: readonly ClaimedEarning[]) => rows.reduce((s, e) => s + e.netKurus, 0);

/**
 * Bir partnerin talep edilebilir hakedişlerini TEK bir partiye alır.
 *
 * `null` = alınacak bir şey yok (partner ekranının "ödenecek hak ediş yok"u).
 * Hiçbir satır yokken parti AÇILMAZ: boş parti kurup sonra silmek, hayalet
 * partiyi kuralın kendisi üretmek olurdu.
 */
export async function claimEarningsIntoPayout(
  ops: PayoutClaimOps
): Promise<PayoutBatch | null> {
  const claimable = await ops.lockClaimable();
  if (claimable.length === 0) return null;

  const ids = claimable.map((e) => e.id);
  if (new Set(ids).size !== ids.length) {
    // Aynı satırı iki kez saymak toplamı şişirirdi; birleşim çoğaltmışsa
    // (ör. siparişle birden çok eşleşme) partiyi kurmadan dur.
    throw new PayoutClaimRaceError(
      "Ödeme partisi kurulamadı: aynı hak ediş sayımda birden çok kez göründü."
    );
  }

  const payoutId = await ops.openBatch();
  const stamped = await ops.stamp(payoutId, ids);

  const stampedIds = new Set(stamped.map((e) => e.id));
  if (stampedIds.size !== stamped.length) {
    throw new PayoutClaimRaceError(
      "Ödeme partisi kurulamadı: damga aynı hak edişi birden çok kez döndürdü."
    );
  }
  // Damgaladığı ama saymadığı satır: parti, toplamına girmeyen para tutuyor.
  const counted = new Set(ids);
  const extra = stamped.filter((e) => !counted.has(e.id));
  if (extra.length > 0) {
    throw new PayoutClaimRaceError(
      `Ödeme partisi kurulamadı: sayılmayan ${extra.length} hak ediş damgalandı.`
    );
  }
  // Saydığı ama damgalayamadığı satır: kilit tutmamış, satır başka bir partiye
  // kaçmış demektir. İlk hâlde tam da bu, hayalet partiyi doğuruyordu.
  if (stamped.length !== claimable.length) {
    throw new PayoutClaimRaceError(
      `Ödeme partisi kurulamadı: sayılan ${claimable.length} hak edişin ${stamped.length} tanesi damgalanabildi (eşzamanlı başka bir ödeme işlemi).`
    );
  }

  const totalKurus = sumKurus(stamped);
  await ops.writeBatchTotals(payoutId, totalKurus, stamped.length);
  return { payoutId, totalKurus, count: stamped.length };
}

/**
 * Kilit beklemesi zaman aşımına uğradı mı (Postgres 55P03 lock_not_available,
 * 40P01 deadlock_detected)?
 *
 * NEDEN GEREKLİ: partileme artık satır kilidi alıyor, yani eşzamanlı ikinci
 * istek BEKLER. Beklemeyi sınırsız bırakmak ucu askıda tutardı; sınırlı bekleme
 * ise bir HATA üretir ve bu hata, ekranın gösterebileceği Türkçe bir cümleye
 * çevrilmelidir ("birazdan tekrar deneyin") — beklenmeyen bir 500'e değil.
 *
 * drizzle 0.45 pg hatasını sarar ve gerçek kodu `.cause`a saklar; zincir bu
 * yüzden yürünür (bkz. services/order-partner-chat.ts aynı kalıp).
 */
export function isPayoutLockBusy(err: unknown): boolean {
  const BUSY = new Set(["55P03", "40P01"]);
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur; depth++) {
    if (typeof cur === "object" && cur !== null && "code" in cur) {
      const code = (cur as { code?: unknown }).code;
      if (typeof code === "string" && BUSY.has(code)) return true;
    }
    cur = (cur as { cause?: unknown })?.cause;
  }
  return false;
}

/**
 * Bir partinin ARKASINDA duran para ile partinin İDDİA ettiği para uyuşuyor mu?
 *
 * Partiyi ödenmiş işaretlemeden önce sorulur ve KAPALI tarafa düşer: uyuşmuyorsa
 * işaretleme yapılmaz. Hayalet parti (0 satır, ₺12.600,00 iddia) ödenebiliyordu;
 * "ödendi" bildirimi gidiyor, tek bir hakediş kapanmıyordu.
 */
export function payoutHoldsWhatItClaims(args: {
  statedKurus: number;
  statedCount: number;
  heldKurus: number;
  heldCount: number;
}): boolean {
  return args.statedKurus === args.heldKurus && args.statedCount === args.heldCount;
}

export interface PayableMember {
  sourceKind: AdjustmentSourceKind;
  id: string;
  orderId: string;
  netKurus: number;
  status: string;
  payoutId: string | null;
  sourceId?: string | null;
  offsetSourceKind?: AdjustmentSourceKind | null;
}

export interface PayableGroup {
  key: string;
  sourceKind: AdjustmentSourceKind;
  sourceId: string;
  orderId: string;
  members: PayableMember[];
  netKurus: number;
}

export interface BlockedPayableGroup extends Omit<PayableGroup, "netKurus"> {
  netKurus: number | null;
  reason: "batched" | "settled" | "reversed" | "missing" | "source_ineligible" | "order_cancelled" | "offset_exceeds_source" | "invalid_group";
}

export interface PayableSource extends PayableMember {
  eligible: boolean;
  ineligibleReason?: "order_cancelled";
}

export function groupPartnerPayables(sources: PayableSource[], offsets: PayableMember[], payoutId?: string) {
  const groups: PayableGroup[] = [], blockedGroups: BlockedPayableGroup[] = [];
  const sourceMap = new Map(sources.map(s => [`${s.sourceKind}:${s.id}`, s]));
  const offsetMap = new Map<string, PayableMember[]>();
  for (const offset of offsets) {
    const key = `${offset.offsetSourceKind}:${offset.sourceId}`;
    offsetMap.set(key, [...(offsetMap.get(key) ?? []), offset]);
  }
  for (const key of new Set([...sourceMap.keys(), ...offsetMap.keys()])) {
    const source = sourceMap.get(key), debits = offsetMap.get(key) ?? [];
    const members = [...(source ? [source] : []), ...debits];
    const inScope = payoutId
      ? members.some(m => m.payoutId === payoutId)
      : members.some(m => m.status === "pending" && m.payoutId === null);
    if (!inScope) continue;
    const sourceKind = source?.sourceKind ?? debits[0].offsetSourceKind!;
    const sourceId = source?.id ?? debits[0].sourceId!;
    const base = { key, sourceKind, sourceId, orderId: source?.orderId ?? debits[0].orderId, members };
    const state = !source ? "missing"
      : source.status === "paid" || source.status === "settled" ? "settled"
      : source.status !== "pending" ? "reversed"
      : source.payoutId !== (payoutId ?? null) ? "batched" : "open";
    const invalid = !!source && debits.some(d => d.orderId !== source.orderId || d.status !== "pending"
      || d.payoutId !== (payoutId ?? null) || d.netKurus >= 0);
    if (invalid) { blockedGroups.push({ ...base, netKurus: null, reason: "invalid_group" }); continue; }
    const assessment = assessAdjustmentGroup({
      sourceState: state, sourceEligible: source?.eligible ?? false,
      sourceNetKurus: source?.netKurus ?? 0, offsetNetKurus: debits.map(d => d.netKurus),
    });
    if (assessment.eligible) groups.push({ ...base, netKurus: assessment.netKurus });
    else blockedGroups.push({ ...base, netKurus: assessment.netKurus, reason: assessment.reason === "source_ineligible" ? source?.ineligibleReason ?? assessment.reason : assessment.reason });
  }
  return { groups, blockedGroups };
}
