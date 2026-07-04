// Single source of truth for "Hazır Tasarım Desenleri" (design templates) — the
// set formerly known as "styles". Adding a template is a one-entry change here
// (+ one /examples/<slug>.png preview); the DB `style` column is plain text, so
// no migration is needed. Zod validation, the prompt used at generation, the
// price table + finish set, and the UI grid all derive from this registry.
//
// Image-first flow: every template now produces a stylized figure IMAGE via
// fal.ai (there is no automatic 3D). buildTemplatePrompt always returns a prompt.

export type StyleModifier = "pixel_art";
// `style` is stored as free text (validated against TEMPLATE_SLUGS at the edges),
// so the type is a plain string rather than a closed union — that is what makes
// new templates a registry-only change.
export type FigurineStyle = string;

export interface DesignTemplate {
  /** Stable key persisted on previews/orders (text). Keep existing values stable. */
  slug: string;
  /** i18n key for the picker label, e.g. "create.style.storybook". */
  labelKey: string;
  /** i18n key for the short description. */
  descKey: string;
  /** Preview image under /examples/. */
  preview: string;
  /**
   * Whether the customer may attach multiple reference photos for this template.
   * fal.ai `image_urls` fuses them (e.g. a couple, or multiple angles). Enabled
   * for realistic + object; the single-subject stylized looks use one photo.
   */
  allowMultiPhoto: boolean;
  /** Noun used in modifier-only prompts ("the person" / "the object"). */
  subject: "person" | "object";
  /** Style "look" prompt (composition-agnostic). */
  prompt: string;
  /**
   * Selects the price table + finish set. `figure`/`object` are the main /create
   * kinds; `keychain`/`fridge_magnet`/`lamp` are the flat-priced Creative Lab
   * products (used via /urunler, hidden from the main style grid).
   */
  priceKind: "figure" | "object" | "keychain" | "fridge_magnet" | "lamp";
  /** Show in the main /create picker (Creative Lab products are false). */
  enabled: boolean;
  /** Sort order in the grid. */
  order: number;
}

// Appended to every prompt so the generated IMAGE reads as a solid, printable
// collectible figurine (which also helps the admin who later sculpts the 3D).
// Softer than the old auto-3D print-readiness clause — the admin handles true
// printability now, so we no longer strip swords/thin details from the artwork.
export const FIGURINE_PRESENTATION =
  "Present it as a single solid collectible figurine with a clean, clear " +
  "silhouette standing on a small simple base, centered on a plain solid white " +
  "background with soft even studio lighting. No text, no watermark, and no " +
  "extra props beyond what the subject already has.";

// Pose is NEVER forced to a T-pose. The figure must take the subjects' actual
// pose, gesture and expression from the uploaded photo. Shared by every prompt.
export const POSE_FROM_PHOTO =
  "Preserve each subject's original pose, gesture, stance and facial expression " +
  "from the photo, adapting them faithfully onto the figurine; never use a generic T-pose.";

// Style "look" prompts describe ONLY the visual transformation. Pose, background
// removal and figurine presentation are appended by buildTemplatePrompt, so these
// stay composition-agnostic and work for one person or a group alike.
const REALISTIC_PROMPT =
  "Reimagine the subject(s) in this photo as a high-quality realistic collectible figurine: a finely sculpted, realistically shaded and painted miniature statue that faithfully preserves their real facial features, hairstyle, outfit, colors and proportions, with lifelike detail, like a premium display figurine.";

const STORYBOOK_PROMPT =
  "Reimagine the subject(s) in this photo as adorable storybook-animation 3D collectible figurine characters. Use their general appearance as loose inspiration but fully transform them into charming stylized animated characters with cute rounded proportions, big warm expressive eyes, sweet friendly smiles, smooth softly-shaded skin, and soft studio lighting, like collectible toy figures.";

const ANIME_PROMPT =
  "Reimagine the subject(s) in this photo as beautiful Japanese anime character figurines. Use their general appearance as loose inspiration but fully transform them into authentic anime characters with large detailed anime eyes, stylized colorful anime hair, clean bold cel-shading lines, vibrant colors, and manga-inspired proportions, like anime figure collectibles.";

const CHIBI_PROMPT =
  "Reimagine the subject(s) in this photo as extremely cute chibi figurine characters. Use their general appearance as loose inspiration but prioritize maximum cuteness — oversized round heads taking up nearly half the body, tiny adorable bodies, big sparkling kawaii eyes, sweet little smiles, and irresistibly charming proportions, like chibi collectible figures.";

const VINYL_PROMPT =
  "Reimagine the subject(s) in this photo as designer vinyl collectible figures (Funko-pop style). Use their general appearance as loose inspiration but transform them into stylized vinyl toys: an oversized rounded head on a small simplified body, smooth matte vinyl surface, minimal facial detail with large solid dark eyes, and simplified clothing in flat bold colors, like boxed collectible vinyl figures.";

const CLAYMATION_PROMPT =
  "Reimagine the subject(s) in this photo as handmade claymation stop-motion characters. Use their general appearance as loose inspiration but transform them into charming clay figures with a soft matte modeling-clay surface, gentle fingerprint texture, slightly imperfect handcrafted proportions, warm rounded features and chunky simple shapes, like stop-motion animation puppets.";

const OBJECT_PROMPT =
  "Reimagine the object in this photo as a clean, well-lit 3D collectible model render of the same object: accurate shape, colors and proportions, presented as a solid decorative display piece.";

// Creative Lab products (photo → keychain / fridge magnet / lamp). Each turns
// the subject into a small stylized 3D-printed product.
const KEYCHAIN_PROMPT =
  "Turn the subject(s) in this photo into an adorable 3D-printed keychain charm: a small cute stylized figurine of them with rounded chunky proportions and a smooth glossy finish, attached at the top to a small metal keyring loop.";

const FRIDGE_MAGNET_PROMPT =
  "Turn the subject(s) in this photo into a cute 3D-printed fridge magnet: a stylized rounded relief figurine of them with a smooth glossy finish, presented as a small flat-backed magnet.";

const LAMP_PROMPT =
  "Turn the subject(s) in this photo into a charming 3D-printed LED night lamp: a stylized figurine of them rendered in soft translucent material that glows warmly from within, sitting on a small round light base.";

export const MODIFIER_PROMPTS: Record<StyleModifier, string> = {
  pixel_art:
    "Render in retro 16-bit pixel art style with visible blocky pixels, limited color palette, and nostalgic video game aesthetic. Keep the form blocky but solid with thick voxel-style limbs and no thin pixel-wide details.",
};

// The registry. Slugs match the existing DB strings so no data rewrite is needed.
export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    slug: "realistic",
    labelKey: "create.style.realistic",
    descKey: "create.style.realistic.desc",
    preview: "/examples/realistic.png",
    allowMultiPhoto: true,
    subject: "person",
    prompt: REALISTIC_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 0,
  },
  {
    slug: "storybook",
    labelKey: "create.style.storybook",
    descKey: "create.style.storybook.desc",
    preview: "/examples/storybook.png",
    allowMultiPhoto: false,
    subject: "person",
    prompt: STORYBOOK_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 1,
  },
  {
    slug: "anime",
    labelKey: "create.style.anime",
    descKey: "create.style.anime.desc",
    preview: "/examples/anime.png",
    allowMultiPhoto: false,
    subject: "person",
    prompt: ANIME_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 2,
  },
  {
    slug: "chibi",
    labelKey: "create.style.chibi",
    descKey: "create.style.chibi.desc",
    preview: "/examples/chibi.png",
    allowMultiPhoto: false,
    subject: "person",
    prompt: CHIBI_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 3,
  },
  {
    slug: "vinyl",
    labelKey: "create.style.vinyl",
    descKey: "create.style.vinyl.desc",
    preview: "/examples/vinyl.png",
    allowMultiPhoto: false,
    subject: "person",
    prompt: VINYL_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 4,
  },
  {
    slug: "claymation",
    labelKey: "create.style.claymation",
    descKey: "create.style.claymation.desc",
    preview: "/examples/claymation.png",
    allowMultiPhoto: false,
    subject: "person",
    prompt: CLAYMATION_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 5,
  },
  {
    slug: "object",
    labelKey: "create.style.object",
    descKey: "create.style.object.desc",
    preview: "/examples/object.png",
    allowMultiPhoto: true,
    subject: "object",
    prompt: OBJECT_PROMPT,
    priceKind: "object",
    enabled: true,
    order: 6,
  },
  // ─── Creative Lab products (/urunler) — hidden from the main /create grid ───
  {
    slug: "keychain",
    labelKey: "create.style.keychain",
    descKey: "create.style.keychain.desc",
    preview: "/examples/realistic.png",
    allowMultiPhoto: false,
    subject: "person",
    prompt: KEYCHAIN_PROMPT,
    priceKind: "keychain",
    enabled: false,
    order: 10,
  },
  {
    slug: "fridge_magnet",
    labelKey: "create.style.fridge_magnet",
    descKey: "create.style.fridge_magnet.desc",
    preview: "/examples/realistic.png",
    allowMultiPhoto: false,
    subject: "person",
    prompt: FRIDGE_MAGNET_PROMPT,
    priceKind: "fridge_magnet",
    enabled: false,
    order: 11,
  },
  {
    slug: "lamp",
    labelKey: "create.style.lamp",
    descKey: "create.style.lamp.desc",
    preview: "/examples/realistic.png",
    allowMultiPhoto: false,
    subject: "person",
    prompt: LAMP_PROMPT,
    priceKind: "lamp",
    enabled: false,
    order: 12,
  },
];

export const TEMPLATE_SLUGS: string[] = DESIGN_TEMPLATES.map((t) => t.slug);
export const DEFAULT_TEMPLATE_SLUG = "storybook";

export function getTemplate(slug: string): DesignTemplate | undefined {
  return DESIGN_TEMPLATES.find((t) => t.slug === slug);
}

export function isValidTemplateSlug(slug: string): boolean {
  return TEMPLATE_SLUGS.includes(slug);
}

/** Price kind for a slug (defaults to "figure" for unknown slugs). */
export function priceKindForStyle(
  slug: string,
): DesignTemplate["priceKind"] {
  return getTemplate(slug)?.priceKind ?? "figure";
}

/**
 * Builds the fal.ai image prompt: [look] + [modifier] + POSE_FROM_PHOTO +
 * FIGURINE_PRESENTATION. Always returns a prompt (unknown slug → realistic look).
 * The composition (who is in the figure, how they're arranged) comes straight
 * from the customer's photo, so there is no separate "scene" axis.
 */
export function buildTemplatePrompt(
  slug: FigurineStyle,
  modifiers: StyleModifier[],
): string {
  const look = getTemplate(slug)?.prompt ?? REALISTIC_PROMPT;
  const modifierClause =
    modifiers.length > 0
      ? modifiers.map((m) => MODIFIER_PROMPTS[m]).join(" ") + " "
      : "";
  return `${look} ${modifierClause}${POSE_FROM_PHOTO} ${FIGURINE_PRESENTATION}`;
}
