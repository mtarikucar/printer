"use server";

import { redirect } from "next/navigation";
import { clearManufacturerSessionCookie } from "@/lib/services/manufacturer-auth";

export async function manufacturerSignOutAction() {
  await clearManufacturerSessionCookie();
  redirect("/manufacturer/login");
}
