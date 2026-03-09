import crypto from "crypto";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n/dictionaries";

const MERCHANT_ID = () => process.env.PAYTR_MERCHANT_ID!;
const MERCHANT_KEY = () => process.env.PAYTR_MERCHANT_KEY!;
const MERCHANT_SALT = () => process.env.PAYTR_MERCHANT_SALT!;

export const PRICES_KURUS: Record<string, number> = {
  kucuk: 99900,
  orta: 139900,
  buyuk: 179900,
};

function getSizeLabel(figurineSize: string, locale: Locale): string {
  const d = getDictionary(locale);
  const key = `paytr.sizeLabel.${figurineSize}` as keyof typeof d;
  return d[key] || d["paytr.sizeLabel.default"];
}

interface GetTokenParams {
  merchantOid: string;
  email: string;
  paymentAmount: number;
  userName: string;
  userAddress: string;
  userPhone: string;
  userIp: string;
  figurineSize: string;
  locale?: Locale;
}

export async function getPaytrToken(params: GetTokenParams): Promise<string> {
  const locale = params.locale || defaultLocale;
  const sizeLabel = getSizeLabel(params.figurineSize, locale);

  const userBasket = Buffer.from(
    JSON.stringify([[sizeLabel, params.paymentAmount / 100, 1]])
  ).toString("base64");

  const noInstallment = "1";
  const maxInstallment = "0";
  const currency = "TL";
  const testMode = process.env.PAYTR_TEST_MODE === "1" ? "1" : "0";

  const hashStr =
    MERCHANT_ID() +
    params.userIp +
    params.merchantOid +
    params.email +
    String(params.paymentAmount) +
    userBasket +
    noInstallment +
    maxInstallment +
    currency +
    testMode +
    MERCHANT_SALT();

  const paytrToken = crypto
    .createHmac("sha256", MERCHANT_KEY())
    .update(hashStr)
    .digest("base64");

  const body = new URLSearchParams({
    merchant_id: MERCHANT_ID(),
    user_ip: params.userIp,
    merchant_oid: params.merchantOid,
    email: params.email,
    payment_amount: String(params.paymentAmount),
    paytr_token: paytrToken,
    user_basket: userBasket,
    debug_on: process.env.PAYTR_DEBUG === "1" ? "1" : "0",
    no_installment: noInstallment,
    max_installment: maxInstallment,
    user_name: params.userName,
    user_address: params.userAddress,
    user_phone: params.userPhone,
    merchant_ok_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/success`,
    merchant_fail_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/cancel`,
    timeout_limit: "30",
    currency: currency,
    test_mode: testMode,
    lang: locale === "tr" ? "tr" : "en",
  });

  const res = await fetch("https://www.paytr.com/odeme/api/get-token", {
    method: "POST",
    body,
  });

  const data = await res.json();

  if (data.status !== "success") {
    throw new Error(`PayTR token error: ${data.reason || "Unknown error"}`);
  }

  return data.token;
}

export function getIframeUrl(token: string): string {
  return `https://www.paytr.com/odeme/guvenli/${token}`;
}

export function verifyCallbackHash(params: {
  merchantOid: string;
  status: string;
  totalAmount: string;
  hash: string;
}): boolean {
  const hashStr =
    params.merchantOid +
    MERCHANT_SALT() +
    params.status +
    params.totalAmount;

  const expectedHash = crypto
    .createHmac("sha256", MERCHANT_KEY())
    .update(hashStr)
    .digest("base64");

  return expectedHash === params.hash;
}
