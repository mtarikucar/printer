/**
 * 7-bölge sınıflandırması — il → bölge eşlemesi. Atama mesafe skoru için kullanılır.
 * Aynı il = en yüksek skor, aynı bölge = orta skor, farklı bölge = düşük skor.
 */
export type Region =
  | "marmara"
  | "ege"
  | "akdeniz"
  | "ic_anadolu"
  | "karadeniz"
  | "dogu_anadolu"
  | "guneydogu_anadolu";

export const IL_TO_REGION: Record<string, Region> = {
  // Marmara
  "İstanbul": "marmara",
  "Edirne": "marmara",
  "Kırklareli": "marmara",
  "Tekirdağ": "marmara",
  "Çanakkale": "marmara",
  "Balıkesir": "marmara",
  "Bursa": "marmara",
  "Yalova": "marmara",
  "Kocaeli": "marmara",
  "Sakarya": "marmara",
  "Bilecik": "marmara",
  // Ege
  "İzmir": "ege",
  "Manisa": "ege",
  "Aydın": "ege",
  "Muğla": "ege",
  "Denizli": "ege",
  "Uşak": "ege",
  "Afyonkarahisar": "ege",
  "Kütahya": "ege",
  // Akdeniz
  "Antalya": "akdeniz",
  "Isparta": "akdeniz",
  "Burdur": "akdeniz",
  "Mersin": "akdeniz",
  "Adana": "akdeniz",
  "Osmaniye": "akdeniz",
  "Hatay": "akdeniz",
  "Kahramanmaraş": "akdeniz",
  // İç Anadolu
  "Ankara": "ic_anadolu",
  "Konya": "ic_anadolu",
  "Karaman": "ic_anadolu",
  "Aksaray": "ic_anadolu",
  "Niğde": "ic_anadolu",
  "Nevşehir": "ic_anadolu",
  "Kırşehir": "ic_anadolu",
  "Kırıkkale": "ic_anadolu",
  "Çankırı": "ic_anadolu",
  "Eskişehir": "ic_anadolu",
  "Yozgat": "ic_anadolu",
  "Sivas": "ic_anadolu",
  "Kayseri": "ic_anadolu",
  // Karadeniz
  "Zonguldak": "karadeniz",
  "Karabük": "karadeniz",
  "Bartın": "karadeniz",
  "Kastamonu": "karadeniz",
  "Sinop": "karadeniz",
  "Samsun": "karadeniz",
  "Amasya": "karadeniz",
  "Tokat": "karadeniz",
  "Çorum": "karadeniz",
  "Ordu": "karadeniz",
  "Giresun": "karadeniz",
  "Trabzon": "karadeniz",
  "Rize": "karadeniz",
  "Artvin": "karadeniz",
  "Gümüşhane": "karadeniz",
  "Bayburt": "karadeniz",
  "Bolu": "karadeniz",
  "Düzce": "karadeniz",
  // Doğu Anadolu
  "Erzurum": "dogu_anadolu",
  "Erzincan": "dogu_anadolu",
  "Kars": "dogu_anadolu",
  "Ardahan": "dogu_anadolu",
  "Ağrı": "dogu_anadolu",
  "Iğdır": "dogu_anadolu",
  "Tunceli": "dogu_anadolu",
  "Bingöl": "dogu_anadolu",
  "Muş": "dogu_anadolu",
  "Bitlis": "dogu_anadolu",
  "Van": "dogu_anadolu",
  "Hakkari": "dogu_anadolu",
  "Elazığ": "dogu_anadolu",
  "Malatya": "dogu_anadolu",
  // Güneydoğu Anadolu
  "Gaziantep": "guneydogu_anadolu",
  "Kilis": "guneydogu_anadolu",
  "Şanlıurfa": "guneydogu_anadolu",
  "Adıyaman": "guneydogu_anadolu",
  "Diyarbakır": "guneydogu_anadolu",
  "Mardin": "guneydogu_anadolu",
  "Batman": "guneydogu_anadolu",
  "Siirt": "guneydogu_anadolu",
  "Şırnak": "guneydogu_anadolu",
};

export function regionOf(il: string | undefined | null): Region | undefined {
  if (!il) return undefined;
  return IL_TO_REGION[il];
}
