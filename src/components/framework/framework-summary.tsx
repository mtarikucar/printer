"use client";

/**
 * Anlaşmanın ÖZETİ: taahhüt satırları ve İKİ AYRI TOPLAM.
 *
 * ─── İKİ TOPLAM AYNI ŞEY DEĞİLDİR ──────────────────────────────────────────
 *
 * `committedTotalKurus` TEK-SEVKİYAT PROJEKSİYONUDUR: taahhüdün tamamı tek
 * siparişte sevk edilseydi ödenecek tutar. `batchesTotalKurus` ise iptal
 * edilmemiş partilerin tutar toplamıdır. İKİSİ GENELDE EŞİT DEĞİLDİR: her
 * parti KENDİ teklifi olduğu için `fixed` ve `per_part` ek hizmetler ile
 * asgari tamamlama HER PARTİDE yeniden işler (`quote-pricing.ts` ·
 * `addonLines`).
 *
 * İki rakam da dürüsttür ve bu ekran hiçbirini ötekinin yerine YAZMAZ. Aynı
 * sebeple aralarındaki farkı da HESAPLAMAZ: bir çıkarma, "kayıp para" gibi
 * okunacak bir üçüncü sayı üretirdi — oysa fark, her partide yeniden tahsil
 * edilen ek hizmetin kendisidir.
 *
 * TUTARLAR UÇTAN GELİR: bu dosyada çarpma, bölme, oran YOKTUR.
 */
import { formatCurrency } from "@/lib/i18n/format";

export interface CommitmentRow {
  partId: string;
  position: number;
  name: string;
  technologyName: string;
  materialName: string;
  finishName: string;
  quantity: number;
  unitKurus: number;
  lineKurus: number;
}

export function FrameworkSummary({
  parts,
  addons,
  committedUnits,
  committedTotalKurus,
  batchesTotalKurus,
}: {
  parts: CommitmentRow[];
  addons: Array<{ key: string; name: string; kurus: number }>;
  committedUnits: number;
  committedTotalKurus: number;
  batchesTotalKurus: number;
}) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-2 pr-3">Parça</th>
              <th className="py-2 pr-3">Konfigürasyon</th>
              <th className="py-2 text-right">Taahhüt</th>
              <th className="py-2 text-right">Kilitli birim</th>
              <th className="py-2 text-right">Satır</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {parts.map((p) => (
              <tr key={p.partId}>
                <td className="py-2 pr-3 text-gray-900">
                  P{String(p.position).padStart(2, "0")} · {p.name}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-500">
                  {p.technologyName} · {p.materialName} · {p.finishName}
                </td>
                <td className="py-2 text-right tabular-nums">{p.quantity}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatCurrency(p.unitKurus, "tr")}
                </td>
                <td className="py-2 text-right tabular-nums font-medium">
                  {formatCurrency(p.lineKurus, "tr")}
                </td>
              </tr>
            ))}
            {addons.map((a) => (
              <tr key={a.key}>
                <td className="py-2 pr-3 text-gray-900" colSpan={4}>
                  {a.name}
                  <span className="ml-2 text-[11px] text-gray-400">anlaşma ek hizmeti</span>
                </td>
                <td className="py-2 text-right tabular-nums font-medium">
                  {formatCurrency(a.kurus, "tr")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs font-medium text-gray-500">
            Taahhüt toplamı — tek sevkiyatta
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
            {formatCurrency(committedTotalKurus, "tr")}
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            {committedUnits} adedin TAMAMI tek siparişte sevk edilseydi ödenecek tutar
            (KDV dahil). Partilerin toplamı DEĞİLDİR.
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs font-medium text-gray-500">
            Partilere bölündüğünde — Σ parti tutarı
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
            {formatCurrency(batchesTotalKurus, "tr")}
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            İptal edilmemiş partilerin tutar toplamı. Sabit ve parça-başı ek hizmetler
            her partide YENİDEN tahsil edildiği için soldaki rakamdan büyük olabilir;
            ikisi de doğrudur.
          </p>
        </div>
      </div>
    </div>
  );
}
