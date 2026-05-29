"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";

const DOC_TYPES = ["vergi_levhasi", "ticaret_sicil", "imza_sirkuleri", "kimlik", "other"] as const;

interface Doc {
  id: string;
  type: string;
  status: string;
  reviewNote: string | null;
  url: string;
  createdAt: string;
}

// Manufacturer KYC documents: upload (JPEG/PNG/PDF) + see admin review status.
export function ManufacturerKyc() {
  const d = useDictionary();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [type, setType] = useState<string>("vergi_levhasi");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/manufacturer/documents");
      if (r.ok) {
        const data = await r.json();
        setDocs(data.documents || []);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file);
      const res = await fetch("/api/manufacturer/documents", { method: "POST", body: form });
      if (res.ok) await load();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const statusColor: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mt-6">
      <h2 className="text-sm font-semibold text-gray-900">
        {d["manufacturer.profile.kyc.title"]}
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-4">{d["manufacturer.profile.kyc.desc"]}</p>

      <div className="flex items-end gap-2 mb-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {d["manufacturer.profile.kyc.type"]}
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {d[`manufacturer.profile.kyc.type.${t}` as keyof typeof d]}
              </option>
            ))}
          </select>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => upload(e.target.files?.[0] || null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:bg-indigo-400"
        >
          {uploading
            ? d["manufacturer.profile.kyc.uploading"]
            : d["manufacturer.profile.kyc.upload"]}
        </button>
      </div>

      {docs.length === 0 ? (
        <p className="text-sm text-gray-400">{d["manufacturer.profile.kyc.empty"]}</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between py-2 text-sm">
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:underline"
              >
                {d[`manufacturer.profile.kyc.type.${doc.type}` as keyof typeof d] || doc.type}
              </a>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[doc.status] || ""}`}
              >
                {d[`manufacturer.profile.kyc.status.${doc.status}` as keyof typeof d]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
