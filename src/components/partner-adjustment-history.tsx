import type { PartnerPayables } from "@/lib/services/partner-payables";

const money = (n: number) => (n / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
const reasons: Record<string, string> = {
  missing: "Düzeltmenin dayandığı kayıt artık bulunamıyor.",
  reversed: "Kaynak hak ediş geri alınmış.",
  source_ineligible: "Kaynak hak ediş şu anda ödenebilir değil.",
  offset_exceeds_source: "Düzeltme tutarı, kaynağın güncel tutarını aşıyor.",
  invalid_group: "Kaynak ve düzeltme kayıtları birlikte doğrulanamadı.",
  batched: "Kaynak başka bir ödeme partisine alınmış.",
  settled: "Kaynak kayıt zaten kapatılmış.",
};
const kinds: Record<string, string> = { topup: "Ek hak ediş", reprint: "Yeniden üretim desteği", unpaid_offset: "Ödenmemiş hak ediş düzeltmesi" };
const statuses: Record<string, string> = { pending: "Bekliyor", settled: "Kapatıldı", voided: "İptal edildi" };

/** Uses the same unbounded balance snapshot as claiming; history is display only. */
export function PartnerAdjustmentHistory({ summary }: { summary: PartnerPayables }) {
  return <div className="my-6 space-y-4">
    {summary.blockedGroups.length > 0 && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">Bazı kayıtlar ödeme talebine alınamıyor</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">{summary.blockedGroups.map(g => <li key={g.key}>{reasons[g.reason] ?? "Kayıt doğrulanamadı."} Yöneticiyle görüşün. <span className="font-mono text-xs">{g.orderId.slice(0, 8)}</span></li>)}</ul>
    </div>}
    {summary.settledNettingCount > 0 && <p className="text-sm text-gray-600">{summary.settledNettingCount} ödeme partisi mahsupla kapatıldı; bu işlemler banka transferi değildir.</p>}
    {summary.adjustmentHistory.length > 0 && <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold">Ek hak edişler ve düzeltmeler</h2>
      <p className="px-4 pt-3 text-xs text-gray-500">Asıl hak ediş ayrı tutulur. Platform destekleri müşteri iadesinden bağımsızdır; kesinti yalnız bağlı olduğu ödenmemiş kaydı azaltır.</p>
      <ul className="divide-y divide-gray-100 px-4">{summary.adjustmentHistory.map(a => <li key={a.id} className="py-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span>{kinds[a.kind]}</span><strong className={a.netKurus < 0 ? "text-red-700" : "text-emerald-700"}>{money(a.netKurus)}</strong></div>
        <p className="mt-1 text-xs text-gray-500">{statuses[a.status]}{a.status === "pending" && (a.manufacturerPayoutId || a.painterPayoutId) ? " · Ödeme sürecinde" : ""} · {a.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p>
        <p className="mt-1 text-xs text-gray-700">{a.reason}</p>
        {a.voidReason && <p className="mt-1 text-xs text-gray-500">İptal gerekçesi: {a.voidReason}</p>}
      </li>)}</ul>
    </section>}
  </div>;
}
