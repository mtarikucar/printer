"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDictionary } from "@/lib/i18n/locale-context";
import { LanguageSwitcher } from "@/components/language-switcher";
import { signOutAction } from "./actions";

export function AdminSidebar({
  reviewCount,
  pendingManufacturerCount,
  pendingProductCount,
  draftReviewCount,
  qcPendingCount,
}: {
  reviewCount: number;
  pendingManufacturerCount: number;
  pendingProductCount: number;
  draftReviewCount: number;
  qcPendingCount: number;
}) {
  const pathname = usePathname();
  const d = useDictionary();

  const groups: {
    titleKey: keyof typeof d;
    links: { href: string; label: string; icon: ReactNode; badge: number }[];
  }[] = [
    {
      titleKey: "admin.nav.group.general",
      links: [
        {
          href: "/admin/dashboard",
          label: d["admin.nav.dashboard"],
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
          badge: 0,
        },
        {
          href: "/admin/analytics",
          label: "Analitik",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
          badge: 0,
        },
      ],
    },
    {
      titleKey: "admin.nav.group.orders",
      links: [
        {
          href: "/admin/orders",
          label: d["admin.nav.orders"],
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />,
          badge: reviewCount,
        },
        {
          href: "/admin/drafts",
          label: "Taslaklar",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
          badge: draftReviewCount,
        },
        {
          href: "/admin/print-queue",
          label: d["admin.manufacturingQueue.title"],
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2z" />,
          badge: 0,
        },
        {
          href: "/admin/qc-queue",
          label: d["admin.nav.qcQueue"],
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
          badge: qcPendingCount,
        },
        {
          href: "/admin/upload-quotes",
          label: "Yükleme teklifleri",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />,
          badge: 0,
        },
      ],
    },
    {
      titleKey: "admin.nav.group.manufacturers",
      links: [
        {
          href: "/admin/manufacturers",
          label: d["admin.nav.manufacturers"],
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
          badge: pendingManufacturerCount,
        },
        {
          href: "/admin/products",
          label: d["admin.nav.products" as keyof typeof d] || "Ürünler",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
          badge: pendingProductCount,
        },
        {
          href: "/admin/payouts",
          label: "Ödemeler",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />,
          badge: 0,
        },
        {
          href: "/admin/kyc-queue",
          label: "KYC & Belgeler",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
          badge: 0,
        },
      ],
    },
    {
      titleKey: "admin.nav.group.customer",
      links: [
        {
          href: "/admin/disputes",
          label: "Anlaşmazlıklar",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
          badge: 0,
        },
        {
          href: "/admin/gift-cards",
          label: d["admin.nav.giftCards"],
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />,
          badge: 0,
        },
      ],
    },
    {
      titleKey: "admin.nav.group.content",
      links: [
        {
          // Merged: single Galeri entry. Queue + Published live under /admin/gallery?tab=
          href: "/admin/gallery",
          label: "Galeri",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.48 3.5l2.2 4.46 4.92.72-3.56 3.47.84 4.9L11.48 14.8 7.08 17.55l.84-4.9L4.36 9.18l4.92-.72 2.2-4.96z" />,
          badge: 0,
        },
      ],
    },
    {
      titleKey: "admin.nav.group.advanced",
      links: [
        {
          href: "/admin/scoring-evaluations",
          label: "Scoring v2",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
          badge: 0,
        },
      ],
    },
  ];

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">Figurunica</h1>
        <p className="text-xs text-gray-500 mt-1">Admin Panel</p>
      </div>
      <nav className="flex-1 p-4 space-y-5 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.titleKey} className="space-y-1">
            <h2 className="px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {d[group.titleKey]}
            </h2>
            {group.links.map((link) => {
              const isActive =
                pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive ? "bg-green-50 text-green-700 font-medium" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">{link.icon}</svg>
                    {link.label}
                  </span>
                  {link.badge > 0 && (
                    <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                      {link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-200 space-y-2">
        <div className="px-3">
          <LanguageSwitcher />
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {d["common.logout"]}
          </button>
        </form>
      </div>
    </aside>
  );
}
