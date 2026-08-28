// Meshy 3D provider client.
//
// Contract verified against the LIVE API on 2026-08-27/28 with a real key, not
// from docs alone. Measured facts that shaped this file:
//   - `ai_model: "meshy-7"` is accepted; the docs' "requires account
//     entitlement" note was not a barrier for our key.
//   - `image_url` accepts a 1.5 MB `data:image/png;base64,...` URI, so a
//     customer's face never has to be published on a signed public URL.
//   - image-to-3d took 64 s and cost 20 credits; it returns
//     model_urls.{glb,fbx,usdz,obj,stl} and a single `thumbnail_url`.
//     `video_url` and `multi_view_thumbnails` are NULL — there is no turntable
//     video to reuse, we render our own.
//   - RAW meshy-7 output is NOT printable: is_watertight false, 416
//     non-manifold edges, 16 holes, 610 disconnected shells. `print/repair`
//     (10 credits, 6 s) fixes all of it. Repair is therefore a MANDATORY
//     stage, not a fallback — budget 30 credits per order.
//   - `print/analyze` is free (0 credits, ~0.5 s) and returns
//     `printability.metrics.*`.
//
// NOTE: no `import "server-only"` — the BullMQ worker reaches this module.

const API_BASE = "https://api.meshy.ai/openapi/v1";

/** Pinned. Never "latest": a silent model change would move every gate threshold. */
export const MESHY_AI_MODEL = process.env.MESHY_AI_MODEL ?? "meshy-7";

export const MESHY_CREDITS = {
  imageTo3d: 20,
  printRepair: 10,
  printAnalyze: 0,
} as const;

/** Total credits one order is expected to consume on the happy path. */
export const MESHY_CREDITS_PER_ORDER =
  MESHY_CREDITS.imageTo3d + MESHY_CREDITS.printRepair;

const CREATE_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 15_000;

export type MeshyTaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

export interface MeshyModelUrls {
  glb?: string;
  fbx?: string;
  usdz?: string;
  obj?: string;
  stl?: string;
}

export interface MeshyTask {
  id: string;
  status: MeshyTaskStatus;
  progress: number;
  modelUrls: MeshyModelUrls;
  thumbnailUrl: string | null;
  consumedCredits: number;
  taskError: string | null;
  createdAt: number | null;
  finishedAt: number | null;
}

export interface MeshyPrintability {
  status: "healthy" | "warning" | "error" | "unknown";
  issueCount: number;
  errorCount: number;
  warningCount: number;
  metrics: {
    isWatertight: boolean | null;
    volume: number | null;
    nonManifoldEdges: number | null;
    degenerateFaces: number | null;
    holes: number | null;
  };
}

export class MeshyError extends Error {
  constructor(
    message: string,
    readonly code:
      | "no_api_key"
      | "http_error"
      | "task_failed"
      | "timeout"
      | "moderation_blocked"
      | "insufficient_credits",
    readonly detail?: string
  ) {
    super(message);
    this.name = "MeshyError";
  }
}

function apiKey(): string {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new MeshyError("MESHY_API_KEY is not set", "no_api_key");
  return key;
}

async function meshyFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<unknown> {
  const { timeoutMs = STATUS_TIMEOUT_MS, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 402) {
      throw new MeshyError("Meshy credit balance exhausted", "insufficient_credits", body);
    }
    throw new MeshyError(`Meshy ${path} failed (${res.status})`, "http_error", body.slice(0, 500));
  }
  return res.json();
}

/** Free. Used both as a pre-flight and to decide whether a repair is needed. */
export async function getCreditBalance(): Promise<number> {
  const json = (await meshyFetch("/balance")) as { balance?: number };
  return typeof json.balance === "number" ? json.balance : 0;
}

function parseTask(json: Record<string, unknown>): MeshyTask {
  const urls = (json.model_urls ?? {}) as MeshyModelUrls;
  return {
    id: String(json.id ?? ""),
    status: (json.status as MeshyTaskStatus) ?? "PENDING",
    progress: typeof json.progress === "number" ? json.progress : 0,
    modelUrls: {
      glb: urls.glb || undefined,
      obj: urls.obj || undefined,
      stl: urls.stl || undefined,
    },
    thumbnailUrl: (json.thumbnail_url as string) || null,
    consumedCredits: typeof json.consumed_credits === "number" ? json.consumed_credits : 0,
    taskError:
      json.task_error && typeof json.task_error === "object"
        ? String((json.task_error as { message?: string }).message ?? "")
        : null,
    createdAt: typeof json.created_at === "number" ? json.created_at : null,
    finishedAt: typeof json.finished_at === "number" ? json.finished_at : null,
  };
}

/**
 * Start an image→3D task. `imageUrl` may be a public URL or a data URI; prefer
 * the data URI so the customer's photo is never fetchable by anyone holding a
 * signed link.
 *
 * `image_enhancement` is deliberately FALSE: its default is true and, applied
 * to an image fal.ai has already stylised, it re-stylises the subject. The mesh
 * comes out flawless, the gate passes, and the figure is not the customer's
 * child — and nothing in any metric would show it.
 */
export async function createImageTo3dTask(imageUrl: string): Promise<string> {
  const json = (await meshyFetch("/image-to-3d", {
    method: "POST",
    timeoutMs: CREATE_TIMEOUT_MS,
    body: JSON.stringify({
      image_url: imageUrl,
      ai_model: MESHY_AI_MODEL,
      should_remesh: true,
      topology: "triangle",
      target_polycount: 300000,
      enable_pbr: false,
      should_texture: false,
      image_enhancement: false,
      moderation: true,
    }),
  })) as { result?: string };
  if (!json.result) throw new MeshyError("Meshy returned no task id", "http_error");
  return json.result;
}

export async function getImageTo3dTask(taskId: string): Promise<MeshyTask> {
  return parseTask((await meshyFetch(`/image-to-3d/${taskId}`)) as Record<string, unknown>);
}

/** Free (0 credits, ~0.5 s). `input_task_id` must be a SUCCEEDED meshy-6+ task. */
export async function analyzePrintability(input: {
  taskId?: string;
  modelUrl?: string;
}): Promise<string> {
  const body = input.taskId ? { input_task_id: input.taskId } : { model_url: input.modelUrl };
  const json = (await meshyFetch("/print/analyze", {
    method: "POST",
    timeoutMs: CREATE_TIMEOUT_MS,
    body: JSON.stringify(body),
  })) as { result?: string };
  if (!json.result) throw new MeshyError("print/analyze returned no task id", "http_error");
  return json.result;
}

export async function getPrintAnalysis(
  taskId: string
): Promise<{ status: MeshyTaskStatus; printability: MeshyPrintability | null }> {
  const json = (await meshyFetch(`/print/analyze/${taskId}`)) as Record<string, unknown>;
  const p = json.printability as Record<string, unknown> | null;
  if (!p) return { status: (json.status as MeshyTaskStatus) ?? "PENDING", printability: null };
  const m = (p.metrics ?? {}) as Record<string, unknown>;
  return {
    status: (json.status as MeshyTaskStatus) ?? "PENDING",
    printability: {
      status: (p.status as MeshyPrintability["status"]) ?? "unknown",
      issueCount: Number(p.issue_count ?? 0),
      errorCount: Number(p.error_count ?? 0),
      warningCount: Number(p.warning_count ?? 0),
      metrics: {
        isWatertight: typeof m.is_watertight === "boolean" ? m.is_watertight : null,
        volume: typeof m.volume === "number" ? m.volume : null,
        nonManifoldEdges: typeof m.non_manifold_edges === "number" ? m.non_manifold_edges : null,
        degenerateFaces: typeof m.degenerate_faces === "number" ? m.degenerate_faces : null,
        holes: typeof m.holes === "number" ? m.holes : null,
      },
    },
  };
}

/**
 * 10 credits. Returns GLB only. MANDATORY, not conditional: measured raw
 * meshy-7 output had 610 disconnected shells and our mesh pipeline cannot
 * rescue that (the union fails and the concatenate fallback loses two thirds
 * of the faces).
 */
export async function createPrintRepairTask(inputTaskId: string): Promise<string> {
  const json = (await meshyFetch("/print/repair", {
    method: "POST",
    timeoutMs: CREATE_TIMEOUT_MS,
    body: JSON.stringify({ input_task_id: inputTaskId }),
  })) as { result?: string };
  if (!json.result) throw new MeshyError("print/repair returned no task id", "http_error");
  return json.result;
}

export async function getPrintRepairTask(taskId: string): Promise<MeshyTask> {
  return parseTask((await meshyFetch(`/print/repair/${taskId}`)) as Record<string, unknown>);
}

export function isTerminal(status: MeshyTaskStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELED";
}

/** Classify a failure so the worker can branch on a code, not on prose. */
export function classifyTaskError(taskError: string | null): string {
  const t = (taskError ?? "").toLowerCase();
  if (t.includes("moderation") || t.includes("nsfw") || t.includes("policy")) {
    return "moderation_blocked";
  }
  if (t.includes("timeout") || t.includes("timed out")) return "provider_timeout";
  if (t.includes("credit") || t.includes("quota")) return "insufficient_credits";
  if (t.includes("image")) return "bad_input_image";
  return "provider_error";
}
