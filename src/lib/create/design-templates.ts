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
  /** Style "look" prompt (composition-agnostic; only when stylize=true). */
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

// Pose is NEVER forced to a T-pose. The figure must take the subjects' actual
// pose, gesture and expression from the uploaded photo; the print-readiness
// clause that follows is a soft constraint, so sturdiness is reconciled against
// the original pose on a best-effort basis. This sentence is shared by every
// stylized prompt and composed in buildTemplatePrompt.
export const POSE_FROM_PHOTO =
  "Preserve each subject's original pose, gesture, stance and facial expression " +
  "from the photo, adapting them faithfully onto the figurine; never use a generic T-pose.";

// Style "look" prompts describe ONLY the visual transformation. Who is in the
// figure, how they're arranged, the pose, background removal and print-readiness
// are appended by buildTemplatePrompt (scene axis + POSE_FROM_PHOTO + clause), so
// these stay composition-agnostic and work for one person or a group alike.
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
    subject: "person",    priceKind: "figure",
    enabled: true,
    order: 0,
  },
  {
    slug: "storybook",
    labelKey: "create.style.storybook",
    descKey: "create.style.storybook.desc",
    preview: "/examples/storybook.png",
    stylize: true,
    subject: "person",    prompt: STORYBOOK_PROMPT,
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
    subject: "person",    prompt: ANIME_PROMPT,
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
    subject: "person",    prompt: CHIBI_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 3,
  },
  {
    slug: "vinyl",
    labelKey: "create.style.vinyl",
    descKey: "create.style.vinyl.desc",
    preview: "/examples/vinyl.png",
    stylize: true,
    subject: "person",    prompt: VINYL_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 4,
  },
  {
    slug: "claymation",
    labelKey: "create.style.claymation",
    descKey: "create.style.claymation.desc",
    preview: "/examples/claymation.png",
    stylize: true,
    subject: "person",    prompt: CLAYMATION_PROMPT,
    priceKind: "figure",
    enabled: true,
    order: 5,
  },
  {
    slug: "object",
    labelKey: "create.style.object",
    descKey: "create.style.object.desc",
    preview: "/examples/object.png",
    stylize: false,
    subject: "object",    priceKind: "object",
    enabled: true,
    order: 6,
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

/**
 * Meshy pose hint. Always "" now: the figure must take the photo's pose, and an
 * empty pose_mode tells Meshy to keep the input image's pose rather than forcing
 * a canned T-pose. Kept as a function so meshy.ts needs no change.
 */
export function poseModeForStyle(_slug: string): "" | "t-pose" {
  return "";
}

/** Optional scene-axis inputs composed into a stylized prompt. */
export interface ScenePromptOptions {
  /** Stored composition fragment from the selected scene preset. */
  sceneFragment?: string | null;
  /** Free-text scene description; overrides sceneFragment when present. */
  customText?: string | null;
}

/**
 * Builds the FLUX-Kontext stylization prompt by composing the style "look" with
 * the scene axis: [look] + [scene fragment / custom text] + POSE_FROM_PHOTO +
 * background removal + PRINT_READINESS_CLAUSE. Returns null when no FLUX restyle
 * is needed (raw photo → Meshy). The scene axis only applies to stylized
 * templates; non-stylized ones (realistic/object) send the raw photo to Meshy.
 */
export function buildTemplatePrompt(
  slug: FigurineStyle,
  modifiers: StyleModifier[],
  scene: ScenePromptOptions = {}
): string | null {
  const tpl = getTemplate(slug);
  const hasModifiers = modifiers.length > 0;
  const modifierSuffix = modifiers.map((m) => MODIFIER_PROMPTS[m]).join(" ");

  // Non-stylized templates (realistic/object, or unknown): skip FLUX unless a
  // modifier is requested, in which case apply only the modifier to the photo.
  // Scene is not injected here (the raw photo already carries pose + people).
  if (!tpl || !tpl.stylize) {
    if (!hasModifiers) return null;
    const subject = tpl?.subject === "object" ? "the object" : "the person";
    return `Transform this photo: ${modifierSuffix} Remove the background completely and replace it with a plain white background. Only include ${subject}, no other elements. ${PRINT_READINESS_CLAUSE}`;
  }

  // Scene composition: free text overrides the stored fragment. POSE_FROM_PHOTO
  // is always present so the figure adopts the photo's pose, never a T-pose.
  const custom = scene.customText?.trim();
  const fragment = scene.sceneFragment?.trim();
  const sceneClause = custom || fragment || "";
  const modifierClause = hasModifiers ? `${modifierSuffix} ` : "";

  return (
    `${tpl.prompt!} ` +
    `${sceneClause ? sceneClause + " " : ""}` +
    `${modifierClause}` +
    `${POSE_FROM_PHOTO} ` +
    "Remove the background completely and replace it with a plain white background. " +
    PRINT_READINESS_CLAUSE
  );
}
