export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import ReactMarkdown from "react-markdown";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { MANUFACTURER_ONBOARDING_TR } from "@/lib/content/manufacturer-onboarding";
import { MANUFACTURER_CONTRACT_VERSION } from "@/lib/config/contract-versions";
import { formatDateTime } from "@/lib/i18n/format";

/**
 * The partnership agreement, readable after registration. It used to be shown
 * only on the register screen, so a partner could never look up the terms they
 * are being held to.
 */
export default async function ManufacturerContractPage() {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const me = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { onboardingAcceptedAt: true, onboardingVersion: true },
  });

  const acceptedVersion = me?.onboardingVersion ?? null;
  const isOutdated =
    !!acceptedVersion && acceptedVersion !== MANUFACTURER_CONTRACT_VERSION;

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Üretici Sözleşmesi</h1>
      <p className="mt-1 text-sm text-gray-500">
        Yürürlükteki sürüm: <strong>v{MANUFACTURER_CONTRACT_VERSION}</strong>
        {me?.onboardingAcceptedAt && (
          <>
            {" · "}Kabul ettiğiniz sürüm:{" "}
            <strong>{acceptedVersion ? `v${acceptedVersion}` : "kayıtsız"}</strong>{" "}
            ({formatDateTime(me.onboardingAcceptedAt.toISOString(), "tr")})
          </>
        )}
      </p>
      {isOutdated && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Sözleşmenin yeni bir sürümü yayınlandı. Esaslı değişiklikler kayıtlı
          e-posta adresinize bildirilir ve yürürlük tarihinden önce kabul
          ettiğiniz siparişlere uygulanmaz.
        </p>
      )}
      <div className="prose prose-sm mt-6 max-w-none rounded-2xl border border-gray-200 bg-white p-6 prose-headings:font-semibold prose-strong:underline">
        <ReactMarkdown>{MANUFACTURER_ONBOARDING_TR}</ReactMarkdown>
      </div>
    </div>
  );
}
