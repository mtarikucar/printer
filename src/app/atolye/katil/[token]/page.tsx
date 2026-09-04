import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSessionByToken } from "@/lib/services/workshop-join";
import { JoinClient } from "./join-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atölyeye katıl | Figurünica",
  // Link yalnızca paylaşıldığı kişilere aittir: arama motorlarına girmemeli.
  robots: { index: false, follow: false, nocache: true },
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadSessionByToken(token);
  // Yanlış, süresi geçmiş ya da uydurma token birbirinden ayırt edilemez.
  if (!view) notFound();

  return <JoinClient token={token} view={view} />;
}
