"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { APP_TIME_ZONE } from "@/lib/config/timezone";
import { PHASE5_SIGNAL_LABELS_TR, type ShadowComparison } from "@/lib/config/scoring";
import {
  SWEEP_APPLY_BATCH,
  SWEEP_KIND_LABEL_TR,
  SWEEP_MAX_APPLY,
  type SweepApplyResponse,
  type SweepApplyResult,
  type SweepCandidate,
  type SweepDryRunResponse,
  type SweepOrderBase,
  type SweepRow,
} from "./types";

/**
 * Atama taraması ekranı.
 *
 * Akış bilerek üç adımdır: TARA → SEÇ → ONAYLA. Sayfa açılışında ne tarama ne
 * atama çalışır; "Seçilenleri ata" da doğrudan atamaz, önce kimin nereye
 * gideceğini tek tek yazan bir onay kutusu açar. Bu ekranın tek işi toplu ve
 * geri alınamaz bir işlemi yapmak olduğu için, yanlışlıkla tıklamanın bedeli
 * yüksek.
 *
 * Otomatik atama anahtarı KAPALI olan türler listede kalır ama seçili gelmez ve
 * ayrı bir onay ister: anahtarı kapatmak "sistem bu türü kendiliğinden
 * dağıtmasın" demektir, "iki tıkla toplu dağıt" değil.
 */
export function AssignmentSweepClient({
  pending,
  total,
  scanLimit,
}: {
  pending: SweepOrderBase[];
  total: number;
  scanLimit: number;
}) {
  const router = useRouter();
  const d = useDictionary();
  const [rows, setRows] = useState<SweepRow[] | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  // Kapalı anahtarlı türleri de atamak için ayrı onay. Her uygulamadan sonra
  // sıfırlanır: bir kez işaretlemek kalıcı bir yetki olmamalı.
  const [ackOff, setAckOff] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SweepApplyResult[] | null>(null);
  // Sonuçlardan biri "ekran bayatladı" diyorsa (aday değişti, sipariş artık
  // uygun değil) admin'e taramayı yenilemesi söylenir.
  const [staleNotice, setStaleNotice] = useState(false);

  const scanned = rows !== null;

  // Tarama öncesi tablo da dolu görünsün: aday ve gerekçe alanları boş,
  // `profile` yalnızca taranmış satırlarda gösterilir.
  const view: SweepRow[] =
    rows ??
    pending.map((p) => ({
      ...p,
      candidate: null,
      runnerUp: null,
      block: null,
      ineligible: [],
      profile: "v1" as const,
      shadow: null,
    }));

  const assignable = view.filter((r) => r.candidate !== null);
  // Varsayılan seçim yalnızca anahtarı AÇIK türlerden kurulur.
  const autoAssignable = assignable.filter((r) => r.autoAssignEnabled);
  // "Tümünü seç"in TAM OLARAK seçtiği küme. Başlıktaki kutu bu kümeyle
  // karşılaştırılır; sayı karşılaştırması, aynı boyda ama elle kurulmuş
  // (anahtarı kapalı satır içeren) bir seçimde de işaretli görünürdü.
  const selectableRows = autoAssignable.slice(0, SWEEP_MAX_APPLY);
  const selectableIds = new Set(selectableRows.map((r) => r.orderId));
  const selectedRows = assignable.filter((r) => selectedIds.has(r.orderId));
  // Başlıktaki kutu bir şey yapabiliyor mu: ya seçilecek bir satır vardır ya da
  // temizlenecek bir seçim. İkincisi eksikti — tarama yalnızca anahtarı KAPALI
  // satırlar döndürdüğünde seçilebilir satır olmadığı için kutu devre dışı
  // kalıyordu; o satırları elle seçen operatör seçimini topluca geri alamıyor,
  // tek tek sökmek zorunda kalıyordu.
  const headerCanAct = selectableIds.size > 0 || selectedRows.length > 0;
  // İşaretli görünme kuralı: "bu kutunun toplayabileceği ne varsa seçili".
  // Seçilebilir satır hiç yokken elle kurulmuş bir seçim de bu tanımı karşılar,
  // böylece kutu DOLU görünür ve tıklamak onu TEMİZLER — işaretsiz bir kutuya
  // basınca seçimin silindiği eski hâle geri dönmeden.
  const headerChecked =
    selectedRows.length > 0 &&
    selectableRows.every((r) => selectedIds.has(r.orderId));
  // Kısmi seçim: ne hepsi ne hiçbiri. Kutu bunu ancak `indeterminate` ile
  // dürüstçe gösterebilir (React prop olarak almaz, DOM'a yazılır).
  const headerPartial = selectedRows.length > 0 && !headerChecked;
  const selectedOffRows = selectedRows.filter((r) => !r.autoAssignEnabled);
  const offBlocked = selectedOffRows.length > 0 && !ackOff;

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setConfirming(false);
    setResults(null);
    setStaleNotice(false);
    setAckOff(false);
    try {
      const res = await fetch(`/api/admin/assignment-sweep?limit=${scanLimit}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(SWEEP_REQUEST_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as
        | (SweepDryRunResponse & { error?: string })
        | null;
      if (!res.ok || !body || !Array.isArray(body.rows)) {
        setError(
          body?.error ?? "Tarama yapılamadı. Sayfayı yenileyip tekrar deneyin."
        );
        return;
      }
      setRows(body.rows);
      setScannedAt(body.scannedAt);
      // Adayı olan VE anahtarı açık siparişler seçili gelir — taramanın amacı
      // birikeni eritmek. Anahtarı kapalı olanlar bilerek dışarıda: onları
      // atamak admin'in ayrıca işaretlemesi gereken bir karar.
      setSelectedIds(
        new Set(
          body.rows
            .filter((r) => r.candidate && r.autoAssignEnabled)
            .slice(0, SWEEP_MAX_APPLY)
            .map((r) => r.orderId)
        )
      );
    } catch {
      setError("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setScanning(false);
    }
  }, [scanLimit]);

  const toggleOne = useCallback((orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  // Bilerek memolanmadı: girdisi (`selectableIds`) her render'da yeniden
  // kurulan bir küme, yani `useCallback` kimliği zaten her render'da değişirdi
  // — memo olduğunu söylemek yanlış olurdu. Kutuyu düz bir fonksiyon besliyor.
  //
  // Karar, kutunun GÖSTERDİĞİ soruyla aynı kümeden verilir (`headerChecked`):
  // dolu görünen kutu temizler, boş görünen kutu seçer. Bu, seçilebilir
  // satırların tamamı seçiliyken de, seçilebilir satır hiç olmadığı için geriye
  // yalnız elle seçilmiş (anahtarı kapalı) satırların kaldığı durumda da
  // doğrudur. Daha eski hâli seçimin BOŞ OLMAMASINA bakıyor ve işaretsiz bir
  // kutuya basıldığında seçimi temizliyordu.
  const toggleAll = () => {
    setSelectedIds(headerChecked ? new Set<string>() : new Set(selectableIds));
  };

  const applySelected = useCallback(async () => {
    const items = view
      .flatMap((r) =>
        r.candidate && selectedIds.has(r.orderId)
          ? [
              {
                orderId: r.orderId,
                orderNumber: r.orderNumber,
                manufacturerId: r.candidate.manufacturerId,
              },
            ]
          : []
      )
      .slice(0, SWEEP_MAX_APPLY);
    if (items.length === 0) return;
    // Sunucu da aynı kuralı uygular; buradaki kontrol yalnız isteği hiç
    // göndermemek için.
    if (items.some((i) => !view.find((r) => r.orderId === i.orderId)?.autoAssignEnabled) && !ackOff) {
      setError(
        "Seçimde otomatik atama anahtarı kapalı siparişler var. Onay kutusundaki ayrı onayı işaretleyin ya da o satırların seçimini kaldırın."
      );
      return;
    }

    setApplying(true);
    setError(null);
    setStaleNotice(false);
    setResults([]);
    setApplyProgress({ done: 0, total: items.length });

    // Seçim küçük gruplara bölünür: tek bir dev istek zaman aşımına uğrarsa
    // admin hangi siparişin atandığını göremezdi. Her grubun sonucu geldiği
    // anda ekrana düşer ve ORADA KALIR; bir grup yarıda kalırsa o grup "sonucu
    // bilinmiyor", sonrası "denenmedi" olarak işaretlenir — hiçbir sipariş
    // sessizce listeden düşmez.
    const collected: SweepApplyResult[] = [];
    let failed = false;
    for (let i = 0; i < items.length; i += SWEEP_APPLY_BATCH) {
      const chunk = items.slice(i, i + SWEEP_APPLY_BATCH);
      let body: SweepApplyBody | null = null;
      let ok = false;
      try {
        const res = await fetch("/api/admin/assignment-sweep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: chunk.map((c) => ({
              orderId: c.orderId,
              manufacturerId: c.manufacturerId,
            })),
            allowAutoAssignOff: ackOff,
          }),
          signal: AbortSignal.timeout(SWEEP_REQUEST_TIMEOUT_MS),
        });
        body = (await res.json().catch(() => null)) as SweepApplyBody | null;
        ok = res.ok && !!body && Array.isArray(body.results);
      } catch {
        ok = false;
      }

      if (!ok || !body) {
        failed = true;
        // YARIDA KALAN GRUP ile HİÇ DENENMEYENLER aynı şey değildir. Zaman
        // aşımına uğrayan ya da kesilen bir istek sunucuda çalışmaya devam
        // etmiş ve bu grubun bir kısmını GERÇEKTEN atamış olabilir; hepsine
        // "denenmedi" demek admin'i yanlış yönlendirir. Bu yüzden grubun
        // kendisi "sonucu bilinmiyor" (+ yeniden tarama isteği), sonrası
        // "denenmedi" olarak yazılır.
        const untried = items.slice(i + chunk.length);
        for (const r of chunk) {
          collected.push({
            orderId: r.orderId,
            orderNumber: r.orderNumber,
            ok: false,
            manufacturerName: null,
            message:
              "Sonuç bilinmiyor: istek yarıda kaldı. Bu siparişler atanmış olabilir — taramayı yenileyip durumlarına bakın.",
            rescan: true,
          });
        }
        for (const r of untried) {
          collected.push({
            orderId: r.orderId,
            orderNumber: r.orderNumber,
            ok: false,
            manufacturerName: null,
            message:
              "Denenmedi: bundan önceki grup tamamlanamadı. Taramayı yenileyip kalanları tekrar deneyin.",
          });
        }
        // Önceki grupların sonuçları EKRANDA KALIR: liste burada da yazılır,
        // döngüden sonra beklenmedik bir şey olsa bile admin ne olduğunu görür.
        setResults([...collected]);
        setError(
          `${body?.error ?? "Atama isteği tamamlanamadı."} ${chunk.length} siparişin sonucu bilinmiyor, ${untried.length} sipariş denenmedi.`
        );
        break;
      }

      collected.push(...body.results);
      setResults([...collected]);
      setApplyProgress({ done: Math.min(i + chunk.length, items.length), total: items.length });
    }

    setResults([...collected]);
    if (collected.some((r) => r.rescan)) setStaleNotice(true);
    // Atananlar artık "üretici bekliyor" değil: listeden düşerler, atlananlar
    // gerekçesiyle kalır.
    const assigned = new Set(collected.filter((r) => r.ok).map((r) => r.orderId));
    setRows(view.filter((r) => !assigned.has(r.orderId)));
    setSelectedIds(new Set());
    setConfirming(false);
    setAckOff(false);
    setApplyProgress(null);
    setApplying(false);
    if (!failed) setError(null);
    // Nav rozeti ve sayfanın sayaçları sunucudan gelir.
    router.refresh();
  }, [view, selectedIds, ackOff, router]);

  if (total === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p className="text-gray-500">Üretici bekleyen sipariş yok.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runScan}
          disabled={scanning || applying}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
        >
          {scanning
            ? "Taranıyor..."
            : scanned
              ? "Taramayı yenile"
              : "Taramayı çalıştır"}
        </button>
        <p className="text-xs text-gray-500">
          {scannedAt
            ? `Son tarama: ${new Date(scannedAt).toLocaleString("tr-TR", { timeZone: APP_TIME_ZONE })}`
            : "Tarama henüz çalışmadı. Aday ve skorlar tarama sonrası görünür."}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {staleNotice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Bazı siparişlerde ekranın verisi değişmişti (aday değişti ya da sipariş
          artık uygun değil) ve atama yapılmadı. Taramayı yenileyip yeniden
          onaylayın.
        </div>
      )}

      {applying && applyProgress && (
        <div
          role="status"
          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900"
        >
          Atanıyor: {applyProgress.done} / {applyProgress.total} sipariş
          işlendi. Bu sırada sayfadan ayrılmayın.
        </div>
      )}

      {results && results.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Atama sonucu: {results.filter((r) => r.ok).length} atandı ·{" "}
              {results.filter((r) => !r.ok).length} atlandı
            </h2>
            <button
              type="button"
              onClick={() => setResults(null)}
              className="shrink-0 text-xs font-medium text-gray-500 underline"
            >
              Kapat
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {results.map((r) => (
              <li key={r.orderId} className="flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    r.ok
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {r.ok ? "Atandı" : "Atlandı"}
                </span>
                <span className="font-mono text-xs text-gray-700">
                  {r.orderNumber ?? r.orderId.slice(0, 8)}
                </span>
                <span className="text-gray-600">{r.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirming && (
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-4">
          <h2 className="text-sm font-semibold text-blue-900">
            {selectedRows.length} sipariş atanacak. Onaylıyor musunuz?
          </h2>
          <p className="mt-1 text-xs text-blue-800">
            Her sipariş aşağıdaki üreticiye gider, üreticiye bildirim düşer ve
            24 saatlik kabul süresi başlar. Geri almak için siparişin atamasını
            tek tek geri çekmeniz gerekir.
            {selectedRows.length > SWEEP_APPLY_BATCH &&
              ` Atama ${SWEEP_APPLY_BATCH}'lik gruplar hâlinde yapılır; her grubun sonucu tek tek listelenir.`}
          </p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm">
            {selectedRows.map((r) => (
              <li key={r.orderId} className="flex flex-wrap gap-2">
                <span className="font-mono text-xs text-blue-900">
                  {r.orderNumber}
                </span>
                <span className="text-blue-900">
                  → {r.candidate?.companyName}
                </span>
                <span className="text-xs text-blue-700">
                  (skor {r.candidate?.totalScore})
                </span>
                {r.candidate?.sellerOwned && (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                    satıcının kendi ürünü
                  </span>
                )}
                {!r.autoAssignEnabled && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                    otomatik atama kapalı
                  </span>
                )}
              </li>
            ))}
          </ul>

          {selectedOffRows.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">
                Seçimde otomatik atama anahtarı KAPALI {selectedOffRows.length}{" "}
                sipariş var
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Bu türlerde sistem kendiliğinden atama yapmıyor. Yine de atamak
                elle alınmış ayrı bir karardır; onayladığınızda siparişin denetim
                kaydına &quot;anahtar kapalıyken atandı&quot; olarak düşer.
              </p>
              <label className="mt-2 flex items-start gap-2 text-xs font-medium text-amber-900">
                <input
                  type="checkbox"
                  checked={ackOff}
                  onChange={(e) => setAckOff(e.target.checked)}
                  disabled={applying}
                  className="mt-0.5 h-4 w-4"
                />
                Anahtarı kapalı türleri de ata (
                {selectedOffRows.map((r) => r.orderNumber).join(", ")})
              </label>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applySelected}
              disabled={applying || offBlocked}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
            >
              {applying ? "Atanıyor..." : "Evet, ata"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setAckOff(false);
              }}
              disabled={applying}
              className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-xl border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {scanned && selectedRows.length > 0 && !confirming && (
        <div className="flex flex-wrap items-center gap-3 bg-gray-900 text-white px-4 py-2.5 rounded-xl">
          <span className="text-sm font-medium">
            {selectedRows.length} sipariş seçildi
            {selectedOffRows.length > 0 &&
              ` (${selectedOffRows.length} tanesinin otomatik atama anahtarı kapalı)`}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={applying}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-500 transition-colors"
          >
            Seçilenleri ata
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  aria-label="Anahtarı açık tüm siparişleri seç veya seçimi temizle"
                  title="Otomatik atama anahtarı açık siparişleri seçer; seçim zaten tamamsa temizler"
                  checked={headerChecked}
                  ref={(el) => {
                    // Kısmi seçimde ne "hepsi seçili" ne "hiçbiri" doğru; üçüncü
                    // hâl yalnız DOM üzerinden gösterilebiliyor.
                    if (el) el.indeterminate = headerPartial;
                  }}
                  onChange={toggleAll}
                  disabled={!scanned || !headerCanAct || applying}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                Sipariş
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                Tür
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                Şehir
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                Bekleme
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                Aday üretici
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {view.map((row) => (
              <tr key={row.orderId} className="hover:bg-gray-50 align-top">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`${row.orderNumber} siparişini seç`}
                    checked={selectedIds.has(row.orderId)}
                    onChange={() => toggleOne(row.orderId)}
                    disabled={!row.candidate || applying}
                    className="rounded border-gray-300 disabled:opacity-40"
                  />
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/orders/${row.orderId}`}
                    className="font-mono text-sm font-medium text-indigo-600 hover:underline"
                  >
                    {row.orderNumber}
                  </Link>
                  {row.isBulk && (
                    <span
                      className="ml-2 inline-block rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-700"
                      title={`Toplu üretim — ${row.quantity} adet`}
                    >
                      Toplu · {row.quantity}
                    </span>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">
                    {row.customerName} · {formatCurrency(row.amountKurus, "tr")}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                    {SWEEP_KIND_LABEL_TR[row.kind]}
                  </span>
                  {/* Durum Türkçe sözlükten: ekranın geri kalanı Türkçeyken ham
                      enum ("approved") yazmak admin'e başka bir dil konuşur. */}
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {statusLabelTr(d, row.status)}
                  </p>
                  {!row.autoAssignEnabled && (
                    <p
                      className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                      title="Bu türün otomatik atama anahtarı kapalı: satır seçili gelmez, atamak ayrı onay ister."
                    >
                      Otomatik atama kapalı
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {row.city ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-sm font-medium ${
                      row.waitingDays >= 3 ? "text-amber-700" : "text-gray-700"
                    }`}
                  >
                    {row.waitingDays} gün
                  </span>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {formatDate(row.createdAt, "tr")}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <CandidateCell row={row} scanned={scanned} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > view.length && (
        <p className="text-xs text-gray-500">
          {total} siparişin en eski {view.length} tanesi listelendi. Bunları
          attıktan sonra taramayı yeniden çalıştırın.
        </p>
      )}
    </div>
  );
}

/** Uygulama ucunun gövdesi: sonuç listesi ya da Türkçe hata. */
type SweepApplyBody = SweepApplyResponse & { error?: string };

/**
 * İstemcinin isteği bıraktığı süre. Sunucu bütçesinin (route.ts
 * `maxDuration = 60`) biraz üstünde: önce sunucunun kendi sınırına çarpıp
 * düzgün bir cevap dönmesini isteriz. Bu olmadan asılı kalan bir istek ekranı
 * süresiz "Atanıyor..." hâlinde bırakırdı.
 */
const SWEEP_REQUEST_TIMEOUT_MS = 70_000;

/**
 * Sipariş durumunun Türkçesi — sipariş detayındaki `orderStatusLabel` ile aynı
 * sözlük anahtarı (`admin.status.<durum>`), böylece iki ekran aynı siparişe
 * aynı ismi verir. Sözlükte karşılığı olmayan bir durum ham hâliyle, alt
 * çizgileri boşluğa çevrilerek yazılır.
 */
function statusLabelTr(d: Dictionary, status: string): string {
  return (
    d[`admin.status.${status}` as keyof Dictionary] || status.replace(/_/g, " ")
  );
}

/** Adayın kendisi + neden o kazandı, ya da neden hiç aday yok. */
function CandidateCell({ row, scanned }: { row: SweepRow; scanned: boolean }) {
  if (!scanned) {
    return (
      <span className="text-xs text-gray-400">
        Tarama çalışmadı
      </span>
    );
  }

  if (row.block) {
    return (
      <div className="space-y-1">
        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
          Atanamaz
        </span>
        <p className="text-xs text-gray-700">{row.block.message}</p>
        {row.ineligible.length > 0 && (
          <ul className="text-[11px] text-gray-500 space-y-0.5">
            {row.ineligible.map((i) => (
              <li key={i.companyName}>
                {i.companyName}: {i.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (!row.candidate) return <span className="text-xs text-gray-400">—</span>;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-gray-900">
          {row.candidate.companyName}
        </span>
        {row.candidate.sellerOwned && (
          <span
            className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800"
            title="Satıcının kendi kataloğundan çıkan sipariş: yalnız kendi atölyesine atanabilir, sıralama burada karar vermez."
          >
            Satıcının kendi ürünü
          </span>
        )}
        <span className="text-lg font-bold text-blue-700">
          {row.candidate.totalScore}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">
          {row.profile}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        {row.candidate.city || "Şehir yok"}
        {row.candidate.district ? ` / ${row.candidate.district}` : ""} · Yük{" "}
        {row.candidate.currentLoad}/{row.candidate.maxConcurrentOrders}
      </p>
      {row.candidate.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.candidate.reasons.map((reason) => (
            <span
              key={reason}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700"
            >
              {reason}
            </span>
          ))}
        </div>
      )}
      <ScoreBars candidate={row.candidate} />
      {row.runnerUp && (
        <p className="text-[11px] text-gray-500">
          2. sıra: {row.runnerUp.companyName} ({row.runnerUp.totalScore})
        </p>
      )}
      <ShadowCompare shadow={row.shadow} />
    </div>
  );
}

/**
 * FAZ 5 GÖLGESİ — yeni sinyallerle yapılan sıralamanın canlıyla FARKI.
 *
 * Sahibin kararı (ranker-rollout = B): yeni sinyaller bir-iki hafta yalnız
 * ÖLÇÜLÜR. Bu blok o ölçümün tek okunabilir yüzüdür ve bilinçli olarak
 * KAPALI gelir (`details`): tarama ekranının işi hâlâ birikeni eritmek, gölge
 * karşılaştırması ise bakılmak istendiğinde açılan bir rapor.
 *
 * "Fark yok" ile "gölge hiç çalışmadı" AYRI tutulur: ikisini tek görünüşe
 * katlamak, hiç yapılmamış bir karşılaştırmayı "sinyaller bir şey değiştirmedi"
 * diye okuturdu — yani ölçüm yapılmadığı hâlde ölçüm yapıldığı sanılırdı.
 */
function ShadowCompare({ shadow }: { shadow: ShadowComparison | null }) {
  if (!shadow) {
    return (
      <p className="text-[10px] text-gray-400">
        Gölge sıralama çalışmadı (kapalı ya da hesaplanamadı).
      </p>
    );
  }
  // Konuşacak bir şeyi olan satırlar: skoru oynayan ya da uygunluğu değişen.
  const moved = shadow.deltas.filter(
    (d) => d.reasons.length > 0 || (d.delta !== null && d.delta !== 0)
  );
  return (
    <details className="mt-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5">
      <summary className="cursor-pointer text-[11px] font-semibold text-violet-900">
        {shadow.shadowWinnerId === null
          ? "⚖ Gölge sıralamada uygun aday yok"
          : shadow.differs
            ? "⚖ Gölge sıralama BAŞKA üretici seçiyor"
            : "⚖ Gölge sıralama (fark yok)"}
      </summary>
      <p className="mt-1 text-[11px] text-violet-900">{shadow.summaryTr}</p>
      {shadow.signals.length > 0 && (
        <p className="mt-1 text-[10px] text-violet-700">
          Denenen sinyaller:{" "}
          {shadow.signals
            .map((k) => PHASE5_SIGNAL_LABELS_TR[k] ?? k)
            .join(", ")}
        </p>
      )}
      {moved.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {moved.slice(0, 5).map((d) => (
            <li key={d.manufacturerId} className="text-[10px] text-violet-900">
              <span className="font-medium">{d.companyName}</span>{" "}
              <span className="font-mono">
                {d.liveScore ?? "—"} → {d.shadowScore ?? "—"}
              </span>
              {d.delta !== null && d.delta !== 0 && (
                <span
                  className={
                    d.delta > 0 ? "ml-1 text-emerald-700" : "ml-1 text-red-700"
                  }
                >
                  ({d.delta > 0 ? "+" : ""}
                  {d.delta})
                </span>
              )}
              {d.liveEligible !== d.shadowEligible && (
                <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">
                  {d.shadowEligible ? "gölgede uygun" : "gölgede eleniyor"}
                </span>
              )}
              {d.reasons.length > 0 && (
                <span className="text-violet-700"> — {d.reasons.join(", ")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[10px] text-violet-600">
        Bu karşılaştırma hiçbir atamayı değiştirmez; yalnızca kaydedilir ve
        karşılaştırılır. Sinyallerin canlıya alınması ayrı bir karardır.
      </p>
    </details>
  );
}

/** Skorun kırılımı — sipariş detayındaki aday kartıyla aynı dört sinyal. */
function ScoreBars({ candidate }: { candidate: SweepCandidate }) {
  const bars: { key: keyof SweepCandidate["scores"]; label: string }[] = [
    { key: "distance", label: "Mesafe" },
    { key: "load", label: "Yük" },
    { key: "reliability", label: "Güven" },
    { key: "compliance", label: "Uygun" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-md">
      {bars.map((bar) => (
        <div key={bar.key} className="space-y-1">
          <div className="flex justify-between text-[10px] text-gray-500">
            <span>{bar.label}</span>
            <span>{candidate.scores[bar.key]}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500"
              style={{ width: `${candidate.scores[bar.key]}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
