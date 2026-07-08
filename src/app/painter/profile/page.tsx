"use client";

import { useEffect, useState } from "react";

interface Painter {
  companyName: string;
  contactPerson: string;
  phone: string;
  whatsappPhone: string | null;
  capabilities: string[] | null;
  maxConcurrentOrders: number;
  acceptingOrders: boolean;
  status: string;
  iban: string | null;
  pendingIban: string | null;
  ibanReviewStatus: string;
  workSamplePhotoUploadedAt: string | null;
}

const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent";

export default function PainterProfilePage() {
  const [p, setP] = useState<Painter | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [iban, setIban] = useState("");

  const load = async () => {
    const res = await fetch("/api/painter/auth/me");
    if (res.ok) {
      const data = await res.json();
      setP(data.painter);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const saveProfile = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painter/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setMsg(e.error || "Kaydedilemedi");
        return;
      }
      setMsg("Kaydedildi");
      void load();
    } finally {
      setSaving(false);
    }
  };

  const submitIban = async () => {
    if (!iban.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painter/iban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iban }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || "IBAN kaydedilemedi");
        return;
      }
      setMsg("IBAN admin onayına gönderildi");
      setIban("");
      void load();
    } finally {
      setSaving(false);
    }
  };

  const uploadSample = async (file: File) => {
    setSaving(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/painter/work-sample-photo", { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setMsg(e.error || "Fotoğraf yüklenemedi");
        return;
      }
      setMsg("İş örneği fotoğrafı yüklendi");
      void load();
    } finally {
      setSaving(false);
    }
  };

  if (!p) return <div className="p-4 sm:p-8 text-gray-400 text-sm">Yükleniyor…</div>;

  return (
    <div className="p-4 sm:p-8 max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Profil</h1>
      {msg && (
        <div className="rounded-xl bg-indigo-50 text-indigo-700 px-4 py-2 text-sm">{msg}</div>
      )}

      {/* Kapasite + kabul */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Kapasite</h2>
        <label className="flex items-center justify-between text-sm">
          <span>Yeni iş kabul ediyorum</span>
          <input
            type="checkbox"
            checked={p.acceptingOrders}
            disabled={p.status !== "active" || saving}
            onChange={(e) => saveProfile({ acceptingOrders: e.target.checked })}
            className="h-5 w-5 rounded"
          />
        </label>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Aynı anda alabileceğim iş sayısı
          </label>
          <input
            type="number"
            min={1}
            max={50}
            defaultValue={p.maxConcurrentOrders}
            disabled={p.status !== "active" || saving}
            onBlur={(e) => {
              const v = parseInt(e.target.value, 10);
              if (v && v !== p.maxConcurrentOrders) saveProfile({ maxConcurrentOrders: v });
            }}
            className={inputCls}
          />
        </div>
        {p.status !== "active" && (
          <p className="text-xs text-amber-600">
            Kapasite ayarları yalnızca hesabınız onaylandıktan sonra düzenlenebilir.
          </p>
        )}
      </section>

      {/* IBAN */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Banka hesabı (IBAN)</h2>
        {p.iban && <p className="text-sm text-gray-600 font-mono">{p.iban}</p>}
        {p.ibanReviewStatus === "pending" && (
          <p className="text-xs text-amber-600">
            IBAN değişikliği admin onayında: <span className="font-mono">{p.pendingIban}</span>
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            placeholder="TR…"
            className={inputCls}
          />
          <button
            onClick={submitIban}
            disabled={saving || !iban.trim()}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            Onaya gönder
          </button>
        </div>
      </section>

      {/* İş örneği fotoğrafı */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">İş örneği fotoğrafı</h2>
        <p className="text-xs text-gray-500">
          Hesabınızın onaylanması için daha önce boyadığınız bir çalışmanın fotoğrafını yükleyin.
        </p>
        {p.workSamplePhotoUploadedAt ? (
          <p className="text-xs text-green-600">
            Yüklendi ({new Date(p.workSamplePhotoUploadedAt).toLocaleDateString("tr-TR")})
          </p>
        ) : (
          <p className="text-xs text-amber-600">Henüz yüklenmedi.</p>
        )}
        <input
          type="file"
          accept="image/*"
          disabled={saving}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadSample(f);
          }}
          className="text-sm"
        />
      </section>

      {/* Hesap bilgileri */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Hesap bilgileri</h2>
        <div className="text-sm text-gray-700">
          <div>{p.companyName}</div>
          <div className="text-gray-500">{p.contactPerson} · {p.phone}</div>
          {p.capabilities && p.capabilities.length > 0 && (
            <div className="text-gray-500 mt-1">
              Teknikler: {p.capabilities.join(", ")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
