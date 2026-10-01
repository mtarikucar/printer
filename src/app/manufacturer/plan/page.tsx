export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { frameworkScreensEnabled } from "@/lib/services/quote-access";
import {
  loadFrameworkForwardLoad,
  loadManufacturerPlannedBatches,
} from "@/lib/services/quote-framework";
import { ManufacturerPlanClient } from "./client";

/**
 * `/manufacturer/plan` — atölyenin ileriye dönük çerçeve parti planı.
 *
 * BAYRAK KAPALIYKEN 404 (`notFound`), 403 DEĞİL: kapalı bir özelliğin varlığını
 * duyurmanın anlamı yok. Ölçü YALNIZ BAYRAK (`frameworkScreensEnabled`): bu
 * sayfaya zaten yalnız giriş yapmış bir ÜRETİCİ girebiliyor, yani admin
 * oturumunu geçiren kapı (`frameworkSurfacesEnabled`) burada hiçbir şeyi
 * kapatmazdı — `/admin/cerceve` ile aynı gerekçe.
 *
 * YALNIZ GÖSTERİM: bu sayfanın hiçbir yazma ucu yok ve gösterdiği sayılar
 * hiçbir yerde atama reddetmez (`manufacturer-capacity.ts` KARAR 2). Bu yüzden
 * İKİ okuma da KORUMALIDIR: arıza sayfayı düşürmez, `null` "boş" değil
 * "BİLİNMİYOR" demektir ve ekran bunu söyler.
 */
const FORWARD_LOAD_WINDOW_DAYS = 30;

async function displayRead<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[manufacturer/plan] ${label} okunamadı`, e);
    return null;
  }
}

export default async function ManufacturerPlanPage() {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  // KİMLİK OKUMASI korumasız: bu satır bir rozet değil, panelin KAPISIDIR
  // (onay durumu) — `/manufacturer/orders` ile aynı duruş.
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    redirect("/manufacturer/dashboard");
  }

  if (!(await frameworkScreensEnabled())) notFound();

  const batches = await displayRead(
    "planlı parti listesi",
    loadManufacturerPlannedBatches(session.manufacturerId)
  );
  const forwardLoad = await displayRead(
    "ileriye dönük yük",
    loadFrameworkForwardLoad({
      manufacturerId: session.manufacturerId,
      windowDays: FORWARD_LOAD_WINDOW_DAYS,
    })
  );

  return (
    <ManufacturerPlanClient
      batches={batches ?? []}
      forwardLoad={forwardLoad}
      unreadable={batches === null}
    />
  );
}
