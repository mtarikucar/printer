import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/services/customer-auth";
import {
  deleteAddress,
  getAddress,
  setDefaultAddress,
  updateAddress,
} from "@/lib/services/address-book";
import { phoneField } from "@/lib/phone";
import { handleRouteFailure, CUSTOMER_ACTION_FAILED_ERROR, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

const updateSchema = z.object({
  label: z.string().trim().min(1).max(50),
  fullName: z.string().trim().min(2).max(120),
  phone: phoneField(),
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

async function handleGET(
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

async function handlePATCH(
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

async function handleDELETE(
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

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await handleGET(_request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/customer/addresses/[id]", CUSTOMER_READ_FAILED_ERROR);
  }
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePATCH` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await handlePATCH(request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/customer/addresses/[id]", CUSTOMER_ACTION_FAILED_ERROR);
  }
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleDELETE` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await handleDELETE(_request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/customer/addresses/[id]", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
