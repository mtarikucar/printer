import { SiteHeader } from "@/components/site-header";
import { CartClient } from "./cart-client";

export const metadata = { title: "Sepet — Figurunica" };

export default function CartPage() {
  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <section className="mx-auto max-w-5xl px-4 py-10 md:py-14">
        <CartClient />
      </section>
    </main>
  );
}
