/**
 * STEP (.step/.stp) kabulünün SAF sabitleri.
 *
 * Her sayı S1 spike'ında ÖLÇÜLDÜ; gerekçeler
 * `.superpowers/sdd/2026-09-22-anlik-teklif-motoru/task-s1-report.md` içindedir
 * ve yanlarında hangi ölçümden geldikleri yazılı. Tahminle değiştirilmezler.
 *
 * SAF MODÜL: DB yok, `server-only` YOK, `node:` import'u yok. Sebep: bu dosyayı
 * hem istemci yükleme alanı (dropzone) hem standalone-Node BullMQ worker'ı
 * okuyacak; `server-only` worker'ı çökertir ([[worker-server-only-trap]]).
 *
 * NEDEN AYAR DEĞİL, SABİT: katalog `quotes.pricing_snapshot`ta donduruluyor.
 * `quote_pricing_settings`e yeni bir kolon eklemek SAHADAKİ tüm snapshot'larda
 * o alanı `undefined` yapar (eski teklifler yeni ayarı taşımaz), yani tavan
 * teklif teklif değişirdi. Tavan bir dağıtım kararıdır, fiyat ayarı değil.
 */
import type { PartTessellation } from "@/lib/config/quote-types";

/**
 * STEP'in KENDİ bayt tavanı — genel yükleme tavanının (`maxFileBytes`,
 * `SEED_MAX_FILE_BYTES` = 32 MiB) ALTINDA, çünkü aynı bayt sayısı STEP'te
 * mesh'ten kat kat fazla geometri taşır.
 *
 * ÖLÇÜM (S1 §2.3, worker imajında `mem_limit: 2g` altında):
 *   15,1 MB STEP → 20.001 B-rep yüzey → 1.173.392 üçgen → ölçüm GEÇER (1,44 GiB)
 *   30,2 MB STEP → 41.472 B-rep yüzey → 2.433.024 üçgen → `too_many_faces` (tavan 1,5M)
 * Yani 32 MiB'lik genel tavan worker'ı tek başına KORUMUYOR; 16 MiB, ölçülen
 * "sığar" vakasının hemen üstündeki ilk yuvarlak sayıdır.
 */
export const STEP_MAX_BYTES = 16 * 1024 * 1024;

/**
 * B-rep yüzey tavanı: bayttan sayılır, mesh YÜKLENMEDEN (ve OCCT bir arena
 * rezerve etmeden) reddedilir.
 *
 * ÖLÇÜM (S1 §2.3 + karar 6): tavanı belirleyen şey step_mesh'in kendi RSS'i
 * değil ÜÇGEN bütçesidir — 41.472 yüzeyli parça 2 GiB konteynerde çevrilebildi
 * (1,62 GiB) ama ürettiği 2,43M üçgen `analyze_quote_part.py`nin 1,5M tavanının
 * üstünde; 39,6 s OCCT işi ve 121,7 MB STL boşa giderdi. Ön kontrol bu reddi
 * 0,8 s ve 0,16 GiB'e indiriyor.
 *
 * `scripts/step_mesh.py` `DEFAULT_MAX_BREP_FACES` ve `analyze_quote_part.py`
 * `DEFAULT_MAX_BREP_FACES` ile AYNI sayı olmak zorunda (ebeveyn çocuğa kendi
 * tavanını `--max-faces` ile geçiriyor). `mem_limit` ve `DEFAULT_MAX_INPUT_FACES`
 * ile birlikte, yeni bir ölçümle değişir.
 */
export const STEP_MAX_BREP_FACES = 20_000;

/**
 * Çekirdeğe verilen üçgenleştirme sapması — `scripts/step_mesh.py`nin
 * `DEFAULT_DEFLECTION_MM` / `DEFAULT_ANGULAR_RAD` varsayılanlarının BİREBİR
 * kopyası. Ayrışırlarsa donmuş fiyat, üreticiye giden ağdan başka bir ağdan
 * hesaplanmış olur.
 *
 * ÖLÇÜM (S1 §2.6 = defter kaydı SK-1): tasarımın önerdiği 0,05 mm REDDEDİLDİ —
 * `cylinder_r10h20.step` (analitik 6283,19 mm³) hacminin **%0,3246**'sını
 * kaybediyor (r=10'da duvar 45 kenara iniyor), programın kabul ettiği %0,2
 * bütçesinin üstü. 0,01 mm → 100 kenar, **%0,0658**. Açı toleransının birimi
 * RADYAN'dır (cascadio `tol_angular`), derece DEĞİL (SK-2): 0,5 derece okunursa
 * r10 silindir 396 → 5756 üçgene çıkar.
 *
 * DEĞİŞTİRİLİRSE geometri ve dolayısıyla FİYAT değişir →
 * `STEP_TESSELLATION_VERSION` artırılır; yeni sürüm YALNIZ yeni yüklemelere
 * uygulanır, eski parçalar yeniden ÖLÇÜLMEZ (fiyat verilmiş bir parçanın
 * geometrisi sabittir; `requeueStuckQuoteParts` yalnız `queued`/`analyzing`
 * satırları alır).
 */
export const STEP_TESSELLATION = {
  deflectionMm: 0.01,
  angularRad: 0.5,
  relative: false,
} as const satisfies PartTessellation;

/**
 * Yukarıdaki üç parametrenin sürümü. Parametreler geometriyle birlikte
 * (`PartGeometry.tessellation`) saklandığı için bu sayı "hangi parça hangi
 * sapmayla ölçüldü" sorusunun cevabıdır: sabit ileride değişirse eski parçalar
 * eski değerleriyle okunmaya devam eder.
 */
export const STEP_TESSELLATION_VERSION = 1;
