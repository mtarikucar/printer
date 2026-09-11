import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  ASSIGN_FAILURE_MESSAGES,
  assignManufacturerToOrder,
} from "@/lib/services/manufacturer-assign";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;

  try {
    const body = await request.json();
    const { manufacturerId } = body;

    if (!manufacturerId) {
      return NextResponse.json(
        { error: "Üretici seçin." },
        { status: 400 }
      );
    }

    // Validation, the atomic unassigned-guarded update, the audit row, the
    // partner notification and the SSE emit all live in the shared service —
    // the automatic (platform-product) and decline-reassign paths use the same
    // one, so they can't drift apart.
    const result = await assignManufacturerToOrder({
      orderId: id,
      manufacturerId,
      adminEmail: a.session.user.email,
    });

    if (!result.ok) {
      // Same copy as the bulk assign route (ASSIGN_FAILURE_MESSAGES). Every
      // reason is a 400, as before; a refunded order arrives as not_assignable.
      return NextResponse.json(
        { error: ASSIGN_FAILURE_MESSAGES[result.reason] },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Assign manufacturer failed:", error);
    return NextResponse.json(
      { error: "Üretici atanamadı. Tekrar deneyin." },
      { status: 500 }
    );
  }
}
