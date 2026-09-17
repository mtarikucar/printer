"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface PayoutHistoryNavigationProps {
  status: string;
  limit: number;
  cursor?: string;
  nextCursor: string | null;
  exportHref: string;
  rowCount: number;
  unavailable?: boolean;
  partnerFilter?: { value: string; options: Array<{ id: string; name: string }>; unavailable?: boolean };
}

/** Pagination changes only history; complete balance cards are not paginated. */
export function PayoutHistoryNavigation(props: PayoutHistoryNavigationProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [previous, setPrevious] = useState(new Map<string, string | null>());

  function go(changes: Record<string, string | null>) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    startTransition(() => router.push(`${url.pathname}${url.search}`, { scroll: false }));
  }
  function next() {
    if (!props.nextCursor) return;
    setPrevious(current => new Map(current).set(props.nextCursor!, props.cursor ?? null));
    go({ cursor: props.nextCursor });
  }
  function back() {
    go({ cursor: props.cursor ? previous.get(props.cursor) ?? null : null });
  }

  return <div className="my-4 rounded-xl border border-gray-200 bg-white p-4 text-sm">
    <div className="flex flex-wrap items-end gap-3">
      {props.partnerFilter && <label className="text-xs text-gray-600">Partner
        <select value={props.partnerFilter.value} disabled={pending || props.partnerFilter.unavailable} onChange={event => {
          setPrevious(new Map());
          go({ partnerId: event.target.value || null, cursor: null });
        }} className="mt-1 block max-w-64 rounded-lg border border-gray-200 bg-white p-2 text-sm text-gray-900">
          <option value="">Tüm partnerler</option>
          {props.partnerFilter.options.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
        </select>
      </label>}
      <label className="text-xs text-gray-600">Ödeme geçmişi filtresi
        <select value={props.status} disabled={pending} onChange={event => {
          setPrevious(new Map());
          go({ status: event.target.value, cursor: null });
        }} className="mt-1 block rounded-lg border border-gray-200 bg-white p-2 text-sm text-gray-900">
          <option value="all">Tümü</option>
          <option value="pending">Bekleyen</option>
          <option value="paid">Banka ile ödenen</option>
          <option value="netted">Mahsup edilen</option>
          <option value="voided">İptal edilen</option>
        </select>
      </label>
      <label className="text-xs text-gray-600">Sayfadaki kayıt
        <select value={props.limit} disabled={pending} onChange={event => {
          setPrevious(new Map());
          go({ limit: event.target.value, cursor: null });
        }} className="mt-1 block rounded-lg border border-gray-200 bg-white p-2 text-sm text-gray-900">
          {[...new Set([25, 50, 100, props.limit])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {!props.unavailable && <a href={props.exportHref} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">Filtrenin tamamını CSV indir</a>}
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending || !props.cursor} onClick={back} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs disabled:opacity-40">
        {props.cursor && previous.has(props.cursor) ? "Önceki sayfa" : "İlk sayfa"}
      </button>
      <button type="button" disabled={pending || props.unavailable || !props.nextCursor} onClick={next} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs disabled:opacity-40">Sonraki sayfa</button>
      <span className="text-xs text-gray-500">{props.unavailable ? "Kayıt sayısı okunamadı" : `Bu sayfada ${props.rowCount} kayıt`}{pending ? " · Yükleniyor…" : ""}</span>
    </div>
    <p className="mt-2 text-xs text-gray-500">Sayfalama yalnız ödeme geçmişini değiştirir. Bakiye toplamları tüm kayıtları kapsar. CSV, seçili filtreye uyan bütün ödeme partilerini içerir.</p>
  </div>;
}
