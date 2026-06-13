"use client";

import Script from "next/script";
import {
  GA4_ID,
  GTM_ID,
  META_PIXEL_ID,
  TIKTOK_PIXEL_ID,
  hasGA4,
  hasGTM,
  hasMetaPixel,
  hasTikTokPixel,
} from "@/lib/analytics/config";
import { useConsent } from "./consent-context";

/**
 * Loads the configured browser tags. Ordering matters:
 *   1. An inline Consent-Mode-v2 bootstrap runs first (default everything to
 *      "denied") so GA/GTM start cookieless until the visitor opts in.
 *   2. GTM (preferred) and/or GA4 load afterInteractive — they respect the
 *      consent defaults and are upgraded by the consent provider on opt-in.
 *   3. The Meta + TikTok advertising pixels load ONLY once marketing consent is
 *      granted (KVKK: no advertising cookies before explicit consent).
 *
 * Renders nothing when no tag IDs are configured, so it's safe to always mount.
 */
export function AnalyticsScripts() {
  const { consent } = useConsent();

  return (
    <>
      {/* 1 — Consent Mode v2 defaults + dataLayer bootstrap. A raw inline script
          (not next/script) so it executes during initial HTML parse, before the
          afterInteractive GTM/GA loaders — which is required for consent mode to
          take effect on the very first hit. */}
      {(hasGTM || hasGA4) && (
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('consent','default',{
              ad_storage:'denied',
              ad_user_data:'denied',
              ad_personalization:'denied',
              analytics_storage:'denied',
              functionality_storage:'granted',
              security_storage:'granted',
              wait_for_update: 500
            });
            gtag('js', new Date());
            ${hasGA4 ? `gtag('config','${GA4_ID}',{anonymize_ip:true,send_page_view:false});` : ""}
          `,
          }}
        />
      )}

      {/* 2a — Google Tag Manager container (preferred). */}
      {hasGTM && (
        <>
          <Script id="gtm" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
              new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
              j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
              'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
              })(window,document,'script','dataLayer','${GTM_ID}');`}
          </Script>
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
              title="gtm"
            />
          </noscript>
        </>
      )}

      {/* 2b — GA4 gtag.js direct loader (only when GTM is NOT managing GA4). */}
      {hasGA4 && !hasGTM && (
        <Script
          id="ga4"
          src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
          strategy="afterInteractive"
        />
      )}

      {/* 3a — Meta (Facebook) Pixel — marketing consent required. */}
      {hasMetaPixel && consent.marketing && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('consent','grant');
            fbq('init', '${META_PIXEL_ID}');
            fbq('track', 'PageView');`}
        </Script>
      )}

      {/* 3b — TikTok Pixel — marketing consent required. */}
      {hasTikTokPixel && consent.marketing && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`!function (w, d, t) {w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
            ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];
            ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
            for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
            ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
            ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
            ttq.load('${TIKTOK_PIXEL_ID}');
            ttq.page();
            }(window, document, 'ttq');`}
        </Script>
      )}
    </>
  );
}
