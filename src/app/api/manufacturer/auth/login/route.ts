import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import {
  verifyPassword,
  createManufacturerSessionToken,
  setManufacturerSessionCookie,
} from "@/lib/services/manufacturer-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";

// A valid (bcryptjs $2b$12$) hash of a random throwaway string. Compared against
// when the email is unknown so login timing is constant regardless of whether
// the account exists — closes the user-enumeration oracle.
const DUMMY_PASSWORD_HASH =
  "$2b$12$utgd4Q/94rLXhJkG9wIHVe8LPzCmfhKc6IoCR0lSVPgAv5qADycfC";

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(`mfr-login:${ip}`, 10, 15 * 60 * 1000); // 10 per 15 min
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
    const manufacturer = await db.query.manufacturers.findFirst({
      where: sql`lower(${manufacturers.email}) = ${String(email).toLowerCase()}`,
    });

    // Always run a bcrypt comparison — even when the email is unknown — so the
    // response time doesn't reveal whether an email is a registered manufacturer.
    const hashToCheck = manufacturer?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const valid = await verifyPassword(password, hashToCheck);
    if (!manufacturer || !valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    if (manufacturer.status === "suspended") {
      return NextResponse.json(
        { error: "Your account has been suspended. Please contact support." },
        { status: 403 }
      );
    }

    if (manufacturer.status === "pending_approval") {
      return NextResponse.json(
        { error: "Your account is pending approval. Please wait for admin activation." },
        { status: 403 }
      );
    }

    if (manufacturer.status === "rejected") {
      return NextResponse.json(
        { error: "Your application was not approved. Our team will contact you regarding next steps." },
        { status: 403 }
      );
    }

    const token = createManufacturerSessionToken(
      manufacturer.id,
      manufacturer.email
    );
    await setManufacturerSessionCookie(token);

    return NextResponse.json({
      manufacturer: {
        id: manufacturer.id,
        email: manufacturer.email,
        companyName: manufacturer.companyName,
        status: manufacturer.status,
      },
    });
  } catch (error: unknown) {
    console.error("Manufacturer login failed:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
