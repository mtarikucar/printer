"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { useInstantQuoteEnabled, useQuoteTeamsEnabled } from "@/lib/quote/instant-quote-flag";

/**
 * "Tekliflerim" + "Parça kütüphanem" + "Takımım" — anlık teklif motorunun
 * hesap sayfaları.
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
 *
 * ─── "Takımım" KENDİ BAYRAĞINA TABİ (0072) ─────────────────────────────────
 *
 * `/account/takim` sayfasının kapısı `teamsEnabled()`tir, `quoteApiEnabled()`
 * DEĞİL — özellik kendi bayrağını (`quote_teams_enabled`) taşıyor. Yani
 * `instant_quote_enabled` AÇIK ama takım KAPALI hâli gerçek bir hâldir (ve
 * bugün olacak olan hâldir): o hâlde "Tekliflerim"/"Parça kütüphanem" durur,
 * "Takımım" ÇİZİLMEZ. Üç bağlantının tek bileşende durmasının sebebi bu
 * dosyanın baştaki gerekçesi; bayrağın İKİ olmasının sebebi ise kapının üç
 * bağlantı için aynı olmaması.
 *
 * Sonda tek `fetch` atmaya devam eder: ikinci bayrak aynı cevabın bir alanıdır
 * (`instant-quote-flag.ts`).
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

/** Kendi bayrağını (`quote_teams_enabled`) taşıyan bağlantı. */
const TEAM_LINK = {
  href: "/account/takim",
  labelKey: "instantQuote.team.title",
  iconPath:
    "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
} as const;

interface QuoteAccountLinksProps {
  variant: keyof typeof ITEM_CLASS;
  /** Menüyü kapatmak için (mobil menü ve kullanıcı menüsü açık kalmasın). */
  onNavigate: () => void;
}

export function QuoteAccountLinks({ variant, onNavigate }: QuoteAccountLinksProps) {
  const d = useDictionary();
  const enabled = useInstantQuoteEnabled();
  const teamsEnabled = useQuoteTeamsEnabled();
  // Kancalar koşulsuz çağrılır (React kuralı), kapı ondan SONRA uygulanır.
  if (enabled !== true) return null;

  const links = teamsEnabled === true ? [...LINKS, TEAM_LINK] : LINKS;

  return (
    <>
      {links.map((link) => (
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
