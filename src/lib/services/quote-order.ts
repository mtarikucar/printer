/**
 * Ödenen teklifin siparişe bağlanması ve parça dosyalarının siparişe pişirilmesi.
 *
 * ÜÇ KURAL BU DOSYAYI BİÇİMLENDİRİR:
 *
 * 1. **Teklif kodu ödeme yolunun İÇİNE girmez.** `promoteDraftToOrder` ve PayTR
 *    webhook'u dokunulmaz kalır: orada atılan bir hata PayTR'a 500 döndürür ve
 *    para ÇOKTAN tahsil edilmişken webhook yeniden denenir. Bağlama
 *    `kickOffOrderProcessing`in işlemine, dosya pişirme de işlem SONRASINDAKİ
 *    BullMQ işine asılır.
 * 2. **Tek yazma yolu.** Dosyalar `attachOrderModelFilesTx` ile yazılır —
 *    admin yüklemesinin ve otomatik 3D worker'ının kullandığı AYNI gövde.
 *    Sürüm numarası, arşiv geri dolgusu ve siparişin canlı model kolonları
 *    burada İKİNCİ bir kez uygulanmaz.
 * 3. **İki kez çalışmak zararsızdır.** Bağlama yalnız `order_id IS NULL` iken
 *    yazar, dosya ekleme siparişte sürüm varsa hiçbir şey yapmaz. Aynı teklif
 *    için İKİNCİ bir taslak ödendiyse hata ATILMAZ: siparişe `[ÇİFT ÖDEME]`
 *    notu düşülür ve karar admin'e bırakılır (para iki kez alınmıştır; bunu
 *    sessizce "çözmek" yanlış olurdu).
 *
 * `import "server-only"` YOK: bu modülü BullMQ worker süreci yükler.
 */
import { and, asc, eq, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { db } from "@/lib/db";
import {
  orderModelFiles,
  orders,
  quoteCheckouts,
  quotes,
} from "@/lib/db/schema";
import { dedupeFileNames, MAX_MODEL_FILE_STEM, safeModelFileName } from "@/lib/config/order-model";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";
import type { FrozenQuotePart } from "@/lib/config/quote-types";
import { emitOrderChanged } from "@/lib/realtime/emit";
import {
  attachOrderModelFilesTx,
  latestModelFiles,
  type OrderModelFileInput,
} from "@/lib/services/order-model";
import {
  absoluteFilePath,
  fileExists,
  linkOrCopyStoredFile,
} from "@/lib/services/storage";

/** Drizzle işlem tutamacı — `db.transaction` geri çağrısının aldığı tip. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Binary STL kayıt boyutu: normal + 3 köşe (12 float32) + 2 baytlık öznitelik. */
const STL_TRIANGLE_BYTES = 50;
/** 80 baytlık başlık + uint32 üçgen sayısı. */
const STL_HEADER_BYTES = 84;
/** Köşe koordinatları kaydın 12. baytında başlar (ilk üç float NORMALDİR). */
const STL_VERTEX_OFFSET = 12;
const STL_VERTEX_FLOATS = 9;

// ─── 1. Bağlama: hangi teklif hangi siparişe ait ────────────────────────────

/**
 * Ödenen taslağın teklifini siparişe bağlar. `kickOffOrderProcessing`in
 * İŞLEMİNDE çağrılır: sipariş satırı zaten kilitli ve durum geçişiyle aynı
 * commit'e girer, yani "sipariş `review`'a geçti ama teklif bağlanmadı" hâli
 * hiç doğmaz.
 *
 * Dönen `null` = bu sipariş bir teklif siparişi DEĞİL (çağıran bugünkü akışına
 * devam eder). Dönen `{quoteId}` = teklif bu siparişe bağlandı YA DA teklif
 * başka bir siparişe bağlı olduğu için çift ödeme notu düşüldü; iki hâlde de
 * sipariş `review`'a alınır ve admin çözer.
 */
export async function linkQuoteToOrderTx(
  tx: Tx,
  args: { orderId: string; draftId: string | null }
): Promise<{ quoteId: string } | null> {
  if (!args.draftId) return null;

  // Köprü `quote_checkouts`tur: `orders`/`order_drafts` tanımlarına teklif
  // kolonu eklenmedi (o dosyalar başka bir oturumun elinde).
  const [checkout] = await tx
    .select({ quoteId: quoteCheckouts.quoteId })
    .from(quoteCheckouts)
    .where(eq(quoteCheckouts.draftId, args.draftId))
    .limit(1);
  if (!checkout) return null;

  const now = new Date();
  // Koşullu UPDATE: iki eşzamanlı kickoff'tan yalnız biri yazar.
  const [linked] = await tx
    .update(quotes)
    .set({ orderId: args.orderId, status: "ordered", updatedAt: now })
    .where(and(eq(quotes.id, checkout.quoteId), isNull(quotes.orderId)))
    .returning({ id: quotes.id });
  if (linked) return { quoteId: checkout.quoteId };

  // Yazamadık: teklifin zaten bir siparişi var. Kendi siparişimizse bu yalnız
  // ikinci bir kickoff'tur (tekrar çağrılabilirlik), söylenecek bir şey yok.
  const [existing] = await tx
    .select({ orderId: quotes.orderId, number: quotes.number })
    .from(quotes)
    .where(eq(quotes.id, checkout.quoteId))
    .limit(1);
  if (!existing?.orderId || existing.orderId === args.orderId) {
    return { quoteId: checkout.quoteId };
  }

  // ÇİFT ÖDEME. Aynı teklif için İKİNCİ bir taslak ödenmiş: para iki kez
  // alınmıştır. Fırlatmak yanlış olurdu — bu kod ödeme yolunun içinde
  // çağrılıyor ve sipariş zaten var; tek doğru davranış, ikinci siparişi
  // görünür biçimde işaretleyip bir insanı çağırmaktır. Dosyalar bu siparişe
  // EKLENMEZ (`attachQuoteFilesToOrder` teklifi `quotes.order_id` üzerinden
  // arar ve bu siparişi bulamaz).
  const [other] = await tx
    .select({ orderNumber: orders.orderNumber })
    .from(orders)
    .where(eq(orders.id, existing.orderId))
    .limit(1);
  const note = formatAdminNoteLine(
    `[ÇİFT ÖDEME] Teklif ${existing.number} başka bir siparişe bağlı ` +
      `(${other?.orderNumber ?? existing.orderId}). Bu sipariş de ödendi; teklif ` +
      `dosyaları buraya eklenmez, iade ya da birleştirme kararını elle verin.`,
    now
  );
  // Not EKLENİR, üzerine yazılmaz: araya giren [SLA]/[ATAMA] satırları kaybolmasın.
  await tx
    .update(orders)
    .set({
      adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
      updatedAt: now,
    })
    .where(eq(orders.id, args.orderId));

  return { quoteId: checkout.quoteId };
}

// ─── 2. Dosya pişirme ───────────────────────────────────────────────────────

export type AttachQuoteFilesOutcome =
  /** Sürüm 1 yazıldı: sipariş artık basılabilir. */
  | "attached"
  /** Siparişte zaten bir sürüm var — iş ikinci kez çalıştı. */
  | "already"
  /** Bu sipariş bir teklif siparişi değil (ya da teklifi başka siparişe bağlı). */
  | "not_quote"
  /** Dondurulmuş parçanın canonical STL'i diskte yok; kurtarma taraması tekrar dener. */
  | "missing_files";

/**
 * Dondurulmuş parça tanımlarından siparişin baskı dosyalarını üretir.
 *
 * Ölçek: analiz worker'ı canonical STL'i DOSYA BİRİMİNDE yazar (ölçeksiz).
 * Milimetreye çeviren çarpan ödeme anında donduruldu (`scaleFactor`). Çarpan 1
 * ise dosya hardlink'lenir (aynı inode, sıfır maliyet); değilse float32 köşeler
 * akış hâlinde çarpılır — üretici dilimleyicide birebir basılacak mm dosyasını
 * görmeli, "ölçeği 25.4 yapmayı unutma" notunu değil.
 *
 * Tekrar çalıştırılabilir: siparişte sürüm varsa hiçbir şey yapmaz.
 * ASLA `autoAssignIfEligible` çağırmaz — sipariş `review`'dadır, atama admin
 * onayından sonra açılır; `notifyOrderModelRevision` de çağrılmaz, çünkü bu
 * İLK sürümdür (kimsenin elinde geçersiz kılınacak bir baskı yok).
 */
export async function attachQuoteFilesToOrder(
  orderId: string
): Promise<AttachQuoteFilesOutcome> {
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      userId: orders.userId,
      manufacturerId: orders.manufacturerId,
      status: orders.status,
      draftId: orders.draftId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return "not_quote";

  const [quote] = await db
    .select({ id: quotes.id, number: quotes.number })
    .from(quotes)
    .where(eq(quotes.orderId, orderId))
    .limit(1);
  if (!quote) return "not_quote";

  // Tekrarlanabilirlik KAPISI: sürüm varsa ikinci bir sürüm açmayız. Admin
  // düzeltme yüklemişse de buraya düşer — geç gelen bir kurtarma taraması
  // admin'in düzeltmesinin ÜSTÜNE müşterinin ham dosyasını koymamalı.
  const current = await latestModelFiles(orderId);
  if (current.files.length > 0) return "already";

  // Basılacak tanım ÖDENEN tanımdır: canlı `quote_parts` değil, taslağın
  // dondurulmuş anlık görüntüsü.
  const [checkout] = order.draftId
    ? await db
        .select({ partsSnapshot: quoteCheckouts.partsSnapshot })
        .from(quoteCheckouts)
        .where(eq(quoteCheckouts.draftId, order.draftId))
        .limit(1)
    : [];
  if (!checkout || checkout.partsSnapshot.length === 0) return "not_quote";
  const parts = [...checkout.partsSnapshot].sort((a, b) => a.position - b.position);

  // Hepsi ÖNCE kontrol edilir: yarım bir set yazıp sonra vazgeçmek, üreticiye
  // eksik bir parça listesi göstermek olurdu.
  for (const part of parts) {
    if (!(await fileExists(part.canonicalStlKey))) return "missing_files";
  }

  const dir = `models/${orderId}`;
  // Görünen ad TÜRKÇE kalır (üretici onu indiriyor); diskteki ad ASCII'dir —
  // imzalı dosya URL'i ham anahtarı kodlamadan gömüyor (storage.getPublicUrl).
  const names = dedupeFileNames(parts.map(quotePartFileName));
  const inputs: OrderModelFileInput[] = [];
  for (const [index, part] of parts.entries()) {
    const diskName = asciiFileName(names[index]);
    const key =
      part.scaleFactor === 1
        ? await linkOrCopyStoredFile(part.canonicalStlKey, dir, diskName)
        : await scaleStoredStl(part.canonicalStlKey, dir, diskName, part.scaleFactor);
    const { size } = await stat(absoluteFilePath(key));
    inputs.push({ key, name: names[index], kind: "stl", sizeBytes: size });
  }

  // BAŞARISIZLIKTA DOSYA SİLİNMEZ. Diskteki adlar TÜRETİLMİŞTİR (sipariş +
  // sıra numarası), yani bir sonraki deneme aynı yolun üstüne yazar — öksüz
  // birikmez. Silmek ise tam tersini yapardı: aynı adları yazan ikinci bir
  // çalışma (kurtarma taraması) kazanmış olabilir ve temizlik ONUN kayıtlı
  // dosyalarını diskten kaldırırdı.
  let raced = false;
  await db.transaction(async (tx) => {
    // Yukarıdaki kapı İŞLEM DIŞINDA okundu ve dosya yazmak dakikalar
    // sürebiliyor: bu arada kurtarma taraması aynı siparişi alıp sürüm 1'i
    // yazmış olabilir. Satır kilidi iki işlemi sıraya dizer, bu okuma da
    // kaybedeni geri çeker — yoksa üretici aynı kümenin İKİ sürümünü görürdü.
    await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
      .for("update");
    const [existing] = await tx
      .select({ id: orderModelFiles.id })
      .from(orderModelFiles)
      .where(eq(orderModelFiles.orderId, orderId))
      .limit(1);
    if (existing) {
      raced = true;
      return;
    }
    await attachOrderModelFilesTx(tx, {
      orderId,
      files: inputs,
      source: "customer_quote",
      note: `Teklif ${quote.number} — müşterinin yüklediği ${parts.length} parça`,
      // Bu sürümü bir insan yüklemedi; uydurma bir e-posta yazmak denetim
      // kaydını yalanlamak olurdu.
      uploadedByEmail: null,
    });
  });
  if (raced) return "already";

  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
  });
  return "attached";
}

/**
 * Siparişe bağlı ama HİÇ dosyası olmayan teklif siparişleri.
 *
 * Neden gerekli: dosya işi işlem SONRASINDA kuyruğa giriyor. Redis o an
 * erişilemezse (yeniden başlatma, ağ) iş hiç doğmaz ve ödenmiş sipariş dosyasız
 * kalırdı — üretici "dosya yok" ekranı görür, admin onay rotasından geçemez.
 * Beş dakikalık süpürme bu deliği kapatır.
 *
 * En ESKİ güncellenenden başlar: takılmış bir sipariş, taze olanların arkasında
 * kalmamalı.
 */
export async function findQuoteOrdersMissingFiles(
  limit: number
): Promise<Array<{ orderId: string; quoteId: string }>> {
  const rows = await db
    .select({ orderId: quotes.orderId, quoteId: quotes.id })
    .from(quotes)
    .where(
      and(
        isNotNull(quotes.orderId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(orderModelFiles)
            .where(eq(orderModelFiles.orderId, quotes.orderId))
        )
      )
    )
    .orderBy(asc(quotes.updatedAt))
    .limit(limit);
  return rows
    .filter((r): r is { orderId: string; quoteId: string } => r.orderId !== null)
    .map((r) => ({ orderId: r.orderId, quoteId: r.quoteId }));
}

// ─── 3. Dosya adları ve ölçekleme ───────────────────────────────────────────

/**
 * Üreticinin göreceği dosya adı: `P01_<parça adı>_x<adet>.stl`.
 *
 * Sıra numarası teklifteki parça sırasıdır ve adı TEKİL yapar: iki parça aynı
 * adı taşısa bile ("gövde" ×2) dosyalar karışmaz, ve üretici listeyi teklif
 * belgesindeki sırayla okur. Adet adın içindedir çünkü üretici tek bir STL'den
 * kaç kopya basacağını dosya adından görmeli.
 *
 * PARÇA ADI, EK İÇİN BÜTÇE AYRILARAK kırpılır. `attachOrderModelFilesTx`
 * birleşmiş adı `safeModelFileName`den BİR KEZ DAHA geçiriyor ve o kırpma
 * SONDAN yapılıyor (`MAX_MODEL_FILE_STEM`) — yani adet tam da kesilen yerde
 * duruyor. Bütçe ayrılmasaydı 94 karakterlik bir CAD adı `_x7`yi yutar,
 * üretici kopya sayısını göremez ve 7 yerine 1 basardı; üstelik diskteki
 * anahtar (kırpma ÖNCESİ addan türüyor) kayıtlı adla çelişirdi.
 */
export function quotePartFileName(part: FrozenQuotePart): string {
  const position = String(part.position + 1).padStart(2, "0");
  const prefix = `P${position}_`;
  const suffix = `_x${part.quantity}`;
  const budget = MAX_MODEL_FILE_STEM - prefix.length - suffix.length;
  const stem = safeModelFileName(part.name).replace(/\.stl$/i, "");
  // Sondaki ayırıcılar atılır: kırpma bir ayırıcının üstüne denk gelirse
  // "…Export__x7.stl" gibi çift ayırıcılı bir ad çıkardı — üstelik diskteki
  // ASCII ad tekrarlı alt çizgileri birleştirdiği için (asciiFileName) kayıtlı
  // ad ile anahtar ayrı yazılmış olurdu.
  const safe = (budget > 0 ? stem.slice(0, budget).replace(/[\s._-]+$/, "") : "") || "model";
  return `${prefix}${safe}${suffix}.stl`;
}

/**
 * Diskteki ad: ASCII, yalnız `[A-Za-z0-9._-]`.
 *
 * `getPublicUrl` anahtarı imzalı URL'e HAM gömüyor (`/api/files/<anahtar>`),
 * yani boşluklu ya da Türkçe harfli bir anahtar kodlama katmanına bağımlı
 * hâle gelirdi. Depo kuralı zaten bu: "diskteki adlar ASCII, insan adı
 * `order_model_files`ta" (admin yükleme rotası aynı ayrımı yapıyor, orada ad
 * nanoid'dir). Burada nanoid yerine TÜRETİLMİŞ ad kullanılır ki aynı işin
 * ikinci denemesi yeni bir öksüz dosya bırakmasın.
 */
function asciiFileName(name: string): string {
  // Ad her zaman `P01_` ile başlar (quotePartFileName), yani katlama sonucu
  // hiçbir zaman boş kalmaz ve sıra numarası tekilliği garanti eder.
  return name
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_");
}

/** Ölçeklenmiş kopyayı depoya yazar ve anahtarını döner. */
async function scaleStoredStl(
  srcKey: string,
  subdir: string,
  filename: string,
  factor: number
): Promise<string> {
  const dstKey = `${subdir}/${filename}`;
  // `absoluteFilePath` yol kaçışını da doğrular (storage.assertSafePath).
  const dstPath = absoluteFilePath(dstKey);
  await mkdir(dirname(dstPath), { recursive: true });
  // Önce GEÇİCİ ada yaz, sonra atomik `rename` ile yerine koy. İki sebep:
  // yarım yazılmış bir dosya hiçbir zaman nihai adda görünmez, ve aynı adı
  // yazan ikinci bir çalışma (kurtarma taraması) birbirinin dosyasını
  // ortasından bozamaz — ad TÜRETİLMİŞ olduğu için ikisi aynı yolu yazıyor.
  const tmpPath = `${dstPath}.${randomUUID()}.tmp`;
  try {
    await scaleBinaryStl(absoluteFilePath(srcKey), tmpPath, factor);
    await rename(tmpPath, dstPath);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
  return dstKey;
}

/**
 * Binary STL'i `factor` ile ölçekler — dosyayı belleğe ALMADAN.
 *
 * Neden akış: müşteri dosyaları yüz megabaytı bulabiliyor ve bu iş worker
 * kutusunda, mesh python geçişiyle aynı bellekte koşuyor. Tek bir `readFile`
 * yeniden deneme fırtınasında kutuyu düşürürdü.
 *
 * Yalnız KÖŞELER çarpılır. İlk üç float yüzey normalidir ve tekdüze ölçekleme
 * yönünü değiştirmez; onu da çarpmak dilimleyiciye birim olmayan normaller
 * vermek olurdu. Son iki bayt (öznitelik sayacı, bazı dışa aktarıcılarda renk)
 * aynen taşınır.
 */
export async function scaleBinaryStl(
  srcPath: string,
  dstPath: string,
  factor: number
): Promise<void> {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`scaleBinaryStl: invalid factor ${factor}`);
  }
  const handle = await open(srcPath, "r");
  let header: Buffer;
  let size: number;
  try {
    header = Buffer.alloc(STL_HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, STL_HEADER_BYTES, 0);
    if (bytesRead < STL_HEADER_BYTES) throw new Error("scaleBinaryStl: file too short");
    size = (await handle.stat()).size;
  } finally {
    await handle.close();
  }
  // ASCII STL burada sessizce bozulurdu: üçgen sayısı harflerden okunur ve
  // köşe olmayan baytlar çarpılırdı. Analiz worker'ı binary yazıyor; yazmayan
  // bir sürüm çıkarsa bu satır onu gürültüyle yakalar.
  if (looksLikeAsciiStl(header)) throw new Error("scaleBinaryStl: ASCII STL");
  const triangles = header.readUInt32LE(80);
  if (size < STL_HEADER_BYTES + triangles * STL_TRIANGLE_BYTES) {
    throw new Error(
      `scaleBinaryStl: truncated (${size} bytes for ${triangles} triangles)`
    );
  }

  const out = createWriteStream(dstPath);
  try {
    // Başlık aynen kopyalanır: üçgen sayısı ve üretici imzası değişmiyor.
    await new Promise<void>((resolve, reject) => {
      out.write(header, (err) => (err ? reject(err) : resolve()));
    });
    await pipeline(
      createReadStream(srcPath, { start: STL_HEADER_BYTES }),
      async function* (source: AsyncIterable<Buffer>) {
        let carry = Buffer.alloc(0);
        for await (const chunk of source) {
          const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
          const whole = buf.length - (buf.length % STL_TRIANGLE_BYTES);
          if (whole > 0) {
            const block = buf.subarray(0, whole);
            for (let off = 0; off < whole; off += STL_TRIANGLE_BYTES) {
              for (let f = 0; f < STL_VERTEX_FLOATS; f++) {
                const at = off + STL_VERTEX_OFFSET + f * 4;
                block.writeFloatLE(block.readFloatLE(at) * factor, at);
              }
            }
            yield block;
          }
          // Kopya: `buf` bir sonraki turda birleştirilecek ve okuma akışının
          // tamponunu elde tutmak istemiyoruz.
          carry = Buffer.from(buf.subarray(whole));
        }
        // Bazı dışa aktarıcılar sona dolgu ekliyor; aynen taşınır.
        if (carry.length > 0) yield carry;
      },
      out
    );
  } catch (err) {
    // Yarım yazılmış hedef geride kalmasın: bir sonraki deneme onu "hazır"
    // sanıp üreticiye bozuk bir mesh gönderemez.
    await unlink(dstPath).catch(() => {});
    throw err;
  }
}

/** ASCII STL "solid" ile başlar (BOM ve baştaki boşluklar hoş görülür). */
function looksLikeAsciiStl(head: Buffer): boolean {
  let i = head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  while (i < head.length && (head[i] === 0x20 || head[i] === 0x09 || head[i] === 0x0a || head[i] === 0x0d)) {
    i++;
  }
  return head.subarray(i, i + 5).toString("latin1").toLowerCase() === "solid";
}
