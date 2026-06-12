"use client";

import { useRef, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Button, Input, Textarea } from "@/components/ui";
import { ModelViewer } from "@/components/model-viewer";

export interface SpecFile {
  id: string;
  partName: string | null;
  fileName: string;
  sourceFormat: string;
  quantity: number;
  fileSizeBytes: number;
  glbUrl: string | null;
}
export interface SpecComponentRow {
  name: string;
  quantity: number;
  unit: string;
  notes: string;
}
export interface SpecStepRow {
  instruction: string;
  imageKey: string | null;
  imageUrl: string | null;
}

interface Props {
  /** "/api/manufacturer/products" | "/api/admin/products" */
  apiBase: string;
  productId: string;
  initialFiles: SpecFile[];
  initialComponents: SpecComponentRow[];
  initialSteps: SpecStepRow[];
  /** Called with the file count after each upload/delete (drives publish gate). */
  onFilesChange?: (count: number) => void;
}

const fmtSize = (b: number) =>
  b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

export function ProductSpecEditor({
  apiBase,
  productId,
  initialFiles,
  initialComponents,
  initialSteps,
  onFilesChange,
}: Props) {
  const d = useDictionary();
  const t = (key: string, fallback: string) =>
    (d[key as keyof typeof d] as string) || fallback;

  const fileBase = `${apiBase}/${productId}`;
  const fileRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<SpecFile[]>(initialFiles);
  const [components, setComponents] = useState<SpecComponentRow[]>(initialComponents);
  const [steps, setSteps] = useState<SpecStepRow[]>(initialSteps);

  const [partName, setPartName] = useState("");
  const [partQty, setPartQty] = useState("1");
  const [preview, setPreview] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [savingSpec, setSavingSpec] = useState(false);
  const [specMsg, setSpecMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── Print files ──────────────────────────────────────────────────────────
  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (partName.trim()) form.append("partName", partName.trim());
      form.append("quantity", String(Math.max(1, Number(partQty) || 1)));
      const res = await fetch(`${fileBase}/files`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data as { code?: string }).code;
        const messages: Record<string, string> = {
          too_large: "Dosya 50MB sınırını aşıyor.",
          unsupported_format: "Sadece .stl veya .obj dosyası yükleyebilirsiniz.",
          invalid_stl: "Dosya geçerli bir STL gibi görünmüyor (bozuk veya eksik olabilir).",
          invalid_obj: "Dosya geçerli bir OBJ gibi görünmüyor.",
          too_small: "Dosya boş veya çok küçük.",
          too_many_files: "Bir ürüne en fazla 12 baskı dosyası eklenebilir.",
        };
        setError(
          (code && messages[code]) ||
            t(
              "product.files.error",
              "Dosya yüklenemedi (STL/OBJ, ≤50MB, geçerli geometri)."
            ) + ` [HTTP ${res.status}]`
        );
        return;
      }
      const next = [...files, data.file as SpecFile];
      setFiles(next);
      onFilesChange?.(next.length);
      setPartName("");
      setPartQty("1");
    } catch {
      setError(t("product.files.error", "Dosya yüklenemedi (STL/OBJ, ≤50MB)."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const deleteFile = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`${fileBase}/files?fileId=${id}`, { method: "DELETE" });
      if (!res.ok) return;
      const next = files.filter((f) => f.id !== id);
      setFiles(next);
      onFilesChange?.(next.length);
    } catch {
      /* noop */
    }
  };

  // ─── BOM rows ─────────────────────────────────────────────────────────────
  const addComponent = () =>
    setComponents((p) => [...p, { name: "", quantity: 1, unit: "", notes: "" }]);
  const updateComponent = (i: number, patch: Partial<SpecComponentRow>) =>
    setComponents((p) => p.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeComponent = (i: number) =>
    setComponents((p) => p.filter((_, idx) => idx !== i));

  // ─── Recipe steps ─────────────────────────────────────────────────────────
  const addStep = () =>
    setSteps((p) => [...p, { instruction: "", imageKey: null, imageUrl: null }]);
  const updateStep = (i: number, patch: Partial<SpecStepRow>) =>
    setSteps((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeStep = (i: number) => setSteps((p) => p.filter((_, idx) => idx !== i));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const uploadStepImage = async (i: number, file: File) => {
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${fileBase}/step-image`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t("product.recipe.photoError", "Fotoğraf yüklenemedi (JPEG/PNG, ≤10MB)."));
        return;
      }
      updateStep(i, { imageKey: data.imageKey, imageUrl: data.url });
    } catch {
      setError(t("product.recipe.photoError", "Fotoğraf yüklenemedi."));
    }
  };

  // ─── Save BOM + recipe atomically ─────────────────────────────────────────
  const saveSpec = async () => {
    setError(null);
    setSpecMsg(null);
    setSavingSpec(true);
    try {
      const res = await fetch(`${fileBase}/spec`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          components: components
            .filter((c) => c.name.trim())
            .map((c) => ({
              name: c.name.trim(),
              quantity: Math.max(1, Number(c.quantity) || 1),
              unit: c.unit.trim() || undefined,
              notes: c.notes.trim() || undefined,
            })),
          assemblySteps: steps
            .filter((s) => s.instruction.trim())
            .map((s) => ({
              instruction: s.instruction.trim(),
              imageKey: s.imageKey || undefined,
            })),
        }),
      });
      if (!res.ok) {
        setError(t("product.spec.saveError", "Spesifikasyon kaydedilemedi."));
        return;
      }
      setSpecMsg(t("product.spec.saved", "Spesifikasyon kaydedildi."));
    } catch {
      setError(t("product.spec.saveError", "Spesifikasyon kaydedilemedi."));
    } finally {
      setSavingSpec(false);
    }
  };

  const sectionCls = "bg-white rounded-xl border border-gray-200 p-6 space-y-4";
  const headCls =
    "text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center justify-between";

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm">{error}</div>
      )}

      {/* ── Print files ── */}
      <div className={sectionCls}>
        <h2 className={headCls}>
          <span>{t("product.files.title", "Baskı dosyaları (STL/OBJ)")}</span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              files.length > 0
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {files.length > 0
              ? `${files.length} ${t("product.files.parts", "parça")}`
              : t("product.files.required", "≥1 dosya gerekli")}
          </span>
        </h2>

        {preview && (
          <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            <ModelViewer url={preview} className="h-64 w-full" />
          </div>
        )}

        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
              >
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                  {f.sourceFormat}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {f.partName || f.fileName}
                  </p>
                  <p className="text-xs text-gray-400">
                    ×{f.quantity} · {fmtSize(f.fileSizeBytes)}
                    {f.glbUrl ? "" : ` · ${t("product.files.noPreview", "önizleme yok")}`}
                  </p>
                </div>
                {f.glbUrl && (
                  <button
                    type="button"
                    onClick={() => setPreview(f.glbUrl)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {t("product.files.preview", "Önizle")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteFile(f.id)}
                  className="text-xs font-medium text-red-500 hover:text-red-700"
                >
                  {t("common.delete", "Sil")}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end pt-2 border-t border-gray-100">
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder={t("product.files.partName", "Parça adı (ör. Gövde)")}
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
            />
            <Input
              type="number"
              min={1}
              placeholder={t("product.files.qty", "Adet")}
              value={partQty}
              onChange={(e) => setPartQty(e.target.value)}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".stl,.obj,model/stl,model/obj"
            onChange={uploadFile}
            disabled={uploading}
            className="block text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
          />
        </div>
        <p className="text-xs text-gray-400">
          {t("product.files.hint", "STL veya OBJ, en fazla 50MB. Her parça için bir dosya.")}
        </p>
      </div>

      {/* ── Bill of materials ── */}
      <div className={sectionCls}>
        <h2 className={headCls}>
          <span>{t("product.bom.title", "Malzeme listesi (LED, adaptör, vida…)")}</span>
        </h2>
        {components.length > 0 && (
          <div className="space-y-2">
            {components.map((c, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-5"
                  placeholder={t("product.bom.name", "Bileşen adı")}
                  value={c.name}
                  onChange={(e) => updateComponent(i, { name: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={1}
                  placeholder={t("product.bom.qty", "Adet")}
                  value={String(c.quantity)}
                  onChange={(e) => updateComponent(i, { quantity: Number(e.target.value) || 1 })}
                />
                <Input
                  className="col-span-2"
                  placeholder={t("product.bom.unit", "Birim")}
                  value={c.unit}
                  onChange={(e) => updateComponent(i, { unit: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  placeholder={t("product.bom.notes", "Not (dahili)")}
                  value={c.notes}
                  onChange={(e) => updateComponent(i, { notes: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeComponent(i)}
                  className="col-span-1 text-red-500 hover:text-red-700 text-lg"
                  aria-label={t("common.delete", "Sil")}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <Button type="button" variant="secondary" onClick={addComponent}>
          + {t("product.bom.add", "Bileşen ekle")}
        </Button>
      </div>

      {/* ── Assembly recipe ── */}
      <div className={sectionCls}>
        <h2 className={headCls}>
          <span>{t("product.recipe.title", "Montaj reçetesi (adım adım)")}</span>
        </h2>
        {steps.length > 0 && (
          <div className="space-y-3">
            {steps.map((s, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="h-6 w-6 shrink-0 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="ml-auto flex items-center gap-1 text-gray-400">
                    <button type="button" onClick={() => moveStep(i, -1)} aria-label="up" className="hover:text-gray-700">↑</button>
                    <button type="button" onClick={() => moveStep(i, 1)} aria-label="down" className="hover:text-gray-700">↓</button>
                    <button type="button" onClick={() => removeStep(i)} aria-label={t("common.delete", "Sil")} className="text-red-500 hover:text-red-700 text-lg ml-1">×</button>
                  </div>
                </div>
                <Textarea
                  rows={2}
                  placeholder={t("product.recipe.instruction", "Talimat (ör. Gövdeyi tabana vidalayın)")}
                  value={s.instruction}
                  onChange={(e) => updateStep(i, { instruction: e.target.value })}
                />
                <div className="flex items-center gap-3">
                  {s.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={s.imageUrl} alt="" className="h-14 w-14 rounded object-cover" />
                  )}
                  <label className="text-xs font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer">
                    {s.imageUrl
                      ? t("product.recipe.changePhoto", "Fotoğrafı değiştir")
                      : t("product.recipe.addPhoto", "Fotoğraf ekle")}
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadStepImage(i, file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button type="button" variant="secondary" onClick={addStep}>
          + {t("product.recipe.add", "Adım ekle")}
        </Button>
      </div>

      <div className="flex items-center justify-end gap-3">
        {specMsg && <span className="text-sm text-emerald-600">{specMsg}</span>}
        <Button type="button" loading={savingSpec} onClick={saveSpec}>
          {t("product.spec.save", "Spesifikasyonu kaydet")}
        </Button>
      </div>
    </div>
  );
}
