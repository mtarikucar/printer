import { eq, desc, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { consumerRequests, orders } from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import {
  CONSUMER_REQUEST_LABELS,
  generateConsumerRequestReference,
  type ConsumerRequestType,
} from "@/lib/config/consumer-requests";

/**
 * Tüketici talep sistemi — MSY m.12/A.
 *
 * Yükümlülüğün üç bacağı var ve üçü de burada karşılanır:
 *   1. Tüketici talebini KESİNTİSİZ iletebilmeli → talep kaydı her zaman
 *      açılır; satıcıya iletim başarısız olsa bile kayıt durur.
 *   2. Talebini TAKİP EDEBİLMELİ → `reference` ile sorgulanabilir.
 *   3. Talep satıcıya DERHAL iletilmeli → `forwardedAt` bunun kanıtıdır.
 *
 * Kritik tasarım kararı: iletim hatası talebi DÜŞÜRMEZ. Kayıt önce yazılır,
 * iletim sonra denenir; hata `forwardFailedReason`'a yazılır ve talep
 * `new` durumunda kalır. Tersi olsaydı (iletim başarısızsa kayıt yok) hem
 * tüketici talebini kaybederdi hem de denetimde hiçbir iz kalmazdı.
 */

export interface CreateConsumerRequestInput {
  orderId: string;
  userId?: string | null;
  type: ConsumerRequestType;
  message: string;
  contactEmail: string;
}

export interface CreateConsumerRequestResult {
  reference: string;
  forwarded: boolean;
}

export async function createConsumerRequest(
  input: CreateConsumerRequestInput
): Promise<CreateConsumerRequestResult> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, input.orderId),
    columns: {
      id: true,
      orderNumber: true,
      sellerManufacturerId: true,
    },
  });
  if (!order) throw new Error("ORDER_NOT_FOUND");

  // Referans çakışması pratikte imkânsız (32^6) ama unique kısıt gerçek;
  // drizzle 0.45 pg hata kodunu `.cause`'a saklıyor, o yüzden koda değil
  // yeniden denemeye güveniyoruz.
  let reference = generateConsumerRequestReference();
  for (let attempt = 0; attempt < 3; attempt++) {
    const clash = await db.query.consumerRequests.findFirst({
      where: eq(consumerRequests.reference, reference),
      columns: { id: true },
    });
    if (!clash) break;
    reference = generateConsumerRequestReference();
  }

  const [row] = await db
    .insert(consumerRequests)
    .values({
      reference,
      orderId: order.id,
      userId: input.userId ?? null,
      // Platform ürünlerinde (ownerType 'admin') satıcı yoktur — muhatap
      // doğrudan biziz ve iletme adımı çalışmaz.
      sellerManufacturerId: order.sellerManufacturerId ?? null,
      type: input.type,
      message: input.message,
      contactEmail: input.contactEmail,
    })
    .returning({ id: consumerRequests.id });

  if (!order.sellerManufacturerId) {
    return { reference, forwarded: false };
  }

  // "Derhal iletme" — aynı istek içinde, kuyruğa ertelemeden.
  try {
    await notifyManufacturer({
      manufacturerId: order.sellerManufacturerId,
      type: "consumer_request",
      orderId: order.id,
      subject: `Tüketici talebi: ${CONSUMER_REQUEST_LABELS[input.type]} (${reference})`,
      body:
        `${order.orderNumber} numaralı siparişe ilişkin bir tüketici talebi iletildi.\n\n` +
        `Talep türü: ${CONSUMER_REQUEST_LABELS[input.type]}\n` +
        `Talep referansı: ${reference}\n` +
        `Tüketici e-postası: ${input.contactEmail}\n\n` +
        `Mesaj:\n${input.message}\n\n` +
        `Mesafeli Sözleşmeler Yönetmeliği m.12/A uyarınca bu talep tarafınıza ` +
        `derhal iletilmiştir. Panelinizden yanıtlayabilirsiniz.`,
    });
    await db
      .update(consumerRequests)
      .set({ forwardedAt: new Date(), status: "forwarded", updatedAt: new Date() })
      .where(eq(consumerRequests.id, row.id));
    return { reference, forwarded: true };
  } catch (err) {
    // Talep kaydı durur; iletilemediği görünür kalsın ki denetimde ve
    // operasyonda fark edilsin.
    await db
      .update(consumerRequests)
      .set({
        forwardFailedReason: (err as Error).message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(consumerRequests.id, row.id));
    return { reference, forwarded: false };
  }
}

/** Tüketicinin talebini takip etmesi (m.12/A'nın "takip edilebilir" şartı).
 *  Referans + e-posta çiftiyle sorgulanır: referans tek başına tahmin
 *  edilemez ama e-posta eşleşmesi, paylaşılan bir referansın başkasının
 *  talebini açmasını engeller. */
export async function findConsumerRequestByReference(
  reference: string,
  contactEmail: string
) {
  return db.query.consumerRequests.findFirst({
    where: and(
      eq(consumerRequests.reference, reference.trim().toUpperCase()),
      eq(consumerRequests.contactEmail, contactEmail.trim().toLowerCase())
    ),
  });
}

/** Satıcı paneli listesi. */
export async function listSellerConsumerRequests(manufacturerId: string) {
  return db.query.consumerRequests.findMany({
    where: eq(consumerRequests.sellerManufacturerId, manufacturerId),
    orderBy: [desc(consumerRequests.createdAt)],
    limit: 200,
  });
}

/** Admin listesi — tüm talepler, en yenisi üstte. */
export async function listAllConsumerRequests() {
  return db.query.consumerRequests.findMany({
    orderBy: [desc(consumerRequests.createdAt)],
    limit: 500,
  });
}
