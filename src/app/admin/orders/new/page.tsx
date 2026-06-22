import { getLocale } from "@/lib/i18n/get-locale";
import { NewOrderClient } from "./new-order-client";

export default async function AdminNewOrderPage() {
  const locale = await getLocale();
  return (
    <div className="p-4 sm:p-8">
      <NewOrderClient locale={locale} />
    </div>
  );
}
