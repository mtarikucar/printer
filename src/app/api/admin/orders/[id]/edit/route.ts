import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, TurkishAddress } from "@/lib/db/schema";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { normalizePhone } from "@/lib/phone";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { createOrderCustomerEditSchema } from "@/lib/validators/order";
import { normalizeSizeInput, sizeDisplayTr } from "@/lib/config/sizes";
import { finishNeedsPainter } from "@/lib/config/prices";
import { orderNeedsPainting } from "@/lib/services/earning-base";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locale = getRequestLocale(request);
    const d = getDictionary(locale);

    const a = await requireAdmin();


    if ("response" in a) return a.response;


    const session = { user: { email: a.session.user.email } };

    const { id } = await params;
    const body = await request.json().catch(() => ({})) as {
      adminNotes?: string;
      shippingAddress?: TurkishAddress;
      // Müşteri kimliği. Elle açılan ve WhatsApp siparişlerinde eksik ya da
      // yanlış girilir; düzeltilemezse fatura yanlış isme kesilir, kargo
      // bildirimi yanlış adrese gider. `null` = temizle.
      customerName?: string;
      email?: string;
      phone?: string | null;
      customerNote?: string | null;
      // Kargolandıktan SONRA adres düzenlemesi ayrı bir onay ister: paket yola
      // çıkmıştır, yeni adres kutunun gittiği yeri değiştirmez.
      confirmAfterShipping?: boolean;
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

    // ─── Müşteri alanları ──────────────────────────────────────────────────
    const customer = createOrderCustomerEditSchema().safeParse({
      ...(body.customerName !== undefined ? { customerName: body.customerName } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.customerNote !== undefined ? { customerNote: body.customerNote } : {}),
    });
    if (!customer.success) {
      return NextResponse.json(
        { error: customer.error.issues[0]?.message ?? "Geçersiz müşteri bilgisi." },
        { status: 400 }
      );
    }
    // Değişmeyen alan YAZILMAZ: denetim kaydı "neyin gerçekten değiştiği"ni
    // göstermeli, her kaydetmede aynı satırları tekrarlamamalı.
    if (customer.data.customerName !== undefined && customer.data.customerName !== order.customerName) {
      updates.customerName = customer.data.customerName;
      changedFields.push("customerName");
    }
    if (customer.data.email !== undefined && customer.data.email !== order.email) {
      updates.email = customer.data.email;
      changedFields.push("email");
    }
    if (customer.data.phone !== undefined) {
      // Boş dize = numarayı temizle. Dolu ise E.164'e çevrilir; çevrilemeyen bir
      // numara sessizce kaydedilirse SMS hiç gitmez.
      const raw = customer.data.phone;
      let next: string | null = null;
      if (raw !== null && raw !== "") {
        next = normalizePhone(raw, "TR");
        if (!next) {
          return NextResponse.json({ error: "Geçerli bir telefon numarası girin." }, { status: 400 });
        }
      }
      if (next !== order.phone) {
        updates.phone = next;
        changedFields.push("phone");
      }
    }
    if (customer.data.customerNote !== undefined) {
      const next = customer.data.customerNote === "" ? null : customer.data.customerNote;
      if (next !== order.customerNote) {
        updates.customerNote = next;
        changedFields.push("customerNote");
      }
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
      // `finish` is a SPEC field; the money split lives in the kalem columns
      // (productionBaseKurus / paintingPriceKurus), frozen when the customer
      // paid. This route must never move money on a paid order — but it also
      // must not leave the two contradicting each other, which is exactly what
      // it used to do: setting "El Boyaması" on an order carrying no painting
      // share left it unroutable to any painter (send-to-painter and
      // assign-painter both refuse without needsPainting) while the manufacturer
      // accrued the whole amount.
      const wantsPainter = finishNeedsPainter(body.finish);
      const changingFinish = body.finish !== order.finish;
      // Yalnızca yüzeyi GERÇEKTEN değiştiren bir düzenleme engellenir. Guard'ı
      // "mevcut duruma" bakarak kurmak, kalem modelinden ÖNCE yazılmış her
      // hand_painted + boyama payı sıfır siparişi (eski WhatsApp ve manuel
      // siparişlerin tamamı) kalıcı olarak düzenlenemez hâle getiriyordu —
      // admin artık adres ya da boyut bile düzeltemezdi.
      if (changingFinish && wantsPainter && order.paintingPriceKurus <= 0) {
        return NextResponse.json(
          {
            error:
              "Bu sipariş boyama kalemi olmadan satıldı; yüzeyi el boyamasına çevirmek boyacı payı oluşturmaz. Boyama bedeli için siparişi boyama kalemiyle yeniden oluşturun.",
          },
          { status: 400 }
        );
      }
      if (changingFinish && !wantsPainter && order.painterId) {
        return NextResponse.json(
          {
            error:
              "Sipariş bir boyacıya devredilmiş durumda; yüzey boyamasız bir seçeneğe çevrilemez. Önce boyacıdan geri alın.",
          },
          { status: 400 }
        );
      }
      updates.finish = body.finish;
      changedFields.push("finish");
      // Keep the routing flag in lockstep with the money it is derived from.
      updates.needsPainting = orderNeedsPainting(order.paintingPriceKurus);
    }
    if (body.attributes !== undefined) {
      if (!Array.isArray(body.attributes) || body.attributes.length > 12) {
        return NextResponse.json({ error: "Geçersiz özellik listesi" }, { status: 400 });
      }
      // THIS ROUTE NEVER MOVES MONEY. amountKurus and the kalem columns stay as
      // the customer paid. But `priceDeltaKurus` on each selected option is part
      // of that payment snapshot: the order's Para dökümü (src/lib/config/
      // order-money.ts) carves the option rows out of the amount with it. So a
      // spec save keeps the delta of every group/choice pair it did not change;
      // only a new or changed choice gets 0 (nothing was ever charged for it, and
      // the carve folds its share back into the base row). Rewriting every row
      // with 0, as this used to, silently moved priced options into the base.
      const cleanText = (group: unknown, choice: unknown) => ({
        groupName: String(group ?? "").trim().slice(0, 60),
        choiceName: String(choice ?? "").trim().slice(0, 200),
      });
      const groupKey = (groupName: string) => groupName.toLocaleLowerCase("tr");
      const pairKey = (o: { groupName: string; choiceName: string }) =>
        JSON.stringify([o.groupName, o.choiceName]);
      const prior = (order.selectedOptions ?? []).map((o) => ({
        ...cleanText(o.groupName, o.choiceName),
        priceDeltaKurus: Number.isFinite(o.priceDeltaKurus) ? o.priceDeltaKurus : 0,
      }));

      // Boyut, Malzeme and "Boyama / Yüzey" belong to the typed fields. The admin
      // client never lists them as editable rows (the saveSpec payload holds only
      // the other rows), so the request cannot say whether one changed; the
      // typed field decides. "boyut" is rebuilt from the typed size below. The
      // other two are kept as they are unless their typed field changes in this
      // request, or the admin typed a row with that group name; they used to be
      // dropped on every spec save, a priced one taking its delta with it.
      const OWNED_GROUPS = ["boyut", "malzeme", "boyama / yüzey"];
      const priorSize = (() => {
        if (!order.figurineSize) return null;
        const n = normalizeSizeInput(order.figurineSize);
        return n.ok ? n.value || null : order.figurineSize;
      })();
      // `undefined`: the size is not being edited; the Boyut rows stay as they are.
      const sizeUnchanged = sizeValue === undefined || sizeValue === priorSize;
      const materialChanged =
        body.material !== undefined && body.material !== null && body.material !== order.material;
      const finishChanged =
        body.finish !== undefined && body.finish !== null && body.finish !== order.finish;

      const incoming = body.attributes
        .map((a) => cleanText(a?.name, a?.value))
        .filter((a) => a.groupName && a.choiceName)
        // "Boyut" is owned by the typed column below — a free-form row with that
        // name would contradict it on the manufacturer's card.
        .filter((a) => groupKey(a.groupName) !== "boyut");
      const incomingGroups = new Set(incoming.map((a) => groupKey(a.groupName)));

      const keepOwned = (g: string): boolean => {
        if (g === "boyut") return sizeValue === undefined || (sizeValue === null && priorSize === null);
        if (incomingGroups.has(g)) return false;
        if (g === "malzeme") return !materialChanged;
        return !finishChanged; // "boyama / yüzey"
      };
      const keptOwned = prior.filter((o) => {
        const g = groupKey(o.groupName);
        return OWNED_GROUPS.includes(g) && keepOwned(g);
      });

      // Rows the request does speak for keep their delta by exact pair match.
      // Each prior row is used once, so a duplicated row does not duplicate the
      // money.
      const pool = new Map<string, number[]>();
      for (const o of prior) {
        const g = groupKey(o.groupName);
        if (OWNED_GROUPS.includes(g) && keepOwned(g)) continue;
        const k = pairKey(o);
        pool.set(k, [...(pool.get(k) ?? []), o.priceDeltaKurus]);
      }
      const takeDelta = (o: { groupName: string; choiceName: string }) =>
        pool.get(pairKey(o))?.shift() ?? 0;

      const cleaned: { groupName: string; choiceName: string; priceDeltaKurus: number }[] = [];
      // Keep the spec snapshot in sync with the typed size: without this the
      // column said "18 cm" while the manufacturer still read the old "Orta".
      // An unchanged size is the same choice, so the rebuilt row carries the
      // delta its Boyut row(s) had; a changed size gets 0.
      if (sizeValue) {
        const priorBoyut = prior.filter((o) => groupKey(o.groupName) === "boyut");
        cleaned.push({
          groupName: "Boyut",
          choiceName: sizeDisplayTr(sizeValue),
          priceDeltaKurus: sizeUnchanged
            ? priorBoyut.reduce((sum, o) => sum + o.priceDeltaKurus, 0)
            : 0,
        });
      }
      // Owned rows first, in their stored order (Boyut, Malzeme, Boyama / Yüzey
      // is how the create route writes them), then the free-form rows.
      cleaned.push(...keptOwned);
      for (const a of incoming) cleaned.push({ ...a, priceDeltaKurus: takeDelta(a) });

      updates.selectedOptions = cleaned.length > 0 ? cleaned : null;
      changedFields.push("selectedOptions");
    }

    // Kargolandıktan sonra adres düzenlemesi: paket zaten yola çıkmıştır, yeni
    // adres kutunun gideceği yeri DEĞİŞTİRMEZ. Admin bunu bilerek yapıyorsa kayıt
    // tutulur (iade/yeniden gönderim yazışmasının dayanağı olur), ama tek tıkla
    // sessizce olmaz.
    const afterShipping = order.status === "shipped" || order.status === "delivered";
    const addressAfterShipping = afterShipping && changedFields.includes("shippingAddress");
    if (addressAfterShipping && body.confirmAfterShipping !== true) {
      return NextResponse.json(
        {
          error:
            "Bu sipariş kargolandı. Adres değişikliği gönderilen paketi değiştirmez; yine de kaydetmek için onaylayın.",
          code: "address_after_shipping",
        },
        { status: 409 }
      );
    }

    // Hiçbir şey değişmediyse ne yazma ne denetim satırı olur: her "kaydet"
    // tıklaması için bir denetim satırı yazmak, kaydı gerçek değişikliklerin
    // okunamadığı bir gürültüye çeviriyordu.
    if (changedFields.length === 0) {
      return NextResponse.json({ success: true, changedFields: [] });
    }

    await db
      .update(orders)
      .set(updates)
      .where(eq(orders.id, id));

    await db.insert(adminActions).values({
      orderId: id,
      action: "edit",
      adminEmail: session.user.email,
      notes:
        `Düzenlenen alanlar: ${changedFields.join(", ")}` +
        (addressAfterShipping ? " — KARGODAN SONRA adres değişikliği" : ""),
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

    // Boyacı da adresi ve teknik özellikleri okur: boyamalı siparişte kargoyu O
    // yapar (painter/ship), yani yanlış adresi kimse düzeltmez. Özellik
    // değişikliği de boyamayı doğrudan etkiler (yüzey, renk, boyut).
    if (order.painterId && (changedFields.includes("shippingAddress") || specChanged)) {
      const what = changedFields.includes("shippingAddress")
        ? "teslimat adresi"
        : "teknik özellikleri";
      await notifyPainter({
        painterId: order.painterId,
        type: "system_announcement",
        subject: `Sipariş güncellendi — ${order.orderNumber}`,
        body: `${order.orderNumber} numaralı siparişin ${what} güncellendi. Boyamaya devam etmeden ve kargolamadan önce boyacı panelinden güncel bilgileri kontrol edin.`,
        orderId: id,
      }).catch((e) => console.error("notifyPainter (order edit) failed", e));
    }

    return NextResponse.json({
      success: true,
      changedFields,
      ...(addressAfterShipping
        ? {
            warning:
              "Adres kargolandıktan sonra değiştirildi; gönderilen paket bu adrese göre yola çıkmadı.",
          }
        : {}),
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/edit", ADMIN_ACTION_FAILED_ERROR);
  }
}
