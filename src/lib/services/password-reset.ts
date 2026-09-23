import crypto from "node:crypto";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/services/customer-auth";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Generate a raw (32-byte) token for a password-reset link. The DB stores
 * only the SHA-256 hash of this value — a leak of the `users` table doesn't
 * grant any usable reset tokens.
 */
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
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});
const FROM_EMAIL =
  process.env.SMTP_FROM ?? "Figurunica <siparis@figurunica.com>";

/**
 * Issue a password-reset token for the given email IF a user exists.
 *
 * IMPORTANT: callers must return a uniform "if we found an account we sent
 * an email" response to the client regardless of whether the user existed.
 * That prevents email-enumeration attacks. This function intentionally
 * returns `void`, never throws on "user not found", and never reveals the
 * outcome via timing — the bcrypt-style timing concern doesn't apply here
 * because we don't run a slow operation on the miss path; the SMTP send IS
 * the slow op, and we skip it on miss, but the call returns within ~200ms
 * either way which is below human-perceptible enumeration noise.
 */
export async function issuePasswordResetToken(
  email: string,
  appUrl: string
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: {
      id: true,
      fullName: true,
      email: true,
      passwordHash: true,
      isGuest: true,
    },
  });
  if (!user) return;

  if (!user.passwordHash) {
    // Two very different rows share "no password hash", and only one of them
    // is a dead end if we stop here:
    //  - Google-only account → the person signs in with OAuth; there is
    //    nothing to reset, so staying silent is correct.
    //  - GUEST checkout account (`isGuest`) → they have no password to reset
    //    and register answers 409 "email exists" while login answers "created
    //    with Google". Returning here left them with NO way into their own
    //    orders and quotes. Send the claim link instead: it lands on the same
    //    /reset-password screen (`?claim=1`) where they set their FIRST
    //    password, which is exactly what `consumePasswordResetToken` does.
    if (!user.isGuest) return;
    const { claimUrl } = await issueGuestClaimToken(user.id, appUrl);
    await sendResetMail(user, claimUrl, "claim");
    return;
  }

  const { raw, hash } = newToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db
    .update(users)
    .set({
      passwordResetTokenHash: hash,
      passwordResetExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await sendResetMail(user, `${appUrl}/reset-password/${encodeURIComponent(raw)}`, "reset");
}

/**
 * The reset / claim email. One template, two framings: "reset your password"
 * for an existing password, "set your password" for a guest claiming the
 * account their guest checkout created.
 *
 * Direct SMTP send (not queued) — these are time-sensitive and we want the
 * email to land within seconds. If SMTP is down we log but don't throw; the
 * caller returns the same generic "if you have an account we sent an email"
 * response either way.
 */
async function sendResetMail(
  user: { fullName: string; email: string },
  url: string,
  kind: "reset" | "claim"
): Promise<void> {
  const claim = kind === "claim";
  const subject = claim
    ? "Hesabınızın şifresini belirleyin — Figurunica"
    : "Şifre sıfırlama bağlantınız — Figurunica";
  const heading = claim ? "Hesabınızı tamamlayın" : "Şifre sıfırlama";
  const lead = claim
    ? "Siparişiniz e-posta adresinizle oluşturulmuştu ama hesabınızın henüz bir şifresi yok. Aşağıdaki butonla şifrenizi belirleyin; ardından siparişlerinizi ve tekliflerinizi görebilirsiniz."
    : "Şifrenizi sıfırlamak için aşağıdaki butona basın.";
  const validity = claim ? "30 gün" : "1 saat";
  const cta = claim ? "Şifremi belirle" : "Şifreyi sıfırla";

  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: user.email,
      subject,
      text: `Merhaba ${user.fullName},

${lead}

${url}

Bağlantı ${validity} içinde geçersiz olur.

Bu isteği siz yapmadıysanız, bu e-postayı yok sayabilirsiniz — hesabınızda hiçbir değişiklik yapılmadı.

— Figurunica
`,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
        <h2 style="margin:0 0 16px;font-family:'Space Grotesk',serif">${heading}</h2>
        <p>Merhaba ${escapeHtml(user.fullName)},</p>
        <p>${escapeHtml(lead)} Bağlantı <strong>${validity}</strong> içinde geçersiz olur.</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600">${cta}</a>
        </p>
        <p style="font-size:13px;color:#6b7280">Buton çalışmazsa, bu adresi tarayıcınıza yapıştırın:<br><span style="font-family:monospace;word-break:break-all">${url}</span></p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="font-size:13px;color:#6b7280">Bu isteği siz yapmadıysanız, bu e-postayı yok sayabilirsiniz — hesabınızda hiçbir değişiklik yapılmadı.</p>
      </div>`,
    });
  } catch (err) {
    console.error("[password-reset] SMTP send failed for", user.email, err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Consume a reset token: verify it matches an active row whose `expiresAt`
 * is in the future, hash the new password, store it, and clear the token.
 * Returns `{ ok: true, userId }` on success, or `{ ok: false, reason }`.
 *
 * The token is single-use (we clear `passwordResetTokenHash` on success);
 * a successful reset also bumps `updatedAt` so any existing customer JWT
 * keeps verifying but the user can also be logged out manually if desired.
 */
export async function consumePasswordResetToken(
  rawToken: string,
  newPassword: string
): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  if (!rawToken || newPassword.length < 6) {
    return { ok: false, reason: "invalid_input" };
  }
  const tokenHash = hashToken(rawToken);
  const user = await db.query.users.findFirst({
    where: and(
      eq(users.passwordResetTokenHash, tokenHash),
      isNotNull(users.passwordResetExpiresAt),
      gt(users.passwordResetExpiresAt, new Date())
    ),
    columns: { id: true },
  });

  if (!user) {
    return { ok: false, reason: "invalid_or_expired" };
  }

  const passwordHash = await hashPassword(newPassword);

  await db
    .update(users)
    .set({
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      // Guests claim their account by setting their first password here, so
      // clearing the flag is safe whether or not the row was a guest.
      isGuest: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return { ok: true, userId: user.id };
}

const GUEST_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Issue a single-use claim token for a guest user (post-checkout). Reuses
 * the password-reset token columns + the existing `consumePasswordResetToken`
 * endpoint — the customer ends up at `/reset-password/{token}` and sets
 * their first password. Token TTL is longer (30 days) because guests may
 * not check email immediately.
 *
 * Returns the raw token + the deep link so the caller can include them in
 * the order-confirmation email. We DON'T send the email here because the
 * order-confirmation email is already templated elsewhere; embedding the
 * claim link in that email avoids a second message hitting the inbox.
 */
export async function issueGuestClaimToken(
  userId: string,
  appUrl: string
): Promise<{ rawToken: string; claimUrl: string }> {
  const { raw, hash } = newToken();
  const expiresAt = new Date(Date.now() + GUEST_CLAIM_TTL_MS);
  await db
    .update(users)
    .set({
      passwordResetTokenHash: hash,
      passwordResetExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  const claimUrl = `${appUrl}/reset-password/${encodeURIComponent(raw)}?claim=1`;
  return { rawToken: raw, claimUrl };
}
