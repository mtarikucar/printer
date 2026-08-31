"use client";

import { useState } from "react";
import Link from "next/link";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import type { ConsentVariant } from "@/lib/config/distance-contract";

/**
 * Ödeme öncesi mesafeli sözleşme onayı — özet blok + TEK zorunlu kutu.
 *
 * MSY m.6/2-a, tüketicinin ödeme yükümlülüğüne girmeden hemen önce şu dördünün
 * BİR BÜTÜN OLARAK gösterilmesini ister: (a) ürünün temel nitelikleri, (d)
 * vergiler dâhil toplam fiyat, (g) cayma şartları, (h) cayma hakkının olmadığı
 * bilgisi. Kutu tek başına yetmez — bu yüzden kutunun üstünde özet blok var ve
 * kutu o bloğun teyididir. m.7: eksik ön bilgilendirmede "sözleşme kurulmamış
 * sayılır", yani kişiye özel üründeki cayma istisnası da düşer.
 *
 * `variant` KRİTİK: hazır üründe cayma hakkı TAM OLARAK VARDIR. Oraya kişiye
 * özel metnini koymak, tüketiciyi olmayan bir kısıtla bağlamaya çalışmaktır.
 *
 * Kutu önceden işaretli DEĞİLDİR (m.6: onay tüketicinin fiiliyle verilmeli).
 */
export function DistanceContractConsent({
  variant,
  productName,
  priceKurus,
  onChange,
  className,
}: {
  variant: ConsentVariant;
  /** Ürünün temel nitelikleri — özet bloğun (a) bendi. */
  productName: string;
  /** Vergiler dâhil toplam — özet bloğun (d) bendi. */
  priceKurus: number;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  const d = useDictionary();
  const locale = useLocale();
  const t = (k: string, fb: string) => d[k as keyof typeof d] || fb;
  const [checked, setChecked] = useState(false);

  const personalized = variant === "personalized";

  return (
    <div className={className ?? "space-y-3 text-left"}>
      <div className="rounded-xl border border-border bg-surface-secondary/40 p-3 space-y-1.5">
        <p className="text-xs font-medium text-text-primary">
          {t("consent.contract.summaryTitle", "Ödeme öncesi özet")}
        </p>
        <dl className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between gap-3">
            <dt>{t("consent.contract.summaryProduct", "Ürün")}</dt>
            <dd className="text-right text-text-primary">{productName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("consent.contract.summaryTotal", "Toplam (KDV dâhil)")}</dt>
            <dd className="text-right font-medium text-text-primary">
              {formatCurrency(priceKurus, locale)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("consent.contract.summaryWithdrawal", "Cayma hakkı")}</dt>
            <dd className="text-right text-text-primary">
              {personalized
                ? t("consent.contract.summaryWithdrawalNone", "Yok (kişiye özel üretim)")
                : t("consent.contract.summaryWithdrawal14", "14 gün")}
            </dd>
          </div>
        </dl>
      </div>

      <label className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            setChecked(e.target.checked);
            onChange(e.target.checked);
          }}
          required
          className="mt-0.5 shrink-0"
        />
        <span>
          {personalized ? (
            <>
              {t(
                "consent.contract.personalized1",
                "Sipariş ettiğim figürinin yüklediğim fotoğraftan yalnızca bana özel üretildiğini, bu nedenle Mesafeli Sözleşmeler Yönetmeliği m.15/1-(b) uyarınca 14 günlük cayma hakkının bu üründe bulunmadığını okudum ve anladım. "
              )}
              <Link href="/on-bilgilendirme" target="_blank" className="underline hover:text-text-primary">
                {t("consent.contract.preliminaryLink", "Ön Bilgilendirme Formu")}
              </Link>
              {t("consent.contract.and", "'nu ve ")}
              <Link href="/mesafeli-satis" target="_blank" className="underline hover:text-text-primary">
                {t("consent.contract.contractLink", "Mesafeli Satış Sözleşmesi")}
              </Link>
              {t(
                "consent.contract.personalized2",
                "'ni okuyup kabul ediyorum. Önizlemeyi onaylamadığım sürece siparişimi ücretsiz iptal edebileceğimi, ürünün ayıplı çıkması hâlindeki yasal haklarımın iki yıl boyunca saklı olduğunu biliyorum."
              )}
            </>
          ) : (
            <>
              <Link href="/on-bilgilendirme" target="_blank" className="underline hover:text-text-primary">
                {t("consent.contract.preliminaryLink", "Ön Bilgilendirme Formu")}
              </Link>
              {t("consent.contract.and", "'nu ve ")}
              <Link href="/mesafeli-satis" target="_blank" className="underline hover:text-text-primary">
                {t("consent.contract.contractLink", "Mesafeli Satış Sözleşmesi")}
              </Link>
              {t(
                "consent.contract.readymade",
                "'ni okudum, kabul ediyorum. Bu üründe teslimden itibaren 14 gün cayma hakkım olduğunu biliyorum."
              )}
            </>
          )}
        </span>
      </label>
    </div>
  );
}
