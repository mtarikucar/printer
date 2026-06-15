"use client";

import { useCallback, useMemo, useState } from "react";
import type { CategoryNode } from "@/lib/services/categories";

interface FlatNode {
  id: string;
  name: string;
  path: string;
  depth: number;
}

function flatten(nodes: CategoryNode[], out: FlatNode[] = []): FlatNode[] {
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, path: n.path, depth: n.depth });
    flatten(n.children, out);
  }
  return out;
}

export function CategoriesClient({ initialTree }: { initialTree: CategoryNode[] }) {
  const [tree, setTree] = useState<CategoryNode[]>(initialTree);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newRoot, setNewRoot] = useState("");

  const flat = useMemo(() => flatten(tree), [tree]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/categories");
    if (res.ok) setTree((await res.json()).tree ?? []);
  }, []);

  const run = useCallback(
    async (fn: () => Promise<Response>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "İşlem başarısız");
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "İşlem başarısız");
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const addChild = (parentId: string | null, name: string) =>
    run(() =>
      fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId, name }),
      })
    );

  const patch = (id: string, body: Record<string, unknown>) =>
    run(() =>
      fetch(`/api/admin/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );

  const remove = (id: string) =>
    run(() => fetch(`/api/admin/categories/${id}`, { method: "DELETE" }));

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Kategoriler</h1>
        <p className="text-sm text-gray-500 mt-1">
          İç içe, sınırsız derinlikte kategori ağacı (örn. Figürin → Marvel →
          Avengers). Ürünler herhangi bir seviyeye bağlanabilir.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Add root */}
      <form
        className="mb-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newRoot.trim()) {
            addChild(null, newRoot.trim());
            setNewRoot("");
          }
        }}
      >
        <input
          value={newRoot}
          onChange={(e) => setNewRoot(e.target.value)}
          placeholder="Yeni ana kategori adı"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <button
          type="submit"
          disabled={busy || !newRoot.trim()}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          Ana kategori ekle
        </button>
      </form>

      <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        {tree.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">
            Henüz kategori yok. Yukarıdan bir ana kategori ekleyin.
          </p>
        ) : (
          tree.map((n) => (
            <NodeRow
              key={n.id}
              node={n}
              flat={flat}
              busy={busy}
              onAddChild={addChild}
              onRename={(id, name) => patch(id, { action: "rename", name })}
              onMove={(id, parentId) => patch(id, { action: "move", parentId })}
              onReorder={(id, direction) => patch(id, { action: "reorder", direction })}
              onDelete={remove}
            />
          ))
        )}
      </div>
    </div>
  );
}

function NodeRow({
  node,
  flat,
  busy,
  onAddChild,
  onRename,
  onMove,
  onReorder,
  onDelete,
}: {
  node: CategoryNode;
  flat: FlatNode[];
  busy: boolean;
  onAddChild: (parentId: string, name: string) => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, parentId: string | null) => void;
  onReorder: (id: string, direction: "up" | "down") => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [childName, setChildName] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);

  // Valid move targets: every node except this one and its own subtree.
  const moveOptions = flat.filter(
    (f) => f.path !== node.path && !f.path.startsWith(node.path + "/")
  );

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50"
        style={{ paddingLeft: 12 + node.depth * 22 }}
      >
        <span className="text-gray-300">{node.children.length ? "▸" : "·"}</span>

        {editing ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (editName.trim()) {
                onRename(node.id, editName.trim());
                setEditing(false);
              }
            }}
          >
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-green-600 px-2 py-1 text-xs text-white"
            >
              Kaydet
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setEditName(node.name);
              }}
              className="rounded border border-gray-300 px-2 py-1 text-xs"
            >
              İptal
            </button>
          </form>
        ) : (
          <>
            <span className="flex-1 text-sm font-medium text-gray-800">
              {node.name}
              <span className="ml-2 font-mono text-[11px] text-gray-400">
                /{node.path}
              </span>
            </span>

            <div className="flex items-center gap-1">
              <IconBtn title="Yukarı" onClick={() => onReorder(node.id, "up")} busy={busy}>
                ↑
              </IconBtn>
              <IconBtn title="Aşağı" onClick={() => onReorder(node.id, "down")} busy={busy}>
                ↓
              </IconBtn>
              <IconBtn title="Alt kategori ekle" onClick={() => setAdding((s) => !s)} busy={busy}>
                +
              </IconBtn>
              <IconBtn title="Yeniden adlandır" onClick={() => setEditing(true)} busy={busy}>
                ✎
              </IconBtn>
              <select
                title="Taşı (üst kategoriyi değiştir)"
                value={node.parentId ?? ""}
                disabled={busy}
                onChange={(e) => onMove(node.id, e.target.value || null)}
                className="max-w-[120px] rounded border border-gray-200 px-1 py-0.5 text-xs text-gray-600"
              >
                <option value="">↳ Kök</option>
                {moveOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {"— ".repeat(o.depth)}
                    {o.name}
                  </option>
                ))}
              </select>
              <IconBtn
                title="Sil"
                onClick={() => {
                  if (
                    confirm(
                      `"${node.name}" ve tüm alt kategorileri silinecek. Bu kategorideki ürünler kategorisiz kalır. Emin misiniz?`
                    )
                  )
                    onDelete(node.id);
                }}
                busy={busy}
                danger
              >
                🗑
              </IconBtn>
            </div>
          </>
        )}
      </div>

      {adding && (
        <form
          className="flex gap-2 px-3 py-2"
          style={{ paddingLeft: 34 + node.depth * 22 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (childName.trim()) {
              onAddChild(node.id, childName.trim());
              setChildName("");
              setAdding(false);
            }
          }}
        >
          <input
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            autoFocus
            placeholder={`"${node.name}" altına yeni kategori`}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-green-600 px-3 py-1 text-xs text-white"
          >
            Ekle
          </button>
        </form>
      )}

      {node.children.map((c) => (
        <NodeRow
          key={c.id}
          node={c}
          flat={flat}
          busy={busy}
          onAddChild={onAddChild}
          onRename={onRename}
          onMove={onMove}
          onReorder={onReorder}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  busy,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  busy: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={busy}
      className={`flex h-6 w-6 items-center justify-center rounded text-xs disabled:opacity-40 ${
        danger
          ? "text-red-500 hover:bg-red-50"
          : "text-gray-500 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}
