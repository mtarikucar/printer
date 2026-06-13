"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/locale-context";
import { useConsent } from "./consent-context";
import { hasAnyClientTag } from "@/lib/analytics/config";

/**
 * KVKK / GDPR cookie-consent banner. Shows on first visit (no decision yet) and
 * can be re-opened from the footer. Advertising/analytics tags stay denied until
 * the visitor opts in. Renders nothing when no tags are configured.
 */
export function CookieConsentBanner() {
  const locale = useLocale();
  const tr = locale !== "en";
  const { needsDecision, settingsOpen, setSettingsOpen, acceptAll, rejectAll, save } =
    useConsent();

  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(true);

  // Nothing to consent to if no analytics/ad tag IDs are configured at all.
  if (!hasAnyClientTag) return null;
  if (!needsDecision && !settingsOpen) return null;

  const L = tr
    ? {
        title: "Çerez tercihleriniz",
        body: "Sitemizin çalışması için zorunlu çerezleri kullanırız. İzin verirseniz, deneyimi geliştirmek ve reklam performansını ölçmek için analitik ve pazarlama çerezleri de kullanırız. Detaylar için ",
        cookiePolicy: "Çerez Politikası",
        and: " ve ",
        privacy: "Gizlilik Politikası",
        accept: "Tümünü kabul et",
        reject: "Yalnızca zorunlu",
        settings: "Ayarlar",
        save: "Tercihleri kaydet",
        necessary: "Zorunlu çerezler",
        necessaryDesc: "Oturum, sepet ve güvenlik için gereklidir. Her zaman aktiftir.",
        analytics: "Analitik çerezler",
        analyticsDesc: "Ziyaretlerin ve dönüşümlerin ölçülmesi (Google Analytics).",
        marketing: "Pazarlama çerezleri",
        marketingDesc: "Reklam ölçümü ve yeniden pazarlama (Meta, TikTok).",
        always: "Her zaman açık",
      }
    : {
        title: "Your cookie preferences",
        body: "We use strictly necessary cookies to run the site. With your permission we also use analytics and marketing cookies to improve the experience and measure ad performance. See our ",
        cookiePolicy: "Cookie Policy",
        and: " and ",
        privacy: "Privacy Policy",
        accept: "Accept all",
        reject: "Necessary only",
        settings: "Settings",
        save: "Save preferences",
        necessary: "Necessary cookies",
        necessaryDesc: "Required for session, cart and security. Always active.",
        analytics: "Analytics cookies",
        analyticsDesc: "Measuring visits and conversions (Google Analytics).",
        marketing: "Marketing cookies",
        marketingDesc: "Ad measurement and remarketing (Meta, TikTok).",
        always: "Always on",
      };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[9000] p-3 sm:p-4"
      role="dialog"
      aria-label={L.title}
      aria-modal="false"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white shadow-2xl p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">{L.title}</h2>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
          {L.body}
          <Link href="/cerez" className="underline hover:text-gray-900">
            {L.cookiePolicy}
          </Link>
          {L.and}
          <Link href="/privacy" className="underline hover:text-gray-900">
            {L.privacy}
          </Link>
          .
        </p>

        {settingsOpen && (
          <div className="mt-3 space-y-2">
            <Row title={L.necessary} desc={L.necessaryDesc}>
              <span className="text-[11px] font-medium text-gray-400">{L.always}</span>
            </Row>
            <Row title={L.analytics} desc={L.analyticsDesc}>
              <Toggle checked={analytics} onChange={setAnalytics} />
            </Row>
            <Row title={L.marketing} desc={L.marketingDesc}>
              <Toggle checked={marketing} onChange={setMarketing} />
            </Row>
          </div>
        )}

        <div className="mt-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
          {!settingsOpen ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="text-xs font-medium text-gray-500 hover:text-gray-800 px-3 py-2"
            >
              {L.settings}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => save({ analytics, marketing })}
              className="text-xs font-semibold text-gray-700 hover:text-gray-900 px-4 py-2 rounded-xl border border-gray-300"
            >
              {L.save}
            </button>
          )}
          <button
            type="button"
            onClick={rejectAll}
            className="text-xs font-semibold text-gray-700 px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50"
          >
            {L.reject}
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="text-xs font-semibold text-white px-4 py-2 rounded-xl bg-gray-900 hover:bg-black"
          >
            {L.accept}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2">
      <div>
        <p className="text-xs font-semibold text-gray-800">{title}</p>
        <p className="text-[11px] text-gray-500">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? "bg-gray-900" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
