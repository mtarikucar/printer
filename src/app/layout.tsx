import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono, DM_Serif_Display } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { GrainOverlay } from "@/components/grain-overlay";

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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const d = getDictionary(locale);
  return {
    title: d["meta.title"],
    description: d["meta.description"],
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
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${dmSerifDisplay.variable} font-sans antialiased bg-bg-base text-text-primary`}
      >
        <LocaleProvider locale={locale}>
          {children}
          <GrainOverlay />
        </LocaleProvider>
      </body>
    </html>
  );
}
