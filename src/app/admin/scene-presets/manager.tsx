"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PeopleHint = "single" | "multiple" | "any";

interface ScenePresetRow {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  promptFragment: string;
  peopleHint: string;
  enabled: boolean;
  sortOrder: number;
}

const PEOPLE_HINTS: PeopleHint[] = ["single", "multiple", "any"];
const HINT_LABEL: Record<string, string> = {
  single: "Tek kişi",
  multiple: "Çok kişi",
  any: "Farketmez",
};

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20";

export function ScenePresetsManager({ initial }: { initial: ScenePresetRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [form, setForm] = useState({
    slug: "",
    label: "",
    description: "",
    promptFragment: "",
    peopleHint: "any" as PeopleHint,
    sortOrder: initial.length,
  });

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = Array.isArray(data.error)
          ? data.error[0]?.message ?? "Hata"
          : data.error ?? "Hata";
        setError(typeof msg === "string" ? msg : "Hata");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Ağ hatası");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!form.slug.trim() || !form.label.trim()) {
      setError("Slug ve etiket zorunlu");
      return;
    }
    const ok = await call("/api/admin/scene-presets", "POST", form);
    if (ok) {
      setForm({
        slug: "",
        label: "",
        description: "",
        promptFragment: "",
        peopleHint: "any",
        sortOrder: initial.length + 1,
      });
    }
  }

  return (
    <div className="mt-6 space-y-8">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Create */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Yeni sahne ekle</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Slug (sabit anahtar, a-z 0-9 _)
            </span>
            <input
              className={inputCls}
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="ornek_sahne"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Etiket (TR)</span>
            <input
              className={inputCls}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Aile"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-500">Açıklama (TR)</span>
            <input
              className={inputCls}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Fotoğraftaki herkes tek tabanda"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Prompt parçası (İngilizce — modele gönderilir)
            </span>
            <textarea
              className={`${inputCls} min-h-[72px]`}
              value={form.promptFragment}
              onChange={(e) => setForm({ ...form, promptFragment: e.target.value })}
              placeholder="Render all the people shown in the photo together on a single shared connected base."
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Kişi sayısı ipucu</span>
            <select
              className={inputCls}
              value={form.peopleHint}
              onChange={(e) =>
                setForm({ ...form, peopleHint: e.target.value as PeopleHint })
              }
            >
              {PEOPLE_HINTS.map((h) => (
                <option key={h} value={h}>
                  {HINT_LABEL[h]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Sıra</span>
            <input
              type="number"
              className={inputCls}
              value={form.sortOrder}
              onChange={(e) =>
                setForm({ ...form, sortOrder: Number(e.target.value) || 0 })
              }
            />
          </label>
        </div>
        <button
          onClick={create}
          disabled={busy}
          className="mt-4 rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          Ekle
        </button>
      </div>

      {/* List */}
      <div className="space-y-4">
        {initial.length === 0 ? (
          <p className="text-sm text-gray-400">Henüz sahne yok.</p>
        ) : (
          initial.map((row) => (
            <SceneRow key={row.id} row={row} busy={busy} call={call} />
          ))
        )}
      </div>
    </div>
  );
}

function SceneRow({
  row,
  busy,
  call,
}: {
  row: ScenePresetRow;
  busy: boolean;
  call: (url: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const [edit, setEdit] = useState({
    label: row.label,
    description: row.description ?? "",
    promptFragment: row.promptFragment,
    peopleHint: row.peopleHint as PeopleHint,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
  });

  const dirty =
    edit.label !== row.label ||
    edit.description !== (row.description ?? "") ||
    edit.promptFragment !== row.promptFragment ||
    edit.peopleHint !== row.peopleHint ||
    edit.sortOrder !== row.sortOrder ||
    edit.enabled !== row.enabled;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
          {row.slug}
        </code>
        <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
          <input
            type="checkbox"
            checked={edit.enabled}
            onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
            className="h-4 w-4 accent-green-600"
          />
          Aktif
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Etiket</span>
          <input
            className={inputCls}
            value={edit.label}
            onChange={(e) => setEdit({ ...edit, label: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Açıklama</span>
          <input
            className={inputCls}
            value={edit.description}
            onChange={(e) => setEdit({ ...edit, description: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-gray-500">
            Prompt parçası (İngilizce)
          </span>
          <textarea
            className={`${inputCls} min-h-[72px]`}
            value={edit.promptFragment}
            onChange={(e) => setEdit({ ...edit, promptFragment: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Kişi sayısı ipucu</span>
          <select
            className={inputCls}
            value={edit.peopleHint}
            onChange={(e) =>
              setEdit({ ...edit, peopleHint: e.target.value as PeopleHint })
            }
          >
            {PEOPLE_HINTS.map((h) => (
              <option key={h} value={h}>
                {HINT_LABEL[h]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Sıra</span>
          <input
            type="number"
            className={inputCls}
            value={edit.sortOrder}
            onChange={(e) =>
              setEdit({ ...edit, sortOrder: Number(e.target.value) || 0 })
            }
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => call(`/api/admin/scene-presets/${row.id}`, "PATCH", edit)}
          disabled={busy || !dirty}
          className="rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          Kaydet
        </button>
        <button
          onClick={() => {
            if (confirm(`"${row.label}" sahnesini silmek istediğinize emin misiniz?`)) {
              call(`/api/admin/scene-presets/${row.id}`, "DELETE");
            }
          }}
          disabled={busy}
          className="rounded-full border border-red-200 px-5 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          Sil
        </button>
      </div>
    </div>
  );
}
