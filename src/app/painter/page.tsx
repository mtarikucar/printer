import { redirect } from "next/navigation";
import { getPainterSession } from "@/lib/services/painter-auth";

export default async function PainterRootPage() {
  const session = await getPainterSession();
  redirect(session ? "/painter/dashboard" : "/painter/login");
}
