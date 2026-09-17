import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, painters } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { buildNetworkMap, type NetworkMapData, type PartnerRow } from "@/lib/config/network-map";
import { loadCoveragePlan, plannedCoverageFor } from "@/lib/services/coverage-plan";

/**
 * Public üretim ağı haritasının DB kapısı — TEK sorumluluğu satırları çekip saf
 * `buildNetworkMap`'e vermek. Payload'ın ne içerdiği (ve boyacı adının neden
 * yayımlanmadığı) lib/config/network-map.ts'te; burada iş mantığı yok.
 */

/**
 * Anasayfa haritası: yalnız aktif ve gizlenmemiş partnerler.
 *
 * ETKİ ALANI ARTIK HESAPTAN GELİR (Faz 5 · coverage-model = B). Üreticinin
 * kapsadığı iller `manufacturers.coverage_provinces`tan DEĞİL, tek hesaptan
 * (`services/coverage-plan.ts`) okunur. Ölçülen kusur buydu: plan ekranı reçine
 * için 25 il kapsanmış derken harita 9 diyordu; Ankara'yı pinlemek ve Manisa'yı
 * dışlamak public haritada HİÇBİR ŞEY değiştirmiyordu, yani yöneticinin iki
 * kaldıracı da müşteriye bakan yüzeyde yoktu.
 *
 * Haritanın planı okuması ranker-rollout = B'ye (yeni sinyaller önce gölgede)
 * AYKIRI DEĞİLDİR: harita bir sıralama yüzeyi değil, kimseye iş ya da gelir
 * yazmaz. Canlı atama skoru bu fazda elle yazılan listeyi okumaya devam eder.
 *
 * `map_visible` yine de süzer. Plan görünürlüğe bakmaz (gizlenmiş atölye iş
 * almaya devam eder, bkz. `loadCoverageWorkshops`), ama harita bir YAYIN
 * yüzeyidir: yalnız gizli bir atölyenin karşıladığı il burada boş görünür.
 * Bu, planla çelişki değil, yayın kararıdır — gizlilik düğmesinin anlamı budur.
 *
 * PLAN OKUNAMAZSA BU FONKSİYON PATLAR ve bölüm hiç çizilmez (`app/page.tsx`
 * haritayı dekoratif sayar ve yakalar). Elle yazılan listeye sessizce düşmek,
 * tam da bu fazın kapattığı kusuru geri getirirdi: pin ve dışlama yokmuş gibi
 * davranan ama doğruymuş gibi görünen bir harita.
 */
export async function getNetworkMapData(): Promise<NetworkMapData> {
  const [mfgRows, painterRows, plan] = await Promise.all([
    db.query.manufacturers.findMany({
      where: and(eq(manufacturers.status, "active"), eq(manufacturers.mapVisible, true)),
      // companyName BİLEREK okunmuyor: public payload kimlik içermez, o yüzden
      // adı buraya hiç almamak "sızdırmamayı hatırlamak"tan daha güvenli.
      // `id` de payload'a GİRMEZ; yalnızca plan satırlarını bu atölyeyle
      // eşlemek için okunur. `coverageProvinces` artık HİÇ okunmuyor: kolonu
      // okumayan bir harita, eski hikâyeyi yanlışlıkla da anlatamaz.
      columns: { id: true, address: true, capabilities: true },
    }),
    db.query.painters.findMany({
      where: and(eq(painters.status, "active"), eq(painters.mapVisible, true)),
      columns: { address: true },
    }),
    loadCoveragePlan(),
  ]);

  const rows: PartnerRow[] = [
    ...mfgRows.map((m) => ({
      kind: "manufacturer" as const,
      il: (m.address as TurkishAddress | null)?.il,
      // Tek hesabın çıktısı. Ayrı bir süzme yazmak ("il sahipliği"nin ikinci
      // tanımı) yasak: cevabı `plannedCoverageFor` verir.
      plannedCoverage: plannedCoverageFor(plan, m.id),
      capabilities: m.capabilities,
    })),
    // Boyacı plana GİRMEZ: plan hangi ilin hangi atölyede BASILDIĞININ hesabı.
    // Boyacı bulunduğu ilden hizmet verir, bu yüzden `plannedCoverage` yok ve
    // satır eski etkin liste yolundan (konum ili) geçer.
    ...painterRows.map((p) => ({
      kind: "painter" as const,
      il: (p.address as TurkishAddress | null)?.il,
    })),
  ];

  return buildNetworkMap(rows);
}

/** Admin editörünün gördüğü partner — public payload'ın aksine kimliklidir. */
export interface AdminNetworkPartner {
  id: string;
  kind: "manufacturer" | "painter";
  companyName: string;
  status: string;
  /** Adresten gelen konum ili; admin bunu düzenleyemez (partner profilinden gelir). */
  il: string | null;
  ilce: string | null;
  coverage: string[];
  mapVisible: boolean;
}

// Editörün gösterdiği durumlar. `rejected` dışarıda: reddedilmiş bir başvurunun
// etki alanını yönetmek anlamsız. `pending_approval` İÇERİDE: onay tek bir
// UPDATE'le status'ü 'active' yapıyor ve map_visible'a dokunmuyor, yani başvuru
// listede olmasaydı admin görünürlük kararını ancak partner YAYIMLANDIKTAN
// sonra verebilirdi.
const EDITABLE_STATUSES = [
  "active",
  "suspended",
  "conditionally_approved",
  "pending_approval",
] as const;

export async function getAdminNetworkPartners(): Promise<AdminNetworkPartner[]> {
  const [mfgRows, painterRows] = await Promise.all([
    db.query.manufacturers.findMany({
      where: inArray(manufacturers.status, [...EDITABLE_STATUSES]),
      columns: {
        id: true,
        companyName: true,
        status: true,
        address: true,
        coverageProvinces: true,
        mapVisible: true,
      },
    }),
    db.query.painters.findMany({
      where: inArray(painters.status, [...EDITABLE_STATUSES]),
      columns: { id: true, companyName: true, status: true, address: true, mapVisible: true },
    }),
  ]);

  const out: AdminNetworkPartner[] = [
    ...mfgRows.map((m) => {
      const addr = m.address as TurkishAddress | null;
      return {
        id: m.id,
        kind: "manufacturer" as const,
        companyName: m.companyName,
        status: m.status,
        il: addr?.il ?? null,
        ilce: addr?.ilce ?? null,
        coverage: m.coverageProvinces ?? [],
        mapVisible: m.mapVisible,
      };
    }),
    ...painterRows.map((p) => {
      const addr = p.address as TurkishAddress | null;
      return {
        id: p.id,
        kind: "painter" as const,
        companyName: p.companyName,
        status: p.status,
        il: addr?.il ?? null,
        ilce: addr?.ilce ?? null,
        coverage: [],
        mapVisible: p.mapVisible,
      };
    }),
  ];

  return out.sort((a, b) => a.companyName.localeCompare(b.companyName, "tr"));
}
