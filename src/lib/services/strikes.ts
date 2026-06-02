import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { STRIKE_SUSPEND_THRESHOLD } from "@/lib/services/performance";

// Record a reliability strike and auto-suspend the manufacturer once they reach
// the threshold (Faz 3 policy). Returns the new count + whether they were
// suspended this call.
export async function applyStrike(
  manufacturerId: string
): Promise<{ strikeCount: number; suspended: boolean }> {
  const [row] = await db
    .update(manufacturers)
    .set({ strikeCount: sql`${manufacturers.strikeCount} + 1`, updatedAt: new Date() })
    .where(eq(manufacturers.id, manufacturerId))
    .returning({
      strikeCount: manufacturers.strikeCount,
      status: manufacturers.status,
    });
  if (!row) return { strikeCount: 0, suspended: false };

  // Auto-suspend atomically: gate the transition on the row STILL being active
  // AND over threshold in the same statement. Doing the check off the earlier
  // snapshot (row.status) races an admin re-activation in the gap and could
  // clobber it; the guarded UPDATE only suspends if it's genuinely still active.
  const [suspendedRow] = await db
    .update(manufacturers)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(
      and(
        eq(manufacturers.id, manufacturerId),
        eq(manufacturers.status, "active"),
        gte(manufacturers.strikeCount, STRIKE_SUSPEND_THRESHOLD)
      )
    )
    .returning({ id: manufacturers.id });

  return { strikeCount: row.strikeCount, suspended: !!suspendedRow };
}
