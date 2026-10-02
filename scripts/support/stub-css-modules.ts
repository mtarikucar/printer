/**
 * `.css` / `.module.css` import'larını test koşucusu için ETKİSİZ hâle getirir.
 *
 * Neden gerekiyor: `scripts/test-*.ts` dosyaları `tsx` ile koşuyor ve `tsx`
 * bilmediği uzantıyı TypeScript sanıp derlemeye kalkıyor — bir CSS modülü
 * import eden HİÇBİR bileşen (ör. `/figur`in `figurunica.module.css` kullanan
 * kahraman bölümü) o yüzden test edilemiyordu: ilk satırda
 * `SyntaxError: Unexpected token '.'`. Oysa `renderToStaticMarkup` için sınıf
 * adlarının gerçek değeri önemsiz; önemli olan METİN.
 *
 * Stub, istenen her sınıf adı için adın KENDİSİNİ döndürür (`styles.hero` →
 * `"hero"`). Böylece render edilen HTML'de sınıf adları okunabilir kalır ve
 * `s("hero-printer")` gibi aramalar çalışır.
 *
 * KULLANIM: test dosyasının İLK import'u olmak zorunda. `tsx` ESM'i CJS'e
 * çeviriyor ve `require` çağrıları sırayla koşuyor; bu modül ilk sırada
 * değilse CSS import'u ondan önce çalışır ve yine patlar.
 */
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
// Node'un CJS uzantı tablosu tiplenmiş değil; `tsx` kendi dönüştürücüsünü
// buraya kuruyor, bu yüzden ATAMA ONDAN SONRA gelmeli (bu modül import
// edildiğinde tsx çoktan kurulmuş durumda).
const extensions = (req as unknown as {
  extensions: Record<string, (module: NodeModule, filename: string) => void>;
}).extensions;

const identity: Record<string, string> = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) }
) as Record<string, string>;

// `__esModule` + `default` AÇIKÇA yazılı: `import styles from "./x.module.css"`
// bir VARSAYILAN import ve esbuild'in CJS interop'u bu iki alanı okuyor. Her
// anahtara adını döndüren saf bir proxy verilirse `__esModule` "doğru"ya,
// `default` ise "default" dizesine çözülür ve `styles` tanımsız kalır.
const cssExports = new Proxy(
  { __esModule: true, default: identity } as Record<string, unknown>,
  {
    get: (target, key) =>
      key in target ? target[key as string] : typeof key === "string" ? key : undefined,
  }
);

for (const ext of [".css", ".scss", ".sass"]) {
  extensions[ext] = (module) => {
    (module as unknown as { exports: unknown }).exports = cssExports;
  };
}
