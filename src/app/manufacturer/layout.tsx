import { getLocale } from "@/lib/i18n/get-locale";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { db } from "@/lib/db";
import { orders, manufacturers } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { ManufacturerSidebar } from "./sidebar";
import { ManufacturerRealtimeShell } from "./realtime-shell";
import { PanelShell } from "@/components/panel-shell";
import { VerificationGate } from "./verification-gate";

/**
 * GÖSTERİM amaçlı rozet okuması: sonuç yalnızca kenar çubuğunda GÖSTERİLİR, bir
 * kapıyı açıp kapatmaz. Arıza YUTULMAZ — null "0" DEĞİL "BİLİNMİYOR" demektir.
 *
 * NEDEN KABUKTA AYRI BİR KURAL: bu sayım /manufacturer/* altındaki HER sayfanın
 * KABUĞUNDA çalışır. Korumasız hâlinde `orders` okunamadığında düşen tek bir
 * kart değil, üreticinin panelinin TAMAMIdır — üstelik sayfaların kendi
 * "okunamadı" korumaları hiç çalışamadan, çünkü kabuk onlardan önce ölür.
 * Yalnızca GÖSTERİLEN bir sayı, panelin açılmasının ön şartı olamaz. Bu,
 * admin kabuğunda ÖLÇÜLEN ve düzeltilen arızanın birebir ikizidir
 * (bkz. src/app/admin/layout.tsx).
 */
async function displayRead<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[üretici paneli] ${label} sayısı okunamadı`, e);
    return null;
  }
}

/**
 * Panelin HER sayfasının en üstünde duran arıza şeridi.
 *
 * NEDEN İÇERİĞİN ÜSTÜNDE, kenar çubuğunda değil: üretici oraya bakar ve mobilde
 * kenar çubuğu kapalı bir çekmecedir — orada yazan uyarı hiç görülmezdi. Rozetin
 * "?" işareti sebebi söylemez, yalnız sorar; cümle burada kurulur.
 */
function PanelReadNotice({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <div
      role="alert"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-8"
    >
      <p className="font-semibold">
        Menüdeki bazı sayılar şu anda okunamıyor (geçici sistem arızası)
      </p>
      <p className="mt-1 text-amber-900/80">
        Panel ve bu sayfadaki kayıtlar çalışıyor; ama menüde &quot;?&quot; yazan
        rozetler SIFIR DEĞİL, BİLİNMİYOR: {areas.join(" · ")}. Birkaç dakika sonra
        sayfayı yenileyin.
      </p>
    </div>
  );
}

export default async function ManufacturerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const session = await getManufacturerSession();

  // If no session, render children without sidebar (login/register pages)
  // Middleware handles redirecting unauthenticated users away from protected routes
  if (!session) {
    return (
      <LocaleProvider locale={locale}>
        {children}
      </LocaleProvider>
    );
  }

  // KİMLİK OKUMASI bilerek KORUMASIZ: bu satır bir rozet değil, panelin
  // KAPISIDIR (onay durumu). Okunamadığında "aktif üretici" varsayıp paneli
  // açmak, kapıyı arızaya dayanarak açmak olurdu — kapı besleyen okuma kapalı
  // tarafa düşer.
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });

  if (!manufacturer) {
    return (
      <LocaleProvider locale={locale}>
        {children}
      </LocaleProvider>
    );
  }

  // Conditionally-approved manufacturers see only the printer-photo upload gate
  if (manufacturer.status === "conditionally_approved") {
    return (
      <LocaleProvider locale={locale}>
        <VerificationGate
          companyName={manufacturer.companyName}
          alreadyUploaded={manufacturer.printerPhotoUploadedAt != null}
        />
      </LocaleProvider>
    );
  }

  // Non-active manufacturers get layout without order count data
  if (manufacturer.status !== "active") {
    return (
      <LocaleProvider locale={locale}>
        <ManufacturerRealtimeShell>
          <PanelShell
            title="Figurunica Üretici"
            sidebar={<ManufacturerSidebar newAssignmentCount={0} />}
          >
            {children}
          </PanelShell>
        </ManufacturerRealtimeShell>
      </LocaleProvider>
    );
  }

  // Count orders with status 'assigned' for this manufacturer.
  // KORUMALI: yalnız rozet için okunur (yukarıdaki gerekçe).
  const assignedRead = await displayRead(
    "yeni iş teklifleri",
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        sql`${orders.manufacturerId} = ${session.manufacturerId} AND ${orders.manufacturerStatus} = 'assigned'`
      )
  );
  // null = okunamadı (BİLİNMİYOR); sayı = gerçek sayım.
  const assignedCount = assignedRead === null ? null : assignedRead[0]?.count ?? 0;
  const unreadableAreas = [
    assignedRead === null && "Yeni iş teklifleri",
  ].filter((x): x is string => typeof x === "string");

  return (
    <LocaleProvider locale={locale}>
      <ManufacturerRealtimeShell>
        <PanelShell
          title="Figurunica Üretici"
          sidebar={
            <ManufacturerSidebar newAssignmentCount={assignedCount} />
          }
        >
          <PanelReadNotice areas={unreadableAreas} />
          {children}
        </PanelShell>
      </ManufacturerRealtimeShell>
    </LocaleProvider>
  );
}
