import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { Zip, ZipPassThrough } from "fflate";
import { absoluteFilePath } from "@/lib/services/storage";
import { zipSizeProblem } from "@/lib/config/order-model";

/**
 * Model dosyalarını indirme — tekil dosya ve toplu ZIP.
 *
 * İkisi de dosyayı AKITARAK gönderir, belleğe almaz. Mevcut tekil indirme
 * route'ları `getFileBuffer` ile bütün dosyayı yüklüyordu; yüzlerce MB'lık tek
 * bir STL için bile bu sunucu belleğinde yüzlerce MB demek, 13 parçalık bir
 * ZIP için ise kabul edilemez.
 *
 * ZIP sıkıştırmasız (store) üretilir: GLB zaten sıkıştırılmış, STL'yi
 * sıkıştırmak VPS'te saniyelerce CPU yer ve indirmeyi başlatmayı geciktirir.
 * Sınır: fflate ZIP64 yazmaz — tek dosya ya da arşiv 4 GB'ı aşarsa bozulurdu;
 * akış başlamadan `zipSizeProblem` ile 413 döner (parçalar tek tek iner).
 */

export interface DownloadableFile {
  key: string;
  name: string;
}

/**
 * RFC 6266 / 5987: ASCII yedek ad + UTF-8 asıl ad. Türkçe karakterli bir
 * parça adı ("gövde-sağ.stl") yalnız `filename=` ile gönderilirse bazı
 * tarayıcılar bozuk kaydeder.
 */
export function contentDisposition(fileName: string): string {
  const ascii =
    fileName
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/["\\]/g, "")
      .trim() || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function toWebStream(readable: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(readable) as unknown as ReadableStream<Uint8Array>;
}

export async function fileDownloadResponse(
  file: DownloadableFile,
  contentType = "application/octet-stream"
): Promise<Response> {
  const path = absoluteFilePath(file.key);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return Response.json({ error: "Dosya bulunamadı" }, { status: 404 });
  }
  return new Response(toWebStream(createReadStream(path)), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(file.name),
      "Content-Length": String(size),
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Dosyaları sırayla okuyup ZIP çıktısını parça parça üretir. Üreteç (generator)
 * olduğu için geri basınç doğal: istemci yavaşsa bir sonraki dosya parçası
 * okunmaz, bellekte birikme olmaz.
 */
async function* zipChunks(files: DownloadableFile[]): AsyncGenerator<Uint8Array> {
  const out: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) {
      failure = err;
      return;
    }
    out.push(data);
  });
  const drain = function* () {
    while (out.length > 0) yield out.shift()!;
  };

  for (const f of files) {
    const entry = new ZipPassThrough(f.name);
    zip.add(entry);
    for await (const chunk of createReadStream(absoluteFilePath(f.key))) {
      entry.push(chunk as Uint8Array);
      if (failure) throw failure;
      yield* drain();
    }
    entry.push(new Uint8Array(0), true);
    yield* drain();
  }
  zip.end();
  if (failure) throw failure;
  yield* drain();
}

export async function modelFilesZipResponse(
  files: DownloadableFile[],
  zipName: string
): Promise<Response> {
  if (files.length === 0) {
    return Response.json({ error: "İndirilecek dosya yok" }, { status: 404 });
  }
  // Akış başladıktan sonra eksik bir dosya yalnız YARIM bir arşiv üretir ve
  // istemci bunu bozuk ZIP olarak görür. Hepsinin varlığını baştan doğrula.
  const sizes: number[] = [];
  for (const f of files) {
    try {
      sizes.push((await stat(absoluteFilePath(f.key))).size);
    } catch {
      return Response.json({ error: `Dosya bulunamadı: ${f.name}` }, { status: 404 });
    }
  }
  // fflate ZIP64 yazmaz: 4 GiB üstü sessizce bozuk bir arşiv üretirdi.
  const tooBig = zipSizeProblem(sizes);
  if (tooBig) return Response.json({ error: tooBig }, { status: 413 });
  return new Response(toWebStream(Readable.from(zipChunks(files))), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(zipName),
      "Cache-Control": "private, no-store",
    },
  });
}
