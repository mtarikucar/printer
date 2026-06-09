import { SiteHeader } from "@/components/site-header";
import { CheckoutClient } from "./checkout-client";

export const metadata = { title: "Ödeme — Figurunica" };

export default function CheckoutPage() {
  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <section className="mx-auto max-w-4xl px-4 py-10 md:py-14">
        <CheckoutClient />
      </section>
    </main>
  );
}
