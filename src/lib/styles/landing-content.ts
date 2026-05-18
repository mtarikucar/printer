// Per-style landing-page content (Q2 in the roadmap). Each entry feeds
// `/styles/[slug]/page.tsx`: SEO metadata, hero copy, USP bullets, sample
// image path, and the CTA target on /create.
//
// `slug` matches one of the figurineStyle enum values so /create?style=slug
// prefills the style selector. Adding a sixth style requires:
//   1) extending figurineStyleEnum in schema
//   2) adding an entry here
//   3) updating sitemap.ts (it iterates this object's keys at build time)

import type { Locale } from "@/lib/i18n/types";

export type StyleSlug =
  | "realistic"
  | "disney"
  | "anime"
  | "chibi"
  | "object";

export interface StyleLandingContent {
  slug: StyleSlug;
  /** Filename under /public/examples (e.g. "disney.png"). */
  heroImage: string;
  /** Localized copy. Each locale has the same shape so the page component
   *  doesn't have to handle locale-specific structures. */
  copy: Record<
    Locale,
    {
      pageTitle: string;
      metaDescription: string;
      heroTitle: string;
      heroSubtitle: string;
      ctaPrimary: string;
      ctaSecondary: string;
      featuresHeading: string;
      features: Array<{ title: string; body: string }>;
      perfectForHeading: string;
      perfectForItems: string[];
    }
  >;
}

export const STYLE_LANDING: Record<StyleSlug, StyleLandingContent> = {
  realistic: {
    slug: "realistic",
    heroImage: "/examples/realistic.png",
    copy: {
      tr: {
        pageTitle: "Gerçekçi 3D Figürin — Fotoğraftan Birebir Heykel",
        metaDescription:
          "Fotoğraflarınızdan gerçekçi tarzda 3D figürin yapın. Yüz hatları, kıyafet detayları ve doğal duruş — Figurine Studio'nun gerçekçi stiliyle hediyeniz birebir size benzesin.",
        heroTitle: "Gerçekçi 3D Figürin",
        heroSubtitle:
          "Fotoğrafınızdaki yüz hatları, ifade ve kıyafet detayları olabildiğince doğal aktarılır. Anneye, babaya, eşe verilecek hediyenin birebir benzemesini istediğinizde tercih edin.",
        ctaPrimary: "Gerçekçi figürin oluştur",
        ctaSecondary: "Galeriye göz at",
        featuresHeading: "Bu stil ne sağlar?",
        features: [
          {
            title: "Birebir yüz hatları",
            body: "Burnun şekli, gözlerin oranı, yüzdeki çizgiler — fotoğraftan korunur.",
          },
          {
            title: "Doğal cilt rengi",
            body: "Stilize değil, gerçeğe en yakın ten tonu ile boyanır.",
          },
          {
            title: "Detaylı kıyafet",
            body: "Fotoğraftaki kıyafet, aksesuar ve takı detayları figürine işlenir.",
          },
        ],
        perfectForHeading: "Şunlar için ideal",
        perfectForItems: [
          "Anneye/babaya doğum günü hediyesi",
          "Evlilik yıldönümü",
          "Mezuniyet hediyesi",
          "Aile fotoğrafından minyatür",
        ],
      },
      en: {
        pageTitle: "Realistic 3D Figurine — True-to-Life Sculpture From Your Photo",
        metaDescription:
          "Create a realistic 3D figurine from your photos. Real facial features, clothing details, and natural posture — Figurine Studio's realistic style makes your gift look exactly like you.",
        heroTitle: "Realistic 3D Figurines",
        heroSubtitle:
          "Facial features, expression, and clothing details from your photo are preserved as faithfully as possible. Pick this style when you want a gift that looks exactly like the recipient.",
        ctaPrimary: "Create realistic figurine",
        ctaSecondary: "Browse the gallery",
        featuresHeading: "What this style gives you",
        features: [
          {
            title: "True facial likeness",
            body: "Nose shape, eye proportions, facial lines — preserved from the photo.",
          },
          {
            title: "Natural skin tone",
            body: "Painted close to real skin color, not stylized.",
          },
          {
            title: "Detailed clothing",
            body: "Outfit, accessories, and jewelry from the photo are carried into the figurine.",
          },
        ],
        perfectForHeading: "Perfect for",
        perfectForItems: [
          "Birthday gifts for parents",
          "Wedding anniversaries",
          "Graduation gifts",
          "Family photo miniatures",
        ],
      },
    },
  },

  disney: {
    slug: "disney",
    heroImage: "/examples/disney.png",
    copy: {
      tr: {
        pageTitle: "Disney Tarzı 3D Figürin — Sevimli Çizgi Film Karakterleri",
        metaDescription:
          "Fotoğraflarınızdan Disney tarzında, büyük gözlü, sevimli 3D figürin yapın. Çocuğunuzun, sevdiklerinizin animasyon karakterine dönüştüğü ve sonsuza dek hatıra kalacak hediyeler.",
        heroTitle: "Disney Tarzı 3D Figürin",
        heroSubtitle:
          "Büyük gözler, yumuşak hatlar, çizgi-film sıcaklığı. Çocuk doğum günleri, sevgiliye sürpriz ve genç çiftler için en popüler tarzımız.",
        ctaPrimary: "Disney tarzı figürin oluştur",
        ctaSecondary: "Örnekleri gör",
        featuresHeading: "Bu stil ne sağlar?",
        features: [
          {
            title: "Yumuşak çizgiler",
            body: "Yüz hatları stilize edilir; sevimli, çocuksu bir hava katar.",
          },
          {
            title: "Büyük, ifadeli gözler",
            body: "Klasik Disney karakter estetiği — bakışlar parlak ve sıcak.",
          },
          {
            title: "Canlı renkler",
            body: "Doygun, animasyon-tarzı boya paleti.",
          },
        ],
        perfectForHeading: "Şunlar için ideal",
        perfectForItems: [
          "Çocuk doğum günü",
          "Sevgililer günü",
          "Genç çiftler için sürpriz",
          "Bebek hatırası",
        ],
      },
      en: {
        pageTitle: "Disney-Style 3D Figurine — Cute Animated Character",
        metaDescription:
          "Turn your photos into Disney-style 3D figurines with big eyes and soft, friendly features. The most popular style for kids, couples, and unforgettable gifts.",
        heroTitle: "Disney-Style Figurines",
        heroSubtitle:
          "Big eyes, soft features, animated warmth. Our most popular style for kids' birthdays, romantic surprises, and young couples.",
        ctaPrimary: "Create Disney-style figurine",
        ctaSecondary: "See examples",
        featuresHeading: "What this style gives you",
        features: [
          {
            title: "Soft lines",
            body: "Facial features get stylized — playful, kid-friendly look.",
          },
          {
            title: "Big, expressive eyes",
            body: "Classic Disney character aesthetic — bright, warm gaze.",
          },
          {
            title: "Vivid colors",
            body: "Saturated, animation-grade paint palette.",
          },
        ],
        perfectForHeading: "Perfect for",
        perfectForItems: [
          "Kids' birthdays",
          "Valentine's Day",
          "Surprise for young couples",
          "Baby keepsakes",
        ],
      },
    },
  },

  anime: {
    slug: "anime",
    heroImage: "/examples/anime.png",
    copy: {
      tr: {
        pageTitle: "Anime Tarzı 3D Figürin — Manga & Anime Karakter Heykeli",
        metaDescription:
          "Anime/manga tarzında 3D figürin. Keskin çizgiler, parlak saç, karakteristik anime gözleri. Otaku hediyesi, kendinizin anime karakterine dönüşmüş hali.",
        heroTitle: "Anime Tarzı 3D Figürin",
        heroSubtitle:
          "Anime gözleri, keskin saç şekilleri ve karakter posu. Anime hayranlarına en güçlü hediye seçeneklerinden biri.",
        ctaPrimary: "Anime figürin oluştur",
        ctaSecondary: "Galeriye göz at",
        featuresHeading: "Bu stil ne sağlar?",
        features: [
          {
            title: "Karakteristik anime gözleri",
            body: "Büyük, parlak, ışıltılı anime estetiğinin imzası.",
          },
          {
            title: "Stilize saç",
            body: "Saçlar keskin tutamlarla, dinamik bir şekilde modellenir.",
          },
          {
            title: "Karakter posu",
            body: "Pasif duruş yerine, karakteri belli eden hareketli bir poz.",
          },
        ],
        perfectForHeading: "Şunlar için ideal",
        perfectForItems: [
          "Anime/manga hayranlarına hediye",
          "Cosplay hatırası",
          "Doğum günü sürprizi",
          "Kendinize anime karakteri",
        ],
      },
      en: {
        pageTitle: "Anime-Style 3D Figurine — Manga & Anime Character Sculpture",
        metaDescription:
          "Anime/manga-style 3D figurine. Sharp lines, glossy hair, signature anime eyes. The perfect otaku gift — yourself as an anime character.",
        heroTitle: "Anime-Style Figurines",
        heroSubtitle:
          "Anime eyes, sharp hair shapes, and dynamic character pose. One of the strongest gift options for anime fans.",
        ctaPrimary: "Create anime figurine",
        ctaSecondary: "Browse the gallery",
        featuresHeading: "What this style gives you",
        features: [
          {
            title: "Signature anime eyes",
            body: "Large, glossy, sparkling — the anime aesthetic's calling card.",
          },
          {
            title: "Stylized hair",
            body: "Hair sculpted in sharp tufts with dynamic shape.",
          },
          {
            title: "Character pose",
            body: "Instead of a static stance, a pose that reveals personality.",
          },
        ],
        perfectForHeading: "Perfect for",
        perfectForItems: [
          "Gifts for anime/manga fans",
          "Cosplay keepsake",
          "Birthday surprise",
          "Yourself as an anime character",
        ],
      },
    },
  },

  chibi: {
    slug: "chibi",
    heroImage: "/examples/chibi.png",
    copy: {
      tr: {
        pageTitle: "Chibi Tarzı 3D Figürin — Mini Sevimli Karakter",
        metaDescription:
          "Chibi (mini) tarzında 3D figürin. Büyük kafa, küçük gövde, çok sevimli. Sevdiklerinize küçük ama anlamlı bir hatıra.",
        heroTitle: "Chibi Tarzı 3D Figürin",
        heroSubtitle:
          "Büyük kafa, kısa gövde — chibi karakterlerin tatlı, abartılı oranları. Tek başına ya da çift olarak sipariş edildiğinde özellikle sevimli.",
        ctaPrimary: "Chibi figürin oluştur",
        ctaSecondary: "Galeriye göz at",
        featuresHeading: "Bu stil ne sağlar?",
        features: [
          {
            title: "Abartılı oranlar",
            body: "1:2 başa-gövde oranı — chibi'nin imzası.",
          },
          {
            title: "Basit yüz",
            body: "Detay azaltılır, ifade güçlenir.",
          },
          {
            title: "Tatlı renkler",
            body: "Pastel ve doygun renklerle boyanır.",
          },
        ],
        perfectForHeading: "Şunlar için ideal",
        perfectForItems: [
          "Sevgiliye küçük sürpriz",
          "Çift figürini",
          "Arkadaşlık hediyesi",
          "Mini hatıra",
        ],
      },
      en: {
        pageTitle: "Chibi-Style 3D Figurine — Cute Mini Character",
        metaDescription:
          "Chibi (mini) style 3D figurine. Big head, tiny body, extremely cute. A small but meaningful keepsake for loved ones.",
        heroTitle: "Chibi-Style Figurines",
        heroSubtitle:
          "Big head, short body — chibi's signature exaggerated proportions. Especially adorable as a single piece or a couple.",
        ctaPrimary: "Create chibi figurine",
        ctaSecondary: "Browse the gallery",
        featuresHeading: "What this style gives you",
        features: [
          {
            title: "Exaggerated proportions",
            body: "1:2 head-to-body ratio — chibi's signature.",
          },
          {
            title: "Simple face",
            body: "Less detail, more expressive.",
          },
          {
            title: "Sweet colors",
            body: "Pastel and saturated palette.",
          },
        ],
        perfectForHeading: "Perfect for",
        perfectForItems: [
          "Small surprise for a partner",
          "Couple figurines",
          "Friendship gift",
          "Mini keepsakes",
        ],
      },
    },
  },

  object: {
    slug: "object",
    heroImage: "/examples/object.png",
    copy: {
      tr: {
        pageTitle: "Nesne 3D Figürini — Eşyanızdan Heykel",
        metaDescription:
          "Bir nesneyi, oyuncağı ya da koleksiyon parçasını 3D figürin olarak baskı edin. Sevdiğiniz arabanın, oyuncağın, eşyanın minyatürünü elinizde tutun.",
        heroTitle: "Nesne 3D Figürini",
        heroSubtitle:
          "Sadece insanlar değil — sevdiğiniz arabanın, çocukken oynadığınız oyuncağın, koleksiyon parçanızın da 3D figürinini yaparız.",
        ctaPrimary: "Nesne figürini oluştur",
        ctaSecondary: "Galeriye göz at",
        featuresHeading: "Bu stil ne sağlar?",
        features: [
          {
            title: "Detaylı geometri",
            body: "Mekanik parçalar, eğriler, dokular — eşyanın yapısını korur.",
          },
          {
            title: "Doğru orantı",
            body: "Stilize değil, gerçek orantılarla model edilir.",
          },
          {
            title: "Ortam-uyumlu boya",
            body: "Eşyanın orijinal rengi referans alınır.",
          },
        ],
        perfectForHeading: "Şunlar için ideal",
        perfectForItems: [
          "Sevdiğiniz arabanın minyatürü",
          "Çocukluk oyuncağı",
          "Koleksiyon vitrini",
          "İşyeri sembolü",
        ],
      },
      en: {
        pageTitle: "Object 3D Figurine — Sculpture From Your Item",
        metaDescription:
          "Print a 3D figurine of an object, toy, or collectible. Hold a miniature of your favorite car, beloved toy, or prized item in your hand.",
        heroTitle: "Object 3D Figurines",
        heroSubtitle:
          "Not just people — we sculpt your favorite car, childhood toy, or collectible into a 3D figurine.",
        ctaPrimary: "Create object figurine",
        ctaSecondary: "Browse the gallery",
        featuresHeading: "What this style gives you",
        features: [
          {
            title: "Detailed geometry",
            body: "Mechanical parts, curves, textures — the item's structure preserved.",
          },
          {
            title: "Accurate proportion",
            body: "Modeled in real proportions, not stylized.",
          },
          {
            title: "On-brand paint",
            body: "Painted to reference the item's original color.",
          },
        ],
        perfectForHeading: "Perfect for",
        perfectForItems: [
          "Miniature of your favorite car",
          "Childhood toy",
          "Collector's display",
          "Workshop / business symbol",
        ],
      },
    },
  },
};

export const STYLE_SLUGS = Object.keys(STYLE_LANDING) as StyleSlug[];
