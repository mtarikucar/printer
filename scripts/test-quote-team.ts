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
 *    yalnız takım açıkça izin verdiyse, `viewer` HİÇBİR hâlde yapamaz. Kapının
 *    İKİ girişi (rol düzeyi + izleyici düzeyi) AYNI cevabı verir ve izleyici
 *    düzeyi takımsız teklifte bugünküne DENK kalır (T-4).
 * 4. Bekleyen ödemeyi `member` yalnız KENDİ başlattıysa iptal edebilir — ve o
 *    kapı `member_can_checkout` ayarını HİÇ sormaz.
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
  teamRoleCanCancelCheckout,
  teamRoleCanCheckout,
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
 * VARSAYILANLAR SÖNÜK: `isTeam: false`, `teamRole: null`. Böylece bir yüklem
 * testi takım dalını AÇIKÇA kurmadıkça BUGÜNKÜ (takımsız) cevabı ölçer —
 * T-4'ün açtığı dal, denklik iddialarının hiçbirini sessizce kaydıramaz.
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

console.log("\npara kapısı — varsayılan olarak DAR (ROL düzeyi)");
test("owner ve admin her hâlde ödeyebilir", () => {
  for (const open of [true, false]) {
    assert.equal(teamRoleCanCheckout("owner", { memberCanCheckout: open }), true);
    assert.equal(teamRoleCanCheckout("admin", { memberCanCheckout: open }), true);
  }
});
test("member YALNIZ takım açıkça izin verdiyse ödeyebilir", () => {
  assert.equal(teamRoleCanCheckout("member", { memberCanCheckout: false }), false);
  assert.equal(teamRoleCanCheckout("member", { memberCanCheckout: true }), true);
});
test("viewer, takım izin verse DE ödeyemez", () => {
  // MUTASYON SINAVI: `teamRoleCanCheckout`taki `viewer` dalı kaldırılıp tek ölçü
  // `memberCanCheckout` yapılırsa bu iddia KIRMIZI olur.
  assert.equal(teamRoleCanCheckout("viewer", { memberCanCheckout: true }), false);
  assert.equal(teamRoleCanCheckout("viewer", { memberCanCheckout: false }), false);
});
test("bekleyen ödemeyi member yalnız KENDİ başlattıysa iptal eder", () => {
  assert.equal(teamRoleCanCancelCheckout("member", "u1", "u1"), true);
  assert.equal(teamRoleCanCancelCheckout("member", "u2", "u1"), false);
  assert.equal(teamRoleCanCancelCheckout("member", null, "u1"), false);
  assert.equal(teamRoleCanCancelCheckout("owner", "u2", "u1"), true);
  assert.equal(teamRoleCanCancelCheckout("admin", "u2", "u1"), true);
  assert.equal(teamRoleCanCancelCheckout("viewer", "u1", "u1"), false);
});
test("iptal kapısı `member_can_checkout` AYARINI HİÇ sormaz", () => {
  // Ayar `member`ın ödeme başlatmasının anahtarıdır; başlattığı ödemeyi iptal
  // etmesinin değil. Ayar sonradan kapatılan bir takımda, kendi taslağını
  // iptal edemeyen bir üye hem ödeyemez hem düzenleyemez hâlde kalırdı.
  // (İmza bu yüzden takımı hiç ALMIYOR — iddia doğrudan bunu ölçüyor.)
  assert.equal(teamRoleCanCancelCheckout.length, 3);
});

console.log("\nT-4 · PARA kapısının İZLEYİCİ düzeyi (22 kapının çağırdığı ifade)");
/**
 * `canCheckoutQuote(viewer, team)` — rotaların, ödeme sayfasının ve özet
 * kartının çağırdığı ifade. İki girişi var ve ikisi de ZORUNLU: izleyici
 * (kişisel sahiplik buradan okunur) ve teklifin TAKIMI (ödeme anahtarı
 * oradan). `team === null` = takımsız teklif → ifade bugünküne DENK.
 */
test("takımsız teklifte ifade bugünküne DENK: yalnız kişisel sahip ödeyebilir", () => {
  assert.equal(canCheckoutQuote(viewerOf({ isOwner: true }), null), true);
  assert.equal(canCheckoutQuote(viewerOf({ isAdmin: true }), null), false);
  assert.equal(canCheckoutQuote(viewerOf({ isShare: true, canEdit: false }), null), false);
  assert.equal(canCheckoutQuote(viewerOf({}), null), false);
});
test("takım üyesinin ödeme hakkı ROLDEN ve takımın AYARINDAN gelir", () => {
  for (const open of [true, false]) {
    const team = { memberCanCheckout: open };
    for (const role of ["owner", "admin"] as const) {
      assert.equal(canCheckoutQuote(viewerOf({ isTeam: true, teamRole: role }), team), true);
    }
    assert.equal(
      canCheckoutQuote(viewerOf({ isTeam: true, teamRole: "member" }), team),
      open,
      `member + memberCanCheckout=${open}`
    );
    assert.equal(
      canCheckoutQuote(viewerOf({ isTeam: true, teamRole: "viewer", canEdit: false }), team),
      false,
      "viewer rolü ödeyebiliyor"
    );
  }
});
test("rol VAR ama takım satırı YOK: kapı KAPALI (fail-closed)", () => {
  // `team` ancak erişim kabuğu üyeliği GERÇEKTEN okuduysa gelir (bayrak açık +
  // üyelik satırı duruyor). Rolü okuyup ayarı okumamış bir çağıranın ödemesine
  // izin vermek, `member_can_checkout`u varsayılanıyla (true) uydurmak olurdu.
  assert.equal(canCheckoutQuote(viewerOf({ isTeam: true, teamRole: "owner" }), null), false);
  assert.equal(canCheckoutQuote(viewerOf({ isTeam: true, teamRole: null }), { memberCanCheckout: true }), false);
});
test("izleyici düzeyinde iptal: kişisel sahip + rol + taslağın SAHİBİ", () => {
  const owner = viewerOf({ isOwner: true });
  assert.equal(canCancelCheckout(owner, "u9", "u1"), true, "kişisel sahip kendi teklifinde iptal eder");
  assert.equal(canCancelCheckout(viewerOf({ isAdmin: true }), "u1", "u1"), false);
  assert.equal(canCancelCheckout(viewerOf({ isShare: true, canEdit: false }), "u1", "u1"), false);
  const member = viewerOf({ isTeam: true, teamRole: "member" });
  assert.equal(canCancelCheckout(member, "u1", "u1"), true);
  assert.equal(canCancelCheckout(member, "u2", "u1"), false);
  assert.equal(canCancelCheckout(member, null, "u1"), false);
  assert.equal(canCancelCheckout(viewerOf({ isTeam: true, teamRole: "admin" }), "u2", "u1"), true);
  assert.equal(
    canCancelCheckout(viewerOf({ isTeam: true, teamRole: "viewer", canEdit: false }), "u1", "u1"),
    false
  );
});

console.log("\nT-4 · teklif yüzeyi yüklemlerinin TAKIM dalı");
test("takımın `viewer` rolü OKUR, YAZMAZ", () => {
  // Tasarım §4: düzenleme / sohbet / paylaşım ✓✓✓✗ — sahibe giden ALANLAR ise
  // dört rolde de açık (üye teklifin kime ait olduğunu ve hangi siparişe
  // döndüğünü görmek zorunda, yoksa "yetkisi var ama ekranı yok" olur).
  const readOnly = viewerOf({ isTeam: true, teamRole: "viewer", canEdit: false });
  for (const gate of [canEditTeamQuote, canChatOnQuote, canShareQuote]) {
    assert.equal(gate(readOnly), false, `${gate.name} takımın viewer rolüne açık`);
  }
  assert.equal(canSeeOwnerFields(readOnly), true, "üye belgeye/sohbete ULAŞAMAZ hâle geldi");
});
test("takımın diğer üç rolü dört kapıdan da geçer", () => {
  for (const role of ["owner", "admin", "member"] as const) {
    const viewer = viewerOf({ isTeam: true, teamRole: role });
    for (const gate of [canEditTeamQuote, canChatOnQuote, canShareQuote, canSeeOwnerFields]) {
      assert.equal(gate(viewer), true, `${gate.name} ${role} rolünü reddediyor`);
    }
  }
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
 * T-1'de bu tarama "hiçbir yüzey `team_id` okumuyor" diyordu; T-2 erişim
 * matrisini, T-3 takım yönetim uçlarını açtı, T-4 ise 22 `viewer.isOwner`
 * kapısını TEK TEK yetki yüklemlerine çevirdi. Tarama her turda silinmedi,
 * YENİDEN TANIMLANDI ve bugünkü hâli bir SAYIMDIR:
 *
 *   **Takım durumunu okuyan yüzeylerin listesi BURADA, KAPALI bir küme.**
 *
 * Satır eklemek bir karardır ve kararın bedeli yazılı: listede olmayan bir
 * dosya takım durumunu okumaya başladığı an bu test KIRMIZI olur. Korunan şey,
 * T-4'ten sonra da aynı: 23. bir kapı, güvenlik testi olmadan açılmasın.
 *
 * Regex yalnız kolon/alan adlarını değil YÜKLEM ADLARINI da arıyor
 * (`canCheckoutQuote(`, `canSeeOwnerFields(` …), çünkü T-4'ten sonra bir
 * yüzeyin takım hakkı okuması `quote.team`i hiç yazmadan, yalnız yüklemi
 * çağırarak olur — eski regex bu yüzden kapıların yarısını görmüyordu
 * (ölçüldü: 13 dosyanın yalnız 4'ü eşleşiyordu).
 */
const TEAM_READERS =
  /team_id|teamId|teamRole|isTeam|customer[-_]team|can(?:Checkout|CancelCheckout|SeeOwnerFields|ChatOnQuote|ShareQuote|EditTeamQuote|Attach|Detach)[A-Za-z]*\(/;
const SURFACES = ["src/app", "src/components"];
const SINGLE_FILES = [
  "src/lib/services/quote-access.ts",
  "src/lib/services/quote-present.ts",
];
/**
 * KAPI SAYIMI — her satırın yanında NEYİ okuduğu yazılı.
 *
 * Üç küme var ve üçünün de ayrı kanıtı:
 *
 *  1. T-2'nin erişim/sunum kabuğu + canlı akış ucu
 *     (`scripts/test-quote-api.ts` K1/K2/K3, `scripts/test-quote-team-db.ts`).
 *  2. T-3'ün takım YÖNETİM uçları — hiçbiri bir TEKLİF yüzeyi değil
 *     (`/api/customer/team/**` takımın kendisini yönetir: teklif açmaz, fiyat
 *     göstermez, parça listelemez). Kanıt: `scripts/test-customer-team-api.ts`
 *     + `scripts/test-quote-team-db.ts`.
 *  3. T-4'ün çevirdiği KAPILAR: dört uç, iki sunucu sayfası, dört istemci
 *     bileşeni ve teklifi takıma bağlayan YENİ uç. Kanıt: `test-quote-ui.ts`
 *     (ekran kapıları), `test-quote-checkout-db.ts` (para kapısı),
 *     `test-quote-team-db.ts` (uçlar + sohbet asimetrisi).
 */
const TEAM_READERS_ALLOWED = [
  // ─── T-2 · erişim matrisi ve sunum ───────────────────────────────────────
  // Erişim matrisinin takım dalı + bayrak/üyelik kabuğu (`resolveUserTeam` de
  // burada: "bu kullanıcının takımı" sorusunu listeler ve `createQuote` sorar).
  "src/lib/services/quote-access.ts",
  // `PresentedQuote.team` (ad + ödeme anahtarı); paylaşım izleyicisine gitmez.
  "src/lib/services/quote-present.ts",
  // `resolveQuoteViewer`dan GEÇMEYEN ikinci kapı: canlı akış.
  "src/app/api/realtime/quote/[id]/route.ts",
  // ─── T-3 · takım yönetim uçları (tasarım §6.1 tablosu) ───────────────────
  "src/app/api/customer/team/_shared.ts",
  "src/app/api/customer/team/route.ts",
  "src/app/api/customer/team/invites/route.ts",
  "src/app/api/customer/team/invites/[id]/route.ts",
  "src/app/api/customer/team/invites/accept/route.ts",
  "src/app/api/customer/team/members/[userId]/route.ts",
  // ─── T-4 · teklif kapıları ───────────────────────────────────────────────
  // #6 ödeme (`canCheckoutQuote`) + #7 iptal (kaba kapı; kesin karar serviste).
  "src/app/api/quotes/[id]/checkout/route.ts",
  // #12 hediye kartı ÖN İZLEMESİ — bir FİYAT yüzeyi, ölçü "ödeyebilen".
  "src/app/api/quotes/[id]/gift-card/route.ts",
  // #8 sohbet GET (okuma) + #9 POST (yazma): asimetrik iki yüklem.
  "src/app/api/quotes/[id]/messages/route.ts",
  // #10 okundu damgası — bir OKUMA eylemi.
  "src/app/api/quotes/[id]/messages/read/route.ts",
  // #11 teknik resim indirme: sahip + admin + takım.
  "src/app/api/quotes/[id]/parts/[partId]/drawing/route.ts",
  // T-4'ün YENİ ucu: teklifi takıma bağla / ayır.
  "src/app/api/quotes/[id]/team/route.ts",
  // #14 belge (proforma) sayfası.
  "src/app/teklif/[number]/belge/page.tsx",
  // #13 ödeme sayfası: ödeme yetkisi + fiyat kapısı.
  "src/app/teklif/[number]/odeme/page.tsx",
  // #15 başlık eylemleri (sohbet yuvası + paylaş) ve #16 canlı akış sağlayıcısı.
  "src/app/teklif/[number]/workspace-client.tsx",
  // #17-18 "yeniden teklif al" bantları.
  "src/components/quote/quote-banners.tsx",
  // #19 sohbet paneli: PANEL `canSeeOwnerFields`, YAZMA alanı `canChatOnQuote`.
  "src/components/quote/quote-chat-panel.tsx",
  // #22 belge bağlantısı — belgenin kapısıyla aynı yüklem.
  "src/components/quote/quote-header.tsx",
  // #20 ödeme düğmesi ve #21 onun NEGATİF cümlesi: ikisi tek yüklemin iki yüzü.
  "src/components/quote/quote-summary.tsx",
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
