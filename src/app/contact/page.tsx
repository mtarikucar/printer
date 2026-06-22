import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import {
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_HREF,
  CONTACT_EMAIL,
  CONTACT_EMAIL_HREF,
  CONTACT_ADDRESS_LINES,
  CONTACT_MAPS_URL,
  WHATSAPP_DISPLAY,
  buildWhatsAppUrl,
} from "@/lib/config/contact";
import { WhatsAppIcon } from "@/components/whatsapp/whatsapp-button";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const d = getDictionary(locale);
  return { title: d["contact.meta.title"] };
}

export default async function ContactPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-4xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {d["contact.title"]}
        </h1>
        <p className="text-base md:text-lg text-text-secondary leading-relaxed mb-12 max-w-2xl">
          {d["contact.subtitle"]}
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Phone */}
          <div className="rounded-2xl border border-bg-subtle bg-bg-elevated/40 p-6 md:p-7 transition-colors hover:border-green-500/40">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex w-10 h-10 rounded-xl bg-green-500/10 items-center justify-center text-green-500">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 5a2 2 0 012-2h2.28a1 1 0 01.95.68l1.5 4.49a1 1 0 01-.5 1.21l-1.74.87a11 11 0 005.52 5.52l.87-1.74a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z"
                  />
                </svg>
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
                {d["contact.phone.label"]}
              </span>
            </div>
            <a
              href={CONTACT_PHONE_HREF}
              className="block text-xl md:text-2xl font-semibold text-text-primary hover:text-green-500 transition-colors"
            >
              {CONTACT_PHONE_DISPLAY}
            </a>
            <p className="text-sm text-text-muted mt-2">
              {d["contact.phone.note"]}
            </p>
          </div>

          {/* Email */}
          <div className="rounded-2xl border border-bg-subtle bg-bg-elevated/40 p-6 md:p-7 transition-colors hover:border-green-500/40">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex w-10 h-10 rounded-xl bg-green-500/10 items-center justify-center text-green-500">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
                {d["contact.email.label"]}
              </span>
            </div>
            <a
              href={CONTACT_EMAIL_HREF}
              className="block text-xl md:text-2xl font-semibold text-text-primary hover:text-green-500 transition-colors break-all"
            >
              {CONTACT_EMAIL}
            </a>
            <p className="text-sm text-text-muted mt-2">
              {d["contact.email.note"]}
            </p>
          </div>

          {/* WhatsApp */}
          <div className="rounded-2xl border border-bg-subtle bg-bg-elevated/40 p-6 md:p-7 transition-colors hover:border-[#25D366]/50 md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex w-10 h-10 rounded-xl bg-[#25D366]/10 items-center justify-center text-[#25D366]">
                <WhatsAppIcon className="w-5 h-5" />
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
                WhatsApp
              </span>
            </div>
            <a
              href={buildWhatsAppUrl(
                "Merhaba! Figürünica hakkında bilgi almak / sipariş vermek istiyorum."
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1ebe5d]"
            >
              <WhatsAppIcon className="w-5 h-5" />
              {`WhatsApp'tan yazın`} · {WHATSAPP_DISPLAY}
            </a>
            <p className="text-sm text-text-muted mt-3">
              {`Hızlıca yazın, sipariş verin veya sorularınızı sorun.`}
            </p>
          </div>

          {/* Address */}
          <div className="rounded-2xl border border-bg-subtle bg-bg-elevated/40 p-6 md:p-7 transition-colors hover:border-green-500/40 md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex w-10 h-10 rounded-xl bg-green-500/10 items-center justify-center text-green-500">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 21s-7-7.5-7-12a7 7 0 1114 0c0 4.5-7 12-7 12z"
                  />
                  <circle cx="12" cy="9" r="2.5" strokeLinecap="round" />
                </svg>
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
                {d["contact.address.label"]}
              </span>
            </div>
            <address className="not-italic text-lg md:text-xl text-text-primary leading-relaxed">
              {CONTACT_ADDRESS_LINES.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            <a
              href={CONTACT_MAPS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-5 text-sm font-medium text-green-500 hover:text-green-400 transition-colors"
            >
              {d["contact.address.mapsCta"]}
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
