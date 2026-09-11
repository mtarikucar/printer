import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { markPayoutPaid } from "@/lib/services/payouts";
import { markPainterPayoutPaid } from "@/lib/services/painter-payouts";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";

// Every failure carries Turkish copy: the /admin/payouts client shows the
// route's error text verbatim.
const schema = z.object(
  {
    reference: z
      .string({ error: "Banka referansı metin olmalı." })
      .trim()
      .max(120, { error: "Banka referansı en fazla 120 karakter olabilir." })
      .optional(),
    // Which payout table the id belongs to. The /admin/payouts tabs always send
    // it, so a painter payout is never looked up in the manufacturer table
    // first. Older callers (e2e scripts) omit it and keep the try-both
    // behaviour below.
    kind: z
      .enum(["manufacturer", "painter"], {
        error: "Ödeme türü üretici ya da boyacı olmalı.",
      })
      .optional(),
  },
  { error: "Geçersiz istek." }
);
// The one answer for "no pending payout with this id": a malformed id, an
// unknown one, or one already marked paid (a double click, two admins). It was
// English, and the Turkish admin showed it as is.
const NOT_FOUND_OR_PAID = "Ödeme bulunamadı ya da zaten ödendi.";
const fmtTRY = (kurus: number) => `₺${(kurus / 100).toLocaleString("tr-TR")}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Step 2 of the payout flow: the admin marks a pending payout paid AFTER
// sending the bank transfer. Its earnings flip to "paid". Idempotent.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;
  // A malformed id would otherwise surface as a Postgres uuid-syntax 500.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: NOT_FOUND_OR_PAID }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  // An invalid body used to be ignored: a reference over 120 characters was
  // dropped and the payout still marked paid, without its bank reference.
  // Refuse it instead, so the admin can shorten it and retry.
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." },
      { status: 400 }
    );
  }
  // An empty prompt answer is "no reference", not a blank one.
  const reference = parsed.data.reference ? parsed.data.reference : null;
  const kind = parsed.data.kind;

  // The same id space covers both manufacturer and painter payouts. A
  // partner-initiated payout request creates a PENDING row and stamps its
  // earnings' payoutId — those earnings are then invisible to the batch-create
  // routes (which only take payoutId IS NULL), so this endpoint is the ONLY way
  // to settle them. Without `kind`, try the manufacturer table first, then the
  // painter table.
  if (kind !== "painter") {
    const result = await markPayoutPaid(id, reference);
    if (result) {
      await notifyManufacturer({
        manufacturerId: result.manufacturerId,
        type: "system_announcement",
        subject: "Ödemeniz gönderildi",
        body: `${fmtTRY(result.totalKurus)} tutarındaki ödemeniz banka hesabınıza gönderildi.${reference ? ` Referans: ${reference}.` : ""} Hesabınıza geçmesi bankanıza göre 1-2 iş günü sürebilir.`,
      }).catch((e) => console.error("notifyManufacturer (payout paid) failed", e));
      return NextResponse.json({ success: true });
    }
  }

  if (kind !== "manufacturer") {
    const painterResult = await markPainterPayoutPaid(id, reference);
    if (painterResult) {
      await notifyPainter({
        painterId: painterResult.painterId,
        type: "payout",
        subject: "Ödemeniz gönderildi",
        body: `${fmtTRY(painterResult.totalKurus)} tutarındaki ödemeniz banka hesabınıza gönderildi.${reference ? ` Referans: ${reference}.` : ""} Hesabınıza geçmesi bankanıza göre 1-2 iş günü sürebilir.`,
      }).catch((e) => console.error("notifyPainter (payout paid) failed", e));
      return NextResponse.json({ success: true });
    }
  }

  return NextResponse.json({ error: NOT_FOUND_OR_PAID }, { status: 400 });
}
