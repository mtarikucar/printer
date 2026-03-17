"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

interface UserDropdownProps {
  user: { fullName: string; email: string };
  onLogout: () => void;
}

export function UserDropdown({ user, onLogout }: UserDropdownProps) {
  const d = useDictionary();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const initials =
    user.fullName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white text-sm font-bold hover:bg-green-400 transition-colors focus:ring-2 focus:ring-green-500/30 focus:outline-none"
        aria-label={d["nav.userMenu"]}
        aria-expanded={open}
      >
        {initials}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-bg-muted border border-bg-subtle rounded-xl shadow-elevated overflow-hidden animate-scale-in origin-top-right z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-bg-subtle">
            <p className="text-sm font-semibold text-text-primary truncate">
              {user.fullName}
            </p>
            <p className="text-xs text-text-muted truncate">{user.email}</p>
          </div>

          {/* Links */}
          <div className="py-1">
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-muted transition-colors"
            >
              <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {d["nav.myAccount"]}
            </Link>
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-muted transition-colors"
            >
              <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              {d["nav.myOrders"]}
            </Link>
            <Link
              href="/create"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-muted transition-colors"
            >
              <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {d["nav.createNew"]}
            </Link>
          </div>

          {/* Divider + Logout */}
          <div className="border-t border-bg-subtle py-1">
            <button
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-error hover:bg-error-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {d["nav.logout"]}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
