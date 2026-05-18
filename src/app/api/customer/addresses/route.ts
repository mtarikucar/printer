import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { rateLimitAsync } from "@/lib/services/rate-limit";
import { createAddress, listAddresses } from "@/lib/services/address-book";

const addressSchema = z.object({
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

export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const addresses = await listAddresses(session.userId);
  return NextResponse.json({ addresses });
}

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  // Cap address creation per user to prevent runaway lists / abuse.
  const rl = await rateLimitAsync(
    `addresses:create:${session.userId}`,
    20,
    60 * 60 * 1000
  );
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid address", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const created = await createAddress(session.userId, parsed.data);
  return NextResponse.json({ address: created }, { status: 201 });
}
