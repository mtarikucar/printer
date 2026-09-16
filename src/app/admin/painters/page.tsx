export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import {
  emptyPainterCapacity,
  loadPainterCapacities,
  painterLoadLabel,
} from "@/lib/services/painter-capacity";
import { desc } from "drizzle-orm";
import { getPublicUrl } from "@/lib/services/storage";
import { getLocale } from "@/lib/i18n/get-locale";
import { PaintersClient } from "./painters-client";

export default async function AdminPaintersPage() {
  const locale = await getLocale();

  const allPainters = await db.query.painters.findMany({
    orderBy: [desc(painters.createdAt)],
  });

  // KAPASİTE TEK ÖLÇÜDEN OKUNUR (services/painter-capacity.ts).
  //
  // Bu ekran kendi `count(*)` sayımını yapıyordu ve İADE EDİLMİŞ işi de
  // sayıyordu: tek işi iade edilmiş bir boyacı burada "1 aktif iş",
  // sipariş kartında "0/1" görünüyordu (ölçüm: P4F-3). Aynı boyacının yükü
  // iki admin ekranında iki farklı sayı olamaz; iade de kimsenin
  // kapasitesini tüketmez.
  const caps = await loadPainterCapacities(allPainters.map((p) => p.id));

  const serialized = allPainters.map((p) => {
    // Eksik anahtar "bilinmiyor" değil "boş tezgâh" demektir.
    const cap =
      caps.get(p.id) ?? emptyPainterCapacity(p.id, p.maxConcurrentOrders);
    return {
      id: p.id,
      companyName: p.companyName,
      contactPerson: p.contactPerson,
      email: p.email,
      phone: p.phone,
      taxId: p.taxId,
      taxIdType: p.taxIdType as "vkn" | "tckn" | null,
      requiresManualTaxReview: p.requiresManualTaxReview,
      status: p.status,
      // GÖSTERİM: kaç ayrı kutu var. KAPI DEĞİL — yeni iş düşüp düşmeyeceğine
      // ağırlıklı `loadUnits` karar verir (bkz. loadLabel/hasRoom).
      activeOrders: cap.activeJobs,
      loadUnits: cap.loadUnits,
      hasRoom: cap.hasRoom,
      // Tek yük etiketi: "4/5 birim · 1 iş".
      loadLabel: painterLoadLabel(cap),
      createdAt: p.createdAt.toISOString(),
      rejectionReason: p.rejectionReason,
      workSamplePhotoUploadedAt: p.workSamplePhotoUploadedAt
        ? p.workSamplePhotoUploadedAt.toISOString()
        : null,
      workSamplePhotoUrl: p.workSamplePhotoKey
        ? getPublicUrl(p.workSamplePhotoKey)
        : null,
      // Full application details (what the applicant chose at registration).
      whatsappPhone: p.whatsappPhone,
      address: p.address,
      iban: p.iban,
      bankAccountHolder: p.bankAccountHolder,
      bankName: p.bankName,
      maxConcurrentOrders: p.maxConcurrentOrders,
      acceptingOrders: p.acceptingOrders,
      capabilities: p.capabilities ?? [],
      mapVisible: p.mapVisible,
      onboardingAcceptedAt: p.onboardingAcceptedAt
        ? p.onboardingAcceptedAt.toISOString()
        : null,
      strikeCount: p.strikeCount,
      // Partner-level admin audit lines (e.g. a closed tax review), shown in Detay.
      notes: p.notes,
    };
  });

  return (
    <div className="p-4 sm:p-8">
      <PaintersClient painters={serialized} locale={locale} />
    </div>
  );
}
