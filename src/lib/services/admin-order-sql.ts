import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { orders, orderRefundRecords, orderRefundAllocations } from "@/lib/db/schema";
import { APP_TIME_ZONE } from "@/lib/config/timezone";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";

// Shared SQL fragments for the admin order views: dashboard, analytics, the
// orders list, the manufacturing queue and the admin nav badges. Each page used
// to spell these out itself and they drifted apart. The dashboard counted
// refunded orders as revenue and ignored the havale discount; analytics did
// neither. So the two pages showed different revenue for the same period.
//
// It lives in src/lib, not under one page, because five admin views import it.
// Server components only (it pulls in the Drizzle schema), but it never
// touches the db connection.

/**
 * Cash collected on one order (revenue contract C3): the order amount minus
 * what a gift card paid and minus the havale (bank-transfer) discount, floored
 * at 0. amountKurus is the GROSS price, so subtracting only the gift card
 * overstated every havale order. Cart sub-orders each carry their own prorated
 * gift-card and havale shares (order-draft.ts), so a per-row sum is exact.
 * SQL twin of cashCollectedKurus() in src/lib/config/order-money.ts, which the
 * order page's money breakdown uses; keep the two identical, clamp included.
 */
export const CASH_COLLECTED_KURUS = sql<number>`GREATEST(0, ${orders.amountKurus} - ${orders.giftCardAmountKurus} - ${orders.havaleDiscountKurus})`;

/**
 * Revenue excludes refunded and cancelled orders; unreturned cancellation cash
 * remains a customer liability. Partial returns reduce NET_REVENUE_CASH_KURUS.
 * Matches revenueKurus() in src/lib/config/order-money.ts.
 * paidAt is NOT NULL on every order row, so it only decides which day an order
 * counts on. The old dashboard filtered on `paidAt IS NOT NULL`, which matched
 * every order, refunds included.
 */
export const COUNTS_AS_REVENUE = sql`(${orders.paymentStatus} = 'succeeded'
  AND ${orders.status} <> 'rejected'
  AND NOT EXISTS (SELECT 1 FROM ${orderRefundAllocations}
    WHERE ${orderRefundAllocations.orderId} = ${orders.id} AND ${orderRefundAllocations.kind} = 'cancellation'))`;

// Keep the correlated query in its own SQL fragment. Drizzle's single-table
// SELECT projection strips qualification from columns in the outer fragment.
const ACTUAL_RETURNED_CASH_KURUS = sql<number>`COALESCE((
  SELECT SUM(${orderRefundAllocations.cashKurus})
  FROM ${orderRefundAllocations}
  INNER JOIN ${orderRefundRecords} ON ${orderRefundRecords.id} = ${orderRefundAllocations.refundId}
    AND ${orderRefundRecords.kind} = ${orderRefundAllocations.kind}
  WHERE ${orderRefundAllocations.orderId} = ${orders.id}
    AND ${orderRefundRecords.kind} IN ('refund', 'cancellation')
), 0)`;

/** Current net cash revenue; original collection above remains immutable. */
export const NET_REVENUE_CASH_KURUS = sql<number>`CASE WHEN ${COUNTS_AS_REVENUE} THEN
  ${CASH_COLLECTED_KURUS} - ${ACTUAL_RETURNED_CASH_KURUS} ELSE 0 END`;

/** The same definition in words, shown under every revenue figure. */
export const REVENUE_DEFINITION_TR =
  "Net nakit ciro: ilk nakit tahsilatı − kayıtlı nakit iadeleri. Hediye kartı dönüşü nakit değildir. İade edilmiş ve iptal edilmiş siparişler ciroya sayılmaz; iptalde elde kalan nakit iade yükümlülüğüdür. İadeler ilk satışın döneminden düşülür.";

/**
 * Refund-end-state: a refunded order keeps its status, but every forward
 * action on it is refused server-side. It is no longer work, so the work views
 * (queues, "in progress" buckets, pipeline counts, nav badges) leave it out,
 * and the orders list gives it its own "İade edildi" bucket so it never
 * disappears. The value is REFUNDED_PAYMENT_STATUS from
 * src/lib/config/order-status-policy.ts (a pure module), the same constant
 * isRefunded() and the write guard notRefundedGuard() read, so the rule lives
 * in one place. It goes in as a bound parameter: fine in WHERE and FILTER
 * clauses (every use today), but do not repeat these fragments in a GROUP BY,
 * where the two copies would be different parameters.
 */
export const IS_REFUNDED = sql`${orders.paymentStatus} = ${REFUNDED_PAYMENT_STATUS}`;
export const NOT_REFUNDED = sql`${orders.paymentStatus} <> ${REFUNDED_PAYMENT_STATUS}`;

/**
 * Refunded and still open: not rejected and not delivered. These orders are
 * frozen mid-pipeline, and each one has to be settled by hand with its
 * partner. The dashboard's "İade edildi (açık)" card counts this set and opens
 * the orders list's `refunded_open` bucket, which lists exactly this set. The
 * card used to open the all-refunds bucket, so its number and the list length
 * could differ.
 */
export const REFUNDED_OPEN = sql`(${IS_REFUNDED} AND ${orders.status} NOT IN ('rejected', 'delivered'))`;

/**
 * Paid work nobody is producing yet: approved with no manufacturer, or a paid
 * marketplace order (platform products wait at `paid`, an assignable status,
 * not `approved`). A refund resets an order to exactly this shape
 * (order-refund.ts clears the manufacturer), so refunded orders are excluded
 * explicitly: assigning one is refused.
 */
export const AWAITING_MANUFACTURER = sql`(${NOT_REFUNDED}
  AND (${orders.manufacturerStatus} IS NULL OR ${orders.manufacturerStatus} = 'unassigned')
  AND (
    ${orders.status} = 'approved'
    OR (${orders.orderType} = 'marketplace' AND ${orders.status} = 'paid')
  ))`;

// ── Istanbul day boundaries ─────────────────────────────────────────────────
// Every timestamp column in the schema is `timestamp WITHOUT time zone` and
// holds UTC wall-clock time: drizzle writes Date.toISOString() and reads the
// value back with "+0000" appended, and the database runs in Etc/UTC.
// CURRENT_DATE and a bare date_trunc('day', col) cut days at the SESSION
// zone's midnight, which is 03:00 in Istanbul, so an order paid at 01:30
// counted on the previous day. These fragments convert explicitly (column as
// UTC, then Istanbul), so the answer does not depend on the session zone.
// The zone is APP_TIME_ZONE (src/lib/config/timezone.ts), the one the
// server-side date formatters already use.

const APP_TZ = sql`${APP_TIME_ZONE}::text`;

/** Today's calendar date in Istanbul (a SQL `date`). */
export const ISTANBUL_TODAY = sql`(now() AT TIME ZONE ${APP_TZ})::date`;

/**
 * The instant an Istanbul calendar day starts, as a naive-UTC timestamp, so it
 * compares directly with the raw column. `day` is any SQL expression that
 * casts to `date` (a 'YYYY-MM-DD' parameter, `ISTANBUL_TODAY - 29`, ...).
 */
export function istanbulDayStart(day: SQL): SQL {
  return sql`((((${day})::date)::timestamp AT TIME ZONE ${APP_TZ}) AT TIME ZONE 'UTC')`;
}

/** Start of today, Istanbul time: `col >= ISTANBUL_TODAY_START` means today. */
export const ISTANBUL_TODAY_START = istanbulDayStart(ISTANBUL_TODAY);

/**
 * The first Istanbul calendar day of an "N gün" window (a SQL `date`): the last
 * `days` Istanbul days, today included, so 30 means today and the 29 before it.
 * The dashboard's revenue trend and /admin/analytics both build their window
 * from this pair. With a rolling `now() - N × 24h` window the first day was a
 * partial one, so the two screens' "30 gün" covered different days.
 * The cast keeps the bound parameter an integer, so `date - int` stays plain
 * date arithmetic instead of an ambiguous operator on an untyped parameter.
 */
export function istanbulLastDaysFirstDay(days: number): SQL {
  const back = Math.max(0, Math.trunc(days) - 1);
  return sql`(${ISTANBUL_TODAY} - ${back}::int)`;
}

/** The instant that window opens: Istanbul midnight of its first day. */
export function istanbulLastDaysStart(days: number): SQL {
  return istanbulDayStart(istanbulLastDaysFirstDay(days));
}

/**
 * The Istanbul calendar day of a timestamp column as 'YYYY-MM-DD' text, the
 * key for daily buckets. Text rather than a date or timestamp, because the pg
 * driver reads zoneless values in the Node process's zone and could shift it.
 * Group by the output alias: the zone is a bound parameter, so repeating the
 * expression in GROUP BY would not match the one in SELECT.
 */
export function istanbulDay(column: AnyColumn): SQL<string> {
  return sql<string>`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${APP_TZ}, 'YYYY-MM-DD')`;
}

/**
 * A 'YYYY-MM-DD' bucket key as a Date that prints as that same day. Noon UTC is
 * 15:00 in Istanbul and stays on the same calendar day in every zone within
 * ±12h, so a chart that formats in the browser's local zone agrees as well.
 */
export function dayKeyToDate(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}
