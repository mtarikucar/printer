"use client";

import { useState } from "react";
import { ContentConsent } from "@/components/content-consent";

/**
 * WhatsApp siparişi ödeme sayfası (/pay/<ref>) için görsel/kişilik hakları +
 * KVKK onay kapısı. İki kutu da işaretlenmeden altındaki ödeme bölümü (kart /
 * havale) etkileşime kapalı kalır — on-site checkout ile aynı zorunluluk.
 *
 * İki kutu işaretlendiği anda onay, draft'a damgalanır (POST .../consent) ve
 * terfide siparişe taşınır. Damgalama best-effort: asıl engel bu UI kapısı
 * olduğu için, ağ hatası müşteriyi sayfada kilitlemez.
 */
export function PayConsentGate({
  reference,
  children,
}: {
  reference: string;
  children: React.ReactNode;
}) {
  const [ok, setOk] = useState(false);
  const [recorded, setRecorded] = useState(false);

  const handleChange = (bothChecked: boolean) => {
    setOk(bothChecked);
    if (bothChecked && !recorded) {
      setRecorded(true);
      fetch(`/api/pay/${encodeURIComponent(reference)}/consent`, {
        method: "POST",
      }).catch(() => {
        // Yut: denetim damgası best-effort; ödeme kapısı zaten işaretlemeye bağlı.
      });
    }
  };

  return (
    <>
      <ContentConsent
        onChange={handleChange}
        className="rounded-xl border border-bg-subtle bg-bg-elevated p-4 space-y-2 text-left"
      />
      <div
        className={ok ? "space-y-6" : "space-y-6 opacity-40 pointer-events-none select-none"}
        aria-disabled={!ok}
      >
        {children}
      </div>
    </>
  );
}
