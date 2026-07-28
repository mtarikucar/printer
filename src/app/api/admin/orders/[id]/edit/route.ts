import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, TurkishAddress } from "@/lib/db/schema";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { normalizePhone } from "@/lib/phone";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { normalizeSizeInput, sizeDisplayTr } from "@/lib/config/sizes";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const a = await requireAdmin();


  if ("response" in a) return a.response;


  const session = { user: { email: a.session.user.email } };

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as {
    adminNotes?: string;
    shippingAddress?: TurkishAddress;
    // Technical spec the manufacturer prints from. `attributes` replaces the
    // whole spec list (send the full list, not a delta).
    figurineSize?: string | null;
    material?: "resin" | "filament" | null;
    finish?: string | null;
    attributes?: { name: string; value: string }[];
  };

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
  });

  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const changedFields: string[] = [];

  if (body.adminNotes !== undefined) {
    updates.adminNotes = body.adminNotes;
    changedFields.push("adminNotes");
  }

  if (body.shippingAddress !== undefined) {
    const addr = body.shippingAddress;
    if (addr.telefon) {
      const normalized = normalizePhone(addr.telefon, "TR");
      if (!normalized) {
        return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
      }
      body.shippingAddress = { ...addr, telefon: normalized };
    }
    updates.shippingAddress = body.shippingAddress;
    changedFields.push("shippingAddress");
  }

  // ─── Technical spec ────────────────────────────────────────────────
  // Manual/WhatsApp orders are born without a spec; this is how an admin fills
  // it in (or corrects it) on an order that is already with a manufacturer.
  const MATERIALS = ["resin", "filament"];
  const FINISHES = [
    "paintable_kit",
    "hand_painted",
    "luxe_display",
    "collector_raw",
    "raw",
    "smoothed",
    "painted",
  ];

  // Free-form size in cm, or a catalogue preset key. `undefined` = not being
  // edited; `null` = cleared.
  let sizeValue: string | null | undefined = undefined;
  if (body.figurineSize !== undefined) {
    if (body.figurineSize === null) {
      sizeValue = null;
    } else {
      const normalized = normalizeSizeInput(String(body.figurineSize));
      if (!normalized.ok) {
        return NextResponse.json({ error: normalized.error }, { status: 400 });
      }
      sizeValue = normalized.value || null;
    }
    updates.figurineSize = sizeValue;
    changedFields.push("figurineSize");
  }
  if (body.material !== undefined && body.material !== null) {
    if (!MATERIALS.includes(body.material)) {
      return NextResponse.json({ error: "Geçersiz malzeme" }, { status: 400 });
    }
    updates.material = body.material;
    changedFields.push("material");
  }
  if (body.finish !== undefined && body.finish !== null) {
    if (!FINISHES.includes(body.finish)) {
      return NextResponse.json({ error: "Geçersiz yüzey" }, { status: 400 });
    }
    updates.finish = body.finish;
    changedFields.push("finish");
  }
  if (body.attributes !== undefined) {
    if (!Array.isArray(body.attributes) || body.attributes.length > 12) {
      return NextResponse.json({ error: "Geçersiz özellik listesi" }, { status: 400 });
    }
    const cleaned = body.attributes
      .map((a) => ({
        groupName: String(a?.name ?? "").trim().slice(0, 60),
        choiceName: String(a?.value ?? "").trim().slice(0, 200),
        priceDeltaKurus: 0,
      }))
      .filter((a) => a.groupName && a.choiceName)
      // "Boyut" is owned by the typed column below — a free-form row with that
      // name would contradict it on the manufacturer's card.
      .filter((a) => a.groupName.toLocaleLowerCase("tr") !== "boyut");
    // Keep the spec snapshot in sync with the typed size: without this the
    // column said "18 cm" while the manufacturer still read the old "Orta".
    if (sizeValue) {
      cleaned.unshift({
        groupName: "Boyut",
        choiceName: sizeDisplayTr(sizeValue),
        priceDeltaKurus: 0,
      });
    }
    updates.selectedOptions = cleaned.length > 0 ? cleaned : null;
    changedFields.push("selectedOptions");
  }

  if (changedFields.length > 0) {
    await db
      .update(orders)
      .set(updates)
      .where(eq(orders.id, id));
  }

  await db.insert(adminActions).values({
    orderId: id,
    action: "edit",
    adminEmail: session.user.email,
    notes: `Edited fields: ${changedFields.join(", ") || "none"}`,
  });

  // Notify the assigned manufacturer when the shipping address changed — they
  // ship to that address, so they must see the update. (adminNotes is internal.)
  if (order.manufacturerId && changedFields.includes("shippingAddress")) {
    await notifyManufacturer({
      manufacturerId: order.manufacturerId,
      type: "system_announcement",
      subject: `Sipariş güncellendi — ${order.orderNumber}`,
      body: `${order.orderNumber} numaralı siparişin teslimat adresi güncellendi. Lütfen kargolamadan önce üretici panelinden güncel adresi kontrol edin.`,
      orderId: id,
    }).catch((e) => console.error("notifyManufacturer (order edit) failed", e));
  }

  // Spec changes alter WHAT gets printed — the manufacturer must not miss them,
  // especially if printing already started.
  const specChanged = changedFields.some((f) =>
    ["figurineSize", "material", "finish", "selectedOptions"].includes(f)
  );
  if (order.manufacturerId && specChanged) {
    await notifyManufacturer({
      manufacturerId: order.manufacturerId,
      type: "system_announcement",
      subject: `Teknik özellikler güncellendi — ${order.orderNumber}`,
      body: `${order.orderNumber} numaralı siparişin teknik özellikleri (boyut / malzeme / renk vb.) güncellendi. Baskıya başlamadan önce üretici panelinden güncel özellikleri kontrol edin.`,
      orderId: id,
    }).catch((e) =>
      console.error("notifyManufacturer (spec edit) failed", e)
    );
  }

  return NextResponse.json({ success: true });
}
