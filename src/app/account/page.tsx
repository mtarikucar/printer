"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RealtimeProvider } from "@/lib/realtime/provider";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useDictionary } from "@/lib/i18n/locale-context";
import { AccountGalleryCard } from "@/components/account-gallery-card";
import { AccountGalleryModal } from "@/components/account-gallery-modal";
import { AddressBookPanel } from "@/components/address-book-panel";
import { NotificationBell } from "@/components/notification-bell";
import { Button, Card } from "@/components/ui";
import type { AccountPreview } from "@/components/account-gallery-card";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { useLocale } from "@/lib/i18n/locale-context";
import { priceKindForStyle, getTemplate } from "@/lib/create/design-templates";
import type { Dictionary } from "@/lib/i18n/dictionaries";

interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  marketingConsent: boolean;
}

interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  figurineSize: string;
  style: string;
  amountKurus: number;
  createdAt: string;
  trackingNumber: string | null;
  thumbnailUrl: string | null;
  isPublic: boolean;
  glbUrl: string | null;
}

// The order-row secondary label. Creative Lab products (keychain/magnet/lamp)
// carry a neutral "orta" figurineSize placeholder, so show their real product
// name instead of a misleading size; everything else shows the size.
function orderItemLabel(order: CustomerOrder, d: Dictionary): string {
  const kind = priceKindForStyle(order.style);
  if (kind === "keychain" || kind === "fridge_magnet" || kind === "lamp") {
    const tpl = getTemplate(order.style);
    return (tpl && (d[tpl.labelKey as keyof typeof d] as string)) || order.style;
  }
  return (
    (d[`sizes.${order.figurineSize}` as keyof typeof d] as string) ||
    order.figurineSize
  );
}

export default function AccountPage() {
  return (
    <RealtimeProvider url="/api/realtime/customer">
      <AccountPageInner />
    </RealtimeProvider>
  );
}

function AccountPageInner() {
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

  // Realtime: refetch the orders list when any of the customer's orders changes
  // status. The notification bell (rendered below, inside the provider) also
  // refreshes itself on notification events.
  const refetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/customer/orders");
      if (res.ok) {
        const data = await res.json();
        setCustomerOrders(data.orders || []);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useRealtimeEvent((e) => {
    if (e.kind === "order") refetchOrders();
  });

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

  const toggleMarketingConsent = async () => {
    if (!user) return;
    const next = !user.marketingConsent;
    setUser({ ...user, marketingConsent: next });
    try {
      await fetch("/api/customer/marketing-consent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketingConsent: next }),
      });
    } catch {
      setUser((prev) => (prev ? { ...prev, marketingConsent: !next } : prev));
    }
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
      key: "addresses",
      label: d["account.tab.addresses"],
      desc: d["account.tab.addresses.desc"],
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0L6.343 16.657A8 8 0 1117.657 16.657z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
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
        {/* Breadcrumb + notifications */}
        <div className="flex items-center justify-between mb-6">
          <nav className="flex items-center gap-2 text-sm text-text-muted">
            <Link href="/" className="hover:text-green-500 transition-colors">
              {d["nav.home"]}
            </Link>
            <span>/</span>
            <span className="text-text-primary font-medium">{d["account.title"]}</span>
          </nav>
          <NotificationBell />
        </div>

        {/* Tab Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
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
              <Button href="/create" size="sm">
                {d["account.orders.new"]}
              </Button>
            </div>

            {previews.length === 0 ? (
              <Card className="p-12 text-center">
                <svg className="w-16 h-16 text-text-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <p className="mt-4 text-text-muted">{d["account.orders.empty"]}</p>
                <Button href="/create" className="mt-6 inline-flex">
                  {d["account.orders.createFirst"]}
                </Button>
              </Card>
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
                    <Button
                      onClick={loadMore}
                      loading={loadingMore}
                      variant="secondary"
                      size="sm"
                      className="!px-6"
                    >
                      {loadingMore ? d["account.gallery.loading"] : d["account.gallery.loadMore"]}
                    </Button>
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
              <Card className="p-12 text-center">
                <svg className="w-16 h-16 text-text-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="mt-4 text-text-muted">{d["account.orders.empty"]}</p>
                <Button href="/create" className="mt-6 inline-flex">
                  {d["account.orders.createFirst"]}
                </Button>
              </Card>
            ) : (
              <Card className="overflow-hidden">
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
                        return (
                          <tr key={order.id} className="hover:bg-bg-elevated/50 transition-colors">
                            <td className="py-3 px-4">
                              <span className="font-mono font-medium text-text-primary">{order.orderNumber}</span>
                            </td>
                            <td className="py-3 px-4 text-text-muted">{orderItemLabel(order, d)}</td>
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
                            <td className="py-3 px-4 text-right space-x-2">
                              <Link
                                href={`/track/${order.orderNumber}`}
                                className="text-green-500 hover:text-green-600 text-xs font-medium transition-colors"
                              >
                                {d["account.orders.track"]}
                              </Link>
                              {(!["pending_payment", "rejected"].includes(order.status)) && (
                                <ReorderButton orderNumber={order.orderNumber} />
                              )}
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
                          <span>{orderItemLabel(order, d)} &middot; {formatCurrency(order.amountKurus, locale)}</span>
                          <span>{formatDate(order.createdAt, locale)}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <Link
                            href={`/track/${order.orderNumber}`}
                            className="text-green-500 hover:text-green-600 text-xs font-medium transition-colors"
                          >
                            {d["account.orders.track"]} &rarr;
                          </Link>
                          {(!["pending_payment", "rejected"].includes(order.status)) && (
                            <ReorderButton orderNumber={order.orderNumber} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Tab: Addresses */}
        {tab === "addresses" && <AddressBookPanel />}

        {/* Tab: Profile */}
        {tab === "profile" && user && (
          <div className="animate-fade-in-up">
            <Card className="p-6 sm:p-8">
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
              <div className="py-3 border-t border-bg-subtle flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary">{d["account.emailPrefs.marketing"]}</p>
                  <p className="text-xs text-text-muted mt-0.5">{d["account.emailPrefs.hint"]}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={user.marketingConsent}
                  onClick={toggleMarketingConsent}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    user.marketingConsent ? "bg-green-500" : "bg-bg-subtle"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      user.marketingConsent ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              <div className="pt-4 border-t border-bg-subtle mt-2">
                <Button onClick={handleLogout} variant="secondary" size="sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  {d["common.logout"]}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {selected && (
        <AccountGalleryModal
          preview={selected}
          onClose={() => setSelected(null)}
          onPublishChanged={(previewId, newIsPublic) => {
            setPreviews((prev) =>
              prev.map((p) =>
                p.id === previewId && p.order
                  ? { ...p, order: { ...p.order, isPublic: newIsPublic } }
                  : p
              )
            );
          }}
        />
      )}
    </main>
  );
}

function ReorderButton({ orderNumber }: { orderNumber: string }) {
  const d = useDictionary();
  const [loading, setLoading] = useState(false);

  const handleReorder = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customer/orders/${orderNumber}/reorder`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || d["common.error"]);
        return;
      }
      const data = await res.json();
      if (data.iframeUrl) {
        window.location.href = data.iframeUrl;
        return;
      }
      if (data.paymentMethod === "bank_transfer") {
        window.location.href = data.redirectUrl ?? `/havale/${data.reference ?? data.orderNumber}`;
        return;
      }
    } catch {
      alert(d["common.error"]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleReorder}
      disabled={loading}
      className="text-blue-500 hover:text-blue-600 text-xs font-medium transition-colors disabled:text-gray-400"
    >
      {loading ? d["account.orders.reordering"] : d["account.orders.reorder"]}
    </button>
  );
}
