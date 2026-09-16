export const dynamic = "force-dynamic";

import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerDocuments, manufacturers, painters } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { KycQueueClient } from "./client";

export default async function AdminKycQueuePage() {
  // Üç liste de AYRI ve KORUMALI okunur: biri okunamadığında kuyruk ekranının
  // tamamının kaybolması, admin'i tam da onay veremediği anda dışarıda
  // bırakıyordu. `with:` de bu yüzden yok — firma ADI yalnızca gösteriliyor.
  const docRead = await db.query.manufacturerDocuments
    .findMany({
      where: eq(manufacturerDocuments.status, "pending"),
      orderBy: [desc(manufacturerDocuments.createdAt)],
      limit: 200,
    })
    .catch((e) => {
      console.error("kyc-queue: belge kuyruğu okunamadı", e);
      return null;
    });
  const docsUnreadable = docRead === null;
  const docs = docRead ?? [];

  const docMfgIds = [...new Set(docs.map((x) => x.manufacturerId))];
  const docNameRead = docMfgIds.length
    ? await db
        .select({ id: manufacturers.id, companyName: manufacturers.companyName })
        .from(manufacturers)
        .where(inArray(manufacturers.id, docMfgIds))
        .catch((e) => {
          console.error("kyc-queue: firma adları okunamadı", e);
          return null;
        })
    : [];
  const docNamesUnreadable = docNameRead === null;
  const docNameById = new Map((docNameRead ?? []).map((m) => [m.id, m.companyName]));
  // Both partner realms stage IBAN changes behind the same review gate, so the
  // queue has to list both — a painter change listed nowhere could never be
  // approved, leaving the painter's live IBAN permanently stale.
  const [mfgIbanRead, painterIbanRead] = await Promise.all([
    db.query.manufacturers
      .findMany({
        where: eq(manufacturers.ibanReviewStatus, "pending"),
        columns: { id: true, companyName: true, iban: true, pendingIban: true },
      })
      .catch((e) => {
        console.error("kyc-queue: üretici IBAN kuyruğu okunamadı", e);
        return null;
      }),
    db.query.painters
      .findMany({
        where: eq(painters.ibanReviewStatus, "pending"),
        columns: { id: true, companyName: true, iban: true, pendingIban: true },
      })
      .catch((e) => {
        console.error("kyc-queue: boyacı IBAN kuyruğu okunamadı", e);
        return null;
      }),
  ]);
  const mfgIbanUnreadable = mfgIbanRead === null;
  const painterIbanUnreadable = painterIbanRead === null;
  const pendingIban = mfgIbanRead ?? [];
  const pendingPainterIban = painterIbanRead ?? [];

  return (
    <>
      {(docsUnreadable || docNamesUnreadable || mfgIbanUnreadable || painterIbanUnreadable) && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Bu listenin bazı bilgileri şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            {[
              docsUnreadable && "bekleyen belge kuyruğu",
              docNamesUnreadable && "firma adları",
              mfgIbanUnreadable && "üretici IBAN değişiklikleri",
              painterIbanUnreadable && "boyacı IBAN değişiklikleri",
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            okunamadı: bu bölümler BOŞ DEĞİL, bilinmiyor. Boş görünen bir kuyruk
            &quot;onay bekleyen yok&quot; anlamına gelmez; birkaç dakika sonra
            sayfayı yenileyin.
          </p>
        </div>
      )}
    <KycQueueClient
      docs={docs.map((x) => ({
        id: x.id,
        type: x.type,
        company:
          docNameById.get(x.manufacturerId) ??
          (docNamesUnreadable ? "Firma adı okunamadı" : "—"),
        url: getPublicUrl(x.storageKey),
        createdAt: x.createdAt.toISOString(),
      }))}
      ibanChanges={[
        ...pendingIban.map((m) => ({
          id: m.id,
          realm: "manufacturer" as const,
          company: m.companyName,
          current: m.iban,
          pending: m.pendingIban,
        })),
        ...pendingPainterIban.map((p) => ({
          id: p.id,
          realm: "painter" as const,
          company: p.companyName,
          current: p.iban,
          pending: p.pendingIban,
        })),
      ]}
    />
    </>
  );
}
