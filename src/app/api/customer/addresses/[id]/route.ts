import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/services/customer-auth";
import {
  deleteAddress,
  getAddress,
  setDefaultAddress,
  updateAddress,
} from "@/lib/services/address-book";

const updateSchema = z.object({
  label: z.string().trim().min(1).max(50),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  adres: z.string().trim().min(5).max(500),
  mahalle: z.string().trim().max(120).optional().nullable(),
  ilce: z.string().trim().min(2).max(80),
  il: z.string().trim().min(2).max(80),
  postaKodu: z.string().trim().min(4).max(10),
  isDefault: z.boolean().optional(),
});

// PATCH body accepts either a full address update OR `{ makeDefault: true }`
// to flip the default flag without re-sending the whole record.
const patchSchema = z.union([
  updateSchema,
  z.object({ makeDefault: z.literal(true) }),
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const address = await getAddress(session.userId, id);
  if (!address) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ address });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if ("makeDefault" in parsed.data) {
    const updated = await setDefaultAddress(session.userId, id);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ address: updated });
  }

  const updated = await updateAddress(session.userId, id, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ address: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ok = await deleteAddress(session.userId, id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
