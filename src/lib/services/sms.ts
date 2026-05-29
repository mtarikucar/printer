// Pluggable SMS / WhatsApp sender. Default is a no-op stub; to go live implement
// SmsProvider with Netgsm / Twilio / İletimerkezi and assign `smsProvider`.
// Manufacturers store a `whatsappPhone`; customers a `phone`.

export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}

const stubProvider: SmsProvider = {
  async send(to, message) {
    console.log(`[sms stub] → ${to}: ${message}`);
  },
};

export const smsProvider: SmsProvider = stubProvider;

// Best-effort send — never throws (a failed SMS must not break the caller's
// main operation, e.g. shipping an order).
export async function sendSms(
  to: string | null | undefined,
  message: string
): Promise<void> {
  if (!to) return;
  try {
    await smsProvider.send(to, message);
  } catch (err) {
    console.error("sms send failed (non-fatal)", err);
  }
}
