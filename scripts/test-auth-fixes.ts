/**
 * Fiyat kapısının bağlı olduğu ÜÇ kimlik düzeltmesi.
 *
 * Modal, teklifi görmek isteyen ziyaretçiyi kayıt/giriş uçlarına yollar. O
 * uçlarda üç çıkmaz vardı ve üçü de aynı sonuca çıkıyordu: müşteri teklifini
 * bir daha göremiyordu.
 *   1. Daha önce misafir olarak sipariş vermiş kişi (isGuest, şifresiz):
 *      kayıt 409, giriş "Google ile açılmış", şifre sıfırlama SESSİZCE hiçbir
 *      şey yapmıyordu → hesabına girmenin hiçbir yolu yoktu.
 *   2/3. Kayıt ve giriş e-postayı YAZILDIĞI GİBİ saklıyor/arıyordu; misafir
 *      siparişini açan `resolveOrCreateGuestUser` ise küçük harfe çeviriyor.
 *      "Ahmet@..." ile kaydolan "ahmet@..." ile giremiyordu.
 *
 * Modüller GERÇEK kaynaktan yüklenir, yalnız kenarları (DB, SMTP, oturum
 * çerezi, oran limiti) taklit edilir — testin doğruladığı şey gerçek kodun
 * akışıdır.
 *
 * Çalıştırma: npx tsx scripts/test-auth-fixes.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

// ─── Kenarları taklit eden minik modül yükleyici ────────────────────────────

/**
 * `rel` dosyasını CommonJS'e çevirip verilen taklitlerle çalıştırır.
 * `stubs` içinde olmayan `@/...` içe aktarımları GERÇEK dosyadan gelir.
 */
function loadModule<T>(rel: string, stubs: Record<string, unknown>): T {
  const file = path.resolve(rel);
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const req = createRequire(file);
  const resolveAlias = (name: string): string => {
    const base = path.resolve("src", name.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`alias çözülemedi: ${name}`);
  };
  const exports: Record<string, unknown> = {};
  const localRequire = (name: string) => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    return req(name.startsWith("@/") ? resolveAlias(name) : name);
  };
  new Function("exports", "require", "module", js)(exports, localRequire, { exports });
  return exports as T;
}

// ─── 1. Misafir hesabın şifre sıfırlama çıkmazı ─────────────────────────────

interface FakeUser {
  id: string;
  fullName: string;
  email: string;
  passwordHash: string | null;
  isGuest: boolean;
}

function resetHarness(user: FakeUser | undefined) {
  const mails: Array<{ to: string; subject: string; text: string; html: string }> = [];
  const updates: Array<Record<string, unknown>> = [];
  const columnsAsked: Array<Record<string, boolean>> = [];
  const mod = loadModule<{
    issuePasswordResetToken: (email: string, appUrl: string) => Promise<void>;
  }>("src/lib/services/password-reset.ts", {
    "drizzle-orm": {
      and: (...parts: unknown[]) => parts,
      eq: (col: unknown, val: unknown) => ({ col, val }),
      gt: () => ({}),
      isNotNull: () => ({}),
    },
    "nodemailer": {
      createTransport: () => ({
        sendMail: async (m: { to: string; subject: string; text: string; html: string }) => {
          mails.push(m);
        },
      }),
    },
    "@/lib/db": {
      db: {
        query: {
          users: {
            findFirst: async ({ columns }: { columns: Record<string, boolean> }) => {
              columnsAsked.push(columns);
              return user;
            },
          },
        },
        update: () => ({
          set: (values: Record<string, unknown>) => {
            updates.push(values);
            return { where: async () => undefined };
          },
        }),
      },
    },
    "@/lib/db/schema": { users: { id: "users.id", email: "users.email" } },
    "@/lib/services/customer-auth": { hashPassword: async (p: string) => `hash:${p}` },
  });
  return { mod, mails, updates, columnsAsked };
}

const guest: FakeUser = {
  id: "u-guest",
  fullName: "Ayşe Yılmaz",
  email: "ayse@example.com",
  passwordHash: null,
  isGuest: true,
};

test("misafir hesap şifre sıfırlama isteğinde HESAP SAHİPLENME bağlantısı alır", async () => {
  const h = resetHarness(guest);
  await h.mod.issuePasswordResetToken(guest.email, "https://figurunica.com");

  assert.equal(h.mails.length, 1, "misafire e-posta gitmedi");
  const mail = h.mails[0];
  assert.equal(mail.to, guest.email);
  const link = mail.text.match(/https:\/\/figurunica\.com\/reset-password\/[^\s]+/)?.[0];
  assert.ok(link, `sahiplenme bağlantısı yok: ${mail.text}`);
  assert.match(link, /\?claim=1$/, "bağlantı claim=1 taşımıyor");
  assert.ok(mail.html.includes(link), "HTML gövdede bağlantı yok");
  assert.match(mail.subject, /şifre|hesab/i);
  // Jeton gerçekten yazılmış olmalı; yoksa bağlantı /reset-password'te ölür.
  assert.equal(h.updates.length, 1);
  assert.ok(typeof h.updates[0].passwordResetTokenHash === "string");
  assert.ok(h.updates[0].passwordResetExpiresAt instanceof Date);
  // `isGuest` okunmazsa Google hesabıyla misafir hesap ayırt edilemez.
  assert.equal(h.columnsAsked[0].isGuest, true);
});

test("Google ile açılmış hesaba şifre sıfırlama gönderilmez", async () => {
  const h = resetHarness({ ...guest, id: "u-google", isGuest: false });
  await h.mod.issuePasswordResetToken("google@example.com", "https://figurunica.com");
  assert.equal(h.mails.length, 0, "Google hesabına sıfırlama gitti");
  assert.equal(h.updates.length, 0, "Google hesabına jeton yazıldı");
});

test("şifreli normal hesap eski sıfırlama akışını aynen yaşar", async () => {
  const h = resetHarness({ ...guest, id: "u-normal", passwordHash: "$2b$12$x", isGuest: false });
  await h.mod.issuePasswordResetToken("normal@example.com", "https://figurunica.com");
  assert.equal(h.mails.length, 1);
  const link = h.mails[0].text.match(/https:\/\/figurunica\.com\/reset-password\/[^\s]+/)?.[0];
  assert.ok(link);
  assert.doesNotMatch(link, /claim=1/, "normal sıfırlama sahiplenme bağlantısı oldu");
  assert.equal(h.updates.length, 1);
});

test("hiç kullanıcı yoksa e-posta sızdırılmaz", async () => {
  const h = resetHarness(undefined);
  await h.mod.issuePasswordResetToken("yok@example.com", "https://figurunica.com");
  assert.equal(h.mails.length, 0);
  assert.equal(h.updates.length, 0);
});

// ─── 2/3. Kayıt ve giriş e-postayı küçük harfe indirir ──────────────────────

interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

const nextServerStub = {
  NextResponse: {
    json: (body: Record<string, unknown>, init?: { status?: number }): RouteResult => ({
      status: init?.status ?? 200,
      body,
    }),
  },
};

const authStub = {
  hashPassword: async (p: string) => `hash:${p}`,
  verifyPassword: async (password: string, hash: string) => hash === `hash:${password}`,
  createSessionToken: () => "session-token",
  setSessionCookie: async () => undefined,
};

const rateLimitStub = {
  rateLimitAsync: async () => ({ success: true, remaining: 9 }),
  extractClientIp: () => "203.0.113.7",
};

function authHarness(route: "register" | "login", existing: FakeUser | undefined) {
  const lookups: unknown[] = [];
  const inserted: Array<Record<string, unknown>> = [];
  const rateLimitKeys: string[] = [];
  const mod = loadModule<{ POST: (req: unknown) => Promise<RouteResult> }>(
    `src/app/api/auth/${route}/route.ts`,
    {
      "next/server": nextServerStub,
      "drizzle-orm": { eq: (col: unknown, val: unknown) => ({ col, val }) },
      "@/lib/db/schema": { users: { email: "users.email" } },
      "@/lib/db": {
        db: {
          query: {
            users: {
              findFirst: async ({ where }: { where: unknown }) => {
                lookups.push(where);
                return existing;
              },
            },
          },
          insert: () => ({
            values: (values: Record<string, unknown>) => {
              inserted.push(values);
              return { returning: async () => [{ id: "u-new", ...values }] };
            },
          }),
        },
      },
      "@/lib/services/customer-auth": authStub,
      "@/lib/services/rate-limit": {
        ...rateLimitStub,
        rateLimitAsync: async (key: string) => {
          rateLimitKeys.push(key);
          return { success: true, remaining: 9 };
        },
      },
      "@/lib/i18n/get-request-locale": { getRequestLocale: () => "tr" },
      "@/lib/services/email-verification": { issueEmailVerification: async () => undefined },
      "@/lib/api/route-error": {
        AUTH_ACTION_FAILED_ERROR: { message: "" },
        handleRouteFailure: (e: unknown) => {
          throw e;
        },
      },
    }
  );
  const call = (body: Record<string, unknown>) =>
    mod.POST({ json: async () => body, headers: new Headers() });
  return { call, lookups, inserted, rateLimitKeys };
}

const MIXED_CASE = "  Ahmet@Example.COM ";
const NORMALISED = "ahmet@example.com";

test("kayıt e-postayı kırpıp küçük harfe indirerek arar ve saklar", async () => {
  const h = authHarness("register", undefined);
  const res = await h.call({
    email: MIXED_CASE,
    password: "sifre123",
    fullName: "Ahmet Demir",
    phone: "+905321234567",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((h.lookups[0] as { val: string }).val, NORMALISED, "arama yazıldığı gibi yapıldı");
  assert.equal(h.inserted[0].email, NORMALISED, "e-posta yazıldığı gibi saklandı");
});

test("kayıt, küçük harfli kopyası olan e-postayı ikinci kez açtırmaz", async () => {
  // Normalleştirme olmadan "Ahmet@..." mevcut "ahmet@..." satırını görmez ve
  // aynı kişi için İKİNCİ bir hesap açılır (unique index varsa 500 patlar).
  const h = authHarness("register", { ...guest, email: NORMALISED });
  const res = await h.call({
    email: MIXED_CASE,
    password: "sifre123",
    fullName: "Ahmet Demir",
    phone: "+905321234567",
  });
  assert.equal(res.status, 409);
  assert.equal(h.inserted.length, 0);
});

test("giriş e-postayı küçük harfe indirerek arar ve oran limitini aynı kovaya yazar", async () => {
  const h = authHarness("login", {
    ...guest,
    email: NORMALISED,
    passwordHash: "hash:sifre123",
    isGuest: false,
  });
  const res = await h.call({ email: MIXED_CASE, password: "sifre123" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((h.lookups[0] as { val: string }).val, NORMALISED);
  assert.ok(
    h.rateLimitKeys.includes(`login:email:${NORMALISED}`),
    `oran limiti kovası: ${h.rateLimitKeys.join(", ")}`
  );
});
