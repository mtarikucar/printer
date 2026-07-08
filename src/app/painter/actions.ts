"use server";

import { redirect } from "next/navigation";
import { clearPainterSessionCookie } from "@/lib/services/painter-auth";

export async function painterSignOutAction() {
  await clearPainterSessionCookie();
  redirect("/painter/login");
}
