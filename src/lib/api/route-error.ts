import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap.
 *
 * NEDEN BU MODÜL VAR: App Router'da bir rota fırlatırsa Next kendi 500'ünü
 * döner ve gövde SIFIR BAYTTIR. Panel o zaman kendi yedek cümlesini gösterir
 * ("İşlem tamamlanamadı (HTTP 500)") — yani ekranda ne olduğuna, işin geçip
 * geçmediğine ve ne yapılması gerektiğine dair TEK KELİME yoktur. Bağlayıcı
 * kural: her hata, bir ekranın gösterebileceği TÜRKÇE bir mesaj taşır.
 *
 * Tek tek rotalara serpiştirilmiş cümleler yerine tek kaynak: cümleler burada
 * durur, rotalar yalnızca hangi panele/işe ait olduğunu seçer. Böylece aynı
 * arıza her panelde aynı dille anlatılır ve yeni bir rota eklendiğinde
 * kopyalanacak hazır bir cümle vardır.
 *
 * Bu modül bilerek SAFTIR: DB, oturum, "server-only" içe aktarımı yoktur —
 * rotalar dışında da (ileride) çağrılabilsin ve worker zincirine hiçbir şey
 * bulaştırmasın.
 */

/**
 * Partnerin (üretici/boyacı) bir DÜĞMEYE bastığı uçlar.
 *
 * "Hiçbir şey değişmedi" DEMİYOR: beklenmeyen hatada işin yazılıp yazılmadığını
 * bu genel dal bilemez. Uydurulmuş bir kesinlik yerine partneri doğruyu
 * görebileceği tek yere — kendi listesine — yollar. İki hâli gerçekten
 * ayırabilen uçlar (kabul, iptal, ret, onay) kendi iki cümlesini yazar; bu
 * cümle onların yerine geçmez.
 */
export const PARTNER_ACTION_FAILED_ERROR =
  "Beklenmeyen bir hata nedeniyle işlem tamamlanamadı. İşlemin geçip geçmediğini görmek için sayfayı yenileyin; sorun sürerse yöneticiye bildirin.";

/** Partner panelinin yalnızca OKUYAN uçları (liste, detay, dosya indirme). */
export const PARTNER_READ_FAILED_ERROR =
  "Beklenmeyen bir hata nedeniyle bilgiler getirilemedi. Sayfayı yenileyin; sorun sürerse yöneticiye bildirin.";

/** Yöneticinin bir düğmeye bastığı uçlar. */
export const ADMIN_ACTION_FAILED_ERROR =
  "Beklenmeyen bir hata nedeniyle işlem tamamlanamadı. Kaydın son durumunu görmek için sayfayı yenileyin; sorun sürerse sunucu günlüklerine bakın.";

/** Yönetici panelinin yalnızca OKUYAN uçları. */
export const ADMIN_READ_FAILED_ERROR =
  "Beklenmeyen bir hata nedeniyle kayıtlar okunamadı. Sayfayı yenileyin; sorun sürerse sunucu günlüklerine bakın.";

/**
 * Gövdeli 500. `reason` makine-okur: istemci, beklenen bir ret (400/409) ile
 * beklenmeyen bir arızayı ayırt edebilsin.
 */
export function routeFailureResponse(message: string, status = 500) {
  return NextResponse.json({ error: message, reason: "unexpected_error" }, { status });
}

/**
 * Rotanın en dış `catch`inde çağrılır: hatayı günlüğe yazar ve TÜRKÇE gövdeli
 * bir cevap döner.
 *
 * `unstable_rethrow` ÖNCE gelir ve bu bir incelik değil, zorunluluktur: Next
 * kendi akış denetimini (redirect/notFound, dinamik render'a düşme) hata
 * fırlatarak yapar. Onları yutan bir `catch`, çerçevenin işaretini 500'e
 * çevirir ve rotayı sessizce yanlış çalıştırır. Yardımcı bu hataları olduğu
 * gibi yukarı bırakır; yalnızca GERÇEK arızalar cevaba dönüşür.
 *
 * @param where Günlükte hangi ucun patladığını söyleyen etiket ("POST /api/…").
 */
export function handleRouteFailure(e: unknown, where: string, message: string) {
  unstable_rethrow(e);
  console.error(`${where}: beklenmeyen hata`, e);
  return routeFailureResponse(message);
}

/* ── Müşteri / kamuya açık uçlar ────────────────────────────────────────────
 *
 * Panel cümleleri (yukarıda) yöneticiyi sunucu günlüklerine, partneri kendi iş
 * listesine yollar. Müşterinin ne günlüğü ne iş listesi vardır; ona verilecek
 * tek dürüst öğüt "ne yapacağını görebileceğin yere bak"tır. Bu yüzden ayrı
 * cümleler: aynı arıza müşteri ekranında panel diliyle anlatılamaz.
 */

/** Ziyaretçinin/müşterinin bir DÜĞMEYE bastığı uçlar (sipariş dışı işler). */
export const CUSTOMER_ACTION_FAILED_ERROR =
  "Beklenmeyen bir hata nedeniyle işlem tamamlanamadı. İşlemin geçip geçmediğini görmek için sayfayı yenileyin; sorun sürerse bizimle iletişime geçin.";

/** Yalnızca OKUYAN müşteri uçları (liste, detay, durum sorgusu). */
export const CUSTOMER_READ_FAILED_ERROR =
  "Beklenmeyen bir hata nedeniyle bilgiler getirilemedi. Sayfayı yenileyin; sorun sürerse bizimle iletişime geçin.";

/**
 * PARANIN geçtiği uçlar (ödeme başlatma, tekrar deneme, ödeme doğrulama,
 * sipariş oluşturma).
 *
 * "Tekrar deneyin" DEMEZ: beklenmeyen bir hatada çekimin yapılıp yapılmadığını
 * uç bilemez ve körlemesine tekrar denemek ikinci bir çekim riski taşır.
 * Müşteriyi önce durumu görebileceği yere yollar.
 */
export const CUSTOMER_PAYMENT_FAILED_ERROR =
  "Ödeme adımı beklenmeyen bir hata nedeniyle tamamlanamadı. Tekrar denemeden önce sipariş durumunuzu kontrol edin: kartınızdan çekim yapıldıysa sipariş kısa süre içinde ödendi olarak görünür, aksi hâlde yeniden deneyebilirsiniz.";

/** Giriş/kayıt/doğrulama uçları — henüz oturum yok, yenilenecek bir kayıt da. */
export const AUTH_ACTION_FAILED_ERROR =
  "Beklenmeyen bir hata nedeniyle bu adım tamamlanamadı. Birkaç saniye sonra tekrar deneyin; sorun sürerse bizimle iletişime geçin.";

/** Dosya yükleme/işleme uçları — kullanıcının elinde hâlâ dosya var. */
export const UPLOAD_FAILED_ERROR =
  "Beklenmeyen bir hata nedeniyle dosya işlenemedi. Dosyayı yeniden yüklemeyi deneyin; sorun sürerse bizimle iletişime geçin.";
