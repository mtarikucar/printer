/**
 * Kalem satırı — formun tuttuğu şekil ve onu üreten iki fabrika.
 *
 * Saf modül: `server-only` yok, `"use client"` yok. Sunucudaki ürün düzenleme
 * sayfaları (admin/üretici) kayıtlı kalemleri forma yüklemek için burayı
 * çağırır; bir `"use client"` modülünden fonksiyon çağırmak RSC render'ını
 * patlatır (bkz. commit 4c8d45f).
 *
 * Satır TİPİ ve İKİ fabrika da burada, tek yerde: ikisi iki ayrı modüle
 * dağıldığında uid'ler çakıştı ve "hangi modül sahibi?" belirsizliği arka arkaya
 * dört körlemesine düzeltme commit'i doğurdu.
 */

import type { CostLineKind } from "./cost-lines";

export interface CostLineRow {
  kind: CostLineKind;
  label: string;
  /** Serbest metin: kullanıcı "1.250,50" da yazabilir, "1250.5" da. */
  amountTry: string;
  /**
   * Kararlı React anahtarı. Satırları indeksle anahtarlamak, ortadan bir satır
   * silindiğinde alttaki satırların girdi durumunu yukarı kaydırıyordu.
   */
  uid: string;
}

/**
 * İki ayrı sayaç ve —asıl önemlisi— iki ayrı ÖN EK.
 *
 * Kayıtlı satırların uid'i SUNUCUDA (page.tsx render'ı), yeni eklenenlerinki
 * TARAYICIDA üretilir. Bunlar ayrı JS ortamları olduğu için her iki modül
 * örneğinin sayacı da 0'dan başlar: tek sayaca indirmek çakışmayı ÇÖZMEZ,
 * ayıran tek şey ön ektir. Ortak "cl-" ön eki kullanıldığında kayıtlı ilk satır
 * ile "+ Boyama" ile eklenen ilk satır aynı anahtarı alıyordu — yani uid'in
 * önlemek için var olduğu hatanın ta kendisi.
 */
let dbSeq = 0;
let newSeq = 0;

/** Forma yeni eklenen boş satır ("+ Üretim" / "+ Boyama"). */
export const emptyCostLine = (
  kind: CostLineKind = "production"
): CostLineRow => ({
  kind,
  label: "",
  amountTry: "",
  uid: `new-${newSeq++}`,
});

/** Kayıtlı bir kalemi (kuruş) forma yüklenebilir satıra çevirir. */
export const costLineRowFromKurus = (line: {
  kind: CostLineKind;
  label?: string | null;
  amountKurus: number;
}): CostLineRow => ({
  kind: line.kind,
  label: line.label ?? "",
  amountTry: (line.amountKurus / 100).toFixed(2).replace(".", ","),
  uid: `db-${dbSeq++}`,
});
