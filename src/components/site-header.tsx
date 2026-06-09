"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDictionary } from "@/lib/i18n/locale-context";
import { LanguageSwitcher } from "@/components/language-switcher";
import { UserDropdown } from "@/components/user-dropdown";
import { Button } from "@/components/ui";
import { PRODUCT_CATEGORIES } from "@/lib/validators/product";

interface AuthUser {
  id: string;
  fullName: string;
  email: string;
}

export function SiteHeader() {
  const d = useDictionary();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/");
  };

  const initials = user?.fullName
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  // Marketplace-first nav: Pazaryeri (shop + categories) · Özel Üret (the
  // production paths) · Nasıl Çalışır. Each top item links to its hub; sub-items
  // open in a CSS-only dropdown (desktop) / nested list (mobile).
  const nav = [
    {
      key: "market",
      label: d["nav.market"],
      href: "/shop",
      items: [
        { href: "/shop", label: d["landing.market.cats.all"] },
        ...PRODUCT_CATEGORIES.map((c) => ({
          href: `/shop?category=${c}`,
          label: d[`product.category.${c}` as keyof typeof d],
        })),
      ],
    },
    {
      key: "custom",
      label: d["nav.custom"],
      href: "/create",
      items: [
        { href: "/create?path=figure", label: d["landing.market.produce.figure.title"] },
        { href: "/create?path=object", label: d["landing.market.produce.object.title"] },
        { href: "/create?path=upload", label: d["landing.market.produce.upload.title"] },
        { href: "/create?path=design", label: d["landing.market.produce.design.title"] },
        { href: "/gallery", label: d["nav.gallery"] },
        { href: "/figur", label: d["nav.styles"] },
      ],
    },
    {
      key: "how",
      label: d["nav.howItWorks"],
      href: "/nasil-calisir",
      items: [] as { href: string; label: string }[],
    },
  ];
  const accountLink = user
    ? { href: "/account", label: d["nav.myOrders"] }
    : null;

  return (
    <header className="sticky top-0 z-50 bg-bg-base/80 backdrop-blur-xl border-b border-bg-subtle/50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 text-xl text-text-primary">
          <span className="font-serif">Figurunica</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {nav.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <div key={item.key} className="relative group">
                <Link
                  href={item.href}
                  className={`relative flex items-center gap-1 py-1 text-sm font-medium transition-colors ${
                    active ? "text-green-500" : "text-text-muted hover:text-green-400"
                  }`}
                >
                  {item.label}
                  {item.items.length > 0 && (
                    <svg className="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </Link>
                {item.items.length > 0 && (
                  <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3 opacity-0 transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                    <div className="card min-w-[210px] p-1.5">
                      {item.items.map((sub) => (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className="block rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
                        >
                          {sub.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {accountLink && (
            <Link
              href={accountLink.href}
              className={`py-1 text-sm font-medium transition-colors ${
                pathname === accountLink.href ? "text-green-500" : "text-text-muted hover:text-green-400"
              }`}
            >
              {accountLink.label}
            </Link>
          )}
          <LanguageSwitcher />
          {authLoading ? (
            <div className="w-10 h-10 bg-bg-muted rounded-full animate-pulse" />
          ) : user ? (
            <UserDropdown user={user} onLogout={handleLogout} />
          ) : (
            <div className="flex items-center gap-3">
              <Button href="/login" variant="secondary" size="sm" className="!px-4">
                {d["nav.login"]}
              </Button>
              <Button href="/create" size="sm" className="!px-5">
                {d["landing.nav.getStarted"]}
              </Button>
            </div>
          )}
        </nav>

        {/* Mobile hamburger */}
        <div className="flex items-center gap-3 md:hidden">
          <LanguageSwitcher />
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 text-text-muted hover:text-text-primary transition-colors"
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
        <nav className="md:hidden border-t border-bg-subtle bg-bg-base/95 backdrop-blur-xl animate-fade-in">
          <div className="max-w-6xl mx-auto px-4 py-3 space-y-1">
            {nav.map((item) => (
              <div key={item.key} className="space-y-0.5">
                <Link
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`block py-3 px-4 rounded-xl text-sm font-semibold transition-colors ${
                    pathname === item.href
                      ? "bg-bg-elevated text-green-500"
                      : "text-text-primary hover:bg-bg-elevated"
                  }`}
                >
                  {item.label}
                </Link>
                {item.items.map((sub) => (
                  <Link
                    key={sub.href}
                    href={sub.href}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-xl py-2 pl-8 pr-4 text-sm text-text-secondary transition-colors hover:bg-bg-elevated"
                  >
                    {sub.label}
                  </Link>
                ))}
              </div>
            ))}
            {accountLink && (
              <Link
                href={accountLink.href}
                onClick={() => setMenuOpen(false)}
                className="block py-3 px-4 rounded-xl text-sm font-semibold text-text-primary hover:bg-bg-elevated"
              >
                {accountLink.label}
              </Link>
            )}

            {/* Divider */}
            <div className="border-t border-bg-subtle my-2" />

            {authLoading ? (
              <div className="py-3 px-4">
                <div className="w-24 h-5 bg-bg-muted rounded animate-pulse" />
              </div>
            ) : user ? (
              <>
                {/* User card */}
                <div className="flex items-center gap-3 py-3 px-4">
                  <span className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white text-base font-bold shrink-0">
                    {initials}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{user.fullName}</p>
                    <p className="text-xs text-text-muted truncate">{user.email}</p>
                  </div>
                </div>

                <Link
                  href="/account"
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-3 py-3 px-4 rounded-xl text-sm font-medium transition-colors ${
                    pathname === "/account"
                      ? "bg-bg-elevated text-green-500"
                      : "text-text-secondary hover:bg-bg-elevated"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {d["nav.myAccount"]}
                </Link>
                <Link
                  href="/create"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 py-3 px-4 rounded-xl text-sm font-medium text-text-secondary hover:bg-bg-elevated transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {d["nav.createNew"]}
                </Link>

                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex items-center gap-3 w-full text-left py-3 px-4 rounded-xl text-sm font-medium text-error hover:bg-error-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  {d["nav.logout"]}
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2 px-4 py-2">
                <Button
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  variant="secondary"
                  fullWidth
                  size="sm"
                  className="!py-3"
                >
                  {d["nav.login"]}
                </Button>
                <Button
                  href="/create"
                  onClick={() => setMenuOpen(false)}
                  fullWidth
                  size="sm"
                  className="!py-3"
                >
                  {d["landing.nav.getStarted"]}
                </Button>
              </div>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
