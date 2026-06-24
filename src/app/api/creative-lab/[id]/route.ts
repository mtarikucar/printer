import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { creativeLabJobs } from "@/lib/db/schema";
import { normalizeFileUrl } from "@/lib/services/storage";

// Poll a Creative Lab job. Job id is an unguessable UUID, so no auth needed.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const job = await db.query.creativeLabJobs.findFirst({
    where: eq(creativeLabJobs.id, id),
  });
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Stale-generating guard: prototype+build budget is ~4 min, so fail after 6.
  if (
    job.status === "generating" &&
    Date.now() - new Date(job.createdAt).getTime() > 6 * 60 * 1000
  ) {
    await db
      .update(creativeLabJobs)
      .set({ status: "failed", errorMessage: "timeout", updatedAt: new Date() })
      .where(eq(creativeLabJobs.id, id));
    return NextResponse.json({ status: "failed", product: job.product });
  }

  return NextResponse.json({
    status: job.status,
    product: job.product,
    // GLB only (keychain/magnet). Lamp STL is the paid deliverable, not exposed.
    glbUrl: normalizeFileUrl(job.glbUrl),
    errorMessage: job.errorMessage,
  });
}
