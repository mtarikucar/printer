import { mkdtemp, open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loadPayoutPage } from "@/lib/services/payout-list";
import { CSV_BOM, payoutCsvHeader, payoutCsvRecord } from "@/lib/config/payout-csv";
import {
  PayoutListInputError, normalizePayoutListScope, parsePayoutListRequest, validatePayoutListQuery,
  type PayoutListScope, type PayoutListQuery, type PartnerPayoutListScope,
} from "@/lib/config/payout-list";

type ExportQuery = Pick<PayoutListQuery, "status">;
type ExportActor = { audience: "admin" } | PartnerPayoutListScope;
const abortCheck = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error("CSV indirme isteği iptal edildi."); };

/** Export means ALL matching batches, not the UI page. Validation stays shared. */
export async function exportPayoutRequest(params: URLSearchParams, actor: ExportActor, signal?: AbortSignal): Promise<Response> {
  if (params.has("cursor") || params.has("limit")) throw new PayoutListInputError("CSV tüm filtrelenmiş kayıtları içerir; sayfa sınırı veya imleci gönderilemez.");
  const parsed = actor.audience === "admin" ? parsePayoutListRequest(params, actor) : parsePayoutListRequest(params, actor);
  return exportPayoutCsv(parsed.scope, { status: parsed.query.status }, signal);
}

/** No locks, no row cap, and no transaction held open while the client downloads. */
export async function exportPayoutCsv(scopeInput: PayoutListScope, query: ExportQuery, signal?: AbortSignal): Promise<Response> {
  const scope = normalizePayoutListScope(scopeInput);
  if (!query || Object.keys(query).some(key => key !== "status")) throw new PayoutListInputError("CSV tüm filtrelenmiş kayıtları içerir; sayfalama kabul edilmez.");
  validatePayoutListQuery(scope, { status: query.status, limit: 100 });
  abortCheck(signal);
  const directory = await mkdtemp(join(tmpdir(), "payout-export-"));
  const path = join(directory, "payouts.csv");
  let writer: FileHandle | undefined;
  let reader: FileHandle | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let abortListener: (() => void) | undefined;
  const cleanup = () => cleanupPromise ??= (async () => {
    if (abortListener) signal?.removeEventListener("abort", abortListener);
    try { await reader?.close(); } finally {
      try { await writer?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
    }
  })();
  try {
    writer = await open(path, "wx", 0o600);
    await writer.writeFile(CSV_BOM + payoutCsvHeader(scope.audience), "utf8");
    await db.transaction(async tx => {
      // A stalled database query must fail before response headers, not leave an
      // apparently successful partial CSV. This limits each query, not row count.
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      let cursor: string | undefined;
      do {
        abortCheck(signal);
        const page = await loadPayoutPage(tx, scope, { status: query.status, limit: 100, ...(cursor ? { cursor } : {}) });
        abortCheck(signal);
        for (const row of page.rows) {
          if (row.kind !== scope.kind || (scope.partnerId && row.partnerId !== scope.partnerId)) throw new Error("CSV kayıtları yetkili partner kapsamıyla uyuşmuyor.");
          abortCheck(signal);
          await writer!.writeFile(payoutCsvRecord(row, scope.audience), "utf8");
        }
        if (!page.hasMore) break;
        if (!page.nextCursor || page.nextCursor === cursor || page.rows.length === 0) throw new Error("CSV sayfalaması ilerleyemedi; dosya tamamlanmadı.");
        cursor = page.nextCursor;
      } while (true);
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    const size = (await writer.stat()).size;
    await writer.close(); writer = undefined;
    abortCheck(signal);
    reader = await open(path, "r");
    let finished = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        abortListener = () => {
          if (finished) return;
          finished = true;
          controller.error(new Error("CSV indirme isteği iptal edildi."));
          void cleanup().catch(error => console.error("payout export cleanup failed", error));
        };
        signal?.addEventListener("abort", abortListener, { once: true });
        if (signal?.aborted) abortListener();
      },
      async pull(controller) {
        if (finished) return;
        try {
          const buffer = Buffer.alloc(64 * 1024);
          const { bytesRead } = await reader!.read(buffer, 0, buffer.length, null);
          if (finished) return;
          if (bytesRead === 0) {
            finished = true; await cleanup(); controller.close();
          } else controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
        } catch (error) {
          if (!finished) { finished = true; controller.error(error); }
          await cleanup();
        }
      },
      async cancel() { finished = true; await cleanup(); },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="payouts.csv"',
      "Content-Length": String(size), "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { await cleanup(); throw error; }
}
