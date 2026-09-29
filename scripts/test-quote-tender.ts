/**
 * Tahsilat zinciri: altın değerler + `/api/orders` DENKLİĞİ. DB yok, Redis yok.
 *
 * İki iş yapar.
 *
 * 1. `src/lib/config/quote-tender.ts`in altın değerlerini sabitler: hediye kartı
 *    tutarı aşarsa, tam kapatırsa, havaleyle birlikte, sıfır bakiye, tavan.
 *
 * 2. AYNI girdide `/api/orders`ın SATIR İÇİ zincirinin aynı `payableKurus`u
 *    ürettiğini kanıtlar. O dosya bu programda DEĞİŞTİRİLMİYOR (başka bir
 *    oturumun commit'lenmemiş sürümü var), yani iki kopya bir süre yan yana
 *    yaşayacak. Kayarlarsa aynı hediye kartı iki yolda farklı davranır ve fark
 *    PARANIN içinde, sessizce ortaya çıkar — webhook tutar farkını yalnız
 *    loglar, reddetmez (`api/webhooks/paytr/route.ts`).
 *
 *    Bu yüzden denklik testi route.ts'i OKUR: zincirin ifadelerini TypeScript
 *    AST'inden çıkarır ve DEĞERLENDİRİR. Yani elle kopyalanmış bir "referans
 *    uygulama" değil, dosyanın bugünkü kendisi koşar; route.ts'teki aritmetik
 *    değişirse test YENİ ifadeyi ölçer ve düşer. Çıkarımın kendisi de sınanır:
 *    ifade bulunamazsa test patlar (sessizce atlamaz), ve bozulmuş kaynakla
 *    yapılan mutasyonlar gerçekten KIRMIZI verir — yani bu nöbetçi uyuyor
 *    olamaz.
 *
 *    route.ts'te tahsil edilen tutarın İKİ ifadesi var, her dalda bir tane:
 *    havale talimatındaki `finalAmountKurus` (:903) ve PayTR'a giden
 *    `paymentAmountKurus` (:953 → sepet :991, token :1003). İKİSİ de ölçülür ve
 *    hangisinin geçerli olduğu route.ts'in kendi dallanma koşulundan çıkarılır.
 *    Bugün eşitler (kart dalında havale indirimi daima 0), ama kart dalını
 *    ölçmemek tasarımın birinci riskini — PayTR'a BRÜT gitmesini, yani sessiz
 *    çifte tahsilatı — nöbetsiz bırakırdı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {
  TENDER_STEPS_COVER_ALL_DEDUCTIONS,
  TENDER_STEP_FIELD,
  TENDER_STEP_ORDER,
  computeTender,
  recordedPaymentMethod,
  type TenderInput,
  type TenderPaymentMethod,
} from "../src/lib/config/quote-tender";
import { calculateHavaleDiscount } from "../src/lib/config/payment";
import { MAX_AMOUNT_KURUS } from "../src/lib/config/prices";
import { refundTenderBasis } from "../src/lib/config/order-refund";

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

/** Girdinin tamamı zorunlu: kısayol yardımcı, vakaların okunur kalması için. */
function input(over: Partial<TenderInput> & Pick<TenderInput, "amountKurus">): TenderInput {
  return {
    paymentMethod: "card",
    giftCardBalanceKurus: 0,
    havaleDiscountApplies: true,
    ...over,
  };
}

console.log("tahsilat zinciri — altın değerler");

test("kart yok: tahsil edilen = brüt", () => {
  const tender = computeTender(input({ amountKurus: 100_000 }));
  assert.deepEqual(tender, {
    giftCardAmountKurus: 0,
    havaleDiscountKurus: 0,
    payableKurus: 100_000,
    fullyCoveredByGiftCard: false,
  });
});

test("kart yok + havale: indirim brütten, tahsil edilen brüt − indirim", () => {
  const tender = computeTender(
    input({ amountKurus: 100_000, paymentMethod: "bank_transfer" })
  );
  assert.equal(tender.havaleDiscountKurus, 3_000);
  assert.equal(tender.payableKurus, 97_000);
});

test("havale indirimi AYARA bağlı: kapalıysa indirim yok", () => {
  const tender = computeTender(
    input({
      amountKurus: 100_000,
      paymentMethod: "bank_transfer",
      havaleDiscountApplies: false,
    })
  );
  assert.equal(tender.havaleDiscountKurus, 0);
  assert.equal(tender.payableKurus, 100_000);
});

test("kısmi kart: kart tutarı kadar düşer, brüt DEĞİŞMEZ", () => {
  const tender = computeTender(input({ amountKurus: 100_000, giftCardBalanceKurus: 40_000 }));
  assert.deepEqual(tender, {
    giftCardAmountKurus: 40_000,
    havaleDiscountKurus: 0,
    payableKurus: 60_000,
    fullyCoveredByGiftCard: false,
  });
});

test("kısmi kart + havale: indirim NAKİT kısımdan hesaplanır", () => {
  const tender = computeTender(
    input({
      amountKurus: 100_000,
      giftCardBalanceKurus: 40_000,
      paymentMethod: "bank_transfer",
    })
  );
  // Nakit 60.000 → %3 = 1.800. Brütten hesaplanırsa 3.000 olurdu ve
  // hediye + indirim toplamı ödenen tutarın ötesine geçebilirdi: o hâlde iade
  // motoru siparişi `lineage_unknown` ile KALICI olarak reddeder
  // (`order-refund.ts` · refundTenderBasis).
  assert.equal(tender.havaleDiscountKurus, 1_800);
  assert.notEqual(tender.havaleDiscountKurus, 3_000);
  assert.equal(tender.payableKurus, 58_200);
});

test("kart tutarı AŞARSA: yalnız tutar kadarı kullanılır, tahsilat 0", () => {
  const tender = computeTender(input({ amountKurus: 100_000, giftCardBalanceKurus: 250_000 }));
  assert.deepEqual(tender, {
    giftCardAmountKurus: 100_000,
    havaleDiscountKurus: 0,
    payableKurus: 0,
    fullyCoveredByGiftCard: true,
  });
});

test("kart TAM kapatırsa: karşılandı, havale indirimi YOK", () => {
  const tender = computeTender(
    input({
      amountKurus: 100_000,
      giftCardBalanceKurus: 100_000,
      paymentMethod: "bank_transfer",
    })
  );
  assert.deepEqual(tender, {
    giftCardAmountKurus: 100_000,
    // Tahsil edilen nakit sıfır: sıfırın %3'ü de sıfırdır. Havale indirimi
    // tahsilata verilen bir teşviktir, hediye kartına verilen bir prim değil.
    havaleDiscountKurus: 0,
    payableKurus: 0,
    fullyCoveredByGiftCard: true,
  });
});

test("indirim AŞAĞI yuvarlanır (kuruş platformda kalmaz, müşteride)", () => {
  const tender = computeTender(
    input({ amountKurus: 3_333, paymentMethod: "bank_transfer" })
  );
  assert.equal(tender.havaleDiscountKurus, 99); // floor(99,99)
  assert.equal(tender.payableKurus, 3_234);
});

test("tavan BRÜT üzerinde: kartla kapatmak tavanı aşmaya izin vermez", () => {
  const atCeiling = computeTender(input({ amountKurus: MAX_AMOUNT_KURUS }));
  assert.equal(atCeiling.payableKurus, MAX_AMOUNT_KURUS);
  assert.throws(
    () => computeTender(input({ amountKurus: MAX_AMOUNT_KURUS + 1 })),
    RangeError
  );
  // Tahsil edilen tutar tavanın altına inse bile brüt reddedilir: tavan
  // siparişin BÜYÜKLÜĞÜNÜ sınırlar, ödenen nakdi değil.
  assert.throws(
    () =>
      computeTender(
        input({
          amountKurus: MAX_AMOUNT_KURUS + 1,
          giftCardBalanceKurus: MAX_AMOUNT_KURUS + 1,
        })
      ),
    RangeError
  );
});

test("geçersiz para girdisi sessizce geçmez", () => {
  assert.throws(() => computeTender(input({ amountKurus: 0 })), RangeError);
  assert.throws(() => computeTender(input({ amountKurus: -1 })), RangeError);
  assert.throws(() => computeTender(input({ amountKurus: 100.5 })), RangeError);
  assert.throws(
    () => computeTender(input({ amountKurus: 100_000, giftCardBalanceKurus: -1 })),
    RangeError
  );
  assert.throws(
    () => computeTender(input({ amountKurus: 100_000, giftCardBalanceKurus: 1.5 })),
    RangeError
  );
});

test("tam karşılanan ödeme `gift_card_full` olarak kaydedilir", () => {
  const covered = computeTender(input({ amountKurus: 100, giftCardBalanceKurus: 100 }));
  assert.equal(recordedPaymentMethod("card", covered), "gift_card_full");
  assert.equal(recordedPaymentMethod("bank_transfer", covered), "gift_card_full");
  const partial = computeTender(input({ amountKurus: 100, giftCardBalanceKurus: 99 }));
  assert.equal(recordedPaymentMethod("card", partial), "card");
  assert.equal(recordedPaymentMethod("bank_transfer", partial), "bank_transfer");
});

test("zincir worker yolundadır — `server-only` İÇERMEZ", () => {
  // BullMQ worker'ı taslak zinciri üzerinden buraya ulaşıyor; `server-only`
  // import eden bir modül standalone Node worker'ını çalışma anında
  // crash-loop'a sokar (2026-06-13'te ölçüldü).
  // Desen satır başına bağlıdır: modülün başlık yorumu bu kuralı ANLATIYOR ve
  // yorumdaki bir söz, gerçek bir import gibi sayılmamalı.
  const source = fs.readFileSync("src/lib/config/quote-tender.ts", "utf8");
  assert.doesNotMatch(source, /^\s*import\s+["']server-only["']/m);
});

// ─── Değişmezler: matris üzerinde ────────────────────────────────────────────

const AMOUNTS = [1, 99, 100, 3_333, 12_345, 100_000, 199_999, MAX_AMOUNT_KURUS];
const BALANCES = [0, 1, 99, 3_333, 60_000, 100_000, 199_999, MAX_AMOUNT_KURUS, MAX_AMOUNT_KURUS * 2];
const METHODS: TenderPaymentMethod[] = ["card", "bank_transfer"];

function matrix(): TenderInput[] {
  const cases: TenderInput[] = [];
  for (const amountKurus of AMOUNTS) {
    for (const giftCardBalanceKurus of BALANCES) {
      for (const paymentMethod of METHODS) {
        for (const havaleDiscountApplies of [true, false]) {
          cases.push({ amountKurus, giftCardBalanceKurus, paymentMethod, havaleDiscountApplies });
        }
      }
    }
  }
  return cases;
}

console.log("tahsilat zinciri — değişmezler");

test("tahsil edilen = brüt − hediye kartı − havale indirimi", () => {
  // Beklenen değer ELLE yazılır; `TENDER_STEP_ORDER.reduce` ile TÜRETİLMEZ.
  // Türetilmiş bir beklenti, implementasyonun (`quote-tender.ts` · `deductedKurus`)
  // kullandığı AYNI listeyle hesaplanırdı: listeye girmemiş bir indirim alanı
  // için test yapısal olarak KIRMIZI olamaz, kendi kendine eşitliğini ölçerdi.
  for (const args of matrix()) {
    const tender = computeTender(args);
    assert.equal(
      tender.payableKurus,
      args.amountKurus - tender.giftCardAmountKurus - tender.havaleDiscountKurus,
      `tahsilat brütten her indirimi düşmüyor: ${JSON.stringify(args)}`
    );
  }
});

/**
 * Çıktının indirim OLMAYAN alanları. Geri kalan her alan `TenderDeductions`tan
 * gelir (çıktı `{...deductions, payableKurus, fullyCoveredByGiftCard}`), yani bu
 * liste indirim kümesini çalışma anında ters yönden okumayı mümkün kılar.
 */
const NON_DEDUCTION_OUTPUT_FIELDS: readonly string[] = [
  "payableKurus",
  "fullyCoveredByGiftCard",
];

test("her indirim alanı zincirde bir adıma bağlı (İKİ YÖNLÜ)", () => {
  // Asıl nöbetçi DERLEME zamanındadır: `TENDER_STEPS_COVER_ALL_DEDUCTIONS`
  // (`quote-tender.ts`) `TenderDeductions`ın adımsız bir alanını `tsc` hatasına
  // çevirir. `satisfies Record<TenderStep, keyof TenderDeductions>` tek yönlüdür
  // ve bu yönü KAPATMAZ: üçüncü bir alan, `TENDER_STEP_ORDER`a dokunmadan
  // derlenirdi — indirim kaydedilir, tahsilattan düşmez, müşteriden FAZLA para
  // çekilir.
  assert.equal(TENDER_STEPS_COVER_ALL_DEDUCTIONS, true);

  // Ters yönün çalışma anı kopyası: alan kümesi ÇIKTIDAN okunur, adım
  // listesinden türetilmez. Bir alanı `deductions`a ekleyip adımını yazmamak bu
  // iki kümeyi ayırır.
  const tender = computeTender(input({ amountKurus: 100_000, giftCardBalanceKurus: 40_000 }));
  const deductionFields = Object.keys(tender)
    .filter((key) => !NON_DEDUCTION_OUTPUT_FIELDS.includes(key))
    .sort();
  const stepFields = TENDER_STEP_ORDER.map((step) => TENDER_STEP_FIELD[step]).slice().sort();
  assert.deepEqual(
    deductionFields,
    stepFields,
    "bir indirim alanının `TENDER_STEP_ORDER` karşılığı yok: tahsilattan düşmüyor"
  );
  // Bugünkü küme ELLE de pinli: yeniden adlandırma iki kümeyi birlikte
  // kaydırabilirdi ve o hâlde yukarıdaki karşılaştırma sessiz kalırdı.
  assert.deepEqual(deductionFields, ["giftCardAmountKurus", "havaleDiscountKurus"]);
});

test("hediye + indirim brütü AŞMAZ ve tahsilat negatif olamaz", () => {
  for (const args of matrix()) {
    const tender = computeTender(args);
    assert.ok(
      tender.giftCardAmountKurus + tender.havaleDiscountKurus <= args.amountKurus,
      `iade motorunun ön koşulu bozuldu: ${JSON.stringify(args)}`
    );
    assert.ok(tender.payableKurus >= 0, `negatif tahsilat: ${JSON.stringify(args)}`);
    assert.ok(Number.isSafeInteger(tender.payableKurus));
  }
});

test("iade motoru zincirin yazdığı tutarı okuyabilir (cash === payable)", () => {
  // İleri yön (tahsilat) ile ters yön (iade) aynı cümleyi söylemek zorunda:
  // `refundTenderBasis` `amount − discount − gift`i NAKİT sayar. Ayrışırlarsa
  // iade ya eksik ya fazla para döndürür.
  for (const args of matrix()) {
    const tender = computeTender(args);
    const basis = refundTenderBasis({
      amountKurus: args.amountKurus,
      havaleDiscountKurus: tender.havaleDiscountKurus,
      giftCardAmountKurus: tender.giftCardAmountKurus,
    });
    assert.equal(basis.cashKurus, tender.payableKurus, JSON.stringify(args));
  }
});

test("tam karşılama yalnız bakiye brüte yetince olur", () => {
  for (const args of matrix()) {
    const tender = computeTender(args);
    assert.equal(
      tender.fullyCoveredByGiftCard,
      args.giftCardBalanceKurus >= args.amountKurus,
      JSON.stringify(args)
    );
    if (tender.fullyCoveredByGiftCard) assert.equal(tender.payableKurus, 0);
  }
});

// ─── DENKLİK: `/api/orders`ın satır içi zinciri ──────────────────────────────

const ROUTE_PATH = "src/app/api/orders/route.ts";

/** Çıkarılan ifadeyi verilen kapsamda değerlendirir (`with` yok: katı kip). */
function evaluate(expression: string, scope: Record<string, unknown>): unknown {
  const names = Object.keys(scope);
  const body = `"use strict"; return (${expression});`;
  const fn = new Function(...names, body) as (...args: unknown[]) => unknown;
  return fn(...names.map((name) => scope[name]));
}

function allNodes(root: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

interface InlineChainInput {
  amountKurus: number;
  giftCardBalanceKurus: number;
  paymentMethod: TenderPaymentMethod;
}

interface InlineChainResult {
  giftCardAmountKurus: number;
  havaleDiscountKurus: number;
  /** route.ts'in GİRDİĞİ dalın fiilen tahsil ettiği tutar. */
  payableKurus: number;
  /** Havale dalının tutarı (`finalAmountKurus`, route.ts:903). */
  bankBranchPayableKurus: number;
  /** Kart dalının tutarı (`paymentAmountKurus`, route.ts:953) — PayTR'a giden. */
  cardBranchPayableKurus: number;
  /** route.ts'in hangi dala düştüğü. */
  branch: "gift_card_full" | "bank_transfer" | "card";
  fullyCovered: boolean;
  paymentMethod: string;
}

/**
 * route.ts'in satır içi zincirini KAYNAĞINDAN çıkarır ve koşulabilir hâle
 * getirir. Bir ifade bulunamazsa ATAR: bulunamayan ifade, sessizce hiçbir şey
 * sınamayan bir teste dönüşürdü.
 */
function extractInlineChain(source: string): (args: InlineChainInput) => InlineChainResult {
  const sourceFile = ts.createSourceFile(ROUTE_PATH, source, ts.ScriptTarget.Latest, true);
  const nodes = allNodes(sourceFile);

  const assignmentNode = (name: string): ts.BinaryExpression => {
    const found = nodes.filter(
      (node): node is ts.BinaryExpression =>
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        node.left.text === name
    );
    assert.equal(found.length, 1, `${name} için tam bir atama bekleniyordu`);
    return found[0];
  };
  const assignment = (name: string): string => assignmentNode(name).right.getText(sourceFile);
  const declaration = (name: string): ts.VariableDeclaration => {
    const found = nodes.filter(
      (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        !!node.initializer
    );
    assert.equal(found.length, 1, `${name} için tam bir tanım bekleniyordu`);
    return found[0];
  };

  /** `node`u saran en yakın `if`in koşul metni. Koşul da zincirin parçasıdır. */
  const enclosingIfCondition = (node: ts.Node, label: string): string => {
    let current: ts.Node | undefined = node;
    while (current && !ts.isIfStatement(current)) current = current.parent;
    assert.ok(current && ts.isIfStatement(current), `${label} bir koşulun içinde olmalı`);
    return (current as ts.IfStatement).expression.getText(sourceFile);
  };

  const giftExpression = assignment("giftCardAmountKurus");
  const coveredExpression = assignment("isCovered");
  const havaleExpression = assignment("havaleDiscountKurus");
  const methodExpression = declaration("finalPaymentMethod").initializer!.getText(sourceFile);

  // Havale dalının tahsil edilen tutarı (route.ts:903). Bu ifade YALNIZ havale
  // dalında yaşar: kart dalı `finalAmountKurus`u hiç hesaplamaz.
  const bankPayableDeclaration = declaration("finalAmountKurus");
  const bankPayableExpression = bankPayableDeclaration.initializer!.getText(sourceFile);

  // KART dalının tahsil edilen tutarı (route.ts:953). PayTR sepeti (:991) ve
  // PayTR token'ı (:1003) TAM OLARAK bunu alır. Bu ifadeyi ölçmeden bırakmak
  // tasarımın birinci riskini (§5.2) nöbetsiz bırakırdı: `amountKurus`a
  // çevrilmesi müşteriden BRÜTÜ çeker (hediye kartı rezerve edilmiş olsa bile)
  // ve webhook tutar farkını yalnız loglar, reddetmez.
  const cardPayableDeclaration = declaration("paymentAmountKurus");
  const cardPayableExpression = cardPayableDeclaration.initializer!.getText(sourceFile);

  // Havale indirimi bir KOŞULUN içinde yazılıyor.
  const havaleGuard = enclosingIfCondition(
    assignmentNode("havaleDiscountKurus"),
    "havale indirimi"
  );

  // İki tutar ifadesi arasında hangisinin geçerli olduğunu route.ts'in DALLANMA
  // koşulu belirler (`draft.paymentMethod === "bank_transfer"`, :902). Koşul da
  // kaynaktan çıkarılır: elle varsayılırsa dallanma değiştiğinde test eski
  // varsayımda kalırdı.
  const bankBranchGuard = enclosingIfCondition(bankPayableDeclaration, "havale dalı");

  // Dalın okuduğu `draft.paymentMethod`, taslağa YAZILAN `finalPaymentMethod`tur
  // (:813). Emülasyon bunu varsayıyor, o yüzden kaynakta sınanır.
  assert.match(
    source,
    /paymentMethod: finalPaymentMethod,/,
    "route.ts taslağa `finalPaymentMethod`ı yazmalı"
  );

  // Tam karşılanan ödeme HİÇBİR tutar tahsil etmez: route.ts taslağı doğrudan
  // siparişe terfi ettirip DÖNER (:862), yani ne havale talimatı ne PayTR açılır.
  // Bu erken dönüş kalkarsa karşılanan sipariş bir ödeme dalına düşer.
  assert.match(
    source,
    /if \(fullyCovered\) \{[\s\S]{0,600}?return NextResponse\.json\(/,
    "route.ts tam karşılanan ödemeyi erken döndürmeli"
  );

  // Enjekte edilen `calculateHavaleDiscount` GERÇEKTEN route.ts'in kullandığı
  // fonksiyon olmalı; başka bir yerden gelen aynı adlı bir fonksiyon denkliği
  // yalancı biçimde sağlardı.
  assert.match(
    source,
    /import\s*\{[^}]*calculateHavaleDiscount[^}]*\}\s*from\s*"@\/lib\/config\/payment"/,
    "route.ts havale indirimini paylaşılan config'ten almalı"
  );

  return (args: InlineChainInput): InlineChainResult => {
    // route.ts hediye kartı bloğuna yalnız bir KOD verildiğinde girer; bakiyesi
    // 0 olan kart o bloğun içinde 400 ile reddedilir (INSUFFICIENT_BALANCE),
    // yani "bakiye 0" ile "kart yok" aynı zincire düşer.
    const hasCard = args.giftCardBalanceKurus > 0;
    const card = { balanceKurus: args.giftCardBalanceKurus };
    const amountKurus = args.amountKurus;
    const giftCardAmountKurus = hasCard
      ? (evaluate(giftExpression, { Math, card, amountKurus }) as number)
      : 0;
    const isCovered = hasCard
      ? (evaluate(coveredExpression, { giftCardAmountKurus, amountKurus }) as boolean)
      : false;
    const finalPaymentMethod = evaluate(methodExpression, {
      isCovered,
      common: { paymentMethod: args.paymentMethod },
    }) as string;
    const guarded = evaluate(havaleGuard, { isCovered, finalPaymentMethod }) as boolean;
    const havaleDiscountKurus = guarded
      ? (evaluate(havaleExpression, {
          calculateHavaleDiscount,
          amountKurus,
          giftCardAmountKurus,
        }) as number)
      : 0;
    const bankBranchPayableKurus = evaluate(bankPayableExpression, {
      amountKurus,
      giftCardAmountKurus,
      havaleDiscountKurus,
    }) as number;
    const cardBranchPayableKurus = evaluate(cardPayableExpression, {
      amountKurus,
      giftCardAmountKurus,
    }) as number;

    // route.ts'in sırası: tam karşılandı mı (erken dönüş) → havale dalı mı →
    // yoksa kart dalı. Tahsil edilen tutar GİRİLEN dalın ifadesidir.
    const bankBranch =
      !isCovered &&
      (evaluate(bankBranchGuard, {
        draft: { paymentMethod: finalPaymentMethod },
      }) as boolean);
    const branch: InlineChainResult["branch"] = isCovered
      ? "gift_card_full"
      : bankBranch
      ? "bank_transfer"
      : "card";

    return {
      giftCardAmountKurus,
      havaleDiscountKurus,
      payableKurus:
        branch === "gift_card_full"
          ? 0
          : branch === "bank_transfer"
          ? bankBranchPayableKurus
          : cardBranchPayableKurus,
      bankBranchPayableKurus,
      cardBranchPayableKurus,
      branch,
      fullyCovered: isCovered,
      paymentMethod: finalPaymentMethod,
    };
  };
}

interface CompareCounts {
  /** Karşılaştırılan toplam vaka. */
  compared: number;
  /** Havale dalına düşen vaka (route.ts:903 ifadesi ölçüldü). */
  bank: number;
  /** Kart dalına düşen vaka (route.ts:953 ifadesi = PayTR tutarı ölçüldü). */
  card: number;
  /** Hediye kartının tamamını kapattığı, hiçbir tahsilat açılmayan vaka. */
  covered: number;
}

/**
 * Denklik matrisi. `havaleDiscountApplies` DAİMA açık: `/api/orders` böyle bir
 * ayar TANIMAZ (figür siparişinde indirim her zaman uygulanır), ayar yalnız
 * teklif katalogunda vardır. Kapalı ayar bu yüzden bir kayma değil, teklif
 * yolunun kendi kuralıdır ve yukarıdaki altın değerlerde sınanır.
 *
 * HER İKİ ödeme dalının tutarı ölçülür: havale talimatındaki `finalAmountKurus`
 * ve PayTR'a giden `paymentAmountKurus`. İkincisini dışarıda bırakmak, kart
 * yolunda brüt tahsil etmeyi (sessiz çifte tahsilat) nöbetsiz bırakırdı.
 */
function compareWith(chain: (args: InlineChainInput) => InlineChainResult): CompareCounts {
  const counts: CompareCounts = { compared: 0, bank: 0, card: 0, covered: 0 };
  for (const args of matrix()) {
    if (!args.havaleDiscountApplies) continue;
    counts.compared++;
    const tender = computeTender(args);
    const inline = chain(args);
    const label = JSON.stringify(args);
    assert.equal(tender.payableKurus, inline.payableKurus, `tahsil edilen ayrıştı: ${label}`);

    // Dal başına AYRI iddia: hangi ifadenin kaydığı hata mesajından okunsun ve
    // dalların SAYISI sayılsın (boş kalan bir dal sessizce "geçti" demesin).
    if (inline.branch === "bank_transfer") {
      counts.bank++;
      assert.equal(
        tender.payableKurus,
        inline.bankBranchPayableKurus,
        `havale talimatındaki tutar ayrıştı: ${label}`
      );
    } else if (inline.branch === "card") {
      counts.card++;
      // PayTR'a giden tutar. Eşitlik bozulursa müşteriden zincirin söylediğinden
      // FARKLI bir para çekilir — tasarım §5.2'nin birinci riski.
      assert.equal(
        tender.payableKurus,
        inline.cardBranchPayableKurus,
        `PayTR'a giden tutar ayrıştı: ${label}`
      );
    } else {
      counts.covered++;
      assert.equal(tender.payableKurus, 0, `karşılanan siparişte tahsilat ayrıştı: ${label}`);
    }

    assert.equal(
      tender.giftCardAmountKurus,
      inline.giftCardAmountKurus,
      `hediye kartı tutarı ayrıştı: ${label}`
    );
    assert.equal(
      tender.havaleDiscountKurus,
      inline.havaleDiscountKurus,
      `havale indirimi ayrıştı: ${label}`
    );
    assert.equal(
      tender.fullyCoveredByGiftCard,
      inline.fullyCovered,
      `tam karşılama ayrıştı: ${label}`
    );
    assert.equal(
      recordedPaymentMethod(args.paymentMethod, tender),
      inline.paymentMethod,
      `kaydedilen ödeme yöntemi ayrıştı: ${label}`
    );
  }
  return counts;
}

console.log("tahsilat zinciri — /api/orders denkliği");

const routeSource = fs.readFileSync(ROUTE_PATH, "utf8");

/**
 * Kart/havale dallarının BEKLENEN vaka sayısı: bakiyenin brütü kapatmadığı her
 * (brüt, bakiye) çifti bir ödeme dalına düşer, yöntem başına bir kez. Matris
 * sabitlerinden bağımsız sayılır — `compareWith`in kendi sayacından değil.
 */
const PAYING_PAIRS = AMOUNTS.reduce(
  (total, amountKurus) =>
    total + BALANCES.filter((balanceKurus) => balanceKurus < amountKurus).length,
  0
);

test("tek modül ile satır içi zincir AYNI tutarı üretir", () => {
  // Karşılaştırılan vaka SAYISI da sınanır: matris bir gün daralırsa, boş
  // dönen bir döngü sessizce "geçti" demesin.
  const counts = compareWith(extractInlineChain(routeSource));
  assert.equal(counts.compared, AMOUNTS.length * BALANCES.length * METHODS.length);
  // Dal başına sayı da pinli: matris bir gün yalnız karşılanan vakalar
  // üretirse, iki tutar ifadesinden hiçbiri ölçülmemiş olurdu ve mutasyon
  // testleri sessizce yeşile dönerdi.
  assert.equal(PAYING_PAIRS, 31, "matris ödeme dallarını beklendiği kadar üretmiyor");
  assert.equal(counts.card, PAYING_PAIRS, "kart dalı (PayTR tutarı) ölçülmedi");
  assert.equal(counts.bank, PAYING_PAIRS, "havale dalı ölçülmedi");
  assert.equal(counts.covered, counts.compared - 2 * PAYING_PAIRS);
});

test("indirim brüte kayarsa denklik kırılır", () => {
  const drifted = routeSource.replace(
    "calculateHavaleDiscount(amountKurus - giftCardAmountKurus)",
    "calculateHavaleDiscount(amountKurus)"
  );
  assert.notEqual(drifted, routeSource, "mutasyon kaynağı değiştirmedi");
  // Hata mesajı da sınanır: testin bir ÇIKARIM hatasıyla değil, gerçek bir
  // tutar ayrışmasıyla kırmızıya döndüğünden emin olmak için.
  assert.throws(() => compareWith(extractInlineChain(drifted)), /ayrıştı: /);
});

test("kart tutarı tavanlanmazsa denklik kırılır", () => {
  const drifted = routeSource.replace(
    "Math.min(card.balanceKurus, amountKurus)",
    "card.balanceKurus"
  );
  assert.notEqual(drifted, routeSource, "mutasyon kaynağı değiştirmedi");
  // Hata mesajı da sınanır: testin bir ÇIKARIM hatasıyla değil, gerçek bir
  // tutar ayrışmasıyla kırmızıya döndüğünden emin olmak için.
  assert.throws(() => compareWith(extractInlineChain(drifted)), /ayrıştı: /);
});

test("hediye kartı tahsilattan düşmezse denklik kırılır", () => {
  const drifted = routeSource.replace(
    "amountKurus - giftCardAmountKurus - havaleDiscountKurus",
    "amountKurus - havaleDiscountKurus"
  );
  assert.notEqual(drifted, routeSource, "mutasyon kaynağı değiştirmedi");
  // Hata mesajı da sınanır: testin bir ÇIKARIM hatasıyla değil, gerçek bir
  // tutar ayrışmasıyla kırmızıya döndüğünden emin olmak için.
  assert.throws(() => compareWith(extractInlineChain(drifted)), /ayrıştı: /);
});

test("PayTR'a BRÜT giderse denklik kırılır (kart dalı)", () => {
  // Tasarımın birinci riski (§5.2): kart dalının tahsil edilen tutarı brüte
  // kayarsa hediye kartı rezerve EDİLİR ama müşteriden tamamı çekilir — sessiz
  // ÇİFTE TAHSİLAT. Webhook tutar farkını yalnız loglar, ödemeyi reddetmez
  // (`api/webhooks/paytr/route.ts`), yani üretimde tek uyarı bu testtir.
  // Mutasyon `const`lı TAM satırı hedefler: `amountKurus - giftCardAmountKurus`
  // alt dizisi route.ts'te başka yerlerde de geçiyor (:891 analitik değeri).
  const drifted = routeSource.replace(
    "const paymentAmountKurus = amountKurus - giftCardAmountKurus;",
    "const paymentAmountKurus = amountKurus;"
  );
  assert.notEqual(drifted, routeSource, "mutasyon kaynağı değiştirmedi");
  // Hata mesajı da sınanır: testin bir ÇIKARIM hatasıyla değil, gerçek bir
  // tutar ayrışmasıyla kırmızıya döndüğünden emin olmak için.
  assert.throws(() => compareWith(extractInlineChain(drifted)), /ayrıştı: /);
});

test("zincir yeniden adlandırılırsa test SESSİZ kalmaz, patlar", () => {
  const renamed = routeSource.replaceAll("giftCardAmountKurus", "giftKurus");
  assert.notEqual(renamed, routeSource, "mutasyon kaynağı değiştirmedi");
  assert.throws(() => extractInlineChain(renamed), /tam bir atama bekleniyordu/);
});

test("kart dalının tutarı yeniden adlandırılırsa test SESSİZ kalmaz, patlar", () => {
  // PayTR tutarının ÇIKARIMI da sınanır: ifade bulunamazsa test sessizce
  // atlamak yerine patlamalı, yoksa kart dalı yine nöbetsiz kalır.
  const renamed = routeSource.replaceAll("paymentAmountKurus", "payKurus");
  assert.notEqual(renamed, routeSource, "mutasyon kaynağı değiştirmedi");
  assert.throws(() => extractInlineChain(renamed), /tam bir tanım bekleniyordu/);
});

console.log(
  failures === 0
    ? "\n✅ quote-tender: all checks passed"
    : `\n❌ quote-tender: ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
