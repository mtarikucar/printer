import { getLocale } from "@/lib/i18n/get-locale";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { db } from "@/lib/db";
import { orders, painters, painterNotifications } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getPainterSession } from "@/lib/services/painter-auth";
import { PainterSidebar } from "./sidebar";
import { PainterRealtimeShell } from "./realtime-shell";
import { PanelShell } from "@/components/panel-shell";

/**
 * GÖSTERİM amaçlı rozet okuması: sonuç yalnızca kenar çubuğunda GÖSTERİLİR, bir
 * kapıyı açıp kapatmaz. Arıza YUTULMAZ — null "0" DEĞİL "BİLİNMİYOR" demektir.
 *
 * NEDEN KABUKTA AYRI BİR KURAL: bu sayımlar /painter/* altındaki HER sayfanın
 * KABUĞUNDA çalışır. Korumasız hâlinde `orders` ya da `painter_notifications`
 * okunamadığında düşen tek bir kart değil, boyacının panelinin TAMAMIdır —
 * üstelik sayfaların kendi "okunamadı" korumaları hiç çalışamadan, çünkü kabuk
 * onlardan önce ölür. Yalnızca GÖSTERİLEN bir sayı, panelin açılmasının ön şartı
 * olamaz. Bu, admin kabuğunda ÖLÇÜLEN ve düzeltilen arızanın birebir ikizidir
 * (bkz. src/app/admin/layout.tsx).
 */
async function displayRead<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[boyacı paneli] ${label} sayısı okunamadı`, e);
    return null;
  }
}

/**
 * Panelin HER sayfasının en üstünde duran arıza şeridi.
 *
 * NEDEN İÇERİĞİN ÜSTÜNDE, kenar çubuğunda değil: boyacı oraya bakar ve mobilde
 * kenar çubuğu kapalı bir çekmecedir — orada yazan uyarı hiç görülmezdi. Rozetin
 * "?" işareti sebebi söylemez, yalnız sorar; cümle burada kurulur.
 */
function PanelReadNotice({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <div
      role="alert"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-8"
    >
      <p className="font-semibold">
        Menüdeki bazı sayılar şu anda okunamıyor (geçici sistem arızası)
      </p>
      <p className="mt-1 text-amber-900/80">
        Panel ve bu sayfadaki kayıtlar çalışıyor; ama menüde &quot;?&quot; yazan
        rozetler SIFIR DEĞİL, BİLİNMİYOR: {areas.join(" · ")}. Birkaç dakika sonra
        sayfayı yenileyin.
      </p>
    </div>
  );
}

export default async function PainterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const session = await getPainterSession();

  // If no session, render children without sidebar (login/register pages).
  // Middleware handles redirecting unauthenticated users away from protected
  // routes.
  if (!session) {
    return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
  }

  // KİMLİK OKUMASI bilerek KORUMASIZ: bu satır bir rozet değil, panelin
  // KAPISIDIR (onay durumu). Okunamadığında "aktif boyacı" varsayıp paneli
  // açmak, kapıyı arızaya dayanarak açmak olurdu — kapı besleyen okuma kapalı
  // tarafa düşer.
  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
  });

  if (!painter) {
    return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
  }

  // Non-active painters (pending_approval, conditionally_approved, suspended,
  // rejected) get the shell without job/notification counts — their dashboard
  // page renders the appropriate status message.
  if (painter.status !== "active") {
    return (
      <LocaleProvider locale={locale}>
        <PainterRealtimeShell>
          <PanelShell
            title="Figurunica Boyama"
            sidebar={
              <PainterSidebar newJobCount={0} unreadNotificationCount={0} />
            }
          >
            {children}
          </PanelShell>
        </PainterRealtimeShell>
      </LocaleProvider>
    );
  }

  // New jobs: orders handed off to this painter but not yet accepted.
  // Unread admin/system notifications for this painter.
  // İKİSİ DE KORUMALI ve AYRI: biri okunamadığında öteki rozet yine gerçek
  // sayısını gösterir (tek bir Promise.all dalının arızası hepsini silmez).
  const [assignedRead, unreadRead] = await Promise.all([
    displayRead(
      "yeni boyama işleri",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          sql`${orders.painterId} = ${session.painterId} AND ${orders.painterStatus} = 'assigned'`
        )
    ),
    displayRead(
      "okunmamış bildirimler",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(painterNotifications)
        .where(
          sql`${painterNotifications.painterId} = ${session.painterId} AND ${painterNotifications.readAt} IS NULL`
        )
    ),
  ]);

  // null = okunamadı (BİLİNMİYOR); sayı = gerçek sayım.
  const assignedCount = assignedRead === null ? null : assignedRead[0]?.count ?? 0;
  const unreadCount = unreadRead === null ? null : unreadRead[0]?.count ?? 0;
  const unreadableAreas = [
    assignedRead === null && "Yeni boyama işleri",
    unreadRead === null && "Okunmamış bildirimler",
  ].filter((x): x is string => typeof x === "string");

  return (
    <LocaleProvider locale={locale}>
      <PainterRealtimeShell>
        <PanelShell
          title="Figurunica Boyama"
          sidebar={
            <PainterSidebar
              newJobCount={assignedCount}
              unreadNotificationCount={unreadCount}
            />
          }
        >
          <PanelReadNotice areas={unreadableAreas} />
          {children}
        </PanelShell>
      </PainterRealtimeShell>
    </LocaleProvider>
  );
}
