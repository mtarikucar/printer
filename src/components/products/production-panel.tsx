"use client";

import { useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import { ModelViewer } from "@/components/model-viewer";

export interface PanelFile {
  id: string;
  partName: string | null;
  fileName: string;
  sourceFormat: string;
  quantity: number;
  glbUrl: string | null;
}
export interface PanelComponent {
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
}
export interface PanelStep {
  instruction: string;
  imageUrl: string | null;
}

// Read-only "how to produce this" panel for the fulfilling manufacturer:
// printable parts (download + 3D preview), the bill-of-materials, and the
// ordered assembly recipe.
export function ProductionPanel({
  orderId,
  files,
  components,
  steps,
  title,
  quantity,
}: {
  orderId: string;
  files: PanelFile[];
  components: PanelComponent[];
  steps: PanelStep[];
  /** Product name — shown as a header for multi-product (cart) sub-orders. */
  title?: string;
  quantity?: number;
}) {
  const d = useDictionary();
  const t = (key: string, fallback: string) =>
    (d[key as keyof typeof d] as string) || fallback;
  const [preview, setPreview] = useState<string | null>(
    files.find((f) => f.glbUrl)?.glbUrl ?? null
  );

  if (!files.length && !components.length && !steps.length) return null;

  return (
    <div className="rounded-2xl shadow-sm border border-gray-100 bg-white p-5 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 shrink-0">
            {t("manufacturer.production.badge", "Üretim dosyaları")}
          </span>
          {title && (
            <span className="text-sm font-semibold text-gray-900 truncate">
              {title}
            </span>
          )}
        </div>
        {quantity != null && quantity > 1 && (
          <span className="text-xs font-medium text-gray-500 shrink-0">
            × {quantity}
          </span>
        )}
      </div>

      {/* ── Printable parts ── */}
      {files.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700">
            {t("manufacturer.production.files", "Baskı dosyaları")}
          </h4>
          {preview && (
            <div className="rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
              <ModelViewer url={preview} className="h-64 w-full" />
            </div>
          )}
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
                  <p className="text-xs text-gray-400">× {f.quantity}</p>
                </div>
                {f.glbUrl && (
                  <button
                    type="button"
                    onClick={() => setPreview(f.glbUrl)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {t("manufacturer.production.preview", "Önizle")}
                  </button>
                )}
                <a
                  href={`/api/manufacturer/orders/${orderId}/product-files/${f.id}/download`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-full px-3 py-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {t("manufacturer.production.download", "İndir")}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Bill of materials (checklist) ── */}
      {components.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-700">
            {t("manufacturer.production.bom", "Malzeme listesi")}
          </h4>
          <ul className="space-y-1.5">
            {components.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-0.5 text-gray-300">☐</span>
                <span>
                  <span className="font-medium text-gray-900">{c.name}</span>
                  {" — "}
                  {c.quantity}
                  {c.unit ? ` ${c.unit}` : " adet"}
                  {c.notes && (
                    <span className="text-gray-400"> · {c.notes}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Assembly recipe ── */}
      {steps.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-700">
            {t("manufacturer.production.recipe", "Montaj reçetesi")}
          </h4>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="h-6 w-6 shrink-0 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-700 whitespace-pre-line">
                    {s.instruction}
                  </p>
                  {s.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={s.imageUrl}
                      alt=""
                      className="mt-2 h-32 w-auto rounded-lg object-cover border border-gray-100"
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
