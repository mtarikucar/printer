export const dynamic = "force-dynamic";

import { getLocale } from "@/lib/i18n/get-locale";
import { NewProductClient } from "./new-product-client";

export default async function AdminNewProductPage() {
  const locale = await getLocale();
  return (
    <div className="p-8 max-w-2xl">
      <NewProductClient locale={locale} />
    </div>
  );
}
