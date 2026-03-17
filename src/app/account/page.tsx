"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useDictionary } from "@/lib/i18n/locale-context";
import { AccountGalleryCard } from "@/components/account-gallery-card";
import { AccountGalleryModal } from "@/components/account-gallery-modal";
import type { AccountPreview } from "@/components/account-gallery-card";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { useLocale } from "@/lib/i18n/locale-context";

interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string;
}

interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  figurineSize: string;
  amountKurus: number;
  createdAt: string;
  trackingNumber: string | null;
  thumbnailUrl: string | null;
}

export default function AccountPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const d = useDictionary();
  const locale = useLocale();
  const tab = searchParams.get("tab") || "creations";
  const [user, setUser] = useState<User | null>(null);
  const [previews, setPreviews] = useState<AccountPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<AccountPreview | null>(null);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) {
          router.push("/login");
          return;
        }
        const meData = await meRes.json();
        setUser(meData.user);

        const [previewsRes, ordersRes] = await Promise.all([
          fetch("/api/customer/previews"),
          fetch("/api/customer/orders"),
        ]);

        if (previewsRes.ok) {
          const data = await previewsRes.json();
          setPreviews(data.previews);
          setCursor(data.nextCursor);
        }

        if (ordersRes.ok) {
          const data = await ordersRes.json();
          setCustomerOrders(data.orders || []);
        }
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/customer/previews?cursor=${encodeURIComponent(cursor)}`);
      if (res.ok) {
        const data = await res.json();
        setPreviews((prev) => [...prev, ...data.previews]);
        setCursor(data.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full" />
      </main>
    );
  }

  const initials = user?.fullName
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  const switchTab = (newTab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newTab === "creations") {
      params.delete("tab");
    } else {
      params.set("tab", newTab);
    }
    const qs = params.toString();
    router.push(`/account${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  const tabs = [
    {
      key: "creations",
      label: d["account.tab.creations"],
      desc: d["account.tab.creations.desc"],
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
    },
    {
      key: "orders",
      label: d["account.tab.orders"],
      desc: d["account.tab.orders.desc"],
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
    },
    {
      key: "profile",
      label: d["account.tab.profile"],
      desc: d["account.tab.profile.desc"],
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
  ];

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-text-muted mb-6">
          <Link href="/" className="hover:text-green-500 transition-colors">
            {d["nav.home"]}
          </Link>
          <span>/</span>
          <span className="text-text-primary font-medium">{d["account.title"]}</span>
        </nav>

        {/* Tab Bar */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`flex items-start gap-3 rounded-xl px-4 py-3 border transition-all cursor-pointer text-left ${
                tab === t.key
                  ? "bg-green-500/10 border-green-500/30 border-l-2 border-l-green-500"
                  : "bg-bg-surface border-bg-subtle hover:bg-bg-elevated hover:border-bg-subtle"
              }`}
            >
              <span className={`mt-0.5 shrink-0 ${tab === t.key ? "text-green-400" : "text-text-muted"}`}>
                {t.icon}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm leading-tight ${
                  tab === t.key ? "text-text-primary font-semibold" : "text-text-muted"
                }`}>
                  {t.label}
                </span>
                <span className="block text-xs text-text-muted mt-0.5 leading-tight">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Tab: Creations */}
        {tab === "creations" && (
          <div className="animate-fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-serif text-text-primary">{d["account.creations.title"]}</h2>
              <Link href="/create" className="btn-primary text-sm !py-2 !px-4">
                {d["account.orders.new"]}
              </Link>
            </div>

            {previews.length === 0 ? (
              <div className="card p-12 text-center">
                <svg className="w-16 h-16 text-text-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <p className="mt-4 text-text-muted">{d["account.orders.empty"]}</p>
                <Link href="/create" className="btn-primary mt-6 inline-flex">
                  {d["account.orders.createFirst"]}
                </Link>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {previews.map((preview) => (
                    <AccountGalleryCard
                      key={preview.id}
                      preview={preview}
                      onClick={() => setSelected(preview)}
                    />
                  ))}
                </div>
                {cursor && (
                  <div className="flex justify-center mt-6">
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="btn-secondary text-sm !py-2 !px-6"
                    >
                      {loadingMore ? d["account.gallery.loading"] : d["account.gallery.loadMore"]}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab: Orders */}
        {tab === "orders" && (
          <div className="animate-fade-in-up">
            {customerOrders.length === 0 ? (
              <div className="card p-12 text-center">
                <svg className="w-16 h-16 text-text-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="mt-4 text-text-muted">{d["account.orders.empty"]}</p>
                <Link href="/create" className="btn-primary mt-6 inline-flex">
                  {d["account.orders.createFirst"]}
                </Link>
              </div>
            ) : (
              <div className="card overflow-hidden">
                {/* Desktop table */}
                <div className="hidden sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-bg-subtle text-text-muted text-xs">
                        <th className="text-left py-3 px-4 font-medium">{d["account.orders.table.order"]}</th>
                        <th className="text-left py-3 px-4 font-medium">{d["account.orders.table.size"]}</th>
                        <th className="text-left py-3 px-4 font-medium">{d["account.orders.table.status"]}</th>
                        <th className="text-right py-3 px-4 font-medium">{d["account.orders.table.amount"]}</th>
                        <th className="text-right py-3 px-4 font-medium">{d["account.orders.table.date"]}</th>
                        <th className="py-3 px-4" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-bg-subtle">
                      {customerOrders.map((order) => {
                        const statusKey = `status.${order.status}` as keyof typeof d;
                        const sizeKey = `sizes.${order.figurineSize}` as keyof typeof d;
                        return (
                          <tr key={order.id} className="hover:bg-bg-elevated/50 transition-colors">
                            <td className="py-3 px-4">
                              <span className="font-mono font-medium text-text-primary">{order.orderNumber}</span>
                            </td>
                            <td className="py-3 px-4 text-text-muted">{d[sizeKey] || order.figurineSize}</td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                order.status === "delivered" ? "bg-green-500/15 text-green-400" :
                                order.status === "shipped" ? "bg-blue-500/15 text-blue-400" :
                                order.status === "printing" ? "bg-purple-500/15 text-purple-400" :
                                order.status === "rejected" ? "bg-red-500/15 text-red-400" :
                                "bg-yellow-500/15 text-yellow-400"
                              }`}>
                                {d[statusKey] || order.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-text-muted">{formatCurrency(order.amountKurus, locale)}</td>
                            <td className="py-3 px-4 text-right text-text-muted">{formatDate(order.createdAt, locale)}</td>
                            <td className="py-3 px-4 text-right">
                              <Link
                                href={`/track/${order.orderNumber}`}
                                className="text-green-500 hover:text-green-600 text-xs font-medium transition-colors"
                              >
                                {d["account.orders.track"]}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-bg-subtle">
                  {customerOrders.map((order) => {
                    const statusKey = `status.${order.status}` as keyof typeof d;
                    const sizeKey = `sizes.${order.figurineSize}` as keyof typeof d;
                    return (
                      <div key={order.id} className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono font-medium text-text-primary text-sm">{order.orderNumber}</span>
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            order.status === "delivered" ? "bg-green-500/15 text-green-400" :
                            order.status === "shipped" ? "bg-blue-500/15 text-blue-400" :
                            order.status === "printing" ? "bg-purple-500/15 text-purple-400" :
                            order.status === "rejected" ? "bg-red-500/15 text-red-400" :
                            "bg-yellow-500/15 text-yellow-400"
                          }`}>
                            {d[statusKey] || order.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-text-muted">
                          <span>{d[sizeKey] || order.figurineSize} &middot; {formatCurrency(order.amountKurus, locale)}</span>
                          <span>{formatDate(order.createdAt, locale)}</span>
                        </div>
                        <Link
                          href={`/track/${order.orderNumber}`}
                          className="mt-2 inline-block text-green-500 hover:text-green-600 text-xs font-medium transition-colors"
                        >
                          {d["account.orders.track"]} &rarr;
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab: Profile */}
        {tab === "profile" && user && (
          <div className="animate-fade-in-up">
            <div className="card p-6 sm:p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center text-white text-lg font-bold shrink-0">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-serif text-text-primary">{user.fullName}</h2>
                  <p className="text-sm text-text-muted">{user.email}</p>
                </div>
              </div>
              {user.phone && (
                <div className="py-3 border-t border-bg-subtle">
                  <span className="text-sm text-text-muted">{d["account.profile.phone"]}</span>
                  <p className="text-sm text-text-primary mt-0.5">{user.phone}</p>
                </div>
              )}
              <div className="pt-4 border-t border-bg-subtle mt-2">
                <button onClick={handleLogout} className="btn-secondary text-sm !py-2 !px-4">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  {d["common.logout"]}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <AccountGalleryModal
          preview={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}
