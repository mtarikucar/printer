import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import {
  verifyPassword,
  createManufacturerSessionToken,
  setManufacturerSessionCookie,
} from "@/lib/services/manufacturer-auth";
import { rateLimit, extractClientIp } from "@/lib/services/rate-limit";

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const rl = rateLimit(`mfr-login:${ip}`, 10, 15 * 60 * 1000); // 10 per 15 min
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

    const manufacturer = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.email, email),
    });

    if (!manufacturer) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, manufacturer.passwordHash);
    if (!valid) {
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
  } catch (error: any) {
    console.error("Manufacturer login failed:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
