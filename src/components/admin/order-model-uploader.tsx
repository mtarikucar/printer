"use client";

import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { uploadLargeFile } from "@/lib/upload-large-file";
import {
  uploadWithProgress,
  type UploadProgress,
  type UploadError,
} from "@/lib/upload-with-progress";
import { UploadProgressBar } from "@/components/ui/UploadProgressBar";
import {
  MAX_ORDER_MODEL_FILES,
  MODEL_HEAD_BYTES,
  ORDER_MODEL_FORMATS,
  dedupeFileNames,
  formatModelSize,
  mergeRevisionFiles,
  orderModelKindOf,
  safeModelFileName,
  verifyModelHead,
  type OrderModelKind,
  type RevisionFileLike,
} from "@/lib/config/order-model";

/**
 * Bir siparişe model DOSYALARI yükler: istenen sayıda STL ve/veya GLB, ya da
 * bunları içeren ZIP'ler. ZIP tarayıcıda açılır (fflate) ve parçalar tek tek
 * chunk'lı yüklemeyle gider; sunucu hiçbir zaman büyük bir birleşik gövde ya da
 * ZIP almaz. Son POST yalnız hazırlanmış yükleme kimliklerini taşır ve sunucu
 * ya TÜMÜNÜ kabul eder ya da hiçbirini — 13 parçanın 12'siyle yayına çıkan bir
 * sürüm olmaz.
 *
 * GLB zorunlu değil: yalnız STL (baskı dosyası) ya da yalnız GLB (önizleme)
 * geçerli bir yüklemedir.
 *
 * Yeni sürümde "Önceki sürümdeki parçaları koru" varsayılan AÇIK: 13 parçalık
 * bir işte düzeltilen 2 parçayı yüklemek kalan 11'ini üreticiden silmesin.
 * Sunucu aynı adlı parçayı yenisiyle YERİNDE değiştirir, yeni adlıları sona
 * ekler; buradaki önizleme aynı saf fonksiyonu (mergeRevisionFiles) kullanır.
 * Kutu kapatılırsa yükleme tüm seti değiştirir ve STL parça kaybedecekse
 * admin'e onaylatılır.
 *
 * Her dosyanın ilk baytları seçildiği anda sunucuyla AYNI kuralla
 * (verifyModelHead) doğrulanır: bozuk bir parça dakikalar süren toplu
 * yüklemenin SONUNDA değil, listeye girdiği anda işaretlenir ve yüklenmez.
 */

interface PickedFile {
  id: string;
  /** Görünen ad, temizlenmiş (safeModelFileName) — sunucunun kaydedeceği ad. */
  name: string;
  kind: OrderModelKind;
  blob: Blob;
  size: number;
  /** ZIP'ten geldiyse arşivin adı ve dosyanın arşivdeki klasörü. */
  from?: string;
  folder?: string;
  /** İlk baytlar türüyle uyuşmuyorsa nedeni. Böyle bir dosya YÜKLENMEZ. */
  invalid?: string;
}

/** Sunucunun yüklemeyi yakaladığı aşamada GERÇEKTEN uyguladığı yan etkiler. */
export interface OrderModelAppliedSideEffects {
  qcReset: boolean;
  qcRound: number | null;
  approvalRoundOpened: boolean;
  manufacturerAckRequired: boolean;
  painterNotified: boolean;
  customerNotified?: boolean;
}

/**
 * P2-C2: yüklemenin sonucu, SUNUCUNUN söylediği gibi. Sayfa bunu tahmin etmez —
 * yükleme anındaki aşama ile QC sıfırlamasının gerçekten olup olmadığı yalnız
 * sunucuda bilinir (sıfırlama kargo yazısıyla aynı satırda yarışır ve
 * kaybedebilir). Panel "QC sıfırlandı" derken sipariş çoktan kargolanmış
 * olabilirdi.
 */
export interface OrderModelUploadOutcome {
  revision?: number;
  fileCount?: number;
  carriedCount?: number;
  stage?: string;
  warning?: string;
  appliedSideEffects?: OrderModelAppliedSideEffects;
}

interface UploadModelResponse {
  revision?: number;
  fileCount?: number;
  /** Önceki sürümden aynen taşınan parça sayısı ("koru" açıkken). */
  carriedCount?: number;
  stage?: string;
  warning?: string;
  appliedSideEffects?: OrderModelAppliedSideEffects;
}

const KIND_BADGE: Record<OrderModelKind, string> = {
  stl: "bg-emerald-100 text-emerald-800",
  glb: "bg-indigo-100 text-indigo-800",
};

// ─── Seçim listesi ──────────────────────────────────────────────────────────
// Liste bir reducer'da tutulur: ekleme her zaman GÜNCEL listeye göre birleşir.
// Eskiden addFiles, çağrıldığı andaki `picked` kopyasına ekliyordu; büyük bir
// ZIP okunurken çıkarılan bir dosya okuma bitince geri geliyordu. Tekrar ve
// tavan bildirimleri de aynı saf adımda hesaplanır ki listeyle tutarlı kalsın.

interface ListState {
  files: PickedFile[];
  /** Aynı ad + aynı boyutla ikinci kez eklendiği için alınmayanlar. */
  duplicates: string[];
  /** SON eklemede dosya tavanı yüzünden alınmayan dosya sayısı. */
  overflow: number;
}

type ListAction =
  | { type: "add"; files: PickedFile[] }
  | { type: "remove"; id: string }
  | { type: "reset" };

const emptyList = (): ListState => ({ files: [], duplicates: [], overflow: 0 });

/** Sunucudaki tekilleştirmeyle aynı karşılaştırma: büyük/küçük harf duyarsız (tr). */
const nameKey = (name: string) => name.toLocaleLowerCase("tr");
const sameFileKey = (f: { name: string; size: number }) => `${nameKey(f.name)}|${f.size}`;

function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case "add": {
      // Aynı ZIP'i ya da dosyayı ikinci kez bırakmak parçaları ikiye
      // katlamasın: üretici 26 parça görüp kopyaları da basardı.
      const seen = new Set(state.files.map(sameFileKey));
      const files = [...state.files];
      const duplicates: string[] = [];
      let overflow = 0;
      for (const f of action.files) {
        const key = sameFileKey(f);
        if (seen.has(key)) {
          duplicates.push(f.name);
          continue;
        }
        if (files.length >= MAX_ORDER_MODEL_FILES) {
          overflow++;
          continue;
        }
        seen.add(key);
        files.push(f);
      }
      return { files, duplicates: [...state.duplicates, ...duplicates], overflow };
    }
    case "remove":
      return { ...state, files: state.files.filter((f) => f.id !== action.id), overflow: 0 };
    case "reset":
      return emptyList();
  }
}

/** verifyModelHead'in tarayıcı tarafı: yalnız ilk MODEL_HEAD_BYTES bayt okunur. */
async function headProblem(kind: OrderModelKind, blob: Blob): Promise<string | undefined> {
  try {
    const head = new Uint8Array(await blob.slice(0, MODEL_HEAD_BYTES).arrayBuffer());
    const verdict = verifyModelHead(kind, head, blob.size);
    return verdict.ok ? undefined : verdict.reason;
  } catch {
    return "Dosya okunamadı";
  }
}

function folderOf(path: string): string | undefined {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : undefined;
}

function isOrderModelKind(kind: string): kind is OrderModelKind {
  return (ORDER_MODEL_FORMATS as readonly string[]).includes(kind);
}

export function OrderModelUploader({
  orderId,
  variant,
  previousFiles,
  note,
  noteRequired,
  onUploaded,
}: {
  orderId: string;
  /** initial = sipariş model bekliyor; revision = yeni sürüm. */
  variant: "initial" | "revision";
  /**
   * Güncel sürümün parçaları (revision). "Önceki parçaları koru" önizlemesi
   * ve STL kaybı onayı bunlarla hesaplanır.
   */
  previousFiles?: { name: string; kind: string }[];
  /**
   * Sürüm notu (neden yeniden yüklendi). Sayfa toplar, yükleyici gönderir:
   * doluysa POST'a eklenir, boşsa alan hiç gönderilmez.
   */
  note?: string;
  /**
   * Bu aşamada gerekçe ZORUNLU mu (politika: üretici `accepted`'ın ötesinde).
   * Sunucu zaten reddediyor; burada da bakılır çünkü dosyalar son POST'tan ÖNCE
   * parça parça yükleniyor — notsuz bir denemede yüzlerce MB boşuna gider ve
   * admin dakikalar sonra 400 görürdü.
   */
  noteRequired?: boolean;
  /** P2-C2: sunucunun bildirdiği sonuç sayfaya AYNEN geçer. */
  onUploaded: (result?: OrderModelUploadOutcome) => void;
}) {
  const [list, dispatch] = useReducer(listReducer, undefined, emptyList);
  const files = list.files;
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState<"reading" | "uploading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [carryForward, setCarryForward] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterRemove = useRef<string | null>(null);
  const seq = useRef(0);
  const idBase = useId();

  const previous = useMemo(
    () =>
      (previousFiles ?? [])
        .filter((f) => isOrderModelKind(f.kind))
        .map((f) => ({ name: f.name, kind: f.kind as OrderModelKind })),
    [previousFiles]
  );
  const canCarry = variant === "revision" && previous.length > 0;
  const carrying = canCarry && carryForward;
  const prevStl = previous.filter((f) => f.kind === "stl").length;

  const valid = useMemo(() => files.filter((p) => !p.invalid), [files]);
  const invalidFiles = files.filter((p) => p.invalid);
  const stlCount = files.filter((p) => p.kind === "stl").length;
  const glbCount = files.length - stlCount;
  const totalBytes = files.reduce((s, p) => s + p.size, 0);

  // Sunucunun yazacağı yeni sürümün önizlemesi, route ile AYNI saf kurallarla:
  // adlar temizlenip aynı yüklemede tekilleştirilir; "koru" açıksa önceki
  // sürümle mergeRevisionFiles ile birleştirilir.
  const plan = useMemo(() => {
    const names = dedupeFileNames(valid.map((p) => p.name));
    const finalName = new Map(valid.map((p, i) => [p.id, names[i]] as const));
    const incoming: RevisionFileLike[] = valid.map((p, i) => ({
      name: names[i],
      kind: p.kind,
      key: `new:${p.id}`,
      sizeBytes: p.size,
    }));
    if (!carrying) {
      return {
        finalName,
        replacing: new Set<string>(),
        carried: 0,
        total: incoming.length,
        stlAfter: incoming.filter((f) => f.kind === "stl").length,
      };
    }
    const prev: RevisionFileLike[] = previous.map((f, i) => ({
      name: f.name,
      kind: f.kind,
      key: `old:${i}`,
      sizeBytes: null,
    }));
    const merged = mergeRevisionFiles(prev, incoming);
    const prevNames = new Set(previous.map((f) => nameKey(f.name)));
    const replacing = new Set(
      valid.filter((p) => prevNames.has(nameKey(finalName.get(p.id) ?? p.name))).map((p) => p.id)
    );
    return {
      finalName,
      replacing,
      carried: merged.filter((f) => f.key.startsWith("old:")).length,
      total: merged.length,
      stlAfter: merged.filter((f) => f.kind === "stl").length,
    };
  }, [valid, previous, carrying]);

  // "Koru" kapalıyken yeni set önceki sürümden az STL parça taşıyorsa (ya da
  // hiç taşımıyorsa) listede olmayan parçalar üreticiden kaybolur.
  const losesStl = canCarry && !carryForward && valid.length > 0 && plan.stlAfter < prevStl;
  const overLimit = plan.total > MAX_ORDER_MODEL_FILES;

  // Satır silinince odak <body>'ye düşmesin: sıradaki satırın × düğmesine,
  // liste boşaldıysa bırakma alanına geçer.
  useEffect(() => {
    const target = focusAfterRemove.current;
    if (!target) return;
    focusAfterRemove.current = null;
    if (target === "zone") zoneRef.current?.focus();
    else (removeRefs.current.get(target) ?? zoneRef.current)?.focus();
  }, [files]);

  async function addFiles(picked: File[]) {
    if (picked.length === 0 || busy) return;
    setError(null);
    setNotice(null);
    setBusy("reading");
    const add: PickedFile[] = [];
    const skip: string[] = [];
    try {
      for (const f of picked) {
        if (f.name.toLowerCase().endsWith(".zip")) {
          const { scanModelZip, zipEntryDisplayNames } = await import("@/lib/services/model-bundle");
          let scan: ReturnType<typeof scanModelZip>;
          try {
            scan = scanModelZip(new Uint8Array(await f.arrayBuffer()), ORDER_MODEL_FORMATS);
          } catch {
            skip.push(`${f.name} (ZIP açılamadı ya da bozuk)`);
            continue;
          }
          // Aynı ZIP'te aynı adı taşıyan parçalar klasörüyle ayrılır
          // ("sol-kol.stl" / "sag-kol.stl"); "kol (2).stl" üreticiye bir şey söylemez.
          const names = zipEntryDisplayNames(scan.entries);
          for (let i = 0; i < scan.entries.length; i++) {
            const e = scan.entries[i];
            const kind = orderModelKindOf(e.name);
            if (!kind) {
              skip.push(e.name);
              continue;
            }
            const blob = new Blob([e.bytes as BlobPart]);
            add.push({
              id: `f${seq.current++}`,
              name: safeModelFileName(names[i]),
              kind,
              blob,
              size: e.bytes.length,
              from: f.name,
              folder: folderOf(e.path),
              invalid: await headProblem(kind, blob),
            });
          }
          skip.push(...scan.skipped.map((n) => `${n} (${f.name} içinde)`));
        } else {
          const kind = orderModelKindOf(f.name);
          if (!kind) {
            skip.push(f.name);
            continue;
          }
          add.push({
            id: `f${seq.current++}`,
            name: safeModelFileName(f.name),
            kind,
            blob: f,
            size: f.size,
            invalid: await headProblem(kind, f),
          });
        }
      }
    } catch {
      setError("Dosyalar okunurken bir hata oldu; okunabilenler listeye eklendi.");
    } finally {
      setBusy(null);
    }

    if (add.length === 0 && skip.length > 0) setError("Seçimde STL ya da GLB dosyası bulunamadı.");
    dispatch({ type: "add", files: add });
    if (skip.length) setSkipped((cur) => [...cur, ...skip]);
  }

  function removeFile(id: string) {
    if (busy) return;
    const idx = files.findIndex((p) => p.id === id);
    const next = files[idx + 1] ?? files[idx - 1];
    focusAfterRemove.current = next ? next.id : "zone";
    dispatch({ type: "remove", id });
  }

  function clearAll() {
    if (busy) return;
    focusAfterRemove.current = "zone";
    dispatch({ type: "reset" });
    setSkipped([]);
    setError(null);
  }

  async function upload() {
    if (valid.length === 0 || busy || overLimit) return;
    const trimmedNote = (note ?? "").trim();
    if (noteRequired && !trimmedNote) {
      setError(
        "Bu aşamada model değiştirmek için gerekçe zorunlu. Sürüm notunu yazıp tekrar deneyin."
      );
      return;
    }
    if (invalidFiles.length > 0) {
      const shown = invalidFiles
        .slice(0, 5)
        .map((p) => `• ${p.name}: ${p.invalid}`)
        .join("\n");
      const more = invalidFiles.length > 5 ? `\n… ve ${invalidFiles.length - 5} dosya daha` : "";
      const ok = window.confirm(
        `${invalidFiles.length} dosya bozuk görünüyor ve YÜKLENMEYECEK:\n${shown}${more}\n\n` +
          (carrying ? "Önceki sürümde aynı adlı bir parça varsa o parça olduğu gibi kalır.\n\n" : "") +
          `Kalan ${valid.length} dosyayla devam edilsin mi?`
      );
      if (!ok) return;
    }
    if (losesStl) {
      const ok = window.confirm(
        (plan.stlAfter === 0
          ? `Yeni sürümde hiç STL olmayacak. Önceki sürümdeki ${prevStl} STL parça üreticiye görünmez olur; üretici basacak dosya bulamaz.`
          : `Yeni sürümde ${plan.stlAfter} STL parça olacak; önceki sürümde ${prevStl} vardı. Listede olmayan parçalar üreticiye görünmez olur.`) +
          "\n\nYine de yeni sürüm YALNIZ bu listedeki dosyalardan oluşsun mu?"
      );
      if (!ok) return;
    }

    setError(null);
    setNotice(null);
    setBusy("uploading");
    const controller = new AbortController();
    abortRef.current = controller;
    const toSend = valid;
    const total = toSend.reduce((s, p) => s + p.size, 0) || 1;
    let done = 0;
    const staged: { uploadId: string; name: string }[] = [];
    try {
      for (let i = 0; i < toSend.length; i++) {
        const p = toSend[i];
        setCurrent(`${i + 1}/${toSend.length} · ${p.name}`);
        const file = p.blob instanceof File ? p.blob : new File([p.blob], p.name);
        const res = await uploadLargeFile(file, {
          signal: controller.signal,
          onProgress: (pr) => {
            if (pr.phase === "processing") return;
            const loaded = done + pr.loadedBytes;
            setProgress({
              phase: "uploading",
              percent: Math.min(99, Math.round((loaded / total) * 100)),
              loadedBytes: loaded,
              totalBytes: total,
            });
          },
        });
        done += p.size;
        staged.push({ uploadId: res.uploadId, name: p.name });
      }

      setCurrent(null);
      setProgress({ phase: "processing", percent: 100, loadedBytes: total, totalBytes: total });
      const fd = new FormData();
      fd.append("files", JSON.stringify(staged));
      // Yalnız önceki bir sürüm varken anlamlı; ilk yükleme her zaman tam settir.
      if (canCarry) fd.append("carryForward", carryForward ? "1" : "0");
      // Not yalnız YAZILMIŞSA gönderilir: boş bir alan, sunucuda "gerekçe
      // yazılmamış" ile aynı şeydir ama denetim satırına boş bir not eklerdi.
      if (trimmedNote) fd.append("note", trimmedNote);
      const res = await uploadWithProgress<UploadModelResponse>(
        `/api/admin/orders/${orderId}/upload-model`,
        fd,
        { signal: controller.signal }
      );
      const carried = res?.carriedCount ?? 0;
      dispatch({ type: "reset" });
      setSkipped([]);
      setCarryForward(true);
      setNotice(
        `${res?.revision ? `Sürüm ${res.revision}` : "Model"} kaydedildi: ${toSend.length} dosya yüklendi` +
          (carried > 0 ? `, önceki sürümden ${carried} parça aynen taşındı.` : ".")
      );
      // Sayfa ne olduğunu TAHMİN etmesin: aşama ve uygulanan yan etkiler
      // sunucudan geldiği gibi geçer (P2-C2).
      onUploaded({
        revision: res?.revision,
        fileCount: res?.fileCount,
        carriedCount: res?.carriedCount,
        stage: res?.stage,
        warning: res?.warning,
        appliedSideEffects: res?.appliedSideEffects,
      });
    } catch (e) {
      const err = e as UploadError;
      // İptal admin'in kendi işi — bağıracak bir hata değil.
      if (!err?.aborted) setError(err?.message || "Yükleme başarısız oldu.");
    } finally {
      abortRef.current = null;
      setProgress(null);
      setCurrent(null);
      setBusy(null);
    }
  }

  const tone =
    variant === "initial"
      ? {
          zone: "border-indigo-300 bg-white/70 hover:border-indigo-400",
          zoneActive: "border-indigo-500 bg-indigo-50",
          button: "bg-indigo-600 hover:bg-indigo-700",
          text: "text-indigo-900",
          sub: "text-indigo-700",
        }
      : {
          zone: "border-gray-300 bg-gray-50 hover:border-gray-400",
          zoneActive: "border-indigo-500 bg-indigo-50",
          button: "bg-indigo-600 hover:bg-indigo-700",
          text: "text-gray-900",
          sub: "text-gray-600",
        };

  const uploading = busy === "uploading";
  // Okurken de, yüklerken de liste ve bırakma alanı kilitli: iki işlem aynı
  // listeyi aynı anda değiştirmesin.
  const locked = busy !== null;
  const overflowMsg =
    list.overflow > 0
      ? `Bir sürümde en fazla ${MAX_ORDER_MODEL_FILES} dosya olabilir; ${list.overflow} dosya eklenmedi.`
      : null;
  const limitMsg = overLimit
    ? `Önceki sürümden taşınacak parçalarla birlikte yeni sürüm ${plan.total} dosya olur; en fazla ${MAX_ORDER_MODEL_FILES} olabilir. Bazı dosyaları çıkarın ya da "Önceki sürümdeki parçaları koru"yu kapatın.`
    : null;
  const appended = valid.length - plan.replacing.size;

  return (
    <div className="space-y-3">
      {canCarry && (
        <div
          className={`rounded-xl border px-3 py-2.5 ${
            carryForward ? "border-indigo-200 bg-indigo-50/60" : "border-amber-300 bg-amber-50"
          }`}
        >
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={carryForward}
              onChange={(e) => setCarryForward(e.target.checked)}
              disabled={locked}
              aria-describedby={`${idBase}-carry-help`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
            />
            <span className="text-sm font-semibold text-gray-900">
              Önceki sürümdeki parçaları koru
              <span className="ml-1 font-normal text-gray-500">
                ({previous.length} dosya{prevStl > 0 ? `, ${prevStl} STL` : ""})
              </span>
            </span>
          </label>
          <p id={`${idBase}-carry-help`} className="mt-1 ml-[1.625rem] text-xs text-gray-700">
            {carryForward
              ? "Yalnız düzelttiğin ya da eklediğin parçaları yüklemen yeterli. Aynı adlı parça yenisiyle değiştirilir; listede olmayan parçalar yeni sürüme aynen taşınır."
              : "Kapalı: yeni sürüm YALNIZ bu listedeki dosyalardan oluşur. Listede olmayan parçalar yeni sürümde olmaz ve üretici onları indiremez."}
          </p>
          {losesStl && (
            <p className="mt-1.5 ml-[1.625rem] text-xs font-semibold text-amber-900">
              {plan.stlAfter === 0
                ? `Bu listeyle yeni sürümde hiç STL olmayacak; önceki sürümdeki ${prevStl} STL parça üreticiye görünmez olur.`
                : `Bu listeyle yeni sürümde ${plan.stlAfter} STL parça olacak (önceki sürümde ${prevStl}).`}
            </p>
          )}
        </div>
      )}

      <div
        ref={zoneRef}
        role="button"
        tabIndex={locked ? -1 : 0}
        aria-disabled={locked}
        aria-label="Model dosyası seç ya da buraya bırak"
        onClick={() => {
          if (!locked) inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !locked) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          // preventDefault HER ZAMAN: meşgulken bırakılan dosyayı tarayıcı
          // kendisi açmasın (süren yükleme sayfayla birlikte ölürdü).
          e.preventDefault();
          if (locked) {
            e.dataTransfer.dropEffect = "none";
            return;
          }
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          // İçteki <p>'lerin üzerinden geçerken de dragleave gelir; vurgu titremesin.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!locked) void addFiles(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${
          dragOver && !locked ? tone.zoneActive : tone.zone
        } ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        <p className={`text-sm font-semibold ${tone.text}`}>
          {busy === "reading" ? "Dosyalar okunuyor…" : "STL / GLB dosyalarını ya da ZIP'i buraya bırak"}
        </p>
        <p className={`mt-1 text-xs ${tone.sub}`}>
          ya da tıklayıp seç · birden çok dosya seçebilirsin · en fazla {MAX_ORDER_MODEL_FILES} dosya
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".stl,.glb,.zip,model/stl,model/gltf-binary,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      <p className={`text-[11px] ${tone.sub}`}>
        STL üreticinin baskı dosyasıdır, GLB önizleme içindir. İkisini birlikte, yalnız STL ya da
        yalnız GLB yükleyebilirsin.
      </p>

      {files.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
            <p className="text-xs font-medium text-gray-700">
              {files.length} dosya
              {stlCount > 0 && ` · ${stlCount} STL`}
              {glbCount > 0 && ` · ${glbCount} GLB`}
              {` · ${formatModelSize(totalBytes)}`}
              {invalidFiles.length > 0 && (
                <span className="text-red-700">{` · ${invalidFiles.length} geçersiz, yüklenmeyecek`}</span>
              )}
            </p>
            <button
              type="button"
              onClick={clearAll}
              disabled={locked}
              className="text-[11px] text-gray-500 underline hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Listeyi temizle
            </button>
          </div>
          <ul className="max-h-56 divide-y divide-gray-50 overflow-y-auto">
            {files.map((p) => {
              const shownName = plan.finalName.get(p.id) ?? p.name;
              const replaces = plan.replacing.has(p.id);
              const origin = p.from ? `${p.from}${p.folder ? ` › ${p.folder}/` : ""}` : null;
              return (
                <li
                  key={p.id}
                  className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm ${
                    p.invalid ? "bg-red-50" : ""
                  }`}
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${KIND_BADGE[p.kind]}`}
                  >
                    {p.kind}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      p.invalid ? "text-red-800 line-through decoration-red-300" : "text-gray-900"
                    }`}
                    title={shownName}
                  >
                    {shownName}
                  </span>
                  {replaces && (
                    <span
                      className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                      title="Önceki sürümdeki aynı adlı parçanın yerine geçer"
                    >
                      değiştirir
                    </span>
                  )}
                  {origin && (
                    <span
                      className="hidden max-w-[40%] truncate text-[11px] text-gray-400 sm:inline"
                      title={origin}
                    >
                      {origin}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] text-gray-500">{formatModelSize(p.size)}</span>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) removeRefs.current.set(p.id, el);
                      else removeRefs.current.delete(p.id);
                    }}
                    onClick={() => removeFile(p.id)}
                    disabled={locked}
                    aria-label={`${shownName} dosyasını çıkar`}
                    className="shrink-0 rounded px-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ×
                  </button>
                  {p.invalid && (
                    <p className="basis-full pl-9 text-[11px] text-red-700">
                      {p.invalid} — bu dosya yüklenmeyecek.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {carrying && valid.length > 0 && (
            <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
              Yeni sürüm: <strong className="text-gray-900">{plan.total} dosya</strong> ({plan.stlAfter} STL) —{" "}
              {plan.replacing.size} parça değişiyor, {plan.carried} parça önceki sürümden aynen taşınıyor
              {appended > 0 ? `, ${appended} yeni parça ekleniyor` : ""}.
            </p>
          )}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Alınmayan dosyalar (yalnız STL ve GLB yüklenir):</p>
          <p className="mt-0.5 break-words">{skipped.slice(0, 20).join(", ")}{skipped.length > 20 ? ` ve ${skipped.length - 20} dosya daha` : ""}</p>
        </div>
      )}

      {list.duplicates.length > 0 && (
        <div className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <p className="font-medium">Zaten listede olduğu için yeniden eklenmedi (aynı ad ve boyut):</p>
          <p className="mt-0.5 break-words">
            {list.duplicates.slice(0, 20).join(", ")}
            {list.duplicates.length > 20 ? ` ve ${list.duplicates.length - 20} dosya daha` : ""}
          </p>
        </div>
      )}

      {(overflowMsg || limitMsg || error) && (
        <div role="alert" className="space-y-1 text-sm text-red-600">
          {overflowMsg && <p>{overflowMsg}</p>}
          {limitMsg && <p>{limitMsg}</p>}
          {error && <p>{error}</p>}
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      <button
        type="button"
        onClick={upload}
        disabled={valid.length === 0 || locked || overLimit}
        className={`rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors disabled:bg-gray-400 ${tone.button}`}
      >
        {uploading
          ? "Yükleniyor…"
          : variant === "initial"
            ? `Modeli yükle${valid.length ? ` (${valid.length} dosya)` : ""}`
            : `Yeni sürüm olarak yükle${valid.length ? ` (${valid.length} dosya)` : ""}`}
      </button>

      {progress && (
        <div>
          <p aria-live="polite" className="mb-1 truncate text-xs text-gray-600">
            {current ?? ""}
          </p>
          <UploadProgressBar
            progress={progress}
            processingLabel="Dosyalar doğrulanıp kaydediliyor…"
            onCancel={() => abortRef.current?.abort()}
          />
        </div>
      )}
    </div>
  );
}
