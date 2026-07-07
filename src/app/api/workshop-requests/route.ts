import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { workshopRequests } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { verifyTurnstileToken } from "@/lib/services/turnstile";
import { phoneField } from "@/lib/phone";
import { sendWorkshopRequestReceivedEmails } from "@/lib/services/workshop-notify";
import {
  WORKSHOP_VENUE_TYPE_VALUES,
  WORKSHOP_AGE_GROUP_VALUES,
  WORKSHOP_TYPE_VALUES,
  generateWorkshopReference,
} from "@/lib/workshop/constants";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";

// Public lead form: a venue owner requests a Figurunica workshop at their place.
// No auth required (guests welcome); protected by per-IP rate-limit + Turnstile.

// Canonicalize an address for the per-recipient rate-limit KEY only (we still
// store/send to the exact address the user typed). Collapses the aliases that
// resolve to one real inbox — plus-addressing (foo+tag@) and, for Gmail, dots
// (f.o.o@) — so an attacker can't mint unlimited distinct buckets that all
// deliver to the same victim inbox and defeat the per-recipient cap.
function emailRateKey(email: string): string {
  const lower = email.toLowerCase().trim();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

const schema = z.object({
  contactName: z.string().trim().min(2, "Ad soyad gerekli").max(120),
  contactEmail: z.string().trim().email("Geçerli bir e-posta girin").max(160),
  contactPhone: phoneField("TR", "Geçerli bir telefon numarası girin"),
  organizationName: optionalText(160),
  venueType: z.enum(WORKSHOP_VENUE_TYPE_VALUES, {
    message: "Mekân türü seçin",
  }),
  city: z.string().trim().min(1, "İl seçin").max(60),
  district: z.string().trim().min(1, "İlçe seçin").max(60),
  addressLine: z.string().trim().min(5, "Açık adres gerekli").max(500),
  participantCount: z.coerce
    .number()
    .int()
    .min(1, "En az 1 katılımcı")
    .max(1000, "Katılımcı sayısı çok yüksek"),
  ageGroup: z.enum(WORKSHOP_AGE_GROUP_VALUES, { message: "Yaş grubu seçin" }),
  workshopType: z.enum(WORKSHOP_TYPE_VALUES, { message: "Etkinlik türü seçin" }),
  preferredDate: optionalText(40),
  alternativeDate: optionalText(40),
  budgetRange: optionalText(80),
  message: optionalText(2000),
  howHeard: optionalText(160),
  kvkkConsent: z.literal(true, {
    message: "KVKK aydınlatma metnini onaylamanız gerekir",
  }),
  turnstileToken: z.string().optional(),
});

export async function POST(request: NextRequest) {
  // 1) Rate limit per IP: a few submissions per hour is plenty for a real lead.
  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(`workshop-request:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Çok fazla talep gönderildi. Lütfen daha sonra tekrar deneyin." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();

    // 2) Bot check (no-ops in dev when TURNSTILE_SECRET_KEY is unset).
    const turnstileOk = await verifyTurnstileToken(body?.turnstileToken ?? "", ip);
    if (!turnstileOk) {
      return NextResponse.json(
        { error: "Doğrulama başarısız. Sayfayı yenileyip tekrar deneyin." },
        { status: 403 }
      );
    }

    // 3) Validate.
    const data = schema.parse(body);

    // 4) Cross-check il/ilçe against the canonical Turkey dataset.
    if (!PROVINCES.includes(data.city)) {
      return NextResponse.json({ error: "Geçersiz il" }, { status: 400 });
    }
    if (!(DISTRICTS[data.city] ?? []).includes(data.district)) {
      return NextResponse.json({ error: "Geçersiz ilçe" }, { status: 400 });
    }

    // 4b) Per-recipient throttle (independent of IP). The step-1 per-IP limit
    //     can be sidestepped by spoofing X-Forwarded-For when TRUSTED_PROXY_IPS
    //     is unset, so cap how many branded confirmation emails any single
    //     address can be sent — this bounds "email-bomb an arbitrary victim"
    //     amplification regardless of how many IPs an attacker rotates through.
    const normalizedEmail = data.contactEmail.toLowerCase();
    const emailRl = await rateLimitAsync(
      `workshop-request-email:${emailRateKey(data.contactEmail)}`,
      3,
      24 * 60 * 60 * 1000
    );
    if (!emailRl.success) {
      return NextResponse.json(
        {
          error:
            "Bu e-posta için çok fazla talep alındı. Lütfen daha sonra tekrar deneyin.",
        },
        { status: 429 }
      );
    }

    // 5) Attach the logged-in user if there is a session (guests → null).
    const session = await getSessionUser();

    // 6) Pick a unique reference: generate a candidate, verify it's free, and
    //    only keep it once a check has passed — so the reference we insert is
    //    ALWAYS one that passed a collision check (the loop never falls through
    //    with an unverified value). The unique index remains the ultimate
    //    backstop against the astronomically rare check-then-insert race.
    let reference = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = generateWorkshopReference();
      const clash = await db.query.workshopRequests.findFirst({
        where: eq(workshopRequests.reference, candidate),
        columns: { id: true },
      });
      if (!clash) {
        reference = candidate;
        break;
      }
    }
    if (!reference) {
      // Unreachable in practice (6 consecutive collisions over a ~1e9 space).
      return NextResponse.json(
        { error: "Talep gönderilemedi. Lütfen tekrar deneyin." },
        { status: 500 }
      );
    }

    // 7) Persist.
    const [row] = await db
      .insert(workshopRequests)
      .values({
        reference,
        userId: session?.userId ?? null,
        contactName: data.contactName,
        contactEmail: normalizedEmail,
        contactPhone: data.contactPhone,
        organizationName: data.organizationName,
        venueType: data.venueType,
        city: data.city,
        district: data.district,
        addressLine: data.addressLine,
        participantCount: data.participantCount,
        ageGroup: data.ageGroup,
        workshopType: data.workshopType,
        preferredDate: data.preferredDate,
        alternativeDate: data.alternativeDate,
        budgetRange: data.budgetRange,
        message: data.message,
        howHeard: data.howHeard,
        source: "web",
      })
      .returning();

    // 8) Notify (admin alert + requester confirmation) — non-fatal.
    await sendWorkshopRequestReceivedEmails(row).catch((e) =>
      console.error("workshop request emails failed (non-fatal)", e)
    );

    return NextResponse.json({ success: true, reference: row.reference });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Geçersiz form" },
        { status: 400 }
      );
    }
    console.error("Workshop request submission failed:", error);
    return NextResponse.json(
      { error: "Talep gönderilemedi. Lütfen tekrar deneyin." },
      { status: 500 }
    );
  }
}
