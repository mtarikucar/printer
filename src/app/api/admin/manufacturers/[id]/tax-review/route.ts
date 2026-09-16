import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Admin closes a manufacturer's manual tax review.
 *
 * `requiresManualTaxReview` is set at registration when no verifiable VKN/TCKN
 * was given (and, until the IBAN review fix, on every IBAN change). Nothing
 * could clear it, so the flag stuck forever: the ranker docks such a shop 40
 * compliance points (manufacturer-assignment.ts) and the admin list keeps it in
 * the "Manuel inceleme" tab. This is the explicit "I checked the vergi levhası"
 * step.
 *
 * The admin must say what they checked. The line (who, when, what) is appended
 * to manufacturers.notes, never written over it: admin_actions rows need an
 * order, so partner-level decisions have no other audit home.
 */
// Every failure carries Turkish copy, and the route returns it verbatim. A
// bare z.string() answered a missing note with zod's English "Invalid input:
// expected string, received undefined", and .max() had no message either.
const NOTE_REQUIRED = "Neyi kontrol ettiğinizi kısaca yazın (en az 3 karakter).";
const schema = z.object(
  {
    note: z
      .string({ error: NOTE_REQUIRED })
      .trim()
      .min(3, { error: NOTE_REQUIRED })
      .max(500, { error: "Not en fazla 500 karakter olabilir." }),
  },
  { error: "Geçersiz istek." }
);

// Same shape check the payout routes use.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    // A malformed id names no manufacturer. Unchecked it reached Postgres as an
    // invalid uuid and came back as a 500.
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Üretici bulunamadı" }, { status: 404 });
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }

    const line = formatAdminNoteLine(
      `Vergi incelemesi kapatıldı (${a.session.user.email}): ${parsed.data.note}`
    );

    // Guarded on the flag still being set, so a double click (or two admins)
    // writes one audit line, not two.
    const [updated] = await db
      .update(manufacturers)
      .set({
        requiresManualTaxReview: false,
        notes: sql`CASE WHEN ${manufacturers.notes} IS NULL OR ${manufacturers.notes} = '' THEN ${line} ELSE ${manufacturers.notes} || E'\n' || ${line} END`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(manufacturers.id, id), eq(manufacturers.requiresManualTaxReview, true))
      )
      .returning({ id: manufacturers.id });

    if (!updated) {
      const exists = await db.query.manufacturers.findFirst({
        where: eq(manufacturers.id, id),
        columns: { id: true },
      });
      return exists
        ? NextResponse.json(
            { error: "Bu üreticinin açık bir vergi incelemesi yok." },
            { status: 409 }
          )
        : NextResponse.json({ error: "Üretici bulunamadı" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/manufacturers/[id]/tax-review", ADMIN_ACTION_FAILED_ERROR);
  }
}
