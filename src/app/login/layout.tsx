import type { Metadata } from "next";

/**
 * Private surface: noindex. robots.txt also disallows it, but that only stops
 * crawling — a URL discovered elsewhere can still be indexed without it, and
 * an account or sign-in page in the index is noise at best.
 */
export const metadata: Metadata = {
  title: "Giriş Yap",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
