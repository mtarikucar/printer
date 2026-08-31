/**
 * Tüketici talep sistemi — MSY m.12/A sabitleri.
 *
 * Aracı hizmet sağlayıcı (üçüncü kişi satıcıların ürünlerini listeleyen
 * platform), tüketicinin aşağıdaki taleplerini KESİNTİSİZ iletebileceği ve
 * TAKİP EDEBİLECEĞİ bir sistem kurmak, talebi satıcıya DERHAL iletmek
 * zorundadır. Eksikliği 6502 m.48/5 ihlalidir; yaptırımı m.77/14 uyarınca
 * MAKTU idari para cezasıdır — işlem başına değil, tek denetimde tek seferde.
 *
 * Bu dosya `src/lib/config` altındadır ve worker yolundan ulaşılabilir —
 * `import "server-only"` EKLEMEYİN.
 */

/** m.12/A'nın saydığı beş talep türü. Liste kapalıdır: eklemek serbest,
 *  çıkarmak değil. Şemadaki `consumerRequestTypeEnum` ile birebir aynı sırada
 *  tutulur. */
export const CONSUMER_REQUEST_TYPES = [
  "withdrawal",
  "termination",
  "refund",
  "records",
  "delivery_complaint",
] as const;

export type ConsumerRequestType = (typeof CONSUMER_REQUEST_TYPES)[number];

export function isConsumerRequestType(v: unknown): v is ConsumerRequestType {
  return (
    typeof v === "string" &&
    (CONSUMER_REQUEST_TYPES as readonly string[]).includes(v)
  );
}

/** Türlerin Türkçe karşılıkları — form, satıcı bildirimi ve admin paneli aynı
 *  metni kullanır ki denetimde tek anlatı çıksın. */
export const CONSUMER_REQUEST_LABELS: Record<ConsumerRequestType, string> = {
  withdrawal: "Cayma bildirimi",
  termination: "Sözleşmenin feshi",
  refund: "Bedel iadesi talebi",
  records: "İşlem kayıtları talebi",
  delivery_complaint: "Teslimat şikâyeti",
};

/** Formda tür seçiminin altına düşen açıklama. Cayma satırı kasten "hakkınız
 *  var" demez: kişiye özel üründe cayma hakkı yoktur, ama tüketicinin bildirimi
 *  İLETME hakkı vardır — talebi değerlendirmek satıcının işidir, formun
 *  reddetmesi değil. */
export const CONSUMER_REQUEST_HINTS: Record<ConsumerRequestType, string> = {
  withdrawal:
    "Hazır/stok ürünlerde teslimden itibaren 14 gün içinde cayabilirsiniz. Kişiye özel üretilen figürinler cayma hakkı kapsamı dışındadır; yine de bildiriminizi iletebilirsiniz.",
  termination: "Siparişin teslim edilmemesi veya gecikmesi gibi hâllerde.",
  refund: "Ödediğiniz bedelin iadesini talep edin.",
  records:
    "Siparişinize ilişkin bilgi ve belgelerin tarafınıza iletilmesini isteyin.",
  delivery_complaint: "Kargo, paket veya teslimatla ilgili sorunlar.",
};

/** Talep mesajının sınırları. Alt sınır, boş/anlamsız kayıt açılmasını önler;
 *  üst sınır e-posta gövdesini ve DB'yi korur. */
export const CONSUMER_REQUEST_MESSAGE_MIN = 10;
export const CONSUMER_REQUEST_MESSAGE_MAX = 4000;

/** Talep referansı, e.g. "TT-4K9X2M". Karışan karakterler (0/O, 1/I) yok —
 *  tüketici bunu telefonda okuyabilmeli. */
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function generateConsumerRequestReference(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `TT-${code}`;
}
