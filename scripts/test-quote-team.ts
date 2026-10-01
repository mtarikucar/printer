/**
 * Takım çalışma alanının SAF yetki çekirdeği. DB yok, Redis yok, ağ yok.
 *
 * İMPORT LİSTESİ ÇİVİLİ: yalnız `src/lib/config/quote-team.ts` import edilir
 * (artı `node:assert` / `node:fs` / `node:path` ve `quote-types`tan YALNIZ TİP
 * — `import type` derlemede silinir, yani çalışma zamanında hiçbir modül
 * eklemez). `src/lib/db/schema.ts` yalnız METİN olarak okunur — import edilse
 * drizzle zinciri yüklenirdi ve bu dosya `test:unit` zincirinde veritabanı
 * arayan bir teste dönüşürdü. Matrisin testten çivilenebilmesinin tek yolu
 * çekirdeğin saf kalmasıdır.
 *
 * Kanıtlanan beş şey:
 *
 * 1. RÜTBE ASİMETRİSİ: admin ne sahibi düşürebilir ne kendine eşit bir rütbe
 *    verebilir; sahip rütbesi bu kapıdan hiç verilmez (devir ayrı kapıdır).
 * 2. Sahip AYRILAMAZ: devretmeden takım öksüz kalamaz.
 * 3. PARA KAPISI VARSAYILAN OLARAK DAR: ödemeyi owner/admin yapar, `member`
 *    yalnız takım açıkça izin verdiyse, `viewer` HİÇBİR hâlde yapamaz.
 * 4. Bekleyen ödemeyi `member` yalnız KENDİ başlattıysa iptal edebilir.
 * 5. Eylem listesi iki yerde AYRIŞAMAZ: `schema.ts`teki CHECK listesini
 *    `quoteInList(TEAM_ACTIONS)` üretir, yani liste tek kaynaktan gelir.
 *
 * Ayrıca: T-1'de `team_id` YAZILIYOR ama hiçbir yerde OKUNMUYORDU; T-2 ilk
 * okumayı ekledi, T-3 takım YÖNETİM uçlarını ekledi ve aşağıdaki tarama o yüzden
 * iki kez DARALDI — "hiç kimse okumuyor" iddiası, "yalnız izinli dosyalar
 * okuyor" sayımına dönüştü (gerekçesi listenin başında).
 *
 * Altıncı şey (T-3): DAVET KABULÜNÜN ÖN KOŞULLARI. `inviteAcceptable` altı ret
 * sebebini kapalı bir kümeden döner ve hiçbiri `null`a çökmez — ret sebebi bir
 * KVKK kararı olduğu için her birinin ayrı bir satırı var.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
// Modülün ŞEKLİNİ (neyin ihraç edildiğini) sorgulayan tek iddia için. İsim
// alanı importu BİLEREK statiktir: `await import()` ile yazılmış bir sürüm bu
// dosya tamamen eşzamanlı koştuğu (sonda `process.exit`) için hiç çözülmez ve
// iddia sessizce ÖLÜ kalırdı — ölçüldü: `RANK` ihraç edilmiş hâlde de ✓ basıyordu.
import * as teamCore from "../src/lib/config/quote-team";
import {
  INVITE_REJECTIONS,
  INVITE_TTL_MS,
  TEAM_ACTIONS,
  TEAM_INVITE_ROLES,
  TEAM_ROLES,
  canAssignRole,
  canAttachQuote,
  canCancelCheckout,
  canChatOnQuote,
  canCheckoutQuote,
  canDeleteTeam,
  canDetachQuote,
  canEditTeamProfile,
  canEditTeamQuote,
  canInvite,
  canLeave,
  canRemoveMember,
  canSeeOwnerFields,
  canShareQuote,
  canTransferOwnership,
  inviteAcceptable,
  normalizeTeamEmail,
  type InviteAcceptanceFacts,
  type InviteRejection,
  type TeamRole,
} from "../src/lib/config/quote-team";
import type { QuoteViewer } from "../src/lib/config/quote-types";

const ROOT = join(import.meta.dirname, "..");

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

/**
 * `QuoteViewer` — yedi alan (`isTeam`/`teamRole` T-2'de eklendi, 0072).
 *
 * VARSAYILANLAR SÖNÜK: `isTeam: false`, `teamRole: null`. Böylece aşağıdaki
 * yüklem testleri takım dalı AÇILMADAN ÖNCEKİ cevapları ölçmeye devam eder;
 * dördünün (`canEditTeamQuote` … `canSeeOwnerFields`) takım dalını açması
 * T-4'ün kararıdır.
 */
function viewerOf(fields: {
  isOwner?: boolean;
  isAdmin?: boolean;
  isShare?: boolean;
  canEdit?: boolean;
  canSeePrices?: boolean;
  isTeam?: boolean;
  teamRole?: TeamRole | null;
}): QuoteViewer {
  return {
    canSeePrices: fields.canSeePrices ?? true,
    canEdit: fields.canEdit ?? true,
    isOwner: fields.isOwner ?? false,
    isShare: fields.isShare ?? false,
    isAdmin: fields.isAdmin ?? false,
    isTeam: fields.isTeam ?? false,
    teamRole: fields.teamRole ?? null,
  };
}

console.log("roller ve sabitler");
test("dört rol, kapalı küme, rütbe sırasıyla", () => {
  assert.deepEqual([...TEAM_ROLES], ["owner", "admin", "member", "viewer"]);
});
test("davetle verilebilen roller 'owner'ı DIŞLAR", () => {
  // Sahiplik bir davetin kabulüyle doğmaz: tek sahip kuralı (DB'de kısmi tekil
  // indeks) ancak devir kapısından geçerek değişir.
  assert.deepEqual([...TEAM_INVITE_ROLES], ["admin", "member", "viewer"]);
  assert.ok(!(TEAM_INVITE_ROLES as readonly string[]).includes("owner"));
});
test("davet ömrü yedi gün", () => {
  assert.equal(INVITE_TTL_MS, 7 * 24 * 3600 * 1000);
});
test("rütbe dışa açılmaz — karar veren yüklemlerdir", () => {
  assert.equal(
    (teamCore as Record<string, unknown>).RANK,
    undefined,
    "RANK ihraç edilmiş: rütbe bir uygulama ayrıntısıdır, karar veren yüklemdir"
  );
});

console.log("\nrol atama — rütbe asimetrisi");
test("admin sahibi düşüremez", () => {
  assert.equal(canAssignRole("admin", "owner", "member"), false);
});
test("sahip daha düşük rütbeleri serbestçe değiştirir", () => {
  assert.equal(canAssignRole("owner", "admin", "viewer"), true);
  assert.equal(canAssignRole("owner", "member", "admin"), true);
  assert.equal(canAssignRole("owner", "viewer", "member"), true);
});
test("admin kimseyi KENDİ rütbesine yükseltemez", () => {
  assert.equal(canAssignRole("admin", "member", "admin"), false);
  assert.equal(canAssignRole("admin", "viewer", "member"), true);
});
test("sahiplik bu kapıdan HİÇ verilmez (devir ayrı kapı)", () => {
  for (const actor of TEAM_ROLES) {
    assert.equal(
      canAssignRole(actor, "member", "owner"),
      false,
      `${actor} 'owner' rütbesini atayabiliyor`
    );
  }
  // Tek sahip olduğu için "hedef = owner" demek "hedef = sahibin kendisi"dir:
  // sahip kendini düşürürse takım öksüz kalır ve `canLeave` kapısı boşa düşer.
  assert.equal(canAssignRole("owner", "owner", "admin"), false);
});
test("member ve viewer rol değiştiremez", () => {
  assert.equal(canAssignRole("member", "viewer", "member"), false);
  assert.equal(canAssignRole("viewer", "viewer", "member"), false);
});

console.log("\nüye çıkarma ve ayrılma");
test("sahip çıkarılamaz", () => {
  for (const actor of TEAM_ROLES) {
    assert.equal(canRemoveMember(actor, "owner"), false, `${actor} sahibi çıkarabiliyor`);
  }
});
test("admin yalnız daha düşük rütbeyi çıkarır", () => {
  assert.equal(canRemoveMember("admin", "member"), true);
  assert.equal(canRemoveMember("admin", "viewer"), true);
  assert.equal(canRemoveMember("admin", "admin"), false);
  assert.equal(canRemoveMember("owner", "admin"), true);
  assert.equal(canRemoveMember("member", "viewer"), false);
});
test("sahip AYRILAMAZ — önce devreder", () => {
  assert.equal(canLeave("owner"), false);
  for (const role of ["admin", "member", "viewer"] as const) {
    assert.equal(canLeave(role), true, `${role} ayrılamıyor`);
  }
});

console.log("\npara kapısı — varsayılan olarak DAR");
test("owner ve admin her hâlde ödeyebilir", () => {
  for (const open of [true, false]) {
    assert.equal(canCheckoutQuote("owner", { memberCanCheckout: open }), true);
    assert.equal(canCheckoutQuote("admin", { memberCanCheckout: open }), true);
  }
});
test("member YALNIZ takım açıkça izin verdiyse ödeyebilir", () => {
  assert.equal(canCheckoutQuote("member", { memberCanCheckout: false }), false);
  assert.equal(canCheckoutQuote("member", { memberCanCheckout: true }), true);
});
test("viewer, takım izin verse DE ödeyemez", () => {
  // MUTASYON SINAVI: `canCheckoutQuote`taki `viewer` dalı kaldırılıp tek ölçü
  // `memberCanCheckout` yapılırsa bu iddia KIRMIZI olur.
  assert.equal(canCheckoutQuote("viewer", { memberCanCheckout: true }), false);
  assert.equal(canCheckoutQuote("viewer", { memberCanCheckout: false }), false);
});
test("bekleyen ödemeyi member yalnız KENDİ başlattıysa iptal eder", () => {
  assert.equal(canCancelCheckout("member", "u1", "u1"), true);
  assert.equal(canCancelCheckout("member", "u2", "u1"), false);
  assert.equal(canCancelCheckout("member", null, "u1"), false);
  assert.equal(canCancelCheckout("owner", "u2", "u1"), true);
  assert.equal(canCancelCheckout("admin", "u2", "u1"), true);
  assert.equal(canCancelCheckout("viewer", "u1", "u1"), false);
});
test("teklifi takıma bağlamak/ayırmak aynı kapıdır", () => {
  assert.equal(canAttachQuote("member", "u1", "u1"), true);
  assert.equal(canAttachQuote("member", "u2", "u1"), false);
  assert.equal(canDetachQuote("member", "u1", "u1"), true);
  assert.equal(canDetachQuote("member", "u2", "u1"), false);
  assert.equal(canAttachQuote("viewer", "u1", "u1"), false);
  assert.equal(canDetachQuote("admin", "u2", "u1"), true);
});

console.log("\ntakım yönetimi");
test("davet ve profil yalnız owner/admin", () => {
  assert.deepEqual(TEAM_ROLES.map(canInvite), [true, true, false, false]);
  assert.deepEqual(TEAM_ROLES.map(canEditTeamProfile), [true, true, false, false]);
});
test("takımı silmek ve sahipliği devretmek YALNIZ sahibin", () => {
  assert.deepEqual(TEAM_ROLES.map(canDeleteTeam), [true, false, false, false]);
  assert.deepEqual(TEAM_ROLES.map(canTransferOwnership), [true, false, false, false]);
});

console.log("\nteklif yüzeyi yüklemleri — BUGÜNKÜ davranışa DENK");
test("kişisel sahip bugün olduğu gibi geçer, paylaşım izleyicisi geçmez", () => {
  const owner = viewerOf({ isOwner: true });
  const share = viewerOf({ isShare: true, canEdit: false });
  const admin = viewerOf({ isAdmin: true });
  for (const gate of [canEditTeamQuote, canChatOnQuote, canShareQuote, canSeeOwnerFields]) {
    assert.equal(gate(owner), true, `${gate.name} sahibi reddediyor`);
    assert.equal(gate(share), false, `${gate.name} paylaşım izleyicisine açık`);
    // Admin bu dört kapının BUGÜNKÜ ifadesinde de yok (ölçülen:
    // quote-present.ts:377-378/395, quote-service.ts:1611/1842,
    // api/quotes/[id]/messages/route.ts:27,36). Kapıyı admin'e açmak T-2'yi
    // bir genişleme yapar; bu sevkiyat hiçbir yüzeyi genişletmez.
    assert.equal(gate(admin), false, `${gate.name} admin'i sessizce içeri alıyor`);
  }
});

console.log("\ne-posta normalizasyonu");
test("tek normalizasyon: trim + küçük harf", () => {
  // İki yerde iki türlü normalize edilen bir adres
  // `customer_team_invites_live_uq` tekil indeksini sessizce atlatır: aynı
  // kişiye iki CANLI davet çıkar.
  assert.equal(normalizeTeamEmail(" Ali@Example.COM "), "ali@example.com");
  assert.equal(normalizeTeamEmail("ali@example.com"), "ali@example.com");
  assert.equal(normalizeTeamEmail("\tALI@EXAMPLE.COM\n"), "ali@example.com");
});

console.log("\ndavet kabul ön koşulları — RET SEBEBİ KAPALI BİR KÜMEDİR");
/**
 * `acceptInvite` (T-3, `customer-team.ts`) altı ön koşulu SIRAYLA sorar ve
 * hepsi BU yüklemde durur. Neden saf bir yüklemde: ret sebebi bir KVKK
 * kararıdır (hangi hesap hangi takımın dosyalarını görebilir) ve DB'siz
 * taranabildiği sürece her sebebin kendi kanıtı olur. Servis bu kodları
 * müşteriye giden cümleye ve tasarım §8'deki kod kümesine çevirir.
 */
const NOW = new Date("2026-10-01T12:00:00.000Z");
function facts(over: Partial<InviteAcceptanceFacts> = {}): InviteAcceptanceFacts {
  return {
    revokedAt: null,
    acceptedAt: null,
    expiresAt: new Date(NOW.getTime() + INVITE_TTL_MS),
    inviteEmail: "ali@example.com",
    sessionEmail: "ali@example.com",
    alreadyInTeam: false,
    ...over,
  };
}
/** Her satır: ne bozuk → hangi kod. `null` = kabul edilebilir. */
const ACCEPT_TABLE: Array<[string, Partial<InviteAcceptanceFacts>, InviteRejection | null]> = [
  ["canlı davet, doğru e-posta, takımsız kullanıcı", {}, null],
  ["iptal edilmiş davet", { revokedAt: NOW }, "invite_revoked"],
  ["daha önce kabul edilmiş davet (TEK KULLANIMLIK)", { acceptedAt: NOW }, "invite_used"],
  ["süresi dolmuş davet", { expiresAt: new Date(NOW.getTime() - 1) }, "invite_expired"],
  ["oturum yok: kabul kimliksiz yapılamaz", { sessionEmail: null }, "invite_no_identity"],
  [
    "token'ı ele geçiren BAŞKA hesap",
    { sessionEmail: "veli@example.com" },
    "invite_email_mismatch",
  ],
  ["zaten bir takımda olan kullanıcı", { alreadyInTeam: true }, "already_in_team"],
];
for (const [name, over, want] of ACCEPT_TABLE) {
  test(`${name} → ${want ?? "KABUL"}`, () => {
    assert.equal(inviteAcceptable(facts(over), NOW), want);
  });
}
test("altı ret sebebi AYRI kod döner ve hiçbiri null'a çökmez", () => {
  // MUTASYON SINAVI: e-posta eşleşme kontrolünü kaldır → yukarıdaki
  // `invite_email_mismatch` satırı KIRMIZI olur ve bu iddia da düşer.
  const codes = ACCEPT_TABLE.map(([, , code]) => code).filter((c) => c !== null);
  assert.equal(codes.length, 6, "tablo altı ret vakası taramıyor");
  assert.equal(new Set(codes).size, 6, "iki ret sebebi aynı kodu paylaşıyor");
  assert.deepEqual([...codes].sort(), [...INVITE_REJECTIONS].sort(), "ret kümesi ayrıştı");
});
test("süre sınırı KAPALI uçtur: `expires_at === now` dolmuş sayılır", () => {
  // Fail-closed: eşitlikte kabul etmek, TTL'i bir milisaniye de olsa uzatırdı.
  assert.equal(inviteAcceptable(facts({ expiresAt: NOW }), NOW), "invite_expired");
});
test("sıra DETERMİNİST: iptal edilmiş VE süresi dolmuş davet 'iptal' der", () => {
  // İki sebep birden varsa cevap tek ve aynıdır; yoksa aynı davet iki farklı
  // cümleyle reddedilir ve destek "hangisi" diye sorar.
  assert.equal(
    inviteAcceptable(facts({ revokedAt: NOW, expiresAt: new Date(NOW.getTime() - 1) }), NOW),
    "invite_revoked"
  );
});
test("normalizasyon İKİ TARAFA da uygulanır", () => {
  // `customer_team_invites_live_uq` ve bu kapı AYNI normalizasyonu paylaşmak
  // zorunda: biri küçük harfe indirip diğeri indirmezse davet kabul edilemez.
  assert.equal(
    inviteAcceptable(facts({ inviteEmail: "Ali@X.com", sessionEmail: " ali@x.COM " }), NOW),
    null
  );
  assert.equal(
    inviteAcceptable(facts({ inviteEmail: " ALI@X.COM ", sessionEmail: "ali@x.com" }), NOW),
    null
  );
});

console.log("\neylem listesi tek kaynaktan gelir");
const schemaText = readFileSync(join(ROOT, "src/lib/db/schema.ts"), "utf8");
test("denetim CHECK'i listeyi `quoteInList(TEAM_ACTIONS)` ile kurar", () => {
  assert.match(
    schemaText,
    /check\(\s*"customer_team_actions_action_chk",\s*sql`\$\{t\.action\} IN \(\$\{quoteInList\(TEAM_ACTIONS\)\}\)`/,
    "CHECK listesi elle yazılmış: iki kopya ayrışır ve DB 23514 ile reddeder"
  );
  // Liste GERÇEKTEN bu dosyadan geliyor: import satırı da çivili.
  assert.match(schemaText, /TEAM_ACTIONS,?[\s\S]{0,400}from "\.\.\/config\/quote-team"/);
});
test("rol CHECK'leri de aynı iki listeden türer", () => {
  assert.match(
    schemaText,
    /check\(\s*"customer_team_members_role_chk",\s*sql`\$\{t\.role\} IN \(\$\{quoteInList\(TEAM_ROLES\)\}\)`/
  );
  assert.match(
    schemaText,
    /check\(\s*"customer_team_invites_role_chk",\s*sql`\$\{t\.role\} IN \(\$\{quoteInList\(TEAM_INVITE_ROLES\)\}\)`/
  );
});
test("`customerTeams.quotes` çok-ilişkisinin TERS `one` ucu DURUYOR", () => {
  // drizzle `many()`yi KARŞI tablodaki `one()`dan normalize eder. Ters uç
  // yoksa ilişki ilan edilmiş ama çözülemez olur: ilk `with: { quotes: true }`
  // çağrısı `There is not enough information to infer relation` ile atar ve uç
  // nokta boş gövdeli 500 döner. Ne `tsc` (ilişki tipi geçerli) ne `test:unit`
  // (ilişkisel sorgu yok) bunu görür — ölçüldü: `normalizeRelation` şemanın 161
  // ilişkisinden yalnız bunun için patlıyordu. İddia METİN üzerinden kurulur,
  // çünkü bu dosyanın import listesi çivili (başlıktaki gerekçe).
  const declaresMany = /customerTeamsRelations[\s\S]{0,800}?\bquotes:\s*many\(quotes\)/
    .test(schemaText);
  const declaresOne = /quotesRelations[\s\S]{0,2000}?\bteam:\s*one\(\s*customerTeams\s*,\s*\{\s*fields:\s*\[quotes\.teamId\]\s*,\s*references:\s*\[customerTeams\.id\]\s*\}\s*\)/
    .test(schemaText);
  assert.equal(
    declaresMany && !declaresOne,
    false,
    "`customerTeams.quotes` ilan edilmiş ama `quotesRelations.team` yok: ilişki çözülemez"
  );
  // Bugünkü hâl: ikisi de duruyor. (Biri bilinçli kaldırılırsa yukarıdaki
  // ima zaten yeşil kalır; bu satır sessiz bir gerilemeyi de yakalar.)
  assert.equal(declaresMany, true, "`customerTeams.quotes` çok-ilişkisi kayboldu");
  assert.equal(declaresOne, true, "`quotesRelations.team` ters ucu kayboldu");
});
test("ondört eylem, kapalı küme", () => {
  assert.deepEqual([...TEAM_ACTIONS], [
    "team_created",
    "team_renamed",
    "billing_updated",
    "shipping_updated",
    "invite_sent",
    "invite_revoked",
    "invite_accepted",
    "role_changed",
    "member_removed",
    "member_left",
    "ownership_transferred",
    "quote_attached",
    "quote_detached",
    "checkout_cancelled",
  ]);
});

console.log("\ntakım kolonunu okuyan uçlar SAYILI");
/**
 * T-1'de bu tarama "hiçbir yüzey `team_id` okumuyor" diyordu. T-2 o satırı
 * KASITLA değiştirdi: erişim matrisi artık takım dalını taşıyor. Tarama
 * silinmedi, DARALTILDI — çünkü asıl risk hiç bitmedi: dalın açtığı hak,
 * 22 `viewer.isOwner` kapısına ve müşteri ekranlarına T-4'te TEK TEK kararla
 * girecek. Bugün oraya sızan bir okuma, güvenlik testi olmadan genişletilmiş
 * bir yüzey demektir.
 *
 * Yani liste bir izin değil, bir SAYIMDIR: takım durumunu okuyan uç sayısı
 * üçtür ve üçünün de kendi kanıtı var (`scripts/test-quote-api.ts` K1/K2/K3,
 * `scripts/test-quote-team-db.ts`).
 */
const TEAM_READERS = /team_id|teamId|teamRole|isTeam|customer[-_]team/;
const SURFACES = ["src/app", "src/components"];
const SINGLE_FILES = [
  "src/lib/services/quote-access.ts",
  "src/lib/services/quote-present.ts",
];
/**
 * T-2'nin açtığı üç uç + T-3'ün takım YÖNETİM uçları; buraya bir satır EKLEMEK
 * bir karardır.
 *
 * T-3'ün altı dosyası listeye GİRDİ çünkü bu sevkiyatın konusu tam olarak o:
 * üyelik satırını yazan yol. Üçü de taramanın asıl derdinin DIŞINDA kalıyor —
 * hiçbiri bir TEKLİF yüzeyi değil (`/api/customer/team/**` takımın kendisini
 * yönetir, teklif açmaz, fiyat göstermez, parça listelemez) ve hepsinin kendi
 * kanıtı var: `scripts/test-customer-team-api.ts` (yöntem kümesi, bayrak
 * kapısı, oran limitleri, KVKK) + `scripts/test-quote-team-db.ts` (davet
 * yaşam döngüsü, 26 kontrol).
 *
 * Taramanın koruduğu şey DEĞİŞMEDİ: 22 `viewer.isOwner` kapısı ve müşteri
 * TEKLİF ekranları hâlâ takım durumunu okumuyor; o genişleme T-4'ün kararı.
 */
const TEAM_READERS_ALLOWED = [
  // Erişim matrisinin takım dalı + bayrak/üyelik kabuğu.
  "src/lib/services/quote-access.ts",
  // `PresentedQuote.team` (ad + ödeme anahtarı); paylaşım izleyicisine gitmez.
  "src/lib/services/quote-present.ts",
  // `resolveQuoteViewer`dan GEÇMEYEN ikinci kapı: canlı akış.
  "src/app/api/realtime/quote/[id]/route.ts",
  // T-3 · takım yönetim uçları (tasarım §6.1 tablosu) + ortak cevap çevirisi.
  "src/app/api/customer/team/_shared.ts",
  "src/app/api/customer/team/route.ts",
  "src/app/api/customer/team/invites/route.ts",
  "src/app/api/customer/team/invites/[id]/route.ts",
  "src/app/api/customer/team/invites/accept/route.ts",
  "src/app/api/customer/team/members/[userId]/route.ts",
];
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}${sep}${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}
/** Yol ayırıcısı platforma göre değişir; liste tek biçimde yazılır. */
const posix = (rel: string) => rel.split(sep).join("/");
test("takım durumunu YALNIZ izinli dosyalar okuyor (teklif yüzeyleri DIŞINDA)", () => {
  const allowed = new Set(TEAM_READERS_ALLOWED);
  const leaks: string[] = [];
  for (const rel of [...SURFACES.flatMap(walk), ...SINGLE_FILES]) {
    // `rel` ZATEN depo köküne göredir; `relative(ROOT, rel)` ikinci argümanı
    // cwd'ye göre çözer ve test başka bir dizinden koşulursa anlamsız bir yol
    // basardı. Hata mesajı okunabilir kalsın.
    if (!TEAM_READERS.test(readFileSync(join(ROOT, rel), "utf8"))) continue;
    if (!allowed.has(posix(rel))) leaks.push(posix(rel));
  }
  assert.deepEqual(leaks, [], "takım durumunu okuyan YENİ bir yüzey var — T-4'ün işi sızdı");
});
test("izin listesi BAYATLAMADI: her satır gerçekten okuyor", () => {
  // Liste boşa düşerse tarama sessizce hiçbir şeyi korumaz hâle gelir.
  for (const rel of TEAM_READERS_ALLOWED) {
    assert.ok(
      TEAM_READERS.test(readFileSync(join(ROOT, rel), "utf8")),
      `${rel} artık takım durumu okumuyor — izin satırı düşmeli`
    );
  }
});

console.log(
  failures === 0 ? "\n✅ quote-team: all checks passed" : `\n❌ quote-team: ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
