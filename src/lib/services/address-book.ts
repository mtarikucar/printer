import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userAddresses } from "@/lib/db/schema";

export interface AddressInput {
  label: string;
  fullName: string;
  phone: string;
  adres: string;
  mahalle?: string | null;
  ilce: string;
  il: string;
  postaKodu: string;
  isDefault?: boolean;
}

export type SavedAddress = typeof userAddresses.$inferSelect;

export async function listAddresses(userId: string): Promise<SavedAddress[]> {
  return db
    .select()
    .from(userAddresses)
    .where(eq(userAddresses.userId, userId))
    .orderBy(desc(userAddresses.isDefault), asc(userAddresses.createdAt));
}

export async function getAddress(
  userId: string,
  addressId: string
): Promise<SavedAddress | null> {
  const rows = await db
    .select()
    .from(userAddresses)
    .where(
      and(eq(userAddresses.userId, userId), eq(userAddresses.id, addressId))
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createAddress(
  userId: string,
  input: AddressInput
): Promise<SavedAddress> {
  return db.transaction(async (tx) => {
    // Only one address can be default per user. If this one is being
    // marked default, demote any existing default first.
    if (input.isDefault) {
      await tx
        .update(userAddresses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(userAddresses.userId, userId));
    }

    const existing = await tx
      .select({ id: userAddresses.id })
      .from(userAddresses)
      .where(eq(userAddresses.userId, userId))
      .limit(1);

    const [row] = await tx
      .insert(userAddresses)
      .values({
        userId,
        label: input.label,
        fullName: input.fullName,
        phone: input.phone,
        adres: input.adres,
        mahalle: input.mahalle ?? null,
        ilce: input.ilce,
        il: input.il,
        postaKodu: input.postaKodu,
        // First-ever address is implicitly the default.
        isDefault: input.isDefault === true || existing.length === 0,
      })
      .returning();
    return row;
  });
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: AddressInput
): Promise<SavedAddress | null> {
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(userAddresses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(userAddresses.userId, userId));
    }
    const [row] = await tx
      .update(userAddresses)
      .set({
        label: input.label,
        fullName: input.fullName,
        phone: input.phone,
        adres: input.adres,
        mahalle: input.mahalle ?? null,
        ilce: input.ilce,
        il: input.il,
        postaKodu: input.postaKodu,
        isDefault: input.isDefault === true,
        updatedAt: new Date(),
      })
      .where(
        and(eq(userAddresses.userId, userId), eq(userAddresses.id, addressId))
      )
      .returning();
    return row ?? null;
  });
}

export async function deleteAddress(
  userId: string,
  addressId: string
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const target = await tx
      .select()
      .from(userAddresses)
      .where(
        and(eq(userAddresses.userId, userId), eq(userAddresses.id, addressId))
      )
      .limit(1);
    if (target.length === 0) return false;

    await tx
      .delete(userAddresses)
      .where(
        and(eq(userAddresses.userId, userId), eq(userAddresses.id, addressId))
      );

    // If we just deleted the default, promote the next-oldest to default
    // so the customer always has a sensible prefill.
    if (target[0].isDefault) {
      const remaining = await tx
        .select({ id: userAddresses.id })
        .from(userAddresses)
        .where(eq(userAddresses.userId, userId))
        .orderBy(asc(userAddresses.createdAt))
        .limit(1);
      if (remaining[0]) {
        await tx
          .update(userAddresses)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(userAddresses.id, remaining[0].id));
      }
    }
    return true;
  });
}

export async function setDefaultAddress(
  userId: string,
  addressId: string
): Promise<SavedAddress | null> {
  return db.transaction(async (tx) => {
    await tx
      .update(userAddresses)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(userAddresses.userId, userId));
    const [row] = await tx
      .update(userAddresses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(eq(userAddresses.userId, userId), eq(userAddresses.id, addressId))
      )
      .returning();
    return row ?? null;
  });
}
