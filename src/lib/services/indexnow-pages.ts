/**
 * STATİK SAYFALARIN IndexNow DUYURUSU — "içeriği değişen sayfayı Bing'e haber
 * ver" turu.
 *
 * NİÇİN VAR. `indexnow.ts`in başlığı amacı yazıyor: ChatGPT'nin retrieval'ı
 * Bing indeksinde çalışıyor ve "yayınladık"tan "bir AI cevabı onu
 * alıntılayabilir"e giden yol IndexNow → Bing → ChatGPT. Ama 2026-10-02
 * denetimine kadar depoda TEK çağrı yeri vardı: pazar yeri ürün onayı
 * (`api/admin/products/[id]/approve`). Yani `/`, `/figur`, `/nasil-calisir`,
 * `/3d-baski`, `/3d-baski/malzemeler`, `/urunler` ve V3'ün açtığı altı özel gün
 * sayfası pasif yeniden taramaya bırakılmıştı — ChatGPT'ye girmek için kurulmuş
 * tek araç, o sayfalar için hiç çalışmıyordu.
 *
 * TETİKLEYİCİ: TARİHİ DEĞİŞEN SAYFA. Her dağıtımda bütün sayfaları göndermek
 * gürültüdür; IndexNow "bu URL DEĞİŞTİ" demek için var ve değişmediği hâlde
 * sürekli duyurulan bir URL sinyali değersizleştirir. Değişimin ölçüsü
 * `PAGE_UPDATED_AT`: elle yazılan, "içerik anlamlı biçimde değişti mi"
 * sorusunun tek yanıtı (bkz. o dosyanın başlığı — ne derleyici ne git mtime bu
 * soruyu yanıtlayabilir). Tur, kayıttaki tarihleri SON DUYURULAN tarihlerle
 * karşılaştırır ve yalnız farkı gönderir.
 *
 * HAFIZA REDIS'TE, TEK BİR JSON ANAHTARI. Neden tablo değil: bu bir
 * MUHASEBE kaydı değil, bir "en son neyi duyurduk" notu; üretim Redis'i AOF ile
 * kalıcı (`docker-compose.production.yml`: `--appendonly yes` + adlandırılmış
 * hacim), yani bir kaptan yeniden yaratma onu silmiyor. Tek JSON dizgisi
 * seçildi çünkü yazım ATOMİK ve kayıttan düşen bir yol hafızadan da
 * kendiliğinden düşüyor (alan alan yazılan bir hash'te artık satırlar birikirdi).
 *
 * HAFIZA BOŞKEN GÖNDERİM YOK, TEMEL ALINIR. İlk tur (ya da Redis kaybı sonrası)
 * neyin değiştiğini bilemez; "bilmiyorum" hâlinde her şeyi göndermek tam olarak
 * kaçınılan gürültü olurdu. O yüzden ilk tur yalnız bugünkü tarihleri yazar ve
 * susar — ilk kayıt anında ve bir içerik turundan sonra ELLE TETİK
 * (`/admin/ayarlar`) var, zaten tam bunun için.
 *
 * `submitToIndexNow`UN SÖZLEŞMESİ DEĞİŞTİRİLMEDİ: host süzgeci, 10.000 URL
 * tavanı, 8 sn zaman aşımı ve sessiz `{ok:false}` dönüşü olduğu gibi duruyor.
 * Bu modül onun ÜSTÜNDE karar veriyor; anahtarın yokluğunu yüzeye taşımak da
 * burada oluyor (`loadIndexNowPageStatus`).
 *
 * NOT: `import "server-only"` YOK — bu modülü BullMQ worker süreci yüklüyor
 * ([[worker-server-only-trap]]).
 */
import { PAGE_UPDATED_AT } from "@/lib/config/page-updated";
import { getRedisConnection } from "@/lib/queue/connection";
import { getAppUrl } from "@/lib/seo/organization";
import {
  INDEXNOW_KEY_PATH,
  getIndexNowKey,
  submitToIndexNow,
} from "./indexnow";

/**
 * Duyurulacak yollar — `PAGE_UPDATED_AT`ten TÜRÜR, elle yazılmaz.
 *
 * İkinci bir liste, yedinci bir özel gün eklendiği gün o sayfanın hiç
 * duyurulmaması demekti. Kayıt zaten sitemap'in statik rotalarıyla birebir
 * aynı olmak ZORUNDA (`scripts/test-sitemap.ts` eksik yolu kırmızıya çeviriyor,
 * `scripts/test-indexnow.ts` de iki kümenin aynılığını sınıyor), yani burada
 * taranması yasak bir sayfa belirmesi mümkün değil.
 */
export const INDEXNOW_PAGE_PATHS: readonly string[] = Object.keys(PAGE_UPDATED_AT);

/** Redis'teki hafıza anahtarı. Tek bir JSON dizgisi tutar (yol → tarih). */
export const ANNOUNCED_PAGES_KEY = "indexnow:announced-pages";

/**
 * Yolun mutlak hâli.
 *
 * Anasayfa (`""`) için SONDAKİ EĞİK ÇİZGİ YOK: `sitemap.ts` de `${baseUrl}${path}`
 * yazıyor, yani apex adresi eğik çizgisiz duyuruluyor. İki farklı yazım, aynı
 * sayfayı iki ayrı URL olarak haber vermek olurdu.
 */
export function pageAbsoluteUrl(path: string, appUrl: string = getAppUrl()): string {
  return `${appUrl}${path}`;
}

/**
 * SON DUYURULAN tarihlerin saklandığı yer. Arayüz, turu Redis'ten bağımsız
 * sınanabilir kılıyor (testte bellek içi bir karşılığı kullanılıyor).
 */
export interface AnnouncedPageStore {
  read(): Promise<Record<string, string>>;
  write(entries: Record<string, string>): Promise<void>;
}

/**
 * Redis'e bakan hafıza; `REDIS_URL` yoksa `null`.
 *
 * `flags.ts` ile aynı desen: Redis'in yokluğu bir ARIZA değil, bir ortam
 * durumudur ve çağıran taraf buna göre karar verir (otomatik tur hafıza
 * olmadan gönderim yapmaz, elle tetik yapar).
 */
export function redisAnnouncedPageStore(): AnnouncedPageStore | null {
  if (!process.env.REDIS_URL) return null;
  let redis;
  try {
    redis = getRedisConnection();
  } catch {
    return null;
  }
  return {
    async read() {
      const raw = await redis.get(ANNOUNCED_PAGES_KEY);
      if (!raw) return {};
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        // Bozuk/yabancı bir değer hafızayı değil yalnız bu turu etkilesin:
        // yalnız dizgi değerler alınır, gerisi yok sayılır.
        return Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        );
      } catch {
        // Okunamayan hafıza = hafıza yok: tur temel almaya düşer, gönderim
        // yapmaz. Sessizce her şeyi göndermekten iyidir.
        return {};
      }
    },
    async write(entries) {
      await redis.set(ANNOUNCED_PAGES_KEY, JSON.stringify(entries));
    },
  };
}

/**
 * Tarihi DEĞİŞEN (ya da kayda yeni giren) yollar — kayıt sırasında.
 *
 * Saf fonksiyon: turun kararı budur ve ayrı sınanabilir olması gerekiyor.
 */
export function changedPagePaths(
  current: Readonly<Record<string, string>>,
  announced: Readonly<Record<string, string>>
): string[] {
  return Object.keys(current).filter((path) => announced[path] !== current[path]);
}

export type AnnounceScope = "changed" | "all";

export type AnnounceRefusal =
  | "no_key"
  | "no_store"
  | "no_urls"
  | "http_error"
  | "network_error";

/**
 * `baseline` ve `no_change` AYRI üyeler (`kind: "baseline" | "no_change"` tek bir
 * üyede birleştirilMEDİ): birleşik hâlde `kind` karşılaştırması diğer üyeyi
 * elemiyor ve `submitted` okuması derlenmiyor. Ayrışık üyeler, "gönderildi"
 * dalının gerçekten daraltılmasını sağlıyor.
 */
export type AnnounceOutcome =
  | { ok: true; kind: "submitted"; scope: AnnounceScope; paths: string[]; submitted: number }
  | { ok: true; kind: "baseline"; scope: AnnounceScope; paths: string[] }
  | { ok: true; kind: "no_change"; scope: AnnounceScope; paths: string[] }
  | { ok: false; kind: "refused"; scope: AnnounceScope; paths: string[]; reason: AnnounceRefusal };

export interface AnnounceOptions {
  /** `"changed"`: otomatik tur. `"all"`: admin düğmesi (ilk kayıt / içerik turu). */
  scope?: AnnounceScope;
  store?: AnnouncedPageStore | null;
  appUrl?: string;
}

/**
 * Turun kendisi.
 *
 * Kurallar sırayla: anahtar yoksa hiçbir şey yapma (hafızaya DA dokunma, yoksa
 * anahtar gelmeden "duyurdum" yazılmış olurdu) → elle tetik değilse hafıza
 * zorunlu → hafıza boşsa temel al ve sus → değişen yoksa ağa çıkma → gönder →
 * ancak BAŞARILI gönderimden sonra hafızayı yaz.
 */
export async function announceStaticPages(
  options: AnnounceOptions = {}
): Promise<AnnounceOutcome> {
  const scope = options.scope ?? "changed";
  const store = options.store === undefined ? redisAnnouncedPageStore() : options.store;
  const appUrl = options.appUrl ?? getAppUrl();
  const current: Record<string, string> = { ...PAGE_UPDATED_AT };

  if (!getIndexNowKey()) {
    return { ok: false, kind: "refused", scope, paths: [], reason: "no_key" };
  }

  if (scope === "changed" && !store) {
    // Hafıza olmadan "ne değişti" sorusu yanıtlanamaz ve otomatik tur bu soruya
    // dayanıyor. Her şeyi göndermek, kaçınılan gürültünün ta kendisi olurdu.
    return { ok: false, kind: "refused", scope, paths: [], reason: "no_store" };
  }

  let announced: Record<string, string> = {};
  if (scope === "changed" && store) {
    announced = await store.read();
    if (Object.keys(announced).length === 0) {
      await store.write(current);
      return { ok: true, kind: "baseline", scope, paths: [] };
    }
  }

  const paths =
    scope === "all" ? [...INDEXNOW_PAGE_PATHS] : changedPagePaths(current, announced);
  if (paths.length === 0) {
    return { ok: true, kind: "no_change", scope, paths: [] };
  }

  const result = await submitToIndexNow(paths.map((p) => pageAbsoluteUrl(p, appUrl)));
  if (!result.ok) {
    // Hafıza DOKUNULMADAN bırakılır: sayfa duyurulmadı, bir sonraki tur (ya da
    // düğme) yeniden denesin.
    return { ok: false, kind: "refused", scope, paths, reason: result.reason };
  }

  // Bütün kayıt yazılır, yalnız gönderilenler değil: kayıttan düşmüş bir yol
  // hafızadan da düşsün. Gönderilen URL'lerin hepsi `appUrl`den kuruluyor, yani
  // `submitToIndexNow`un host süzgeci hiçbirini düşüremez ve `submitted`
  // sayısı `paths` ile aynı kalır.
  if (store) await store.write(current);
  return { ok: true, kind: "submitted", scope, paths, submitted: result.submitted };
}

/** Admin ekranındaki tek satır. */
export interface IndexNowPageRow {
  path: string;
  url: string;
  /** `PAGE_UPDATED_AT`teki tarih — sayfanın BUGÜNKÜ hâli. */
  updatedAt: string;
  /** En son hangi tarihle duyurulduğu; hiç duyurulmadıysa `null`. */
  announcedFor: string | null;
  pending: boolean;
}

export interface IndexNowPageStatus {
  /** `INDEXNOW_KEY` dolu mu — yüzey bunu AÇIKÇA göstermek zorunda. */
  keyConfigured: boolean;
  /** Anahtar dosyasının beklendiği adres (spec gereği sitede yayınlanıyor). */
  keyLocation: string;
  /** Redis okunabildi mi; okunamadıysa otomatik tur gönderim yapmaz. */
  storeAvailable: boolean;
  /** Hafıza boş: bir sonraki otomatik tur yalnız temel alacak. */
  baseline: boolean;
  pendingCount: number;
  rows: IndexNowPageRow[];
}

/**
 * Ekranın okuduğu durum.
 *
 * `getIndexNowKey()` anahtarın KENDİSİNİ asla dışarı vermez, yalnız dolu olup
 * olmadığını — bir admin ekranı bile bir sırrı gövdesinde taşımaz.
 */
export async function loadIndexNowPageStatus(
  options: { store?: AnnouncedPageStore | null; appUrl?: string } = {}
): Promise<IndexNowPageStatus> {
  const store = options.store === undefined ? redisAnnouncedPageStore() : options.store;
  const appUrl = options.appUrl ?? getAppUrl();

  let announced: Record<string, string> = {};
  let storeAvailable = store !== null;
  if (store) {
    try {
      announced = await store.read();
    } catch {
      // Redis tıksırsa ekran yine açılsın: satırlar "hiç duyurulmadı" görünür
      // ve yüzey hafızanın okunamadığını söyler.
      storeAvailable = false;
    }
  }

  const rows: IndexNowPageRow[] = INDEXNOW_PAGE_PATHS.map((path) => {
    const updatedAt = PAGE_UPDATED_AT[path];
    const announcedFor = announced[path] ?? null;
    return {
      path,
      url: pageAbsoluteUrl(path, appUrl),
      updatedAt,
      announcedFor,
      pending: announcedFor !== updatedAt,
    };
  });

  return {
    keyConfigured: getIndexNowKey() !== null,
    keyLocation: `${appUrl}${INDEXNOW_KEY_PATH}`,
    storeAvailable,
    baseline: storeAvailable && Object.keys(announced).length === 0,
    pendingCount: rows.filter((r) => r.pending).length,
    rows,
  };
}
