"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ContentConsent } from "@/components/content-consent";
import { DistanceContractConsent } from "@/components/distance-contract-consent";

/**
 * WhatsApp siparişi ödeme sayfası (/pay/<ref>) onay kapısı: görsel/kişilik
 * hakları + KVKK VE mesafeli sözleşme ön bilgilendirmesi. Üçü de
 * işaretlenmeden altındaki ödeme bölümü (kart / havale) etkileşime kapalı
 * kalır — on-site checkout ile aynı zorunluluk.
 *
 * Ön bilgilendirme sohbette YAPILAMAZ: MSY m.6 bilgilerin bir bütün olarak,
 * ödemeden hemen önce sunulmasını ister. WhatsApp akışında bunun tek geçerli
 * anı bu sayfadır.
 *
 * İki kutu işaretlendiği anda onay, draft'a damgalanır (POST .../consent) ve
 * terfide siparişe taşınır. Sunucu bu sayfanın ticari bilgilerinin güncel
 * olduğunu doğrulayıp iki damgayı yazmadan ödeme bölümü açılmaz.
 */
export function PayConsentGate({
  reference,
  fingerprint,
  productName,
  priceKurus,
  children,
}: {
  reference: string;
  fingerprint: string;
  /** Ürünün temel nitelikleri — MSY m.6/2-a özet bloğunun (a) bendi. */
  productName: string;
  /** Vergiler dâhil toplam — (d) bendi. */
  priceKurus: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [contentOk, setContentOk] = useState(false);
  const [contractOk, setContractOk] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const ok = contentOk && contractOk && recorded;

  const record = async (both: boolean, contract: boolean) => {
    if (!both || !contract || recorded || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null); setStale(false);
    try {
      const response = await fetch(`/api/pay/${encodeURIComponent(reference)}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint }),
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) {
        setStale(response.status === 409);
        setError(data.error || "Onay kaydedilemedi. Lütfen tekrar deneyin.");
        return;
      }
      setRecorded(true);
    } catch {
      setError("Onay kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin; ödeme henüz açılmadı.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <ContentConsent
        onChange={(both) => {
          setContentOk(both);
          record(both, contractOk);
        }}
        className="rounded-xl border border-bg-subtle bg-bg-elevated p-4 space-y-2 text-left"
      />
      <DistanceContractConsent
        variant="personalized"
        productName={productName}
        priceKurus={priceKurus}
        onChange={(checked) => {
          setContractOk(checked);
          record(contentOk, checked);
        }}
        className="rounded-xl border border-bg-subtle bg-bg-elevated p-4 space-y-3 text-left"
      />
      {busy && <p role="status" className="text-sm text-text-secondary">Onayınız kaydediliyor…</p>}
      {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p>{error}</p>
        <button type="button" className="mt-2 font-semibold underline" disabled={busy} onClick={() => stale ? router.refresh() : void record(contentOk, contractOk)}>
          {stale ? "Güncel bilgileri yükle" : "Onayı yeniden kaydet"}
        </button>
      </div>}
      <div
        className={ok ? "space-y-6" : "space-y-6 opacity-40 pointer-events-none select-none"}
        aria-disabled={!ok}
      >
        {ok ? children : <p className="text-sm text-text-secondary">Ödeme bilgileri, onayınız kaydedildikten sonra açılır.</p>}
      </div>
    </>
  );
}
