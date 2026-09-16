export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, workshopRequests, workshopVenues } from "@/lib/db/schema";
import { WorkshopRequestDetailClient } from "./client";

export default async function AdminWorkshopRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // `with:` BİLEREK YOK: hesap e-postası yalnızca GÖSTERİLİYOR, ama ilişkisel
  // sorgu TEK ifadedir — `users` okunamadığında talebin tamamı görünmez olurdu.
  const req = await db.query.workshopRequests.findFirst({
    where: eq(workshopRequests.id, id),
  });
  if (!req) notFound();

  const accountRead = req.userId
    ? await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, req.userId))
        .catch((e) => {
          console.error("workshop request: hesap e-postası okunamadı", e);
          return null;
        })
    : [];
  const accountEmailUnreadable = accountRead === null;

  // Bu talepten daha önce mekan yaratıldı mı? "Mekana dönüştür" butonu bunu
  // gizler — aynı talepten ikinci kez mekan yaratılmaz (bkz. workshop-venue.ts).
  const venueRead = await db.query.workshopVenues
    .findFirst({
      where: eq(workshopVenues.requestId, id),
      columns: { id: true },
    })
    .catch((e) => {
      console.error("workshop request: mekân kaydı okunamadı", e);
      return null;
    });
  // `undefined` = kayıt yok, `null` = OKUNAMADI. İkisi de düğmeyi açık bırakır
  // ama ikinci hâlde uyarı basılır: ikinci kez mekân yaratmayı SUNUCU reddeder
  // (workshop-venue.ts), ekran ise bunu bilmediğini söylemek zorunda.
  const venueUnreadable = venueRead === null;
  const venue = venueRead ?? null;

  return (
    <>
      {(accountEmailUnreadable || venueUnreadable) && (
        <div
          role="alert"
          className="m-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 sm:m-8"
        >
          <p className="font-semibold">
            Bu talebin bazı kayıtları şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            {[
              accountEmailUnreadable &&
                "talebi gönderen hesabın e-postası (boş görünmesi “hesapsız talep” demek DEĞİL)",
              venueUnreadable &&
                "bu talepten daha önce mekân yaratılıp yaratılmadığı — dönüştürmeden önce mekân listesini kontrol edin",
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            okunamadı. Talebin kendisi gerçek kayıttır.
          </p>
        </div>
      )}
    <WorkshopRequestDetailClient
      data={{
        id: req.id,
        venueId: venue?.id ?? null,
        reference: req.reference,
        status: req.status,
        contactName: req.contactName,
        contactEmail: req.contactEmail,
        contactPhone: req.contactPhone,
        organizationName: req.organizationName,
        venueType: req.venueType,
        city: req.city,
        district: req.district,
        addressLine: req.addressLine,
        participantCount: req.participantCount,
        ageGroup: req.ageGroup,
        workshopType: req.workshopType,
        preferredDate: req.preferredDate,
        alternativeDate: req.alternativeDate,
        budgetRange: req.budgetRange,
        message: req.message,
        howHeard: req.howHeard,
        adminNotes: req.adminNotes,
        rejectionReason: req.rejectionReason,
        quotedPriceKurus: req.quotedPriceKurus,
        scheduledAt: req.scheduledAt ? req.scheduledAt.toISOString() : null,
        adminEmail: req.adminEmail,
        accountEmail: accountRead?.[0]?.email ?? null,
        createdAt: req.createdAt.toISOString(),
        updatedAt: req.updatedAt.toISOString(),
      }}
    />
    </>
  );
}
