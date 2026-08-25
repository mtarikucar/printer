import assert from "node:assert/strict";
import {
  getPublicImageUrl,
  isPublicUnsignedKey,
} from "../src/lib/services/storage";

// `=`, `??=` DEĞİL: kabuğa yüklenmiş bir .env değeri (localhost:3000) testi
// sessizce başarısız kılardı. Bu betik URL'i kendisi belirler.
process.env.NEXT_PUBLIC_APP_URL = "https://figurunica.com";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

test("ürün görselleri imzasız ve kalıcı URL alır", () => {
  const url = getPublicImageUrl("products/abc123.webp");
  assert.equal(url, "https://figurunica.com/media/products/abc123.webp");
  // Kritik: imza parametresi YOK — süresi dolan URL crawler'a 401 döndürüyordu.
  assert.ok(!url.includes("sig="), "imza parametresi sızmış");
  assert.ok(!url.includes("exp="), "son kullanma parametresi sızmış");
});

test("aynı anahtar her zaman aynı URL'i verir", () => {
  // Cache ve og:image kararlılığı için: imzalı URL'ler 24 saatte bir rotasyona
  // giriyordu, bu da her taramada farklı bir görsel URL'i demekti.
  assert.equal(
    getPublicImageUrl("products/abc123.webp"),
    getPublicImageUrl("products/abc123.webp")
  );
});

test("ürün dışı her şey imzalı kalır", () => {
  for (const key of [
    "uploads/musteri-fotografi.webp",
    "meshes/model.glb",
    "chat/ek.png",
    "receipts/dekont.pdf",
  ]) {
    assert.equal(isPublicUnsignedKey(key), false, `${key} imzasız sayılmış`);
    const url = getPublicImageUrl(key);
    assert.ok(url.includes("sig="), `${key} imzasız servis ediliyor`);
    assert.ok(url.includes("/api/files/"), `${key} /media üzerinden çıkmış`);
  }
  assert.equal(isPublicUnsignedKey("products/x.webp"), true);
});

test("prefix kaçışı engellenir", () => {
  // "products" ile BAŞLAYAN ama products/ dizininde olmayan anahtarlar,
  // ve traversal denemeleri imzasız servis edilmemeli.
  for (const key of [
    "products-private/x.webp",
    "notproducts/x.webp",
    "products/../uploads/pii.webp",
  ]) {
    assert.equal(isPublicUnsignedKey(key), false, `${key} imzasız sayılmış`);
  }
});

test("çift-encode edilmiş traversal engellenir (Important fix)", () => {
  // Next'in router'ı bir path segmentini TAM OLARAK BİR KEZ decode eder. Tekli
  // encode ("%2e%2e") bu yüzden handler'a zaten literal ".." olarak ulaşır ve
  // eski tek-atım `.includes("..")` kontrolü bunu yakalardı. Ama çift encode
  // ("%252e%252e") handler'a HALA encode'lu "%2e%2e" olarak ulaşır — bir
  // decode daha yapılmadan ".." olmaz. decodeToFixpoint bu yüzden decode'u
  // sabit noktaya kadar TEKRARLIYOR, her turu kontrol ediyor.
  for (const key of [
    "products/%2e%2e/uploads/pii.webp",
    "products/%252e%252e/uploads/pii.webp",
    "products/%2e%2e%2f%2e%2e%2fuploads/pii.webp",
    "products/..\\uploads\\pii.webp",
  ]) {
    assert.equal(isPublicUnsignedKey(key), false, `${key} imzasız sayılmış`);
  }
});

test("çift-encode fix'i meşru anahtarları kırmıyor (regresyon koruması)", () => {
  assert.equal(isPublicUnsignedKey("products/abc123.webp"), true);
  assert.equal(isPublicUnsignedKey("products/nested/abc123.webp"), true);
});

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}
console.log(`\n${passed}/${cases.length} media-url testi geçti`);
