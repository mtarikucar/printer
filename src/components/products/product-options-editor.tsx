"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProductConfig } from "@/lib/services/product-options";

interface ProductImage {
  id: string;
  url: string;
  optionChoiceId: string | null;
}

const tl = (kurus: number) => (kurus / 100).toString();
const toKurus = (tl: string) => Math.round((Number(tl.replace(",", ".")) || 0) * 100);

/**
 * Manage a product's options (variants) + add-ons + per-choice image tagging.
 * Embedded in both the admin and seller product edit forms; all writes go
 * through the shared /api/products/[id]/options route which authorizes
 * admin-any / seller-own.
 */
export function ProductOptionsEditor({ productId }: { productId: string }) {
  const [config, setConfig] = useState<ProductConfig>({ optionGroups: [], addons: [] });
  const [images, setImages] = useState<ProductImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [newAddon, setNewAddon] = useState("");

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/products/${productId}/options`);
    if (r.ok) {
      const d = await r.json();
      setConfig(d.config ?? { optionGroups: [], addons: [] });
      setImages(d.images ?? []);
    }
  }, [productId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(`/api/products/${productId}/options`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || "İşlem başarısız");
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "İşlem başarısız");
      } finally {
        setBusy(false);
      }
    },
    [productId, refresh]
  );

  const choiceLabel = (choiceId: string) => {
    for (const g of config.optionGroups) {
      const c = g.choices.find((x) => x.id === choiceId);
      if (c) return `${g.name}: ${c.name}`;
    }
    return choiceId;
  };
  const allChoices = config.optionGroups.flatMap((g) =>
    g.choices.map((c) => ({ id: c.id, label: `${g.name}: ${c.name}` }))
  );

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Seçenekler &amp; Eklentiler</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Seçenekler fiyatı değiştirir ve (el boyaması gibi) görsel setini değiştirebilir.
          Eklentiler sabit fiyatlı ek hizmetlerdir.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Options ── */}
      <section className="space-y-3">
        <h4 className="text-sm font-medium text-gray-700">Seçenekler (tek seçim grupları)</h4>
        {config.optionGroups.map((g) => (
          <div key={g.id} className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center gap-2">
              <input
                defaultValue={g.name}
                onBlur={(e) =>
                  e.target.value.trim() !== g.name &&
                  act({ action: "updateGroup", groupId: g.id, name: e.target.value })
                }
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-medium"
              />
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={g.isRequired}
                  onChange={(e) =>
                    act({ action: "updateGroup", groupId: g.id, isRequired: e.target.checked })
                  }
                />
                Zorunlu
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => act({ action: "deleteGroup", groupId: g.id })}
                className="text-xs text-red-500 hover:underline"
              >
                Grubu sil
              </button>
            </div>

            <div className="mt-2 space-y-1.5 pl-2">
              {g.choices.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`default-${g.id}`}
                    title="Varsayılan seçim"
                    checked={c.isDefault}
                    onChange={() =>
                      act({ action: "updateChoice", choiceId: c.id, isDefault: true })
                    }
                  />
                  <input
                    defaultValue={c.name}
                    onBlur={(e) =>
                      e.target.value.trim() !== c.name &&
                      act({ action: "updateChoice", choiceId: c.id, name: e.target.value })
                    }
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                  <div className="flex items-center gap-1 text-sm">
                    <span className="text-gray-400">+₺</span>
                    <input
                      defaultValue={tl(c.priceDeltaKurus)}
                      onBlur={(e) =>
                        act({
                          action: "updateChoice",
                          choiceId: c.id,
                          priceDeltaKurus: toKurus(e.target.value),
                        })
                      }
                      inputMode="decimal"
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-right"
                    />
                  </div>
                  {c.hasImages && (
                    <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700">
                      görselli
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act({ action: "deleteChoice", choiceId: c.id })}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <AddInline
                placeholder="Yeni seçenek (ör. El boyaması)"
                busy={busy}
                onAdd={(name) =>
                  act({ action: "addChoice", groupId: g.id, name, priceDeltaKurus: 0 })
                }
              />
            </div>
          </div>
        ))}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newGroup.trim()) {
              act({ action: "createGroup", name: newGroup.trim() });
              setNewGroup("");
            }
          }}
        >
          <input
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            placeholder="Yeni seçenek grubu (ör. Boyama)"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !newGroup.trim()}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Grup ekle
          </button>
        </form>
      </section>

      {/* ── Add-ons ── */}
      <section className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700">Eklentiler (çok seçimli ek hizmetler)</h4>
        {config.addons.map((a) => (
          <div key={a.id} className="flex items-center gap-2">
            <input
              defaultValue={a.name}
              onBlur={(e) =>
                e.target.value.trim() !== a.name &&
                act({ action: "updateAddon", addonId: a.id, name: e.target.value })
              }
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <input
              defaultValue={a.description ?? ""}
              placeholder="açıklama"
              onBlur={(e) =>
                (e.target.value || "") !== (a.description ?? "") &&
                act({ action: "updateAddon", addonId: a.id, description: e.target.value })
              }
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <div className="flex items-center gap-1 text-sm">
              <span className="text-gray-400">+₺</span>
              <input
                defaultValue={tl(a.priceKurus)}
                onBlur={(e) =>
                  act({ action: "updateAddon", addonId: a.id, priceKurus: toKurus(e.target.value) })
                }
                inputMode="decimal"
                className="w-20 rounded border border-gray-300 px-2 py-1 text-right"
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => act({ action: "deleteAddon", addonId: a.id })}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              ✕
            </button>
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newAddon.trim()) {
              act({ action: "createAddon", name: newAddon.trim(), priceKurus: 0 });
              setNewAddon("");
            }
          }}
        >
          <input
            value={newAddon}
            onChange={(e) => setNewAddon(e.target.value)}
            placeholder="Yeni eklenti (ör. Hediye paketi)"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !newAddon.trim()}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Eklenti ekle
          </button>
        </form>
      </section>

      {/* ── Image → choice tagging (painted set) ── */}
      {images.length > 0 && allChoices.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">Görsel ataması</h4>
          <p className="text-xs text-gray-500">
            Bir görseli bir seçeneğe atayın (ör. boyalı fotoğraflar → “El boyaması”).
            Atanmamış görseller varsayılan galeridir (boyasız).
          </p>
          <div className="flex flex-wrap gap-3">
            {images.map((img) => (
              <div key={img.id} className="w-28">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt=""
                  className="h-24 w-28 rounded-lg border border-gray-200 object-cover"
                />
                <select
                  value={img.optionChoiceId ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    act({
                      action: "tagImage",
                      imageId: img.id,
                      optionChoiceId: e.target.value || null,
                    })
                  }
                  className="mt-1 w-full rounded border border-gray-200 px-1 py-0.5 text-[11px]"
                >
                  <option value="">Varsayılan (boyasız)</option>
                  {allChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {images.some((i) => i.optionChoiceId) && (
            <p className="text-[11px] text-gray-400">
              Atalı görseller:{" "}
              {[...new Set(images.filter((i) => i.optionChoiceId).map((i) => choiceLabel(i.optionChoiceId!)))].join(
                ", "
              )}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function AddInline({
  placeholder,
  busy,
  onAdd,
}: {
  placeholder: string;
  busy: boolean;
  onAdd: (name: string) => void;
}) {
  const [v, setV] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) {
          onAdd(v.trim());
          setV("");
        }
      }}
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded border border-gray-200 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={busy || !v.trim()}
        className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200 disabled:opacity-50"
      >
        + Seçenek
      </button>
    </form>
  );
}
