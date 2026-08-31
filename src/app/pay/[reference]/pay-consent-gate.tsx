"use client";

import { useState } from "react";
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
 * terfide siparişe taşınır. Damgalama best-effort: asıl engel bu UI kapısı
 * olduğu için, ağ hatası müşteriyi sayfada kilitlemez.
 */
export function PayConsentGate({
  reference,
  productName,
  priceKurus,
  children,
}: {
  reference: string;
  /** Ürünün temel nitelikleri — MSY m.6/2-a özet bloğunun (a) bendi. */
  productName: string;
  /** Vergiler dâhil toplam — (d) bendi. */
  priceKurus: number;
  children: React.ReactNode;
}) {
  const [contentOk, setContentOk] = useState(false);
  const [contractOk, setContractOk] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const ok = contentOk && contractOk;

  const record = (both: boolean, contract: boolean) => {
    if (both && contract && !recorded) {
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
      <div
        className={ok ? "space-y-6" : "space-y-6 opacity-40 pointer-events-none select-none"}
        aria-disabled={!ok}
      >
        {children}
      </div>
    </>
  );
}
