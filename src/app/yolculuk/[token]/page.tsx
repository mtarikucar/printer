export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadJourney } from "@/lib/services/order-journey";
import { JourneyClient } from "./journey-client";
import "../journey.css";

// The page shows a photograph the customer uploaded — usually someone's face.
// Possession of the token is the only key, so it must never be indexed or
// previewed by a link unfurler that would cache the image elsewhere.
export const metadata: Metadata = {
  title: "Figürünün yolculuğu | Figurunica",
  robots: { index: false, follow: false, nocache: true },
};

export default async function JourneyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await loadJourney(token);
  // A wrong, expired or rotated token is indistinguishable from a made-up one:
  // both get a plain 404, which leaks nothing about whether an order exists.
  if (!data) notFound();

  return <JourneyClient data={data} />;
}
