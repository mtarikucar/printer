export const dynamic = "force-dynamic";

import {
  ADMIN_QUOTE_PAGE_SIZE,
  ADMIN_QUOTE_TABS,
  ADMIN_QUOTE_TAB_LABELS,
  listAdminQuotes,
  parseAdminQuoteTab,
} from "@/lib/services/quote-admin";
import { QuoteQueueClient, type QuoteQueueTab } from "./client";

/**
 * `/admin/teklifler` — anlık teklif kuyruğu.
 *
 * Sekme ve sayfa numarası SUNUCUDA doğrulanır (disputes deseni): geçersiz bir
 * parametre boş bir listeye değil, sebebini yazan bir kutuya çıkar. Okuma
 * düşerse sayfa ÇÖKMEZ — "liste boş" ile "liste okunamadı" aynı ekran
 * olamaz, biri "iş yok" öbürü "bilinmiyor" demektir.
 */

/** Sekme etiketleri sunucuda çözülür: istemci `db` zincirini import etmesin. */
const TABS: QuoteQueueTab[] = ADMIN_QUOTE_TABS.map((key) => ({
  key,
  label: ADMIN_QUOTE_TAB_LABELS[key],
}));

export default async function AdminQuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = parseAdminQuoteTab(params.tab);
  if (tab === null) {
    return (
      <QuoteQueueClient
        tab="review"
        tabs={TABS}
        page={1}
        items={[]}
        readError="Geçersiz sekme."
      />
    );
  }

  const rawPage = params.page ?? "1";
  const page =
    typeof rawPage === "string" && /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : NaN;
  if (!Number.isSafeInteger(page)) {
    return (
      <QuoteQueueClient
        tab={tab}
        tabs={TABS}
        page={1}
        items={[]}
        readError="Geçersiz sayfa numarası."
      />
    );
  }

  const q = typeof params.q === "string" ? params.q.slice(0, 120) : "";

  const result = await listAdminQuotes({ tab, page, q }).catch((e) => {
    console.error("admin/teklifler: kuyruk okunamadı", e);
    return null;
  });
  if (!result) {
    return (
      <QuoteQueueClient
        tab={tab}
        tabs={TABS}
        page={page}
        q={q}
        items={[]}
        readError="Teklif kuyruğu şu anda okunamıyor. Liste boş olarak DOĞRULANMADI; birkaç dakika sonra yeniden deneyin."
      />
    );
  }

  return (
    <QuoteQueueClient
      tab={tab}
      tabs={TABS}
      page={page}
      q={q}
      items={result.items}
      hasNext={result.hasNext}
      pageSize={ADMIN_QUOTE_PAGE_SIZE}
    />
  );
}
