"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TurkeyMapSvg } from "@/components/turkey-map/turkey-map-svg";
import { PROVINCES } from "@/lib/data/turkey-address";
import type {
  CoverageAssignment,
  CoverageMaterial,
  CoveragePlan,
  CoverageCellSource,
} from "@/lib/services/coverage-plan";

/**
 * Hesaplanan etki alanı ekranı.
 *
 * İSTEMCİ PLANI HESAPLAMAZ — hazır gelir, burada yalnız SÜZÜLÜR ve çizilir.
 * Bir müdahaleden sonra `router.refresh()` çağrılır ve planı sunucu yeniden
 * hesaplar. İstemcide "pini uygula, sonucu tahmin et" gibi bir yol açmak,
 * hesabın ikinci bir kopyasını doğururdu.
 *
 * Servis modülünden YALNIZ TİP import edilir (`import type`): değer importu
 * `@/lib/db` üzerinden `pg`yi tarayıcı paketine sürükler ve sayfa
 * "Module not found: pg" ile 500 verir (bir kez yaşandı, bkz. network-map).
 */

export interface CoverageScreenWorkshop {
  id: string;
  name: string;
  il: string | null;
  hasRoom: boolean;
  loadUnits: number;
  maxConcurrentOrders: number;
  acceptingOrders: boolean;
  /** Sunucuda `manufacturerSupportsMaterial` ile çözülmüş malzemeler. */
  materials: string[];
}

export interface CoverageScreenOverride {
  il: string;
  material: string;
  kind: "pin" | "exclude";
  manufacturerId: string | null;
  note: string | null;
  createdBy: string;
  updatedAt: string | null;
}

const MATERIAL_LABEL: Record<string, string> = {
  resin: "Reçine",
  filament: "Filament",
};

const SOURCE_LABEL: Record<CoverageCellSource, string> = {
  computed: "Hesaplandı",
  pinned: "Pinli",
  excluded: "Dışlandı",
  unowned: "Sahipsiz",
};

const SOURCE_BADGE: Record<CoverageCellSource, string> = {
  computed: "bg-cyan-100 text-cyan-800",
  pinned: "bg-indigo-100 text-indigo-800",
  excluded: "bg-rose-100 text-rose-800",
  unowned: "bg-amber-100 text-amber-900",
};

/** Harita dolguları — rozet renkleriyle aynı aileden, tek bakışta eşlensin. */
const FILL: Record<CoverageCellSource, string> = {
  computed: "#0891B2",
  pinned: "#4F46E5",
  excluded: "#E11D48",
  unowned: "#F59E0B",
};
const FILL_IDLE = "#F1F5F9";

export function CoverageClient({
  plan,
  workshops,
  overrides,
}: {
  plan: CoveragePlan;
  workshops: CoverageScreenWorkshop[];
  overrides: CoverageScreenOverride[];
}) {
  const router = useRouter();
  const [material, setMaterial] = useState<CoverageMaterial>(plan.materials[0]);
  const [selectedIl, setSelectedIl] = useState<string | null>(null);
  const [hoverIl, setHoverIl] = useState<string | null>(null);
  const [pinTarget, setPinTarget] = useState<string>("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [onlyUnowned, setOnlyUnowned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(
    () => plan.assignments.filter((a) => a.material === material),
    [plan.assignments, material]
  );
  const byIl = useMemo(() => {
    const map = new Map<string, CoverageAssignment>();
    for (const r of rows) map.set(r.il, r);
    return map;
  }, [rows]);

  const overrideOf = (il: string | null) =>
    il
      ? overrides.find((o) => o.il === il && o.material === material) ?? null
      : null;

  const unownedRows = rows.filter((r) => r.source === "unowned");
  const selected = selectedIl ? byIl.get(selectedIl) ?? null : null;
  const selectedOverride = overrideOf(selectedIl);

  const visibleRows = rows.filter((r) => {
    if (onlyUnowned && r.source !== "unowned") return false;
    const q = query.trim().toLocaleLowerCase("tr");
    if (!q) return true;
    return (
      r.il.toLocaleLowerCase("tr").includes(q) ||
      (r.companyName ?? "").toLocaleLowerCase("tr").includes(q)
    );
  });

  // Fark: yalnız gerçekten DEĞİŞEN atölyeler. Değişmeyen satırları da yazmak,
  // "bugün ne değişti?" sorusunu 40 satırlık bir listenin içine gömerdi.
  const changedDiff = plan.diff.filter(
    (d) => d.added.length > 0 || d.removed.length > 0
  );

  async function send(
    body: Record<string, unknown>,
    method: "PUT" | "DELETE"
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // İKİ LİTERAL METOT, BİLEREK. Kısayol `method,` tarayıcıda çalışıyordu ama
      // sözleşme tarayıcısı (scripts/test-api-contracts.ts) fetch'in yanındaki
      // LİTERAL metni okur: değişkeni göremeyince GET varsayar, rota GET dışa
      // vermediği için depo kapısını "405" diye kırmızıya çevirirdi. Tarayıcıya
      // TS daraltmasını öğretmek, her çağrı yerinde tip çıkarımını yeniden
      // üretmek demekti; ucuzu, ekranın gerçekten kullandığı iki metodu yazılı
      // bırakmak — okuyan da hangi iki metodun gittiğini tek bakışta görür.
      const init = {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
      const res =
        method === "DELETE"
          ? await fetch("/api/admin/coverage", { method: "DELETE", ...init })
          : await fetch("/api/admin/coverage", { method: "PUT", ...init });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "İşlem tamamlanamadı");
      // Planı SUNUCU yeniden hesaplar; istemci tahmin yürütmez.
      startTransition(() => router.refresh());
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem tamamlanamadı");
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;

  function fillFor(il: string): string {
    const row = byIl.get(il);
    return row ? FILL[row.source] : FILL_IDLE;
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Hesaplanan etki alanı</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Etki alanı artık tek tek seçilmiyor: her il, her malzemede, yarıçap
          içindeki (~{plan.stats.radiusKm} km) en yakın uygun atölyeye
          hesaplanıyor. Uygun atölyesi olmayan il, uzaktaki bir atölyeye
          zorlanmaz — <strong>sahipsiz</strong> kalır ve aşağıda ayrı listelenir.
          Bu plan ana sayfadaki kapsama haritasını günceller. Yeni sıralama
          kuralları şimdilik gölgede karşılaştırılır; buradaki değişiklikler
          mevcut sipariş atamalarını değiştirmez.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Sahipsiz il", unownedRows.length, "text-amber-700"],
          [
            "Kapsanan il",
            rows.filter((r) => r.manufacturerId !== null).length,
            "text-cyan-700",
          ],
          ["Pinli", rows.filter((r) => r.source === "pinned").length, "text-indigo-700"],
          ["Dışlanan", rows.filter((r) => r.source === "excluded").length, "text-rose-700"],
          ["İş almayan atölye", plan.stats.idleWorkshops, "text-gray-700"],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
            <p className={`mt-0.5 text-2xl font-bold ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {plan.materials.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMaterial(m);
              setPinTarget("");
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              material === m
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {MATERIAL_LABEL[m] ?? m}
          </button>
        ))}
        <span className="text-xs text-gray-500">
          Plan malzeme bazında hesaplanır: bir atölye basmadığı malzemede il alamaz.
        </span>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* ── SAHİPSİZ İLLER: bu fazın asıl çıktısı ── */}
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">
          Sahipsiz iller — {MATERIAL_LABEL[material] ?? material} ({unownedRows.length})
        </h2>
        {unownedRows.length === 0 ? (
          <p className="mt-1 text-sm text-amber-800">
            Bu malzemede her il yarıçap içinde bir atölyeye düşüyor.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-amber-800">
              Bu illerde ~{plan.stats.radiusKm} km içinde uygun atölye yok. Sipariş
              yine atanır (plan bir kapı değildir); liste ağın nerede ince
              olduğunu söyler.
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {unownedRows.map((r) => (
                <li key={r.il} className="rounded-lg border border-amber-200 bg-white p-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedIl(r.il)}
                    className="text-left"
                  >
                    <p className="text-sm font-medium text-gray-900">{r.il}</p>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {r.nearestMiss
                        ? `En yakın: ${r.nearestMiss.companyName}${
                            r.nearestMiss.distanceKm !== null
                              ? ` (~${r.nearestMiss.distanceKm} km)`
                              : ""
                          } — ${r.nearestMiss.blockedBy}`
                        : r.reason}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── Harita ── */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <TurkeyMapSvg
            className="w-full"
            ariaLabel={`${MATERIAL_LABEL[material] ?? material} için hesaplanan etki alanı`}
            focusOrder={PROVINCES}
            selected={selectedIl}
            hovered={hoverIl}
            onHover={setHoverIl}
            onSelect={(il) => setSelectedIl(il)}
            onEscape={() => setSelectedIl(null)}
            ariaLabelFor={(il) => {
              const row = byIl.get(il);
              if (!row) return il;
              return `${il} — ${SOURCE_LABEL[row.source]}${
                row.companyName ? `: ${row.companyName}` : ""
              }`;
            }}
            provinceStyle={(il, s) => ({
              fill: fillFor(il),
              stroke: s.hovered || s.selected ? "#0F172A" : "#94A3B8",
              strokeWidth: s.hovered || s.selected ? 1.4 : 0.6,
              cursor: "pointer",
              transition: "fill 120ms ease",
            })}
          />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-600">
            {(Object.keys(SOURCE_LABEL) as CoverageCellSource[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: FILL[k] }}
                />
                {SOURCE_LABEL[k]}
              </span>
            ))}
          </div>
        </div>

        {/* ── Seçili il: müdahale paneli ── */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          {!selected ? (
            <p className="py-10 text-center text-sm text-gray-500">
              Bir ilin sahibini görmek ya da pin/dışlama koymak için haritadan
              veya listeden il seç.
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{selected.il}</h2>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    SOURCE_BADGE[selected.source]
                  }`}
                >
                  {SOURCE_LABEL[selected.source]}
                </span>
              </div>

              <p className="text-sm text-gray-700">
                {selected.companyName ? (
                  <>
                    <strong>{selected.companyName}</strong>
                    {selected.distanceKm !== null ? ` · ~${selected.distanceKm} km` : ""}
                  </>
                ) : (
                  "Sahibi yok"
                )}
              </p>
              <p className="text-xs text-gray-500">{selected.reason}</p>
              {selected.warning && (
                <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                  {selected.warning}
                </p>
              )}
              {selectedOverride && (
                <p className="text-[11px] text-gray-500">
                  Müdahaleyi yazan: {selectedOverride.createdBy}
                  {selectedOverride.updatedAt
                    ? ` · ${new Date(selectedOverride.updatedAt).toLocaleString("tr-TR")}`
                    : ""}
                </p>
              )}

              <div className="border-t border-gray-100 pt-3">
                <label
                  className="text-xs font-medium text-gray-600"
                  htmlFor="coverage-note"
                >
                  Not (isteğe bağlı)
                </label>
                <input
                  id="coverage-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder="Neden pinliyorsun / dışlıyorsun?"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label
                  className="text-xs font-medium text-gray-600"
                  htmlFor="coverage-pin"
                >
                  Pinlenecek atölye
                </label>
                <select
                  id="coverage-pin"
                  value={pinTarget}
                  onChange={(e) => setPinTarget(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-cyan-500"
                >
                  <option value="">Seç…</option>
                  {workshops.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} — {w.il ?? "il yok"} ·{" "}
                      {w.loadUnits}/{w.maxConcurrentOrders} birim
                      {w.materials.includes(material)
                        ? ""
                        : ` · ${MATERIAL_LABEL[material] ?? material} BASMIYOR`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!pinTarget || working}
                  onClick={() =>
                    void send(
                      {
                        il: selected.il,
                        material,
                        kind: "pin",
                        manufacturerId: pinTarget,
                        note: note.trim() || null,
                      },
                      "PUT"
                    )
                  }
                  className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
                >
                  Pinle
                </button>
                <p className="mt-1 text-[11px] text-gray-500">
                  Pin hesabı ve mesafeyi yener; kapasiteye de bakmaz. Pinli atölye
                  bugün uygun değilse satır uyarı taşır.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    void send(
                      {
                        il: selected.il,
                        material,
                        kind: "exclude",
                        note: note.trim() || null,
                      },
                      "PUT"
                    )
                  }
                  className="flex-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-40"
                >
                  Dışla
                </button>
                <button
                  type="button"
                  disabled={working || !selectedOverride}
                  onClick={() =>
                    void send({ il: selected.il, material }, "DELETE")
                  }
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  title={
                    selectedOverride
                      ? "Müdahaleyi kaldır, il hesaba dönsün"
                      : "Bu ilde müdahale yok"
                  }
                >
                  Hesaba döndür
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── İl listesi ── */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="İl veya atölye ara…"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={onlyUnowned}
              onChange={(e) => setOnlyUnowned(e.target.checked)}
            />
            Yalnız sahipsizler
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">İl</th>
                <th className="px-3 py-2">Durum</th>
                <th className="px-3 py-2">Atölye</th>
                <th className="px-3 py-2">Mesafe</th>
                <th className="px-3 py-2">Gerekçe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRows.map((r) => (
                <tr
                  key={r.il}
                  onClick={() => setSelectedIl(r.il)}
                  className={`cursor-pointer hover:bg-gray-50 ${
                    selectedIl === r.il ? "bg-cyan-50" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                    {r.il}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        SOURCE_BADGE[r.source]
                      }`}
                    >
                      {SOURCE_LABEL[r.source]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{r.companyName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                    {r.distanceKm !== null ? `~${r.distanceKm} km` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {r.warning ? `${r.reason} ${r.warning}` : r.reason}
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-500">
                    Eşleşen il yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bugünkü elle yazılmış listeyle fark ── */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">
          Elle yazılmış listeyle fark ({changedDiff.length} atölye)
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Solda bugün canlı skorun okuduğu liste (elle seçilen iller + konum ili),
          sağda hesabın verdiği iller (tüm malzemelerin birleşimi). Bu faz hiçbir
          şeyi değiştirmez: liste yalnızca geçişin neye mal olacağını gösterir.
        </p>
        {changedDiff.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            Hesap ile elle yazılmış listeler aynı.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {changedDiff.map((d) => (
              <li key={d.manufacturerId} className="rounded-lg border border-gray-100 p-3">
                <p className="text-sm font-medium text-gray-900">{d.companyName}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Elle: {d.typed.length} il · Hesap: {d.computed.length} il
                </p>
                {d.added.length > 0 && (
                  <p className="mt-1 text-xs text-cyan-800">
                    <strong>+ Hesapla gelen:</strong> {d.added.join(", ")}
                  </p>
                )}
                {d.removed.length > 0 && (
                  <p className="mt-1 text-xs text-rose-800">
                    <strong>− Hesapta olmayan:</strong> {d.removed.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
