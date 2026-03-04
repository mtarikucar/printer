"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDictionary } from "@/lib/i18n/locale-context";
import { LanguageSwitcher } from "@/components/language-switcher";

export function SiteHeader({ showAuth = true }: { showAuth?: boolean }) {
  const d = useDictionary();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = [
    { href: "/gallery", label: d["nav.gallery"] },
    { href: "/create", label: d["nav.create"] },
  ];

  return (
    <header className="sticky top-0 z-50 glass-strong">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <svg className="w-7 h-7 text-primary-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
          </svg>
          <span>Figurine Studio</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="relative text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors py-1"
            >
              {link.label}
              {pathname === link.href && (
                <span className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-primary-600 rounded-full" />
              )}
            </Link>
          ))}
          <LanguageSwitcher />
          {showAuth && (
            <>
              <Link
                href="/login"
                className="relative text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors py-1"
              >
                {d["nav.login"]}
                {pathname === "/login" && (
                  <span className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-primary-600 rounded-full" />
                )}
              </Link>
              <Link
                href="/create"
                className="btn-primary text-sm !py-2 !px-5"
              >
                {d["landing.nav.getStarted"]}
              </Link>
            </>
          )}
        </nav>

        {/* Mobile hamburger */}
        <div className="flex items-center gap-3 md:hidden">
          <LanguageSwitcher />
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 text-gray-600 hover:text-gray-900 transition-colors"
            aria-label={d["nav.menu"]}
          >
            {menuOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="md:hidden border-t border-surface-200 glass-strong animate-fade-in">
          <div className="max-w-6xl mx-auto px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`block py-3 px-4 rounded-xl text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "bg-primary-50 text-primary-700"
                    : "text-gray-700 hover:bg-surface-100"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {showAuth && (
              <>
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className={`block py-3 px-4 rounded-xl text-sm font-medium transition-colors ${
                    pathname === "/login"
                      ? "bg-primary-50 text-primary-700"
                      : "text-gray-700 hover:bg-surface-100"
                  }`}
                >
                  {d["nav.login"]}
                </Link>
                <Link
                  href="/create"
                  onClick={() => setMenuOpen(false)}
                  className="btn-primary w-full text-sm !py-3 mt-2"
                >
                  {d["landing.nav.getStarted"]}
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
