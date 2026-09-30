export const dynamic = "force-dynamic";

import { killAllEngaged } from "@/lib/config/flags";
import { getAllFlags } from "@/lib/services/flags";
import { FlagsClient } from "./flags-client";
import { FxClient } from "./fx-client";

/**
 * `/admin/ayarlar` — özellik bayrakları.
 *
 * Bugüne kadar `platform_flags` tablosuna yalnız harcama koruması yazıyordu;
 * bir anahtarı açmak için veritabanına elle girmek gerekiyordu. Anlık teklif
 * motorunun müşteriye açılması (`instant_quote_enabled`) bir DAĞITIM olayı
 * değil bir SAHİP kararıdır ve bu sayfa o kararın düğmesidir: kod canlıda
 * olabilir, satış yüzeyi kapalı durabilir.
 */
export default async function AdminSettingsPage() {
  const flags = await getAllFlags();

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Özellik bayrakları</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Her anahtar bir özelliği <strong>çalışma anında</strong> açar ya da kapatır;
        yayına alma gerekmez. Değişiklik bütün süreçlere (web, worker) en geç on
        saniyede ulaşır.
      </p>

      <FlagsClient flags={flags} killAll={killAllEngaged()} />

      {/*
        Kur kartı bayrakların ALTINDA ayrı bir bölüm (mevcut bölüm bozulmadı):
        bir bayrak bir KARARDIR, kur ise bir DURUMDUR ("kur güncel mi").
        İkisini aynı listede göstermek, açılıp kapanan bir anahtarla okunan bir
        ölçüyü karıştırmak olurdu. Kartın kendi verisini kendisi okuması da
        bilinçli: kur okuması patlarsa bayrak ekranı ayakta kalır.
      */}
      <FxClient />
    </div>
  );
}
