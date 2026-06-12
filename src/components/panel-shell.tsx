"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Shared responsive shell for the admin + manufacturer panels.
 *
 * Desktop (lg+): static sidebar next to the content, identical to the old
 * `flex` layout. Mobile: the sidebar becomes an off-canvas drawer opened from
 * a sticky top bar; it closes on overlay tap, the X button, Escape, or any
 * route change (link taps inside the drawer navigate, so the pathname effect
 * covers them).
 */
export function PanelShell({
  title,
  sidebar,
  children,
}: {
  title: string;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-gray-200 bg-white px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Menüyü aç"
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="truncate text-sm font-semibold text-gray-900">{title}</span>
      </header>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 flex w-64 transition-[transform,visibility] duration-200 ease-in-out lg:static lg:z-auto lg:translate-x-0 lg:transition-none ${
          open ? "translate-x-0" : "invisible -translate-x-full lg:visible"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Menüyü kapat"
          className="absolute right-3 top-5 z-10 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:hidden"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {sidebar}
      </div>

      <main className="min-w-0 flex-1 overflow-auto text-gray-900">{children}</main>
    </div>
  );
}
