/**
 * Takım UÇLARININ SÖZLEŞMESİ — DB yok, sunucu yok, yalnız kaynak ağacı
 * (0072; T-3'te `/api/customer/team/**`, T-4'te `/api/quotes/[id]/team`).
 *
 * NEDEN AYRI BİR TEST (`test-api-contracts.ts` varken): oradaki tarayıcı
 * İSTEMCİDEN uca bakar — `src/app`/`src/components` içindeki her düz
 * `fetch("/api/…", { method })` çağrısının hedefinde o yöntemin GERÇEKTEN dışa
 * açıldığını iddia eder. Bu dosya TERSİNİ yapar: UÇTAN tabloya bakar. İkisi
 * birden olmadan şu iki arıza sessiz kalır:
 *
 *   1. Uç tablodan FAZLA yöntem açar (ör. bir `PUT`) → güvenlik testi olmayan
 *      bir yüzey canlıya gider.
 *   2. Uç tablodan EKSİK yöntem açar → T-5'in düğmesi tarayıcıda 405 alır. Bu
 *      sevkiyatta istemci fetch'i YOK (arayüz T-5'in işi), yani
 *      `test-api-contracts.ts` bugün bu uçlar hakkında hiçbir şey söylemiyor;
 *      tablo ancak burada çivilenebilir.
 *
 * Ayrıca dört DEĞİŞMEZİN statik kanıtı: bayrak kapısı 404 döner (403 DEĞİL),
 * yazan her uç oran limiti çağırır (davet ucu ayrıca Turnstile + alıcı başına
 * ikinci limit), KVKK onayı `z.literal(true)` ile zorunludur, ve bu sevkiyat ne
 * para hattına ne sipariş e-posta altyapısına dokunur.
 *
 * YORUMLAR SAYILMAZ: "para tablosuna yazmıyor" gibi iddialar TANIMLAYICI
 * (identifier) düzeyinde ölçülür, metinde değil. Aksi hâlde kendi gerekçesini
 * yazan bir dosya ("`order_drafts`a yazmaz") kendi testini kırardı.
 *
 * Çalıştırma: npx tsx scripts/test-customer-team-api.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok   ${name}`);
    return;
  }
  failed++;
  console.error(`  FAIL ${name}`);
  if (extra !== undefined) console.error("       ", extra);
}

function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Dosyadaki METİN sabitleri (yorumlar hariç): üretilen adresleri ölçmek için. */
function stringLiterals(rel: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isStringLiteralLike(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(rel));
  return out;
}

/** Dosyada GERÇEKTEN kullanılan tanımlayıcılar (yorumlar ve metinler hariç). */
function identifiers(rel: string): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) out.add(n.text);
    ts.forEachChild(n, visit);
  };
  visit(parse(rel));
  return out;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const same = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** Tasarım §6.1'in tablosu — BİREBİR. Buraya satır eklemek bir KARARDIR. */
const ROUTE_TABLE: Array<{ rel: string; methods: string[] }> = [
  { rel: "src/app/api/customer/team/route.ts", methods: ["GET", "POST", "PATCH", "DELETE"] },
  { rel: "src/app/api/customer/team/invites/route.ts", methods: ["POST", "GET"] },
  { rel: "src/app/api/customer/team/invites/[id]/route.ts", methods: ["DELETE"] },
  { rel: "src/app/api/customer/team/invites/accept/route.ts", methods: ["POST"] },
  { rel: "src/app/api/customer/team/members/[userId]/route.ts", methods: ["PATCH", "DELETE"] },
  // T-4 · teklifi takıma BAĞLA / AYIR. Tablonun tek `/api/quotes/**` satırı ve
  // bu BİLİNÇLİ: uç teklif ailesindedir (`quoteRouteBody` ile `instant_quote`
  // bayrağını da sorar) ama kapıları, cevap çevirisi ve denetim satırı takım
  // sözleşmesine ait — iki şemsiyenin altında durduğu için iki testle birden
  // ölçülüyor. `GET` BİLEREK yok: teklifin takımı `PresentedQuote.team` ile
  // geliyor, ikinci bir okuma ucu aynı gerçeğin ikinci kopyası olurdu.
  { rel: "src/app/api/quotes/[id]/team/route.ts", methods: ["POST", "DELETE"] },
];

const SHARED = "src/app/api/customer/team/_shared.ts";
const SERVICE = "src/lib/services/customer-team.ts";
const NOTIFY = "src/lib/services/customer-team-notify.ts";

/** Dosyanın DIŞA AÇTIĞI HTTP yöntemleri (`export async function GET`). */
function exportedMethods(rel: string): string[] {
  const out: string[] = [];
  for (const statement of parse(rel).statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
    if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (HTTP_METHODS.includes(statement.name.text)) out.push(statement.name.text);
  }
  return out;
}

console.log("yöntem kümesi tasarım §6.1'deki tabloyla BİREBİR");
for (const row of ROUTE_TABLE) {
  const exported = exportedMethods(row.rel);
  ok(`${row.rel} → ${row.methods.join(", ")}`, same(exported, row.methods), {
    beklenen: row.methods,
    gelen: exported,
  });
}

console.log("\ndeğişmez 5 · bayrak kapalıyken uç YOK (404, 403 DEĞİL)");
for (const row of ROUTE_TABLE) {
  const text = read(row.rel);
  const gates = [...text.matchAll(/teamsEnabled\(null\)/g)];
  ok(
    `${row.rel}: her yöntemin KENDİ bayrak kapısı var (${row.methods.length})`,
    gates.length === row.methods.length,
    { kapı: gates.length, yöntem: row.methods.length }
  );
  // Kapının CEVABI ölçülür, varlığı değil: 403 özelliğin VAR olduğunu söyler.
  let allFourOhFour = gates.length > 0;
  for (const gate of gates) {
    const after = text.slice(gate.index ?? 0, (gate.index ?? 0) + 260);
    if (!/status:\s*404/.test(after) || /status:\s*403/.test(after)) allFourOhFour = false;
  }
  ok(`${row.rel}: bayrak kapısı 404 döndürüyor`, allFourOhFour);
  ok(
    `${row.rel}: oturum kapısı (401) bayraktan SONRA`,
    text.indexOf("teamsEnabled") < text.indexOf("teamUnauthorized")
  );
}

console.log("\nR4 · oran limiti, Turnstile ve alıcı başına ikinci limit");
for (const row of ROUTE_TABLE) {
  const text = read(row.rel);
  if (row.methods.every((m) => m === "GET")) continue;
  ok(`${row.rel}: yazan uç rateLimitAsync çağırıyor`, text.includes("rateLimitAsync("));
  ok(
    `${row.rel}: limit anahtarı istemci IP'sinden kuruluyor`,
    text.includes("extractClientIp(request)")
  );
  // Sıra KURALDIR: IP limiti gövde AYRIŞTIRILMADAN önce koşar, yoksa limitin
  // kendisi bir CPU saldırı yüzeyi olur (`api/workshop-requests/route.ts:80`).
  if (text.includes("teamJsonBody(request)")) {
    ok(
      `${row.rel}: IP limiti gövdeden ÖNCE`,
      text.indexOf("rateLimitAsync(") < text.indexOf("teamJsonBody(request)")
    );
  }
}

const invitesRel = "src/app/api/customer/team/invites/route.ts";
const invitesText = read(invitesRel);
ok("davet ucu Turnstile doğruluyor", invitesText.includes("verifyTurnstileToken("));
// MUTASYON SINAVI: davet ucundan e-posta başına limiti kaldır → bu iddia KIRMIZI.
ok(
  "davet ucu İKİ limit anahtarı taşıyor (IP + alıcı e-postası)",
  invitesText.includes("team-invite:ip:") && invitesText.includes("team-invite:email:")
);
ok(
  "alıcı anahtarı takma adları daraltıyor ve adresi açık YAZMIYOR",
  invitesText.includes("inviteEmailRateKey(") &&
    read(SHARED).includes('createHash("sha256")') &&
    read(SHARED).includes("local.replace(")
);
ok(
  "IP limiti Turnstile'dan ÖNCE koşuyor (gövdeden bağımsız kapı önce)",
  invitesText.indexOf("rateLimitAsync(") < invitesText.indexOf("verifyTurnstileToken(")
);

console.log("\nR3 · KVKK onayı zorunlu (takım kurma + davet kabulü)");
// İddia İKİ ADIMLI: uç paylaşılan alanı kullanıyor VE paylaşılan alan
// GERÇEKTEN `z.literal(true)`. Tek adımlı bir arama, alan bir gün
// `z.boolean().optional()`a dönse yeşil kalırdı.
ok(
  "ortak alan `z.literal(true)` (varsayılan olarak onaylı bir hâl YOK)",
  /export const kvkkConsentField = z\.literal\(true/.test(read(SHARED))
);
for (const rel of [
  "src/app/api/customer/team/route.ts",
  "src/app/api/customer/team/invites/accept/route.ts",
]) {
  ok(`${rel}: KVKK onay alanını şemasında taşıyor`, /kvkkConsent: kvkkConsentField/.test(read(rel)));
}
ok(
  "takım kurma onayın SÜRÜMÜNÜ yazıyor",
  identifiers("src/app/api/customer/team/route.ts").has("TEAM_KVKK_NOTICE_VERSION")
);

console.log("\nyetki matrisi SORULUYOR, yeniden YAZILMIYOR");
const serviceIds = identifiers(SERVICE);
for (const predicate of [
  "canInvite",
  "canAssignRole",
  "canRemoveMember",
  "canLeave",
  "canEditTeamProfile",
  "canDeleteTeam",
  "canTransferOwnership",
  "inviteAcceptable",
  "normalizeTeamEmail",
]) {
  ok(`servis \`${predicate}\` yüklemini çağırıyor`, serviceIds.has(predicate));
}
ok(
  "yüklemler SAF modülden geliyor (`src/lib/config/quote-team`)",
  /from "@\/lib\/config\/quote-team"/.test(read(SERVICE))
);
ok("servis rütbeyi KENDİ karşılaştırmıyor (RANK kopyası yok)", !serviceIds.has("RANK"));

console.log("\npara hattı ve sipariş e-posta altyapısı KAPALI");
const MONEY_IDENTIFIERS = ["orderDrafts", "orders", "quoteCheckouts", "freezeCheckout"];
const EMAIL_INFRA = ["enqueueEmail", "EmailJobData", "sendEmail"];
for (const rel of [...ROUTE_TABLE.map((r) => r.rel), SHARED, SERVICE, NOTIFY]) {
  const ids = identifiers(rel);
  const email = EMAIL_INFRA.filter((id) => ids.has(id));
  ok(`${rel}: sipariş e-posta altyapısını kullanmıyor`, email.length === 0, email);
  const money = MONEY_IDENTIFIERS.filter((id) => ids.has(id));
  ok(`${rel}: para tablolarına dokunmuyor`, money.length === 0, money);
}
ok(
  "bildirimler `sendRawEmail` üzerinden gidiyor (şablon kaydı açılmadı)",
  /import \{ escHtml, sendRawEmail \} from "\.\/email"/.test(read(NOTIFY))
);

console.log("\ndeğişmez 8 · bildirimler İŞLEM BİLDİRİMİDİR, ticari ileti değil");
const notifyText = read(NOTIFY);
ok("bildirim modülü `marketingConsent` ARAMIYOR", !identifiers(NOTIFY).has("marketingConsent"));
ok(
  "dosya başı bunun işlem bildirimi olduğunu YAZIYOR",
  notifyText.includes("İŞLEM BİLDİRİMİDİR") && notifyText.includes("İYS")
);
// Terk hatırlatmasının HEDEFİ DEĞİŞMEDİ: ticari ileti onayı kişisel kalıyor.
ok(
  "terk hatırlatması hâlâ yalnız `marketingConsent = true` hedefliyor",
  read("src/lib/services/quote-maintenance.ts").includes("eq(users.marketingConsent, true)")
);

console.log("\ndavet bağlantısının BİÇİMİ ve ham token");
// Adres iddiaları METİN SABİTLERİ üzerinden ölçülür: modülün kendi gerekçesi
// ("`?next=` DEĞİL") bir yorumda duruyor ve metin aramasıyla ölçülse iddia
// kendi belgesine takılırdı.
const notifyLiterals = stringLiterals(NOTIFY);
ok(
  "davet yolu `/takim/davet/<token>`",
  notifyLiterals.some((literal) => literal.includes("/takim/davet/"))
);
ok("ham token adreste kodlanıyor", notifyText.includes("encodeURIComponent(rawToken)"));
// `?redirect=` kullanılır, `?next=` DEĞİL (depo deseni, accounts-ui §0.5).
ok(
  "üretilen hiçbir adres `next=` taşımıyor",
  !notifyLiterals.some((literal) => literal.includes("next=")),
  notifyLiterals.filter((literal) => literal.includes("next="))
);
ok("biçim belgesi `?redirect=`i işaret ediyor", notifyText.includes("?redirect="));
ok(
  "T-5'in giriş yönlendirmesi için biçim tek kaynaktan dışa açık",
  /export function teamInvitePath/.test(notifyText)
);
const rawTokenLines = invitesText.split("\n").filter((line) => line.includes("rawToken"));
ok(
  "ham token davet ucunda TEK yerde geçiyor: e-posta çağrısı",
  rawTokenLines.length === 1 && rawTokenLines[0].includes("rawToken: invite.rawToken"),
  rawTokenLines
);

console.log(
  failed === 0
    ? "\n✅ customer-team-api: all checks passed"
    : `\n❌ customer-team-api: ${failed} failed`
);
process.exit(failed === 0 ? 0 : 1);
