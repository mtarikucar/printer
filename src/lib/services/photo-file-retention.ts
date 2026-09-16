import { and, asc, eq, inArray, like, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminActions, orderDrafts, orderPhotos, previews } from "@/lib/db/schema";
import { deleteFile } from "@/lib/services/storage";

/**
 * Yüklenen dosyaların SAKLAMA ve SİLME kuralı — tek yerde.
 *
 * Burada iki ayrı silici buluşuyor ve ikisi de aynı soruyu sormak zorunda:
 *   - admin referans fotoğrafını kaldırdığında bekleme süresi dolan dosyalar
 *     (`sweepExpiredPhotoFiles`),
 *   - süresi dolan önizlemelerin dosyaları (preview-cleanup.worker.ts).
 *
 * Soru şu: BU DOSYAYI GÖSTEREN BAŞKA BİR KAYIT VAR MI? Aynı depolama anahtarı
 * birden çok kayda meşru olarak bağlanır — yeniden sipariş (reorder) ORİJİNAL
 * siparişin satırından anahtarı çıkarıp yeni taslağı onunla tohumlar
 * (customer/orders/[orderNumber]/reorder/route.ts) ve taslak siparişe
 * dönüşürken aynı anahtarla yeni bir order_photos satırı yazılır
 * (order-draft.ts); aynı fotoğraftan ikinci bir önizleme üretilebilir
 * (preview/[id]/regenerate, agent/execute-tool aynı photoKeys ile yeni satır
 * açar). Silici yalnız kendi satırına bakarsa, ÖTEKİ kaydın görselini 404'e
 * düşürür — yani kimsenin istemediği bir veri kaybı.
 *
 * Bu modül worker'dan da çağrılır: `server-only` İMPORT ETMEZ ve etmemeli
 * (standalone Node worker'ı crash-loop'a sokar, worker-server-only-trap).
 */

/**
 * Kaldırılan fotoğrafın DOSYASI hemen silinmez.
 *
 * Yanlışlıkla kaldırılan bir müşteri fotoğrafı geri getirilemezdi: satır
 * silinince dosya da gitseydi, referans görsel tamamen kaybolurdu (müşteri
 * çoğu zaman aynı fotoğrafı tekrar gönderemez). Öte yandan dosyayı sonsuza
 * kadar diskte bırakmak da KVKK açısından yanlış: müşteri fotoğrafı, çoğu
 * zaman bir insan yüzü, "silindi" denen bir kayda rağmen diskte kalıyordu.
 *
 * Çözüm: satır hemen kopar (ekranlarda görünmez), dosya bu süre sonunda
 * süpürmede silinir.
 */
export const PHOTO_FILE_GRACE_DAYS = 7;

/**
 * Denetim notundaki makine-okunur işaretler: silinmeyi BEKLEYEN, silinmiş ve
 * başka kayıt gösterdiği için KORUNAN dosya.
 *
 * İşaret " key=" ekine kadar tek parçadır ve süpürme sorgusu da bu sabitle
 * kurulur. Önceden sorgu yalnız "[FOTO-SIL" önekini arıyordu; o önek,
 * süpürmenin kendi yazdığı "[FOTO-SILINDI key=…]" notlarıyla da eşleşiyordu.
 * Kapatılmış satırlar biriktikçe LIMIT'i dolduruyor, sıra gerçekten silinmesi
 * gereken satırlara hiç gelmiyordu — yani "silindi" denen müşteri fotoğrafı
 * diskte kalıyordu (KVKK açısından tam olarak kaçınılmak istenen durum).
 * "SILINDI"/"KORUNDU" ekleri deseni bozduğu için artık yalnızca bekleyen
 * satırlar seçilir.
 */
export const PENDING_MARK = "[FOTO-SIL key=";
export const DONE_MARK = "[FOTO-SILINDI key=";
export const KEPT_MARK = "[FOTO-SIL-KORUNDU key=";

/**
 * Bir notta BİRDEN ÇOK bekleyen işaret olabilir: tek bir fotoğrafın asıl
 * dosyası ve küçük görseli (thumbnail) ayrı dosyalardır ve ikisi de aynı
 * kaldırma işlemiyle silinmeyi bekler. Genel (`g`) desen, tek satırın tüm
 * işaretlerini toplar.
 */
const PENDING_RE_ALL = /\[FOTO-SIL key=([^\]]+)\]/g;

/** Nottaki bekleyen anahtarlar, yazıldıkları sırayla ve yinelenmeden. */
export function pendingKeysFromNote(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const keys = [...notes.matchAll(PENDING_RE_ALL)].map((m) => m[1]);
  return [...new Set(keys)];
}

/**
 * Bir anahtarın bekleyen işaretini sonuç işaretiyle (silindi/korundu)
 * değiştirir; nottaki DİĞER bekleyen işaretlere dokunmaz.
 *
 * `String.replace` değil `split/join`: anahtar düz metin olarak aranır, yani
 * ne regex özel karakterleri kaçırılmak zorundadır ne de değiştirme metnindeki
 * `$&`/`$1` gibi diziler yanlışlıkla yorumlanır.
 */
export function applySweepOutcome(notes: string, key: string, mark: string): string {
  return notes.split(`${PENDING_MARK}${key}]`).join(`${mark}${key}]`);
}

/** Bir dosya anahtarı için yazılacak bekleyen-silme işareti. */
export function pendingDeletionMark(key: string): string {
  return `${PENDING_MARK}${key}]`;
}

export type ReferenceScope = {
  /**
   * Önizleme satırları da referans sayılsın mı?
   *
   * Admin süpürmesi SAYMAZ: önizlemelerin kendi saklama süresi var ve süresi
   * dolunca temizlik işçisi o anahtarları zaten kendisi siler. Temizlik işçisi
   * ise SAYAR — silmek üzere olduğu önizlemenin anahtarını başka bir önizleme
   * paylaşıyor olabilir (aynı fotoğraftan ikinci bir üretim).
   */
  countPreviews?: boolean;
  /** Temizlik işçisinin o an sildiği önizleme: kendi satırı referans değildir. */
  ignorePreviewId?: string | null;
};

/**
 * Bu depolama anahtarını hangi kayıt hâlâ gösteriyor?
 *
 * Yüzeyin ADINI döndürür (günlüğe yazmak için), gösteren yoksa null. Sayılan
 * yüzeyler, dosyayı GERÇEKTEN gösteren kayıtlardır:
 *   - order_photos (hangi sipariş olursa olsun; asıl görsel VE küçük görsel),
 *   - henüz siparişe dönüşmemiş CANLI taslaklar (pending/awaiting_review);
 *     bunlar promosyonda order_photos satırına dönüşecek. "confirmed" taslak
 *     sayılmaz — onun fotoğrafı zaten order_photos'ta duruyor, sayılsaydı
 *     dosya hiçbir zaman silinemezdi (KVKK amacı boşa çıkardı),
 *   - (isteğe bağlı) öteki önizlemeler.
 *
 * `workshop_participants.photo_key` BİLEREK sayılmaz: o kolon katılım anında
 * bir kez yazılır ve hiçbir ekran/uç onu OKUMAZ (katılımcının fotoğrafı
 * taslağın photoKeys'ine kopyalanır, oradan order_photos satırına dönüşür —
 * yani gösterilen yüzey zaten sayılıyor). Arşiv niteliğindeki o satırı
 * referans saymak, admin bir atölye siparişinin fotoğrafını KVKK gerekçesiyle
 * kaldırdığında dosyanın hiçbir zaman silinmemesi demek olurdu.
 */
export async function storageKeyReferencedBy(
  key: string,
  scope: ReferenceScope = {}
): Promise<string | null> {
  // Anahtar, order_photos'ta imzalı URL içinde yaşar:
  // `${appUrl}/api/files/${key}?exp=…&sig=…`. LIKE yerine position(): nanoid
  // anahtarları `_` içerebilir ve LIKE'ta `_` joker olurdu.
  const marker = `/api/files/${key}`;
  const withQuery = `${marker}?`;
  const [photo] = await db
    .select({ id: orderPhotos.id })
    .from(orderPhotos)
    .where(
      sql`position(${withQuery} in ${orderPhotos.originalUrl}) > 0
          OR right(${orderPhotos.originalUrl}, ${marker.length}) = ${marker}
          OR position(${withQuery} in coalesce(${orderPhotos.thumbnailUrl}, '')) > 0
          OR right(coalesce(${orderPhotos.thumbnailUrl}, ''), ${marker.length}) = ${marker}`
    )
    .limit(1);
  if (photo) return "order_photos";

  const [draft] = await db
    .select({ id: orderDrafts.id })
    .from(orderDrafts)
    .where(
      and(
        inArray(orderDrafts.status, ["pending", "awaiting_review"]),
        or(
          eq(orderDrafts.photoKey, key),
          sql`${orderDrafts.photoKeys} @> ${JSON.stringify([key])}::jsonb`
        )
      )
    )
    .limit(1);
  if (draft) return "order_drafts";

  if (scope.countPreviews) {
    // Yalnız temizlik işçisinin SİLEBİLDİĞİ anahtar kolonları sorulur
    // (photoKey/photoKeys/glbKey). objKey ve stlKey sorulmaz: o dosyalar hiç
    // silinmiyor ve her dönüşüm kendi nanoid adını aldığı için bir önizlemenin
    // obj/stl anahtarı başka bir satırın foto/glb anahtarına eşit olamaz.
    const sameKey = or(
      eq(previews.photoKey, key),
      eq(previews.glbKey, key),
      sql`${previews.photoKeys} @> ${JSON.stringify([key])}::jsonb`
    );
    const [other] = await db
      .select({ id: previews.id })
      .from(previews)
      .where(
        scope.ignorePreviewId
          ? and(ne(previews.id, scope.ignorePreviewId), sameKey)
          : sameKey
      )
      .limit(1);
    if (other) return "previews";
  }

  return null;
}

/**
 * Bekleme süresi dolan dosyaları siler ve notu "silindi"ye çevirir.
 *
 * Neden ayrı bir tablo/kolon değil: bu faz migration açmıyor. Denetim kaydı
 * zaten kalıcı, sıralı ve siparişe bağlı; işaret orada durunca hem süpürme
 * listesi hem de olayın kendisi tek satırda kalıyor.
 *
 * İki yerden çağrılır: fotoğraf ekleme/kaldırma ucu (hemen bir tur koşsun
 * diye) ve saatlik temizlik işçisi. İşçi olmasaydı süpürme YALNIZCA o uca
 * trafik geldiğinde koşardı: admin bir daha referans fotoğrafına dokunmazsa
 * "silinecek" denen müşteri yüzü diskte kalırdı.
 */
export async function sweepExpiredPhotoFiles(): Promise<{
  deleted: number;
  kept: number;
}> {
  const cutoff = new Date(Date.now() - PHOTO_FILE_GRACE_DAYS * 24 * 3600 * 1000);
  const due = await db
    .select({ id: adminActions.id, notes: adminActions.notes })
    .from(adminActions)
    .where(
      and(like(adminActions.notes, `%${PENDING_MARK}%`), lt(adminActions.createdAt, cutoff))
    )
    // En eski bekleyen önce: süresi en çok geçmiş dosya, LIMIT'in son sırasına
    // düşüp turlarca beklemesin.
    .orderBy(asc(adminActions.createdAt))
    .limit(50);

  let deleted = 0;
  let kept = 0;
  for (const row of due) {
    const notes = row.notes ?? "";
    const keys = pendingKeysFromNote(notes);
    if (keys.length === 0) continue;

    let nextNotes = notes;
    for (const key of keys) {
      // Referans sayımı okunamazsa dosya KORUNUR: silme geri alınamaz, bekleme
      // ise sonraki turda tekrar denenir. (Bu turda işaret kapatılmaz.)
      let referencedBy: string | null;
      try {
        referencedBy = await storageKeyReferencedBy(key);
      } catch (e) {
        console.error("photo sweep: reference check failed, keeping file", e);
        continue;
      }

      if (referencedBy) {
        // Not kapatılır, dosya kalır. Öteki sipariş de fotoğrafını kaldırırsa
        // kendi bekleyen işaretini yazar ve dosya o turda silinir.
        nextNotes = applySweepOutcome(nextNotes, key, KEPT_MARK);
        kept++;
        continue;
      }

      // Dosya yoksa da not kapatılır: amaç "diskte kalmasın", satır tekrar
      // tekrar denenecek bir kuyruk değil.
      await deleteFile(key).catch(() => {});
      nextNotes = applySweepOutcome(nextNotes, key, DONE_MARK);
      deleted++;
    }

    if (nextNotes !== notes) {
      await db
        .update(adminActions)
        .set({ notes: nextNotes })
        .where(eq(adminActions.id, row.id))
        .catch((e) => console.error("photo sweep: note update failed", e));
    }
  }
  return { deleted, kept };
}
