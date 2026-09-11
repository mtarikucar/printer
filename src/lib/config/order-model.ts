/**
 * Siparişe yüklenen 3D model dosyaları — SAF modül.
 *
 * DB yok, `server-only` yok: admin yükleyicisi (istemci) dosyaları seçerken,
 * yükleme route'u (sunucu) kaydetmeden önce aynı kuralları uygular. İki taraf
 * ayrı kural tutsaydı istemcinin kabul ettiği bir dosya sunucuda sessizce
 * reddedilir ya da tersi olurdu.
 *
 * Bir sipariş TEK bir model değil, bir DOSYA KÜMESİdir: bazı işler 12-13 ayrı
 * parçadan oluşuyor. Her yükleme bir sürüm (revision) açar ve o sürüm istenen
 * sayıda STL ve/veya GLB içerir. GLB artık zorunlu değil — yalnız STL (baskı
 * dosyası) ya da yalnız GLB (görüntüleme) geçerli bir yüklemedir.
 */

export const ORDER_MODEL_FORMATS = ["stl", "glb"] as const;
export type OrderModelKind = (typeof ORDER_MODEL_FORMATS)[number];

/** Tek sürümdeki en fazla dosya. İşler 12-13 parçaya çıkıyor; tavan bol tutuldu. */
export const MAX_ORDER_MODEL_FILES = 50;

/** Başlık doğrulaması için okunacak bayt: binary STL'nin 80 baytlık başlığı + üçgen sayısı. */
export const MODEL_HEAD_BYTES = 84;

export function orderModelKindOf(fileName: string): OrderModelKind | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return (ORDER_MODEL_FORMATS as readonly string[]).includes(ext) ? (ext as OrderModelKind) : null;
}

/**
 * Görünen dosya adını güvenli hâle getirir: yol parçaları atılır, kontrol ve
 * dosya sisteminde sorunlu karakterler temizlenir, uzantı küçük harfe iner.
 *
 * Bu ad YALNIZCA gösterim ve indirme adı içindir; diskteki anahtar ASCII bir
 * nanoid'dir. Türkçe karakterli ya da boşluklu adları depolama yoluna koymak
 * imzalı URL eşleşmesini kırabilirdi.
 */
export function safeModelFileName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? raw).trim();
  const dot = base.lastIndexOf(".");
  // ".stl" gibi yalnız uzantıdan oluşan bir ad da uzantıdır: stem boş kalır ve
  // aşağıda "model" olur, sonuç "model.stl" (gizli dosya gibi görünen bir ad değil).
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  let stem = dot >= 0 ? base.slice(0, dot) : base;
  stem = stem
    .normalize("NFC")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stem || stem === "." || stem === "..") stem = "model";
  stem = stem.slice(0, 100);
  return ext ? `${stem}.${ext}` : stem;
}

function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/**
 * Aynı sürümde aynı adı taşıyan dosyalara "(2)", "(3)" ekler. ZIP'ler farklı
 * klasörlerde aynı adı (ör. iki ayrı "base.stl") taşıyabiliyor; yollar
 * düzleştirilince çakışırlar ve üretici hangisinin hangisi olduğunu bilemez.
 * Karşılaştırma büyük/küçük harf duyarsızdır (indirilen ZIP bir Windows
 * makinesinde açılabilir).
 */
export function dedupeFileNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    let candidate = n;
    let i = 2;
    while (used.has(candidate.toLocaleLowerCase("tr"))) candidate = withSuffix(n, i++);
    used.add(candidate.toLocaleLowerCase("tr"));
    return candidate;
  });
}

export type HeadVerdict = { ok: true } | { ok: false; reason: string };

function startsWithAscii(head: Uint8Array, text: string): boolean {
  if (head.length < text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (head[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * ASCII STL mi? "solid" ile başlar — ama gerçek dosyalarda önüne UTF-8 BOM
 * (EF BB BF) ya da boşluk/satır sonu gelebiliyor, bazı dışa aktarıcılar da
 * "SOLID" yazıyor. Bunları reddetmek, dilimleyicinin sorunsuz açtığı dosyaları
 * geri çevirmek olurdu.
 */
function looksLikeAsciiStl(head: Uint8Array): boolean {
  let i = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) i = 3;
  while (i < head.length && (head[i] === 0x20 || head[i] === 0x09 || head[i] === 0x0a || head[i] === 0x0d)) i++;
  const word = "solid";
  if (head.length - i < word.length) return false;
  for (let k = 0; k < word.length; k++) {
    const b = head[i + k];
    const lower = b >= 0x41 && b <= 0x5a ? b + 0x20 : b; // yalnız ASCII A-Z küçülür
    if (lower !== word.charCodeAt(k)) return false;
  }
  return true;
}

/**
 * Dosyanın gerçekten iddia ettiği tür olup olmadığını ilk baytlardan anlar —
 * bütün dosyayı okumadan (modeller yüzlerce MB).
 *
 * - GLB: "glTF" imzası şart.
 * - STL: ASCII ("solid" ile başlar) ya da binary (80 bayt başlık + uint32
 *   üçgen sayısı). Binary'de dosya boyutu en az 84 + 50·n olmalı; daha kısaysa
 *   yükleme yarıda kalmış ya da dosya bozuktur. Üstünde kalan baytlar kabul
 *   edilir — bazı dışa aktarıcılar sona dolgu ekliyor.
 * - Uzantısı .stl olan bir GLB ya da ZIP açıkça reddedilir; aksi hâlde üretici
 *   dilimleyicide açılmayan bir dosya alırdı.
 */
export function verifyModelHead(
  kind: OrderModelKind,
  head: Uint8Array,
  sizeBytes: number | null
): HeadVerdict {
  if (sizeBytes === 0 || head.length === 0) return { ok: false, reason: "Dosya boş" };
  const isGlb = startsWithAscii(head, "glTF");
  const isZip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;

  if (kind === "glb") {
    return isGlb ? { ok: true } : { ok: false, reason: "GLB dosyası değil (glTF imzası yok)" };
  }

  if (isGlb) return { ok: false, reason: "Bu bir GLB dosyası; uzantısı .stl olmamalı" };
  if (isZip) return { ok: false, reason: "Bu bir ZIP arşivi, STL değil" };
  // ASCII STL — ya da başlığına "solid" yazılmış bir binary STL; ikisi de açılır.
  if (looksLikeAsciiStl(head)) return { ok: true };
  if (head.length < MODEL_HEAD_BYTES) return { ok: false, reason: "STL çok küçük ya da bozuk" };
  const triangles = (head[80] | (head[81] << 8) | (head[82] << 16) | (head[83] << 24)) >>> 0;
  if (triangles === 0) return { ok: false, reason: "STL'de hiç üçgen yok (boş model)" };
  if (sizeBytes !== null && sizeBytes < MODEL_HEAD_BYTES + triangles * 50) {
    return { ok: false, reason: "STL eksik yüklenmiş ya da bozuk" };
  }
  return { ok: true };
}

/** 12.3 MB gibi kısa boyut etiketi (TR). */
export function formatModelSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} GB`;
}

// ─── ZIP boyut sınırı ────────────────────────────────────────────────────────

/**
 * fflate ZIP64 yazmaz: tek bir girdi ya da arşivin tamamı 4 GiB'ı (2^32 − 1
 * bayt) aşarsa ofset alanları taşar ve ZIP SESSİZCE bozulur — indiren kişi
 * yalnız açılmayan bir dosya görür. Akış başlamadan reddetmek için. Girdi
 * başına ~1 KB başlık payı bırakılır (yerel başlık + merkezi dizin + ad).
 */
export const ZIP_LIMIT_BYTES = 0xffffffff;

export function zipSizeProblem(sizes: number[]): string | null {
  if (sizes.some((s) => s >= ZIP_LIMIT_BYTES)) {
    return "Bir dosya 4 GB'tan büyük; ZIP olarak verilemez. Parçaları tek tek indirin.";
  }
  const total = sizes.reduce((a, b) => a + b, 0) + sizes.length * 1024;
  if (total >= ZIP_LIMIT_BYTES) {
    return "Toplam boyut 4 GB'ı aşıyor; ZIP olarak verilemez. Parçaları tek tek indirin.";
  }
  return null;
}

// ─── Önceki sürümün parçalarını taşıma ───────────────────────────────────────

export interface RevisionFileLike {
  name: string;
  kind: OrderModelKind;
  key: string;
  sizeBytes: number | null;
}

/**
 * "Önceki parçaları koru" açıkken yeni sürümün dosya listesi.
 *
 * 13 parçalık bir işte düzeltilen 2 parçayı yüklemek kalan 11'ini üreticiden
 * silmemeli. Kural: önceki sürümün sırası korunur; yüklenen bir parça önceki
 * sürümde AYNI ADLA (büyük/küçük harf duyarsız, tr) varsa onun yerine YERİNDE
 * geçer; yeni adlı parçalar yükleme sırasıyla sona eklenir. Taşınan parçalar
 * aynı dosya anahtarını kullanır — disk kopyası yok.
 *
 * Ad karşılaştırması temizlenmiş (safeModelFileName) ve tekilleştirilmiş adlar
 * üzerinden yapılır; çağıran bunu garanti eder. Yükleme route'u ve admin
 * ekranındaki önizleme AYNI fonksiyonu kullanır.
 */
export function mergeRevisionFiles(
  previous: RevisionFileLike[],
  incoming: RevisionFileLike[]
): RevisionFileLike[] {
  const key = (n: string) => n.toLocaleLowerCase("tr");
  const byName = new Map(incoming.map((f) => [key(f.name), f] as const));
  const replaced = new Set<string>();
  const out = previous.map((p) => {
    const hit = byName.get(key(p.name));
    if (!hit) return p;
    replaced.add(key(p.name));
    return hit;
  });
  for (const f of incoming) if (!replaced.has(key(f.name))) out.push(f);
  return out;
}
