"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SessionView {
  id: string;
  venueName: string;
  venueLine: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  pricePerSeatKurus: number;
  joinClosesAt: string;
  deliverBy: string;
  status: string;
  statusLabel: string;
  commissionRateBps: number | null;
  committedAt: string | null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatKurus(kurus: number): string {
  return `₺${(kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Taahhüt ekranı. Buton yalnızca `draft`/`open` seansta anlamlıdır — uç da aynı
 * kapıyı taşıyor (kapanmış bir seans için taahhüt kaydı, olmayan bir işi kabul
 * etmiş gibi görünürdü), bu yüzden burada gizlenir ki üretici 404 duvarına
 * çarpmasın.
 */
export function WorkshopCommitClient({
  session,
  ladder,
}: {
  session: SessionView;
  ladder: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committedAt, setCommittedAt] = useState<string | null>(session.committedAt);

  const canCommit = ["draft", "open"].includes(session.status);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/manufacturer/workshop-sessions/${session.id}/commit`,
        { method: "POST" }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Taahhüt kaydedilemedi.");
        return;
      }
      setCommittedAt(payload.committedAt ?? new Date().toISOString());
      router.refresh();
    } catch {
      setError("Ağ hatası — bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Atölye seansı</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {session.statusLabel}
        </span>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-1.5 text-sm text-gray-700">
        <p className="text-base font-semibold text-gray-900">{session.venueName}</p>
        <p>{session.venueLine}</p>
        <p>Seans tarihi: {formatDateTime(session.startsAt)} · {session.durationMinutes} dk</p>
        <p>Kontenjan: {session.capacity} kişi</p>
        <p>Kişi başı fiyat: {formatKurus(session.pricePerSeatKurus)}</p>
        <p>Katılım kapanışı: {formatDateTime(session.joinClosesAt)}</p>
        <p className="font-medium text-gray-900">
          Mekana teslim: {formatDateTime(session.deliverBy)}
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700">Payınız</h2>
        {session.commissionRateBps != null ? (
          <p className="mt-2 text-sm text-gray-700">
            Parti kapandı; payınız{" "}
            <strong>%{(10000 - session.commissionRateBps) / 100}</strong> olarak
            donduruldu.
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs text-gray-500">
              Katılım linki kapandığında parti büyüklüğüne göre belirlenir ve
              DONAR — partideki her sipariş aynı oranı taşır.
            </p>
            <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
              {ladder.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5">
        <h2 className="text-sm font-semibold text-indigo-900">Tarih taahhüdü</h2>
        {committedAt ? (
          <p className="mt-2 text-sm text-indigo-900">
            Bu tarihi <strong>{formatDateTime(committedAt)}</strong> tarihinde
            taahhüt ettiniz. Katılım linki kapandığında parti panelinize
            doğrudan &quot;kabul edildi&quot; olarak düşecek.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-indigo-900/90">
              Bu tarihi tutabileceğinizi onaylayın. Katılım penceresi 5 gün; bu
              yüzden parti kapanışta size soğuk atama ve 24 saatlik kabul
              beklemesi olmadan doğrudan düşer. Tarihi tutamayacaksanız
              onaylamayın ve kapanıştan önce bize haber verin.
            </p>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            {canCommit ? (
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? "Kaydediliyor…" : "Bu tarihi taahhüt ediyorum"}
              </button>
            ) : (
              <p className="mt-3 text-xs text-indigo-900/70">
                Bu seansın katılımı kapandı; taahhüt kaydı artık alınmıyor.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
