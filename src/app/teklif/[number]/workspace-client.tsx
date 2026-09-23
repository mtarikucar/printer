"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type {
  PresentedCatalog,
  PresentedPart,
  PresentedQuote,
} from "@/lib/config/quote-types";
import { track } from "@/lib/analytics/client";
import { QuoteBulkBar } from "@/components/quote/bulk-bar";
import { QuoteDropzone, validateQuoteFiles, type QuoteUploadState } from "@/components/quote/dropzone";
import { fill } from "@/components/quote/format";
import { QuotePartCard } from "@/components/quote/part-card";
import { QuotePartConfigPanel } from "@/components/quote/part-config-panel";
import { QuotePartViewerModal } from "@/components/quote/part-viewer-modal";
import { PriceGateModal } from "@/components/quote/price-gate-modal";
import { QuoteHeader } from "@/components/quote/quote-header";
import { useDictionary } from "@/lib/i18n/locale-context";
import {
  QuoteApiError,
  addQuotePart,
  bulkDeleteQuoteParts,
  bulkUpdateQuoteParts,
  claimQuote,
  deleteQuotePart,
  duplicateQuotePart,
  fetchQuote,
  quoteRealtimeUrl,
  updateQuote,
  updateQuotePart,
  type PartPatch,
  type QuotePatch,
} from "@/lib/quote/client-api";
import { RealtimeProvider } from "@/lib/realtime/provider";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";
import { uploadLargeFile } from "@/lib/upload-large-file";
import { UploadError } from "@/lib/upload-with-progress";

/**
 * Teklif çalışma alanı (`/teklif/T-000123`).
 *
 * Sunucu teklifin TEK serileştirilmiş hâlini (`PresentedQuote`) prop olarak
 * verir; bu bileşen onu durumda tutar ve her mutasyondan sonra ucun döndürdüğü
 * TAZE gövdeyle değiştirir. İstemci hiçbir fiyatı kendisi hesaplamaz ve
 * hesaplayamaz: fiyat alanları kapıyı geçmemiş izleyicinin gövdesinde hiç
 * yoktur (`presentQuote`).
 *
 * Canlılık iki kanaldan gelir:
 *  - SSE (`/api/realtime/quote/<id>`) — yalnız SAHİBE açık; paylaşım
 *    bağlantısıyla gelen izleyicinin akışı yoktur (tasarım gereği).
 *  - 3 sn'lik yoklama — analizi süren parça varken, ve paylaşım görünümünde
 *    tek canlılık kaynağı olduğu için orada da. Sekme arka plandayken
 *    yoklama atlanır: kimsenin bakmadığı bir sayfa sunucuyu meşgul etmemeli.
 */

const POLL_MS = 3000;

export interface TechnologyGroup {
  key: string;
  name: string;
  parts: PresentedPart[];
}

/**
 * Parçaları teknolojiye göre gruplar (KATALOG sırası korunur; katalogda
 * olmayan bir anahtar — teknoloji pasifleştirilmiş olabilir — en sona,
 * anahtarıyla düşer, çünkü o parça da ekranda görünmek zorunda).
 */
export function groupPartsByTechnology(
  parts: PresentedPart[],
  catalog: PresentedCatalog
): TechnologyGroup[] {
  const groups = new Map<string, TechnologyGroup>();
  for (const tech of catalog.technologies) {
    groups.set(tech.key, { key: tech.key, name: tech.name, parts: [] });
  }
  for (const part of parts) {
    const key = part.config.technologyKey;
    let group = groups.get(key);
    if (!group) {
      group = { key, name: key, parts: [] };
      groups.set(key, group);
    }
    group.parts.push(part);
  }
  return [...groups.values()].filter((g) => g.parts.length > 0);
}

/**
 * 3.2b yuvası — teklif özeti (teslim kademesi, ek hizmetler, toplamlar,
 * "Ödemeye geç", manuel teklif / hedef fiyat / RFQ, not, PO).
 * TODO(Görev 3.2b): `quote-summary.tsx` bu yuvayı doldurur; kabuk düzeni
 * (sağ sütun, yapışkan) hazır.
 */
function QuoteSummarySlot(props: {
  quote: PresentedQuote;
  onQuoteChanged: (quote: PresentedQuote) => void;
  onRequestPrices: () => void;
}): JSX.Element | null {
  void props; // 3.2b bu propları kullanacak; imza şimdiden sabit.
  return null;
}

/**
 * 3.2b yuvası — bant satırı (katalog güncellendi / süre doldu / bekleyen
 * ödeme / siparişe dönüştü / incelemede) ve "Yeniden fiyatla" eylemi.
 * TODO(Görev 3.2b): bantlar buraya girer.
 */
function QuoteBannerSlot(props: {
  quote: PresentedQuote;
  onQuoteChanged: (quote: PresentedQuote) => void;
}): JSX.Element | null {
  void props;
  return null;
}

/**
 * 3.2b yuvası — başlıktaki paylaşım diyaloğu ve teklif sohbeti düğmeleri.
 * TODO(Görev 3.2b): `share-dialog.tsx` + `quote-chat-panel.tsx` buraya girer.
 */
function QuoteHeaderActionsSlot(props: {
  quote: PresentedQuote;
  onQuoteChanged: (quote: PresentedQuote) => void;
}): JSX.Element | null {
  void props;
  return null;
}

/** SSE olaylarını yeniden çekmeye çeviren görünmez dinleyici. */
function QuoteRealtimeRefresher({
  quoteId,
  onChanged,
}: {
  quoteId: string;
  onChanged: () => void;
}): null {
  useRealtimeEvent((event) => {
    if (event.kind === "quote_part" && event.quoteId === quoteId) onChanged();
    else if (event.kind === "quote" && event.quoteId === quoteId) onChanged();
  });
  return null;
}

export function QuoteWorkspaceClient({
  initialQuote,
  shareToken,
}: {
  initialQuote: PresentedQuote;
  shareToken: string | null;
}): JSX.Element {
  const d = useDictionary();
  const quoteId = initialQuote.id;

  const [quote, setQuote] = useState<PresentedQuote>(initialQuote);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<QuoteUploadState[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [gateOpen, setGateOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [viewerPartId, setViewerPartId] = useState<string | null>(null);
  const [configPartId, setConfigPartId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const { viewer, catalog } = quote;
  const canEdit = viewer.canEdit && !readOnly;
  const parts = quote.parts;

  const apply = useCallback((fresh: PresentedQuote) => {
    setQuote(fresh);
    // Silinen parça seçili kalmasın: toplu işlem çubuğu olmayan bir parçayı
    // saymaya devam ederdi.
    setSelected((prev) => prev.filter((id) => fresh.parts.some((p) => p.id === id)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await fetchQuote(quoteId, { shareToken }));
    } catch {
      // Yoklama sessizdir: geçici bir ağ hatası için ekrana kırmızı bir
      // cümle yazmak, hiçbir şey yapmamış müşteriyi telaşlandırır.
    }
  }, [apply, quoteId, shareToken]);

  /** Mutasyonların ortak kabuğu: kilit, hata cümlesi, taze gövde. */
  const run = useCallback(
    async (fn: () => Promise<PresentedQuote>) => {
      setBusy(true);
      setActionError(null);
      try {
        apply(await fn());
      } catch (e) {
        setActionError(e instanceof QuoteApiError ? e.message : d["common.error"]);
      } finally {
        setBusy(false);
      }
    },
    [apply, d]
  );

  // ─── Canlılık ─────────────────────────────────────────────────────────────

  const analysisPending = parts.some(
    (p) => p.analysisStatus === "queued" || p.analysisStatus === "analyzing"
  );
  const pollNeeded = analysisPending || viewer.isShare;

  useEffect(() => {
    if (!pollNeeded) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pollNeeded, refresh]);

  // ─── Yükleme ──────────────────────────────────────────────────────────────

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!canEdit || files.length === 0) return;
      const { accepted, errors } = validateQuoteFiles(files, {
        maxFileBytes: catalog.maxFileBytes,
        maxParts: catalog.maxPartsPerQuote,
        currentCount: parts.length + uploads.length,
        d,
      });
      setUploadErrors(errors);

      for (const file of accepted) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setUploads((prev) => [...prev, { id, fileName: file.name, progress: null }]);
        try {
          // `expectedSize`: sunucu bildirilen boyutu aşan parçayı 413 ile
          // keser — misafir yüklemelerinde kota bu bildirime dayanır.
          const staged = await uploadLargeFile(file, {
            expectedSize: true,
            onProgress: (progress) =>
              setUploads((prev) =>
                prev.map((u) => (u.id === id ? { ...u, progress } : u))
              ),
          });
          apply(
            await addQuotePart(
              quoteId,
              { uploadId: staged.uploadId, fileName: staged.fileName },
              { shareToken }
            )
          );
          track("quote_upload");
        } catch (e) {
          const message =
            e instanceof QuoteApiError || e instanceof UploadError
              ? e.message
              : fill(d["instantQuote.upload.failed"], { file: file.name });
          setUploadErrors((prev) => (prev.includes(message) ? prev : [...prev, message]));
        } finally {
          setUploads((prev) => prev.filter((u) => u.id !== id));
        }
      }
    },
    [apply, canEdit, catalog.maxFileBytes, catalog.maxPartsPerQuote, d, parts.length, quoteId, shareToken, uploads.length]
  );

  // Sayfanın HER YERİNE bırakılabilir: müşteri dosyayı tam olarak bırakma
  // alanının üstüne getirmek zorunda kalmasın. Dinleyici en son `handleFiles`i
  // bir ref'ten okur, yoksa her renderda yeniden bağlanırdı.
  const filesRef = useRef(handleFiles);
  useEffect(() => {
    filesRef.current = handleFiles;
  });

  useEffect(() => {
    if (!canEdit) return;
    let depth = 0;
    const carriesFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void filesRef.current(Array.from(e.dataTransfer?.files ?? []));
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [canEdit]);

  // ─── Eylemler ─────────────────────────────────────────────────────────────

  const patchQuote = (patch: QuotePatch) =>
    void run(() => updateQuote(quoteId, patch, { shareToken }));

  const patchPart = (partId: string, patch: PartPatch) =>
    void run(() => updateQuotePart(quoteId, partId, patch, { shareToken }));

  const removePart = (partId: string) => {
    if (typeof window !== "undefined" && !window.confirm(d["instantQuote.part.deleteConfirm"])) {
      return;
    }
    void run(() => deleteQuotePart(quoteId, partId, { shareToken }));
  };

  const allSelected = parts.length > 0 && selected.length === parts.length;
  const toggleAll = () => setSelected(allSelected ? [] : parts.map((p) => p.id));

  /**
   * Fiyat kapısından çıkış: oturum açıldıktan SONRA teklif sahiplenilir ve
   * gövde yeniden çekilir. Sahiplenme başarısızsa (teklif başka bir hesaba
   * bağlı) ekran salt okunur uyarısına düşer — sessizce eski, fiyatsız
   * görünümde kalmak müşteriye "giriş işe yaramadı" dedirtirdi.
   */
  const afterAuth = () => {
    setGateOpen(false);
    void (async () => {
      try {
        const fresh = await claimQuote(quoteId, { shareToken });
        apply(fresh);
        setReadOnly(!fresh.viewer.canSeePrices);
      } catch {
        setReadOnly(true);
      }
    })();
  };

  const groups = groupPartsByTechnology(parts, catalog);
  const viewerPart = parts.find((p) => p.id === viewerPartId) ?? null;
  const configPart = parts.find((p) => p.id === configPartId) ?? null;

  return (
    <>
      <QuoteHeader
        quote={quote}
        onPatch={patchQuote}
        actions={<QuoteHeaderActionsSlot quote={quote} onQuoteChanged={apply} />}
      />

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <QuoteBannerSlot quote={quote} onQuoteChanged={apply} />

          {readOnly && (
            <p className="rounded-xl border border-warning-500/40 bg-warning-50 px-4 py-3 text-sm text-ink-2">
              {d["instantQuote.workspace.banner.readOnly"]}
            </p>
          )}
          {actionError && (
            <p className="rounded-xl border border-error/40 bg-error-50 px-4 py-3 text-sm text-error-700">
              {actionError}
            </p>
          )}

          {canEdit && (
            <QuoteDropzone
              maxFileBytes={catalog.maxFileBytes}
              uploads={uploads}
              errors={uploadErrors}
              disabled={busy}
              onFiles={(files) => void handleFiles(files)}
            />
          )}

          {parts.length === 0 ? (
            <p className="rounded-xl border border-border-default bg-bg-surface px-4 py-8 text-center text-sm text-text-muted">
              {d["instantQuote.workspace.empty"]}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-text-secondary">
                  {fill(d["instantQuote.summary.parts"], {
                    parts: quote.partCount,
                    units: quote.unitCount,
                  })}
                </h2>
                {canEdit && (
                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-accent)]"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                    {d["instantQuote.bulk.selectAll"]}
                  </label>
                )}
              </div>

              {groups.map((group) => (
                <section key={group.key} className="space-y-3">
                  {/* Teknoloji başlığı yalnız birden fazla grup varken
                      anlamlı: tek teknolojili teklifte her karta aynı
                      etiketi asmak gürültüdür. */}
                  {groups.length > 1 && (
                    <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                      {group.name}
                    </h3>
                  )}
                  {group.parts.map((part) => (
                    <QuotePartCard
                      key={part.id}
                      quoteId={quoteId}
                      part={part}
                      catalog={catalog}
                      viewer={{ ...viewer, canEdit }}
                      selected={selected.includes(part.id)}
                      busy={busy}
                      onSelectChange={(id, on) =>
                        setSelected((prev) =>
                          on ? [...prev, id] : prev.filter((x) => x !== id)
                        )
                      }
                      onPatch={patchPart}
                      onDuplicate={(id) =>
                        void run(() => duplicateQuotePart(quoteId, id, { shareToken }))
                      }
                      onDelete={removePart}
                      onOpenViewer={setViewerPartId}
                      onEditConfig={setConfigPartId}
                      onRequestPrices={() => setGateOpen(true)}
                    />
                  ))}
                </section>
              ))}

              {canEdit && (
                <QuoteBulkBar
                  selectedIds={selected}
                  catalog={catalog}
                  busy={busy}
                  onApply={(patch) =>
                    void run(() =>
                      bulkUpdateQuoteParts(quoteId, selected, patch, { shareToken })
                    )
                  }
                  onDelete={() =>
                    void run(() => bulkDeleteQuoteParts(quoteId, selected, { shareToken }))
                  }
                  onClear={() => setSelected([])}
                />
              )}
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <QuoteSummarySlot
            quote={quote}
            onQuoteChanged={apply}
            onRequestPrices={() => setGateOpen(true)}
          />
        </aside>
      </main>

      <QuotePartViewerModal part={viewerPart} onClose={() => setViewerPartId(null)} />
      <QuotePartConfigPanel
        quoteId={quoteId}
        part={configPart}
        catalog={catalog}
        canEdit={canEdit}
        shareToken={shareToken}
        busy={busy}
        onClose={() => setConfigPartId(null)}
        onPatch={patchPart}
        onQuoteChanged={apply}
      />
      <PriceGateModal
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        onAuthenticated={afterAuth}
        redirectPath={`/teklif/${quote.number}`}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-ink/70 p-6 text-center">
          <p className="rounded-2xl border-2 border-dashed border-white/60 px-8 py-10 text-lg font-medium text-white">
            {d["instantQuote.upload.drop"]}
          </p>
        </div>
      )}

      {/* SSE yalnız sahibinde: paylaşım izleyicisi bu uçtan 404 alır ve
          tarayıcı sonsuza dek yeniden bağlanmaya çalışırdı. */}
      {viewer.isOwner && (
        <RealtimeProvider url={quoteRealtimeUrl(quoteId)}>
          <QuoteRealtimeRefresher quoteId={quoteId} onChanged={() => void refresh()} />
        </RealtimeProvider>
      )}
    </>
  );
}
