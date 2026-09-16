/**
 * EKRANIN SUNDUĞU HER KONTROLÜN, ÇALIŞAN BİR UCU VE GÖRÜLMÜŞ BİR DAYANAĞI VAR.
 *
 * DB YOK, sunucu YOK — yalnız kaynak ağacı.
 *
 * NEDEN: bir kontrolün "bozuk" olması yalnız 404 vermesi değildir. Ölçülen iki
 * hâl de aynı sınıfın parçası:
 *
 *   1. Uç, arıza sırasında CEVAP VEREMİYOR. Partner QC fotoğrafını yüklerken
 *      tur başına sayım korumasızdı: ekran yükleyiciyi sunuyor, partner baytları
 *      gönderiyor ve rota sayımda fırlıyordu — panele sebebi olmayan genel bir
 *      500 düşüyordu.
 *   2. Kontrolün DAYANAĞI okunamıyor ama düğme duruyor. Boyacı QC kuyruğu
 *      "bu hâlde onay/ret vermeyin" şeridini basıp altında iki düğmeyi açık
 *      bırakıyordu; galeri incelemesi "görselleri GÖRMEDEN karar vermeyin"
 *      deyip üç kararı da sunuyordu. Ekran kendi uyarısının tersini öneriyordu.
 *
 * Bu test ikisini de YAPISAL olarak çivileyip, kararın uygulandığı hâlde yarım
 * kalan kaydın (photoStampFailed) bir EKRAN tarafından okunduğunu doğrular.
 *
 * Çalıştırma: npx tsx scripts/test-control-agreement.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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

/**
 * `needle`, `guard` ternary'sinin AÇILDIĞI noktadan SONRA mı geçiyor?
 *
 * Kaba ama kırılmaz bir ölçü: düğme metni, kapıyı açan koşulun ÖNÜNDE
 * geçiyorsa kontrol korumasız duruyordur. Koşul kaldırılırsa da, düğme yukarı
 * taşınırsa da test kırılır.
 */
function guardedBy(src: string, guard: string, needle: string): boolean {
  const g = src.indexOf(guard);
  const n = src.indexOf(needle);
  return g !== -1 && n !== -1 && g < n;
}

/** Bir uç dosyası var ve istenen yöntemi DIŞA AÇIYOR mu. */
function routeExports(rel: string, method: string): boolean {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return false;
  return new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(
    readFileSync(abs, "utf8")
  );
}

// ─── 1. Boyacı QC kuyruğu ───────────────────────────────────────────────────
console.log("\nboyacı QC kuyruğu: fotoğraf okunamazken karar sunulmaz");
{
  const page = read("src/app/admin/painter-qc-queue/page.tsx");
  const client = read("src/app/admin/painter-qc-queue/client.tsx");

  ok(
    "sunucu, fotoğraf arızası bayrağını istemciye GÖNDERİYOR",
    page.includes("photosUnreadable={photosUnreadable}")
  );
  ok(
    "istemci bayrağı bir PROP olarak bildiriyor (sessizce yutmuyor)",
    /photosUnreadable: boolean/.test(client)
  );
  // Kuyruğun tek işi fotoğrafa bakıp karar vermek: iki düğme de bayrağın
  // arkasında kalmalı.
  for (const action of ['act(j.id, "approve")', 'act(j.id, "reject")']) {
    ok(
      `${action} kontrolü, photosUnreadable dalının ARKASINDA`,
      guardedBy(client, "{photosUnreadable ? (", action),
      "düğme, kapıyı açan koşuldan ÖNCE geçiyor"
    );
  }
  ok(
    "okunamayan tablo 'Fotoğraf bulunamadı' diye YAZILMIYOR",
    guardedBy(client, "{photosUnreadable ? (", "Fotoğraf bulunamadı.")
  );
  ok(
    "kapanan kontrolün yerinde TÜRKÇE bir sebep var",
    client.includes("Bu iş için onay ve ret kapatıldı")
  );
  // Kontrol → uç: dinamik `${action}` iki ayrı dizine düşer.
  for (const a of ["approve", "reject"]) {
    ok(
      `POST /api/admin/painter-qc/[id]/${a} ucu VAR`,
      routeExports(`src/app/api/admin/painter-qc/[id]/${a}/route.ts`, "POST")
    );
  }
}

// ─── 2. Yönetici sipariş sayfası · boyama (partner) kartı ──────────────────
console.log("\nboyama kartı: aynı arızada aynı kapı");
{
  const client = read("src/app/admin/orders/[id]/client.tsx");
  const from = client.indexOf('painting.painterStatus === "qc_pending"');
  const to = client.indexOf('painterQcDecision("approve")');
  ok("kart ve kontrol aynı dosyada bulundu", from !== -1 && to !== -1 && from < to);
  ok(
    "onay/ret, readFailures.painterQcPhotos dalının ARKASINDA",
    from !== -1 &&
      to !== -1 &&
      client.slice(from, to).includes("readFailures?.painterQcPhotos ? (")
  );
  ok(
    "kapanan kontrolün yerinde TÜRKÇE bir sebep var",
    client.includes("Boyama onayı ve reddi kapatıldı")
  );
}

// ─── 3. Karar UYGULANDI ama kayıt yarım kaldı: bir EKRAN söylüyor ──────────
console.log("\nphotoStampFailed: uç bildiriyor, ekran okuyor");
{
  for (const rel of [
    "src/app/api/admin/painter-qc/[id]/approve/route.ts",
    "src/app/api/admin/painter-qc/[id]/reject/route.ts",
  ]) {
    ok(`${rel}: bayrağı cevapta DÖNÜYOR`, read(rel).includes("photoStampFailed"));
  }
  const queue = read("src/app/admin/painter-qc-queue/client.tsx");
  const order = read("src/app/admin/orders/[id]/client.tsx");
  ok("boyacı QC kuyruğu bayrağı OKUYOR", queue.includes("data.photoStampFailed"));
  ok("yönetici sipariş sayfası bayrağı OKUYOR", order.includes("data.photoStampFailed"));
  // Cümle, kararın GEÇTİĞİNİ söylemeli: "başarısız" demek admin'i yapılmış işi
  // tekrar yapmaya iterdi.
  ok(
    "kuyruğun cümlesi kararın UYGULANDIĞINI söylüyor",
    /Onay UYGULANDI/.test(queue) && /Ret UYGULANDI/.test(queue)
  );
  ok(
    "sipariş sayfasının cümlesi kararın UYGULANDIĞINI söylüyor",
    /onayı UYGULANDI/.test(order) && /reddi UYGULANDI/.test(order)
  );
}

// ─── 4. QC fotoğrafı yükleme uçları: arızada da CEVAP veriyor ──────────────
console.log("\nQC fotoğraf yükleme: tur sayımı okunamazken uç cevap veriyor");
for (const rel of [
  "src/app/api/manufacturer/orders/[id]/qc-photos/route.ts",
  "src/app/api/painter/orders/[id]/qc-photos/route.ts",
]) {
  const src = read(rel);
  const guardStart = src.indexOf("let existing: number;");
  const select = src.indexOf("count()");
  ok(`${rel}: sayım okuması bir TRY içinde`, guardStart !== -1 && guardStart < select);
  ok(
    `${rel}: adıyla 503 + makine-okur kod`,
    src.includes("qc_photo_count_unavailable") && src.includes("status: 503")
  );
  ok(
    `${rel}: gövde TÜRKÇE ve fotoğrafın YAZILMADIĞINI söylüyor`,
    /okunamadı/.test(src) && /yükleme yapılmadı/i.test(src)
  );
  // Fail closed: bilinmeyen sayıya 6 sınırı uygulanamaz, dal asla devam etmez.
  ok(
    `${rel}: sayım okunamazken akış DEVAM ETMİYOR`,
    /catch \(e\) \{[\s\S]{0,400}?return NextResponse\.json\(/.test(src.slice(guardStart))
  );
}

// ─── 5. Galeri incelemesi: kanıt okunamazken karar sunulmaz ────────────────
console.log("\ngaleri incelemesi: görsel okunamazken yayın kararı sunulmaz");
{
  const page = read("src/app/admin/gallery-queue/[id]/page.tsx");
  const client = read("src/app/admin/gallery-queue/[id]/client.tsx");
  ok(
    "sunucu kanıt bayraklarını GÖNDERİYOR",
    page.includes("photoUnreadable={photosUnreadable}") &&
      page.includes("modelUnreadable={attemptsUnreadable}")
  );
  ok(
    "istemci ikisini de PROP olarak bildiriyor",
    /photoUnreadable: boolean/.test(client) && /modelUnreadable: boolean/.test(client)
  );
  for (const action of ["onClick={approve}", "onClick={reward}", "onClick={reject}"]) {
    ok(
      `${action} kontrolü, photoUnreadable dalının ARKASINDA`,
      guardedBy(client, "{photoUnreadable ? (", action)
    );
  }
  ok(
    "okunamayan fotoğraf 'Fotoğraf yok' diye YAZILMIYOR",
    guardedBy(client, "photoUnreadable ? (", "Fotoğraf yok")
  );
  ok(
    "kapanan kontrolün yerinde TÜRKÇE bir sebep var",
    client.includes("Yayın kararı geçici olarak kapatıldı")
  );
}

console.log(failed ? `\n${failed} FAILED` : "\ntümü geçti");
process.exitCode = failed ? 1 : 0;
