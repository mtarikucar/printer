import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { productImages } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { canEditProduct } from "@/lib/services/product-guard";
import {
  addOptionChoice,
  createAddon,
  createOptionGroup,
  deleteAddon,
  deleteOptionChoice,
  deleteOptionGroup,
  getProductConfig,
  productIdForAddon,
  productIdForChoice,
  productIdForGroup,
  setImageOptionChoice,
  updateAddon,
  updateOptionChoice,
  updateOptionGroup,
} from "@/lib/services/product-options";

// Unified product options/add-ons management — used by BOTH the admin and the
// seller product editors (canEditProduct allows admin-any / seller-own).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await canEditProduct(id);
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: access.status });

  const config = await getProductConfig(id);
  const imgs = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id))
    .orderBy(asc(productImages.sortOrder));
  const images = imgs.map((i) => ({
    id: i.id,
    url: getPublicUrl(i.storageKey),
    optionChoiceId: i.optionChoiceId,
  }));
  return NextResponse.json({ config, images });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await canEditProduct(id);
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: access.status });

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;

  // Guards that a child resource belongs to THIS product before mutating it.
  const owns = async (resolve: Promise<string | null>) => (await resolve) === id;

  try {
    switch (action) {
      case "createGroup":
        await createOptionGroup({
          productId: id,
          name: String(body.name ?? ""),
          isRequired: !!body.isRequired,
        });
        break;
      case "updateGroup":
        if (!(await owns(productIdForGroup(body.groupId)))) return forbid();
        await updateOptionGroup(body.groupId, {
          name: body.name,
          isRequired: body.isRequired,
        });
        break;
      case "deleteGroup":
        if (!(await owns(productIdForGroup(body.groupId)))) return forbid();
        await deleteOptionGroup(body.groupId);
        break;
      case "addChoice":
        if (!(await owns(productIdForGroup(body.groupId)))) return forbid();
        await addOptionChoice({
          groupId: body.groupId,
          name: String(body.name ?? ""),
          priceDeltaKurus: Number(body.priceDeltaKurus ?? 0),
          isDefault: !!body.isDefault,
        });
        break;
      case "updateChoice":
        if (!(await owns(productIdForChoice(body.choiceId)))) return forbid();
        await updateOptionChoice(body.choiceId, {
          name: body.name,
          priceDeltaKurus:
            body.priceDeltaKurus !== undefined
              ? Number(body.priceDeltaKurus)
              : undefined,
          isDefault: body.isDefault,
        });
        break;
      case "deleteChoice":
        if (!(await owns(productIdForChoice(body.choiceId)))) return forbid();
        await deleteOptionChoice(body.choiceId);
        break;
      case "createAddon":
        await createAddon({
          productId: id,
          name: String(body.name ?? ""),
          description: body.description ?? null,
          priceKurus: Number(body.priceKurus ?? 0),
        });
        break;
      case "updateAddon":
        if (!(await owns(productIdForAddon(body.addonId)))) return forbid();
        await updateAddon(body.addonId, {
          name: body.name,
          description: body.description,
          priceKurus:
            body.priceKurus !== undefined ? Number(body.priceKurus) : undefined,
        });
        break;
      case "deleteAddon":
        if (!(await owns(productIdForAddon(body.addonId)))) return forbid();
        await deleteAddon(body.addonId);
        break;
      case "tagImage": {
        const choiceId = body.optionChoiceId || null;
        if (choiceId && !(await owns(productIdForChoice(choiceId)))) return forbid();
        await setImageOptionChoice(id, String(body.imageId ?? ""), choiceId);
        break;
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return NextResponse.json(
      { error: msg },
      { status: msg === "EMPTY_NAME" ? 400 : 500 }
    );
  }

  // Return the fresh config so the editor re-renders from server truth.
  const config = await getProductConfig(id);
  return NextResponse.json({ config });
}

function forbid() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
