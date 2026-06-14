// Single source of truth for "Hazır Tasarım Desenleri" (design templates) — the
// set formerly known as "styles". Adding a template is a one-entry change here
// (+ one /examples/<slug>.png preview); the DB `style` column is plain text, so
// no migration is needed. Zod validation, the prompt/pose used at generation,
// the price table + finish set, and the UI grid all derive from this registry.

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
  /** false = skip the FLUX restyle, send the raw photo straight to Meshy. */
  stylize: boolean;
  /** Noun used in modifier-only prompts ("the person" / "the object"). */
  subject: "person" | "object";
  /** Meshy pose hint. */
  poseMode: "" | "t-pose";
  /** Full FLUX-Kontext stylization prompt (only when stylize=true). */
  prompt?: string;
  /** Selects the price table + finish set. */
  priceKind: "figure" | "object";
  /** Show in the picker. */
  enabled: boolean;
  /** Sort order in the grid. */
  order: number;
}

// Appended to every stylization prompt so Meshy's image-to-3d yields a
// slicer-friendly mesh. (Moved verbatim from style-transfer.ts.)
export const PRINT_READINESS_CLAUSE =
  "Critical requirements for 3D printing: clean unambiguous silhouette, thick solid limbs, " +
  "a single connected piece with no separate floating accessories, no thin protrusions or fragile details, " +
  "feet firmly planted flat on the ground, arms clearly separated from the body with visible gaps between arm and torso, " +
  "no transparent or glass elements, no hair strands or jewelry floating away from the head, " +
  "no swords, wands, staffs, or other thin handheld objects, " +
  "every part of the figure connected to the main body, designed as a sturdy collectible figurine ready for direct 3D printing.";

const POSE_TPOSE =
  "in a clear T-pose with arms extended horizontally away from the body";
const POSE_ANIME =
  "in a confident standing pose facing forward with arms clearly separated from the body";

const STORYBOOK_PROMPT =
  "Reimagine this person as an adorable storybook-animation 3D collectible figurine character. Use their general appearance as loose inspiration but fully transform them into a charming stylized animated character with cute rounded proportions, big warm expressive eyes, a sweet friendly smile, smooth softly-shaded skin, and soft studio lighting. Show the full body " +
  POSE_TPOSE +
  ", like a collectible toy figure. Remove the background completely and replace it with a plain white background. Only include the single character, no other objects. " +
  PRINT_READINESS_CLAUSE;

const ANIME_PROMPT =
  "Reimagine this person as a beautiful Japanese anime character figurine. Use their general appearance as loose inspiration but fully transform them into an authentic anime character with large detailed anime eyes, stylized colorful anime hair, clean bold cel-shading lines, vibrant colors, and manga-inspired proportions. Show the full body " +
  POSE_ANIME +
  ", like an anime figure collectible. Remove the background completely and replace it with a plain white background. Only include the single character, no other objects. " +
  PRINT_READINESS_CLAUSE;

const CHIBI_PROMPT =
  "Reimagine this person as an extremely cute chibi figurine character. Use their general appearance as loose inspiration but prioritize maximum cuteness — an oversized round head taking up nearly half the body, a tiny adorable body, big sparkling kawaii eyes, a sweet little smile, and irresistibly charming proportions. Show the full body " +
  POSE_TPOSE +
  ", like a chibi collectible figure. Remove the background completely and replace it with a plain white background. Only include the single character, no other objects. " +
  PRINT_READINESS_CLAUSE;

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
    stylize: false,
    subject: "person",
    poseMode: "",
    priceKind: "figure",
    enabled: true,
    order: 0,
  },
  {
    slug: "storybook",
    labelKey: "create.style.storybook",
    descKey: "create.style.storybook.desc",
    preview: "/examples/storybook.png",
    stylize: true,
    subject: "person",
    poseMode: "t-pose",
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
    stylize: true,
    subject: "person",
    poseMode: "",
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
    stylize: true,
    subject: "person",
    poseMode: "t-pose",
    prompt: CHIBI_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 3,
  },
  {
    slug: "object",
    labelKey: "create.style.object",
    descKey: "create.style.object.desc",
    preview: "/examples/object.png",
    stylize: false,
    subject: "object",
    poseMode: "",
    priceKind: "object",
    enabled: true,
    order: 4,
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
export function priceKindForStyle(slug: string): "figure" | "object" {
  return getTemplate(slug)?.priceKind ?? "figure";
}

/** Meshy pose hint for a slug. */
export function poseModeForStyle(slug: string): "" | "t-pose" {
  return getTemplate(slug)?.poseMode ?? "";
}

/**
 * Registry-driven replacement for the old style-transfer buildPrompt. Returns
 * null when no FLUX restyle is needed (raw photo → Meshy). Output is identical
 * to the previous per-style implementation.
 */
export function buildTemplatePrompt(
  slug: FigurineStyle,
  modifiers: StyleModifier[]
): string | null {
  const tpl = getTemplate(slug);
  const hasModifiers = modifiers.length > 0;
  const modifierSuffix = modifiers.map((m) => MODIFIER_PROMPTS[m]).join(" ");

  // Non-stylized templates (realistic/object, or unknown): skip FLUX unless a
  // modifier is requested, in which case apply only the modifier to the photo.
  if (!tpl || !tpl.stylize) {
    if (!hasModifiers) return null;
    const subject = tpl?.subject === "object" ? "the object" : "the person";
    return `Transform this photo: ${modifierSuffix} Remove the background completely and replace it with a plain white background. Only include ${subject}, no other elements. ${PRINT_READINESS_CLAUSE}`;
  }

  const basePrompt = tpl.prompt!;
  if (!hasModifiers) return basePrompt;

  // Insert the modifier instruction just before the background-removal sentence.
  const bgSentence = "Remove the background completely";
  const idx = basePrompt.indexOf(bgSentence);
  if (idx !== -1) {
    return basePrompt.slice(0, idx) + modifierSuffix + " " + basePrompt.slice(idx);
  }
  return basePrompt + " " + modifierSuffix;
}
