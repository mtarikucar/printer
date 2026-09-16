export const dynamic = "force-dynamic";

import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturerAssignmentEvaluations,
  manufacturers,
  orderItems,
  orders,
} from "@/lib/db/schema";
import { getCanaryPercent, weightsVersion } from "@/lib/config/manufacturer-scoring";
import {
  classifyAutoAssignOrder,
  type AutoAssignOrderKind,
} from "@/lib/config/flags";
import { formatDateTime } from "@/lib/i18n/format";
import {
  AUTO_ASSIGN_KIND_LABELS_TR,
  DISTANCE_MODEL_LABELS_TR,
  SCORE_KEYS,
  SCORE_SHORT_LABELS_TR,
  buildOrderEvaluation,
  comparisonTitleTr,
  groupEvaluationDecisions,
  parseEvaluationSide,
  placementDivergence,
  placementLabel,
  sideVersionLabel,
  type EvaluationDecision,
  type EvaluationSide,
  type OrderEvaluation,
} from "./evaluation-view";

/**
 * Sıralama değerlendirmeleri: her KARARDA kararı veren (canlı) sıralamanın
 * yanında, aynı anda çalışan gölge sıralamaların seçimleri durur.
 *
 * Bu ekranın işi tek bir soruyu cevaplamak: bir gölge sıralamayı canlıya almak,
 * işi bugün kazanan atölyelerden alıp başkalarına verir mi? Ortakların geliri
 * buna bağlı olduğu için (ranker-rollout kararı) "farklı" kararlar süzülebiliyor.
 *
 * SATIR DEĞİL KARAR SAYILIR. Bir atama kararı tabloya birden çok satır yazar
 * (ağırlık karşılaştırması + sürekli mesafe gölgesi), çünkü bir satırda yalnız
 * iki kazanan sütunu var. Satır saymak aynı kararı iki kez sayardı ve iki ayrı
 * deneyin sonucunu tek bir orana karıştırırdı; bu yüzden satırlar önce
 * `groupEvaluationDecisions` ile kararlara bölünüyor, sayaçlar da SEÇİLİ
 * karşılaştırma üzerinden veriliyor.
 *
 * Satırlar yalnızca GERÇEK bir atama kararında yazılır (otomatik atama, ret
 * sonrası yeniden sıralama). Admin'in sipariş sayfasını açması satır yazmaz —
 * satırlar artık üst üste yazılmayıp BİRİKTİĞİ için bir sayfa görüntülemesinin
 * yazacağı satır, hiç yaşanmamış bir yerleştirme olarak gerçeklerin arasına
 * karışırdı. Aynı sebeple bir siparişin birden çok kararı yan yana durabilir;
 * aynı kararın ikinci kez yazılmış satırı ise ayrı bir karar sayılmaz
 * (evaluation-view.ts, groupEvaluationDecisions).
 */

/**
 * Taranan SATIR sayısı. Karar başına birden çok satır yazıldığı için bu sayı
 * gösterilen karar sayısının katı seçilir; yoksa pencere, görünenin yarısı
 * kadar kararı kapsardı.
 */
const WINDOW = 400;
/** Süzgeçten geçip listelenen KARAR sayısı. */
const SHOWN = 100;

function isKind(value: string | undefined): value is AutoAssignOrderKind {
  return !!value && value in AUTO_ASSIGN_KIND_LABELS_TR;
}

/** Karar + siparişin ekranda gereken künyesi. */
interface DecisionItem extends EvaluationDecision {
  orderNumber: string | null;
  kind: AutoAssignOrderKind | null;
  /** Siparişte ŞU AN duran üretici — sıralamanın kazananı olmayabilir. */
  assignedId: string | null;
  assignedName: string | null;
}

/**
 * GÖSTERİM amaçlı okuma: sonucu ekranda yalnızca GÖSTERİLİR. Arıza YUTULMAZ —
 * null döner ve null "kayıt yok" değil "BİLİNMİYOR" demektir; bayrak sayfanın
 * üstündeki şeritte yazılır.
 */
async function displayRead<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[sıralama değerlendirmeleri] ${label} okunamadı`, e);
    return null;
  }
}

/** Sayfanın üstünde duran arıza şeridi. */
function EvaluationReadNotice({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">
        Bu ekranın bazı kayıtları şu anda okunamıyor (geçici sistem arızası)
      </p>
      <p className="mt-1 text-amber-900/80">
        Aşağıdakiler gerçek kayıtlardır; ama şu bölümler BOŞ DEĞİL, BİLİNMİYOR:{" "}
        {areas.join(" · ")}. Eksik bir tabloya bakarak gölge sıralamayı canlıya
        almayın; birkaç dakika sonra sayfayı yenileyin.
      </p>
    </div>
  );
}

export default async function ScoringEvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ fark?: string; tur?: string; krs?: string }>;
}) {
  const { fark, tur, krs } = await searchParams;
  const onlyDiffer = fark === "1";
  const kindFilter = isKind(tur) ? tur : null;

  // ─── Dört JOIN ve bir EXISTS sorgudan ÇIKARILDI ──────────────────────────
  //
  // Sayfanın verisi `manufacturer_assignment_evaluations`. Atölye ADLARI (üç
  // takma adlı JOIN), siparişin künyesi ve "sepet kalemi var mı" EXISTS'i
  // yalnızca GÖSTERİM ya da etiket içindi — ama hepsi TEK ifadedeydi:
  // `manufacturers`, `orders` ya da `order_items` okunamadığında bu ekranın
  // TAMAMI 500 verirdi. Her biri artık AYRI ve KORUMALI okunur; biri bilinmiyorsa
  // tablo yine açılır, o sütun "—" olur ve şerit sebebini yazar.
  const evaluationRead = await displayRead(
    "değerlendirme kayıtları",
    db
      .select({
        id: manufacturerAssignmentEvaluations.id,
        orderId: manufacturerAssignmentEvaluations.orderId,
        createdAt: manufacturerAssignmentEvaluations.createdAt,
        weightsVersion: manufacturerAssignmentEvaluations.weightsVersion,
        authoritative: manufacturerAssignmentEvaluations.authoritative,
        v1WinnerId: manufacturerAssignmentEvaluations.v1WinnerId,
        v2WinnerId: manufacturerAssignmentEvaluations.v2WinnerId,
        v1Scores: manufacturerAssignmentEvaluations.v1Scores,
        v2Scores: manufacturerAssignmentEvaluations.v2Scores,
      })
      .from(manufacturerAssignmentEvaluations)
      .orderBy(desc(manufacturerAssignmentEvaluations.createdAt))
      .limit(WINDOW)
  );
  const evaluationRowsUnreadable = evaluationRead === null;
  const rows = evaluationRead ?? [];

  // Mesafe gölgesi satırında sütunların anlamı farklıdır (v1 = canlı seçim,
  // v2 = sürekli mesafeli meydan okuyan), okuyucuya damgayı söylemek gerekir.
  const distanceShadowVersion = weightsVersion("v3");

  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  const [orderMetaRead, cartFlagRead] = await Promise.all([
    orderIds.length
      ? displayRead(
          "sipariş künyeleri",
          db
            .select({
              id: orders.id,
              orderNumber: orders.orderNumber,
              orderType: orders.orderType,
              parentReference: orders.parentReference,
              workshopSessionId: orders.workshopSessionId,
              attributionChannel: orders.attributionChannel,
              productId: orders.productId,
              manufacturerId: orders.manufacturerId,
            })
            .from(orders)
            .where(inArray(orders.id, orderIds))
        )
      : [],
    // Sepet alt siparişini katalog siparişinden ayıran tek işaret; sınıflandırma
    // (config/flags.ts) bunu istiyor. Satır başına sorgu yerine tek tarama.
    orderIds.length
      ? displayRead(
          "sepet kalemi işareti",
          db
            .selectDistinct({ orderId: orderItems.orderId })
            .from(orderItems)
            .where(inArray(orderItems.orderId, orderIds))
        )
      : [],
  ]);
  const orderMetaUnreadable = orderMetaRead === null;
  const cartFlagUnreadable = cartFlagRead === null;
  const orderMetaById = new Map((orderMetaRead ?? []).map((o) => [o.id, o]));
  const ordersWithItems = new Set((cartFlagRead ?? []).map((r) => r.orderId));

  // ─── Atölye ADLARI: tek sorgu ────────────────────────────────────────────
  // Kazananlar, kararın YERLEŞTİĞİ atölye (sıralamanın kazananı olmayabilir:
  // geri alma sonrası dışlama, elle atama) ve siparişin BUGÜNKÜ üreticisi aynı
  // haritadan çözülür — üç takma adlı JOIN yerine tek okuma.
  const nameIds = new Set<string>();
  for (const r of rows) {
    if (r.v1WinnerId) nameIds.add(r.v1WinnerId);
    if (r.v2WinnerId) nameIds.add(r.v2WinnerId);
    for (const raw of [r.v1Scores, r.v2Scores]) {
      const placed = parseEvaluationSide(raw).placedManufacturerId;
      if (placed) nameIds.add(placed);
    }
  }
  for (const m of orderMetaById.values()) {
    if (m.manufacturerId) nameIds.add(m.manufacturerId);
  }
  const nameRead = nameIds.size
    ? await displayRead(
        "atölye adları",
        db
          .select({ id: manufacturers.id, companyName: manufacturers.companyName })
          .from(manufacturers)
          .where(inArray(manufacturers.id, [...nameIds]))
      )
    : [];
  const manufacturerNamesUnreadable = nameRead === null;
  const manufacturerNames = new Map(
    (nameRead ?? []).map((m) => [m.id, m.companyName])
  );

  // Hangi bölüm BİLİNMİYOR: şerit tablonun üstünde durur.
  const unreadableAreas = [
    evaluationRowsUnreadable &&
      "Değerlendirme kayıtlarının kendisi (tablo BOŞ görünüyor; bu \"hiç karar verilmemiş\" demek değildir)",
    orderMetaUnreadable &&
      "Siparişlerin künyesi (sipariş numarası, türü ve gerçekleşen atama sütunları bilinmiyor)",
    cartFlagUnreadable &&
      "Sepet kalemi işareti (sipariş TÜRÜ bu yüzden hiç hesaplanmadı: eksik girdiyle yapılan sınıflandırma, sepet alt siparişini katalog siparişi diye etiketlerdi)",
    manufacturerNamesUnreadable &&
      "Atölye adları (adlar yalnızca kayıttaki damgadan çözülebildiği kadar görünür)",
  ].filter((x): x is string => typeof x === "string");

  /** Sipariş künyesi satırdan bir kez okunur; karar birden çok satırdan doğar. */
  interface OrderMeta {
    orderNumber: string | null;
    kind: AutoAssignOrderKind | null;
    assignedId: string | null;
    assignedName: string | null;
  }
  const metaByOrder = new Map<string, OrderMeta>();

  const evaluations: OrderEvaluation[] = rows.map((r) => {
    if (!metaByOrder.has(r.orderId)) {
      const meta = orderMetaById.get(r.orderId);
      metaByOrder.set(r.orderId, {
        orderNumber: meta?.orderNumber ?? null,
        // Sınıflandırma İKİ okumaya dayanır (sipariş künyesi + sepet kalemi
        // işareti). Biri BİLİNMİYORSA tür de bilinmiyordur: eksik girdiyle
        // yapılan sınıflandırma sessizce yanlış etiket üretir (sepet alt
        // siparişi → katalog siparişi) ve tür süzgeci yanlış kümeyi gösterirdi.
        // Bilinmeyen tür "—" olarak kalır.
        kind:
          meta?.orderType && !cartFlagUnreadable
            ? classifyAutoAssignOrder({
                orderType: meta.orderType,
                parentReference: meta.parentReference,
                workshopSessionId: meta.workshopSessionId,
                attributionChannel: meta.attributionChannel,
                productId: meta.productId,
                hasOrderItems: ordersWithItems.has(r.orderId),
              })
            : null,
        assignedId: meta?.manufacturerId ?? null,
        assignedName: meta?.manufacturerId
          ? manufacturerNames.get(meta.manufacturerId) ?? null
          : null,
      });
    }
    // Adlar tek haritadan; çözülemeyen bir kimlik için buildOrderEvaluation
    // kayıttaki jsonb damgasına düşer (yarım ad yerine dürüst boşluk).
    const nameOf = (id: string) => manufacturerNames.get(id) ?? null;
    return buildOrderEvaluation(r, nameOf, { distanceShadowVersion });
  });

  const decisions: DecisionItem[] = groupEvaluationDecisions(evaluations).map(
    (decision) => {
      const meta = metaByOrder.get(decision.orderId);
      return {
        ...decision,
        orderNumber: meta?.orderNumber ?? null,
        kind: meta?.kind ?? null,
        assignedId: meta?.assignedId ?? null,
        assignedName: meta?.assignedName ?? null,
      };
    }
  );

  // ─── Karşılaştırmalar ────────────────────────────────────────────────────
  // Sütunlar veriden türetilir: yeni bir deney (dördüncü sürüm) eklendiğinde
  // ekran kod değişmeden onu da yan yana gösterir.
  const comparisonVersions = Array.from(
    new Set(decisions.flatMap((d) => d.comparisons.map((c) => c.weightsVersion)))
  ).sort((a, b) => a.localeCompare(b));
  const comparisonTitles = new Map<string, string>();
  for (const d of decisions) {
    for (const c of d.comparisons) {
      if (!comparisonTitles.has(c.weightsVersion)) {
        comparisonTitles.set(c.weightsVersion, comparisonTitleTr(c));
      }
    }
  }
  const titleOf = (version: string) => comparisonTitles.get(version) ?? version;

  // Sayaçların hangi deneye ait olduğu belirsiz kalamaz: seçili karşılaştırma
  // hem tabloda vurgulanır hem de oranları tanımlar. Varsayılan, bu fazın
  // deneyi olan sürekli mesafe gölgesidir.
  const selectedVersion =
    krs && comparisonVersions.includes(krs)
      ? krs
      : comparisonVersions.includes(distanceShadowVersion)
        ? distanceShadowVersion
        : (comparisonVersions[0] ?? distanceShadowVersion);

  const comparisonOf = (d: DecisionItem, version: string) =>
    d.comparisons.find((c) => c.weightsVersion === version) ?? null;

  // ─── Sayaçlar: TÜM pencere, yalnız seçili karşılaştırma ──────────────────
  // Süzgeçlenmiş dilim üzerinden hesaplanırsa "Yalnız farklı seçilenler" açıkken
  // "Aynı seçim" sıfıra düşer; oysa geçiş kararı tam da bu oranla veriliyor.
  const selectedComparisons = decisions
    .map((d) => comparisonOf(d, selectedVersion))
    .filter((c): c is OrderEvaluation => !!c);
  const windowDecisions = decisions.length;
  const scoredDecisions = selectedComparisons.length;
  const agree = selectedComparisons.filter((c) => c.agrees).length;
  const disagree = selectedComparisons.filter((c) => c.differs).length;
  const liveOnly = selectedComparisons.filter(
    (c) => c.live.winnerId && !c.shadow.winnerId
  ).length;
  const shadowOnly = selectedComparisons.filter(
    (c) => !c.live.winnerId && c.shadow.winnerId
  ).length;
  const bothPicked = agree + disagree;
  const disagreeRate =
    bothPicked > 0 ? Math.round((disagree / bothPicked) * 100) : null;
  const canaryPercent = getCanaryPercent();

  const filtered = decisions
    .filter((d) =>
      onlyDiffer ? !!comparisonOf(d, selectedVersion)?.differs : true
    )
    .filter((d) => (kindFilter ? d.kind === kindFilter : true))
    .slice(0, SHOWN);

  // Süzgeç bağlantıları: açık olan öbür süzgeçleri korur, yoksa admin her
  // tıklamada diğerini baştan kurmak zorunda kalır.
  const hrefFor = (next: {
    fark?: string | null;
    tur?: string | null;
    krs?: string | null;
  }) => {
    const params = new URLSearchParams();
    const nextFark = next.fark === undefined ? (onlyDiffer ? "1" : null) : next.fark;
    const nextTur = next.tur === undefined ? kindFilter : next.tur;
    const nextKrs = next.krs === undefined ? selectedVersion : next.krs;
    if (nextFark) params.set("fark", nextFark);
    if (nextTur) params.set("tur", nextTur);
    if (nextKrs) params.set("krs", nextKrs);
    const qs = params.toString();
    return qs ? `/admin/scoring-evaluations?${qs}` : "/admin/scoring-evaluations";
  };

  // Yalnızca pencerede GERÇEKTEN görülen türler; boş süzgeç düğmesi gösterme.
  const kindsPresent = Array.from(
    new Set(decisions.map((d) => d.kind).filter((k): k is AutoAssignOrderKind => !!k))
  );

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Sıralama değerlendirmeleri
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Her satır <strong>bir atama kararıdır</strong>: kararı veren{" "}
          <strong>canlı</strong> sıralama bir kez, onunla aynı anda çalışan
          gölge sıralamaların seçimleri de yan yana durur. Gölge sıralamayı
          canlıya almadan önce &quot;farklı&quot; kararlara bakılır: iki taraf
          farklı atölye seçiyorsa, değişiklik işi (ve geliri) başka ortaklara
          kaydıracak demektir.
        </p>
      </div>

      <EvaluationReadNotice areas={unreadableAreas} />

      {/* ─── Karşılaştırma seçimi: sayaçlar hangi deneye ait? ─────────────── */}
      {comparisonVersions.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Karşılaştırma
          </span>
          {comparisonVersions.map((v) => (
            <FilterChip
              key={v}
              href={hrefFor({ krs: v })}
              active={selectedVersion === v}
            >
              {titleOf(v)}{" "}
              <code className="ml-1 rounded bg-black/10 px-1 text-[10px]">{v}</code>
            </FilterChip>
          ))}
        </div>
      )}

      <div className="mb-2 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Penceredeki karar" value={windowDecisions} />
        <Stat label="Aynı seçim" value={agree} tone="green" />
        <Stat label="Farklı seçim" value={disagree} tone="amber" />
        <Stat label="Yalnız canlı seçti" value={liveOnly} />
        <Stat label="Yalnız gölge seçti" value={shadowOnly} />
      </div>
      <p className="mb-6 text-xs text-gray-500">
        Sayaçlar <strong>{titleOf(selectedVersion)}</strong> (
        <code className="rounded bg-gray-100 px-1">{selectedVersion}</code>)
        karşılaştırmasına aittir ve <strong>tüm pencere</strong> üzerinden
        hesaplanır — aşağıdaki süzgeçler bu sayıları değiştirmez. Penceredeki{" "}
        {windowDecisions} kararın {scoredDecisions} tanesinde bu karşılaştırma
        var
        {disagreeRate !== null
          ? `; iki tarafın da atölye seçtiği ${bothPicked} kararın %${disagreeRate}'inde gölge başka bir atölye seçti.`
          : "."}
      </p>

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        Kanarya oranı: <strong>%{canaryPercent}</strong> —{" "}
        {canaryPercent === 0
          ? "saf gölge modu, kararı her siparişte canlı profil veriyor."
          : canaryPercent === 100
            ? "tam geçiş yapıldı."
            : `siparişlerin %${canaryPercent}'inde ikinci profil karar veriyor.`}{" "}
        Oran{" "}
        <code className="rounded bg-blue-100 px-1 text-xs">
          MANUFACTURER_SCORING_V2_PERCENT
        </code>{" "}
        ile ayarlanır.
      </div>

      {/* ─── Süzgeçler ─────────────────────────────────────────────── */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Seçim
          </span>
          <FilterChip href={hrefFor({ fark: null })} active={!onlyDiffer}>
            Tümü
          </FilterChip>
          <FilterChip href={hrefFor({ fark: "1" })} active={onlyDiffer}>
            Yalnız farklı seçilenler
          </FilterChip>
          {onlyDiffer && (
            <span className="text-[11px] text-gray-500">
              ({titleOf(selectedVersion)} karşılaştırmasına göre)
            </span>
          )}
        </div>
        {kindsPresent.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Sipariş türü
            </span>
            <FilterChip href={hrefFor({ tur: null })} active={!kindFilter}>
              Tümü
            </FilterChip>
            {kindsPresent.map((k) => (
              <FilterChip
                key={k}
                href={hrefFor({ tur: k })}
                active={kindFilter === k}
              >
                {AUTO_ASSIGN_KIND_LABELS_TR[k]}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">
            {onlyDiffer || kindFilter
              ? "Bu süzgeçle eşleşen karar yok. Süzgeci kaldırıp tekrar bakın."
              : "Henüz değerlendirme yok. Kayıtlar yalnızca gerçek bir atama kararında yazılır: otomatik atama ve üretici reddi sonrası yeniden sıralama. Sipariş sayfasını açmak kayıt yazmaz."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Sipariş</th>
                <th className="px-3 py-2 text-left">Tür</th>
                <th className="px-3 py-2 text-left">Canlı seçim</th>
                {comparisonVersions.map((v) => (
                  <th
                    key={v}
                    className={`px-3 py-2 text-left ${
                      v === selectedVersion ? "bg-indigo-50 text-indigo-900" : ""
                    }`}
                  >
                    {titleOf(v)}
                    <span className="ml-1 font-normal normal-case text-gray-500">
                      {v}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2 text-left">Gerçekleşen atama</th>
                <th className="px-3 py-2 text-left">Zaman</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((d) => (
                <tr key={d.key} className="align-top hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/admin/orders/${d.orderId}`}
                      className="text-indigo-600 hover:underline"
                    >
                      {d.orderNumber ?? d.orderId.slice(0, 8)}
                    </Link>
                    <details className="mt-1 font-sans">
                      <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-gray-800">
                        Skor dökümü
                      </summary>
                      <div className="mt-2 w-[520px] max-w-[70vw] space-y-3">
                        <SideBreakdown
                          side={d.live}
                          title="Canlı sıralama (kararı veren)"
                          placedManufacturerId={d.placedManufacturerId}
                        />
                        {d.comparisons.map((c) => (
                          <SideBreakdown
                            key={c.id}
                            side={c.shadow}
                            title={`${comparisonTitleTr(c)} — ${c.weightsVersion}`}
                            placedManufacturerId={d.placedManufacturerId}
                          />
                        ))}
                      </div>
                    </details>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {d.kind ? AUTO_ASSIGN_KIND_LABELS_TR[d.kind] : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <SideCell side={d.live} />
                    {/* Aynı kararın satırları canlı kazanan konusunda
                        ayrışıyorsa, tek bir adı doğruymuş gibi göstermek
                        yanıltıcı olur. */}
                    {!d.liveConsistent && (
                      <p className="mt-0.5 text-[10px] font-medium text-amber-700">
                        satırlar arasında tutarsız
                      </p>
                    )}
                    {/* Aynı karar iki kez yazılmışsa bu, satırlar hemfikir
                        olduğunda hiçbir yerde görünmüyordu: ekran sessizce
                        birini gösterip öbürünü yutuyordu. Hata değil, veri
                        kalitesi notu — bu yüzden gri. */}
                    {d.supersededRowCount > 0 && (
                      <p
                        className="mt-0.5 text-[10px] text-gray-500"
                        title="Aynı karşılaştırma bu karar için birden çok kez kaydedilmiş; tabloda en yeni kayıt gösteriliyor."
                      >
                        {d.supersededRowCount} kayıt daha yazılmış
                      </p>
                    )}
                  </td>
                  {comparisonVersions.map((v) => {
                    const c = comparisonOf(d, v);
                    return (
                      <td
                        key={v}
                        className={`px-3 py-2 ${
                          v === selectedVersion ? "bg-indigo-50/50" : ""
                        }`}
                      >
                        {c ? (
                          <>
                            <SideCell side={c.shadow} />
                            <div className="mt-1">
                              <StatusBadge evaluation={c} />
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">kayıt yok</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {/* Kararın KENDİ damgası okunur. Siparişin bugünkü
                        üreticisine düşmek, karardan sonra yapılan bir devri bu
                        kararın sonucuymuş gibi gösteriyordu. */}
                    {(() => {
                      const placement = placementLabel(d);
                      if (placement.kind === "named") {
                        return <span>{placement.name}</span>;
                      }
                      // Kayıt bir atölye YAZMIŞ ama o atölye çözülemiyor
                      // (kaydı silinmiş olabilir). Yalnız "—" yazmak, kararın
                      // hiç yerleştirme yapmadığıyla aynı görünüyordu; bilinen
                      // kimlik yazılır, eksik olan da adıyla söylenir.
                      if (placement.kind === "unnamed") {
                        return (
                          <>
                            <span className="text-gray-500">adı çözülemedi</span>
                            <span className="mt-0.5 block text-[10px] text-gray-500">
                              Kayıtta bir atölye var ama atölye bulunamadı
                              (kaydı silinmiş olabilir). Kimlik:{" "}
                              <code className="rounded bg-gray-100 px-1">
                                {placement.shortId}…
                              </code>
                            </span>
                          </>
                        );
                      }
                      return (
                        <>
                          <span className="text-gray-500">bilinmiyor</span>
                          <span className="mt-0.5 block text-[10px] text-gray-500">
                            Bu kararın işi kime verdiği kayıtlı değil (damgadan
                            önce yazılmış kayıt).
                            {d.assignedName
                              ? ` Siparişin bugünkü üreticisi: ${d.assignedName}.`
                              : ""}
                          </span>
                        </>
                      );
                    })()}
                    {(() => {
                      // Sapma, YALNIZ kaydın kendi söylediğinden yargılanır:
                      // siparişin bugünkü üreticisine bakan eski kural, iş
                      // karardan aylar sonra elle devredildiğinde bile o eski
                      // kararı "sıralamadan farklı" diye damgalıyordu. Kayıt
                      // bilmiyorsa ekran da bilmediğini söyler.
                      const divergence = placementDivergence({
                        placedManufacturerId: d.placedManufacturerId,
                        liveWinnerId: d.live.winnerId,
                        liveWinnerName: d.live.winnerName,
                        excludedManufacturerIds: d.excludedManufacturerIds,
                      });
                      if (!divergence) return null;
                      return (
                        <span
                          className="mt-0.5 block text-[10px] font-medium text-amber-700"
                          title={
                            divergence.kind === "excluded"
                              ? `Sıralamanın birincisi (${divergence.winnerName ?? "—"}) bu yerleştirmede dışlanmıştı: iş az önce o atölyeden geri alınmıştı.`
                              : "Sebep kayıtta yok: sıralamanın birincisi bu yerleştirmede dışlanmış ya da iş elle atanmış olabilir."
                          }
                        >
                          {divergence.kind === "excluded"
                            ? "sıralamadan farklı — birinci dışlanmış"
                            : "sıralamadan farklı"}
                        </span>
                      );
                    })()}
                    {d.placedManufacturerId &&
                      d.assignedId &&
                      d.placedManufacturerId !== d.assignedId && (
                        <span className="mt-0.5 block text-[10px] text-gray-500">
                          sonradan devredildi: {d.assignedName ?? "—"}
                        </span>
                      )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {/* Konteynerler UTC'de koşuyor; admin'in geri kalanı gibi
                        İstanbul saati yazılır (config/timezone.ts). */}
                    {formatDateTime(d.createdAt, "tr")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Son {WINDOW} kayıt taranır ({windowDecisions} karar), süzgeçten geçen ilk{" "}
        {SHOWN} karar gösterilir. Şu an {filtered.length} karar listeleniyor. Bir
        atama kararı birden çok kayıt yazar (her karşılaştırma için bir tane);
        bu ekranda hepsi tek satırda toplanır.
      </p>
    </div>
  );
}

/** Karşılaştırmanın sonucu: iki taraf aynı atölyeyi mi seçti? */
function StatusBadge({ evaluation }: { evaluation: OrderEvaluation }) {
  if (evaluation.agrees) {
    return (
      <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
        aynı
      </span>
    );
  }
  if (evaluation.differs) {
    return (
      <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
        farklı
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
      tek taraf
    </span>
  );
}

/** Tablo hücresi: kazanan + o tarafı üreten sürüm damgası. */
function SideCell({ side }: { side: EvaluationSide }) {
  return (
    <div className="min-w-[140px]">
      <p className="text-gray-800">{side.winnerName ?? "—"}</p>
      <p className="mt-0.5 text-[10px] text-gray-500">
        <code className="rounded bg-gray-100 px-1">{sideVersionLabel(side)}</code>
        {side.distanceModel && (
          <> · {DISTANCE_MODEL_LABELS_TR[side.distanceModel] ?? side.distanceModel}</>
        )}
      </p>
    </div>
  );
}

/**
 * Bir tarafın skor dökümü.
 *
 * "İşi alan" rozeti KARARIN KENDİ damgasından okunur, siparişin bugünkü
 * üreticisinden değil: iş karardan sonra devredildiğinde eski rozet ("atanan"),
 * o kararın hiç seçmediği bir atölyeyi kararın sonucu gibi gösteriyor ve aynı
 * satırın "Gerçekleşen atama" hücresiyle çelişiyordu (hücre "bilinmiyor" derken
 * rozet başka bir atölyeyi işaretliyordu). Kayıt bilmiyorsa rozet de yoktur.
 */
function SideBreakdown({
  side,
  title,
  placedManufacturerId,
}: {
  side: EvaluationSide;
  title: string;
  /** Kararın işi verdiği atölye; null = kayıt bunu hiç yazmamış. */
  placedManufacturerId: string | null;
}) {
  if (side.candidates.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 p-2">
        <p className="text-xs font-semibold text-gray-700">{title}</p>
        <p className="mt-1 text-[11px] text-gray-500">
          Bu taraf için skor kaydı yok.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-200 p-2">
      <p className="text-xs font-semibold text-gray-700">
        {title}{" "}
        <code className="rounded bg-gray-100 px-1 text-[10px] font-normal">
          {sideVersionLabel(side)}
        </code>
      </p>
      <ul className="mt-2 space-y-2">
        {side.candidates.map((c, i) => {
          const isWinner = !!c.manufacturerId && c.manufacturerId === side.winnerId;
          const isPlaced =
            !!c.manufacturerId && c.manufacturerId === placedManufacturerId;
          return (
            <li
              key={c.manufacturerId ?? i}
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
                </span>
                <span className="text-xs font-bold text-gray-700">
                  {c.totalScore ?? "—"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {SCORE_KEYS.filter((k) => c.scores[k] !== undefined).map((k) => (
                  <span
                    key={k}
                    className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-gray-600 ring-1 ring-gray-200"
                  >
                    {SCORE_SHORT_LABELS_TR[k]} {c.scores[k]}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {/* Rozetin YOKLUĞU da bir iddiadır ("kimse almadı" gibi okunur): kayıt
          işi kime verdiğini yazmamışsa bu açıkça söylenir. */}
      {!placedManufacturerId && (
        <p className="mt-2 text-[10px] text-gray-500">
          Bu kararın işi hangi atölyeye verdiği kayıtlı değil; “işi alan”
          işareti gösterilemiyor.
        </p>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
        active
          ? "bg-gray-900 text-white ring-gray-900"
          : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
      }`}
    >
      {children}
    </Link>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "amber";
}) {
  const toneClass =
    tone === "green"
      ? "text-green-700 bg-green-50 border-green-200"
      : tone === "amber"
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-gray-700 bg-white border-gray-200";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-0.5 text-2xl font-bold">{value}</p>
    </div>
  );
}
