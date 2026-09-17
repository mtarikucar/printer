import { isKnownProvince, normalizeCoverage } from "@/lib/validators/network-map";

/**
 * Üretim ağı haritasının SAF çekirdeği.
 *
 * DB yok, `server-only` yok: bu modülü hem anasayfa sunucu bileşeni (servis
 * üzerinden), hem admin istemci bileşeni, hem de DB'siz birim testi import
 * eder. `src/lib/db` import edildiği anda `pg.Pool` kurulduğu için ayrımı
 * korumak zorunlu.
 *
 * GİZLİLİK SÖZLEŞMESİ — burada üretilen nesne public API'dir ve KİMLİK
 * İÇERMEZ. Hiçbir partnerin unvanı yayımlanmaz; harita "hangi illerde üretim
 * var ve her atölye hangi illere hizmet veriyor" sorusunu yanıtlar, "kim"
 * sorusunu değil.
 *
 * Neden: üretici sözleşmesi Platforma yayın hakkını LİSTELENEN ÜRÜN başına
 * veriyor ("Bir ürünü listeleyerek..."), yani hiç ürün listelememiş, yalnızca
 * fason üreten bir atölyenin unvanı bugüne dek hiçbir public yüzeyde yok.
 * Boyacı sözleşmesi v3.0 ise unvan+il'i yalnızca DEVİR ALAN ÜRETİCİYE açıyor
 * ("yalnızca bu devir için kullanılır"). İkisi de açık internete yayın
 * yetkisi vermiyor; üstelik partnerlerin çoğu şahıs işletmesi, yani unvan
 * kişisel addır. Unvanları da yayımlamak istenirse ÖNCE sözleşmeye madde +
 * sürüm bump gerekir, sonra buraya alan eklenir.
 *
 * Ayrıca id, e-posta, telefon, açık adres, İLÇE, IBAN ve `acceptingOrders`
 * payload'a GİRMEZ. İlçe, il düzeyindeki bir harita için gereksiz ve ev
 * atölyesinin konumunu daraltır.
 */

export type PartnerKind = "manufacturer" | "painter";

/** Payload'a giren tek partner kaydı. Alan eklerken yukarıdaki sözleşmeyi oku. */
export interface PublicPartner {
  kind: PartnerKind;
  il: string | null;
  /**
   * Bu partnerin hizmet verdiği iller, Türkçe sıralı.
   *
   * Üreticide HESAPLANAN plandan gelir (`plannedCoverage`); boyacıda hâlâ
   * "kapsama ∪ {konum ili}". Yani üreticinin konum ili burada garanti DEĞİL:
   * yönetici o ili dışladıysa atölye haritada durur ama il kapsanmış sayılmaz.
   */
  coverage: string[];
  /** Yalnız üreticide ve yalnız BEYAN EDİLMİŞ malzemeler. */
  materials: string[];
}

export interface NetworkMapData {
  partners: PublicPartner[];
  /** il → o ildeki (located) ve o ile hizmet veren (covered) partner indeksleri. */
  provinces: Record<string, { located: number[]; covered: number[] }>;
  stats: {
    manufacturers: number;
    painters: number;
    /** Atölyesi olan il sayısı. */
    homeProvinces: number;
    /** En az bir partnerin GERÇEKTEN hizmet verdiği (covered) il sayısı. */
    coveredProvinces: number;
  };
}

/** buildNetworkMap'in beklediği ham satır — DB tiplerine bağlı değil. */
export interface PartnerRow {
  kind: PartnerKind;
  /** `address.il`; PROVINCES'ta yoksa konum yok sayılır. */
  il: string | null | undefined;
  coverageProvinces?: string[] | null;
  capabilities?: string[] | null;
  /**
   * HESAPLANAN etki alanı (`services/coverage-plan.ts`).
   *
   * VERİLDİYSE elle yazılmış liste hiç okunmaz ve konum ili de OTOMATİK
   * EKLENMEZ: planda dışlanan bir il, o ilde atölye olsa bile kapsanmış
   * görünemez — yöneticinin "burayı karşılamıyoruz" kararı public yüzeyde de
   * geçerli olmalı. Konum ilini burada geri eklemek, dışlama kaldıracını tam da
   * müşterinin baktığı yerde sessizce iptal ederdi.
   *
   * BOŞ DİZİ ile YOKLUK farklıdır: boş dizi "plan bu atölyeye hiç il vermedi"
   * demektir ve elle yazılan listeye DÜŞMEZ; `undefined` ise "bu satır planın
   * dışında" (boyacılar plana girmez, çünkü plan hangi ilin hangi atölyede
   * BASILDIĞININ hesabıdır).
   */
  plannedCoverage?: readonly string[] | null;
}

const ALL_MATERIALS = ["resin", "filament"] as const;

/**
 * Üreticinin gösterilecek malzemeleri — YALNIZCA beyan ettikleri.
 *
 * `manufacturerSupportsMaterial` etiketsiz eski kayıtları "her malzemeyi basar"
 * sayar; bu, kötü durumda admin'in gördüğü fazladan bir aday üreten İÇ ve
 * hoşgörülü bir yönlendirme varsayılanıdır. Aynı varsayımı haritaya taşımak onu
 * partnerin hiç yapmadığı ve düzeltemeyeceği PUBLIC bir olgu iddiasına
 * çevirirdi (reçineci bir atölyenin yanında "Filament" rozeti). İki yüzeyin
 * burada farklı konuşması doğrudur: etiket yoksa rozet de yok.
 */
export function materialsOf(capabilities: string[] | null | undefined): string[] {
  const tagged = (capabilities ?? [])
    .filter((c) => c.startsWith("material_"))
    .map((c) => c.slice("material_".length))
    .filter((m): m is (typeof ALL_MATERIALS)[number] =>
      (ALL_MATERIALS as readonly string[]).includes(m)
    );
  return [...new Set(tagged)];
}

/**
 * Etkin etki alanı: admin'in verdiği kapsama + partnerin bulunduğu il.
 *
 * Konum ili her zaman dâhildir; admin bir atölyenin kendi ilini ayrıca
 * işaretlemek zorunda kalmamalı. Konum ili `address.il`'den gelir ve partner
 * kendi profilinden değiştirebilir — yani pinini kendisi taşıyabilir.
 */
export function effectiveCoverage(
  coverage: string[] | null | undefined,
  il: string | null | undefined
): string[] {
  const list = normalizeCoverage(coverage ?? []);
  if (isKnownProvince(il) && !list.includes(il)) {
    list.push(il);
    list.sort((a, b) => a.localeCompare(b, "tr"));
  }
  return list;
}

/**
 * Ham partner satırlarından public harita verisi üretir. Saf: aynı girdi → aynı
 * çıktı, IO yok.
 */
export function buildNetworkMap(rows: PartnerRow[]): NetworkMapData {
  const partners: PublicPartner[] = [];
  const provinces: NetworkMapData["provinces"] = {};

  const bucket = (il: string) => {
    const existing = provinces[il];
    if (existing) return existing;
    const created = { located: [] as number[], covered: [] as number[] };
    provinces[il] = created;
    return created;
  };

  for (const row of rows) {
    const il = isKnownProvince(row.il) ? row.il : null;
    // Plan verilmişse TEK hesap odur; verilmemişse (boyacı) eski etkin liste.
    const coverage = Array.isArray(row.plannedCoverage)
      ? normalizeCoverage([...row.plannedCoverage])
      : effectiveCoverage(row.coverageProvinces, il);
    // Nereye koyacağımız belli değilse haritaya hiç girmesin.
    if (!il && coverage.length === 0) continue;

    const index = partners.length;
    partners.push({
      kind: row.kind,
      il,
      coverage,
      materials: row.kind === "manufacturer" ? materialsOf(row.capabilities) : [],
    });

    if (il) bucket(il).located.push(index);
    for (const covered of coverage) bucket(covered).covered.push(index);
  }

  const homeProvinces = Object.values(provinces).filter((p) => p.located.length > 0).length;
  // "Hizmet verilen il" = GERÇEKTEN KAPSANAN il. Eskiden indeksin anahtar sayısı
  // (konumu VEYA kapsaması olan iller) sayılıyordu; bu, kapsama elle yazıldığı
  // sürece zararsızdı çünkü atölyenin kendi ili listeye otomatik giriyordu.
  // Kapsama hesaplanmaya başlayınca zararsız olmaktan çıktı: DIŞLANMIŞ ama
  // içinde atölye bulunan bir il, haritada gri boyanırken (dolgu `covered`
  // sayısına bakar) sayaçta "hizmet veriliyor" diye görünürdü. Sayı ile renk
  // aynı şeyi söylemek zorunda.
  const coveredProvinces = Object.values(provinces).filter((p) => p.covered.length > 0).length;

  return {
    partners,
    provinces,
    stats: {
      manufacturers: partners.filter((p) => p.kind === "manufacturer").length,
      painters: partners.filter((p) => p.kind === "painter").length,
      homeProvinces,
      coveredProvinces,
    },
  };
}

/**
 * "Bu partner gerçekten public haritada mı?" — admin yüzeylerinin TEK yanıtı.
 *
 * Ham `map_visible` bu sorunun cevabı DEĞİL: public sorgu ayrıca status='active'
 * istiyor. Askıdaki bir partner için "Görünür" yazmak, gizlilik denetimi yapan
 * admin'e iki yönde de yanlış cevap verirdi.
 *
 * SAF modülde durur, servis modülünde değil: admin editörü bir İSTEMCİ
 * bileşenidir ve bunu servisten import etmek `pg`yi tarayıcı paketine sürükler
 * (bir kez yapıldı, `next dev` "Module not found: pg" ile 500 verdi).
 */
export function isPubliclyOnMap(status: string, mapVisible: boolean): boolean {
  return mapVisible && status === "active";
}
