"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormField, Input, Select, Textarea } from "@/components/ui";
import {
  WORKSHOP_FIGURE_PRICE_KURUS,
  WORKSHOP_SESSION_STATUS_LABELS,
  assessSessionRisk,
} from "@/lib/config/workshop";

interface VenueAddress {
  adres: string;
  mahalle?: string;
  ilce: string;
  il: string;
  postaKodu: string;
  telefon: string;
}

interface VenueData {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: VenueAddress;
  status: string;
  notes: string | null;
  createdAt: string;
}

interface SessionRow {
  id: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  bookedCount: number;
  pricePerSeatKurus: number;
  manufacturerName: string | null;
  status: string;
  joinUrl: string;
}

interface ManufacturerOption {
  id: string;
  companyName: string;
  city: string | null;
  maxConcurrentOrders: number;
  currentLoad: number;
  acceptingOrders: boolean;
  avgPrintDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const VENUE_STATUS_BADGE: Record<string, { label: string; badge: string }> = {
  active: { label: "Aktif", badge: "bg-green-100 text-green-700" },
  paused: { label: "Duraklatıldı", badge: "bg-amber-100 text-amber-700" },
  archived: { label: "Arşivlendi", badge: "bg-gray-200 text-gray-600" },
};

// Renk konvansiyonu diğer admin ekranlarındaki pill deseniyle aynı
// (bg-*-100 text-*-700, rounded-full). Sekiz seans durumunun her biri için
// ayrı bir renk — akışın neresinde olduğu bir bakışta anlaşılsın diye.
const SESSION_STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  open: "bg-green-100 text-green-700",
  closed: "bg-amber-100 text-amber-700",
  in_production: "bg-blue-100 text-blue-700",
  shipped: "bg-indigo-100 text-indigo-700",
  delivered: "bg-teal-100 text-teal-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-gray-200 text-gray-600",
};

const RISK_BANNER: Record<"ok" | "warn" | "danger", string> = {
  ok: "bg-green-50 text-green-800 border border-green-200",
  warn: "bg-amber-50 text-amber-800 border border-amber-200",
  danger: "bg-red-50 text-red-800 border border-red-200",
};

function sessionStatusLabel(status: string): string {
  return (
    (WORKSHOP_SESSION_STATUS_LABELS as Record<string, string>)[status] ?? status
  );
}

function formatKurus(kurus: number): string {
  return `₺${(kurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function VenueClient({
  venue,
  sessions,
  manufacturers,
}: {
  venue: VenueData;
  sessions: SessionRow[];
  manufacturers: ManufacturerOption[];
}) {
  const router = useRouter();
  const statusMeta =
    VENUE_STATUS_BADGE[venue.status] ??
    ({ label: venue.status, badge: "bg-gray-100 text-gray-700" } as const);

  // ─── "Seans aç" formu ───────────────────────────────────────────────────
  const [startsAt, setStartsAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("120");
  const [capacity, setCapacity] = useState("20");
  const [priceTl, setPriceTl] = useState(String(WORKSHOP_FIGURE_PRICE_KURUS / 100));
  const [manufacturerId, setManufacturerId] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Risk uyarısı: girdiler (tarih + üretici) değiştikçe TARAYICIDA yeniden
  // hesaplanır. assessSessionRisk saf ve DB'siz olduğu için (config/workshop.ts)
  // burada doğrudan çağrılabilir; workshop-session.ts'ten değer importu
  // @/lib/db'yi bundle'a sokup build'i kırardı.
  const risk = useMemo(() => {
    if (!manufacturerId || !startsAt) return null;
    const mfg = manufacturers.find((m) => m.id === manufacturerId);
    if (!mfg) return null;
    const startMs = new Date(startsAt).getTime();
    if (Number.isNaN(startMs)) return null;
    const daysUntilSession = Math.round(((startMs - Date.now()) / DAY_MS) * 10) / 10;
    return assessSessionRisk({
      daysUntilSession,
      avgPrintDays: mfg.avgPrintDays,
      currentLoad: mfg.currentLoad,
      maxConcurrentOrders: mfg.maxConcurrentOrders,
    });
  }, [manufacturerId, startsAt, manufacturers]);

  const submitSession = async () => {
    setFormError(null);
    if (!startsAt) {
      setFormError("Tarih ve saat seçin.");
      return;
    }
    const startDate = new Date(startsAt);
    if (Number.isNaN(startDate.getTime())) {
      setFormError("Geçersiz tarih.");
      return;
    }
    const durationNum = Number(durationMinutes);
    const capacityNum = Number(capacity);
    const priceKurus = Math.round(Number(priceTl.replace(",", ".")) * 100);
    if (!Number.isFinite(durationNum) || durationNum < 30) {
      setFormError("Süre en az 30 dakika olmalı.");
      return;
    }
    if (!Number.isFinite(capacityNum) || capacityNum < 1) {
      setFormError("Geçerli bir kontenjan girin.");
      return;
    }
    if (!Number.isFinite(priceKurus) || priceKurus < 100) {
      setFormError("Geçerli bir kişi başı fiyat girin.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/workshops/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId: venue.id,
          startsAt: startDate.toISOString(),
          durationMinutes: durationNum,
          capacity: capacityNum,
          pricePerSeatKurus: priceKurus,
          manufacturerId: manufacturerId || undefined,
          adminNotes: adminNotes.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(payload.error || "Seans açılamadı.");
        return;
      }
      setStartsAt("");
      setAdminNotes("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <Link href="/admin/workshops" className="text-sm text-gray-500 hover:text-gray-800">
        ← Atölyeler
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{venue.name}</h1>
        <span
          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusMeta.badge}`}
        >
          {statusMeta.label}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Seans listesi */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Seanslar</h2>
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-500">
                Bu mekanda henüz seans açılmadı.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Tarih / saat</th>
                      <th className="py-2 pr-3 font-medium">Kontenjan</th>
                      <th className="py-2 pr-3 font-medium">Fiyat</th>
                      <th className="py-2 pr-3 font-medium">Üretici</th>
                      <th className="py-2 pr-3 font-medium">Durum</th>
                      <th className="py-2 pr-3 font-medium"></th>
                      <th className="py-2 pr-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2 pr-3 text-gray-900">
                          {new Date(s.startsAt).toLocaleString("tr-TR", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                          <div className="text-xs text-gray-400">
                            {s.durationMinutes} dk
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {s.bookedCount}/{s.capacity}
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {formatKurus(s.pricePerSeatKurus)}
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {s.manufacturerName ?? (
                            <span className="text-gray-400">— atanmadı</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              SESSION_STATUS_BADGE[s.status] ?? "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {sessionStatusLabel(s.status)}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(s.joinUrl);
                              setCopiedId(s.id);
                            }}
                            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
                          >
                            {copiedId === s.id ? "Kopyalandı ✓" : "Katılım linkini kopyala"}
                          </button>
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Link
                            href={`/admin/workshops/sessions/${s.id}`}
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            Detay →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Mekan bilgisi */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Mekan bilgisi</h2>
            <div className="space-y-1.5 text-sm text-gray-700">
              <div>{venue.contactName} · {venue.contactPhone} · {venue.contactEmail}</div>
              <div>
                {venue.address.adres}
                {venue.address.mahalle ? `, ${venue.address.mahalle}` : ""}, {venue.address.ilce} /{" "}
                {venue.address.il} {venue.address.postaKodu}
              </div>
              {venue.notes && (
                <div className="text-xs text-gray-500 pt-1">{venue.notes}</div>
              )}
            </div>
          </section>
        </div>

        {/* Seans aç formu */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 lg:sticky lg:top-6">
            <h2 className="text-sm font-semibold text-gray-700">Seans aç</h2>

            <FormField label="Tarih ve saat" required>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Süre (dk)" required>
                <Input
                  type="number"
                  min={30}
                  max={600}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </FormField>
              <FormField label="Kontenjan" required>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Kişi başı fiyat (₺)" required>
              <Input
                type="number"
                min={1}
                step="0.01"
                value={priceTl}
                onChange={(e) => setPriceTl(e.target.value)}
              />
            </FormField>

            <FormField label="Üretici" hint="Seçilmezse seans taslak kalır; katılım açılmadan önce atanmalı.">
              <Select
                value={manufacturerId}
                onChange={(e) => setManufacturerId(e.target.value)}
              >
                <option value="">— Seçilmedi —</option>
                {manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.companyName}
                    {m.city ? ` — ${m.city}` : ""} ({m.currentLoad}/{m.maxConcurrentOrders}, ort.{" "}
                    {m.avgPrintDays} gün){!m.acceptingOrders ? " — sipariş almıyor" : ""}
                  </option>
                ))}
              </Select>
            </FormField>

            {risk && (
              <div className={`rounded-lg px-3 py-2 text-xs ${RISK_BANNER[risk.level]}`}>
                {risk.message}
              </div>
            )}

            <FormField label="İç not" hint="Opsiyonel, müşteriye gitmez.">
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={2}
              />
            </FormField>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <button
              type="button"
              onClick={submitSession}
              disabled={submitting}
              className="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? "Açılıyor…" : "Seans aç"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
