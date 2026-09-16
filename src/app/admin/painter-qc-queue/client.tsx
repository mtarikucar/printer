"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sizeDisplayTr } from "@/lib/config/sizes";

interface QcPhoto {
  id: string;
  url: string;
  fullUrl: string;
}
interface QcJob {
  id: string;
  orderNumber: string;
  painterName: string;
  customerName: string | null;
  style: string | null;
  figurineSize: string | null;
  finish: string | null;
  paintingPriceKurus: number;
  photos: QcPhoto[];
}

export function PainterQcQueueClient({
  jobs,
  photosUnreadable,
}: {
  jobs: QcJob[];
  /**
   * painter_qc_photos OKUNAMADI (sunucu doldurur: page.tsx · photoRead === null).
   *
   * Boş bir fotoğraf dizisi ile okunamayan bir tablo AYNI ŞEY DEĞİLDİR: ilki bir
   * ÖLÇÜM, ikincisi yapılmamış bir okuma. Bu kuyruğun tek işi fotoğrafa bakıp
   * karar vermek olduğundan bayrak, kartın hem METNİNİ hem de KONTROLLERİNİ
   * değiştirir.
   */
  photosUnreadable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  const act = async (id: string, action: "approve" | "reject") => {
    if (action === "reject" && !(reason[id] ?? "").trim()) {
      alert("Red gerekçesi girin");
      return;
    }
    setBusy(`${action}-${id}`);
    try {
      const res = await fetch(`/api/admin/painter-qc/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason: reason[id] } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        photoStampFailed?: boolean;
      };
      if (!res.ok) {
        alert(data.error || "İşlem başarısız");
        return;
      }
      // KARAR GEÇTİ ama turun fotoğraf satırları damgalanamadı — uç bunu ayrı
      // bir bayrakla bildiriyor. Söylenmezse hiçbir insan göremez: ekran
      // "başarılı" diye tazelenir, fotoğraflar ise 'bekliyor' görünmeye devam
      // eder ve bir sonraki bakan, bunun arıza mı gerçek bir durum mu olduğunu
      // ayırt edemez. Yapılan işi yapılmamış gibi anlatmamak kadar, yarım kalan
      // kaydı sessizce yutmamak da bu ekranın işi.
      if (data.photoStampFailed) {
        alert(
          action === "approve"
            ? "Onay UYGULANDI: boyacının kargosu açıldı. Ancak turun fotoğraf satırları damgalanamadı; fotoğraflar 'bekliyor' görünmeye devam edebilir. Karar geçerlidir, tekrar onaylamayın."
            : "Ret UYGULANDI: boyacı yeniden boyamaya gönderildi. Ancak turun fotoğraf satırları damgalanamadı; fotoğraflar 'bekliyor' görünmeye devam edebilir. Karar geçerlidir, tekrar reddetmeyin."
        );
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Boyacı QC Kuyruğu</h1>
        <p className="text-sm text-gray-500 mt-1">
          Boyacıların gönderdiği boyama işlerini inceleyin; onaylamadan kargolanamazlar.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          QC onayı bekleyen boyama işi yok.
        </div>
      ) : (
        <div className="space-y-5">
          {jobs.map((j) => (
            <div key={j.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <span className="font-mono text-sm text-indigo-600">{j.orderNumber}</span>
                  <span className="text-sm text-gray-700 ml-3">
                    {j.style || "Özel figür"}
                    {j.figurineSize &&
                      ` · ${sizeDisplayTr(j.figurineSize, { short: true })}`}
                    {j.finish && ` · ${j.finish}`}
                  </span>
                </div>
                <span className="text-xs text-gray-500">Boyacı: {j.painterName}</span>
              </div>

              {/* OKUNAMAYAN TABLO, ÖLÇÜLMÜŞ BİR SIFIR DEĞİLDİR: "Fotoğraf
                  bulunamadı" cümlesi bu hâlde kaydın yazmadığı bir iddiaydı. */}
              {photosUnreadable ? (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Bu işin QC fotoğrafları okunamadı: kart BOŞ değil, kaç fotoğraf
                  yüklendiği bilinmiyor. Fotoğraflar silinmedi — boyacıdan yeniden
                  yükleme istemeyin.
                </p>
              ) : j.photos.length === 0 ? (
                <p className="text-sm text-amber-600 mb-3">Fotoğraf bulunamadı.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mb-4">
                  {j.photos.map((p) => (
                    <a key={p.id} href={p.fullUrl} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt="QC"
                        className="w-28 h-28 object-cover rounded-lg border border-gray-200"
                      />
                    </a>
                  ))}
                </div>
              )}

              {/* KONTROL YA ÇALIŞIR YA DA SEBEBİYLE KAYBOLUR.
                  Fotoğraflar okunamazken onay da ret de GÖRÜLMEMİŞ bir işe imza
                  atmaktır: onay boyacının kargosunu açar ve hakedişine giden
                  yolu serbest bırakır, ret ise turu artırıp boyacıyı yeniden
                  boyamaya yollar. İkisinin de tek dayanağı fotoğraflar olduğu
                  için bu hâlde düğme GÖSTERİLMEZ; ekranın sunduğu her kontrol,
                  dayandığı kayıt okunabiliyorken sunulur. */}
              {photosUnreadable ? (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                >
                  <p className="font-semibold">Bu iş için onay ve ret kapatıldı</p>
                  <p className="mt-0.5 text-amber-900/80">
                    Karar fotoğraflara dayanır, fotoğraflar ise şu anda okunamıyor. İş
                    kuyruktan DÜŞMEDİ ve boyacıya hiçbir şey iletilmedi; okuma düzelince
                    aynı kartta karar verebilirsiniz. Birkaç dakika sonra sayfayı
                    yenileyin, sürerse sunucu günlüklerine bakın.
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => act(j.id, "approve")}
                    disabled={busy !== null}
                    className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Onayla
                  </button>
                  <input
                    value={reason[j.id] ?? ""}
                    onChange={(e) => setReason((s) => ({ ...s, [j.id]: e.target.value }))}
                    placeholder="Red gerekçesi"
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1 min-w-[180px]"
                  />
                  <button
                    onClick={() => act(j.id, "reject")}
                    disabled={busy !== null}
                    className="px-4 py-2 bg-red-50 text-red-700 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50"
                  >
                    Reddet
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
