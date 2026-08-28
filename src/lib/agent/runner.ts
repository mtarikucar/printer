import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRuns, agentActions } from "@/lib/db/schema";
import { AGENT_SYSTEM_PROMPT } from "./system-prompt";
import { AGENT_TOOLS } from "./tools";
import { executeTool, type ToolContext } from "./execute-tool";
import { guardOutboundText, deterministicFallback } from "./output-guard";
import { isFlagEnabled } from "@/lib/services/flags";
import { reserveSpend, settleSpend } from "@/lib/services/spend-guard";

/**
 * The agent loop.
 *
 * A MANUAL loop rather than the SDK tool runner, because every tool call has to
 * pass through the same chain first — kill switch, spend reservation,
 * per-turn budget, audit row — and that chain is exactly the control the
 * runner does not expose.
 *
 * The loop is bounded by `break` statements, not by prompt instructions. A
 * budget the model can talk its way past is not a budget.
 *
 * NOTE: no `import "server-only"` — this runs inside the BullMQ worker.
 */

const MODEL = process.env.WA_AGENT_MODEL ?? "claude-opus-5";
const MAX_TOOL_CALLS_PER_TURN = 6;
const MAX_TOOL_ERRORS_PER_TURN = 2;
const TURN_WALL_CLOCK_MS = 20_000;
const MAX_OUTPUT_TOKENS = 1500;

/** Rough cents per million tokens, for the ledger. Opus 5: $5 in / $25 out. */
const PRICING = {
  "claude-opus-5": { input: 500, output: 2500, cacheRead: 50, cacheWrite: 625 },
  "claude-haiku-4-5": { input: 100, output: 500, cacheRead: 10, cacheWrite: 125 },
} as const;

function costCents(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }
): number {
  const rate = PRICING[model as keyof typeof PRICING] ?? PRICING["claude-opus-5"];
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const millionths =
    usage.input_tokens * rate.input +
    usage.output_tokens * rate.output +
    cacheRead * rate.cacheRead +
    cacheWrite * rate.cacheWrite;
  return Math.ceil(millionths / 1_000_000);
}

export interface AgentTurnResult {
  reply: string | null;
  ui: string;
  handedOff: boolean;
  toolCalls: number;
  costCents: number;
  stopReason: string | null;
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function runAgentTurn(ctx: ToolContext): Promise<AgentTurnResult> {
  const empty: AgentTurnResult = {
    reply: null,
    ui: "none",
    handedOff: false,
    toolCalls: 0,
    costCents: 0,
    stopReason: null,
  };

  if (!(await isFlagEnabled("wa_agent_enabled"))) return empty;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[agent] ANTHROPIC_API_KEY is not set; the agent cannot run");
    return empty;
  }

  // Reserve a pessimistic ceiling for the whole turn before the first token.
  const reservation = await reserveSpend("anthropic", 5, {
    kind: "conversation",
    id: ctx.conversationId,
  });
  if (!reservation.ok) {
    return { ...empty, handedOff: true };
  }

  const [run] = await db
    .insert(agentRuns)
    .values({ conversationId: ctx.conversationId, model: MODEL })
    .returning({ id: agentRuns.id });

  const startedAt = Date.now();
  const messages: Anthropic.Beta.BetaMessageParam[] = [...ctx.history];
  const quotedFormatted: string[] = [];

  let toolCalls = 0;
  let toolErrors = 0;
  let totalCost = 0;
  let reply: string | null = null;
  let ui = "none";
  let handedOff = false;
  let stopReason: string | null = null;

  const usageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };

  try {
    for (;;) {
      if (Date.now() - startedAt > TURN_WALL_CLOCK_MS) {
        handedOff = true;
        break;
      }

      const response = await anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        // A safety decline in the middle of a sale — someone's child's photo,
        // an unusual name — must not silently end the conversation.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // Byte-stable prefix: the system prompt and the tool list never vary,
        // so the cache breakpoint sits at the end of the tools block.
        system: [
          {
            type: "text",
            text: AGENT_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: AGENT_TOOLS,
        messages,
      });

      stopReason = response.stop_reason ?? null;
      usageTotals.input += response.usage.input_tokens;
      usageTotals.output += response.usage.output_tokens;
      usageTotals.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      usageTotals.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
      totalCost += costCents(MODEL, response.usage);

      // A refusal that survived the fallback chain is a human's problem.
      if (response.stop_reason === "refusal") {
        handedOff = true;
        break;
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use"
      );

      if (toolUses.length === 0) {
        // The model wrote prose instead of calling emit_reply. Treat the text
        // as a reply rather than losing it, but run it past the guard.
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (text) reply = text;
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      let finished = false;

      for (const toolUse of toolUses) {
        if (toolCalls >= MAX_TOOL_CALLS_PER_TURN) {
          handedOff = true;
          finished = true;
          break;
        }
        toolCalls++;

        const outcome = await executeTool(toolUse.name, toolUse.input, ctx);

        await db.insert(agentActions).values({
          runId: run.id,
          tool: toolUse.name,
          argsJson: toolUse.input as never,
          resultStatus: outcome.ok ? "ok" : "error",
          deniedReason: outcome.ok ? null : outcome.error,
        });

        if (!outcome.ok) {
          toolErrors++;
          if (toolErrors > MAX_TOOL_ERRORS_PER_TURN) {
            handedOff = true;
            finished = true;
            break;
          }
        }

        if (toolUse.name === "quote_item" && outcome.ok) {
          const formatted = (outcome.value as { formatted?: string })?.formatted;
          if (formatted) quotedFormatted.push(formatted);
        }

        if (toolUse.name === "request_human_handoff") {
          handedOff = true;
          finished = true;
        }

        if (toolUse.name === "emit_reply" && outcome.ok) {
          const input = toolUse.input as { text?: string; ui?: string };
          reply = input.text ?? null;
          ui = input.ui ?? "none";
          finished = true;
        }

        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(outcome.ok ? outcome.value : { error: outcome.error }),
          ...(outcome.ok ? {} : { is_error: true }),
        });
      }

      // All results go back in ONE user message; splitting them teaches the
      // model to stop making parallel calls.
      messages.push({ role: "user", content: results });
      if (finished) break;
    }

    // The guard is the last gate before a customer sees anything.
    if (reply) {
      const guard = guardOutboundText(reply, quotedFormatted);
      if (!guard.ok) {
        console.warn(
          `[agent] outbound text rejected (${guard.failures.join(",")}): ${guard.detail}`
        );
        reply = deterministicFallback(quotedFormatted);
        ui = "none";
        handedOff = true;
      }
    }
  } catch (err) {
    console.error("[agent] turn failed", err);
    handedOff = true;
  } finally {
    await settleSpend(reservation.reservationId, Math.max(totalCost, 1));
    await db
      .update(agentRuns)
      .set({
        inputTokens: usageTotals.input,
        outputTokens: usageTotals.output,
        cacheReadTokens: usageTotals.cacheRead,
        cacheWriteTokens: usageTotals.cacheWrite,
        costCents: totalCost,
        stopReason,
        durationMs: Date.now() - startedAt,
      })
      .where(eq(agentRuns.id, run.id));
  }

  return { reply, ui, handedOff, toolCalls, costCents: totalCost, stopReason };
}
