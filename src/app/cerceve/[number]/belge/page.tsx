import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { frameworkSurfacesEnabled, resolveFrameworkAccess } from "@/lib/services/quote-access";
import { loadFrameworkDetail } from "@/lib/services/quote-framework";
import { presentFramework } from "@/lib/services/quote-framework-present";
import { getPublicUrl } from "@/lib/services/storage";
import { QuoteDocumentPrintButton } from "@/app/teklif/[number]/belge/print-button";
import { FrameworkDocument } from "./framework-document";
import "@/app/teklif/[number]/belge/belge.css";

/**
 * Çerçeve anlaşma belgesi — `/cerceve/C-000123/belge`.
 *
 * BİÇİM `/teklif/[number]/belge/`nin KARDEŞİ: aynı A4 kâğıdı, aynı
 * `belge.css`, aynı yazdır düğmesi. İKİSİ DE YENİDEN YAZILMADI — bir
 * stil dosyasının ve bir `window.print()` düğmesinin kopyası, bir gün yalnız
 * birinin düzeltildiği gün demek olurdu. Paylaşılmayan tek şey İÇERİKTİR
 * (`framework-document.tsx`): teklifin ve anlaşmanın zorunlu metinleri ayrıdır
 * ve `quote-document.tsx`e dokunulmadı.
 *
 * ERİŞİM çalışma alanıyla AYNI: sahip ya da admin (`resolveFrameworkAccess`).
 * Paylaşım jetonu yok, anonim dal yok — belge fiyat kapısının arkasındaki tek
 * çıktıdır ve anlaşma kurumsal/kişiye özeldir.
 *
 * `noindex` kök düzenden gelir (`isNoindexPath("/cerceve")`).
 */
export const dynamic = "force-dynamic";

export default async function FrameworkDocumentPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  if (!(await frameworkSurfacesEnabled())) notFound();

  const { number } = await params;
  const access = await resolveFrameworkAccess(number);
  if (!access) notFound();

  const detail = await loadFrameworkDetail(access.frameworkId);
  if (!detail) notFound();

  const framework = presentFramework({
    detail,
    viewer: access.viewer,
    now: new Date(),
    sign: getPublicUrl,
  });
  const d = getDictionary(await getLocale());

  return (
    <div className="quote-doc-page">
      <div className="quote-doc-bar no-print">
        <Link
          href={`/cerceve/${encodeURIComponent(framework.number)}`}
          className="btn-secondary !px-4 !py-2 text-xs"
        >
          ← {framework.number}
        </Link>
        <QuoteDocumentPrintButton />
      </div>

      <FrameworkDocument framework={framework} d={d} />
    </div>
  );
}
