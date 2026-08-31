"use client";

import { usePathname } from "next/navigation";
import { FigFooter } from "@/components/figurunica/sections";
import type { FigurunicaDict } from "@/components/figurunica/dict";

/**
 * Site-wide footer. Mounted once in the root layout, in the same shape as
 * WhatsAppFab.
 *
 * Why this exists: FigFooter used to be rendered only by the landing page and
 * the storefront, so 30+ public pages carried no footer at all. That is not a
 * cosmetic gap — the footer IS the site's internal link graph, and a page
 * nothing links to is a page a retrieval crawler never reaches. `/figur` in
 * particular was completely orphaned.
 *
 * Hidden on the staff panels (they are not customer surfaces) and on the
 * journey keepsake page, matching the WhatsAppFab exclusions.
 */
export function SiteFooter({ dict }: { dict: FigurunicaDict }) {
  const pathname = usePathname();
  if (
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/manufacturer") ||
    pathname?.startsWith("/painter") ||
    pathname?.startsWith("/yolculuk")
  ) {
    return null;
  }
  return <FigFooter d={dict} />;
}
