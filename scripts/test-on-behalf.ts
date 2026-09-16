/**
 * P2-C4 — "Partner adına işlem" kuralları. DB YOK, Redis YOK.
 *
 * Üç şeyi kurala bağlar:
 *
 *  1. GEREKÇE ZORUNLU. Admin tıklaması bir partner hakedişi doğurabildiği için
 *     gerekçesiz işlem kabul edilmez; metin denetim kaydına ve partnerin kendi
 *     zaman çizelgesine yazılır.
 *  2. İADE EDİLMİŞ SİPARİŞTE HİÇBİR ADIM YOK. Okunabilir ret ön okumada, yarışa
 *     kapalı yarısı her UPDATE'in WHERE'inde (notRefundedGuard()).
 *  3. HER ADIM PARTNERİN KENDİ SERVİSİNİ ÇAĞIRIR, KOPYASINI DEĞİL. Asıl mesele
 *     paradır: tutar bu modülde hesaplanmaz, üreticide `manufacturerBaseKurus` +
 *     `accrueEarning`, boyacıda `accruePainterEarning` çağrılır ve hakediş satırı
 *     burada ASLA yazılmaz. Ayrıca her adımın durum kapısı, partnerin kendi
 *     rotasındaki kapının aynısıdır — ikisi ayrışırsa bu test kırılır.
 *
 * Çalıştırma: npx tsx scripts/test-on-behalf.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  MANUFACTURER_ACK_BLOCKED_ACTIONS,
  PAINTER_ACK_BLOCKED_ACTIONS,
} from "../src/lib/config/partner-model-ack";
import {
  ON_BEHALF_ACTIONS,
  PARTNER_ROUTE_ACTION,
  ON_BEHALF_REASON_MIN_LENGTH,
  adminStampNote,
  isOnBehalfAction,
  onBehalfReasonError,
  partnerHoldingOrder,
} from "../src/lib/services/on-behalf";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (!cond) {
    failed++;
    console.error("  FAIL", name, extra ?? "");
  } else console.log("  ok  ", name);
}

const SERVICE = "src/lib/services/on-behalf.ts";
const ROUTE = "src/app/api/admin/orders/[id]/on-behalf/route.ts";
const ADMIN_SHIP = "src/app/api/admin/orders/[id]/ship/route.ts";
const ADMIN_KARGO = "src/app/api/admin/orders/[id]/ship-kargo/route.ts";

// ─── 1. Sözleşme: C4'ün dört adımı ──────────────────────────────────────────
console.log("sözleşme");
ok(
  "ON_BEHALF_ACTIONS tam olarak C4'ün adımları (baskıyı başlat dahil)",
  JSON.stringify([...ON_BEHALF_ACTIONS]) ===
    JSON.stringify(["accept", "start_printing", "printed", "submit_qc", "ship"]),
  ON_BEHALF_ACTIONS
);
// Kabul edilmiş bir sipariş İLERLETİLEBİLMELİ: admin üreticinin adına kabul
// edip baskıyı başlatamazsa sipariş tam da bu mekanizmanın çözmesi gereken
// yerde kilitlenir (admin'in kendi /start-printing ucu üreticili siparişi
// tanımaz).
ok("kabul sonrası ilerletecek adım var", isOnBehalfAction("start_printing"));
ok("isOnBehalfAction tanıdık adımı kabul eder", isOnBehalfAction("submit_qc"));
for (const bad of ["", "SHIP", "decline", "revoke", null, 7, undefined]) {
  ok(`isOnBehalfAction ${JSON.stringify(bad)} reddeder`, !isOnBehalfAction(bad));
}

// ─── 2. Gerekçe zorunlu ─────────────────────────────────────────────────────
console.log("\ngerekçe");
for (const missing of [undefined, null, "", "   ", "\n\t ", 42, {}]) {
  const err = onBehalfReasonError(missing);
  ok(
    `gerekçesiz istek reddedilir: ${JSON.stringify(missing)}`,
    err !== null && err.includes("gerekçe zorunludur"),
    err
  );
}
const shortReason = "a".repeat(ON_BEHALF_REASON_MIN_LENGTH - 1);
ok(
  "barajın altındaki gerekçe reddedilir",
  (onBehalfReasonError(shortReason) ?? "").includes(String(ON_BEHALF_REASON_MIN_LENGTH)),
  onBehalfReasonError(shortReason)
);
ok(
  "yalnız boşlukla uzatılmış gerekçe reddedilir (trim sonrası ölçülür)",
  onBehalfReasonError(`  ${shortReason}     `) !== null
);
ok("baraja eşit gerekçe kabul edilir", onBehalfReasonError("a".repeat(ON_BEHALF_REASON_MIN_LENGTH)) === null);
ok(
  "gerçek bir gerekçe kabul edilir",
  onBehalfReasonError("Üretici telefonda kargoladığını bildirdi, panele giremiyor.") === null
);
ok("baraj metni Türkçe", (onBehalfReasonError("") ?? "").startsWith("Partner adına"));

// Damga: kim, neden.
const stamp = adminStampNote("admin@figurunica.com", "Üretici telefonda bildirdi", "Takip: 123");
ok("damga admin e-postasını taşır", stamp.includes("admin@figurunica.com"), stamp);
ok("damga gerekçeyi taşır", stamp.includes("Üretici telefonda bildirdi"), stamp);
ok("damga 'Admin adına' ile başlar", stamp.startsWith("[Admin adına:"), stamp);

// ─── 3. İşi kim tutuyor ─────────────────────────────────────────────────────
console.log("\nişi tutan partner");
const holder = (o: Partial<Parameters<typeof partnerHoldingOrder>[0]>) =>
  partnerHoldingOrder({
    manufacturerId: null,
    manufacturerStatus: null,
    painterId: null,
    painterStatus: null,
    ...o,
  });
ok("partneri olmayan sipariş: none", holder({}) === "none");
ok("yalnız üretici: manufacturer", holder({ manufacturerId: "m1", manufacturerStatus: "printing" }) === "manufacturer");
ok(
  "boyacıya devredilmiş sipariş boyacınındır (üretici payını çoktan aldı)",
  holder({ manufacturerId: "m1", manufacturerStatus: "shipped", painterId: "p1", painterStatus: "painting" }) === "painter"
);
ok(
  "boyacı durumu 'unassigned' ise iş hâlâ üreticide",
  holder({ manufacturerId: "m1", manufacturerStatus: "qc_approved", painterId: "p1", painterStatus: "unassigned" }) === "manufacturer"
);
ok("boyacı id'si olmayan ama durumu olan satır: none", holder({ painterStatus: "accepted" }) === "none");

// ─── AST yardımcıları ───────────────────────────────────────────────────────
function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function forEachNode(root: ts.Node, fn: (n: ts.Node) => void) {
  const visit = (n: ts.Node) => {
    fn(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
}
function anyNode(root: ts.Node, pred: (n: ts.Node) => boolean): boolean {
  let hit = false;
  forEachNode(root, (n) => {
    if (!hit && pred(n)) hit = true;
  });
  return hit;
}
/** Kod olarak geçen adlar; yorumlar ve dizeler ASLA sayılmaz. */
function codeIdentifiers(sf: ts.SourceFile): Set<string> {
  const ids = new Set<string>();
  forEachNode(sf, (n) => {
    if (ts.isIdentifier(n)) ids.add(n.text);
  });
  return ids;
}
/** Kod olarak geçen dize değerleri (yorumlar sayılmaz). */
function stringLiterals(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  forEachNode(sf, (n) => {
    if (ts.isStringLiteralLike(n)) out.add(n.text);
  });
  return out;
}
interface UpdateChain {
  where: ts.CallExpression | null;
  set: ts.ObjectLiteralExpression | null;
}
/** Her `<x>.update(orders)` zinciri. */
function updateChains(sf: ts.SourceFile): UpdateChain[] {
  const out: UpdateChain[] = [];
  forEachNode(sf, (n) => {
    if (
      !ts.isCallExpression(n) ||
      !ts.isPropertyAccessExpression(n.expression) ||
      n.expression.name.text !== "update" ||
      n.arguments.length !== 1 ||
      !ts.isIdentifier(n.arguments[0]) ||
      n.arguments[0].text !== "orders"
    ) {
      return;
    }
    const chain: UpdateChain = { where: null, set: null };
    let cur: ts.Node = n;
    while (
      ts.isPropertyAccessExpression(cur.parent) &&
      cur.parent.expression === cur &&
      ts.isCallExpression(cur.parent.parent) &&
      cur.parent.parent.expression === cur.parent
    ) {
      const name = cur.parent.name.text;
      const call = cur.parent.parent;
      if (name === "where" && !chain.where) chain.where = call;
      if (name === "set" && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
        chain.set = call.arguments[0];
      }
      cur = call;
    }
    out.push(chain);
  });
  return out;
}
const isGuardCall = (n: ts.Node) =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "notRefundedGuard";
const callsTo = (sf: ts.SourceFile, name: string): ts.CallExpression[] => {
  const out: ts.CallExpression[] = [];
  forEachNode(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      out.push(n);
    }
  });
  return out;
};

// ─── 4. İade koruması ───────────────────────────────────────────────────────
console.log("\niade koruması");
const serviceSf = parse(SERVICE);
const chains = updateChains(serviceSf);
ok("serviste taranacak UPDATE var", chains.length >= 8, chains.length);
ok(
  "HER update(orders) iade korumasını kendi WHERE'inde taşır",
  chains.every((c) => !!c.where && anyNode(c.where, isGuardCall)),
  chains.filter((c) => !c.where || !anyNode(c.where, isGuardCall)).length
);
const serviceIds = codeIdentifiers(serviceSf);
ok("iade edilmiş sipariş okunabilir biçimde reddedilir", serviceIds.has("isRefunded"));
ok("ret metni tek kaynaktan gelir", serviceIds.has("REFUNDED_ORDER_ERROR"));
ok(
  "'succeeded' şartı yok (elle açılan/havale/atölye siparişleri donmasın)",
  !stringLiterals(serviceSf).has("succeeded")
);

// ─── 5. Para: partnerin kendi servisleri, kopya değil ───────────────────────
console.log("\npara");
ok("üretici tabanı tek yerden türetilir", serviceIds.has("manufacturerBaseKurus"));
ok("üretici hakedişi partnerin servisiyle doğar", serviceIds.has("accrueEarning"));
ok("boyacı hakedişi partnerin servisiyle doğar", serviceIds.has("accruePainterEarning"));
ok(
  "servis hakediş satırını KENDİSİ yazmaz",
  !anyNode(
    serviceSf,
    (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "insert" &&
      n.arguments.length === 1 &&
      ts.isIdentifier(n.arguments[0]) &&
      ["manufacturerEarnings", "painterEarnings"].includes(n.arguments[0].text)
  )
);
// Boyacı tabanı doğrudan siparişin boyama kalemidir; burada aritmetik yapılmaz.
ok(
  "boyacı hakedişi paintingPriceKurus ile çağrılır",
  callsTo(serviceSf, "accruePainterEarning").some((c) =>
    c.arguments.some((a) => a.getText().includes("paintingPriceKurus"))
  )
);

// ─── 6. Kapılar partnerin kendi rotasıyla aynı ─────────────────────────────
console.log("\nkapılar partnerin rotasıyla aynı");
const MIRRORS: Array<{ name: string; rel: string; tokens: string[]; ids?: string[] }> = [
  {
    name: "üretici kabul (assigned → accepted)",
    rel: "src/app/api/manufacturer/orders/[id]/accept/route.ts",
    tokens: ["assigned", "accepted"],
  },
  {
    name: "üretici üretimi bitirdi (printing → printed)",
    rel: "src/app/api/manufacturer/orders/[id]/finish-printing/route.ts",
    tokens: ["printing", "printed"],
  },
  {
    name: "üretici QC'ye gönderdi",
    rel: "src/app/api/manufacturer/orders/[id]/submit-qc/route.ts",
    tokens: ["quality_check"],
    ids: ["qcNextStatus", "QC_MIN_PHOTOS", "qcPhotos"],
  },
  {
    name: "üretici kargoladı (QC kapısı + atölye istisnası)",
    rel: "src/app/api/manufacturer/orders/[id]/ship/route.ts",
    tokens: ["qc_approved", "shipped"],
    ids: ["paintsInHouse", "workshopSessionId"],
  },
  {
    name: "boyacı kabul (assigned → accepted)",
    rel: "src/app/api/painter/orders/[id]/accept/route.ts",
    tokens: ["assigned", "accepted"],
  },
  {
    name: "boyacı boyamayı bitirdi",
    rel: "src/app/api/painter/orders/[id]/painted/route.ts",
    tokens: ["accepted", "painting", "painted"],
  },
  {
    name: "boyacı QC'ye gönderdi",
    rel: "src/app/api/painter/orders/[id]/submit-qc/route.ts",
    tokens: [],
    ids: ["painterQcNextStatus", "QC_MIN_PHOTOS", "painterQcPhotos"],
  },
  {
    name: "boyacı kargoladı (boyama QC kapısı)",
    rel: "src/app/api/painter/orders/[id]/ship/route.ts",
    tokens: ["qc_approved", "shipped"],
  },
];
const serviceStrings = stringLiterals(serviceSf);
for (const m of MIRRORS) {
  const partnerSf = parse(m.rel);
  const partnerStrings = stringLiterals(partnerSf);
  const partnerIds = codeIdentifiers(partnerSf);
  for (const t of m.tokens) {
    ok(
      `${m.name}: '${t}' durumu her iki tarafta da var`,
      partnerStrings.has(t) && serviceStrings.has(t)
    );
  }
  for (const idName of m.ids ?? []) {
    ok(
      `${m.name}: ${idName} her iki tarafta da kullanılır`,
      partnerIds.has(idName) && serviceIds.has(idName)
    );
  }
}

// ─── 7. Rota devreder, kendi geçişini yazmaz ───────────────────────────────
console.log("\ndevir");
const routeSf = parse(ROUTE);
ok("on-behalf rotası servise devreder", codeIdentifiers(routeSf).has("onBehalfOfPartner"));
ok("on-behalf rotasının kendi update(orders)'ı yok", updateChains(routeSf).length === 0);
ok(
  "gerekçe doğrulaması serviste, rotada kopyalanmamış",
  !codeIdentifiers(routeSf).has("ON_BEHALF_REASON_MIN_LENGTH")
);
// Gerekçe kapısı, herhangi bir adım çalışmadan ÖNCE geçilir.
const preflightCall = callsTo(serviceSf, "onBehalfPreflight")[0]?.getStart() ?? -1;
const firstStep = Math.min(
  ...["runManufacturerStep", "runPainterStep"].map(
    (n) => callsTo(serviceSf, n)[0]?.getStart() ?? Number.MAX_SAFE_INTEGER
  )
);
ok(
  "adım çalışmadan önce gerekçe/iade kapısı geçilir",
  preflightCall > 0 && preflightCall < firstStep,
  { preflightCall, firstStep }
);
ok(
  "gerekçe kapısı ön kontrolün içinde",
  callsTo(serviceSf, "onBehalfReasonError").length > 0
);

// ─── 8. Admin kargo uçları artık üreticili siparişi de tanır ───────────────
console.log("\nadmin kargo uçları");
for (const rel of [ADMIN_SHIP, ADMIN_KARGO]) {
  const sf = parse(rel);
  const ids = codeIdentifiers(sf);
  ok(`${rel}: partner varsa onun adına kargolar`, ids.has("onBehalfOfPartner"));
  ok(`${rel}: işi kimin tuttuğunu tek fonksiyondan sorar`, ids.has("partnerHoldingOrder"));
}
ok(
  "ship: kargo firması artık zorunlu (takip bağlantısı firmasız kurulamaz)",
  codeIdentifiers(parse(ADMIN_SHIP)).has("createAdminShipOrderSchema")
);
ok(
  "ship-kargo: durum yazılamazsa yaratılan Yurtiçi gönderisi iptal edilir",
  codeIdentifiers(parse(ADMIN_KARGO)).has("cancelShipment")
);

// ─── 9. Partnerin kendi zaman çizelgesi damgalanır ─────────────────────────
console.log("\npartner zaman çizelgesi");
ok("üretici çizelgesine yazılır", serviceIds.has("manufacturerActions"));
ok("boyacı çizelgesine yazılır", serviceIds.has("painterActions"));
ok("denetim kaydına yazılır", serviceIds.has("adminActions"));
ok("üreticiye bildirim gider", serviceIds.has("notifyManufacturer"));
ok("boyacıya bildirim gider", serviceIds.has("notifyPainter"));

// ─── 10. Model onayı kapısı: partnerin kendi rotasındaki kapının aynısı ────
//
// EN PAHALI AÇIK burasıydı: partnerin kendi rotaları "yeni model sürümünü
// onaylamadan ileri adım yok" derken, admin'in "partner adına" yolu kapıyı hiç
// sormuyordu. Kargo adımı partner hakedişini doğurduğu için, eski sürüme
// basılmış bir işten para tahakkuk edebiliyordu.
console.log("\nmodel onayı kapısı");
ok("servis onay durumunu partnerin servisinden okur", serviceIds.has("readPartnerModelAck"));
ok("ret metni tek kaynaktan gelir", serviceIds.has("MODEL_ACK_REQUIRED_ERROR"));
ok(
  "engellenen adımlar listesi üreticide config'ten gelir",
  serviceIds.has("MANUFACTURER_ACK_BLOCKED_ACTIONS")
);
ok(
  "engellenen adımlar listesi boyacıda config'ten gelir",
  serviceIds.has("PAINTER_ACK_BLOCKED_ACTIONS")
);
// Kapı, HER adımdan önce koşan ön kontrolün İÇİNDE olmalı: yalnız asıl adımda
// dursaydı ship-kargo ucu dış sistemde gönderi yaratıp sonra iptal ederdi.
function declarationRange(sf: ts.SourceFile, name: string): [number, number] | null {
  let range: [number, number] | null = null;
  forEachNode(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      range = [n.getStart(), n.getEnd()];
    }
  });
  return range;
}
const preflightRange = declarationRange(serviceSf, "onBehalfPreflight");
const ackGateCalls = callsTo(serviceSf, "modelAckGate").map((c) => c.getStart());
ok(
  "onay kapısı ön kontrolün İÇİNDE çağrılır (dış gönderi yaratılmadan önce)",
  !!preflightRange &&
    ackGateCalls.some((at) => at > preflightRange![0] && at < preflightRange![1]),
  { preflightRange, ackGateCalls }
);

// Eşleme tablosu: her on-behalf adımı, partnerin GERÇEKTEN var olan rotasına
// bakmalı. Bir rota yeniden adlandırılırsa kapı sessizce açılırdı.
const ROUTE_DIR: Record<"manufacturer" | "painter", string> = {
  manufacturer: "src/app/api/manufacturer/orders/[id]",
  painter: "src/app/api/painter/orders/[id]",
};
for (const kind of ["manufacturer", "painter"] as const) {
  const blockedList: readonly string[] =
    kind === "manufacturer" ? MANUFACTURER_ACK_BLOCKED_ACTIONS : PAINTER_ACK_BLOCKED_ACTIONS;
  for (const [action, routeName] of Object.entries(PARTNER_ROUTE_ACTION[kind])) {
    const rel = `${ROUTE_DIR[kind]}/${routeName}/route.ts`;
    let partnerIds: Set<string>;
    try {
      partnerIds = codeIdentifiers(parse(rel));
    } catch {
      ok(`${kind}.${action} → ${rel} var`, false);
      continue;
    }
    ok(`${kind}.${action} → ${routeName} rotası var`, true);
    if (blockedList.includes(routeName)) {
      // Kapı burada da duruyor mu: on-behalf yolu, partnerin kendi rotasının
      // uyguladığı kapının aynısını uygular — biri kalkarsa test kırılır.
      ok(
        `${kind}.${routeName}: partnerin kendi rotası onay kapısını uyguluyor`,
        partnerIds.has("readPartnerModelAck")
      );
    }
  }
}
// Üreticinin engellenen HER adımı on-behalf tarafında da kapalı olmalı
// (send-to-painter bir on-behalf adımı değildir, o yüzden dışarıda).
const mappedManufacturer = Object.values(PARTNER_ROUTE_ACTION.manufacturer);
for (const blocked of MANUFACTURER_ACK_BLOCKED_ACTIONS) {
  if (blocked === "send-to-painter") continue;
  ok(
    `üretici kapısındaki '${blocked}' adımının on-behalf karşılığı var`,
    mappedManufacturer.includes(blocked),
    mappedManufacturer
  );
}

// ─── 11. Kargo firması zorunlu ─────────────────────────────────────────────
console.log("\nkargo firması");
ok(
  "partner adına kargoda firma zorunlu (firmasız takip bağlantısı kurulamaz)",
  serviceStrings.has("carrier_required")
);

// ─── 12. F-C1: admin ekranının çağırdığı uçlar ve yöntemleri ──────────────
//
// Faz 2'de ekran ile sunucu iki ayrı sözleşmeye yazılmıştı: düğmeler
// /shipping, /revert-shipping, /model-approval/*, /model-revisions/* ve
// /partner-messages çağırıyor, sunucuda ise başka adlar/yöntemler vardı; altı
// kontrol 404 dönüyordu. Kanonik küme burada kilitlenir.
console.log("\nF-C1 kanonik uçlar");
function exportedMethods(rel: string): Set<string> {
  const sf = parse(rel);
  const out = new Set<string>();
  forEachNode(sf, (n) => {
    if (
      ts.isFunctionDeclaration(n) &&
      n.name &&
      n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      out.add(n.name.text);
    }
  });
  return out;
}
const CANONICAL: Array<{ rel: string; methods: string[] }> = [
  { rel: "src/app/api/admin/orders/[id]/ship/route.ts", methods: ["POST", "PATCH", "DELETE"] },
  { rel: "src/app/api/admin/orders/[id]/deliver/route.ts", methods: ["POST", "DELETE"] },
  { rel: "src/app/api/admin/orders/[id]/model-approval/resend/route.ts", methods: ["POST"] },
  { rel: "src/app/api/admin/orders/[id]/model-approval/record/route.ts", methods: ["POST"] },
  { rel: "src/app/api/admin/orders/[id]/model-revisions/[revision]/route.ts", methods: ["PATCH"] },
  { rel: "src/app/api/admin/orders/[id]/partner-messages/route.ts", methods: ["GET", "POST"] },
  { rel: "src/app/api/admin/orders/[id]/on-behalf/route.ts", methods: ["POST"] },
];
for (const c of CANONICAL) {
  let methods: Set<string>;
  try {
    methods = exportedMethods(c.rel);
  } catch {
    ok(`${c.rel} var`, false);
    continue;
  }
  for (const m of c.methods) {
    ok(`${c.rel}: ${m} var`, methods.has(m));
  }
  // Her uç admin oturumu ister: bu dosyalar admin panelinden çağrılıyor.
  ok(`${c.rel}: admin oturumu şart`, codeIdentifiers(parse(c.rel)).has("requireAdmin"));
}

// Geri alma uçlarında gerekçe ZORUNLU (denetim kaydının tek dayanağı).
for (const rel of [
  "src/app/api/admin/orders/[id]/ship/route.ts",
  "src/app/api/admin/orders/[id]/deliver/route.ts",
]) {
  ok(`${rel}: geri alma gerekçesi zorunlu`, codeIdentifiers(parse(rel)).has("revertReasonError"));
}

// Karar kaydı, müşterinin kendi tıklamasıyla AYNI servisten geçer; kopya bir
// geçiş atomik kapıyı ve kanıt satırını ikizlerdi.
ok(
  "onay kaydı partnerin/müşterinin servisini çağırır",
  codeIdentifiers(parse("src/app/api/admin/orders/[id]/model-approval/record/route.ts")).has(
    "decideModelApproval"
  )
);
// Yeniden gönderme YENİ TUR AÇMAZ: openModelApproval çağrılmaz.
ok(
  "yeniden gönderme yeni onay turu açmaz",
  !codeIdentifiers(
    parse("src/app/api/admin/orders/[id]/model-approval/resend/route.ts")
  ).has("openModelApproval")
);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exitCode = failed ? 1 : 0;
