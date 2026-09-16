export const dynamic = "force-dynamic";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painters, painterQcPhotos } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { NOT_REFUNDED } from "@/lib/services/admin-order-sql";
import { PainterQcQueueClient } from "./client";

export default async function AdminPainterQcQueuePage() {
  const rows = await db.query.orders.findMany({
    // Refunded orders are frozen, so their painter QC is not work. Same
    // predicate as the sidebar's "Boyacı QC" badge that opens this list.
    where: and(eq(orders.painterStatus, "qc_pending"), NOT_REFUNDED),
    orderBy: [desc(orders.updatedAt)],
    limit: 200,
    columns: {
      id: true, orderNumber: true, customerName: true, style: true,
      figurineSize: true, finish: true, paintingPriceKurus: true, painterQcRound: true,
      // Boyacı ADI ayrı okunuyor (aşağıda); kimlik kolonda kalır.
      painterId: true,
    },
    // `with:` BİLEREK YOK: `painters` yalnızca GÖSTERİLİYOR (ad), ama ilişkisel
    // sorguda okunamadığında kuyruk ekranının tamamı 500 verirdi.
  });

  const orderIds = rows.map((r) => r.id);
  const painterIds = [
    ...new Set(rows.map((r) => r.painterId).filter((x): x is string => !!x)),
  ];
  const [nameRead, photoRead] = await Promise.all([
    painterIds.length
      ? db
          .select({ id: painters.id, companyName: painters.companyName })
          .from(painters)
          .where(inArray(painters.id, painterIds))
          .catch((e) => {
            console.error("painter-qc-queue: boyacı adları okunamadı", e);
            return null;
          })
      : [],
    orderIds.length
      ? db.query.painterQcPhotos
          .findMany({ where: inArray(painterQcPhotos.orderId, orderIds) })
          .catch((e) => {
            console.error("painter-qc-queue: QC fotoğrafları okunamadı", e);
            return null;
          })
      : [],
  ]);
  const namesUnreadable = nameRead === null;
  const nameById = new Map((nameRead ?? []).map((x) => [x.id, x.companyName]));
  const photosUnreadable = photoRead === null;
  const photos = photoRead ?? [];

  return (
    <>
      {(namesUnreadable || photosUnreadable) && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Bu listenin bazı bilgileri şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            {[
              namesUnreadable && "boyacı adları",
              photosUnreadable &&
                "boyama QC fotoğrafları (kartlarda hiç fotoğraf görünmüyor — SİLİNMEDİLER, okunamadılar; bu hâlde onay/ret vermeyin)",
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            okunamadı: bu alanlar BOŞ DEĞİL, bilinmiyor.
          </p>
        </div>
      )}
    {/* KARAR KAPISI İSTEMCİYE GEÇER: fotoğraf tablosu okunamazken kart onay/ret
        SUNMAZ. Bayrak gönderilmediğinde istemci, okunamayan tabloyu "Fotoğraf
        bulunamadı" diye ÖLÇÜLMÜŞ bir sıfır gibi yazıyor ve iki düğmeyi de açık
        bırakıyordu — yukarıdaki şeridin aynı ekranda söylediğinin tam tersi. */}
    <PainterQcQueueClient
      photosUnreadable={photosUnreadable}
      jobs={rows.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        painterName:
          nameById.get(r.painterId ?? "") ??
          (namesUnreadable ? "Boyacı adı okunamadı" : "—"),
        customerName: r.customerName,
        style: r.style,
        figurineSize: r.figurineSize,
        finish: r.finish,
        paintingPriceKurus: r.paintingPriceKurus,
        photos: photos
          .filter((p) => p.orderId === r.id && p.round === r.painterQcRound)
          .map((p) => ({ id: p.id, url: getPublicUrl(p.thumbnailKey || p.storageKey), fullUrl: getPublicUrl(p.storageKey) })),
      }))}
    />
    </>
  );
}
