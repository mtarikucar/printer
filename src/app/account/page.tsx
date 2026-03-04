"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency, formatDate } from "@/lib/i18n/format";

interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string;
}

interface Order {
  orderNumber: string;
  status: string;
  figurineSize: string;
  amountKurus: number;
  createdAt: string;
  trackingNumber: string | null;
  isPublic: boolean;
}

export default function AccountPage() {
  const router = useRouter();
  const d = useDictionary();
  const locale = useLocale();
  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

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

        const ordersRes = await fetch("/api/customer/orders");
        if (ordersRes.ok) {
          const ordersData = await ordersRes.json();
          setOrders(ordersData.orders);
        }
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

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

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-text-muted mb-6">
          <Link href="/" className="hover:text-green-500 transition-colors">
            {d["nav.home"]}
          </Link>
          <span>/</span>
          <span className="text-text-primary font-medium">{d["account.title"]}</span>
        </nav>

        {/* Profile card */}
        {user && (
          <div className="card overflow-hidden animate-fade-in-up">
            <div className="h-2 bg-gradient-to-r from-green-500 to-beige-400" />
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center text-white text-lg font-bold shrink-0">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl font-serif text-text-primary">{user.fullName}</h1>
                  <p className="text-sm text-text-muted">{user.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="btn-secondary text-sm !py-2 !px-4"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  {d["common.logout"]}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Orders */}
        <div className="mt-8 animate-fade-in-up delay-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-serif text-text-primary">{d["account.orders.title"]}</h2>
            <Link href="/create" className="btn-primary text-sm !py-2 !px-4">
              {d["account.orders.new"]}
            </Link>
          </div>

          {orders.length === 0 ? (
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
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead className="bg-bg-elevated border-b border-bg-subtle">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase">{d["account.orders.table.order"]}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase">{d["account.orders.table.size"]}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase">{d["account.orders.table.status"]}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase hidden sm:table-cell">{d["account.orders.table.gallery"]}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase">{d["account.orders.table.amount"]}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase hidden sm:table-cell">{d["account.orders.table.date"]}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-subtle">
                  {orders.map((order) => (
                    <tr key={order.orderNumber} className="hover:bg-bg-elevated transition-colors">
                      <td className="px-4 py-3 font-mono text-sm font-medium text-text-primary">{order.orderNumber}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-bg-elevated text-green-500 border border-bg-subtle">
                          {d[`status.${order.status}` as keyof typeof d] || order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm hidden sm:table-cell">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            order.isPublic
                              ? "bg-success-50 text-success"
                              : "bg-bg-muted text-text-muted"
                          }`}
                        >
                          {order.isPublic
                            ? d["account.orders.public"]
                            : d["account.orders.private"]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                        {formatCurrency(order.amountKurus, locale)}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted hidden sm:table-cell">
                        {formatDate(order.createdAt, locale)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/track/${order.orderNumber}`}
                          className="text-sm text-green-500 hover:text-green-400 font-semibold"
                        >
                          {d["account.orders.track"]}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
