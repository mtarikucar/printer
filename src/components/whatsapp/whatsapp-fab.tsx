"use client";

import { usePathname } from "next/navigation";
import { buildWhatsAppUrl } from "@/lib/config/contact";
import { WhatsAppIcon } from "./whatsapp-button";

const FAB_MESSAGE =
  "Merhaba! Figürünica hakkında bilgi almak / sipariş vermek istiyorum.";

/**
 * Site-wide floating WhatsApp button. Mounted once in the root layout; hides
 * itself on the admin + manufacturer panels (staff surfaces, not customers).
 */
export function WhatsAppFab() {
  const pathname = usePathname();
  if (
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/manufacturer")
  ) {
    return null;
  }

  return (
    <a
      href={buildWhatsAppUrl(FAB_MESSAGE)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="WhatsApp ile iletişime geç"
      className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition-transform hover:scale-105 hover:bg-[#1ebe5d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
    >
      <WhatsAppIcon className="h-7 w-7" />
    </a>
  );
}
