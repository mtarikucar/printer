"use client";

import { useState } from "react";
import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Görsel/kişilik hakları + KVKK onayı — iki AYRI zorunlu kutu.
 *
 * KVKK açısından aydınlatma (Kutu 2) ile fotoğraf hak/rıza taahhüdü (Kutu 1)
 * ayrı alınır; tek kutuya sıkıştırılırsa açık rıza geçersiz sayılabilir.
 * `onChange`, YALNIZCA iki kutu da işaretliyken `true` bildirir — tüketici bunu
 * sipariş/ödeme butonunu gate'lemek için kullanır. Foto/model içeren siparişlerde
 * (custom / upload / WhatsApp pay) gösterilir; saf marketplace'te gösterilmez.
 */
export function ContentConsent({
  onChange,
  className,
}: {
  onChange: (bothChecked: boolean) => void;
  className?: string;
}) {
  const d = useDictionary();
  const t = (k: string, fb: string) => d[k as keyof typeof d] || fb;
  const [box1, setBox1] = useState(false);
  const [box2, setBox2] = useState(false);

  const update = (n1: boolean, n2: boolean) => {
    setBox1(n1);
    setBox2(n2);
    onChange(n1 && n2);
  };

  return (
    <div className={className ?? "space-y-2 text-left"}>
      <label className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={box1}
          onChange={(e) => update(e.target.checked, box2)}
          required
          className="mt-0.5 shrink-0"
        />
        <span>
          {t(
            "consent.content.box1",
            "Yüklediğim fotoğrafı kullanma hakkına sahip olduğumu; fotoğraftaki kişi(ler)in (çocuksa velisinin) açık rızasını aldığımı; görselin ünlü/üçüncü kişi, telifli/markalı, müstehcen, nefret söylemi veya yasa dışı içerik taşımadığını, aksi hâlde tüm hukuki sorumluluğun bana ait olduğunu ve "
          )}
          <Link href="/terms" target="_blank" className="underline hover:text-text-primary">
            {t("consent.content.termsLink", "Kullanım Koşulları'nı")}
          </Link>
          {t("consent.content.box1b", " okuyup kabul ettiğimi beyan ederim.")}
        </span>
      </label>

      <label className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={box2}
          onChange={(e) => update(box1, e.target.checked)}
          required
          className="mt-0.5 shrink-0"
        />
        <span>
          {t(
            "consent.content.box2",
            "Fotoğrafımın stilize görsel üretimi için yurt dışındaki yapay zeka sağlayıcılarına aktarılabileceğini; "
          )}
          <Link href="/privacy" target="_blank" className="underline hover:text-text-primary">
            {t("consent.content.kvkkLink", "KVKK Aydınlatma Metni'ni")}
          </Link>
          {t(
            "consent.content.box2b",
            " okuduğumu ve bu işleme/aktarıma açık rıza verdiğimi beyan ederim."
          )}
        </span>
      </label>
    </div>
  );
}
