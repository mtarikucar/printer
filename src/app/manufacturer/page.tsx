import { redirect } from "next/navigation";

export default function ManufacturerRootPage() {
  redirect("/manufacturer/orders");
}
