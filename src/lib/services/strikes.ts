import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { shouldAutoSuspend } from "@/lib/services/performance";

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

  if (shouldAutoSuspend(row.strikeCount) && row.status === "active") {
    await db
      .update(manufacturers)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(eq(manufacturers.id, manufacturerId));
    return { strikeCount: row.strikeCount, suspended: true };
  }
  return { strikeCount: row.strikeCount, suspended: false };
}
