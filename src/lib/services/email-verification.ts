import crypto from "node:crypto";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Mirrors password-reset.ts: the DB stores only the sha256 hash of the raw
// token emailed out, so a leak of `users` grants no usable verification links.
function newToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_PORT === "465",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
const FROM_EMAIL =
  process.env.SMTP_FROM ?? "Figurunica <siparis@figurunica.com>";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Issue an email-verification token for a user and send the verification link.
 * Safe to call repeatedly (resend) — it overwrites the previous token. No-ops
 * for already-verified users. Never throws on SMTP failure (logs instead).
 */
export async function issueEmailVerification(
  userId: string,
  appUrl: string
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, email: true, fullName: true, emailVerified: true },
  });
  if (!user || user.emailVerified) return;

  const { raw, hash } = newToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  await db
    .update(users)
    .set({
      emailVerificationTokenHash: hash,
      emailVerificationExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const verifyUrl = `${appUrl}/verify-email/${encodeURIComponent(raw)}`;

  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: user.email,
      subject: "E-posta adresinizi doğrulayın — Figurunica",
      text: `Merhaba ${user.fullName},

Figurunica hesabınızı kullanmaya başlamak için e-posta adresinizi doğrulayın. Bağlantı 24 saat içinde geçersiz olur:

${verifyUrl}

Bu hesabı siz oluşturmadıysanız, bu e-postayı yok sayabilirsiniz.

— Figurunica
`,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
        <h2 style="margin:0 0 16px;font-family:'Space Grotesk',serif">E-posta doğrulama</h2>
        <p>Merhaba ${escapeHtml(user.fullName)},</p>
        <p>Hesabınızı kullanmaya başlamak için e-posta adresinizi doğrulayın. Bağlantı <strong>24 saat</strong> içinde geçersiz olur.</p>
        <p style="margin:24px 0">
          <a href="${verifyUrl}" style="background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600">E-postamı doğrula</a>
        </p>
        <p style="font-size:13px;color:#6b7280">Buton çalışmazsa, bu adresi tarayıcınıza yapıştırın:<br><span style="font-family:monospace;word-break:break-all">${verifyUrl}</span></p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="font-size:13px;color:#6b7280">Bu hesabı siz oluşturmadıysanız, bu e-postayı yok sayabilirsiniz.</p>
      </div>`,
    });
  } catch (err) {
    console.error("[email-verification] SMTP send failed for", user.email, err);
  }
}

/**
 * Consume a verification token: mark the matching unexpired user as verified
 * and clear the token. Single-use. Returns the userId on success.
 */
export async function consumeEmailVerification(
  rawToken: string
): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  if (!rawToken) return { ok: false, reason: "invalid_input" };
  const tokenHash = hashToken(rawToken);
  const user = await db.query.users.findFirst({
    where: and(
      eq(users.emailVerificationTokenHash, tokenHash),
      isNotNull(users.emailVerificationExpiresAt),
      gt(users.emailVerificationExpiresAt, new Date())
    ),
    columns: { id: true },
  });
  if (!user) return { ok: false, reason: "invalid_or_expired" };

  await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return { ok: true, userId: user.id };
}
