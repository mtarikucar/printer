import type { Metadata } from "next";
import { Inter, Inter_Tight, Space_Grotesk, JetBrains_Mono, DM_Serif_Display, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { CartProvider } from "@/lib/cart/cart-context";
import { GrainOverlay } from "@/components/grain-overlay";
import { DebugConsole } from "@/components/debug-console";
import { Analytics } from "@/components/analytics/analytics";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
  weight: "400",
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "700"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const d = getDictionary(locale);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://figurunica.com";
  return {
    metadataBase: new URL(appUrl),
    title: d["meta.title"],
    description: d["meta.description"],
    openGraph: {
      title: d["meta.title"],
      description: d["meta.description"],
      url: appUrl,
      siteName: "Figurunica",
      locale: locale === "tr" ? "tr_TR" : "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: d["meta.title"],
      description: d["meta.description"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale} style={{ colorScheme: "light" }}>
      <body
        className={`${inter.variable} ${interTight.variable} ${instrumentSerif.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${dmSerifDisplay.variable} font-sans antialiased bg-bg-base text-text-primary`}
      >
        <LocaleProvider locale={locale}>
          <CartProvider>
            {children}
            <GrainOverlay />
            <DebugConsole />
            <Analytics />
          </CartProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
