export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { scenePresets } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { ScenePresetsManager } from "./manager";

export default async function AdminScenePresetsPage() {
  const rows = await db
    .select()
    .from(scenePresets)
    .orderBy(asc(scenePresets.sortOrder));

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Sahne Preset&apos;leri</h1>
      <p className="mt-1 max-w-2xl text-gray-500">
        Fotoğraf → 3D akışındaki &quot;sahne&quot; ekseni. Stil görünümü
        (storybook/anime/chibi) ile birleşir; sahne, figürde kimlerin olduğunu ve
        nasıl dizildiğini belirler. <strong>Prompt parçası</strong> üretim
        sırasında modele gönderilen İngilizce kompozisyon metnidir — asıl
        düzenlediğiniz değişken budur. Fiyat/boyutu etkilemez.
      </p>

      <ScenePresetsManager initial={rows} />
    </div>
  );
}
