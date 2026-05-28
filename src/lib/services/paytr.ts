import crypto from "node:crypto";

const PAYTR_GET_TOKEN_URL = "https://www.paytr.com/odeme/api/get-token";
const PAYTR_IFRAME_BASE = "https://www.paytr.com/odeme/guvenli";
const PAYTR_STATUS_URL = "https://www.paytr.com/odeme/durum-sorgu";

export interface PaytrBasketItem {
  name: string;
  priceTRY: string;
  quantity: number;
}

export interface CreatePaytrTokenParams {
  orderNumber: string;
  email: string;
  amountKurus: number;
  userName: string;
  userAddress: string;
  userPhone: string;
  userIp: string;
  basket: PaytrBasketItem[];
  locale?: string;
  /**
   * Suffix appended to merchant_oid. PayTR requires merchant_oid to be unique
   * per attempt — once they've seen one, future get-token calls with the same
   * value are rejected. On retry, pass an incrementing suffix (e.g. "r1", "r2")
   * so each attempt has a distinct merchant_oid.
   */
  merchantOidSuffix?: string;
}

const PAYTR_TOKEN_TIMEOUT_MS = 10000;

export interface CreatePaytrTokenResult {
  merchantOid: string;
  iframeUrl: string;
  token: string;
  testMode: boolean;
}

function getPaytrConfig() {
  const merchantId = process.env.PAYTR_MERCHANT_ID;
  const merchantKey = process.env.PAYTR_MERCHANT_KEY;
  const merchantSalt = process.env.PAYTR_MERCHANT_SALT;
  if (!merchantId || !merchantKey || !merchantSalt) {
    throw new Error("PayTR credentials are not configured");
  }
  const testMode = (process.env.PAYTR_TEST_MODE ?? "1") === "1" ? "1" : "0";
  // debug_on is a PayTR feature that returns extended diagnostics on errors.
  // It's useful in dev and during prod incident triage independently of test
  // mode. Default tracks test_mode for backward compat.
  const debugOn =
    process.env.PAYTR_DEBUG_ON !== undefined
      ? process.env.PAYTR_DEBUG_ON === "1"
        ? "1"
        : "0"
      : testMode;
  return {
    merchantId,
    merchantKey,
    merchantSalt,
    testMode,
    debugOn,
    timeoutMinutes: process.env.PAYTR_TIMEOUT_MINUTES ?? "30",
  };
}

export function buildMerchantOid(orderNumber: string): string {
  // PayTR requires merchant_oid to be alphanumeric only.
  return orderNumber.replace(/[^a-zA-Z0-9]/g, "");
}

export async function createPaytrToken(
  params: CreatePaytrTokenParams
): Promise<CreatePaytrTokenResult> {
  const cfg = getPaytrConfig();
  // Append the retry suffix (also alphanumeric-stripped) so the resulting
  // merchant_oid is still PayTR-compliant.
  const baseOid = buildMerchantOid(params.orderNumber);
  const suffix = params.merchantOidSuffix
    ? buildMerchantOid(params.merchantOidSuffix)
    : "";
  const merchantOid = baseOid + suffix;
  const paymentAmount = String(params.amountKurus);
  const currency = "TL";
  const noInstallment = "0";
  const maxInstallment = "0";

  // Sanitize basket item names — PayTR parses the base64-decoded JSON server-
  // side and trips on certain characters. We strip control chars and clamp
  // length; product names are short labels in this app so 80 chars is plenty.
  const sanitizeName = (s: string) =>
    s.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 80);

  const basket = params.basket.map((item) => [
    sanitizeName(item.name),
    item.priceTRY,
    item.quantity,
  ]);
  const userBasket = Buffer.from(JSON.stringify(basket)).toString("base64");

  // Hash field order is critical and not the same as the callback hash.
  const hashStr =
    cfg.merchantId +
    params.userIp +
    merchantOid +
    params.email +
    paymentAmount +
    userBasket +
    noInstallment +
    maxInstallment +
    currency +
    cfg.testMode;

  const paytrToken = crypto
    .createHmac("sha256", cfg.merchantKey)
    .update(hashStr + cfg.merchantSalt)
    .digest("base64");

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://figurunica.com"
      : "http://localhost:3000");

  const form = new URLSearchParams({
    merchant_id: cfg.merchantId,
    user_ip: params.userIp,
    merchant_oid: merchantOid,
    email: params.email,
    payment_amount: paymentAmount,
    paytr_token: paytrToken,
    user_basket: userBasket,
    debug_on: cfg.debugOn,
    no_installment: noInstallment,
    max_installment: maxInstallment,
    user_name: params.userName,
    user_address: params.userAddress,
    user_phone: params.userPhone,
    merchant_ok_url: `${appUrl}/track/${params.orderNumber}?payment=success`,
    merchant_fail_url: `${appUrl}/track/${params.orderNumber}?payment=failed`,
    timeout_limit: cfg.timeoutMinutes,
    currency,
    test_mode: cfg.testMode,
    lang: params.locale === "en" ? "en" : "tr",
  });

  // One retry on transient failures — PayTR's token endpoint occasionally
  // 5xx's and a blanket fail would mark the draft permanently failed with no
  // recovery, costing us the customer. We don't retry on 4xx (those are real
  // input errors).
  let lastErr: unknown = null;
  let data: { status: string; token?: string; reason?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Back off before the second attempt regardless of whether the first
    // failed via 5xx (`continue`) or a thrown exception. The previous version
    // only slept on thrown exceptions, so a 5xx → 5xx pattern hit PayTR back-
    // to-back with no delay.
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      const res = await fetch(PAYTR_GET_TOKEN_URL, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(PAYTR_TOKEN_TIMEOUT_MS),
      });

      if (!res.ok) {
        // 4xx → don't retry, propagate. 5xx → retry.
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`PayTR token request failed: HTTP ${res.status}`);
        }
        lastErr = new Error(`PayTR token request failed: HTTP ${res.status}`);
        continue;
      }

      data = (await res.json()) as { status: string; token?: string; reason?: string };
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!data) {
    throw lastErr instanceof Error
      ? lastErr
      : new Error("PayTR token request failed: unknown");
  }
  if (data.status !== "success" || !data.token) {
    throw new Error(`PayTR token request failed: ${data.reason ?? "unknown reason"}`);
  }

  return {
    merchantOid,
    iframeUrl: `${PAYTR_IFRAME_BASE}/${data.token}`,
    token: data.token,
    testMode: cfg.testMode === "1",
  };
}

export interface VerifyPaytrCallbackParams {
  merchantOid: string;
  status: string;
  totalAmount: string;
  hash: string;
}

export function verifyPaytrCallback(params: VerifyPaytrCallbackParams): boolean {
  const cfg = getPaytrConfig();
  // Callback hash uses a DIFFERENT field set and ordering than the token hash.
  // Salt is concatenated inside the string here, not appended outside.
  const expected = crypto
    .createHmac("sha256", cfg.merchantKey)
    .update(
      params.merchantOid + cfg.merchantSalt + params.status + params.totalAmount
    )
    .digest("base64");
  return safeEqual(expected, params.hash);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const PAYTR_STATUS_TIMEOUT_MS = 10000;

export type PaytrStatus = "success" | "waiting" | "failed" | "error";

export interface PaytrStatusResult {
  status: PaytrStatus;
  /** Amount in kuruş when status === "success". */
  paymentAmount: number | null;
  /** Payment instrument (card / eft / etc.) when known. */
  paymentType: string | null;
  /** "1" when PayTR reports the transaction was processed in test mode. */
  testMode: boolean | null;
  /** Failure reason fields when status === "failed". */
  failedReasonCode: string | null;
  failedReasonMsg: string | null;
  /** Raw response body — only kept for logging on unexpected shapes. */
  raw: Record<string, unknown>;
}

/**
 * Query PayTR for the canonical status of a previously created merchant_oid.
 * Used as a fallback when the webhook is delayed, lost (e.g. running on localhost),
 * or when an admin needs to recover a stuck draft.
 *
 * The hash format for this endpoint is different from both the token and callback
 * hashes: HMAC-SHA256(merchant_id + merchant_oid + merchant_salt, merchant_key).
 *
 * Returns a `status: "error"` result on transport / config failures rather than
 * throwing — callers usually want to surface "could not verify, retry later" UX
 * instead of crashing.
 */
export async function queryPaytrTransactionStatus(
  merchantOid: string
): Promise<PaytrStatusResult> {
  const cfg = getPaytrConfig();

  const hashStr = cfg.merchantId + merchantOid + cfg.merchantSalt;
  const paytrToken = crypto
    .createHmac("sha256", cfg.merchantKey)
    .update(hashStr)
    .digest("base64");

  const form = new URLSearchParams({
    merchant_id: cfg.merchantId,
    merchant_oid: merchantOid,
    paytr_token: paytrToken,
  });

  let res: Response;
  try {
    res = await fetch(PAYTR_STATUS_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(PAYTR_STATUS_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`PayTR status query transport error for ${merchantOid}`, err);
    return {
      status: "error",
      paymentAmount: null,
      paymentType: null,
      testMode: null,
      failedReasonCode: null,
      failedReasonMsg: err instanceof Error ? err.message : "transport_error",
      raw: {},
    };
  }

  if (!res.ok) {
    console.error(
      `PayTR status query non-2xx for ${merchantOid}: HTTP ${res.status}`
    );
    return {
      status: "error",
      paymentAmount: null,
      paymentType: null,
      testMode: null,
      failedReasonCode: null,
      failedReasonMsg: `HTTP ${res.status}`,
      raw: {},
    };
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error(`PayTR status query JSON parse failed for ${merchantOid}`, err);
    return {
      status: "error",
      paymentAmount: null,
      paymentType: null,
      testMode: null,
      failedReasonCode: null,
      failedReasonMsg: "bad_json",
      raw: {},
    };
  }

  const status = String(data.status ?? "").toLowerCase();
  const normalized: PaytrStatus =
    status === "success"
      ? "success"
      : status === "waiting"
      ? "waiting"
      : status === "failed"
      ? "failed"
      : "error";

  const paymentAmountStr =
    typeof data.payment_amount === "string" || typeof data.payment_amount === "number"
      ? String(data.payment_amount)
      : null;
  const paymentAmount = paymentAmountStr ? parseInt(paymentAmountStr, 10) : null;

  return {
    status: normalized,
    paymentAmount:
      typeof paymentAmount === "number" && Number.isFinite(paymentAmount)
        ? paymentAmount
        : null,
    paymentType:
      typeof data.payment_type === "string" ? data.payment_type : null,
    testMode:
      typeof data.test_mode === "string" || typeof data.test_mode === "number"
        ? String(data.test_mode) === "1"
        : null,
    failedReasonCode:
      typeof data.failed_reason_code === "string"
        ? data.failed_reason_code
        : typeof data.failed_reason_code === "number"
        ? String(data.failed_reason_code)
        : null,
    failedReasonMsg:
      typeof data.failed_reason_msg === "string" ? data.failed_reason_msg : null,
    raw: data,
  };
}
