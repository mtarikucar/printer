/**
 * Açılış sayfasının YAYIMLADIĞI fiyat çapaları ("₺74'ten başlayan").
 *
 * Neden var: fiyat kapısı bütün gerçek teklif rakamlarını girişin arkasına
 * alıyor. Hiç rakam yayımlamayan bir hizmet sayfası, bir yapay zekâ arama
 * motorunun ya da müşterinin karşılaştırma yapabileceği tek şeyi — sayıyı —
 * vermez (bkz. spec §"Müşteri arayüzü" ve GEO notu: rakamsız tarif
 * alıntılanmıyor). Bu yüzden herkese açık TEK bir referans parça için fiyat
 * hesaplanır ve sayfada dayanağıyla birlikte yazılır.
 *
 * Referans parça SABİTTİR ve sayfada da yazılıdır: **20 mm küp, 1 adet,
 * standart teslim, katalog varsayılanı katman/doluluk, en ucuz renk, ilk
 * elle-fiyatlanmayan yüzey işlemi, KDV dahil**. Rakam katalogdan hesaplanır
 * (`priceUnitAuto`), elle yazılmaz: yönetici malzeme fiyatını değiştirdiğinde
 * açılış sayfası kendiliğinden doğrulanır.
 *
 * SAF MODÜL: DB yok, `server-only` yok — hem sayfalar hem birim testi import
 * eder.
 */
import { findFinish, leadTier, priceUnitAuto } from "@/lib/config/quote-pricing";
import { scaledGeometry } from "@/lib/config/quote-units";
import type {
  PartConfig,
  PartGeometry,
  PricingSnapshot,
  SnapshotMaterial,
  SnapshotTechnology,
} from "@/lib/config/quote-types";

/** Referans parçanın kenar uzunluğu (mm). Sayfadaki cümleyle aynı sayı. */
export const ANCHOR_EDGE_MM = 20;

/**
 * Çapanın dayanağı. Sayfada da, `Service` JSON-LD'sinde de AYNI cümle geçer:
 * Google'ın "yapısal veri görünen içerikle eşleşmeli" kuralı ve okurun rakamı
 * doğrulayabilmesi buna bağlı.
 */
export const ANCHOR_BASIS_TR = `${ANCHOR_EDGE_MM} mm küp, 1 adet, standart teslim, KDV dahil`;

/** Referans parça: dolu 20 mm küp, dosya birimi mm. */
const ANCHOR_GEOMETRY: PartGeometry = {
  volume: ANCHOR_EDGE_MM ** 3,
  area: 6 * ANCHOR_EDGE_MM ** 2,
  extents: { x: ANCHOR_EDGE_MM, y: ANCHOR_EDGE_MM, z: ANCHOR_EDGE_MM },
  bodyCount: 1,
  isWatertight: true,
  isVolume: true,
  volumeEstimated: false,
  faceCount: 12,
  wallP1: ANCHOR_EDGE_MM,
  wallP5: ANCHOR_EDGE_MM,
  overhangArea: ANCHOR_EDGE_MM ** 2,
  sourceUnits: null,
  objectCount: 1,
  // Referans parça bir mesh gibi ele alınır: çevrilen bir B-rep yok.
  tessellation: null,
  solidCount: null,
};

const ANCHOR_SCALED = scaledGeometry(ANCHOR_GEOMETRY, "mm", 1);

function technologyOf(snapshot: PricingSnapshot, key: string): SnapshotTechnology | null {
  return snapshot.technologies.find((t) => t.key === key) ?? null;
}

/**
 * Çapa için yüzey işlemi: `sortOrder` sırasında elle fiyatlanmayan İLK yüzey.
 *
 * `requiresManual` olanlar (boyalı, özel) anlık fiyat vermez; onlardan bir
 * "başlangıç fiyatı" türetmek, müşteriye hiç alamayacağı bir rakam yazmak
 * olurdu.
 */
function anchorFinishKey(snapshot: PricingSnapshot, technologyKey: string): string | null {
  const usable = snapshot.finishes
    .filter(
      (f) =>
        !f.requiresManual && (f.technologyKey === null || f.technologyKey === technologyKey)
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return usable[0]?.key ?? null;
}

function anchorConfig(
  snapshot: PricingSnapshot,
  tech: SnapshotTechnology,
  material: SnapshotMaterial,
  finishKey: string
): PartConfig | null {
  // Ek ücreti en düşük renk: "başlayan" fiyat, seçilebilecek en ucuz renkle
  // hesaplanır; katalogda ek ücretli renk varsa çapa onunla şişmez.
  const color = [...material.colors].sort((a, b) => a.surchargeKurus - b.surchargeKurus)[0];
  if (!color) return null;
  return {
    technologyKey: tech.key,
    materialKey: material.key,
    colorKey: color.key,
    finishKey,
    layerUm: tech.defaultLayerUm,
    infillPct: tech.defaultInfillPct,
    quantity: 1,
    units: "mm",
    scale: 1,
    criticalTolerance: false,
  };
}

/**
 * Tek malzemenin referans parça üzerindeki birim fiyatı (kuruş, KDV dahil).
 * Katalog o malzemeyi fiyatlayamıyorsa (yüzey yok, renk yok) null.
 */
export function materialAnchorKurus(
  snapshot: PricingSnapshot,
  material: SnapshotMaterial
): number | null {
  const tech = technologyOf(snapshot, material.technologyKey);
  if (!tech) return null;
  const finishKey = anchorFinishKey(snapshot, tech.key);
  if (!finishKey || !findFinish(snapshot, tech.key, finishKey)) return null;
  const config = anchorConfig(snapshot, tech, material, finishKey);
  if (!config) return null;

  return priceUnitAuto({
    snapshot,
    scaled: ANCHOR_SCALED,
    config,
    tier: leadTier(snapshot, "standard"),
    quantity: 1,
  }).unitKurus;
}

/** Teknolojinin çapası: malzemeleri içindeki EN DÜŞÜK birim fiyat. */
export function technologyAnchorKurus(
  snapshot: PricingSnapshot,
  technologyKey: string
): number | null {
  if (!technologyOf(snapshot, technologyKey)) return null;
  const prices = snapshot.materials
    .filter((m) => m.technologyKey === technologyKey)
    .map((m) => materialAnchorKurus(snapshot, m))
    .filter((p): p is number => p !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** Bütün kataloğun en düşük başlangıç fiyatı (başlık ve JSON-LD için). */
export function catalogAnchorKurus(snapshot: PricingSnapshot): number | null {
  const prices = snapshot.technologies
    .map((t) => technologyAnchorKurus(snapshot, t.key))
    .filter((p): p is number => p !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/**
 * Yayımlanan rakam: kuruş YUKARI yuvarlanarak tam liraya çevrilir.
 *
 * Yukarı yuvarlama zorunlu: "₺74'ten başlayan" cümlesi gerçek fiyatın ALTINDA
 * bir sayı gösterirse müşteriye söylenen ile ödeme ekranındaki rakam çelişir.
 */
export function formatAnchorPrice(kurus: number): string {
  return `₺${Math.ceil(kurus / 100).toLocaleString("tr-TR")}`;
}

const UNIT_WORDS = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS_WORDS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
const SCALE_WORDS = ["", "bin", "milyon", "milyar"];

/**
 * Sayının OKUNUŞUNDAKİ son sözcük ("yetmiş dört" → "dört", "on iki bin" →
 * "bin"). Ek rakama değil bu sözcüğe takılır.
 */
function finalNumberWord(value: number): string {
  const n = Math.abs(Math.trunc(value));
  if (n === 0) return "sıfır";
  const unit = n % 10;
  if (unit > 0) return UNIT_WORDS[unit];
  const ten = Math.floor(n / 10) % 10;
  if (ten > 0) return TENS_WORDS[ten];
  if (Math.floor(n / 100) % 10 > 0) return "yüz";
  for (let scale = 1; scale < SCALE_WORDS.length; scale++) {
    if (Math.floor(n / 1000 ** scale) % 1000 > 0) return SCALE_WORDS[scale];
  }
  return SCALE_WORDS[SCALE_WORDS.length - 1];
}

/** Sert ünsüzler: ek `-d-` ile değil `-t-` ile başlar (ünsüz benzeşmesi). */
const VOICELESS_FINALS = new Set(["p", "ç", "t", "k", "f", "h", "s", "ş"]);
const BACK_VOWELS = new Set(["a", "ı", "o", "u"]);
const VOWELS = "aeıioöuü";

/** Bir sözcüğün ayrılma hâli eki: `dan` | `den` | `tan` | `ten`. */
function ablativeSuffix(word: string): string {
  const lower = word.toLocaleLowerCase("tr");
  const consonant = VOICELESS_FINALS.has(lower.slice(-1)) ? "t" : "d";
  let lastVowel = "";
  for (const ch of lower) if (VOWELS.includes(ch)) lastVowel = ch;
  return consonant + (BACK_VOWELS.has(lastVowel) ? "an" : "en");
}

/**
 * Sayfada geçen çapa cümlesi. Tek yerden üretilir ki her yerde aynı olsun.
 *
 * Ek SABİT DEĞİL kuraldır. Bu cümle sitenin alıntılanan cümlesidir (arama
 * motoru indeksler, yapay zekâ asistanı olduğu gibi tekrarlar), yani yazım
 * hatası da olduğu gibi yayılır. İki kural birden işler:
 *
 *  - **Ünsüz benzeşmesi** — son sözcük sert ünsüzle (p ç t k f h s ş) bitiyorsa
 *    ek `t` ile başlar: "dört" → "dörtten" → ₺74'ten.
 *  - **Ünlü uyumu** — son ünlü kalınsa (a ı o u) `-an`, inceyse `-en`:
 *    "altı" → "altıdan" → ₺116'dan.
 *
 * Ek, RAKAMIN son hanesine değil OKUNUŞUNUN son sözcüğüne bakar; katalogdaki
 * dört çapa (₺74, ₺114, ₺116, ₺123) bunun üçünü birden örnekler.
 */
export function anchorSentence(kurus: number): string {
  const suffix = ablativeSuffix(finalNumberWord(Math.ceil(kurus / 100)));
  return `${formatAnchorPrice(kurus)}'${suffix} başlayan`;
}

/** JSON-LD'nin beklediği ondalık dizgi (`"74.00"`). */
export function anchorJsonPrice(kurus: number): string {
  return (Math.ceil(kurus / 100)).toFixed(2);
}

/**
 * Çapanın YANINDA durması zorunlu cümle: asgari sipariş tutarı.
 *
 * Çapa tek bir parçanın BİRİM fiyatıdır (20 mm küp ×1 = ₺74), oysa o sepet
 * ödeme ekranında `min_order_kurus` ile ₺200'e tamamlanır. Asgariyi yazmayan
 * bir "₺74'ten başlayan" cümlesi, sayfanın tek işi alıntılanmak olduğu için
 * (indekslenen `<meta description>`, yapay zekâ yanıtları) müşteriye 2,7 katlık
 * bir sürpriz hazırlar. Bu yüzden çapa cümlesi geçen HER yüzeyde bu cümle de
 * geçer; `scripts/test-quote-ui.ts` ikisini birlikte arar.
 *
 * Ek almamak için kurulmuş bir cümle: tutar katalogdan geldiği için "₺200'dür"
 * gibi bir çekim her rakamda ayrı kural isterdi.
 */
export function minOrderSentence(minOrderKurus: number): string | null {
  if (minOrderKurus <= 0) return null;
  return (
    `Asgari sipariş tutarı ${formatAnchorPrice(minOrderKurus)}: ` +
    "daha düşük tutarlı siparişlerde toplam bu tutara tamamlanır."
  );
}
