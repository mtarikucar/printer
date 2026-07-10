"use client";

// Expandable application-details panel shared by the admin manufacturers and
// painters lists: shows everything the partner submitted at registration
// (contact, address, tax, bank, production choices, documents) so the admin can
// review the application without querying the DB. Turkish-only, like the rest
// of the admin panel.

import type { ReactNode } from "react";

export interface DetailSection {
  title: string;
  items: { k: string; v: ReactNode }[];
}

export function PartnerApplicationDetails({ sections }: { sections: DetailSection[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((s) => (
        <div key={s.title} className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
            {s.title}
          </h4>
          <dl className="space-y-1.5">
            {s.items.map((it) => (
              <div key={it.k} className="flex items-start justify-between gap-3 text-sm">
                <dt className="text-gray-500 shrink-0">{it.k}</dt>
                <dd className="text-gray-900 text-right break-words min-w-0">
                  {it.v ?? <span className="text-gray-400">—</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

// Consistent yes/no chip for boolean application choices.
export function BoolChip({ value, yes = "Evet", no = "Hayır" }: { value: boolean; yes?: string; no?: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
        value ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
      }`}
    >
      {value ? yes : no}
    </span>
  );
}
