export const dynamic = "force-dynamic";

import { signalsForProfile } from "@/lib/config/scoring";

import { db } from "@/lib/db";
import { manufacturers, manufacturerDocuments } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import {
  loadManufacturerCapacities,
  emptyManufacturerCapacity,
  manufacturerLoadLabel,
} from "@/lib/services/manufacturer-capacity";
import { getPublicUrl } from "@/lib/services/storage";
import { getLocale } from "@/lib/i18n/get-locale";
import { ManufacturersClient } from "./manufacturers-client";

export default async function AdminManufacturersPage() {
  const locale = await getLocale();
  const weightedLoadLive = signalsForProfile("live").weightedLoad;

  const allManufacturers = await db.query.manufacturers.findMany({
    orderBy: [desc(manufacturers.createdAt)],
  });

  // KAPASİTE, ORTAK ÖLÇÜDEN (services/manufacturer-capacity.ts).
  //
  // Bu sayfanın kendi sorgusu duruyordu ve tezgâh tanımı platformdaki HİÇBİR
  // uçla aynı değildi: `status NOT IN ('delivered','rejected')`. Yani üreticiye
  // hiç atanmamış siparişleri, boyacıya devredilmiş (üreticinin işi bitmiş)
  // siparişleri ve iade edilmişleri de sayıyordu. Sonuç: admin listesindeki
  // "aktif sipariş" ile atama kapısının gördüğü yük aynı atölye için farklıydı
  // ve ölçü ham İŞ SAYISIYDI — 300 adetlik toplu sipariş tek slot sayılıyordu.
  //
  // OKUMA KORUMALI: bu çağrı korumasız eklenmişti ve sayfayı kardeş ucundan
  // DAHA KIRILGAN yapıyordu — `/api/admin/manufacturers` aynı hatada
  // `handleRouteFailure` ile gövdeli bir cevap dönerken bu sayfa 500 veriyordu.
  // Ölçüldü: bayat bir şemada 42703 ("column orders.painter_status does not
  // exist") üretici listesinin TAMAMINI ekrandan siliyor, oysa listenin kendisi
  // (şirket, durum, belgeler, başvuru) okunabiliyor. Yük bilinmiyorsa satır
  // KAYBOLMAZ, yalnız yükü "okunamadı" der.
  const capacities = await loadManufacturerCapacities(
    allManufacturers.map((m) => m.id),
  ).catch((e) => {
    console.error("admin üretici listesi: tezgâh yükü okunamadı", e);
    return null;
  });
  const capacityUnreadable = capacities === null;

  // ALL printer photos per manufacturer (newest first) — a manufacturer may run
  // several printers and uploads one photo per printer.
  const photos = await db.query.manufacturerDocuments.findMany({
    where: eq(manufacturerDocuments.type, "printer_photo"),
    orderBy: [desc(manufacturerDocuments.createdAt)],
  });
  const photoMap = new Map<string, string[]>();
  for (const p of photos) {
    const list = photoMap.get(p.manufacturerId) ?? [];
    list.push(getPublicUrl(p.storageKey));
    photoMap.set(p.manufacturerId, list);
  }

  const serialized = allManufacturers.map((m) => {
    // Eksik anahtar "bilinmiyor" değil "boş tezgâh" demektir. (Yükün HİÇ
    // okunamadığı hâl bundan ayrıdır ve aşağıda ayrıca söylenir.)
    const cap =
      capacities?.get(m.id) ??
      emptyManufacturerCapacity(m.id, m.maxConcurrentOrders);
    return {
      id: m.id,
      companyName: m.companyName,
      contactPerson: m.contactPerson,
      email: m.email,
      phone: m.phone,
      taxId: m.taxId,
      taxIdType: m.taxIdType as "vkn" | "tckn" | null,
      requiresManualTaxReview: m.requiresManualTaxReview,
      status: m.status,
      // GÖSTERİM: tezgâhtaki ayrı kutu sayısı — KAPI DEĞİL (bkz. capacity modülü).
      activeOrders: cap.activeJobs,
      // Ağırlıklı ölçüm; canlı kapı olup olmadığı ayrıca belirtilir.
      loadUnits: cap.loadUnits,
      weightedLoadLive,
      // Yük OKUNAMADIYSA "Dolu" DENMEZ: bilinmeyen bir yükü doluymuş gibi
      // göstermek, admin'i var olmayan bir kapasite sorununa gönderirdi.
      hasRoom: capacityUnreadable ? true : cap.hasRoom,
      // Aynı sebeple etiket de uydurulmaz: "0/5 birim · 0 iş" yazmak, boş
      // tezgâh İDDİASIDIR ve okunamayan yükten daha kötü bir yalandır.
      loadLabel: capacityUnreadable ? "Yük okunamadı" : `Ağırlıklı yük (${weightedLoadLive ? "canlı" : "gölge"}): ${manufacturerLoadLabel(cap)}`,
      createdAt: m.createdAt.toISOString(),
      rejectionReason: m.rejectionReason,
      printerPhotoUploadedAt: m.printerPhotoUploadedAt
        ? m.printerPhotoUploadedAt.toISOString()
        : null,
      printerPhotoUrls: photoMap.get(m.id) ?? [],
      // Full application details (what the applicant chose at registration).
      whatsappPhone: m.whatsappPhone,
      address: m.address,
      iban: m.iban,
      bankAccountHolder: m.bankAccountHolder,
      bankName: m.bankName,
      maxConcurrentOrders: m.maxConcurrentOrders,
      acceptingOrders: m.acceptingOrders,
      capabilities: m.capabilities ?? [],
      paintsInHouse: m.paintsInHouse,
      coverageProvinces: m.coverageProvinces ?? [],
      mapVisible: m.mapVisible,
      onboardingAcceptedAt: m.onboardingAcceptedAt
        ? m.onboardingAcceptedAt.toISOString()
        : null,
      // Partner-level admin audit lines (e.g. a closed tax review), shown in Detay.
      notes: m.notes,
    };
  });

  return (
    <div className="p-4 sm:p-8">
      <ManufacturersClient manufacturers={serialized} locale={locale} />
    </div>
  );
}
