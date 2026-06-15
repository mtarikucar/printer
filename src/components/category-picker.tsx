"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui";
import type { CategoryNode } from "@/lib/services/categories";

interface FlatOpt {
  id: string;
  name: string;
  depth: number;
}

/**
 * Single hierarchical category select for product create/edit. Loads the full
 * tree from /api/categories and flattens it with indentation, so a product can
 * be attached to ANY node (root or deep leaf) in one dropdown.
 */
export function CategoryPicker({
  value,
  onChange,
  placeholder = "Belirtilmedi",
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const [opts, setOpts] = useState<FlatOpt[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : { tree: [] }))
      .then(({ tree }: { tree: CategoryNode[] }) => {
        if (!alive) return;
        const out: FlatOpt[] = [];
        const walk = (nodes: CategoryNode[]) =>
          nodes.forEach((n) => {
            out.push({ id: n.id, name: n.name, depth: n.depth });
            walk(n.children);
          });
        walk(tree ?? []);
        setOpts(out);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {"  ".repeat(o.depth)}
          {o.depth > 0 ? "└ " : ""}
          {o.name}
        </option>
      ))}
    </Select>
  );
}
