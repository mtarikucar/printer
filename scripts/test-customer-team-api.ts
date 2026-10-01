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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import enDict from "../src/lib/i18n/dictionaries/en";
import trDict from "../src/lib/i18n/dictionaries/tr";

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


// ─── T-5 · SALT OKUNUR TAKIM SİPARİŞİ UÇLARI ────────────────────────────────
//
// Bu iki uç ROUTE_TABLE'da DEĞİL ve bu bilinçli: o tablonun döngüsü "para
// tablolarına dokunmuyor" iddiasını TANIMLAYICI düzeyinde ölçüyor, bu uçlar ise
// `orders`/`quote_checkouts`u OKUMAK zorunda (görünürlük `quotes.order_id` ⋈
// `quotes.team_id` üzerinden türetiliyor; tasarım §0, kolon eklenmedi). Ayrı
// tablo, okumayı yasaklamadan YAZMAYI yasaklamanın tek yolu.

const ORDERS_ROUTE_TABLE: Array<{ rel: string; methods: string[] }> = [
  { rel: "src/app/api/customer/team/orders/route.ts", methods: ["GET"] },
  { rel: "src/app/api/customer/team/orders/[orderNumber]/route.ts", methods: ["GET"] },
];

console.log("\ndeğişmez 3 · takım siparişleri SALT OKUNUR (yalnız GET)");
for (const row of ORDERS_ROUTE_TABLE) {
  const exported = exportedMethods(row.rel);
  // MUTASYON SINAVI: detay ucuna boş bir `POST` ekle → bu iddia KIRMIZI.
  ok(`${row.rel} → yalnız GET`, same(exported, row.methods), {
    beklenen: row.methods,
    gelen: exported,
  });
}

console.log("\ndeğişmez 3 · sipariş EYLEM uçları HİÇ açılmadı");
for (const row of ORDERS_ROUTE_TABLE) {
  const text = read(row.rel);
  const ids = identifiers(row.rel);
  // Yazma fiili YOK: okuma `db.select` ile, `insert`/`update`/`delete` ile
  // değil. (Sözleşmenin tarafı ödeyendir; takım yalnız okur.)
  for (const write of ["insert", "update", "delete", "transaction"]) {
    ok(`${row.rel}: \`${write}\` çağırmıyor`, !ids.has(write));
  }
  // `/api/customer/orders/**` ailesinin HİÇBİR parçası import edilmiyor: ayrı
  // uç olmasının tek sebebi o kapıyı hiç açmamak. İddia İMPORT yollarına bakar,
  // metne değil — dosyanın kendi gerekçesi ("`order-refund`a dokunmuyoruz") bir
  // metin aramasıyla kendi testini kırardı.
  const imports = stringLiterals(row.rel).filter(
    (lit) => lit.startsWith("@/") || lit.startsWith(".")
  );
  for (const forbidden of ["dispute-resolution", "order-refund", "gift-credit-return"]) {
    ok(
      `${row.rel}: \`${forbidden}\` import etmiyor`,
      imports.every((path) => !path.includes(forbidden)),
      imports.filter((path) => path.includes(forbidden))
    );
  }
  ok(`${row.rel}: ödeme dondurmasına dokunmuyor`, !ids.has("freezeCheckout"));
  ok(`${row.rel}: taslak tablosuna dokunmuyor`, !ids.has("orderDrafts"));
}

console.log("\ndeğişmez 4 · cevapta KİŞİSEL VERİ yok");
/**
 * Yorumları ve metin sabitlerini SİLMİŞ kaynak.
 *
 * Gerekçesini yazan bir dosya ("`shippingAddress` göndermiyoruz") ham bir metin
 * aramasıyla kendi testini kırardı; aranan şey GERÇEK bir alan okuması.
 */
function codeOf(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

for (const row of ORDERS_ROUTE_TABLE) {
  const ids = identifiers(row.rel);
  const code = codeOf(row.rel);
  // ÖDEYENİN kimliği ve TESLİMAT ADRESİ okunmaz bile: `orders.<alan>` bir
  // kolon seçimidir ve seçilmeyen kolon gövdeye giremez. (`session.userId`
  // yasaklanamaz — üyelik sorgusunun girdisi o.)
  for (const column of ["userId", "shippingAddress", "customerName", "phone", "email"]) {
    ok(`${row.rel}: \`orders.${column}\` okumuyor`, !code.includes(`orders.${column}`));
  }
  // `users` tablosu HİÇ import edilmiyor: üyenin adı/adresi bu uçların işi değil.
  ok(`${row.rel}: \`users\` tablosuna hiç bakmıyor`, !ids.has("users"));
  // Depolama ANAHTARLARI ve dosya adı da gitmez: imzalı adres yalnız
  // `getPublicUrl` ile, yalnız dosyayı indirecek yüzeyde üretilir.
  for (const key of ["canonicalStlKey", "thumbnailKey", "drawingKey", "fileName"]) {
    ok(`${row.rel}: \`${key}\` sızdırmıyor`, !code.includes(key));
  }
}

console.log("\ndeğişmez 5 · takım sipariş uçları da bayrak kapısının ardında");
for (const row of ORDERS_ROUTE_TABLE) {
  const text = read(row.rel);
  const gates = [...text.matchAll(/teamsEnabled\(null\)/g)];
  ok(`${row.rel}: her yöntemin KENDİ bayrak kapısı var`, gates.length === row.methods.length, {
    kapı: gates.length,
    yöntem: row.methods.length,
  });
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

// ─── T-5 · SÖZLÜK: iki dosya, aynı küme, her kod için bir cümle ─────────────

console.log("\nsözlük · `instantQuote.team.*` iki sözlükte de BİREBİR aynı");
const TEAM_PREFIX = "instantQuote.team.";
const teamKeys = (dict: Record<string, string>) =>
  Object.keys(dict).filter((k) => k.startsWith(TEAM_PREFIX)).sort();
const trTeam = teamKeys(trDict as Record<string, string>);
const enTeam = teamKeys(enDict as Record<string, string>);
ok(`tr.ts ${trTeam.length} anahtar taşıyor`, trTeam.length > 50, trTeam.length);
ok("iki sözlük AYNI anahtar kümesini taşıyor", same(trTeam, enTeam), {
  yalnizTr: trTeam.filter((k) => !enTeam.includes(k)),
  yalnizEn: enTeam.filter((k) => !trTeam.includes(k)),
});
ok(
  "hiçbir yeni anahtar `Kurus` ile bitmiyor (para alanı değil, metin)",
  trTeam.every((k) => !k.endsWith("Kurus"))
);
ok(
  "her cümle DOLU (iki sözlükte de)",
  trTeam.every(
    (k) =>
      (trDict as Record<string, string>)[k].trim().length > 0 &&
      (enDict as Record<string, string>)[k].trim().length > 0
  )
);

console.log("\nsözlük · her HATA KODUNUN bir cümlesi var (ham kod ekrana düşmez)");
/**
 * Takım uçlarının (ve çağırdıkları servisin) döndürebileceği KODLARIN TAMAMI.
 *
 * Neden servisi de tarıyor: rota dosyaları yalnız dört kod yazıyor
 * (`team_not_found`, `not_owner`, `rate_limited`, `invalid_body`); geri kalanı
 * `TeamServiceError` ile servisten geliyor ve ekrana AYNI gövdede ulaşıyor.
 * Yalnız rotaları taramak, cümlesi olmayan on dört kodu gözden kaçırırdı.
 *
 * `tsc` bu eşleşmeyi YAKALAMAZ: anahtar EKSİKLİĞİNİ yakalar (en.ts tipin
 * kaynağı), kod ↔ cümle eşleşmesini yakalamaz.
 */
function emittedCodes(rels: string[]): string[] {
  const codes = new Set<string>();
  for (const rel of rels) {
    const text = read(rel);
    for (const m of text.matchAll(/code:\s*"([a-z_]+)"/g)) codes.add(m[1]);
    // `new TeamServiceError(<cümle>, <durum>, "<kod>")` — çok satırlı hâli de.
    for (const m of text.matchAll(/,\s*\d{3},\s*\n?\s*"([a-z_]+)"/g)) codes.add(m[1]);
  }
  return [...codes].sort();
}

const codeSources = [...ROUTE_TABLE.map((r) => r.rel), ...ORDERS_ROUTE_TABLE.map((r) => r.rel), SHARED, SERVICE];
const codes = emittedCodes(codeSources);
ok(`taranan kod sayısı makul (${codes.length})`, codes.length >= 15, codes);
const errorKeys = trTeam
  .filter((k) => k.startsWith(`${TEAM_PREFIX}error.`))
  .map((k) => k.slice(`${TEAM_PREFIX}error.`.length))
  .sort();
// İKİ YÖNLÜ: cümlesi olmayan kod ekranda HAM KOD'a düşer; kodu olmayan cümle
// ÖLÜ METİNDİR. Küme eşitliği ikisini birden kapatır.
ok("kod kümesi ile cümle kümesi BİREBİR", same(codes, errorKeys), {
  cumlesiYok: codes.filter((c) => !errorKeys.includes(c)),
  koduYok: errorKeys.filter((k) => !codes.includes(k)),
});

console.log("\ndeğişmez 1 · takım metni PAZARLAMA yüzeylerine GİRMEDİ");
/**
 * S sevkiyatının bedeli: `/3d-baski` metinleri bayrağı OKUMADIĞI için müşteriye
 * olmayan bir özellik ilan edilmişti (kayıt defteri §"STEP (S5) — METİN BORCU").
 * Takımda aynı hata yapılmıyor: `instantQuote.team.*` anahtarlarının HEPSİ
 * yalnız bayrak kapısının ARKASINDAKİ yüzeylerde çizilir.
 *
 * MUTASYON SINAVI: `3d-baski/sections.tsx`e bir takım cümlesi ekle → KIRMIZI.
 */
const MARKETING_SURFACES = [
  "src/app/3d-baski/sections.tsx",
  "src/app/3d-baski/page.tsx",
  "src/app/3d-baski/landing-uploader.tsx",
  "src/app/3d-baski/pricing-anchors.ts",
  "src/lib/seo/service.ts",
  "src/components/figurunica/sections.tsx",
  "src/components/figurunica/dict.ts",
];
for (const rel of MARKETING_SURFACES) {
  const text = read(rel);
  const hits = [...text.matchAll(/instantQuote\.team\.[\w.]+/g)].map((m) => m[0]);
  ok(`${rel}: takım anahtarı HİÇ geçmiyor`, hits.length === 0, hits);
}
// Footer da kapalı. Dosya adı DESENLE aranıyor (bugün `site-footer.tsx`):
// bileşen yeniden adlandırılırsa iddia sessizce boşa düşmesin — bu yüzden
// listenin BOŞ OLMADIĞI da ölçülüyor.
const footerFiles = readdirSync(join(ROOT, "src/components")).filter((f) => /footer/i.test(f));
ok("footer bileşeni bulundu (iddia boşa düşmedi)", footerFiles.length > 0, footerFiles);
for (const rel of footerFiles) {
  const hits = [...read(join("src/components", rel)).matchAll(/instantQuote\.team\./g)];
  ok(`src/components/${rel}: takım anahtarı HİÇ geçmiyor`, hits.length === 0);
}

console.log(
  failed === 0
    ? "\n✅ customer-team-api: all checks passed"
    : `\n❌ customer-team-api: ${failed} failed`
);
process.exit(failed === 0 ? 0 : 1);
