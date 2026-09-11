"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PROVINCES } from "@/lib/data/turkey-address";
import {
  PROVINCES_BY_REGION,
  REGION_IDS,
  REGION_LABELS,
  type Region,
} from "@/lib/data/turkey-regions";
import { normalizeCoverage } from "@/lib/validators/network-map";
import { effectiveCoverage, isPubliclyOnMap } from "@/lib/config/network-map";
import type { AdminNetworkPartner } from "@/lib/services/network-map";
import { TurkeyMapSvg } from "@/components/turkey-map/turkey-map-svg";

/**
 * Etki alanı editörü: solda partner listesi, sağda harita.
 *
 * Haritaya tıklamak SİPARİŞ YÖNLENDİRMESİNİ değiştirir (kapsanan il mesafe
 * skorunda 85 alır), bu yüzden sonucun her zaman ekranda yazılı olması gerekir
 * — admin burada pazarlama rozeti değil operasyonel karar veriyor.
 */

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  suspended: "bg-red-100 text-red-700",
  conditionally_approved: "bg-blue-100 text-blue-700",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  suspended: "Askıda",
  conditionally_approved: "Şartlı onay",
};

/** Bu sayının üstünde seçim yerelliği fiilen kapatır — uyarı eşiği. */
const WIDE_COVERAGE_WARNING = 20;

const FILL = {
  idle: "#F1F5F9",
  selected: "#0891B2",
  home: "#164E63",
  ghost: "#CBD5E1",
};

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function NetworkMapClient({
  partners,
  initialPartnerId,
}: {
  partners: AdminNetworkPartner[];
  initialPartnerId: string | null;
}) {
  const [rows, setRows] = useState(partners);
  const [selectedId, setSelectedId] = useState<string | null>(initialPartnerId);
  const [draft, setDraft] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "manufacturer" | "painter">("all");
  const [showGhosts, setShowGhosts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIl, setHoverIl] = useState<string | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState<string | null>(null);
  const [ilQuery, setIlQuery] = useState("");

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const savedCoverage = useMemo(
    () => (selected ? normalizeCoverage(selected.coverage) : []),
    [selected]
  );
  const dirty = !!selected && !sameSet(draft, savedCoverage);

  // Taslağı SADECE partner değişince sıfırla — bağımlılık `selectedId`, memo'lanmış
  // dizi DEĞİL. `savedCoverage` seçili satırın NESNE KİMLİĞİNE bağlı; göz düğmesi
  // iyimser güncellemeyle o satırı yeniden yarattığı için memo yeniden hesaplanıyor
  // ve bu effect ateşleniyordu: kaydedilmemiş kapsama taslağı, switchPartner'daki
  // onay penceresine hiç uğramadan siliniyordu. Aynı sebeple `setError(null)` de
  // buradan çıktı — başarısız bir PATCH'in rollback'i satırı yine değiştirdiği için
  // hata mesajı bir sonraki commit'te siliniyor, admin uyarıyı hiç görmüyordu.
  const loadedForId = useRef<string | null>(null);
  useEffect(() => {
    if (loadedForId.current === selectedId) return;
    loadedForId.current = selectedId;
    setDraft(selectedId ? normalizeCoverage(rows.find((r) => r.id === selectedId)?.coverage ?? []) : []);
    setError(null);
  }, [selectedId, rows]);

  // Kaydedilmemiş değişiklikle sekmeyi kapatmak veri kaybıdır.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const filtered = rows.filter((r) => {
    if (kindFilter !== "all" && r.kind !== kindFilter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLocaleLowerCase("tr");
    return (
      r.companyName.toLocaleLowerCase("tr").includes(q) ||
      (r.il ?? "").toLocaleLowerCase("tr").includes(q)
    );
  });

  // Diğer partnerlerin kapsaması — "burayı zaten biri karşılıyor mu?" sorusu
  // admin'in tam olarak verdiği karardır.
  const ghostCoverage = useMemo(() => {
    const set = new Set<string>();
    if (!showGhosts) return set;
    for (const r of rows) {
      if (r.id === selectedId || r.kind !== "manufacturer") continue;
      for (const il of effectiveCoverage(r.coverage, r.il)) set.add(il);
    }
    return set;
  }, [rows, selectedId, showGhosts]);

  const draftSet = useMemo(() => new Set(draft), [draft]);
  const editable = selected?.kind === "manufacturer";

  function switchPartner(id: string) {
    if (dirty && !window.confirm("Kaydedilmemiş değişiklikler var. Yine de geçilsin mi?")) {
      return;
    }
    setSelectedId(id);
  }

  function toggleIl(il: string) {
    if (!editable) return;
    setDraft((cur) =>
      cur.includes(il) ? cur.filter((x) => x !== il) : normalizeCoverage([...cur, il])
    );
  }

  function applyRegion(region: Region, add: boolean) {
    if (!editable) return;
    const list = PROVINCES_BY_REGION[region];
    setDraft((cur) =>
      add
        ? normalizeCoverage([...cur, ...list])
        : cur.filter((il) => !list.includes(il))
    );
  }

  async function save() {
    if (!selected || !editable) return;
    setSaving(true);
    setError(null);
    // Gönderilen listeyi dondur: harita, çipler ve bölge düğmeleri istek uçarken
    // açık kalıyor. Sunucunun yankısını koşulsuz yazsaydık, bekleme sırasında
    // seçilen iller sessizce silinir ve arayüz "kaydedilecek bir şey yok" derdi.
    const payload = draft;
    try {
      const res = await fetch(`/api/admin/manufacturers/${selected.id}/coverage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverageProvinces: payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Kaydedilemedi");
      const saved: string[] = body.coverageProvinces ?? payload;
      setRows((cur) => cur.map((r) => (r.id === selected.id ? { ...r, coverage: saved } : r)));
      setDraft((cur) => (sameSet(cur, payload) ? saved : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  async function toggleVisible(row: AdminNetworkPartner) {
    if (visibilityBusy) return;
    const next = !row.mapVisible;
    const url =
      row.kind === "manufacturer"
        ? `/api/admin/manufacturers/${row.id}/coverage`
        : `/api/admin/painters/${row.id}/coverage`;
    setVisibilityBusy(row.id);
    setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, mapVisible: next } : r)));
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapVisible: next }),
      });
      if (!res.ok) throw new Error("reddedildi");
    } catch {
      // Ağ da reddedebilir (çevrimdışı, deploy sırasında yeniden başlatma). İki
      // yolu da geri almazsak ekran "gizlendi" der ama DB'de hâlâ yayında olur —
      // gizlilik düğmesinde bu kabul edilemez bir yalan.
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, mapVisible: !next } : r)));
      setError("Görünürlük güncellenemedi");
    } finally {
      setVisibilityBusy(null);
    }
  }

  const ilSuggestions = ilQuery.trim()
    ? PROVINCES.filter(
        (il) =>
          il.toLocaleLowerCase("tr").startsWith(ilQuery.trim().toLocaleLowerCase("tr")) &&
          !draftSet.has(il)
      ).slice(0, 6)
    : [];

  function fillFor(il: string): string {
    if (selected?.il === il) return FILL.home;
    if (draftSet.has(il)) return FILL.selected;
    if (ghostCoverage.has(il)) return FILL.ghost;
    return FILL.idle;
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Üretim ağı haritası</h1>
        <p className="mt-1 text-sm text-gray-500">
          Her üreticinin sorumlu olduğu illeri harita üzerinden belirle. Seçilen iller
          anasayfadaki public haritada görünür ve o illerden gelen siparişlerde bu atölye
          atama sıralamasında öne çıkar.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* ── Partner listesi ── */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="space-y-2 border-b border-gray-100 p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Partner veya il ara…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
            />
            <div className="flex gap-1.5">
              {(
                [
                  ["all", "Tümü"],
                  ["manufacturer", "Üretici"],
                  ["painter", "Boyacı"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    kindFilter === k
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ul className="max-h-[38rem] divide-y divide-gray-100 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="p-6 text-center text-sm text-gray-500">Partner bulunamadı.</li>
            )}
            {filtered.map((r) => {
              const isSel = r.id === selectedId;
              const cover = effectiveCoverage(r.coverage, r.il);
              return (
                <li key={r.id} className={isSel ? "bg-cyan-50" : ""}>
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => switchPartner(r.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            r.kind === "manufacturer" ? "bg-cyan-500" : "bg-amber-500"
                          }`}
                        />
                        <span className="truncate text-sm font-medium text-gray-900">
                          {r.companyName}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 pl-4 text-xs text-gray-500">
                        <span>{r.il ?? "İl yok"}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                        {r.kind === "manufacturer" && <span>{cover.length} il</span>}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleVisible(r)}
                      title={
                        isPubliclyOnMap(r.status, r.mapVisible)
                          ? "Public haritada yayında"
                          : r.mapVisible
                            ? `Haritada izinli ama yayında değil (durum: ${STATUS_LABEL[r.status] ?? r.status})`
                            : "Haritadan gizli"
                      }
                      aria-label={r.mapVisible ? "Haritadan gizle" : "Haritada göster"}
                      aria-pressed={r.mapVisible}
                      disabled={visibilityBusy === r.id}
                      className={`shrink-0 rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
                        isPubliclyOnMap(r.status, r.mapVisible)
                          ? "text-cyan-600 hover:bg-cyan-100"
                          : r.mapVisible
                            ? "text-gray-400 hover:bg-gray-100"
                            : "text-gray-300 hover:bg-gray-100"
                      }`}
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {r.mapVisible ? (
                          <>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M2.036 12.322a1 1 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </>
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.774 3.162 10.066 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243" />
                        )}
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ── Harita + düzenleme ── */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          {!selected ? (
            <p className="py-16 text-center text-sm text-gray-500">
              Etki alanını düzenlemek için soldan bir partner seç.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{selected.companyName}</h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {selected.il ? (
                      <>
                        Konum ili <strong className="text-gray-700">{selected.il}</strong> — partnerin
                        adresinden gelir, buradan değiştirilemez ve etki alanına her zaman dâhildir.
                      </>
                    ) : (
                      <span className="text-amber-600">
                        Bu partnerin adresinde il yok — haritada konumu görünmez, yine de etki alanı
                        tanımlayabilirsin.
                      </span>
                    )}
                  </p>
                </div>
                {editable && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft(savedCoverage)}
                      disabled={!dirty || saving}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      onClick={save}
                      disabled={!dirty || saving}
                      className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-700 disabled:opacity-40"
                    >
                      {saving ? "Kaydediliyor…" : "Kaydet"}
                    </button>
                  </div>
                )}
              </div>

              {!editable && (
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Boyacılarda etki alanı yoktur — boyacıyı üretici elle seçer. Buradan yalnız
                  haritada görünürlüğü değiştirilebilir.
                </p>
              )}

              {error && (
                <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              )}

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
                <div>
                  <TurkeyMapSvg
                    className="w-full"
                    ariaLabel={`${selected.companyName} etki alanı düzenleyicisi`}
                    // Klavyeyle de düzenlenebilmeli: focusOrder olmadan path'ler
                    // role="button" taşıyıp hiç sekme durağı almıyordu, yani
                    // sayfanın vaat ettiği "harita üzerinden belirle" akışı fare
                    // olmadan tümüyle erişilemezdi.
                    focusOrder={editable ? PROVINCES : undefined}
                    isSelected={(il) => draftSet.has(il)}
                    hovered={hoverIl}
                    onHover={setHoverIl}
                    onSelect={toggleIl}
                    isInteractive={() => editable}
                    ariaLabelFor={(il) =>
                      `${il}${draftSet.has(il) ? " — etki alanında" : ""}${
                        selected.il === il ? " — konum ili" : ""
                      }`
                    }
                    provinceStyle={(il, s) => ({
                      fill: fillFor(il),
                      stroke: s.hovered ? "#0E7490" : "#94A3B8",
                      strokeWidth: s.hovered ? 1.4 : 0.6,
                      cursor: editable ? "pointer" : "default",
                      transition: "fill 120ms ease",
                    })}
                  />
                  <p className="mt-1 text-center text-xs text-gray-500">
                    {hoverIl ?? "İl seçmek için haritaya tıkla"}
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {draft.length} il seçili
                      {selected.il && !draftSet.has(selected.il) ? " + konum ili" : ""}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Bu iller için atama sıralamasında öne çıkar (mesafe skoru 85).
                    </p>
                    {draft.length > WIDE_COVERAGE_WARNING && (
                      <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                        {draft.length} il çok geniş: bu atölye ülke genelinde, siparişle aynı bölgede
                        olan rakiplerinin önüne geçer. Yalnız gerçekten sorumlu olduğu illeri seç.
                      </p>
                    )}
                  </div>

                  {editable && (
                    <div>
                      <label className="text-xs font-medium text-gray-600" htmlFor="il-add">
                        İl ekle
                      </label>
                      <input
                        id="il-add"
                        value={ilQuery}
                        onChange={(e) => setIlQuery(e.target.value)}
                        placeholder="İl adı yaz…"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-cyan-500"
                      />
                      {ilSuggestions.length > 0 && (
                        <ul className="mt-1 overflow-hidden rounded-lg border border-gray-200">
                          {ilSuggestions.map((il) => (
                            <li key={il}>
                              <button
                                type="button"
                                onClick={() => {
                                  toggleIl(il);
                                  setIlQuery("");
                                }}
                                className="w-full px-2.5 py-1.5 text-left text-sm hover:bg-cyan-50"
                              >
                                {il}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {editable && (
                    <div>
                      <p className="text-xs font-medium text-gray-600">Bölge</p>
                      <div className="mt-1.5 space-y-1">
                        {REGION_IDS.map((region) => (
                          <div key={region} className="flex items-center justify-between gap-2">
                            <span className="text-xs text-gray-700">{REGION_LABELS[region]}</span>
                            <span className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => applyRegion(region, true)}
                                className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
                              >
                                Ekle
                              </button>
                              <button
                                type="button"
                                onClick={() => applyRegion(region, false)}
                                className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
                              >
                                Çıkar
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={showGhosts}
                      onChange={(e) => setShowGhosts(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    Diğer üreticilerin kapsamasını göster
                  </label>

                  {draft.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-600">Seçili iller</p>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => setDraft([])}
                            className="text-[11px] text-gray-500 underline hover:text-gray-700"
                          >
                            Tümünü temizle
                          </button>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {draft.map((il) => (
                          <button
                            key={il}
                            type="button"
                            onClick={() => toggleIl(il)}
                            disabled={!editable}
                            className="rounded-md bg-cyan-50 px-2 py-0.5 text-[11px] text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
                          >
                            {il} ×
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
