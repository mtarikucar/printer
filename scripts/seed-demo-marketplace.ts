import "dotenv/config";
import { copyFile, mkdir } from "fs/promises";
import { join } from "path";
import { like } from "drizzle-orm";
import { db } from "../src/lib/db";
import { products, productImages, manufacturers } from "../src/lib/db/schema";

// Demo marketplace seed: populates /shop + the storefront homepage with realistic
// ready-made products across all 6 categories, plus a few "seller" storefronts so
// cards show real seller names alongside platform ("Figurinunica") products.
// Idempotent: wipes prior demo rows (tagged @demo.local) before re-inserting.

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const EXAMPLES = "./public/examples";
const DEMO_TAG = "seed@demo.local";

// Source renders we have on hand; reused as product cover images.
const IMAGES = [
  "storybook.png", "realistic.png", "anime.png", "chibi.png", "object.png",
  "pixel-storybook.png", "pixel-realistic.png", "pixel-anime.png", "pixel-chibi.png",
];

async function copyImages() {
  await mkdir(join(UPLOAD_DIR, "products"), { recursive: true });
  for (const f of IMAGES) {
    await copyFile(join(EXAMPLES, f), join(UPLOAD_DIR, "products", f));
  }
}

function slugify(s: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return s
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Mat = "resin" | "filament";
type Seller = number | null; // index into SELLERS, or null = platform (admin)

const SELLERS = [
  { email: "atolye3d@demo.local", companyName: "Atölye 3D", contactPerson: "Deniz Kaya", phone: "+905321112233" },
  { email: "minimalform@demo.local", companyName: "Minimal Form", contactPerson: "Ece Demir", phone: "+905324445566" },
  { email: "pixelforge@demo.local", companyName: "PixelForge", contactPerson: "Mert Aydın", phone: "+905327778899" },
];

// price is in kuruş (TRY * 100). lead = days. img indexes IMAGES.
const CATALOG: Array<{
  cat: string; title: string; desc: string; price: number; material: Mat; lead: number; img: string; seller: Seller;
}> = [
  // figurine
  { cat: "figurine", title: "Sevimli Astronot Figürü", desc: "Rafların yıldızı; el boyamaya hazır, yüksek detaylı astronot figürü.", price: 27900, material: "resin", lead: 5, img: "storybook.png", seller: 0 },
  { cat: "figurine", title: "Ejderha Heykelciği", desc: "Pullu gövde ve açık kanatlarıyla detaylı koleksiyon ejderhası.", price: 49900, material: "resin", lead: 7, img: "realistic.png", seller: null },
  { cat: "figurine", title: "Anime Savaşçı Figürü", desc: "Dinamik pozlu, keskin hatlı anime tarzı savaşçı.", price: 38900, material: "resin", lead: 6, img: "anime.png", seller: 2 },
  { cat: "figurine", title: "Chibi Kedi Figürü", desc: "Sevimli chibi oranlarıyla masaüstü kedi dostu.", price: 17900, material: "resin", lead: 4, img: "chibi.png", seller: null },
  { cat: "figurine", title: "Klasik Şövalye", desc: "Zırhı ve kalkanıyla ince işçilikli şövalye heykelciği.", price: 44900, material: "resin", lead: 7, img: "realistic.png", seller: 0 },
  // home_decor
  { cat: "home_decor", title: "Geometrik Saksı", desc: "Sukulentler için modern, düşük-poli geometrik saksı.", price: 21900, material: "filament", lead: 4, img: "object.png", seller: 1 },
  { cat: "home_decor", title: "Dalga Desenli Vazo", desc: "Işığı yumuşatan spiral dalga desenli dekoratif vazo.", price: 29900, material: "filament", lead: 5, img: "object.png", seller: 1 },
  { cat: "home_decor", title: "Duvar Rölyefi — Dağ", desc: "Minimalist dağ silüetli, katmanlı duvar rölyefi.", price: 34900, material: "filament", lead: 6, img: "object.png", seller: null },
  { cat: "home_decor", title: "Mum Standı Seti", desc: "İkili set; sıcak ışık için heykelsi mum standları.", price: 25900, material: "filament", lead: 5, img: "object.png", seller: 1 },
  // toy
  { cat: "toy", title: "Esnek Eklemli Ahtapot", desc: "Baskıda tek parça çıkan, esnek eklemli sevimli ahtapot.", price: 14900, material: "filament", lead: 3, img: "object.png", seller: null },
  { cat: "toy", title: "Mini Yarış Arabası", desc: "Dönen tekerlekleriyle masaüstü mini yarış arabası.", price: 12900, material: "filament", lead: 3, img: "object.png", seller: 0 },
  { cat: "toy", title: "Yapboz Küp", desc: "Sabırla çözülen, iç içe geçen 3B yapboz küp.", price: 9900, material: "filament", lead: 3, img: "object.png", seller: 2 },
  { cat: "toy", title: "Fidget Spinner Pro", desc: "Pürüzsüz dönüş için dengelenmiş fidget spinner.", price: 8900, material: "filament", lead: 2, img: "object.png", seller: null },
  // jewelry
  { cat: "jewelry", title: "Geometrik Kolye Ucu", desc: "Hafif ve modern, geometrik desenli kolye ucu.", price: 13900, material: "resin", lead: 4, img: "pixel-storybook.png", seller: 1 },
  { cat: "jewelry", title: "Voronoi Bileklik", desc: "Organik Voronoi örüntülü, esnek bileklik.", price: 16900, material: "resin", lead: 5, img: "pixel-realistic.png", seller: 1 },
  { cat: "jewelry", title: "Minimalist Yüzük Seti", desc: "Günlük kullanım için sade, üçlü yüzük seti.", price: 11900, material: "resin", lead: 4, img: "pixel-anime.png", seller: null },
  { cat: "jewelry", title: "Çiçek Broş", desc: "İnce yapraklı, zarif dekoratif çiçek broş.", price: 12900, material: "resin", lead: 4, img: "pixel-chibi.png", seller: 2 },
  // gadget
  { cat: "gadget", title: "Ayarlı Telefon Standı", desc: "Açısı ayarlanabilen, kaymaz tabanlı telefon standı.", price: 11900, material: "filament", lead: 3, img: "object.png", seller: 0 },
  { cat: "gadget", title: "Kulaklık Askısı", desc: "Masaya kelepçelenen, kablo yönlendirmeli kulaklık askısı.", price: 13900, material: "filament", lead: 3, img: "object.png", seller: null },
  { cat: "gadget", title: "Kablo Düzenleyici Set", desc: "Beşli set; dağınık kabloları toplayan klipsler.", price: 8900, material: "filament", lead: 2, img: "object.png", seller: 2 },
  { cat: "gadget", title: "Tablet Tutucu", desc: "Mutfak ve masa için sağlam, katlanabilir tablet tutucu.", price: 15900, material: "filament", lead: 4, img: "object.png", seller: 0 },
  // other
  { cat: "other", title: "Kişiye Özel Plaket", desc: "İsim ve tarih işlenebilen, hediyelik 3B plaket.", price: 19900, material: "resin", lead: 6, img: "object.png", seller: null },
  { cat: "other", title: "Masaüstü İsimlik", desc: "Ofis masası için modern, kişiselleştirilebilir isimlik.", price: 13900, material: "filament", lead: 4, img: "object.png", seller: 1 },
  { cat: "other", title: "Kalemlik Organizer", desc: "Bölmeli, masaüstünü toplayan kalemlik organizer.", price: 12900, material: "filament", lead: 4, img: "object.png", seller: null },
];

async function main() {
  console.log("Cleaning prior demo rows…");
  await db.delete(products).where(like(products.createdByAdminEmail, "%@demo.local"));
  await db.delete(manufacturers).where(like(manufacturers.email, "%@demo.local"));

  console.log("Copying images → uploads/products/…");
  await copyImages();

  console.log("Inserting demo sellers…");
  const sellerRows = await db
    .insert(manufacturers)
    .values(
      SELLERS.map((s) => ({
        email: s.email,
        passwordHash: "demo-not-a-real-hash",
        companyName: s.companyName,
        contactPerson: s.contactPerson,
        phone: s.phone,
        status: "active" as const,
        acceptingOrders: true,
      }))
    )
    .returning({ id: manufacturers.id });

  console.log("Inserting demo products…");
  const now = new Date();
  const productValues = CATALOG.map((p, i) => ({
    slug: `${slugify(p.title)}-${i + 1}`,
    ownerType: (p.seller != null ? "seller" : "admin") as "seller" | "admin",
    manufacturerId: p.seller != null ? sellerRows[p.seller].id : null,
    title: p.title,
    description: p.desc,
    priceKurus: p.price,
    material: p.material,
    category: p.cat,
    leadTimeDays: p.lead,
    primaryImageKey: `products/${p.img}`,
    status: "active" as const,
    createdByAdminEmail: DEMO_TAG,
    submittedAt: now,
    reviewedAt: now,
    reviewedByEmail: DEMO_TAG,
  }));
  const inserted = await db.insert(products).values(productValues).returning({ id: products.id });

  console.log("Inserting product gallery images…");
  await db.insert(productImages).values(
    inserted.map((row, i) => ({
      productId: row.id,
      storageKey: `products/${CATALOG[i].img}`,
      sortOrder: 0,
    }))
  );

  console.log(`✓ Seeded ${inserted.length} products, ${sellerRows.length} sellers.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
