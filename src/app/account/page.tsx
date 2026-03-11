"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

interface DigitalOrder {
  id: string;
  orderNumber: string;
  status: string;
  amountKurus: number;
  downloadCount: number;
  createdAt: string;
}

export default function AccountPage() {
  const router = useRouter();
  const d = useDictionary();
  const locale = useLocale();
  const [user, setUser] = useState<User | null>(null);
  const [previews, setPreviews] = useState<AccountPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<AccountPreview | null>(null);
  const [digitalOrders, setDigitalOrders] = useState<DigitalOrder[]>([]);


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

        const [previewsRes, digitalRes] = await Promise.all([
          fetch("/api/customer/previews"),
          fetch("/api/customer/digital-orders"),
        ]);

        if (previewsRes.ok) {
          const data = await previewsRes.json();
          setPreviews(data.previews);
          setCursor(data.nextCursor);
        }

        if (digitalRes.ok) {
          const data = await digitalRes.json();
          setDigitalOrders(data.digitalOrders || []);
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

        {/* Creations gallery */}
        <div className="mt-8 animate-fade-in-up delay-100">
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

        {/* Digital Purchases */}
        {digitalOrders.length > 0 && (
          <div className="mt-8 animate-fade-in-up delay-200">
            <h2 className="text-xl font-serif text-text-primary mb-4">{d["account.digitalOrders.title"]}</h2>
            <div className="card overflow-hidden">
              <div className="divide-y divide-bg-subtle">
                {digitalOrders.map((order) => (
                  <div key={order.id} className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-mono font-medium text-text-primary">{order.orderNumber}</p>
                      <p className="text-xs text-text-muted">{formatDate(order.createdAt, locale)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        order.status === "ready"
                          ? "bg-green-100 text-green-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {d[`digital.status.${order.status}` as keyof typeof d] || order.status}
                      </span>
                      {order.status === "ready" && (
                        <Link href={`/digital/${order.id}`} className="btn-primary text-xs !py-1.5 !px-3">
                          {d["digital.download"]}
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
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
