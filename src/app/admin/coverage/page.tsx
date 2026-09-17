export const dynamic = "force-dynamic";

import {
  COVERAGE_MATERIALS,
  computeCoveragePlan,
  loadCoverageOverrides,
  loadCoverageWorkshops,
} from "@/lib/services/coverage-plan";
import { manufacturerSupportsMaterial } from "@/lib/services/capability";
import { CoverageClient } from "./coverage-client";
import type { CoverageScreenOverride, CoverageScreenWorkshop } from "./coverage-client";

/**
 * HESAPLANAN ETKİ ALANI — yöneticinin planı il il gördüğü ekran.
 *
 * Plan BURADA (sunucuda) hesaplanır ve istemciye HAZIR gider. İstemci hiçbir
 * koşulda kendi hesabını kurmaz: aynı sorunun ikinci bir cevabı, tam olarak bu
 * fazın kapattığı kusurdur (harita bir şey der, sıralayıcı başka bir şey yapar).
 * Müdahaleden sonra ekran `router.refresh()` ile SUNUCUYA döner.
 *
 * Bu ekran kimseye iş DAĞITMAZ: plan bu fazda yalnız hesaplanır ve gösterilir.
 */
export default async function AdminCoveragePage() {
  const [workshops, overrides] = await Promise.all([
    loadCoverageWorkshops(),
    loadCoverageOverrides(),
  ]);
  const plan = computeCoveragePlan({ workshops, overrides });

  // Atölyenin hangi malzemeleri bastığı SUNUCUDA çözülür: kural
  // `manufacturerSupportsMaterial` (sıralayıcının kapısı) ve istemci onu
  // yeniden yorumlamamalı.
  const screenWorkshops: CoverageScreenWorkshop[] = workshops
    .map((w) => ({
      id: w.manufacturerId,
      name: w.companyName,
      il: w.canonicalIl ?? w.il,
      hasRoom: w.hasRoom,
      loadUnits: w.loadUnits,
      maxConcurrentOrders: w.maxConcurrentOrders,
      acceptingOrders: w.acceptingOrders,
      materials: COVERAGE_MATERIALS.filter((m) =>
        manufacturerSupportsMaterial(w.capabilities, m)
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));

  const screenOverrides: CoverageScreenOverride[] = overrides.map((o) => ({
    il: o.il,
    material: o.material,
    kind: o.kind,
    manufacturerId: o.manufacturerId,
    note: o.note,
    createdBy: o.createdBy,
    updatedAt: o.updatedAt ? o.updatedAt.toISOString() : null,
  }));

  return (
    <CoverageClient
      plan={plan}
      workshops={screenWorkshops}
      overrides={screenOverrides}
    />
  );
}
