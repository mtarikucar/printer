import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getRedisConnection } from "@/lib/queue/connection";
import { getSmsSender } from "@/lib/services/sms";

const OTP_TTL_SEC = 5 * 60; // 5 minutes
const MAX_ATTEMPTS = 5;

function redisKey(userId: string): string {
  return `otp:phone:${userId}`;
}
function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

interface OtpRecord {
  hash: string;
  phone: string; // E.164 the code was sent to
  attempts: number;
}

/**
 * Generate a 6-digit OTP, stash its hash in Redis (5-min TTL), and SMS the code
 * to the given E.164 phone. The raw code never touches Postgres.
 */
export async function sendPhoneOtp(userId: string, phoneE164: string): Promise<void> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const record: OtpRecord = { hash: hashCode(code), phone: phoneE164, attempts: 0 };
  const redis = getRedisConnection();
  await redis.set(redisKey(userId), JSON.stringify(record), "EX", OTP_TTL_SEC);
  await getSmsSender().send(
    phoneE164,
    `Figurunica doğrulama kodunuz: ${code}. Kod 5 dakika geçerlidir.`
  );
}

/**
 * Verify a submitted code. On success, mark the user phoneVerified and persist
 * the verified phone. Attempts are capped to thwart brute force.
 */
export async function verifyPhoneOtp(
  userId: string,
  code: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const redis = getRedisConnection();
  const key = redisKey(userId);
  const raw = await redis.get(key);
  if (!raw) return { ok: false, reason: "expired" };

  let record: OtpRecord;
  try {
    record = JSON.parse(raw);
  } catch {
    await redis.del(key);
    return { ok: false, reason: "expired" };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await redis.del(key);
    return { ok: false, reason: "too_many_attempts" };
  }

  if (hashCode(code) !== record.hash) {
    record.attempts += 1;
    // KEEPTTL preserves the original 5-min expiry across the attempt bump.
    await redis.set(key, JSON.stringify(record), "KEEPTTL");
    return { ok: false, reason: "invalid_code" };
  }

  await redis.del(key);
  await db
    .update(users)
    .set({ phoneVerified: true, phone: record.phone, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return { ok: true };
}
