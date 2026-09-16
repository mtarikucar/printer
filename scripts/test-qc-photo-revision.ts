/**
 * QC fotoğrafının sürüm damgası (migration 0055) — KANIT kuralı, geri
 * alınabilirlik ve backfill sadakati. DB gerekmez: saf mantık + migration ve
 * kaynak taraması.
 *
 * Bu dosyanın pinlediği TEK cümle:
 *   DAMGASIZ BİR FOTOĞRAF, GÜNCEL SÜRÜMÜN BASILDIĞININ KANITI DEĞİLDİR.
 *
 * Damgasızlık "eski değil" demek değil, "bilinmiyor" demektir. Kural bu yüzden
 * FAIL-CLOSED'dur: siparişin birden çok sürümü varken damgasız tur
 * kendiliğinden onaylanmaz. Bunun sebebi yalnız titizlik değil, bir SALDIRI
 * YÜZEYİDİR: damgasızlık geçseydi, damgaları düşüren her şey (başta 0055'in
 * kendi geri alması) bayat bir baskının kilidini açardı — yani bir migration'ı
 * geri almak güvenlik kapısını kaldırırdı. Aşağıdaki "geri alma hiçbir turu
 * açamaz" kontrolü tam olarak bunu pinler.
 *
 * Çalıştırma: npx tsx scripts/test-qc-photo-revision.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  qcPhotosMatchCurrentRevision,
  qcRoundPrintProof,
  qcRoundProofErrorTr,
  QC_PROOF_FAILURE_LABEL_TR,
} from "../src/lib/config/order-model-policy";

const REPO_ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/**
 * SQL'in YÜRÜTÜLEN gövdesi: `--` yorum satırları atılır.
 *
 * Aşağıdaki kurallar cümlelere bakar, açıklamaya değil. 0055'in açıklaması
 * TERK EDİLEN kuralı ("max(revision) ...", "now() / random() yok") adıyla
 * anlatıyor — ham metni tarayan bir kontrol, kendi gerekçesini ihlal sayardı.
 */
const sqlBody = (rel: string) =>
  read(rel)
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

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

const UP = "drizzle/0055_qc_photo_model_revision.sql";
const DOWN = "drizzle/0055_qc_photo_model_revision.down.sql";
const QC_APPROVE = "src/app/api/admin/orders/[id]/qc-approve/route.ts";

/** Damga kümesi üreteci: testlerin üzerinde gezdiği tur şekilleri. */
type Round = { modelRevision: number | null }[];
const ROUNDS: Round[] = [
  [],
  [{ modelRevision: null }],
  [{ modelRevision: null }, { modelRevision: null }],
  [{ modelRevision: 1 }],
  [{ modelRevision: 2 }],
  [{ modelRevision: 3 }],
  [{ modelRevision: 1 }, { modelRevision: null }],
  [{ modelRevision: 3 }, { modelRevision: null }],
  [{ modelRevision: 3 }, { modelRevision: 1 }],
  [{ modelRevision: 4 }, { modelRevision: 4 }],
];
const CURRENTS: (number | null)[] = [null, 1, 2, 3, 4, 5];

// ─── 1. Damgasız fotoğraf KANIT değildir (FAIL-CLOSED) ──────────────────────

check("damgasız tur, birden çok sürümlü siparişte KENDİLİĞİNDEN onaylanamaz", () => {
  for (const current of [2, 3, 4, 5]) {
    const proof = qcRoundPrintProof({ photos: [{ modelRevision: null }], currentRevision: current });
    assert.equal(proof.proven, false, `v${current}: damgasız tur kanıt sayılıyor`);
    assert.equal(proof.failure, "unstamped");
    assert.equal(
      qcPhotosMatchCurrentRevision([{ modelRevision: null }], current),
      false,
      "boole yüz ile kanıt ayrışmış"
    );
  }
});

check("damgasızlık, ESKİSİ OLAMAYAN siparişte kapıyı kilitlemez", () => {
  // Tek sürümlü (v1) sipariş: ortada daha eski bir baskı YOKTUR, yani
  // damgasızlık gerçek bir belirsizlik değildir. 0055 ÖNCESİ satırların hepsi
  // bu hâldedir (ikinci sürüm ancak 0055 ile gelen akışta yüklenir), yani
  // "geçmiş siparişler topluca kilitlenir" korkusunun cevabı budur.
  assert.equal(qcPhotosMatchCurrentRevision([{ modelRevision: null }], 1), true);
  // Hiç sürüm kaydı olmayan sipariş (elle açılan iş) da geçer.
  assert.equal(qcPhotosMatchCurrentRevision([{ modelRevision: null }], null), true);
  assert.equal(
    qcRoundPrintProof({ photos: [{ modelRevision: null }], currentRevision: null }).failure,
    null
  );
});

check("damgalı-eski satır, damgasızlıktan ÖNCE gelir (sebep doğru adlandırılır)", () => {
  const proof = qcRoundPrintProof({
    photos: [{ modelRevision: null }, { modelRevision: 1 }],
    currentRevision: 3,
  });
  assert.equal(proof.proven, false);
  assert.equal(proof.failure, "stale", "kanıtın kendisi varken 'bilinmiyor' denmiş");
  assert.equal(proof.oldestStampedRevision, 1, "uyarıda gösterilecek sürüm en eski damga değil");
  assert.equal(proof.unstampedCount, 1);
});

check("fotoğrafsız tur ve OKUNAMAYAN sürüm de kanıtlanamaz sayılır", () => {
  const empty = qcRoundPrintProof({ photos: [], currentRevision: 1 });
  assert.equal(empty.proven, false);
  assert.equal(empty.failure, "no_photos");

  // Okuma arızası ile "sürüm yok" AYNI ŞEY DEĞİLDİR: null kıyaslanacak bir şey
  // olmadığı için turu serbest bırakırdı, arıza ise bilinmezliktir.
  const unreadable = qcRoundPrintProof({
    photos: [{ modelRevision: 7 }],
    currentRevision: null,
    revisionReadFailed: true,
  });
  assert.equal(unreadable.proven, false);
  assert.equal(unreadable.failure, "revision_unreadable");
  assert.equal(
    qcRoundPrintProof({ photos: [{ modelRevision: 7 }], currentRevision: null }).proven,
    true,
    "sürümü olmayan sipariş arıza sayılmış"
  );
});

check("ret cümleleri verinin SÖYLEDİĞİNDEN fazlasını iddia etmez", () => {
  const unstamped = qcRoundProofErrorTr(
    qcRoundPrintProof({ photos: [{ modelRevision: null }], currentRevision: 2 }),
    2
  );
  // Damgasız tura "eski baskı" demek, kaydın söylemediği bir şeydir.
  assert.doesNotMatch(unstamped, /ESKİ modelin baskısı/);
  assert.match(unstamped, /damgası taşımıyor/);
  assert.match(unstamped, /kanıtı değildir/);
  // Admin'i kapının önünde bırakmaz: çıkış yolu cümlede yazar.
  assert.match(unstamped, /gerekçe/i);

  const unreadable = qcRoundProofErrorTr(
    qcRoundPrintProof({ photos: [], currentRevision: null, revisionReadFailed: true }),
    null
  );
  assert.match(unreadable, /okunamadı/);
  assert.match(unreadable, /hiçbir şey değişmedi/);

  // Denetim kaydı etiketi her hâl için ayrı: "eski sürüm onayı" ile "damgasız
  // tur onayı" aynı şey değildir ve kayıt ikisini karıştırmamalı.
  const labels = Object.values(QC_PROOF_FAILURE_LABEL_TR);
  assert.equal(new Set(labels).size, labels.length, "iki hâl aynı etiketi taşıyor");
});

// ─── 2. Kural yalnız SIKILAŞABİLİR (tek yönlü daralma) ──────────────────────

/** 0055'in ilk hâlindeki kural: damgasızlık geçerdi. */
const OLD_RULE = (photos: Round, current: number | null) =>
  current == null ? true : photos.every((p) => p.modelRevision == null || p.modelRevision >= current);

check("yeni kural, eski kuralın REDDETTİĞİ hiçbir turu açmaz", () => {
  for (const photos of ROUNDS) {
    for (const current of CURRENTS) {
      const now = qcPhotosMatchCurrentRevision(photos, current);
      if (now) {
        assert.equal(
          OLD_RULE(photos, current) || photos.length === 0,
          true,
          `gevşeme: ${JSON.stringify(photos)} @ v${current}`
        );
      }
    }
  }
});

check("GERİ ALMA hiçbir turu onaylanabilir yapamaz (damga silinmesi)", () => {
  // 0055'in down'ı kolonu düşürür: bütün damgalar NULL'a döner. Eski kuralda bu
  // bir KİLİT AÇMAydı; yeni kuralda olsa olsa daha çok tur gerekçeye bağlanır.
  for (const photos of ROUNDS) {
    for (const current of CURRENTS) {
      const before = qcPhotosMatchCurrentRevision(photos, current);
      const afterRollback = qcPhotosMatchCurrentRevision(
        photos.map(() => ({ modelRevision: null })),
        current
      );
      if (afterRollback) {
        assert.equal(
          before,
          true,
          `geri alma kilidi açtı: ${JSON.stringify(photos)} @ v${current}`
        );
      }
    }
  }
});

check("uygulama BACKFILL'in doğruluğuna DAYANMAZ", () => {
  // Backfill'in yazabildiği tek değer 1'dir (aşağıdaki sadakat kontrolü bunu
  // pinler). Fail-closed kuralda 1 damgası ile damgasızlık AYNI onaylanabilirlik
  // cevabını verir: backfill hiç çalışmasa da, eksik çalışsa da kapı aynıdır.
  // 0055'i almış bir veritabanında bu dosya zaten yeniden çalışmaz (migrator
  // yalnız journal `when`ine bakar), yani bu özdeşlik teorik değil zorunludur.
  for (const current of CURRENTS) {
    assert.equal(
      qcPhotosMatchCurrentRevision([{ modelRevision: 1 }], current),
      qcPhotosMatchCurrentRevision([{ modelRevision: null }], current),
      `v${current}: backfill damgası kararı değiştiriyor`
    );
  }
  // Ve damga bir şeyi SIKILAŞTIRIRSA bu yalnız sebebin adını değiştirir.
  assert.equal(
    qcRoundPrintProof({ photos: [{ modelRevision: 1 }], currentRevision: 2 }).failure,
    "stale"
  );
  assert.equal(
    qcRoundPrintProof({ photos: [{ modelRevision: null }], currentRevision: 2 }).failure,
    "unstamped"
  );
});

// ─── 3. Yazma yolu ve ekran ─────────────────────────────────────────────────

check("yazma yolu damgasız satır ÜRETMEZ: sürüm okunamazsa 503 ile durur", () => {
  const src = read("src/app/api/manufacturer/orders/[id]/qc-photos/route.ts");
  // Sürüm okunamadığında sessizce damgasız satır yazmak, arızayı kalıcı bir
  // "bilinmiyor"a çevirirdi; uç bunun yerine gürültülü başarısız olur.
  assert.match(src, /model_revision_unavailable/);
  assert.match(src, /status:\s*503/);
  // INSERT damgayı adıyla taşır (damgasız bir yedek yol yok).
  assert.match(src, /modelRevision,/);
});

check("admin ekranı turun neden onaylanamadığını SEBEBİYLE söyler", () => {
  // Bu kontrol bir İFADEYİ değil, DAVRANIŞI pinler.
  //
  // Eski hâli client.tsx'teki tek bir gate ifadesini harfi harfine sabitliyordu
  // (`hasMultipleRevisions && unstampedLiveQcPhotos.length > 0`). O ifade, kapı
  // fail-closed olduktan sonra SAĞLANAMAZ hâle gelmişti: birden çok sürüm +
  // damgasız fotoğraf zaten kanıtı düşürüyor. Yani ekranda kalan tek cümle,
  // dört hâlin hepsine "eski baskı" diyen yanlış cümleydi ve onu düzeltmek bu
  // testi kırıyordu — test, düzeltmenin önünde duruyordu.
  //
  // Pinlenen kural: ekran sebebi VERİDEN okur ve cümleyi uçla ORTAK saf
  // modülden alır; kaydın yazmadığı bir sebebi iddia edemez.
  const client = read("src/app/admin/orders/[id]/client.tsx");
  const page = read("src/app/admin/orders/[id]/page.tsx");

  // 1. Sayfa tek bir boole değil, SEBEBİ de taşır.
  assert.match(page, /qcRoundPrintProof\(/, "sayfa kanıt hesabını çağırmıyor");
  assert.match(page, /qcProof/, "sebep istemciye hiç gönderilmiyor");

  // 2. Ekran sebebi okur ve dört hâli birbirinden AYIRIR.
  assert.match(client, /qcProof/, "ekran sebebi okumuyor");
  for (const failure of ["stale", "unstamped", "no_photos", "revision_unreadable"] as const) {
    assert.match(client, new RegExp(`"${failure}"`), `ekran '${failure}' hâlini ayırmıyor`);
  }

  // 3. Cümle ekranda UYDURULMAZ: uçla aynı saf modüllerden gelir, böylece iki
  //    taraf aynı hâle aynı adı verir.
  assert.match(client, /qcRoundProofErrorTr/, "damgasız/fotoğrafsız cümlesi ekranda uyduruluyor");
  assert.match(client, /staleQcRevisionErrorTr/, "eski sürüm cümlesi ekranda uyduruluyor");

  // 4. Ve o ortak cümleler kaydın söylemediğini iddia ETMEZ: eski OLDUĞU
  //    bilinmeyen turlarda "baskı eskidir" iddiası geçmez. Siparişin daha eski
  //    SÜRÜMLERİ olduğunu söylemek başka şeydir — o, kaydın gerçekten yazdığı
  //    bir olgudur ve damgasız cümlesi tam da bu ayrımı kurar.
  const unprovenRounds: { modelRevision: number | null }[][] = [[{ modelRevision: null }], []];
  for (const photos of unprovenRounds) {
    const proof = qcRoundPrintProof({ photos, currentRevision: 2 });
    assert.equal(proof.proven, false);
    assert.notEqual(proof.failure, "stale", "kanıtsızlık 'eski' hâliyle karışmış");
    assert.doesNotMatch(
      qcRoundProofErrorTr(proof, 2),
      /daha eski bir bask|eski (modelin|sürümün) bask/i,
      `'${proof.failure}' hâli, turun ESKİ bir baskıyı gösterdiğini iddia ediyor`
    );
  }
  // Damgasız hâl, iddia yerine BİLİNMEZLİĞİ söyler.
  assert.match(
    qcRoundProofErrorTr(
      qcRoundPrintProof({ photos: [{ modelRevision: null }], currentRevision: 2 }),
      2
    ),
    /doğrulanamadan|kanıtı değildir/,
    "damgasız tur, 'hangi baskı olduğu doğrulanamıyor' demiyor"
  );

  // 5. Kartta artık dört hâlin hepsine "eski baskı" diyen o tek cümle YOK.
  assert.doesNotMatch(
    client,
    /en az biri GÜNCEL sürümden daha eski/,
    "kart hâlâ her kanıtsız tura 'eski baskı' diyor"
  );

  // 6. Denetimli istisna KAPANMADI ve neyi aştığını söylemeye devam ediyor.
  assert.match(client, /overrideStaleRevision: true/, "bilinçli onay yolu ekrandan kalkmış");
  assert.match(
    client,
    /QC_PROOF_FAILURE_LABEL_TR/,
    "istisna, denetim kaydındaki adıyla anılmıyor"
  );
});

check("qc-approve kanıtlanamayan turu reddeder, istisna DENETİMLİ kalır", () => {
  const src = read(QC_APPROVE);
  assert.match(src, /qcRoundPrintProof\(/, "kanıt hesabı çağrılmıyor");
  // Kapı ekranla ORTAK: sayfa da aynı boole ile süzüyor.
  assert.match(src, /qcPhotosMatchCurrentRevision\(/, "ekranla ortak kapı düşmüş");
  assert.match(src, /overrideStaleRevision !== true/, "bilinçli istisna kapısı yok");
  assert.match(src, /STALE_QC_OVERRIDE_REASON_MIN/, "gerekçe zorunlu değil");
  // Sürüm okuma arızası bir 500 değil, KAPALI bir kapıdır.
  assert.match(src, /revisionReadFailed/, "okuma arızası ayrı ele alınmıyor");
  const read_ = src.indexOf("currentOrderModelRevision(id)");
  const cat = src.indexOf("catch", read_);
  assert.ok(read_ >= 0 && cat >= 0 && cat - read_ < 200, "sürüm okuması try/catch dışında");
  // Ret, UPDATE'ten ÖNCE: kanıtsız tur yazmadan döner.
  const refusal = src.indexOf("status: 409");
  const write = src.indexOf(".update(orders)");
  assert.ok(refusal >= 0 && write >= 0 && refusal < write, "ret UPDATE'ten sonra");
  // Denetim notu hangi HÂL için verildiğini adlandırır ve üreticiye giden
  // cümle damgasız tura "eski baskı" demez.
  assert.match(src, /QC_PROOF_FAILURE_LABEL_TR/, "denetim notu hâli adlandırmıyor");
  assert.match(src, /partnerOverrideNotice/, "partner cümlesi hâle göre değişmiyor");
});

check("qc-approve, FOTOĞRAFLAR okunamadığında da CEVAP verir (sunulan denetim çalışır)", () => {
  // Ölçülen kusur: qc_photos arızasında ekran düz "Onayla"yı kaldırıp gerekçeli
  // onayı AÇIYOR, ama ucun kendi fotoğraf okuması korumasız olduğu için aynı
  // istek 500 + unexpected_error dönüyordu — admin'e sunulan tek çıkış,
  // çalışamayan çıkıştı. Pinlenen kural: kapı KAPALI kalır ama uç cevap verir.
  const src = read(QC_APPROVE);
  const photoRead = src.indexOf(".from(qcPhotos)");
  const tryIdx = src.lastIndexOf("try {", photoRead);
  assert.ok(photoRead >= 0 && tryIdx >= 0, "fotoğraf okuması bulunamadı");
  assert.ok(photoRead - tryIdx < 400, "QC fotoğraf okuması try/catch dışında");
  assert.match(src, /photosReadFailed/, "fotoğraf okuma arızası ayrı ele alınmıyor");
  // FAIL-CLOSED: arıza onayı kendiliğinden geçirmez.
  assert.match(
    src,
    /photosReadFailed\s*\|\|\s*\n?\s*revisionReadFailed/,
    "okunamayan fotoğraf kanıt sayılıyor (fail-open)"
  );
  // Gerekçesiz onayın reddi, arızayı adıyla söyler ve "fotoğrafsız tur" demez.
  assert.match(src, /QC_PHOTOS_UNREADABLE_ERROR/, "arıza için ayrı cümle yok");
  assert.match(src, /status: 503/, "geçici arıza kalıcı bir kural reddi gibi dönüyor");
  assert.doesNotMatch(
    src,
    /photosReadFailed[\s\S]{0,200}Turda hiç QC fotoğrafı yok/,
    "okunamayan tabloya 'fotoğrafsız tur' deniyor"
  );
  // Denetimli istisna bu arızada da ÇALIŞIR ve kaydına kendi adıyla düşer.
  assert.match(src, /QC_PHOTOS_UNREADABLE_LABEL/, "istisna, denetim kaydında hâli adlandırmıyor");
  // Damgalama arızası, YAPILMIŞ işi yapılmamış gibi anlatamaz.
  assert.match(src, /photoStampFailed/, "fotoğraf damgalama arızası ele alınmıyor");
});

check("QC kartı, fotoğrafları OKUNAMAYAN turda 'fotoğrafsız' demez", () => {
  const client = read("src/app/admin/orders/[id]/client.tsx");
  // Kart, arıza hâlinde uçla aynı adı kullanan ayrı bir görünüm kurar.
  assert.match(client, /qcCardView/, "kart arıza hâlinde ayrı cümle kullanmıyor");
  assert.match(
    client,
    /fotoğrafları okunamayan turu gerekçeyle kabul et/,
    "istisna bağlantısı hâli yanlış adlandırıyor"
  );
});

// ─── 4. Backfill sadakati (migration 0055 metni) ────────────────────────────

check("backfill zaman çizgisinden sürüm TÜRETMEZ", () => {
  const up = sqlBody(UP);
  assert.doesNotMatch(
    up,
    /SET\s+"model_revision"\s*=\s*\(\s*\n?\s*SELECT\s+max/i,
    "backfill yine max(revision) türetiyor"
  );
  assert.match(up, /SET\s+"model_revision"\s*=\s*1\b/);
  assert.match(up, /first_rev\."revision"\s*=\s*1/);
});

check("belirsiz eşleme DAMGASIZ kalır (üç kapı)", () => {
  const up = sqlBody(UP);
  assert.match(up, /NOT EXISTS/);
  assert.match(up, /newer\."revision"\s*>\s*1/);
  assert.match(up, /newer\."created_at"\s*<=\s*p\."created_at"/);
  assert.match(up, /FROM "order_model_revisions" first_rev/);
  assert.match(up, /p\."created_at"\s*>=\s*first_rev\."created_at"\s*\+\s*interval/);
});

check("backfill iki kez uygulanabilir (idempotent, belirlenimci)", () => {
  const up = sqlBody(UP);
  assert.match(up, /WHERE p\."model_revision" IS NULL/);
  assert.match(up, /ADD COLUMN IF NOT EXISTS "model_revision"/);
  assert.doesNotMatch(up, /\bnow\(\)|current_timestamp|random\(\)/i);
});

check("up dosyası, ZATEN UYGULANMIŞ veritabanında ölü metin olduğunu SÖYLER", () => {
  // Düzeltilmiş backfill, 0055'i almış bir veritabanına ASLA ulaşmaz: migrator
  // yalnız journal `when`ine bakar, dosya hash'ini bir daha okumaz. Operatör
  // bunu dosyadan öğrenmeli, yoksa uygulanmış bir düzeltme sanır.
  const up = read(UP);
  assert.match(up, /ÖLÜ METİN/, "ölü metin uyarısı yok");
  assert.match(up, /created_at desc limit 1|folderMillis/i, "migrator kuralı anlatılmamış");
  // Ve güvencenin nerede durduğunu adıyla söyler.
  assert.match(up, /qcRoundPrintProof/, "kapının gerçek sahibi yazılmamış");
});

// ─── 5. Geri alınabilir çift: KENDİ kaydını siler ──────────────────────────

check("down kolonu düşürür ve kaybın yönünü doğru anlatır", () => {
  assert.ok(existsSync(join(REPO_ROOT, DOWN)), `${DOWN} yok`);
  const down = read(DOWN);
  assert.match(down, /DROP COLUMN IF EXISTS "model_revision"/);
  assert.match(down, /YENİDEN TÜRETMEZ/);
  assert.match(down, /KAYIPLIDIR/);
  assert.match(down, /\\copy/, "damgaları yedekleme tarifi yok");
  // Kayıp artık GEVŞETİCİ değil: dosya bunu iddia etmemeli.
  assert.doesNotMatch(
    down,
    /bayat bir QC turu.*yeniden geçebilir|kapıyı gevşetir/,
    "down hâlâ 'geri alma kapıyı gevşetir' diyor"
  );
});

check("down, KENDİ kaydını siler — 'en yeni satır' tarifi yasak", () => {
  const down = read(DOWN);
  // 0055 artık en yeni migration değil (üstünde 0056 var): "en yenisini sil"
  // tarifi 0056'nın satırını silerdi ve 0055 bir daha asla uygulanmazdı.
  //
  // Yasak olan TARİFTİR, cümle değil: dosya migrator'ın kuralını anlatırken o
  // sorguyu ALINTILIYOR ("order by created_at desc limit 1"). Ham metni tarayan
  // bir kontrol, kendi açıklamasını ihlal sayardı — bu yüzden yalnız DELETE'in
  // kendisine bakılır.
  assert.doesNotMatch(
    down,
    /DELETE FROM drizzle\.__drizzle_migrations[\s\S]{0,240}ORDER BY created_at DESC LIMIT 1/i,
    "down hâlâ EN YENİ satırı silen tarifi taşıyor"
  );
  assert.match(down, /DELETE FROM drizzle\.__drizzle_migrations WHERE created_at = \d+/);
  // Silinen satır GERÇEKTEN 0055'in kendi etiketidir: journal'daki `when`.
  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const entry = journal.entries.find((e) => e.idx === 55);
  assert.ok(entry, "journal'da 0055 kaydı yok");
  assert.equal(entry!.tag, "0055_qc_photo_model_revision");
  assert.match(
    down,
    new RegExp(`DELETE FROM drizzle\\.__drizzle_migrations WHERE created_at = ${entry!.when}\\b`),
    `down, 0055'in kendi when değerini (${entry!.when}) silmiyor`
  );
  // Hash ile silmek tuzaktır: dosya düzeltilince hash değişir, kayıttaki eski
  // hash'le eşleşmez ve silme sessizce hiçbir satıra dokunmaz.
  assert.doesNotMatch(down, /WHERE hash =/, "hash ile silme tarifi geri gelmiş");
});

check("down, ÜSTTEKİ migration'ların önce geri alınması gerektiğini söyler", () => {
  // Migrator yalnız EN YENİ kaydın created_at'ine bakar: 0056'nın satırı
  // dururken 0055'in satırını silmek yetmez, 0055 yine uygulanmaz.
  const down = read(DOWN);
  assert.match(down, /0056/, "üstteki migration'dan hiç söz edilmiyor");
  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const newer = journal.entries.filter((e) => e.idx > 55);
  for (const e of newer) {
    assert.match(
      down,
      new RegExp(`${e.when}\\b`),
      `0055'ten yeni ${e.tag} kaydı (${e.when}) geri alma tarifinde yok`
    );
  }
});

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail > 0) {
  console.log("\nBaşarısızlar:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
