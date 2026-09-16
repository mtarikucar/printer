/**
 * Model yükleme politikası (P2-C1/P2-C2) — saf mantık testleri, DB gerekmez.
 *
 * Kapsam:
 *  - aşama matrisi (hangi sipariş hangi aşamada yakalanır, öncelik sırası),
 *  - gerekçe zorunluluğu (üretici `accepted`'ın ötesindeyse şart),
 *  - reddedilmiş ve iade edilmiş siparişte yüklemenin reddi,
 *  - QC sıfırlama kuralı ve kargo kapısıyla atomikliği (kaynak taraması),
 *  - `meshy_auto` kaynağının yapışkanlığı (müşteri onay kapısı düşmesin),
 *  - QC fotoğrafının sürüm damgası (migration 0055) ve geri alınabilir çifti.
 *
 * Çalıştırma: npx tsx scripts/test-order-model-policy.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  QC_RESET_MANUFACTURER_STATUSES,
  modelUploadAllowed,
  modelUploadRequiresNote,
  modelUploadSideEffects,
  modelUploadStage,
  nextModelSource,
  qcPhotosMatchCurrentRevision,
  qcRoundPrintProof,
  type ModelUploadOrderShape,
  type ModelUploadStage,
} from "../src/lib/config/order-model-policy";
import {
  REVISION_LOCKED_STAGES,
  resolveCurrentRevision,
  revisionLockedByStage,
} from "../src/lib/config/order-model";
import {
  manufacturerOrderStatusEnum,
  orderStatusEnum,
  painterOrderStatusEnum,
  qcPhotos,
} from "../src/lib/db/schema";

const REPO_ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (e) {
    fail++;
    failures.push(`${name}: ${(e as Error).message}`);
    console.log(`✗ ${name}`);
  }
}

/** Varsayılan: ödenmiş, üreticisiz, boyacısız sipariş. */
function o(p: Partial<ModelUploadOrderShape> = {}): ModelUploadOrderShape {
  return {
    status: "paid",
    manufacturerStatus: null,
    painterStatus: null,
    paymentStatus: "succeeded",
    ...p,
  };
}

// ─── İzin: yalnız reddedilmiş ve iade edilmiş sipariş dışarıda ──────────────

check("reddedilmiş ve iade dışında HER durumda model yüklenebilir", () => {
  for (const status of orderStatusEnum.enumValues) {
    const allowed = modelUploadAllowed(o({ status }));
    assert.equal(allowed, status !== "rejected", `${status} için izin ${allowed}`);
  }
});

check("iade edilmiş sipariş her durumda reddedilir", () => {
  for (const status of orderStatusEnum.enumValues) {
    assert.equal(modelUploadAllowed(o({ status, paymentStatus: "refunded" })), false, status);
    assert.equal(modelUploadStage(o({ status, paymentStatus: "refunded" })), "blocked", status);
  }
});

check("reddedilmiş sipariş 'blocked' aşamasındadır", () => {
  assert.equal(modelUploadStage(o({ status: "rejected" })), "blocked");
  // Üretim ilerlemiş görünse bile ret kazanır.
  assert.equal(
    modelUploadStage(o({ status: "rejected", manufacturerStatus: "printing" })),
    "blocked"
  );
});

check("'succeeded' ŞARTI yok: başka ödeme durumları yüklemeyi dondurmaz", () => {
  for (const ps of ["pending_havale", "zero", null]) {
    assert.equal(modelUploadAllowed(o({ paymentStatus: ps })), true, String(ps));
  }
});

// ─── Aşama matrisi ──────────────────────────────────────────────────────────

const MATRIX: Array<[string, Partial<ModelUploadOrderShape>, ModelUploadStage]> = [
  ["ödenmiş, atanmamış", { status: "paid" }, "before_production"],
  ["model bekliyor", { status: "awaiting_model" }, "before_production"],
  ["incelemede", { status: "review" }, "before_production"],
  ["onaylı, atanmamış", { status: "approved", manufacturerStatus: "unassigned" }, "before_production"],
  ["üreticiye atandı", { status: "approved", manufacturerStatus: "assigned" }, "before_production"],
  ["üretici kabul etti", { status: "approved", manufacturerStatus: "accepted" }, "before_production"],
  ["müşteri onayı bekleniyor", { status: "awaiting_customer_approval" }, "awaiting_customer_approval"],
  ["üretici basıyor", { status: "printing", manufacturerStatus: "printing" }, "printing"],
  ["admin kendi basıyor (üreticisiz)", { status: "printing" }, "printing"],
  ["baskı bitti", { status: "printing", manufacturerStatus: "printed" }, "printed_or_qc"],
  ["QC bekliyor", { status: "quality_check", manufacturerStatus: "qc_pending" }, "printed_or_qc"],
  ["QC reddedildi", { status: "quality_check", manufacturerStatus: "qc_rejected" }, "printed_or_qc"],
  ["QC onaylandı", { status: "quality_check", manufacturerStatus: "qc_approved" }, "printed_or_qc"],
  ["boyacıya atandı", { status: "quality_check", painterStatus: "assigned" }, "painting"],
  ["boyanıyor", { status: "painting", painterStatus: "painting" }, "painting"],
  ["boyacı QC'sinde", { status: "painting", painterStatus: "qc_approved" }, "painting"],
  ["kargolandı", { status: "shipped", manufacturerStatus: "shipped" }, "shipped_or_delivered"],
  ["boyacı kargoladı", { status: "shipped", painterStatus: "shipped" }, "shipped_or_delivered"],
  ["teslim edildi", { status: "delivered" }, "shipped_or_delivered"],
];

check("aşama matrisi", () => {
  for (const [name, shape, want] of MATRIX) {
    assert.equal(modelUploadStage(o(shape)), want, `${name} → ${modelUploadStage(o(shape))}`);
  }
});

check("öncelik: parça boyacıdaysa üreticinin QC'si aşamayı belirlemez", () => {
  // Üretici işini bitirdi (qc_approved) ve parçayı boyacıya verdi: QC sıfırlama
  // DEĞİL, boyacı bildirimi doğru cevaptır.
  const stage = modelUploadStage(
    o({ status: "painting", manufacturerStatus: "qc_approved", painterStatus: "painting" })
  );
  assert.equal(stage, "painting");
  assert.equal(modelUploadSideEffects(stage).resetsQc, false);
});

check("öncelik: kargo her şeyi yener", () => {
  assert.equal(
    modelUploadStage(
      o({ status: "shipped", manufacturerStatus: "qc_approved", painterStatus: "shipped" })
    ),
    "shipped_or_delivered"
  );
});

check("boyacı 'unassigned' ise boyama aşaması değildir", () => {
  assert.equal(
    modelUploadStage(o({ status: "printing", manufacturerStatus: "printing", painterStatus: "unassigned" })),
    "printing"
  );
});

check("her aşama sabiti gerçek enum değerlerinden türer", () => {
  const mfg = manufacturerOrderStatusEnum.enumValues as readonly string[];
  for (const s of QC_RESET_MANUFACTURER_STATUSES) {
    assert.ok(mfg.includes(s), `${s} manufacturer_order_status değeri değil`);
  }
  const painter = painterOrderStatusEnum.enumValues as readonly string[];
  for (const s of ["assigned", "painting", "painted", "qc_approved", "shipped"]) {
    assert.ok(painter.includes(s), `${s} painter_order_status değeri değil`);
  }
});

// ─── QC sıfırlama kuralı ────────────────────────────────────────────────────

check("QC YALNIZ 'printed_or_qc' aşamasında sıfırlanır", () => {
  const stages: ModelUploadStage[] = [
    "before_production",
    "printing",
    "printed_or_qc",
    "painting",
    "awaiting_customer_approval",
    "shipped_or_delivered",
    "blocked",
  ];
  for (const s of stages) {
    assert.equal(modelUploadSideEffects(s).resetsQc, s === "printed_or_qc", s);
  }
});

check("sıfırlama listesindeki her üretici durumu 'printed_or_qc'ye düşer", () => {
  for (const manufacturerStatus of QC_RESET_MANUFACTURER_STATUSES) {
    const stage = modelUploadStage(o({ status: "quality_check", manufacturerStatus }));
    assert.equal(stage, "printed_or_qc", manufacturerStatus);
    assert.equal(modelUploadSideEffects(stage).resetsQc, true, manufacturerStatus);
  }
  // Kargolanmış üretici listede DEĞİL: geri alınacak üretim kalmadı.
  assert.ok(!QC_RESET_MANUFACTURER_STATUSES.includes("shipped"));
});

check("aşama başına diğer yan etkiler", () => {
  const printing = modelUploadSideEffects("printing");
  assert.equal(printing.needsManufacturerAck, true);
  assert.equal(printing.resetsQc, false);

  const printed = modelUploadSideEffects("printed_or_qc");
  assert.equal(printed.needsManufacturerAck, true);

  const painting = modelUploadSideEffects("painting");
  assert.equal(painting.notifiesPainter, true);
  assert.equal(painting.recordOnly, false);

  const approval = modelUploadSideEffects("awaiting_customer_approval");
  assert.equal(approval.newApprovalRound, true);
  assert.equal(approval.requiresNote, false);

  const shipped = modelUploadSideEffects("shipped_or_delivered");
  assert.equal(shipped.recordOnly, true);
  assert.equal(shipped.resetsQc, false);
  assert.equal(shipped.needsManufacturerAck, false);

  const blocked = modelUploadSideEffects("blocked");
  for (const v of [
    blocked.resetsQc,
    blocked.needsManufacturerAck,
    blocked.notifiesPainter,
    blocked.newApprovalRound,
    blocked.recordOnly,
    blocked.requiresNote,
  ]) {
    assert.equal(v, false);
  }
  for (const s of Object.keys({} as Record<string, never>)) void s;
});

check("her aşamanın Türkçe uyarısı vardır ve kopya döner", () => {
  const stages: ModelUploadStage[] = [
    "before_production",
    "printing",
    "printed_or_qc",
    "painting",
    "awaiting_customer_approval",
    "shipped_or_delivered",
    "blocked",
  ];
  for (const s of stages) {
    assert.ok(modelUploadSideEffects(s).warningTr.length > 20, s);
  }
  // Çağıran tabloyu bozamaz: her çağrı taze kopya.
  const first = modelUploadSideEffects("printing");
  first.resetsQc = true;
  assert.equal(modelUploadSideEffects("printing").resetsQc, false);
});

// ─── Gerekçe zorunluluğu ────────────────────────────────────────────────────

check("gerekçe, üretici 'accepted'ın ÖTESİNE geçtiğinde şart", () => {
  const notRequired: Partial<ModelUploadOrderShape>[] = [
    { status: "paid" },
    { status: "awaiting_model" },
    { status: "approved", manufacturerStatus: "unassigned" },
    { status: "approved", manufacturerStatus: "assigned" },
    { status: "approved", manufacturerStatus: "accepted" },
    { status: "awaiting_customer_approval" },
  ];
  for (const shape of notRequired) {
    assert.equal(modelUploadRequiresNote(o(shape)), false, JSON.stringify(shape));
  }
  const required: Partial<ModelUploadOrderShape>[] = [
    { status: "printing", manufacturerStatus: "printing" },
    { status: "printing", manufacturerStatus: "printed" },
    { status: "quality_check", manufacturerStatus: "qc_pending" },
    { status: "quality_check", manufacturerStatus: "qc_approved" },
    { status: "painting", painterStatus: "painting" },
    { status: "shipped" },
  ];
  for (const shape of required) {
    assert.equal(modelUploadRequiresNote(o(shape)), true, JSON.stringify(shape));
  }
});

// ─── Müşteri onay kapısı: model kaynağı yapışkan ────────────────────────────

check("admin yüklemesi meshy_auto kaynağını DÜŞÜRMEZ (onay kapısı korunur)", () => {
  assert.equal(nextModelSource("meshy_auto", "admin_upload"), "meshy_auto");
  assert.equal(nextModelSource("admin_upload", "admin_upload"), "admin_upload");
  assert.equal(nextModelSource(null, "admin_upload"), "admin_upload");
  // Otomatik üretim kendi kaynağını yazar.
  assert.equal(nextModelSource("admin_upload", "meshy_auto"), "meshy_auto");
  assert.equal(nextModelSource(null, "meshy_auto"), "meshy_auto");
});

// ─── QC fotoğrafı ↔ sürüm damgası (migration 0055) ──────────────────────────

check("qc_photos.model_revision kolonu şemada var", () => {
  assert.equal(qcPhotos.modelRevision.name, "model_revision");
  assert.equal(qcPhotos.modelRevision.notNull, false, "damgasız eski satırlar için NULL kabul etmeli");
});

check("eski sürümün fotoğrafları geçerli sürümle eşleşmez", () => {
  assert.equal(qcPhotosMatchCurrentRevision([{ modelRevision: 2 }], 3), false);
  assert.equal(qcPhotosMatchCurrentRevision([{ modelRevision: 3 }], 3), true);
  assert.equal(
    qcPhotosMatchCurrentRevision([{ modelRevision: 3 }, { modelRevision: 1 }], 3),
    false
  );
  // DAMGASIZ SATIR KANIT DEĞİLDİR: siparişin daha eski sürümleri varken
  // damgasız tur kendiliğinden geçmez (fail-closed). Eskiden geçiyordu ve bu,
  // damgaları düşüren her geri almayı bir kilit açmaya çeviriyordu.
  assert.equal(qcPhotosMatchCurrentRevision([{ modelRevision: null }], 3), false);
  // Ama "eskisi olamayan" siparişte kilitlemez: tek sürüm (v1) ya da hiç sürüm.
  assert.equal(qcPhotosMatchCurrentRevision([{ modelRevision: null }], 1), true);
  // Hiç sürümü olmayan sipariş (elle açılan iş) her zaman geçer.
  assert.equal(qcPhotosMatchCurrentRevision([{ modelRevision: null }], null), true);
});

check("kanıt hesabı sebebi ADLANDIRIR (ekran ve denetim kaydı için)", () => {
  // Kapı tek boole döner; sebep ayrı durur ki ret cümlesi ve denetim notu
  // verinin söylemediği bir şeyi iddia etmesin ("damgasız" ≠ "eski baskı").
  assert.equal(
    qcRoundPrintProof({ photos: [{ modelRevision: 1 }], currentRevision: 2 }).failure,
    "stale"
  );
  assert.equal(
    qcRoundPrintProof({ photos: [{ modelRevision: null }], currentRevision: 2 }).failure,
    "unstamped"
  );
  assert.equal(qcRoundPrintProof({ photos: [], currentRevision: 1 }).failure, "no_photos");
  assert.equal(
    qcRoundPrintProof({ photos: [{ modelRevision: 2 }], currentRevision: null, revisionReadFailed: true })
      .failure,
    "revision_unreadable"
  );
  // Boole yüz ile kanıt AYNI hesaptır: ayrışırlarsa ekran ile uç ayrışır.
  for (const current of [null, 1, 2, 3]) {
    for (const photos of [
      [{ modelRevision: null }],
      [{ modelRevision: 1 }],
      [{ modelRevision: 3 }, { modelRevision: null }],
    ]) {
      assert.equal(
        qcPhotosMatchCurrentRevision(photos, current),
        qcRoundPrintProof({ photos, currentRevision: current }).proven,
        `ayrışma: ${JSON.stringify(photos)} @ v${current}`
      );
    }
  }
});

// ─── Saflık ve tek kaynak (kaynak taraması) ─────────────────────────────────

check("politika modülü saf: server-only yok, DB import etmiyor", () => {
  const src = read("src/lib/config/order-model-policy.ts");
  assert.doesNotMatch(src, /^\s*import\s+"server-only"/m);
  assert.doesNotMatch(src, /from "@\/lib\/db"/);
});

check("yükleme route'u kendi durum listesini TUTMAZ, politikayı çağırır", () => {
  const src = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.doesNotMatch(src, /const UPLOADABLE/, "route hâlâ kendi durum listesini tutuyor");
  assert.doesNotMatch(src, /Sipariş model beklemiyor/, "durum listesi reddi hâlâ var");
  assert.match(src, /modelUploadAllowed\(/);
  assert.match(src, /modelUploadStage\(/);
  assert.match(src, /modelUploadSideEffects\(/);
});

check("route P2-C2 sözleşmesini döner: stage + appliedSideEffects", () => {
  const src = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  for (const key of [
    "qcReset",
    "qcRound",
    "approvalRoundOpened",
    "manufacturerAckRequired",
    "painterNotified",
  ]) {
    assert.match(src, new RegExp(`${key}`), key);
  }
  assert.match(src, /appliedSideEffects: applied/);
  // Uygulanan yan etki UYDURULMAZ: rapor edilen değer servisin/duyurunun
  // gerçek sonucundan gelir.
  assert.match(src, /applied\.qcReset = reset\.qcReset/);
  assert.match(src, /applied\.manufacturerAckRequired = announced\.manufacturerAckRequired/);
});

check("gerekçe zorunluluğu sunucuda uygulanır", () => {
  const src = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.match(src, /effects\.requiresNote && !note/);
});

check("sürüm notu ARTIK yazılıyor (kolon boş kalmıyor)", () => {
  const src = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.match(src, /note: note \|\| undefined/);
});

check("denetim satırı yükleme ANINDAKİ üç durumu da kaydeder", () => {
  const src = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.match(src, /durum=\$\{snapshot\.status\}/);
  assert.match(src, /üretici=\$\{snapshot\.manufacturerStatus/);
  assert.match(src, /boyacı=\$\{snapshot\.painterStatus/);
});

check("sürüm yönetimi: geçerli yapma ve silme uçları var", () => {
  const src = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.match(src, /export async function PATCH/);
  assert.match(src, /export async function DELETE/);
  assert.match(src, /setCurrentModelRevision\(/);
  assert.match(src, /deleteModelRevision\(/);
  assert.match(src, /ModelRevisionInUseError/);
});

check("QC sıfırlaması atomik: tek koşullu UPDATE + iade koruması", () => {
  const src = read("src/lib/services/order-model.ts");
  const fn = src.slice(src.indexOf("export async function resetQcForNewRevision"));
  assert.match(fn, /inArray\(\s*orders\.manufacturerStatus/, "durum süzgeci UPDATE'in WHERE'inde değil");
  assert.match(fn, /notRefundedGuard\(\)/);
  assert.match(fn, /manufacturerStatus: "printing"/);
  assert.match(fn, /qcRound: sql`\$\{orders\.qcRound\} \+ 1`/);
  // Ön okuma + sonra yazma DEĞİL: dönen satır sıfırlamanın gerçekten olduğunu
  // söyler (kargo yarışı).
  assert.match(fn, /\.returning\(\{ qcRound: orders\.qcRound \}\)/);
});

check("kargo kapısı QC onayını okur: sıfırlama onu atomik olarak geri alır", () => {
  const ship = read("src/app/api/manufacturer/orders/[id]/ship/route.ts");
  assert.match(ship, /eq\(orders\.manufacturerStatus, "qc_approved"\)/);
});

check("bekleyen QC fotoğrafı reddi TEK yerde: qc-reject servisi çağırır", () => {
  const route = read("src/app/api/admin/orders/[id]/qc-reject/route.ts");
  assert.match(route, /rejectPendingQcPhotos\(/);
  assert.doesNotMatch(route, /update\(qcPhotos\)/, "route kendi kopyasını tutuyor");
});

check("admin yüklemesi dönme videosunu SİLMEZ", () => {
  const svc = read("src/lib/services/order-model.ts");
  assert.match(svc, /touchesTurntable/);
  const route = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.doesNotMatch(route, /turntableKey:/, "route turntable yazıyor; meshy_auto videosu silinir");
});

// ─── Geri getirme x QC kapısı: TERK EDİLEN sürüm onaydan geçemez ───────────
//
// Burası iki modülün KESİŞİMİ: ayrı ayrı doğru oldukları hâlde birleşimleri
// yanlış olabiliyordu. "Bu sürümü geçerli yap" artık kaynak sürümün dosya
// kümesini EN ÜSTE yeni bir sürüm olarak yayımlıyor (services/order-model.ts ·
// setCurrentModelRevision) ve "geçerli sürüm" tek kuralla EN YÜKSEK numaradır
// (config/order-model.ts · resolveCurrentRevision). QC kapısı da aynı sayıyı
// okuduğu için admin iyi bir sürüme döndüğünde TERK EDİLEN sürümün turu
// kendiliğinden eskir. Eski tasarımda (yalnız siparişin canlı kolonlarını
// oynatmak) tam tersi oluyordu: terk edilen sürüm "güncel" sayılıp onaydan
// geçiyor, geri getirilen sürümün fotoğrafları eski diye reddediliyordu.

check("geri getirme sonrası TERK EDİLEN sürümün turu QC'den geçemez", () => {
  // v3 yanlıştı; admin v2'yi geri getirdi → v2'nin kümesi v4 olarak yayımlandı.
  const current = resolveCurrentRevision([
    { revision: 1 },
    { revision: 2 },
    { revision: 3 },
    { revision: 4 },
  ]);
  assert.equal(current, 4, "geçerli sürüm en yüksek numara değil");
  assert.equal(
    qcPhotosMatchCurrentRevision([{ modelRevision: 3 }], current),
    false,
    "terk edilen v3 baskısının fotoğrafları onaydan geçiyor"
  );
  assert.equal(qcPhotosMatchCurrentRevision([{ modelRevision: 4 }], current), true);
  // Turda TEK bir eski fotoğraf bile yeterli: karışık tur onaylanamaz.
  assert.equal(
    qcPhotosMatchCurrentRevision([{ modelRevision: 4 }, { modelRevision: 3 }], current),
    false
  );
});

check("QC damgası ile silme nöbetçisi AYNI sürüm kuralını okur", () => {
  // Kural ikiye ayrılırsa biri terk edilmiş sürümü izler ve kapı sessizce
  // gevşer; bu tam olarak bir kez yaşandı.
  const revSvc = read("src/lib/services/order-model-revision.ts");
  const stamp = revSvc.slice(revSvc.indexOf("export async function currentOrderModelRevision"));
  assert.match(stamp, /currentModelRevision\(/, "damga okuyucusu kendi taramasını yapıyor");

  const svc = read("src/lib/services/order-model.ts");
  const decide = svc.slice(svc.indexOf("export async function currentModelRevision"));
  assert.match(
    decide.slice(0, 600),
    /max\(|resolveCurrentRevision\(/,
    "tek merci kuralı uygulamıyor"
  );
  const del = svc.slice(svc.indexOf("export async function deleteModelRevision"));
  assert.match(del, /resolveCurrentRevision\(/, "silme nöbetçisi kendi kuralını yazıyor");
});

check("silme kilidi: fiziksel baskı birinin elindeyken sürüm silinemez", () => {
  // Aşama sınıflandırması EKSİKSİZ olmalı: yeni bir aşama eklenirse burada
  // sınıflandırılmadan geçemez, yoksa "kilitli mi" sorusu sessizce hayır der.
  const LOCKED: ModelUploadStage[] = [
    "printing",
    "printed_or_qc",
    "painting",
    "shipped_or_delivered",
  ];
  const FREE: ModelUploadStage[] = ["before_production", "awaiting_customer_approval", "blocked"];
  for (const stage of LOCKED) assert.equal(revisionLockedByStage(stage), true, stage);
  for (const stage of FREE) assert.equal(revisionLockedByStage(stage), false, stage);
  assert.deepEqual(
    [...REVISION_LOCKED_STAGES].sort(),
    [...LOCKED].sort(),
    "config'teki kilitli aşama listesi bu testten ayrışmış"
  );
  // Aşama sipariş DURUMUNDAN türer: admin'in kendi bastığı (üreticisi olmayan)
  // sipariş de kilitlidir — üretici durumunu tek başına okuyan nöbetçi onu
  // görmüyordu ve sürüm baskı sürerken silinebiliyordu.
  assert.equal(revisionLockedByStage(modelUploadStage(o({ status: "printing" }))), true);
  assert.equal(
    revisionLockedByStage(modelUploadStage(o({ status: "paid" }))),
    false,
    "üretim başlamadan silme kilitlenmiş"
  );
});

// ─── Migration 0055: geri alınabilir çift ───────────────────────────────────

check("0055 geri alınabilir çift olarak var ve journal'da kayıtlı", () => {
  const up = "drizzle/0055_qc_photo_model_revision.sql";
  const down = "drizzle/0055_qc_photo_model_revision.down.sql";
  assert.ok(existsSync(join(REPO_ROOT, up)), `${up} yok`);
  assert.ok(existsSync(join(REPO_ROOT, down)), `${down} yok`);
  assert.ok(existsSync(join(REPO_ROOT, "drizzle/meta/0055_snapshot.json")), "snapshot yok");

  const upSql = read(up);
  assert.match(upSql, /SET lock_timeout/);
  assert.match(upSql, /ADD COLUMN IF NOT EXISTS "model_revision"/);

  const downSql = read(down);
  assert.match(downSql, /DROP COLUMN IF EXISTS "model_revision"/);
  // Repo kuralı: down, drizzle'ın kendi kayıt satırını silmeyi hatırlatır.
  assert.match(downSql, /DELETE FROM drizzle\.__drizzle_migrations/);

  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const entry = journal.entries.find((e) => e.idx === 55);
  assert.ok(entry, "journal'da 0055 kaydı yok");
  assert.equal(entry!.tag, "0055_qc_photo_model_revision");
  // Silinen satır KENDİ etiketidir. "En yeni satırı sil" tarifi burada yanlış:
  // üstünde 0056 var, o tarif 0056'nın kaydını silip 0055'i kalıcı olarak
  // uygulanmamış bırakırdı (ayrıntı: scripts/test-qc-photo-revision.ts).
  // Yasak olan TARİFTİR, cümle değil: dosya migrator kuralını anlatırken aynı
  // sorguyu alıntılıyor, o yüzden yalnız DELETE'in kendisine bakılır.
  assert.doesNotMatch(
    downSql,
    /DELETE FROM drizzle\.__drizzle_migrations[\s\S]{0,240}ORDER BY created_at DESC LIMIT 1/i
  );
  assert.match(
    downSql,
    new RegExp(`created_at = ${entry!.when}\\b`),
    "down kendi kayıt satırını silmiyor"
  );
});

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail > 0) {
  console.log("\nBaşarısızlar:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
