import { unzipSync } from "fflate";
import { UPLOAD_MODEL_FORMATS } from "@/lib/config/upload";

/**
 * Pull the printable-model entries (STL/OBJ) out of a ZIP archive. Pure and
 * client-safe (fflate runs in the browser) so the spec editor can expand a
 * dropped ZIP into individual files and upload each through the existing
 * single-file endpoint — no server-side ZIP handling, no large combined body.
 *
 * Skips directories, the macOS `__MACOSX/` sidecar tree, dotfiles, and any
 * entry whose extension isn't an allowed model format. Names are flattened to
 * their basename (the part name is derived from the filename, not the path).
 */
export interface ModelEntry {
  name: string; // basename, e.g. "body.stl"
  bytes: Uint8Array;
}

/** `scanModelZip` girdisi: basename'e ek olarak dosyanın arşivdeki yolu. */
export interface ScannedModelEntry extends ModelEntry {
  /** Arşiv içindeki tam yol, ör. "sol/kol.stl". */
  path: string;
}

export function extractModelEntriesFromZip(
  zip: Uint8Array,
  formats: readonly string[] = UPLOAD_MODEL_FORMATS
): ModelEntry[] {
  // Ürün editörü yalnız ad + bayt bekler; eski şekil (yol alanı olmadan) aynen
  // korunur.
  return scanModelZip(zip, formats).entries.map(({ name, bytes }) => ({ name, bytes }));
}

/**
 * `extractModelEntriesFromZip` + ATLANAN girdilerin adları. Sipariş
 * yükleyicisi, ZIP'teki bir .obj ya da .3mf'nin neden alınmadığını admin'e
 * söyleyebilmeli; sessizce düşürmek "13 parça yükledim" sanıp 11'le kalmak
 * demekti.
 *
 * Her girdi arşivdeki YOLUNU da taşır: farklı klasörlerde aynı adı taşıyan
 * parçaları (sol/kol.stl, sag/kol.stl) ayırt etmenin tek bilgisi odur
 * (bkz. `zipEntryDisplayNames`).
 *
 * `filter` ile eşleşmeyen girdiler HİÇ açılmaz — büyük bir ZIP'teki render
 * görselleri ya da kaynak dosyaları tarayıcı belleğine boşuna açılmasın.
 */
export function scanModelZip(
  zip: Uint8Array,
  formats: readonly string[] = UPLOAD_MODEL_FORMATS
): { entries: ScannedModelEntry[]; skipped: string[] } {
  const skipped: string[] = [];
  const files = unzipSync(zip, {
    filter: (f) => {
      const verdict = classifyZipPath(f.name, formats);
      if (verdict === "skip") skipped.push(f.name.split("/").pop() ?? f.name);
      return verdict === "take";
    },
  });
  const out: ScannedModelEntry[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    const base = path.split("/").pop() ?? path;
    if (bytes.length === 0) {
      skipped.push(base);
      continue;
    }
    out.push({ name: base, path, bytes });
  }
  return { entries: out, skipped };
}

/**
 * Bir ZIP'in girdileri için görünen adlar, girdi sırasıyla.
 *
 * Normalde dosyanın kendi adı (basename). Ama AYNI ZIP'te aynı adı taşıyan
 * birden çok girdi varsa (dışa aktarıcılar parçaları klasörlere ayırıyor:
 * sol/kol.stl + sag/kol.stl) ad üst klasörle öneklenir: "sol-kol.stl",
 * "sag-kol.stl". Eskiden ikisi "kol.stl" / "kol (2).stl" olurdu ve üretici
 * hangisinin sol, hangisinin sağ kol olduğunu tahmin etmek zorunda kalırdı.
 *
 * En yakın klasör ayırmaya yetmezse (a/x/kol.stl + b/x/kol.stl) önek bir üst
 * klasöre genişler ("a-x-kol.stl"). Karşılaştırma büyük/küçük harf duyarsız
 * (tr) — sunucudaki tekilleştirmeyle (dedupeFileNames) aynı kural; yine de
 * çakışan bir ad kalırsa onu sunucu "(2)" ile ayırır.
 *
 * Çıktı henüz temizlenmemiştir; çağıran safeModelFileName'den geçirir.
 */
export function zipEntryDisplayNames(
  entries: readonly { name: string; path: string }[]
): string[] {
  const key = (s: string) => s.toLocaleLowerCase("tr");
  const groups = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const k = key(e.name);
    const group = groups.get(k);
    if (group) group.push(i);
    else groups.set(k, [i]);
  });

  const out = entries.map((e) => e.name);
  groups.forEach((idxs) => {
    if (idxs.length < 2) return;
    const dirsOf = idxs.map((i) => entries[i].path.split("/").slice(0, -1).filter(Boolean));
    const maxDepth = Math.max(...dirsOf.map((d) => d.length));
    // Grubun tamamı için TEK derinlik: "sol-kol.stl" yanında "govde-sag-kol.stl"
    // gibi tutarsız adlar çıkmasın.
    for (let depth = 1; depth <= maxDepth; depth++) {
      const candidates = idxs.map((i, j) => {
        const prefix = dirsOf[j].slice(-depth).join("-");
        return prefix ? `${prefix}-${entries[i].name}` : entries[i].name;
      });
      if (new Set(candidates.map(key)).size === candidates.length || depth === maxDepth) {
        idxs.forEach((i, j) => {
          out[i] = candidates[j];
        });
        break;
      }
    }
  });
  return out;
}

/** take = model dosyası; skip = kullanıcıya bildirilecek yabancı dosya; ignore = gürültü. */
function classifyZipPath(path: string, formats: readonly string[]): "take" | "skip" | "ignore" {
  // Directories come back as zero-length entries with a trailing slash.
  if (path.endsWith("/")) return "ignore";
  if (path.startsWith("__MACOSX/") || path.includes("/__MACOSX/")) return "ignore";
  const base = path.split("/").pop() ?? path;
  if (!base || base.startsWith(".")) return "ignore"; // dotfiles / resource forks
  return isModelFile(base, formats) ? "take" : "skip";
}

export function isModelFile(
  fileName: string,
  formats: readonly string[] = UPLOAD_MODEL_FORMATS
): boolean {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return formats.includes(ext);
}

export function isZipFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".zip");
}

/** "body.stl" -> "body" (basename without extension), capped for the column. */
export function partNameFromFileName(fileName: string): string {
  const base = (fileName.split("/").pop() ?? fileName).trim();
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.slice(0, 120);
}
