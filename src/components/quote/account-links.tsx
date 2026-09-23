"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { useInstantQuoteEnabled } from "@/lib/quote/instant-quote-flag";

/**
 * "Tekliflerim" + "Parça kütüphanem" — anlık teklif motorunun hesap sayfaları.
 *
 * İki menüden birden veriliyor (masaüstünde kullanıcı menüsü, mobilde açılır
 * menü) ve ikisinde de AYNI kapıya tabi: `instant_quote_enabled` kapalıyken bu
 * sayfalar normal müşteriye `notFound()` döner (bkz. `account/teklifler/page.tsx`),
 * yani bağlantıyı göstermek müşteriyi 404'e göndermek olurdu. Kapı tek yerde
 * dursun diye bağlantılar ortak bir bileşene alındı: menülerden biri
 * güncellenip öteki unutulduğunda sessizce kırık bağlantı kalmasın.
 *
 * Bayrak kapalı ve ziyaretçi ADMIN ise sonda `true` döner (uç izleyiciye göre
 * cevap verir), böylece iç test sırasında sayfalara menüden ulaşılır.
 */
const ITEM_CLASS = {
  dropdown:
    "flex items-center gap-3 px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-muted transition-colors",
  mobile:
    "flex items-center gap-3 py-3 px-4 rounded-xl text-sm font-medium text-text-secondary hover:bg-bg-elevated transition-colors",
} as const;

const ICON_CLASS = {
  dropdown: "w-4 h-4 text-text-muted",
  mobile: "w-4 h-4",
} as const;

const LINKS = [
  {
    href: "/account/teklifler",
    labelKey: "instantQuote.account.quotes.title",
    iconPath:
      "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    href: "/account/parcalar",
    labelKey: "instantQuote.account.parts.title",
    iconPath:
      "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  },
] as const;

interface QuoteAccountLinksProps {
  variant: keyof typeof ITEM_CLASS;
  /** Menüyü kapatmak için (mobil menü ve kullanıcı menüsü açık kalmasın). */
  onNavigate: () => void;
}

export function QuoteAccountLinks({ variant, onNavigate }: QuoteAccountLinksProps) {
  const d = useDictionary();
  const enabled = useInstantQuoteEnabled();
  if (enabled !== true) return null;

  return (
    <>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={onNavigate}
          className={ITEM_CLASS[variant]}
        >
          <svg
            className={ICON_CLASS[variant]}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={link.iconPath}
            />
          </svg>
          {d[link.labelKey]}
        </Link>
      ))}
    </>
  );
}
