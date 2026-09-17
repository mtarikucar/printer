import type { AdjustmentSourceKind, PartnerKind, SettlementKind } from "./partner-adjustments";

export type { PartnerKind } from "./partner-adjustments";
export const PAYOUT_STATUS_FILTERS = ["all", "pending", "paid", "netted", "voided"] as const;
export type PayoutStatusFilter = (typeof PAYOUT_STATUS_FILTERS)[number];
export type AdminPayoutListScope = { audience: "admin"; kind: PartnerKind; partnerId?: string };
export type PartnerPayoutListScope = { audience: "partner"; kind: PartnerKind; partnerId: string };
export type PayoutListScope = AdminPayoutListScope | PartnerPayoutListScope;
export interface PayoutListQuery { status: PayoutStatusFilter; limit: number; cursor?: string }

export interface PayoutListBankInfo {
  iban: string | null;
  accountHolder: string | null;
  bankName: string | null;
  pendingIban: string | null;
  ibanReviewPending: boolean;
}
export interface PayoutListEarningLine {
  orderId: string; orderNumber: string; grossKurus: number; commissionKurus: number;
  netKurus: number; status: string; refunded: boolean; createdAt: string;
}
export interface PayoutListAdjustmentLine {
  id: string; orderId: string; netKurus: number; kind: string; reason: string; status: string;
  sourceKind: AdjustmentSourceKind | null; sourceId: string | null;
}
/** Explicit whitelist shared by admin and owner-scoped partner history. */
export interface PayoutListBaseRow {
  id: string; kind: PartnerKind; partnerId: string; name: string;
  totalKurus: number; earningCount: number; adjustmentCount: number;
  status: "pending" | "paid";
  displayStatus: Exclude<PayoutStatusFilter, "all">;
  settlementKind: SettlementKind;
  createdAt: string; paidAt: string | null; voidedAt: string | null;
  /** Exact timestamp without time zone, six fractional digits; never a JS Date cursor. */
  createdAtExact: string;
  reference: string | null; voidReason: string | null; requestedByPartner: boolean;
  expectedFingerprint: string;
  heldNet: number; heldEarningCount: number; heldAdjustmentCount: number;
  blockedReason: string | null;
  earnings: PayoutListEarningLine[];
  adjustments: PayoutListAdjustmentLine[];
}
/** Structurally compatible with the existing admin PayoutRow, plus CSV audit. */
export interface PayoutListAdminRow extends PayoutListBaseRow {
  bank: PayoutListBankInfo;
  adminEmail: string;
  paidBy: string | null;
  voidedBy: string | null;
  voidSnapshot: Record<string, unknown> | null;
}
/** No bank data, operator identities, raw audit snapshot or customer details. */
export type PayoutListPartnerRow = PayoutListBaseRow;
export type PayoutListRow = PayoutListAdminRow | PayoutListPartnerRow;
export type PayoutRowForScope<S extends PayoutListScope> = S extends AdminPayoutListScope ? PayoutListAdminRow : PayoutListPartnerRow;
export interface PayoutPage<S extends PayoutListScope = PayoutListScope> {
  rows: PayoutRowForScope<S>[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PayoutListCursor {
  v: 1; audience: "admin" | "partner"; kind: PartnerKind; status: PayoutStatusFilter;
  partnerId: string | null; lastTimestamp: string; lastId: string;
}
export class PayoutListInputError extends Error {
  readonly status = 400;
  readonly code = "invalid_payout_query";
  constructor(message = "Ödeme listesi filtreleri veya sayfa bilgisi geçersiz. Listeyi yeniden açın.") {
    super(message); this.name = "PayoutListInputError";
  }
}

export type PayoutListParams = URLSearchParams | Record<string, string | string[] | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(): never { throw new PayoutListInputError(); }
const validKind = (value: unknown): value is PartnerKind => value === "manufacturer" || value === "painter";
const validStatus = (value: unknown): value is PayoutStatusFilter => typeof value === "string" && (PAYOUT_STATUS_FILTERS as readonly string[]).includes(value);

export function normalizePayoutListScope<S extends PayoutListScope>(scope: S): S {
  if (!scope || (scope.audience !== "admin" && scope.audience !== "partner") || !validKind(scope.kind)) fail();
  if (Object.keys(scope).some(key => !["audience", "kind", "partnerId"].includes(key))) fail();
  if (scope.audience === "partner" && !scope.partnerId) fail();
  if (scope.partnerId !== undefined && (typeof scope.partnerId !== "string" || !UUID.test(scope.partnerId))) fail();
  return { ...scope, ...(scope.partnerId ? { partnerId: scope.partnerId.toLowerCase() } : {}) };
}

/** Validate calendar fields without Date's millisecond rounding or timezone conversion. */
export function isExactPayoutTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) return false;
  const [year, month, day, hour, minute, second] = [value.slice(0,4),value.slice(5,7),value.slice(8,10),value.slice(11,13),value.slice(14,16),value.slice(17,19)].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month-1] && hour <= 23 && minute <= 59 && second <= 59;
}

function base64url(value: string): string { return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
export function encodePayoutCursor(scope: PayoutListScope, status: PayoutStatusFilter, last: { lastTimestamp: string; lastId: string }): string {
  const normalized = normalizePayoutListScope(scope);
  if (!validStatus(status) || !isExactPayoutTimestamp(last.lastTimestamp) || !UUID.test(last.lastId)) fail();
  const cursor: PayoutListCursor = { v: 1, audience: normalized.audience, kind: normalized.kind, status,
    partnerId: normalized.partnerId ?? null, lastTimestamp: last.lastTimestamp, lastId: last.lastId.toLowerCase() };
  return base64url(JSON.stringify(cursor));
}
export function decodePayoutCursor(value: string, scope: PayoutListScope, status: PayoutStatusFilter): PayoutListCursor {
  const normalized = normalizePayoutListScope(scope);
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  let parsed: unknown;
  try {
    const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    if (base64url(decoded) !== value) fail();
    parsed = JSON.parse(decoded);
  } catch { fail(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail();
  const cursor = parsed as Record<string, unknown>;
  const keys = ["v", "audience", "kind", "status", "partnerId", "lastTimestamp", "lastId"];
  if (Object.keys(cursor).length !== keys.length || Object.keys(cursor).some(key => !keys.includes(key))
    || cursor.v !== 1 || cursor.audience !== normalized.audience || cursor.kind !== normalized.kind || cursor.status !== status
    || cursor.partnerId !== (normalized.partnerId ?? null) || !isExactPayoutTimestamp(cursor.lastTimestamp)
    || typeof cursor.lastId !== "string" || !UUID.test(cursor.lastId)) fail();
  return { ...cursor, lastId: cursor.lastId.toLowerCase() } as unknown as PayoutListCursor;
}

export function validatePayoutListQuery(scope: PayoutListScope, query: PayoutListQuery): { query: PayoutListQuery; cursor: PayoutListCursor | null } {
  normalizePayoutListScope(scope);
  if (!query || Object.keys(query).some(key => !["status", "limit", "cursor"].includes(key))
    || !validStatus(query.status) || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) fail();
  return { query, cursor: query.cursor === undefined ? null : decodePayoutCursor(query.cursor, scope, query.status) };
}

function paramsOf(input: PayoutListParams): Map<string, string> {
  const entries = input instanceof URLSearchParams ? [...input.entries()] : Object.entries(input).filter(([,v]) => v !== undefined);
  const params = new Map<string, string>();
  for (const [key, value] of entries) {
    if (params.has(key) || typeof value !== "string" || !["status", "limit", "cursor", "kind", "tab", "partnerId"].includes(key)) fail();
    params.set(key, value);
  }
  return params;
}

export function parsePayoutListQuery(input: PayoutListParams, scope: PayoutListScope): PayoutListQuery {
  const normalized = normalizePayoutListScope(scope), params = paramsOf(input);
  for (const key of ["kind", "tab"]) if (params.has(key) && params.get(key) !== normalized.kind) fail();
  if (params.has("partnerId") && (normalized.audience !== "admin" || params.get("partnerId")?.toLowerCase() !== normalized.partnerId)) fail();
  const status = params.get("status") ?? (normalized.audience === "admin" ? "pending" : "all");
  const limit = params.get("limit");
  if (!validStatus(status) || (limit !== undefined && !/^[1-9]\d{0,2}$/.test(limit))) fail();
  const query = { status, limit: limit === undefined ? 50 : Number(limit), ...(params.has("cursor") ? { cursor: params.get("cursor")! } : {}) };
  return validatePayoutListQuery(normalized, query).query;
}

export function parsePayoutListRequest(input: PayoutListParams, actor: { audience: "admin" }): { scope: AdminPayoutListScope; query: PayoutListQuery };
export function parsePayoutListRequest(input: PayoutListParams, actor: PartnerPayoutListScope): { scope: PartnerPayoutListScope; query: PayoutListQuery };
export function parsePayoutListRequest(input: PayoutListParams, actor: { audience: "admin" } | PartnerPayoutListScope): { scope: PayoutListScope; query: PayoutListQuery } {
  const params = paramsOf(input);
  const kind = actor.audience === "partner" ? actor.kind : params.get("kind") ?? params.get("tab") ?? "manufacturer";
  if (!validKind(kind)) fail();
  const scope = normalizePayoutListScope(actor.audience === "partner" ? actor : {
    audience: "admin" as const, kind, ...(params.has("partnerId") ? { partnerId: params.get("partnerId")! } : {}),
  });
  return { scope, query: parsePayoutListQuery(input, scope) };
}

export function checkedPayoutInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new RangeError("Payout money/count is not a safe integer");
  return value;
}
export function payoutDisplayStatus(row: { status: "pending" | "paid"; settlementKind: SettlementKind; voidedAt: unknown }): Exclude<PayoutStatusFilter, "all"> {
  return row.voidedAt ? "voided" : row.status === "pending" ? "pending" : row.settlementKind === "netting" ? "netted" : "paid";
}
