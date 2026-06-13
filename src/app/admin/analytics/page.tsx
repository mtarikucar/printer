export const dynamic = "force-dynamic";

import Link from "next/link";
import { sql, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderDrafts, analyticsEvents, products } from "@/lib/db/schema";

// ── formatting helpers ──────────────────────────────────────────────────────
const fmt = (k: number) =>
  `₺${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtFull = (k: number) =>
  `₺${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => (Number.isFinite(n) ? `%${(n * 100).toFixed(1)}` : "—");
const int = (n: number) => n.toLocaleString("tr-TR");

const RANGES = [
  { days: 7, label: "7 gün" },
  { days: 30, label: "30 gün" },
  { days: 90, label: "90 gün" },
  { days: 0, label: "Tümü" },
];

const FUNNEL_STEPS: { name: string; label: string }[] = [
  { name: "page_view", label: "Ziyaret (oturum)" },
  { name: "view_item", label: "Ürün görüntüleme" },
  { name: "add_to_cart", label: "Sepete ekleme" },
  { name: "begin_checkout", label: "Ödeme adımı" },
  { name: "add_payment_info", label: "Ödeme başlatma" },
  { name: "purchase", label: "Satın alma" },
];

const NET = sql`${orders.amountKurus} - ${orders.giftCardAmountKurus} - ${orders.havaleDiscountKurus}`;

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = RANGES.some((r) => String(r.days) === sp.days) ? Number(sp.days) : 30;
  const start = days > 0 ? new Date(Date.now() - days * 86_400_000) : new Date(0);

  const [
    summaryRows,
    draftRows,
    funnelRows,
    trendRows,
    channelRows,
    campaignRows,
    productSalesRows,
    productEngageRows,
  ] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS c, coalesce(sum(${NET}),0)::bigint AS rev
      FROM ${orders}
      WHERE ${orders.paymentStatus} = 'succeeded' AND ${orders.paidAt} >= ${start}`),
    db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ${orderDrafts.status} = 'confirmed')::int AS confirmed
      FROM ${orderDrafts}
      WHERE ${orderDrafts.createdAt} >= ${start}
        AND ${orderDrafts.paymentMethod} <> 'gift_card_full'`),
    db.execute(sql`
      SELECT ${analyticsEvents.name} AS name,
             count(DISTINCT ${analyticsEvents.sessionId})::int AS sessions,
             count(*)::int AS events
      FROM ${analyticsEvents}
      WHERE ${analyticsEvents.createdAt} >= ${start}
      GROUP BY ${analyticsEvents.name}`),
    db.execute(sql`
      SELECT date_trunc('day', ${orders.paidAt}) AS day,
             count(*)::int AS c, coalesce(sum(${NET}),0)::bigint AS rev
      FROM ${orders}
      WHERE ${orders.paymentStatus} = 'succeeded' AND ${orders.paidAt} >= ${start}
      GROUP BY day ORDER BY day`),
    db.execute(sql`
      SELECT coalesce(${orders.attributionChannel}, 'direct') AS channel,
             count(*)::int AS c, coalesce(sum(${NET}),0)::bigint AS rev
      FROM ${orders}
      WHERE ${orders.paymentStatus} = 'succeeded' AND ${orders.paidAt} >= ${start}
      GROUP BY 1 ORDER BY rev DESC`),
    db.execute(sql`
      SELECT coalesce(${orders.utmSource}, '(direct)') AS source,
             coalesce(${orders.utmCampaign}, '(none)') AS campaign,
             count(*)::int AS c, coalesce(sum(${NET}),0)::bigint AS rev
      FROM ${orders}
      WHERE ${orders.paymentStatus} = 'succeeded' AND ${orders.paidAt} >= ${start}
      GROUP BY 1, 2 ORDER BY rev DESC LIMIT 15`),
    db.execute(sql`
      SELECT ${orders.productId} AS pid, count(*)::int AS purchases,
             coalesce(sum(${NET}),0)::bigint AS rev
      FROM ${orders}
      WHERE ${orders.paymentStatus} = 'succeeded' AND ${orders.paidAt} >= ${start}
        AND ${orders.productId} IS NOT NULL
      GROUP BY 1 ORDER BY rev DESC LIMIT 15`),
    db.execute(sql`
      SELECT ${analyticsEvents.productId} AS pid,
             count(*) FILTER (WHERE ${analyticsEvents.name} = 'view_item')::int AS views,
             count(*) FILTER (WHERE ${analyticsEvents.name} = 'add_to_cart')::int AS atc
      FROM ${analyticsEvents}
      WHERE ${analyticsEvents.createdAt} >= ${start} AND ${analyticsEvents.productId} IS NOT NULL
      GROUP BY 1`),
  ]);

  const summary = summaryRows.rows[0] as { c: number; rev: string };
  const draft = draftRows.rows[0] as { total: number; confirmed: number };
  const orderCount = Number(summary?.c ?? 0);
  const revenue = Number(summary?.rev ?? 0);
  const aov = orderCount > 0 ? revenue / orderCount : 0;

  // Funnel session map.
  const funnel = new Map<string, { sessions: number; events: number }>();
  for (const r of funnelRows.rows as { name: string; sessions: number; events: number }[]) {
    funnel.set(r.name, { sessions: Number(r.sessions), events: Number(r.events) });
  }
  const sessions = funnel.get("page_view")?.sessions ?? 0;
  const atcSessions = funnel.get("add_to_cart")?.sessions ?? 0;
  const purchaseSessions = funnel.get("purchase")?.sessions ?? 0;

  const conversion = sessions > 0 ? orderCount / sessions : NaN;
  const cartAbandon = atcSessions > 0 ? 1 - purchaseSessions / atcSessions : NaN;
  const paymentAbandon =
    draft.total > 0 ? 1 - draft.confirmed / draft.total : NaN;

  // Product performance — merge sales + engagement, resolve titles.
  const sales = productSalesRows.rows as { pid: string; purchases: number; rev: string }[];
  const engage = productEngageRows.rows as { pid: string; views: number; atc: number }[];
  const pidSet = new Set<string>([...sales.map((s) => s.pid), ...engage.map((e) => e.pid)]);
  const titleRows = pidSet.size
    ? await db
        .select({ id: products.id, title: products.title })
        .from(products)
        .where(inArray(products.id, [...pidSet]))
    : [];
  const titles = new Map(titleRows.map((t) => [t.id, t.title]));
  const engageByPid = new Map(engage.map((e) => [e.pid, e]));
  const productPerf = [...pidSet]
    .map((pid) => {
      const s = sales.find((x) => x.pid === pid);
      const e = engageByPid.get(pid);
      const views = Number(e?.views ?? 0);
      const purchases = Number(s?.purchases ?? 0);
      return {
        pid,
        title: titles.get(pid) ?? pid.slice(0, 8),
        views,
        atc: Number(e?.atc ?? 0),
        purchases,
        rev: Number(s?.rev ?? 0),
        cr: views > 0 ? purchases / views : NaN,
      };
    })
    .sort((a, b) => b.rev - a.rev || b.views - a.views)
    .slice(0, 15);

  const trend = (trendRows.rows as { day: string; c: number; rev: string }[]).map((r) => ({
    day: new Date(r.day),
    rev: Number(r.rev),
    c: Number(r.c),
  }));
  const maxRev = Math.max(1, ...trend.map((t) => t.rev));

  const cards = [
    { label: "Ciro (net, ödenmiş)", value: fmt(revenue), hint: fmtFull(revenue) },
    { label: "Sipariş", value: int(orderCount) },
    { label: "Ortalama sepet (AOV)", value: orderCount ? fmt(aov) : "—" },
    { label: "Dönüşüm (sipariş/oturum)", value: pct(conversion) },
    { label: "Sepet terk", value: pct(cartAbandon) },
    { label: "Ödeme terk", value: pct(paymentAbandon) },
  ];

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pazarlama Analitiği</h1>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          {RANGES.map((r) => (
            <Link
              key={r.days}
              href={`/admin/analytics?days=${r.days}`}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                r.days === days ? "bg-white text-gray-900 shadow" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{c.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1" title={c.hint}>
              {c.value}
            </p>
          </div>
        ))}
      </div>

      {/* Revenue trend */}
      <Section title="Ciro trendi">
        {trend.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex items-end gap-1 h-40">
            {trend.map((t, i) => (
              <div key={i} className="flex-1 group relative flex flex-col justify-end">
                <div
                  className="bg-green-500/80 rounded-t hover:bg-green-500 transition-colors"
                  style={{ height: `${Math.max((t.rev / maxRev) * 100, 2)}%` }}
                  title={`${t.day.toLocaleDateString("tr-TR")}: ${fmtFull(t.rev)} · ${t.c} sipariş`}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Funnel */}
      <Section title="Dönüşüm hunisi (oturum bazlı)">
        {sessions === 0 ? (
          <Empty note="Henüz event verisi yok — tag'ler kurulduğunda dolar." />
        ) : (
          <div className="space-y-1.5">
            {FUNNEL_STEPS.map((step) => {
              const s = funnel.get(step.name)?.sessions ?? 0;
              const width = sessions > 0 ? Math.max((s / sessions) * 100, 1) : 0;
              return (
                <div key={step.name} className="flex items-center gap-3">
                  <span className="w-40 text-xs text-gray-600 shrink-0">{step.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-lg h-6 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500/80 rounded-lg flex items-center justify-end pr-2"
                      style={{ width: `${width}%` }}
                    >
                      <span className="text-[10px] font-semibold text-white">{int(s)}</span>
                    </div>
                  </div>
                  <span className="w-14 text-right text-xs font-medium text-gray-500">
                    {pct(sessions > 0 ? s / sessions : NaN)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Channel breakdown */}
        <Section title="Kanal bazlı satış">
          <Table
            head={["Kanal", "Sipariş", "Ciro"]}
            rows={(channelRows.rows as { channel: string; c: number; rev: string }[]).map((r) => [
              r.channel,
              int(Number(r.c)),
              fmt(Number(r.rev)),
            ])}
          />
        </Section>

        {/* Campaign breakdown */}
        <Section title="Kampanya / kaynak bazlı satış">
          <Table
            head={["Kaynak", "Kampanya", "Sip.", "Ciro"]}
            rows={(campaignRows.rows as { source: string; campaign: string; c: number; rev: string }[]).map(
              (r) => [r.source, r.campaign, int(Number(r.c)), fmt(Number(r.rev))]
            )}
          />
        </Section>
      </div>

      {/* Product performance */}
      <Section title="Ürün bazlı performans">
        <Table
          head={["Ürün", "Görüntüleme", "Sepet", "Satış", "Ciro", "Dönüşüm"]}
          rows={productPerf.map((p) => [
            p.title,
            int(p.views),
            int(p.atc),
            int(p.purchases),
            fmt(p.rev),
            pct(p.cr),
          ])}
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">{title}</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-4">{children}</div>
    </div>
  );
}

function Empty({ note }: { note?: string }) {
  return (
    <p className="text-sm text-gray-400 py-6 text-center">
      {note ?? "Bu aralıkta veri yok."}
    </p>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
            {head.map((h, i) => (
              <th key={i} className={`pb-2 font-semibold ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-2 ${
                    ci === 0 ? "text-gray-800 font-medium truncate max-w-[180px]" : "text-right text-gray-600 tabular-nums"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
