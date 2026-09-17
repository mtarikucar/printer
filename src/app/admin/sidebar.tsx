"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { signOutAction } from "./actions";

/**
 * Menü metinleri SUNUCUDAN PROP olarak gelir, context'ten DEĞİL.
 *
 * Kenar çubuğu /admin/* altındaki HER sayfanın kabuğudur: burada atılan bir
 * hata tek bir kartı değil sayfanın tamamını 500'e düşürür. Panelde tam olarak
 * bu yaşandı — üç ayrı siparişte "useDictionary must be used within
 * LocaleProvider" (sidebar.tsx → useDictionary), yani kabuk sağlayıcıyı
 * göremeden render edildi. Sözlüğü, düzeni render eden SUNUCU bileşeni çözüp
 * hazır metin olarak verdiğinde kenar çubuğu hiçbir sağlayıcıya bağlı kalmaz.
 * Çeviri gizlenmiyor: metinler gerçek sözlükten gelir (bkz. admin/layout.tsx),
 * eksik bir anahtar yine derleme zamanında yakalanır.
 */
export interface AdminSidebarLabels {
  groupGeneral: string;
  groupOrders: string;
  groupManufacturers: string;
  groupCustomer: string;
  groupContent: string;
  groupAdvanced: string;
  dashboard: string;
  orders: string;
  manufacturingQueue: string;
  qcQueue: string;
  manufacturers: string;
  products: string;
  giftCards: string;
  logout: string;
}

export function AdminSidebar({
  labels,
  awaitingModelCount,
  awaitingManufacturerCount,
  assignmentSweepCount,
  awaitingManufacturerBulkCount,
  pendingManufacturerCount,
  pendingProductCount,
  draftReviewCount,
  qcPendingCount,
  workshopPendingCount,
  pendingPainterCount,
  painterQcPendingCount,
  waAwaitingReplyCount,
}: {
  labels: AdminSidebarLabels;
  awaitingModelCount: number | null;
  awaitingManufacturerCount: number | null;
  assignmentSweepCount: number | null;
  awaitingManufacturerBulkCount: number | null;
  pendingManufacturerCount: number | null;
  pendingProductCount: number | null;
  draftReviewCount: number | null;
  qcPendingCount: number | null;
  workshopPendingCount: number | null;
  pendingPainterCount: number | null;
  painterQcPendingCount: number | null;
  waAwaitingReplyCount: number | null;
}) {
  const pathname = usePathname();

  const groups: {
    id: string;
    title: string;
    // badge null = sayı OKUNAMADI (bkz. admin/layout.tsx). 0 ile aynı şey
    // değildir: biri "bekleyen iş yok", öbürü "bilinmiyor".
    links: { href: string; label: string; icon: ReactNode; badge: number | null }[];
  }[] = [
    {
      id: "general",
      title: labels.groupGeneral,
      links: [
        {
          href: "/admin/dashboard",
          label: labels.dashboard,
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
      id: "orders",
      title: labels.groupOrders,
      links: [
        {
          href: "/admin/orders",
          label: labels.orders,
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />,
          // Both kinds of "waiting on the admin", refunded orders out: a model
          // to upload, and paid work with no manufacturer (the same definition
          // as the "Üretici bekliyor" bucket). The two sets are disjoint; see
          // admin/layout.tsx.
          // İki sayının TOPLAMI: biri bilinmiyorsa toplam da bilinmiyordur.
          // Eksik bir toplamı doğru sayı gibi göstermek, admin'e gerçekte
          // bekleyen işten daha azını gösterirdi.
          badge:
            awaitingModelCount === null || awaitingManufacturerCount === null
              ? null
              : awaitingModelCount + awaitingManufacturerCount,
        },
        {
          href: "/admin/assignment-sweep",
          label: "Atama taraması",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />,
          // Aynı küme (AWAITING_MANUFACTURER): siparişler rozetinin üretici
          // bekleyen yarısı, taramanın listelediği satırlar ve bu sayı hep
          // aynı tanımdan gelir, yoksa rozet ile liste ayrışır.
          badge: assignmentSweepCount,
        },
        {
          href: "/admin/bulk-orders",
          label: "Toplu üretim",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
          badge: awaitingManufacturerBulkCount,
        },
        {
          href: "/admin/kutu-fiyatlari",
          label: "Kutu fiyatları",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />,
          badge: 0,
        },
        {
          href: "/admin/drafts",
          label: "Taslaklar",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
          badge: draftReviewCount,
        },
        {
          href: "/admin/print-queue",
          label: labels.manufacturingQueue,
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2z" />,
          badge: 0,
        },
        {
          href: "/admin/qc-queue",
          label: labels.qcQueue,
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
          badge: qcPendingCount,
        },
        {
          href: "/admin/painter-qc-queue",
          label: "Boyacı QC",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />,
          badge: painterQcPendingCount,
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
      id: "manufacturers",
      title: labels.groupManufacturers,
      links: [
        {
          href: "/admin/manufacturers",
          label: labels.manufacturers,
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
          badge: pendingManufacturerCount,
        },
        {
          href: "/admin/products",
          label: labels.products,
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
          badge: pendingProductCount,
        },
        {
          href: "/admin/painters",
          label: "Boyacılar",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />,
          badge: pendingPainterCount,
        },
        {
          href: "/admin/network-map",
          label: "Üretim ağı haritası",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />,
          badge: 0,
        },
        {
          // Faz 5'in ANA ekranı: hesaplanan plan, pin ve dışlama buradan
          // verilir. Menüde yoktu, yani yalnız URL yazarak açılabiliyordu.
          // Üstündeki elle-seçim haritasının hemen ardında duruyor: ikisi aynı
          // konunun iki yüzü ve hangisinin neyi beslediği ekranlarda yazılı.
          href: "/admin/coverage",
          label: "Etki alanı planı",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" />,
          badge: 0,
        },
        {
          href: "/admin/categories",
          label: "Kategoriler",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />,
          badge: 0,
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
      id: "customer",
      title: labels.groupCustomer,
      links: [
        {
          href: "/admin/workshop-requests",
          label: "Atölye talepleri",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />,
          badge: workshopPendingCount,
        },
        {
          href: "/admin/workshops",
          label: "Atölyeler",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />,
          badge: 0,
        },
        {
          href: "/admin/consumer-requests",
          label: "Tüketici talepleri",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h8m-8 4h5m4 5l-4-3H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2h-1v5z" />,
          badge: 0,
        },
        {
          href: "/admin/whatsapp",
          label: "WhatsApp",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.5 3.5A10 10 0 003.6 15.2L2.5 21.5l6.4-1.1A10 10 0 1020.5 3.5z" />,
          badge: waAwaitingReplyCount,
        },
        {
          href: "/admin/disputes",
          label: "Anlaşmazlıklar",
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
          badge: 0,
        },
        {
          href: "/admin/gift-cards",
          label: labels.giftCards,
          icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />,
          badge: 0,
        },
      ],
    },
    {
      id: "content",
      title: labels.groupContent,
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
      id: "advanced",
      title: labels.groupAdvanced,
      links: [
        {
          href: "/admin/scoring-evaluations",
          // Ekranın kendi başlığıyla birebir aynı: menüde başka bir ad görmek,
          // admin'in iki ayrı ekran sandığı tek bir ekran demek. Ayrıca sayfa
          // artık yalnız v2 ağırlık kanaryasını değil sürekli mesafe gölgesini
          // de taşıyor, yani "Scoring v2" adı kapsamı da yanlış anlatıyordu.
          label: "Sıralama değerlendirmeleri",
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
          <div key={group.id} className="space-y-1">
            <h2 className="px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {group.title}
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
                  {/* Sayı BİLİNMİYORSA (null) rozet "?" gösterir. Rozeti gizlemek
                      ya da 0 yazmak, yapılmamış bir sayımı "bekleyen iş yok" diye
                      göstermek olurdu; sebep sayfanın üstündeki şeritte yazıyor. */}
                  {link.badge === null ? (
                    <span
                      title="Bu sayı şu anda okunamadı (geçici sistem arızası); sıfır demek değildir."
                      aria-label={`${link.label}: sayı okunamadı`}
                      className="bg-amber-100 text-amber-800 ring-1 ring-amber-300 text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center"
                    >
                      ?
                    </span>
                  ) : link.badge > 0 ? (
                    <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                      {link.badge}
                    </span>
                  ) : null}
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
            {labels.logout}
          </button>
        </form>
      </div>
    </aside>
  );
}
