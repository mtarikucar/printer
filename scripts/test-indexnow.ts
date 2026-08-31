/**
 * IndexNow submission contract. Nothing here hits the network — the payload
 * shaping and the refusal rules are what can silently break.
 */
import assert from "node:assert/strict";
import { getIndexNowKey, submitToIndexNow, INDEXNOW_KEY_PATH } from "../src/lib/services/indexnow";

let failures = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failures++;
      console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
    });
}

async function main() {
  const savedKey = process.env.INDEXNOW_KEY;

  await check("anahtar yokken hiçbir şey gönderilmez", async () => {
    delete process.env.INDEXNOW_KEY;
    const r = await submitToIndexNow(["/shop/x"]);
    assert.deepEqual(r, { ok: false, reason: "no_key" });
  });

  await check("çok kısa anahtar yapılandırma hatasıdır, gönderilmez", async () => {
    process.env.INDEXNOW_KEY = "abc";
    assert.equal(getIndexNowKey(), null);
    const r = await submitToIndexNow(["/shop/x"]);
    assert.deepEqual(r, { ok: false, reason: "no_key" });
  });

  await check("geçerli anahtar tanınır", () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    assert.equal(getIndexNowKey(), "a".repeat(32));
  });

  await check("yabancı host'lu URL'ler elenir — anahtarı iptal ettirir", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const r = await submitToIndexNow([
      "https://evil.example.com/x",
      "https://another.test/y",
    ]);
    assert.deepEqual(r, { ok: false, reason: "no_urls" }, "yalnız yabancı URL varsa gönderim olmamalı");
  });

  await check("anahtar dosyası yolu sabit ve spec'e uygun", () => {
    assert.equal(INDEXNOW_KEY_PATH, "/indexnow-key.txt");
    assert.ok(INDEXNOW_KEY_PATH.endsWith(".txt"));
  });

  if (savedKey === undefined) delete process.env.INDEXNOW_KEY;
  else process.env.INDEXNOW_KEY = savedKey;

  console.log(
    failures === 0 ? "\n✅ indexnow: tüm kontroller geçti" : `\n❌ indexnow: ${failures} başarısız`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
