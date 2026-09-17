"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface BulkProductGroup {
  productId: string;
  title: string;
  imageUrl: string | null;
  totalUnits: number;
  /** Units in orders that can be assigned now (AWAITING_MANUFACTURER, the header's set). */
  assignableUnits: number;
  /** Units in orders with no manufacturer that cannot be assigned yet. */
  notYetAssignableUnits: number;
  orders: Array<{
    orderId: string;
    orderNumber: string;
    units: number;
    createdAt: string;
    manufacturerName: string | null;
    unassigned: boolean;
    /** In AWAITING_MANUFACTURER: the assign service will take it. */
    assignable: boolean;
  }>;
  byManufacturer: Array<{ name: string; units: number }>;
}

/**
 * Bir ürün grubu için SIRALAMANIN önerdiği atölye.
 *
 * Sunucuda, canlı atamanın kendi sıralayıcısıyla üretilir (page.tsx). Burada
 * yalnız GÖSTERİLİR ve kutuyu ön seçer: karar yine admin'indir, öneri kimseye
 * iş yazmaz.
 */
export interface BulkSuggestion {
  /** Önerinin hangi siparişe bakılarak çıktığı — mesafe skoru o adrestendir. */
  basedOnOrderNumber: string;
  manufacturerId: string | null;
  companyName: string | null;
  city: string | null;
  totalScore: number | null;
  currentLoad: number | null;
  maxConcurrentOrders: number | null;
  reasons: string[];
  /** Aday sıralamadan değil MÜLKİYETTEN geldi (satıcının kendi ürünü). */
  sellerOwned: boolean;
  runnerUpName: string | null;
  runnerUpScore: number | null;
  /** Aday yoksa Türkçe gerekçe (sıralayıcının kendi cümlesi). */
  blockMessage: string | null;
}

/**
 * Önerinin GEREKÇESİ — skorun kendisi bir cevap değildir.
 *
 * Admin'in "neden bu atölye" sorusunu ekranda yanıtlar: skor, yük, mesafe ve
 * ikinci aday bir arada durur. Aday YOKSA sebebi yazar; boş bir öneri,
 * "sıralama çalışmadı" ile "hiçbir atölye uygun değil"i aynı şeye indirgerdi.
 */
function SuggestionNote({
  suggestion,
  picked,
}: {
  suggestion: BulkSuggestion | undefined;
  picked: string;
}) {
  // Öneri hesaplanmamış grup (liste sınırının dışında): ekran bugünkü gibi
  // davranır, uydurma bir cümle yazılmaz.
  if (!suggestion) return null;

  if (!suggestion.manufacturerId) {
    return (
      <p className="w-full rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
        <strong>Sıralama önerisi yok.</strong>{" "}
        {suggestion.blockMessage ?? "Uygun aday bulunamadı."} Aşağıdaki listeden
        elle seçebilirsiniz.
      </p>
    );
  }

  const overridden = picked !== "" && picked !== suggestion.manufacturerId;
  return (
    <div className="w-full rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-900">
      <p>
        <strong>Sıralama önerisi: {suggestion.companyName}</strong>
        {suggestion.city ? ` · ${suggestion.city}` : ""}
        {suggestion.totalScore !== null ? ` · skor ${suggestion.totalScore}` : ""}
        {suggestion.currentLoad !== null && suggestion.maxConcurrentOrders !== null
          ? ` · yük ${suggestion.currentLoad}/${suggestion.maxConcurrentOrders}`
          : ""}
      </p>
      {suggestion.sellerOwned && (
        <p className="mt-0.5">
          Bu ürün bir satıcının kendi kataloğundan çıktı: yalnız o atölyeye
          atanabilir — aday sıralamayla değil mülkiyet kuralıyla belirlendi.
        </p>
      )}
      {suggestion.reasons.length > 0 && (
        <p className="mt-0.5 text-blue-900/80">{suggestion.reasons.join(" · ")}</p>
      )}
      {suggestion.runnerUpName && (
        <p className="mt-0.5 text-blue-900/70">
          2. sırada: {suggestion.runnerUpName}
          {suggestion.runnerUpScore !== null
            ? ` (skor ${suggestion.runnerUpScore})`
            : ""}
        </p>
      )}
      <p className="mt-0.5 text-blue-900/70">
        {suggestion.basedOnOrderNumber} numaralı siparişin adresine göre
        hesaplandı. Öneri yalnız seçimi hazırlar; atamayı siz onaylarsınız.
        {overridden ? " Şu an listeden başka bir atölye seçili." : ""}
      </p>
    </div>
  );
}

interface Props {
  weightedLoadLive: boolean;
  groups: BulkProductGroup[];
  manufacturers: Array<{
    id: string;
    companyName: string;
    acceptingOrders: boolean;
    /**
     * Atama ucunun ölçüsüyle yazılmış yük etiketi ("6/5 birim · 2 iş"),
     * sunucuda `manufacturerLoadLabel` ile hazırlanır. Okunamadıysa null —
     * istemci bunu HESAPLAMAZ: ortak kapasite modülü (manufacturer-capacity.ts)
     * `pg`yi bu pakete sürüklerdi.
     */
    loadLabel: string | null;
    /** Ağırlıklı eşiğin boolean cevabı; yük okunamadıysa null ("dolu değil" DEĞİL). */
    hasRoom: boolean | null;
  }>;
  /** Ürün kimliği → sıralamanın önerisi. Eksik grup = öneri hesaplanmadı. */
  suggestions?: Record<string, BulkSuggestion>;
}

export function BulkOrdersClient({ groups, manufacturers, weightedLoadLive, suggestions = {} }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  // KUTU ÖN SEÇİLİ AÇILIR: sahibin kararı, admin boş bir listeye bakıp "hangi
  // atölye?" diye düşünmesin. Yalnız ilk render'da kurulur (lazy initializer),
  // sonrasında admin'in seçimi kazanır — sayfa yenilenmeden öneri geri gelip
  // seçimi ezemez.
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(suggestions)
        .filter(([, s]) => !!s.manufacturerId)
        .map(([productId, s]) => [productId, s.manufacturerId as string])
    )
  );
  const [busy, setBusy] = useState<string | null>(null);
  // `reasons`: one line per distinct skip reason the assign API sent back.
  const [message, setMessage] = useState<{ text: string; reasons: string[] } | null>(
    null
  );

  const assignAll = async (group: BulkProductGroup) => {
    const manufacturerId = picked[group.productId];
    if (!manufacturerId) return;
    // Only orders the assign service accepts. An unassigned order that is not
    // approved yet would only come back as "skipped", and the button's count
    // would not match the header's "üretici bekliyor".
    const orderIds = [
      ...new Set(group.orders.filter((o) => o.assignable).map((o) => o.orderId)),
    ];
    if (orderIds.length === 0) return;

    setBusy(group.productId);
    setMessage(null);
    try {
      const r = await fetch("/api/admin/bulk-orders/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturerId, orderIds }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMessage({ text: d.error || "Atama başarısız", reasons: [] });
        return;
      }
      // A partial result is normal. Each skipped order comes back with the
      // assign service's own Turkish message (ASSIGN_FAILURE_MESSAGES: a
      // refunded order, one assigned in the meantime, nothing printable, an
      // inactive manufacturer), so show those instead of guessing "someone
      // else assigned it". Identical messages are merged, with their orders.
      const skippedList: Array<{ orderId?: string; message?: string }> = Array.isArray(
        d.skipped
      )
        ? d.skipped
        : [];
      const numberOf = new Map(group.orders.map((o) => [o.orderId, o.orderNumber]));
      const byMessage = new Map<string, string[]>();
      for (const s of skippedList) {
        const text =
          typeof s.message === "string" && s.message.trim()
            ? s.message.trim()
            : "Sebep bildirilmedi.";
        const list = byMessage.get(text) ?? [];
        if (s.orderId) list.push(numberOf.get(s.orderId) ?? s.orderId);
        byMessage.set(text, list);
      }
      setMessage(
        skippedList.length > 0
          ? {
              text: `${d.assignedCount} sipariş atandı, ${skippedList.length} tanesi atlandı:`,
              reasons: [...byMessage.entries()].map(([text, nums]) =>
                nums.length > 0 ? `${text} (${nums.join(", ")})` : text
              ),
            }
          : { text: `${d.assignedCount} sipariş atandı.`, reasons: [] }
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
        Açık toplu sipariş yok.
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {message && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <p>{message.text}</p>
          {message.reasons.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {message.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {groups.map((g) => {
        const assignableOrders = g.orders.filter((o) => o.assignable);
        const isOpen = expanded === g.productId;
        return (
          <div
            key={g.productId}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white"
          >
            <div className="flex flex-wrap items-center gap-4 p-4">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                {g.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900">{g.title}</p>
                <p className="mt-0.5 text-sm text-gray-600">
                  <strong>{g.totalUnits} adet</strong> · {g.orders.length} sipariş
                  {g.assignableUnits > 0 && (
                    <span
                      className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700"
                      title="Onaylı, şu an atanabilir ve henüz üreticisi olmayan siparişlerdeki adet"
                    >
                      {g.assignableUnits} adet üretici bekliyor
                    </span>
                  )}
                  {g.notYetAssignableUnits > 0 && (
                    <span
                      className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600"
                      title="Üreticisi yok ama sipariş atanabilir durumda değil (ör. üretici atanmadan baskıya ya da kalite kontrole geçmiş)"
                    >
                      {g.notYetAssignableUnits} adet henüz atanamaz
                    </span>
                  )}
                </p>
                {g.byManufacturer.length > 0 && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {g.byManufacturer
                      .map((m) => `${m.name}: ${m.units} adet`)
                      .join(" · ")}
                  </p>
                )}
              </div>

              {assignableOrders.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <SuggestionNote
                    suggestion={suggestions[g.productId]}
                    picked={picked[g.productId] ?? ""}
                  />
                  <select
                    value={picked[g.productId] ?? ""}
                    onChange={(e) =>
                      setPicked((p) => ({ ...p, [g.productId]: e.target.value }))
                    }
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Üretici seç…</option>
                    {/* Seçenekler açık kalır; canlı kapasiteye son kararı atama ucu verir. */}
                    {manufacturers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.companyName}
                        {m.loadLabel ? ` · ${m.loadLabel}` : ""}
                        {weightedLoadLive && m.hasRoom === false ? " · TEZGÂH DOLU" : ""}
                        {m.acceptingOrders ? "" : " (sipariş almıyor)"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => assignAll(g)}
                    disabled={!picked[g.productId] || busy === g.productId}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {busy === g.productId
                      ? "Atanıyor…"
                      : `${assignableOrders.length} siparişi ata`}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : g.productId)}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                {isOpen ? "Gizle" : "Siparişler"}
              </button>
            </div>

            {isOpen && (
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="py-1">Sipariş</th>
                      <th className="py-1">Adet</th>
                      <th className="py-1">Üretici</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* One order can appear twice here — two variant lines of
                        the same product — so the row key needs the index, not
                        just orderId+units (those can be identical). */}
                    {g.orders.map((o, i) => (
                      <tr key={`${o.orderId}-${i}`} className="border-t border-gray-200">
                        <td className="py-1.5">
                          <Link
                            href={`/admin/orders/${o.orderId}`}
                            className="font-mono text-xs text-blue-700 hover:underline"
                          >
                            {o.orderNumber}
                          </Link>
                        </td>
                        <td className="py-1.5">{o.units}</td>
                        <td className="py-1.5">
                          {o.manufacturerName ??
                            (o.assignable ? (
                              <span className="text-orange-700">Atanmadı</span>
                            ) : (
                              <span className="text-gray-500">
                                Atanmadı · henüz atanamaz
                              </span>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
