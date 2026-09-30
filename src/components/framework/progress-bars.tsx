"use client";

/**
 * Çerçeve anlaşmanın İLERLEME ÇUBUĞU: altı kova + ayrık kova.
 *
 * Kovalar DAİMA taahhüde toplanır (`frameworkProgressBuckets`, saf çekirdek);
 * aksi hâlde ekran yalan söyler — bir çubuğun toplamı taahhüdü tutmazsa
 * okuyucu hangi sayıya güveneceğini bilemez.
 *
 * ARİTMETİK BURADA DEĞİL: dilim genişlikleri `progressSegments` (saf modül)
 * tarafından üretilir ve bu bileşen yalnız çizer. Tutar da HİÇ geçmez — çubuk
 * ADET anlatır, para değil.
 */
import {
  progressSegments,
  type ProgressSegment,
} from "@/app/admin/cerceve/[id]/framework-values";
import type { FrameworkProgress } from "@/lib/config/quote-framework";

function Bar({ segments }: { segments: ProgressSegment[] }) {
  const drawn = segments.filter((s) => s.units > 0);
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
      {drawn.map((s) => (
        <div
          key={s.key}
          className={s.tone}
          style={{ width: `${s.pct}%` }}
          title={`${s.label}: ${s.units} adet`}
        />
      ))}
    </div>
  );
}

export function FrameworkProgressBars({
  progress,
  byPart,
  partNames,
}: {
  progress: FrameworkProgress;
  byPart?: Array<FrameworkProgress & { partId: string }>;
  /** parça kimliği → ekranda görünen ad (sunucudan hazır iner). */
  partNames?: Record<string, string>;
}) {
  const segments = progressSegments(progress);
  return (
    <div>
      <Bar segments={segments} />
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${s.tone}`} aria-hidden />
            <dt className="text-gray-500">{s.label}</dt>
            <dd className="ml-auto tabular-nums text-gray-900">{s.units}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-gray-500">
        Taahhüt: <strong className="tabular-nums">{progress.committedUnits}</strong> adet.
        Kovaların toplamı DAİMA taahhüde eşittir; &quot;İptal / iade&quot; kovası
        ötekilerin üstünde durur (iptal, sevk edilmiş bir partiyi de geriye dönük
        kapatır).
      </p>

      {byPart && byPart.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 pr-3">Parça</th>
                <th className="py-2 text-right">Taahhüt</th>
                {segments.map((s) => (
                  <th key={s.key} className="py-2 text-right">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byPart.map((row) => (
                <tr key={row.partId}>
                  <td className="py-2 pr-3 text-gray-900">
                    {partNames?.[row.partId] ?? row.partId}
                  </td>
                  <td className="py-2 text-right tabular-nums">{row.committedUnits}</td>
                  {progressSegments(row).map((s) => (
                    <td key={s.key} className="py-2 text-right tabular-nums text-gray-700">
                      {s.units}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
