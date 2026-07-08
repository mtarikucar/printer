import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import {
  verifyPassword,
  createPainterSessionToken,
  setPainterSessionCookie,
} from "@/lib/services/painter-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";

// A valid (bcryptjs $2b$12$) hash of a random throwaway string. Compared against
// when the email is unknown so login timing is constant regardless of whether
// the account exists — closes the user-enumeration oracle.
const DUMMY_PASSWORD_HASH =
  "$2b$12$utgd4Q/94rLXhJkG9wIHVe8LPzCmfhKc6IoCR0lSVPgAv5qADycfC";

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(`painter-login:${ip}`, 10, 15 * 60 * 1000); // 10 per 15 min
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Case-insensitive lookup so 'Foo@x.com' and 'foo@x.com' resolve to the same
    // account (registration also normalizes), preventing duplicate/lockout.
    const painter = await db.query.painters.findFirst({
      where: sql`lower(${painters.email}) = ${String(email).toLowerCase()}`,
    });

    // Always run a bcrypt comparison — even when the email is unknown — so the
    // response time doesn't reveal whether an email is a registered painter.
    const hashToCheck = painter?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const valid = await verifyPassword(password, hashToCheck);
    if (!painter || !valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    if (painter.status === "suspended") {
      return NextResponse.json(
        { error: "Hesabınız askıya alınmıştır. Lütfen destek ile iletişime geçin." },
        { status: 403 }
      );
    }

    if (painter.status === "rejected") {
      return NextResponse.json(
        {
          error:
            "Başvurunuz onaylanmadı. Sonraki adımlar için ekibimiz sizinle iletişime geçecektir.",
        },
        { status: 403 }
      );
    }

    // pending_approval, conditionally_approved and active are all allowed to log
    // in — the painter can view their onboarding status and (if conditionally
    // approved) upload a work sample. The requireActivePainter guard gates the
    // job-action surfaces, so no session is over-privileged here.
    const token = createPainterSessionToken(painter.id, painter.email);
    await setPainterSessionCookie(token);

    return NextResponse.json({
      painter: {
        id: painter.id,
        email: painter.email,
        companyName: painter.companyName,
        status: painter.status,
      },
    });
  } catch (error: unknown) {
    console.error("Painter login failed:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
