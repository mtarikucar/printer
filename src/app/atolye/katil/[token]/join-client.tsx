"use client";

import { Card } from "@/components/ui";
import type { JoinView } from "@/lib/services/workshop-join";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    dateStyle: "full",
    timeStyle: "short",
  });
}

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

/**
 * Public katılım sayfasının gövdesi.
 *
 * Bu sürüm salt-okunurdur: seans bilgilerini gösterir, seans kapalıysa
 * yalnızca kapanış nedenini gösterir — form, fotoğraf yükleme ve onay
 * kutuları burada YOKTUR (bkz. görev 9). `token` prop'u burada henüz
 * kullanılmıyor; katılım formu eklendiğinde gönderim isteğinde kullanılacak.
 */
export function JoinClient({
  view,
}: {
  token: string;
  view: JoinView;
}) {
  const remaining = Math.max(0, view.capacity - view.bookedCount);

  return (
    <main className="min-h-screen bg-bg-base">
      <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">
        <p className="text-xs font-medium uppercase tracking-wider text-green-600">
          Figurunica Atölye
        </p>
        <h1 className="font-display text-3xl sm:text-4xl text-text-primary mt-2 mb-8">
          {view.venueName}
        </h1>

        {!view.open ? (
          <Card padding="lg">
            <h2 className="text-lg font-semibold text-text-primary">
              Bu atölyeye şu anda katılım mümkün değil
            </h2>
            <p className="text-text-secondary mt-2">{view.closedReason}</p>
          </Card>
        ) : (
          <Card padding="lg">
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-text-muted">
                  Mekan
                </dt>
                <dd className="text-text-primary mt-0.5">
                  {view.venueDistrict}, {view.venueCity}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-text-muted">
                  Tarih ve saat
                </dt>
                <dd className="text-text-primary mt-0.5">
                  {formatDateTime(view.startsAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-text-muted">
                  Kalan kontenjan
                </dt>
                <dd className="text-text-primary mt-0.5">
                  {remaining} / {view.capacity} kişi
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-text-muted">
                  Son katılım tarihi
                </dt>
                <dd className="text-text-primary mt-0.5">
                  {formatDeadline(view.joinClosesAt)}
                </dd>
              </div>
            </dl>
          </Card>
        )}

        <p className="text-center text-xs text-text-muted mt-8">
          Bu sayfa yalnızca bağlantıyı bilenlere açıktır.
        </p>
      </div>
    </main>
  );
}
