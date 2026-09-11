import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, painters } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { buildNetworkMap, type NetworkMapData, type PartnerRow } from "@/lib/config/network-map";

/**
 * Public üretim ağı haritasının DB kapısı — TEK sorumluluğu satırları çekip saf
 * `buildNetworkMap`'e vermek. Payload'ın ne içerdiği (ve boyacı adının neden
 * yayımlanmadığı) lib/config/network-map.ts'te; burada iş mantığı yok.
 */

/** Anasayfa haritası: yalnız aktif ve gizlenmemiş partnerler. */
export async function getNetworkMapData(): Promise<NetworkMapData> {
  const [mfgRows, painterRows] = await Promise.all([
    db.query.manufacturers.findMany({
      where: and(eq(manufacturers.status, "active"), eq(manufacturers.mapVisible, true)),
      // companyName BİLEREK okunmuyor: public payload kimlik içermez, o yüzden
      // adı buraya hiç almamak "sızdırmamayı hatırlamak"tan daha güvenli.
      columns: { address: true, coverageProvinces: true, capabilities: true },
    }),
    db.query.painters.findMany({
      where: and(eq(painters.status, "active"), eq(painters.mapVisible, true)),
      columns: { address: true },
    }),
  ]);

  const rows: PartnerRow[] = [
    ...mfgRows.map((m) => ({
      kind: "manufacturer" as const,
      il: (m.address as TurkishAddress | null)?.il,
      coverageProvinces: m.coverageProvinces,
      capabilities: m.capabilities,
    })),
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
