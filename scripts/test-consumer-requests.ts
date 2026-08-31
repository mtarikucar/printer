/**
 * Tüketici talep sistemi (MSY m.12/A) sözleşme kontrolleri.
 *
 * m.12/A üç şey ister ve üçü de tek tek doğrulanır: talep KESİNTİSİZ
 * iletilebilmeli, TAKİP EDİLEBİLMELİ, satıcıya DERHAL iletilmeli. Eksikliği
 * 6502 m.48/5 ihlalidir ve yaptırımı MAKTU idari para cezasıdır — işlem başına
 * değil, tek denetimde tek seferde. Bu yüzden burada "çoğu akış" yeterli değil.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  CONSUMER_REQUEST_TYPES,
  CONSUMER_REQUEST_LABELS,
  CONSUMER_REQUEST_HINTS,
  isConsumerRequestType,
  generateConsumerRequestReference,
  CONSUMER_REQUEST_MESSAGE_MIN,
  CONSUMER_REQUEST_MESSAGE_MAX,
} from "../src/lib/config/consumer-requests";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

console.log("\ntüketici talepleri (m.12/A)");

check("beş talep türünün tamamı tanımlı", () => {
  // Liste kapalıdır: m.12/A bu beşini sayar. Biri eksikse tüketici o talebi
  // iletemez ve sistem "kesintisiz" olmaz.
  assert.deepEqual([...CONSUMER_REQUEST_TYPES], [
    "withdrawal",
    "termination",
    "refund",
    "records",
    "delivery_complaint",
  ]);
});

check("her türün etiketi ve açıklaması var", () => {
  for (const t of CONSUMER_REQUEST_TYPES) {
    assert.ok(CONSUMER_REQUEST_LABELS[t]?.length > 0, `etiket yok: ${t}`);
    assert.ok(CONSUMER_REQUEST_HINTS[t]?.length > 0, `açıklama yok: ${t}`);
  }
});

check("cayma açıklaması hakkı inkâr etmez, kapsamı anlatır", () => {
  // Kişiye özelde cayma hakkı yok; ama tüketicinin BİLDİRME hakkı var.
  // "Cayamazsınız" demek, iletim kanalını peşinen kapatmak olurdu.
  const h = CONSUMER_REQUEST_HINTS.withdrawal;
  assert.match(h, /14 gün/, "hazır üründeki 14 günlük hak söylenmiyor");
  assert.match(h, /iletebilirsiniz/, "bildirim yolu kapatılmış görünüyor");
});

check("geçersiz tür reddedilir", () => {
  assert.equal(isConsumerRequestType("withdrawal"), true);
  assert.equal(isConsumerRequestType("hediye"), false);
  assert.equal(isConsumerRequestType(null), false);
  assert.equal(isConsumerRequestType(42), false);
});

check("referans okunabilir ve karışan karakter içermez", () => {
  // Tüketici bunu telefonda okuyabilmeli: 0/O ve 1/I ayrımı yapılamaz.
  for (let i = 0; i < 200; i++) {
    const r = generateConsumerRequestReference();
    assert.match(r, /^TT-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/, `bozuk referans: ${r}`);
  }
});

check("mesaj sınırları makul", () => {
  assert.ok(CONSUMER_REQUEST_MESSAGE_MIN >= 5);
  assert.ok(CONSUMER_REQUEST_MESSAGE_MAX <= 8000);
  assert.ok(CONSUMER_REQUEST_MESSAGE_MIN < CONSUMER_REQUEST_MESSAGE_MAX);
});

check("talep kanalı giriş ŞARTI koymaz (kesintisizlik)", () => {
  // Misafir alışverişi mevcut; hesap şartı koymak hesabı olmayan tüketicinin
  // talebini engellerdi.
  const route = read("src/app/api/consumer-requests/route.ts");
  assert.doesNotMatch(route, /requireAuth|getSessionUser\(\)/, "giriş şartı konmuş");
  assert.match(route, /orderNumber/, "sipariş numarasıyla erişim yok");
  assert.match(route, /contactEmail/, "e-posta doğrulaması yok");
});

check("sipariş/e-posta uyuşmazlığı bilgi sızdırmaz", () => {
  // Sipariş yok ile e-posta tutmuyor AYNI cevabı vermeli; aksi hâlde form,
  // bir e-postanın hangi siparişe ait olduğunu söyleyen bir orakl olur.
  const route = read("src/app/api/consumer-requests/route.ts");
  assert.match(route, /!order \|\| order\.email/, "iki hâl ayrı ele alınmış");
});

check("takip ucu var (m.12/A takip edilebilirlik)", () => {
  const route = read("src/app/api/consumer-requests/route.ts");
  assert.match(route, /export async function GET/, "takip endpoint'i yok");
  assert.match(route, /reference/, "referansla sorgulanmıyor");
});

check("iletim hatası talebi DÜŞÜRMEZ", () => {
  // Kayıt önce yazılır, iletim sonra denenir. Tersi olsaydı tüketici talebini
  // kaybeder ve denetimde hiçbir iz kalmazdı.
  const svc = read("src/lib/services/consumer-requests.ts");
  // import satırlarını atla — sıralama fonksiyon GÖVDESİNDE ölçülmeli.
  const bodyStart = svc.indexOf("export async function createConsumerRequest");
  assert.ok(bodyStart > 0, "createConsumerRequest bulunamadı");
  const insertAt = svc.indexOf(".insert(consumerRequests)", bodyStart);
  const notifyAt = svc.indexOf("await notifyManufacturer(", bodyStart);
  assert.ok(insertAt > 0 && notifyAt > 0, "insert/notify çağrısı bulunamadı");
  assert.ok(insertAt < notifyAt, "iletim, kayıttan ÖNCE deneniyor");
  assert.match(svc, /forwardFailedReason/, "hata sebebi saklanmıyor");
});

check("iletim anı damgalanır (derhal iletme kanıtı)", () => {
  const svc = read("src/lib/services/consumer-requests.ts");
  assert.match(svc, /forwardedAt: new Date\(\)/, "iletim anı yazılmıyor");
  assert.match(svc, /status: "forwarded"/, "durum güncellenmiyor");
});

check("satıcı yalnızca KENDİ taleplerini güncelleyebilir", () => {
  // Yetki kontrolü sorgunun içinde: başka satıcının talebine dokunmak
  // yapısal olarak imkânsız olmalı, if'e bağlı değil.
  const route = read("src/app/api/manufacturer/consumer-requests/[id]/route.ts");
  assert.match(
    route,
    /eq\(consumerRequests\.sellerManufacturerId, session\.manufacturerId\)/,
    "WHERE koşulunda satıcı sınırı yok"
  );
});

check("müşteri formu, satıcı ve admin panelleri mevcut", () => {
  for (const p of [
    "src/components/consumer/consumer-request-form.tsx",
    "src/app/manufacturer/consumer-requests/page.tsx",
    "src/app/admin/consumer-requests/page.tsx",
    "src/app/api/admin/consumer-requests/[id]/route.ts",
  ]) {
    assert.ok(existsSync(p), `eksik: ${p}`);
  }
  // Form, tüketicinin ulaşabildiği yerde mi?
  const track = read("src/app/track/[orderNumber]/page.tsx");
  assert.match(track, /ConsumerRequestForm/, "form takip sayfasında değil");
});

check("iletilemeyen talep panelde görünür kalır", () => {
  const table = read("src/components/consumer/consumer-requests-table.tsx");
  assert.match(table, /İLETİLEMEDİ/, "iletim hatası gizleniyor");
});

check("config worker yolundadır — server-only içermez", () => {
  const cfg = read("src/lib/config/consumer-requests.ts");
  assert.doesNotMatch(cfg, /^\s*import\s+"server-only"/m);
});

if (failures > 0) {
  console.error(`\n❌ tüketici talepleri: ${failures} kontrol başarısız`);
  process.exit(1);
}
console.log("\n✅ tüketici talepleri: tüm kontroller geçti");
