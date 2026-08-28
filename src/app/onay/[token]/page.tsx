export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getApprovalByToken } from "@/lib/services/model-approval";
import { ApprovalClient } from "./approval-client";

// The page shows a 3D likeness derived from a photo the customer uploaded.
// Possession of the token is the only key, so it must never be indexed or
// cached by a link unfurler.
export const metadata: Metadata = {
  title: "3D modelinizi onaylayın | Figurunica",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ModelApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await getApprovalByToken(token);
  // A wrong, expired or rotated token is indistinguishable from a made-up one:
  // both get a plain 404, which leaks nothing about whether an order exists.
  if (!view) notFound();

  return <ApprovalClient token={token} view={view} />;
}
