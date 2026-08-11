import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { assignManufacturerToOrder } from "@/lib/services/manufacturer-assign";

const ERRORS: Record<string, { message: string; status: number }> = {
  manufacturer_unavailable: {
    message: "Manufacturer not found or not active",
    status: 400,
  },
  no_printable_content: {
    message:
      "Bu siparişte üreticiye gönderilecek basılabilir içerik yok (model, ürün veya kalem). Önce 3D modeli yükleyin ya da sipariş kalemlerini girin.",
    status: 400,
  },
  not_assignable: {
    message: "Order not found, not in approved status, or already assigned",
    status: 400,
  },
};

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
        { error: "manufacturerId is required" },
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
      const err = ERRORS[result.reason];
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Assign manufacturer failed:", error);
    return NextResponse.json(
      { error: "Failed to assign manufacturer" },
      { status: 500 }
    );
  }
}
