"use client";

/**
 * `/account/cerceve` — müşterinin çerçeve anlaşma listesi.
 *
 * Liste UÇTAN gelir (`GET /api/customer/frameworks`); bu bileşen hiçbir fiyat
 * hesaplamaz ve tutar gövdede YOKSA (fiyat kapısı) rakam yerine tire yazar —
 * uydurma bir "₺0,00" müşteriye bedava bir taahhüt sözü verirdi.
 *
 * `/account/teklifler` listesinin kardeşi; iki liste aynı DESENİ paylaşır,
 * aynı bileşeni paylaşmaz (satırları ayrı: biri teklif, öteki taahhüt).
 */
import { useEffect, useState, type JSX } from "react";
import Link from "next/link";
import {
  FRAMEWORK_STATUS_DICT_KEYS,
} from "@/app/cerceve/[number]/framework-values";
import { fill } from "@/components/quote/format";
import type { CustomerFrameworkListItem } from "@/lib/services/quote-framework-present";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";

function FrameworkListTable({
  items,
}: {
  items: CustomerFrameworkListItem[];
}): JSX.Element {
  const d = useDictionary();
  const c = (key: "number" | "title" | "units" | "status" | "total" | "lock" | "batches") =>
    d[`instantQuote.framework.account.column.${key}`];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border-default text-xs text-text-muted">
            <th scope="col" className="py-3 pr-4 font-medium">{c("number")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("title")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("units")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("batches")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("status")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("total")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("lock")}</th>
            <th scope="col" className="py-3 font-medium">
              <span className="sr-only">{d["instantQuote.framework.account.open"]}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-bg-subtle align-middle">
              <td className="py-3 pr-4 font-mono text-[13px] text-text-primary">
                {item.number}
              </td>
              <td className="py-3 pr-4 text-text-secondary">{item.title ?? "—"}</td>
              <td className="py-3 pr-4 tabular-nums text-text-secondary">
                {item.committedUnits}
              </td>
              <td className="py-3 pr-4 text-text-secondary">
                {fill(d["instantQuote.framework.batchCount"], { count: item.batchCount })}
              </td>
              <td className="py-3 pr-4">
                <span className="inline-block rounded-full bg-bg-muted px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                  {d[FRAMEWORK_STATUS_DICT_KEYS[item.status]]}
                </span>
              </td>
              <td className="py-3 pr-4 font-mono text-[13px] tabular-nums text-text-primary">
                {item.committedTotalKurus === undefined
                  ? "—"
                  : formatCurrency(item.committedTotalKurus, "tr")}
              </td>
              <td className="py-3 pr-4 text-text-secondary">
                {item.lockExpired
                  ? d["instantQuote.framework.lockExpired"]
                  : formatDate(item.priceLockedUntil, "tr")}
              </td>
              <td className="py-3 text-right whitespace-nowrap">
                <Link
                  href={`/cerceve/${encodeURIComponent(item.number)}`}
                  className="text-sm font-medium text-green-600 underline-offset-4 hover:underline"
                >
                  {d["instantQuote.framework.account.open"]}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccountFrameworksClient(): JSX.Element {
  const d = useDictionary();
  const [items, setItems] = useState<CustomerFrameworkListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/customer/frameworks", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { items: CustomerFrameworkListItem[] };
        if (alive) setItems(body.items);
      } catch {
        // "Liste boş" ile "liste okunamadı" AYNI ekran olamaz: boş bir tablo,
        // müşteriye anlaşması olmadığını söylerdi.
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <p className="text-sm text-text-muted">…</p>;
  if (failed) {
    return (
      <p role="alert" className="text-sm text-warning-500">
        {d["instantQuote.framework.account.loadFailed"]}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        {d["instantQuote.framework.account.empty"]}
      </p>
    );
  }
  return <FrameworkListTable items={items} />;
}
