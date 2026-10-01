export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { FRAMEWORK_STATUSES, type FrameworkStatus } from "@/lib/config/quote-framework";
import { frameworkScreensEnabled } from "@/lib/services/quote-access";
import { listAdminFrameworks } from "@/lib/services/quote-framework";
import { FrameworkListClient } from "./client";

/**
 * `/admin/cerceve` — çerçeve anlaşma listesi.
 *
 * BAYRAK KAPALIYKEN 404 (`notFound`), 403 DEĞİL: kapalı bir özelliğin
 * varlığını duyurmanın anlamı yok. Ölçü YALNIZ BAYRAK
 * (`frameworkScreensEnabled`), oturum DEĞİL: bu sayfaya zaten yalnız admin
 * girebiliyor (panelin oturum kapısı düzende uygulanıyor), yani admin
 * oturumunu geçiren bir kapı burada hiçbir şeyi kapatmazdı. Uçların iç test
 * istisnası (`frameworkSurfacesEnabled`) UÇLARDA kalır.
 *
 * Süzgeç ve sayfa numarası SUNUCUDA doğrulanır (teklif kuyruğu deseni):
 * geçersiz bir parametre boş bir listeye değil, sebebini yazan bir kutuya
 * çıkar. Okuma düşerse sayfa ÇÖKMEZ — "liste boş" ile "liste okunamadı" aynı
 * ekran olamaz.
 */
export default async function AdminFrameworksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await frameworkScreensEnabled())) notFound();

  const params = await searchParams;
  const rawStatus = typeof params.status === "string" ? params.status : "";
  const status: FrameworkStatus | null =
    rawStatus === "" || !(FRAMEWORK_STATUSES as readonly string[]).includes(rawStatus)
      ? null
      : (rawStatus as FrameworkStatus);
  if (rawStatus !== "" && status === null) {
    return <FrameworkListClient status={null} page={1} items={[]} readError="Geçersiz durum süzgeci." />;
  }

  const rawPage = typeof params.page === "string" ? params.page : "1";
  if (!/^[1-9]\d{0,5}$/.test(rawPage)) {
    return (
      <FrameworkListClient
        status={status}
        page={1}
        items={[]}
        readError="Geçersiz sayfa numarası."
      />
    );
  }
  const page = Number(rawPage);

  const result = await listAdminFrameworks({ ...(status ? { status } : {}), page }).catch(
    (e) => {
      console.error("admin/cerceve: anlaşma listesi okunamadı", e);
      return null;
    }
  );
  if (!result) {
    return (
      <FrameworkListClient
        status={status}
        page={page}
        items={[]}
        readError="Çerçeve anlaşmalar şu anda okunamıyor. Liste boş olarak DOĞRULANMADI; birkaç dakika sonra yeniden deneyin."
      />
    );
  }

  return (
    <FrameworkListClient
      status={status}
      page={page}
      items={result.items}
      hasNext={result.hasNext}
    />
  );
}
