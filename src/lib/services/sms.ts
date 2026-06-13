// Pluggable SMS / WhatsApp sender. Default is a no-op log stub; credential a
// real Turkish provider (Netgsm shown) via env to go live. Manufacturers store
// a `whatsappPhone`; customers a `phone`.

export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}

const stubProvider: SmsProvider = {
  async send(to, message) {
    // Visible in dev logs so the phone-OTP flow is testable without a provider.
    console.log(`[sms stub] → ${to}: ${message}`);
  },
};

/**
 * Netgsm (https://www.netgsm.com.tr) HTTP API. Credentials via env:
 *   NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_HEADER (approved sender header).
 */
class NetgsmProvider implements SmsProvider {
  constructor(
    private usercode: string,
    private password: string,
    private header: string
  ) {}

  async send(to: string, message: string): Promise<void> {
    // Netgsm wants the number without the leading + (e.g. 905321234567).
    const gsmno = to.replace(/^\+/, "");
    const params = new URLSearchParams({
      usercode: this.usercode,
      password: this.password,
      gsmno,
      message,
      msgheader: this.header,
    });
    const res = await fetch(
      "https://api.netgsm.com.tr/sms/send/get/?" + params.toString()
    );
    const body = (await res.text()).trim();
    // "00"/"01"/"02" + msgid = accepted; 20/30/40/70 etc. are errors.
    const code = body.split(/\s+/)[0];
    if (code !== "00" && code !== "01" && code !== "02") {
      throw new Error(`Netgsm send failed: ${body}`);
    }
  }
}

/**
 * Resolve the active SMS provider from env. Falls back to the log stub so local
 * + CI stay green without credentials.
 */
export function getSmsSender(): SmsProvider {
  const { NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_HEADER } = process.env;
  if (NETGSM_USERCODE && NETGSM_PASSWORD && NETGSM_HEADER) {
    return new NetgsmProvider(NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_HEADER);
  }
  return stubProvider;
}

/** Back-compat alias for existing callers. */
export const smsProvider: SmsProvider = {
  async send(to, message) {
    await getSmsSender().send(to, message);
  },
};

/**
 * The phone-OTP generation gate is OFF until the owner explicitly enables it
 * (after crediting an SMS provider), so existing customers aren't locked out
 * before SMS works.
 */
export function isPhoneVerificationRequired(): boolean {
  return process.env.PHONE_VERIFICATION_REQUIRED === "1";
}

// Best-effort send — never throws (a failed SMS must not break the caller's
// main operation, e.g. shipping an order).
export async function sendSms(
  to: string | null | undefined,
  message: string
): Promise<void> {
  if (!to) return;
  try {
    await getSmsSender().send(to, message);
  } catch (err) {
    console.error("sms send failed (non-fatal)", err);
  }
}
