/**
 * The single exit for everything this system says on WhatsApp.
 *
 * Three things live here and nowhere else:
 *  1. The kill switch. `wa_bot_enabled=false` silences the channel instantly.
 *  2. The 24-hour service window, checked at SEND time — not when the job was
 *     queued. An admin approving a model at 03:00, thirty hours after the
 *     customer's last message, is normal; a window check at enqueue time would
 *     have passed and the send would then fail with 131047 and be lost.
 *  3. The per-recipient back-off. Meta's 131056 means we are already talking too
 *     fast to one person; retrying tightly makes it worse.
 */
import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { type WaOutboundJobData } from "../queues";
import { db } from "../../db";
import { waConversations } from "../../db/schema";
import {
  sendText,
  sendImage,
  sendVideo,
  sendButtons,
  sendTemplate,
  WhatsAppError,
} from "../../services/whatsapp-send";
import { isWindowOpen, recordMessage } from "../../services/whatsapp-conversation";
import { isFlagEnabled } from "../../services/flags";

async function deliver(job: Job<WaOutboundJobData>) {
  const data = job.data;

  if (!(await isFlagEnabled("wa_bot_enabled"))) {
    job.log("wa_bot_enabled is off; dropping this message");
    return;
  }

  // A conversation a human has taken over must never receive a machine
  // message on top of what the human is writing.
  const [conversation] = await db
    .select({ mode: waConversations.mode })
    .from(waConversations)
    .where(eq(waConversations.id, data.conversationId))
    .limit(1);
  if (!conversation) {
    job.log(`conversation ${data.conversationId} is gone; dropping`);
    return;
  }
  if (conversation.mode === "blocked") {
    job.log("conversation is blocked; dropping");
    return;
  }
  if (conversation.mode === "human" && data.senderKind !== "admin") {
    job.log("a human has the conversation; machine message suppressed");
    return;
  }

  const windowOpen = data.kind === "template" ? true : await isWindowOpen(data.conversationId);

  try {
    const waMessageId = windowOpen
      ? await sendByKind(data)
      : await sendFallbackTemplate(data, job);

    await recordMessage({
      conversationId: data.conversationId,
      direction: "out",
      waMessageId,
      type: windowOpen ? data.kind : "template",
      body: data.body ?? data.caption ?? data.templateName ?? null,
      mediaKey: data.mediaKey ?? data.headerMediaKey ?? null,
      senderKind: data.senderKind ?? "system",
      status: "sent",
    });
  } catch (err) {
    if (err instanceof WhatsAppError) {
      // The window closed between our check and the send. Fall back once.
      if (err.isOutsideWindow) {
        job.log("131047 outside the service window; falling back to a template");
        const waMessageId = await sendFallbackTemplate(data, job);
        await recordMessage({
          conversationId: data.conversationId,
          direction: "out",
          waMessageId,
          type: "template",
          body: data.templateName ?? null,
          senderKind: data.senderKind ?? "system",
          status: "sent",
        });
        return;
      }
      if (err.isPairRateLimited) {
        job.log("131056 per-recipient rate limit; backing off");
      }
      await recordMessage({
        conversationId: data.conversationId,
        direction: "out",
        type: data.kind,
        body: data.body ?? data.caption ?? null,
        senderKind: data.senderKind ?? "system",
        status: "failed",
        errorCode: String(err.code ?? ""),
      });
    }
    throw err;
  }
}

async function sendByKind(data: WaOutboundJobData): Promise<string | null> {
  switch (data.kind) {
    case "text":
      return sendText(data.to, data.body ?? "");
    case "image":
      return sendImage(data.to, data.mediaKey!, data.caption);
    case "video":
      return sendVideo(data.to, data.mediaKey!, data.caption);
    case "buttons":
      return sendButtons(
        data.to,
        data.body ?? "",
        data.buttons ?? [],
        data.headerMediaKey && data.headerType
          ? { type: data.headerType, localKey: data.headerMediaKey }
          : undefined
      );
    case "template":
      return sendTemplate(data.to, data.templateName!, data.templateParams ?? []);
    default:
      throw new Error(`unknown outbound kind ${data.kind}`);
  }
}

async function sendFallbackTemplate(
  data: WaOutboundJobData,
  job: Job<WaOutboundJobData>
): Promise<string | null> {
  if (!data.templateName) {
    // No approved template for this message: the honest outcome is to drop it
    // rather than fail forever. Anything the customer must see has a template.
    job.log("window closed and no template configured; dropping");
    return null;
  }
  return sendTemplate(data.to, data.templateName, data.templateParams ?? []);
}

export function startWhatsAppOutboundWorker(): Worker {
  const worker = new Worker<WaOutboundJobData>("wa-outbound", deliver, {
    connection: getRedisConnection(),
    concurrency: 4,
    // Meta rate-limits per recipient pair; a modest global ceiling keeps a
    // burst from tripping 131056 across many conversations at once.
    limiter: { max: 40, duration: 60_000 },
    lockDuration: 120_000,
    maxStalledCount: 1,
  });

  worker.on("failed", (job, err) => {
    console.error(`[wa-outbound] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
