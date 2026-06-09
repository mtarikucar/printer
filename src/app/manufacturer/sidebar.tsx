"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDictionary } from "@/lib/i18n/locale-context";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useState } from "react";

export function ManufacturerSidebar({
  newAssignmentCount,
}: {
  newAssignmentCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const d = useDictionary();
  const [loggingOut, setLoggingOut] = useState(false);

  const links = [
    {
      href: "/manufacturer/orders",
      label: d["manufacturer.nav.orders" as keyof typeof d] || "Orders",
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        />
      ),
      badge: newAssignmentCount,
    },
    {
      href: "/manufacturer/products",
      label: d["manufacturer.nav.products" as keyof typeof d] || "Ürünlerim",
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
        />
      ),
      badge: 0,
    },
    {
      href: "/manufacturer/earnings",
      label: d["manufacturer.nav.earnings" as keyof typeof d] || "Earnings",
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      ),
      badge: 0,
    },
    {
      href: "/manufacturer/notifications",
      label: "Bildirimler",
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      ),
      badge: 0,
    },
    {
      href: "/manufacturer/profile",
      label: d["manufacturer.nav.profile" as keyof typeof d] || "Profile",
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      ),
      badge: 0,
    },
  ];

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/manufacturer/auth/logout", { method: "POST" });
      router.push("/manufacturer/login");
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">Figurunica</h1>
        <p className="text-xs text-indigo-600 mt-1">
          {d["manufacturer.nav.panel" as keyof typeof d] || "Manufacturer Panel"}
        </p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {links.map((link) => {
          const isActive = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700 font-medium"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="flex items-center gap-3">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  {link.icon}
                </svg>
                {link.label}
              </span>
              {link.badge > 0 && (
                <span className="bg-indigo-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                  {link.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-gray-200 space-y-2">
        <div className="px-3">
          <LanguageSwitcher />
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          {d["common.logout" as keyof typeof d] || "Logout"}
        </button>
      </div>
    </aside>
  );
}
