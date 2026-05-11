import crypto from "node:crypto";

const PAYTR_GET_TOKEN_URL = "https://www.paytr.com/odeme/api/get-token";
const PAYTR_IFRAME_BASE = "https://www.paytr.com/odeme/guvenli";

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
  return {
    merchantId,
    merchantKey,
    merchantSalt,
    testMode: (process.env.PAYTR_TEST_MODE ?? "1") === "1" ? "1" : "0",
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
  const merchantOid = buildMerchantOid(params.orderNumber);
  const paymentAmount = String(params.amountKurus);
  const currency = "TL";
  const noInstallment = "0";
  const maxInstallment = "0";

  const basket = params.basket.map((item) => [
    item.name,
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const form = new URLSearchParams({
    merchant_id: cfg.merchantId,
    user_ip: params.userIp,
    merchant_oid: merchantOid,
    email: params.email,
    payment_amount: paymentAmount,
    paytr_token: paytrToken,
    user_basket: userBasket,
    debug_on: cfg.testMode === "1" ? "1" : "0",
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

  const res = await fetch(PAYTR_GET_TOKEN_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(PAYTR_TOKEN_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`PayTR token request failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { status: string; token?: string; reason?: string };
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
