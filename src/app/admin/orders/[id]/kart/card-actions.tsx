"use client";

import { useState } from "react";

export function CardActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
      >
        Kartı yazdır
      </button>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
      >
        {copied ? "Kopyalandı ✓" : "Bağlantıyı kopyala"}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
      >
        Sayfayı önizle →
      </a>
    </div>
  );
}
