/**
 * `drizzle/0064_instant_quotes.sql` tohumunun TypeScript aynası.
 *
 * Tek gerçek kaynak SQL tohumudur; bu dosya onun birebir kopyasıdır ve
 * `scripts/test-quote-core.ts` (saf altın değerler) ile Task 2.4'ün DB
 * eşitlik testi ikisini karşılaştırır. Tohum SQL'de değişirse BURASI DA
 * değişmek zorundadır — `sortOrder` değerleri dahil.
 *
 * Nerede kullanılır: birim testleri, `/3d-baski` gibi DB'siz ortamlarda
 * (CI build) yedek katalog, dokümantasyon örnekleri. CANLI teklifler kendi
 * `pricing_snapshot`'ını DB'den alır, buradan DEĞİL.
 *
 * SAF MODÜL: DB yok, `server-only` yok, `node:` import'u yok.
 */
import type { PricingSnapshot } from "@/lib/config/quote-types";

/**
 * Worker konteynerinin bellek tavanı, GB
 * (`docker/docker-compose.production.yml` → `worker.mem_limit`).
 *
 * Burada durmasının sebebi aşağıdaki tavanla ÇİFT olmasıdır:
 * `scripts/test-quote-validation.ts` ikisini compose dosyasına karşı
 * karşılaştırır, biri diğerinden habersiz değişemez.
 */
export const QUOTE_ANALYSIS_MEM_LIMIT_GB = 2;

/**
 * Reklam edilen dosya tavanı (32 MiB) — pazarlama tercihi DEĞİL, ölçüm.
 *
 * `analyze_quote_part.py` tüm ağı tam çözünürlükte ölçer. Ölçülen zarf
 * (/usr/bin/time -v): 327k yüz → 0,51 GiB RSS, 1,31M yüz → 1,50 GiB,
 * 1,99M yüz / 94,7 MB → 2,43 GiB. Yani eski 100 MB'lık vaat, 2 GB'lik
 * konteynerde OOM ile biten bir dosyayı KABUL ediyordu: python çocuk süreç
 * ölür, parça "Dosya okunamadı" ile düşer, kötü tarafta ise iş 20 dakikada bir
 * yeniden kuyruğa girer. 32 MiB'in zarfı ≈ 0,8 GiB.
 *
 * Tavanı büyütmek isteyen ÖNCE `mem_limit`i büyütür (ve betiğe
 * `--max-address-space-gb` geçirir); alan `/admin/baski-katalogu` üzerinden
 * düzenlenebilir olduğu için migration gerekmez, ama açılış sayfasının
 * cümlesi de aynı sayıdan beslenir.
 */
export const SEED_MAX_FILE_BYTES = 33_554_432;

export const SEED_SNAPSHOT: PricingSnapshot = {
  version: 1,
  takenAt: "2026-09-22T00:00:00.000Z",
  technologies: [
    {
      key: "fdm",
      name: "FDM (Filament)",
      description: "Eriyik yığma; dayanıklı prototip ve fonksiyonel parçalar",
      orderMaterial: "filament",
      capabilityTag: "material_filament",
      buildMm: { x: 250, y: 210, z: 210 },
      minWallMm: 0.8,
      minFeatureMm: 0.4,
      toleranceText: "±%0,5 (en az ±0,5 mm)",
      layerOptionsUm: [100, 200, 300],
      defaultLayerUm: 200,
      infillOptionsPct: [15, 20, 30, 50, 100],
      defaultInfillPct: 20,
      shellMm: 1.2,
      setupFeeKurus: 2500,
      machineRateKurusPerHour: 6000,
      throughputCm3PerHour: 12,
      heightHoursPerMm: 0.002,
      minUnitPriceKurus: 4900,
      baseLeadDays: 3,
      sortOrder: 0,
    },
    {
      key: "sla",
      name: "SLA (Reçine)",
      description: "Reçine; yüksek detay ve pürüzsüz yüzey",
      orderMaterial: "resin",
      capabilityTag: "material_resin",
      buildMm: { x: 218, y: 122, z: 220 },
      minWallMm: 0.6,
      minFeatureMm: 0.3,
      toleranceText: "±%0,2 (en az ±0,15 mm)",
      layerOptionsUm: [50, 100],
      defaultLayerUm: 50,
      infillOptionsPct: null,
      defaultInfillPct: null,
      shellMm: 0,
      setupFeeKurus: 3500,
      machineRateKurusPerHour: 4000,
      throughputCm3PerHour: 40,
      heightHoursPerMm: 0.03,
      minUnitPriceKurus: 7900,
      baseLeadDays: 4,
      sortOrder: 1,
    },
  ],
  materials: [
    {
      key: "pla",
      technologyKey: "fdm",
      name: "PLA",
      description:
        "Kolay basılan çok amaçlı filament; maket, dekor ve görsel prototipler için.",
      properties: { tensileMpa: 50, heatDeflectionC: 55, uses: ["prototip", "maket", "dekor"] },
      densityGCm3: 1.24,
      priceKurusPerGram: 150,
      supportFactor: 1.1,
      capabilityTag: null,
      colors: [
        { key: "beyaz", name: "Beyaz", hex: "#F5F5F5", surchargeKurus: 0 },
        { key: "siyah", name: "Siyah", hex: "#1A1A1A", surchargeKurus: 0 },
        { key: "gri", name: "Gri", hex: "#8A8D91", surchargeKurus: 0 },
        { key: "kirmizi", name: "Kırmızı", hex: "#C62828", surchargeKurus: 0 },
        { key: "mavi", name: "Mavi", hex: "#1565C0", surchargeKurus: 0 },
        { key: "yesil", name: "Yeşil", hex: "#2E7D32", surchargeKurus: 0 },
        { key: "sari", name: "Sarı", hex: "#F9A825", surchargeKurus: 0 },
      ],
      leadDaysExtra: 0,
      sortOrder: 0,
    },
    {
      key: "petg",
      technologyKey: "fdm",
      name: "PETG",
      description: "Neme ve darbeye dayanıklı; fonksiyonel parça ve muhafazalar için.",
      properties: {
        tensileMpa: 50,
        heatDeflectionC: 70,
        uses: ["fonksiyonel parça", "muhafaza", "dış mekân"],
      },
      densityGCm3: 1.27,
      priceKurusPerGram: 170,
      supportFactor: 1.1,
      capabilityTag: "pmat_petg",
      colors: [
        { key: "siyah", name: "Siyah", hex: "#1A1A1A", surchargeKurus: 0 },
        { key: "beyaz", name: "Beyaz", hex: "#F5F5F5", surchargeKurus: 0 },
        { key: "seffaf", name: "Şeffaf", hex: "#DDEEEE", surchargeKurus: 500 },
      ],
      leadDaysExtra: 0,
      sortOrder: 1,
    },
    {
      key: "abs",
      technologyKey: "fdm",
      name: "ABS",
      description: "Isıya dayanıklı mühendislik plastiği; mekanik parça ve kutular için.",
      properties: {
        tensileMpa: 40,
        heatDeflectionC: 98,
        uses: ["mekanik parça", "kutu", "otomotiv içi parça"],
      },
      densityGCm3: 1.04,
      priceKurusPerGram: 170,
      supportFactor: 1.1,
      capabilityTag: "pmat_abs",
      colors: [
        { key: "siyah", name: "Siyah", hex: "#1A1A1A", surchargeKurus: 0 },
        { key: "beyaz", name: "Beyaz", hex: "#F5F5F5", surchargeKurus: 0 },
      ],
      leadDaysExtra: 0,
      sortOrder: 2,
    },
    {
      key: "tpu95a",
      technologyKey: "fdm",
      name: "TPU 95A (esnek)",
      description: "Kauçuk benzeri esnek filament; conta, tampon ve tutamaklar için.",
      properties: {
        tensileMpa: 30,
        elongationPct: 500,
        flexible: true,
        uses: ["conta", "tampon", "esnek kılıf"],
      },
      densityGCm3: 1.21,
      priceKurusPerGram: 280,
      supportFactor: 1.1,
      capabilityTag: "pmat_tpu",
      colors: [
        { key: "siyah", name: "Siyah", hex: "#1A1A1A", surchargeKurus: 0 },
        { key: "beyaz", name: "Beyaz", hex: "#F5F5F5", surchargeKurus: 0 },
      ],
      leadDaysExtra: 1,
      sortOrder: 3,
    },
    {
      key: "standard_resin",
      technologyKey: "sla",
      name: "Standart reçine",
      description: "Yüksek detay ve pürüzsüz yüzey; figür, maket ve görsel prototipler için.",
      properties: {
        tensileMpa: 50,
        heatDeflectionC: 50,
        uses: ["figür", "maket", "görsel prototip"],
      },
      densityGCm3: 1.15,
      priceKurusPerGram: 300,
      supportFactor: 1.15,
      capabilityTag: null,
      colors: [
        { key: "gri", name: "Gri", hex: "#9E9E9E", surchargeKurus: 0 },
        { key: "beyaz", name: "Beyaz", hex: "#FAFAFA", surchargeKurus: 0 },
        { key: "siyah", name: "Siyah", hex: "#212121", surchargeKurus: 0 },
        { key: "seffaf", name: "Şeffaf", hex: "#E3F2FD", surchargeKurus: 1000 },
      ],
      leadDaysExtra: 0,
      sortOrder: 4,
    },
    {
      key: "tough_resin",
      technologyKey: "sla",
      name: "Dayanıklı reçine (ABS benzeri)",
      description: "Darbeye dayanıklı reçine; geçmeli ve fonksiyonel prototipler için.",
      properties: {
        tensileMpa: 55,
        elongationPct: 20,
        heatDeflectionC: 60,
        uses: ["geçmeli parça", "fonksiyonel prototip", "mekanik test"],
      },
      densityGCm3: 1.18,
      priceKurusPerGram: 450,
      supportFactor: 1.15,
      capabilityTag: "pmat_tough_resin",
      colors: [{ key: "gri", name: "Gri", hex: "#9E9E9E", surchargeKurus: 0 }],
      leadDaysExtra: 1,
      sortOrder: 5,
    },
    {
      key: "flex_resin",
      technologyKey: "sla",
      name: "Esnek reçine",
      description: "Yumuşak ve esnek reçine; conta, tutamak ve sönümleyici parçalar için.",
      properties: {
        tensileMpa: 8,
        elongationPct: 80,
        flexible: true,
        uses: ["conta", "tutamak", "sönümleyici"],
      },
      densityGCm3: 1.1,
      priceKurusPerGram: 550,
      supportFactor: 1.15,
      capabilityTag: "pmat_flex_resin",
      colors: [{ key: "siyah", name: "Siyah", hex: "#212121", surchargeKurus: 0 }],
      leadDaysExtra: 1,
      sortOrder: 6,
    },
  ],
  finishes: [
    {
      key: "ham",
      technologyKey: null,
      name: "Standart (destekler alınmış)",
      description: "Destekler alınır, katman izleri görünür kalır.",
      fixedKurus: 0,
      perCm2Kurus: 0,
      leadDaysExtra: 0,
      requiresManual: false,
      costLineKind: "production",
      sortOrder: 0,
    },
    {
      key: "zimpara",
      technologyKey: null,
      name: "Zımparalı",
      description: "Yüzey zımparalanır; katman izleri belirgin şekilde azalır.",
      fixedKurus: 1500,
      perCm2Kurus: 20,
      leadDaysExtra: 1,
      requiresManual: false,
      costLineKind: "production",
      sortOrder: 1,
    },
    {
      key: "astar",
      technologyKey: null,
      name: "Astarlı (boyaya hazır)",
      description: "Zımpara sonrası astar uygulanır; parça boyaya hazır teslim edilir.",
      fixedKurus: 2500,
      perCm2Kurus: 35,
      leadDaysExtra: 2,
      requiresManual: false,
      costLineKind: "production",
      sortOrder: 2,
    },
    {
      key: "boyali",
      technologyKey: null,
      name: "Boyalı (RAL)",
      description: "İstediğiniz RAL rengine boyanır; fiyatı ekibimiz belirler.",
      fixedKurus: 0,
      perCm2Kurus: 0,
      leadDaysExtra: 3,
      requiresManual: true,
      costLineKind: "painting",
      sortOrder: 3,
    },
    {
      key: "ozel",
      technologyKey: null,
      name: "Özel ardıl işlem",
      description: "Vernik, kaplama gibi özel istekler; ekibimiz fiyatlandırır.",
      fixedKurus: 0,
      perCm2Kurus: 0,
      leadDaysExtra: 2,
      requiresManual: true,
      costLineKind: "production",
      sortOrder: 4,
    },
  ],
  addons: [
    {
      key: "uygunluk_sertifikasi",
      name: "Uygunluk sertifikası",
      description: "Siparişin sipariş edilen şartlara uygun üretildiğini belgeleyen yazı.",
      priceType: "fixed",
      priceKurus: 35000,
      leadDaysExtra: 0,
      sortOrder: 0,
    },
    {
      key: "olcum_raporu",
      name: "Standart ölçüm raporu",
      description: "Kritik ölçülerin kumpasla kontrol edildiği ölçüm raporu.",
      priceType: "fixed",
      priceKurus: 125000,
      leadDaysExtra: 1,
      sortOrder: 1,
    },
    {
      key: "malzeme_veri_sayfasi",
      name: "Malzeme veri sayfası",
      description: "Kullanılan malzemenin üretici teknik veri sayfası.",
      priceType: "fixed",
      priceKurus: 15000,
      leadDaysExtra: 0,
      sortOrder: 2,
    },
    {
      key: "rohs_beyani",
      name: "RoHS uygunluk beyanı",
      description: "Kullanılan malzemenin RoHS kısıtlı maddelere uygunluk beyanı.",
      priceType: "fixed",
      priceKurus: 25000,
      leadDaysExtra: 1,
      sortOrder: 3,
    },
  ],
  settings: {
    qtyBreaks: [
      { minQty: 1, discountBps: 0 },
      { minQty: 5, discountBps: 500 },
      { minQty: 10, discountBps: 1000 },
      { minQty: 25, discountBps: 1500 },
      { minQty: 50, discountBps: 2000 },
      { minQty: 100, discountBps: 2500 },
      { minQty: 500, discountBps: 3000 },
    ],
    leadTiers: [
      { key: "economy", name: "Ekonomik", multiplierBps: 9000, daysDelta: 3, minDays: 5 },
      { key: "standard", name: "Standart", multiplierBps: 10000, daysDelta: 0, minDays: 3 },
      { key: "express", name: "Ekspres", multiplierBps: 14000, daysDelta: -2, minDays: 2 },
    ],
    minOrderKurus: 20000,
    maxAutoTotalKurus: 10000000,
    maxAutoQtyPerPart: 1000,
    maxPartsPerQuote: 20,
    maxFileBytes: SEED_MAX_FILE_BYTES,
    quoteValidDays: 30,
    retentionDaysAfterExpiry: 90,
    priceBreakQuantities: [1, 5, 10, 25, 50, 100],
    holidays: [
      "2026-01-01",
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
      "2026-04-23",
      "2026-05-01",
      "2026-05-19",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
      "2026-07-15",
      "2026-08-30",
      "2026-10-29",
      "2027-01-01",
      "2027-03-09",
      "2027-03-10",
      "2027-03-11",
      "2027-04-23",
      "2027-05-01",
      "2027-05-16",
      "2027-05-17",
      "2027-05-18",
      "2027-05-19",
      "2027-07-15",
      "2027-08-30",
      "2027-10-29",
    ],
    cutoffHour: 14,
    havaleDiscountApplies: true,
  },
};
