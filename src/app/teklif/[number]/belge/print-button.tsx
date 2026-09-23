"use client";

import type { JSX } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Belgeyi yazdırır (ya da tarayıcının "PDF olarak kaydet" çıktısını açar).
 *
 * `no-print` sınıfı zorunludur: düğmenin kendisi çıktıya girerse müşteri
 * teklif belgesinin köşesinde "Yazdır / PDF" yazan bir kutuyla birlikte
 * gönderir. Ayrı bir istemci bileşeni olmasının sebebi de budur — belgenin
 * kendisi etkileşimsizdir, tek "uygulama" parçası bu düğmedir.
 */
export function QuoteDocumentPrintButton(): JSX.Element {
  const d = useDictionary();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-primary no-print !px-4 !py-2 text-xs"
    >
      {d["instantQuote.document.print"]}
    </button>
  );
}
