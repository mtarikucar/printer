/**
 * The AI sales agent's turn worker.
 *
 * Debounced, not merely locked. Someone typing "merhaba" / "figür yaptırmak
 * istiyorum" / "fiyat ne kadar" in eight seconds is how people actually use
 * WhatsApp, not an edge case. A plain Redis lock would drop messages two and
 * three silently (attempts: 1); a delayed job with a stable jobId collapses
 * them into ONE turn that sees all three.
 *
 * `attempts: 1` on purpose: an LLM turn is never retried automatically. A retry
 * spends the tokens again and can duplicate a side effect; failure here is a
 * handoff to a person, which is the cheap and safe outcome.
 */
import { Worker, Job } from "bullmq";
import { desc, eq } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { getRedisConnection } from "../connection";
import { getWaAgentQueue, getWaOutboundQueue, type WaAgentJobData } from "../queues";
import { db } from "../../db";
import { waConversations, waMessages } from "../../db/schema";
import { runAgentTurn } from "../../agent/runner";
import { renderUiBlock } from "../../config/wa-flow";
import { setMode } from "../../services/whatsapp-conversation";
import { isFlagEnabled } from "../../services/flags";

const HISTORY_LIMIT = 24;

/** Rebuild the conversation for the model from what we stored. */
async function buildHistory(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await db
    .select()
    .from(waMessages)
    .where(eq(waMessages.conversationId, conversationId))
    .orderBy(desc(waMessages.createdAt))
    .limit(HISTORY_LIMIT);

  return rows
    .reverse()
    .filter((row) => row.body || row.mediaKey)
    .map((row) => ({
      role: row.direction === "in" ? ("user" as const) : ("assistant" as const),
      content:
        row.direction === "in"
          ? // Customer text is wrapped so the model can tell data from
            // instruction. Defence in depth only — the real containment is that
            // no tool can do anything dangerous, and that images are never
            // handed to the model at all.
            `<musteri_mesaji>${row.body ?? "[fotoğraf gönderdi]"}</musteri_mesaji>`
          : (row.body ?? ""),
    }));
}

async function runTurn(job: Job<WaAgentJobData>) {
  const { conversationId } = job.data;

  if (!(await isFlagEnabled("wa_agent_enabled"))) {
    job.log("wa_agent_enabled is off");
    return;
  }

  const [conversation] = await db
    .select()
    .from(waConversations)
    .where(eq(waConversations.id, conversationId))
    .limit(1);
  if (!conversation) return;
  if (conversation.mode !== "bot") {
    job.log(`conversation mode is ${conversation.mode}; the agent stays quiet`);
    return;
  }

  const history = await buildHistory(conversationId);
  if (history.length === 0) return;

  const result = await runAgentTurn({
    conversationId,
    phoneE164: conversation.phoneE164,
    history,
    pendingMediaIds: job.data.pendingMediaIds ?? [],
  });

  job.log(
    `turn done: tools=${result.toolCalls} cost=${result.costCents}c ` +
      `stop=${result.stopReason} handoff=${result.handedOff}`
  );

  if (result.reply) {
    const block = renderUiBlock(result.ui);
    const body = block.suffix ? `${result.reply}${block.suffix}` : result.reply;

    await getWaOutboundQueue().add("agent-reply", {
      conversationId,
      to: conversation.phoneE164,
      kind: block.buttons?.length ? "buttons" : "text",
      body,
      ...(block.buttons?.length ? { buttons: block.buttons } : {}),
      senderKind: "agent",
    });
  }

  if (result.handedOff) {
    await setMode(conversationId, "human");
    if (!result.reply) {
      await getWaOutboundQueue().add("handoff", {
        conversationId,
        to: conversation.phoneE164,
        kind: "text",
        body: "Bir saniye — sizi bir temsilcimize aktarıyorum, hemen yardımcı olacaklar.",
        senderKind: "system",
      });
    }
  }
}

/**
 * Queue a turn, collapsing rapid consecutive messages into one.
 *
 * Removing and re-adding the same jobId restarts the debounce window, so the
 * agent answers once, having read everything the customer just typed.
 */
export async function scheduleAgentTurn(
  conversationId: string,
  pendingMediaIds: string[] = []
): Promise<void> {
  const queue = getWaAgentQueue();
  const jobId = `wa-agent:${conversationId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState().catch(() => "unknown");
    if (state === "delayed" || state === "waiting") {
      await existing.remove().catch(() => {});
    }
  }
  await queue.add(
    "turn",
    { conversationId, pendingMediaIds },
    { jobId, delay: Number(process.env.WA_AGENT_DEBOUNCE_MS ?? 2500) }
  );
}

export function startWaAgentWorker(): Worker {
  const worker = new Worker<WaAgentJobData>("wa-agent", runTurn, {
    connection: getRedisConnection(),
    concurrency: 4,
    limiter: { max: 30, duration: 60_000 },
    lockDuration: 120_000,
    maxStalledCount: 1,
  });

  worker.on("failed", (job, err) => {
    console.error(`[wa-agent] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
