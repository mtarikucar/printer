/**
 * Katalog formlarının SAF değer katmanı: alan tanımları ve taslak ⇄ gövde
 * dönüşümleri. React yok, "use client" yok — ekran da test de aynı dosyadan
 * okur.
 *
 * NEDEN AYRI DOSYA: buradaki üç satır doğrudan PARA yazar. "Malzeme fiyatı
 * (₺/gram)" alanını boş bırakmak sessizce 0 kuruş kaydediyordu (`Number("")`
 * → 0) ve şema bunu yakalayamaz, çünkü 0 meşru bir fiyattır (`perCm2Kurus: 0`).
 * Bir ekranın içine gömülü olduğu sürece bu dönüşümün regresyon ağı yoktu;
 * ayrı ve saf olunca `scripts/test-quote-admin-catalog.ts` gerçek alan
 * tanımlarıyla gerçek şemaya karşı koşturuyor.
 *
 * İki kural bilinçlidir:
 *
 *  - **Boş sayı alanı `NaN`dır, 0 DEĞİL.** `NaN` JSON'da `null` olur ve şemanın
 *    Türkçe "Sayı girilmeli (boş bırakılamaz)." cümlesini tetikler. Sessiz bir
 *    sıfır, yayına çıkan bedava bir malzeme demekti.
 *  - **Taslak HAM METİN tutar.** Para alanını her tuşta kuruşa çevirip geri
 *    biçimlemek, "7" + "." yazan yöneticiye "7..00" → `NaN` gösteriyordu;
 *    dönüşüm yalnız kaydetme anında yapılır.
 */
import type { MaterialProperties, SnapshotColor } from "@/lib/config/quote-types";
import { CATALOG_LIMITS } from "@/lib/validators/print-catalog";

export type FieldKind =
  | "text"
  | "textarea"
  | "int"
  | "float"
  | "money"
  | "bool"
  | "intList"
  | "select"
  | "colors"
  | "properties";

export interface Field {
  name: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  /** Boş bırakılabilir: metin/seçim için `null`, liste için `null`. */
  nullable?: boolean;
  wide?: boolean;
  /**
   * YENİ satırın başlangıç değeri. Boş bir form, ilk kaydetmede doğrulayıcıdan
   * "sayı girilmeli" cevabı almak demektir; sahibi sıfırdan bir teknoloji
   * eklerken yirmi alanı tek tek dolduracağını bilmeli, ama hiçbirini boş
   * bırakamayacağını kaydettikten SONRA öğrenmemeli.
   */
  initial?: string;
  /** Yalnız `bool` alanlar için; yazılmazsa yeni satırda KAPALI doğar. */
  defaultBool?: boolean;
}

/** Renk satırının TASLAĞI: ek ücret ham metin olarak durur. */
export interface ColorDraft {
  key: string;
  name: string;
  hex: string;
  /** Kullanıcının yazdığı hâli ("7,5", "7." gibi ara durumlar dahil). */
  surcharge: string;
}

/** Teknik özelliklerin TASLAĞI: sayılar ham metin, onay kutuları boolean. */
export interface PropertiesDraft {
  tensileMpa: string;
  elongationPct: string;
  heatDeflectionC: string;
  flexible: boolean;
  transparent: boolean;
  /** Virgülle ayrılmış ham metin. */
  uses: string;
}

export type DraftValue = string | boolean | ColorDraft[] | PropertiesDraft;
export type Draft = Record<string, DraftValue>;

export const EMPTY_PROPERTIES_DRAFT: PropertiesDraft = {
  tensileMpa: "",
  elongationPct: "",
  heatDeflectionC: "",
  flexible: false,
  transparent: false,
  uses: "",
};

// ─── Dönüşümler ─────────────────────────────────────────────────────────────

/** Kuruş → ekranda gösterilecek ₺ metni. */
export const tl = (kurus: number) => (kurus / 100).toFixed(2);

/**
 * Metin → sayı. BOŞ METİN `NaN`dır: `Number("")` 0 verir ve boş bırakılmış bir
 * fiyat alanı sessizce "bedava" olarak kaydedilirdi. `NaN` JSON'da `null`a
 * dönüşür, şema da Türkçe cümlesiyle reddeder.
 */
export const numberOf = (v: string) => {
  const text = String(v).replace(",", ".").trim();
  return text === "" ? NaN : Number(text);
};

export const toKurus = (v: string) => Math.round(numberOf(v) * 100);

export const toIntList = (v: string) =>
  String(v)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);

/** Sayı → taslak metni (boş = alan yok). */
const numberText = (value: number | undefined | null) =>
  typeof value === "number" ? String(value) : "";

/** Taslakta boş bırakılmış isteğe bağlı sayı = alan HİÇ gönderilmez. */
const optionalNumber = (v: string) => (v.trim() === "" ? undefined : numberOf(v));

export function toDraft(fields: Field[], row: Record<string, unknown> | null): Draft {
  const draft: Draft = {};
  for (const field of fields) {
    const raw = row ? row[field.name] : undefined;
    switch (field.kind) {
      case "bool":
        draft[field.name] = typeof raw === "boolean" ? raw : (field.defaultBool ?? false);
        break;
      case "money":
        draft[field.name] = typeof raw === "number" ? tl(raw) : (field.initial ?? "");
        break;
      case "intList":
        draft[field.name] = Array.isArray(raw)
          ? (raw as number[]).join(", ")
          : (field.initial ?? "");
        break;
      case "colors":
        draft[field.name] = Array.isArray(raw)
          ? (raw as SnapshotColor[]).map((color) => ({
              key: color.key,
              name: color.name,
              hex: color.hex,
              surcharge: tl(color.surchargeKurus),
            }))
          : [];
        break;
      case "properties": {
        const properties = (
          raw && typeof raw === "object" ? raw : {}
        ) as MaterialProperties;
        draft[field.name] = {
          tensileMpa: numberText(properties.tensileMpa),
          elongationPct: numberText(properties.elongationPct),
          heatDeflectionC: numberText(properties.heatDeflectionC),
          flexible: properties.flexible ?? false,
          transparent: properties.transparent ?? false,
          uses: (properties.uses ?? []).join(", "),
        };
        break;
      }
      default:
        draft[field.name] =
          raw === null || raw === undefined ? (field.initial ?? "") : String(raw);
    }
  }
  return draft;
}

export function toPayload(fields: Field[], draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = draft[field.name];
    const text = typeof value === "string" ? value : "";
    switch (field.kind) {
      case "bool":
        out[field.name] = Boolean(value);
        break;
      case "money":
        out[field.name] = toKurus(text);
        break;
      case "int":
        out[field.name] = field.nullable && text.trim() === "" ? null : Math.round(numberOf(text));
        break;
      case "float":
        out[field.name] = numberOf(text);
        break;
      case "intList":
        out[field.name] = field.nullable && text.trim() === "" ? null : toIntList(text);
        break;
      case "colors":
        out[field.name] = ((value as ColorDraft[] | undefined) ?? []).map((color) => ({
          key: color.key.trim(),
          name: color.name.trim(),
          hex: color.hex.trim(),
          surchargeKurus: toKurus(color.surcharge),
        }));
        break;
      case "properties": {
        const properties = (value as PropertiesDraft | undefined) ?? EMPTY_PROPERTIES_DRAFT;
        const uses = properties.uses
          .split(",")
          .map((use) => use.trim())
          .filter(Boolean);
        out[field.name] = {
          tensileMpa: optionalNumber(properties.tensileMpa),
          elongationPct: optionalNumber(properties.elongationPct),
          heatDeflectionC: optionalNumber(properties.heatDeflectionC),
          flexible: properties.flexible || undefined,
          transparent: properties.transparent || undefined,
          uses: uses.length > 0 ? uses : undefined,
        } satisfies MaterialProperties;
        break;
      }
      case "select":
        out[field.name] = field.nullable && text === "" ? null : text;
        break;
      default:
        out[field.name] = field.nullable && text.trim() === "" ? null : text.trim();
    }
  }
  return out;
}

// ─── Alan tanımları ─────────────────────────────────────────────────────────

export const KEY_FIELD = (what: string): Field => ({
  name: "key",
  label: "Anahtar (sonradan değiştirilemez)",
  kind: "text",
  hint: `Küçük harf, rakam ve alt çizgi. Açık tekliflerin parçaları bu anahtara bakar; ${what} sonradan yeniden adlandırılamaz — yanlışsa satırı pasifleştirip yenisini açın.`,
});

export const TECHNOLOGY_FIELDS: Field[] = [
  { name: "name", label: "Ad", kind: "text" },
  { name: "description", label: "Açıklama", kind: "textarea", wide: true },
  {
    name: "orderMaterial",
    label: "Sipariş malzemesi",
    kind: "select",
    initial: "filament",
    options: [
      { value: "filament", label: "Filament" },
      { value: "resin", label: "Reçine" },
    ],
    hint: "Atama motoru üreticiyi bu değere göre filtreler.",
  },
  { name: "capabilityTag", label: "Yetenek etiketi", kind: "text" },
  { name: "buildXMm", label: "Baskı hacmi X (mm)", kind: "int", initial: "200" },
  { name: "buildYMm", label: "Baskı hacmi Y (mm)", kind: "int", initial: "200" },
  { name: "buildZMm", label: "Baskı hacmi Z (mm)", kind: "int", initial: "200" },
  { name: "minWallMm", label: "En ince duvar (mm)", kind: "float", initial: "0,8" },
  { name: "minFeatureMm", label: "En küçük detay (mm)", kind: "float", initial: "0,4" },
  {
    name: "toleranceText",
    label: "Tolerans metni",
    kind: "text",
    wide: true,
    initial: "±0,5 mm",
    hint: "Müşteriye gösterilen tolerans vaadi.",
  },
  {
    name: "layerOptionsUm",
    label: "Katman seçenekleri (µm)",
    kind: "intList",
    initial: "100",
    hint: "Virgülle ayırın. Varsayılan katman bu listede olmalı.",
  },
  { name: "defaultLayerUm", label: "Varsayılan katman (µm)", kind: "int", initial: "100" },
  {
    name: "infillOptionsPct",
    label: "Doluluk seçenekleri (%)",
    kind: "intList",
    nullable: true,
    hint: "Boş bırakın = katı baskı (SLA). Doluysa varsayılan doluluk zorunlu.",
  },
  { name: "defaultInfillPct", label: "Varsayılan doluluk (%)", kind: "int", nullable: true },
  {
    name: "shellMm",
    label: "Kabuk kalınlığı (mm)",
    kind: "float",
    initial: "0",
    hint: "İçi boş baskıda efektif hacmi belirler.",
  },
  { name: "setupFeeKurus", label: "Kurulum ücreti (₺ / parça satırı)", kind: "money", initial: "0" },
  { name: "machineRateKurusPerHour", label: "Makine saat ücreti (₺/saat)", kind: "money", initial: "0" },
  { name: "throughputCm3PerHour", label: "Hacimsel debi (cm³/saat)", kind: "float", initial: "10" },
  {
    name: "heightHoursPerMm",
    label: "Yükseklik süresi (saat/mm)",
    kind: "float",
    initial: "0",
    hint: "Z yüksekliğinin baskı süresine katkısı.",
  },
  { name: "minUnitPriceKurus", label: "Birim taban fiyatı (₺)", kind: "money", initial: "0" },
  { name: "baseLeadDays", label: "Temel iş günü", kind: "int", initial: "3" },
  { name: "sortOrder", label: "Sıra", kind: "int", initial: "0" },
  { name: "active", label: "Aktif (müşteriye açık)", kind: "bool", defaultBool: true },
];

export const MATERIAL_FIELDS: Field[] = [
  { name: "name", label: "Ad", kind: "text" },
  { name: "description", label: "Açıklama", kind: "textarea", wide: true },
  { name: "densityGCm3", label: "Yoğunluk (g/cm³)", kind: "float", initial: "1,2" },
  { name: "priceKurusPerGram", label: "Malzeme fiyatı (₺/gram)", kind: "money", initial: "0" },
  {
    name: "supportFactor",
    label: "Destek katsayısı",
    kind: "float",
    initial: "1",
    hint: `Destek yapılarının yediği fazladan malzeme. ${CATALOG_LIMITS.supportFactor.min}–${CATALOG_LIMITS.supportFactor.max}.`,
  },
  {
    name: "capabilityTag",
    label: "Yetenek etiketi",
    kind: "text",
    nullable: true,
    hint: "Boş = her üretici basabilir.",
  },
  { name: "properties", label: "Teknik özellikler", kind: "properties" },
  { name: "colors", label: "Renkler", kind: "colors" },
  { name: "leadDaysExtra", label: "Ek iş günü", kind: "int", initial: "0" },
  { name: "sortOrder", label: "Sıra", kind: "int", initial: "0" },
  { name: "active", label: "Aktif (müşteriye açık)", kind: "bool", defaultBool: true },
];

export const FINISH_FIELDS: Field[] = [
  { name: "name", label: "Ad", kind: "text" },
  { name: "description", label: "Açıklama", kind: "textarea", wide: true },
  { name: "fixedKurus", label: "Sabit ücret (₺ / adet)", kind: "money", initial: "0" },
  { name: "perCm2Kurus", label: "Alan ücreti (₺ / cm²)", kind: "money", initial: "0" },
  { name: "leadDaysExtra", label: "Ek iş günü", kind: "int", initial: "0" },
  {
    name: "requiresManual",
    label: "Elle fiyatlanır (anlık fiyat verilmez)",
    kind: "bool",
  },
  {
    name: "costLineKind",
    label: "Maliyet kalemi",
    kind: "select",
    initial: "production",
    options: [
      { value: "production", label: "Üretim (üretici payı)" },
      { value: "painting", label: "Boyama (boyacı payı)" },
    ],
  },
  { name: "sortOrder", label: "Sıra", kind: "int", initial: "0" },
  { name: "active", label: "Aktif (müşteriye açık)", kind: "bool", defaultBool: true },
];

export const ADDON_FIELDS: Field[] = [
  { name: "name", label: "Ad", kind: "text" },
  { name: "description", label: "Açıklama", kind: "textarea", wide: true },
  {
    name: "priceType",
    label: "Fiyat türü",
    kind: "select",
    initial: "fixed",
    options: [
      { value: "fixed", label: "Sabit (teklif başına)" },
      { value: "per_part", label: "Parça başına" },
      { value: "per_unit", label: "Adet başına" },
    ],
  },
  { name: "priceKurus", label: "Fiyat (₺)", kind: "money", initial: "0" },
  { name: "leadDaysExtra", label: "Ek iş günü", kind: "int", initial: "0" },
  { name: "sortOrder", label: "Sıra", kind: "int", initial: "0" },
  { name: "active", label: "Aktif (müşteriye açık)", kind: "bool", defaultBool: true },
];
