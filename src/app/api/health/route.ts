import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { statfs } from "node:fs/promises";
import { db } from "@/lib/db";
import { getRedisConnection } from "@/lib/queue/connection";
import { getAllFlags } from "@/lib/services/flags";
import { spentCentsSince } from "@/lib/services/spend-guard";
import { handleRouteFailure, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness + readiness for the deploy pipeline and the ops page.
 *
 * The deploy script used to curl the homepage, which returns 200 whenever
 * Next.js can render marketing copy — including while the DB is unreachable and
 * every order page is throwing. This checks the things a deploy actually needs.
 *
 * Always 200 with `ok: false` on partial failure rather than 5xx, so a
 * monitoring probe can distinguish "the app is down" from "the app is up and
 * telling you Redis is down". The deploy gate reads `ok`.
 */
async function handleGET() {
  const started = Date.now();

  const [dbOk, redisOk, flags, spend24h, diskFreeMb] = await Promise.all([
    db
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false),
    (async () => {
      try {
        if (!process.env.REDIS_URL) return false;
        const pong = await getRedisConnection().ping();
        return pong === "PONG";
      } catch {
        return false;
      }
    })(),
    getAllFlags().catch(() => null),
    spentCentsSince(null, 24 * 60 * 60 * 1000).catch(() => null),
    (async () => {
      try {
        const stats = await statfs(process.env.UPLOAD_DIR || "./uploads");
        return Math.round((stats.bavail * stats.bsize) / (1024 * 1024));
      } catch {
        return null;
      }
    })(),
  ]);

  const ok = dbOk && redisOk;

  return NextResponse.json(
    {
      ok,
      db: dbOk,
      redis: redisOk,
      flags,
      gateMode: process.env.PRINT_GATE_MODE === "enforce" ? "enforce" : "shadow",
      aiSpendCents24h: spend24h,
      uploadsFreeMb: diskFreeMb,
      killAll: process.env.AI_KILL_ALL === "1",
      tookMs: Date.now() - started,
    },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET() {
  try {
    return await handleGET();
  } catch (e) {
    return handleRouteFailure(e, "GET /api/health", ADMIN_READ_FAILED_ERROR);
  }
}
