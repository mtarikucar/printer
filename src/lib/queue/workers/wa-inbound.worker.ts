/**
 * Inbound WhatsApp router — deterministic, no language model anywhere.
 *
 * Order of handling matters and is deliberate:
 *   1. Button payloads (closed id set, ownership-checked). The approval that
 *      starts production is the basis of the withdrawal-right exclusion, so it
 *      is decided here and never by an inference.
 *   2. Human-handoff keywords. The safest action must also be the cheapest one.
 *   3. First-contact KVKK notice.
 *   4. Everything else lands in the admin inbox. In Faz 3 the agent picks this
 *      up; until then a person answers.
 */
import { Worker, Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { getWaOutboundQueue, type WaInboundJobData } from "../queues";
import { db } from "../../db";
import { orders, waMessages } from "../../db/schema";
import {
  getOrCreateConversation,
  markKvkkNoticeSent,
  recordMessage,
  setMode,
  touchInbound,
} from "../../services/whatsapp-conversation";
import { downloadInboundImage } from "../../services/whatsapp-media";
import { decideModelApproval } from "../../services/model-approval";
import { isFlagEnabled } from "../../services/flags";

/**
 * Words that mean "stop guessing and get me a person". Matched before anything
 * else and never rate-limited: a complaint route a budget guard can starve is
 * not a complaint route.
 */
const HANDOFF_KEYWORDS = [
  "insan",
  "temsilci",
  "müşteri temsilcisi",
  "musteri temsilcisi",
  "şikayet",
  "sikayet",
  "iade",
  "avukat",
  "tüketici",
  "tuketici",
  "hakem",
];

const KVKK_NOTICE = [
  "Merhaba! Figurunica'ya hoş geldiniz.",
  "",
  "Bu numaraya yazdığınızda mesajlarınız ve gönderdiğiniz fotoğraflar, siparişinizi",
  "oluşturmak ve size dönüş yapmak amacıyla işlenir; fotoğraflar 3D model üretimi",
  "için yurt dışındaki hizmet sağlayıcılara aktarılabilir. Ayrıntılar:",
  `${process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com"}/privacy`,
  "",
  "Dilediğiniz an \"temsilci\" yazarak bir insana bağlanabilirsiniz.",
].join("\n");

function isHandoffRequest(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLocaleLowerCase("tr");
  return HANDOFF_KEYWORDS.some((keyword) => lower.includes(keyword));
}

async function enqueueText(
  conversationId: string,
  to: string,
  body: string,
  senderKind: "bot" | "system" = "system"
) {
  await getWaOutboundQueue().add("send", {
    conversationId,
    to,
    kind: "text",
    body,
    senderKind,
  });
}

/**
 * Apply a model-approval button.
 *
 * Ownership is checked before anything is written: the button id carries only
 * the decision, and the order is resolved from the CONVERSATION, so a payload
 * copied from someone else's chat cannot move another buyer's order.
 */
async function handleApprovalButton(
  job: Job<WaInboundJobData>,
  conversationId: string,
  from: string,
  buttonId: string
): Promise<boolean> {
  const decisionByButton: Record<string, "approved" | "revision" | "cancelled"> = {
    "model:ok": "approved",
    "model:revise": "revision",
    "model:cancel": "cancelled",
  };
  const decision = decisionByButton[buttonId];
  if (!decision) return false;

  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      modelApprovalToken: orders.modelApprovalToken,
    })
    .from(orders)
    .where(
      and(
        eq(orders.waConversationId, conversationId),
        eq(orders.status, "awaiting_customer_approval")
      )
    )
    .limit(1);

  if (!order?.modelApprovalToken) {
    job.log("approval button with no matching order on this conversation");
    await enqueueText(
      conversationId,
      from,
      "Onay bekleyen bir siparişiniz görünmüyor. Yardımcı olalım — \"temsilci\" yazabilirsiniz."
    );
    return true;
  }

  const result = await decideModelApproval({
    token: order.modelApprovalToken,
    decision,
    ip: null,
    userAgent: "whatsapp",
  });

  const reply =
    result.alreadyDecided
      ? "Bu sipariş için kararınızı zaten almıştık, tekrar bir işlem yapmanıza gerek yok."
      : decision === "approved"
        ? `Onayınızı aldık — ${order.orderNumber} numaralı figürünüz baskıya giriyor. Teşekkürler!`
        : decision === "revision"
          ? "Değişiklik talebinizi aldık. Ekibimiz en kısa sürede size dönecek."
          : "Siparişinizi iptal talebine aldık. İadeniz için sizinle iletişime geçeceğiz.";

  await enqueueText(conversationId, from, reply);

  // A revision or a cancellation is a human's problem from here.
  if (decision !== "approved") {
    await setMode(conversationId, "human");
  }
  return true;
}

async function handleInbound(job: Job<WaInboundJobData>) {
  const data = job.data;
  if (!data.from) return;

  const conversation = await getOrCreateConversation({
    phone: data.from,
    waId: data.waId,
    profileName: data.profileName,
  });

  await touchInbound(conversation.id);

  // Store the customer's photo before anything else can fail: the media URL
  // Meta hands out dies after five minutes.
  let mediaKey: string | null = null;
  if (data.type === "image" && data.imageId) {
    const media = await downloadInboundImage(data.imageId, conversation.id);
    if (media.ok) {
      mediaKey = media.key;
      job.log(`stored inbound image at ${media.key} (${media.bytes} bytes)`);
    } else {
      job.log(`inbound image rejected: ${media.reason}`);
      const reason =
        media.reason === "too_large"
          ? "Fotoğraf 5 MB'tan büyük görünüyor, biraz küçültüp tekrar gönderir misiniz?"
          : media.reason === "bad_type"
            ? "Bu dosyayı okuyamadık. JPG veya PNG olarak gönderebilir misiniz?"
            : "Fotoğrafı alamadık, bir kez daha gönderir misiniz?";
      await enqueueText(conversation.id, data.from, reason);
    }
  }

  const stored = await recordMessage({
    conversationId: conversation.id,
    direction: "in",
    waMessageId: data.waMessageId,
    type: data.type ?? "text",
    body: data.text ?? data.buttonReplyTitle ?? null,
    mediaKey,
  });
  if (!stored) {
    job.log(`duplicate wamid ${data.waMessageId}; nothing more to do`);
    return;
  }

  // 1. Buttons, before anything interpretive.
  if (data.buttonReplyId) {
    const handled = await handleApprovalButton(
      job,
      conversation.id,
      data.from,
      data.buttonReplyId
    );
    if (handled) return;
  }

  // 2. A person, on request. Always allowed.
  if (isHandoffRequest(data.text)) {
    await setMode(conversation.id, "human");
    await enqueueText(
      conversation.id,
      data.from,
      "Tamam — sizi bir temsilcimize aktardım. En kısa sürede buradan yazacaklar."
    );
    console.warn(`[wa-inbound] handoff requested on conversation ${conversation.id}`);
    return;
  }

  // 3. First contact: the KVKK notice has to reach the customer where they are,
  // not as a link to a page they will never open.
  if (!conversation.kvkkNoticeSentAt) {
    await enqueueText(conversation.id, data.from, KVKK_NOTICE);
    await markKvkkNoticeSent(conversation.id);
  }

  // 4. Anything else waits for a human (Faz 2) or the agent (Faz 3).
  if (!(await isFlagEnabled("wa_agent_enabled"))) {
    job.log("no agent enabled; message parked for the admin inbox");
    return;
  }
  job.log("agent is enabled but not yet wired in this phase");
}

async function handleStatus(job: Job<WaInboundJobData>) {
  const { waMessageId, status, errorCode } = job.data;
  if (!waMessageId || !status) return;
  await db
    .update(waMessages)
    .set({ status, errorCode: errorCode != null ? String(errorCode) : null })
    .where(eq(waMessages.waMessageId, waMessageId));
}

export function startWaInboundWorker(): Worker {
  const worker = new Worker<WaInboundJobData>(
    "wa-inbound",
    async (job) => (job.name === "status" ? handleStatus(job) : handleInbound(job)),
    {
      connection: getRedisConnection(),
      concurrency: 4,
      lockDuration: 120_000,
      maxStalledCount: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[wa-inbound] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
